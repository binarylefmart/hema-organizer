import { db } from "./db";
import { parisOffsetMinutes, seanceCommencee, todayIso } from "./dates";
import { compteursDepuisTotaux, type Compteurs } from "./presences";
import { isStaff, type UserLike } from "./permissions";
import { parseDisciplines, type AttendanceStatut } from "./constants";
import { programmeDepuisParties, type ProgrammeSeance } from "./planning";
// La borne d'arrivée dans la période n'a qu'une définition, et elle vit là où le taux personnel du
// bureau se calcule : deux versions de cette règle, c'étaient deux chiffres pour la même personne.
import { jourDArrivee } from "./tableau-de-bord";

/**
 * Requêtes « séances » côté serveur, avec les compteurs de présence.
 */
export type SeanceInstructeur = { id: string; prenom: string; nom: string };
export type SeanceAtelier = { id: string; titre: string; animateur: string };

export type Participant = { id: string; prenom: string; nom: string; couleur: number | null };
export type ListesParStatut = { presents: Participant[]; peutEtre: Participant[]; absents: Participant[]; sansReponse: Participant[] };

export type SeanceCarte = {
  id: string;
  periodId: string;
  periodNom: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  adresse: string;
  disciplines: string[];
  theme: string;
  alternative: string;
  annulee: boolean;
  motifAnnulation: string | null;
  instructeurs: SeanceInstructeur[];
  ateliers: SeanceAtelier[];
  /** Cases du planning renseignées (partie, instructeur, thème, atelier) */
  programme: ProgrammeSeance;
  compteurs: Compteurs;
  /** Statut du membre courant (null = pas encore répondu) */
  monStatut: string | null;
  /** Le membre courant est invité sur la période (sinon : consultation seule) */
  inscrit: boolean;
  /** Liste nominative par statut (visible par tous les membres, comme sur Cally) */
  participants: ListesParStatut;
  /** Le cours a commencé : réponse verrouillée */
  commencee: boolean;
};

// La liste nominative des invités appartient à la période, pas à la séance : elle est chargée
// une seule fois par période (`invitesDesPeriodes`) au lieu d'être rapatriée pour chaque carte.
const INCLUDE_CARTE = {
  period: { select: { nom: true } },
  instructeurs: { include: { user: { select: { id: true, prenom: true, nom: true } } } },
  parties: {
    orderBy: { ordre: "asc" },
    include: {
      instructeur: { select: { prenom: true, nom: true } },
      instructeurSecond: { select: { prenom: true, nom: true } },
      atelier: { select: { id: true, titre: true } },
    },
  },
  ateliers: {
    where: { statut: "PLANIFIE" },
    select: { id: true, titre: true, proposePar: { select: { prenom: true, nom: true } } },
  },
  attendances: { select: { userId: true, statut: true } },
} as const;

type SessionBrute = NonNullable<Awaited<ReturnType<typeof chargerUne>>>;

async function chargerUne(id: string) {
  return db.session.findUnique({ where: { id }, include: INCLUDE_CARTE });
}

// Générique pour servir aussi aux listes enrichies (cf. `participantsAPlat`) : le tri ne regarde
// que le prénom et le nom, le reste de la ligne suit sans que le comparateur ait à le connaître.
function trierParNom<T extends Participant>(liste: T[]): T[] {
  return liste.sort((a, b) => a.prenom.localeCompare(b.prenom, "fr") || a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Le compte de connexion du portail ne figure jamais dans les listes nominatives.
 *
 * `addedAt` est la **date d'entrée dans la période** : elle borne le taux personnel de
 * « Mes présences » exactement comme celui du tableau de bord (voir `historiquePresences`). Colonne
 * lue au passage, aucune requête de plus.
 */
const SELECT_INVITES = {
  where: { user: { service: false } },
  select: { addedAt: true, user: { select: { id: true, prenom: true, nom: true, couleur: true } } },
} as const;

/**
 * Invités d'une ou plusieurs périodes, triés **une seule fois** par période.
 * Comparer des noms selon l'alphabet français coûte cher : le faire à chaque séance, c'est le
 * même tri des dizaines de fois. Les listes par statut restent triées : répartir une liste déjà
 * triée conserve l'ordre (tri stable), donc le résultat est identique.
 */
async function invitesDesPeriodes(periodIds: readonly string[]): Promise<Map<string, Participant[]>> {
  const parPeriode = new Map<string, Participant[]>();
  if (periodIds.length === 0) return parPeriode;
  const lignes = await db.periodMember.findMany({
    where: { periodId: { in: [...new Set(periodIds)] }, user: { service: false } },
    select: { periodId: true, user: { select: { id: true, prenom: true, nom: true, couleur: true } } },
  });
  for (const l of lignes) {
    const liste = parPeriode.get(l.periodId);
    if (liste) liste.push(l.user);
    else parPeriode.set(l.periodId, [l.user]);
  }
  for (const liste of parPeriode.values()) trierParNom(liste);
  return parPeriode;
}

/** Répartit les invités (déjà triés) par statut. */
function listeParticipants(attendances: Array<{ userId: string; statut: string }>, invites: readonly Participant[]): ListesParStatut {
  const statuts = new Map(attendances.map((a) => [a.userId, a.statut]));
  const liste: ListesParStatut = { presents: [], peutEtre: [], absents: [], sansReponse: [] };
  for (const user of invites) {
    const st = statuts.get(user.id);
    (st === "PRESENT" ? liste.presents : st === "PEUT_ETRE" ? liste.peutEtre : st === "ABSENT" ? liste.absents : liste.sansReponse).push(user);
  }
  return liste;
}

/**
 * **Les compteurs d'une carte se dérivent de sa liste nominative** — c'est la même chose comptée,
 * pas un second comptage.
 *
 * Le compteur partait des lignes de présence brutes de la séance, la liste des **invités** de la
 * période. Or `Attendance` pend à `User` et à `Session`, jamais à `PeriodMember` : retirer
 * quelqu'un du trimestre laisse ses réponses derrière lui. Le numérateur ramassait donc des gens
 * absents du dénominateur, et la même carte affichait « 14 présents » au-dessus de treize noms,
 * pendant que le tableau de bord et la page publique — filtrés, eux — en annonçaient treize.
 *
 * **Le compteur et la liste nominative d'une même carte doivent être, par construction, deux
 * lectures du même ensemble.** Filtrer aux deux endroits ne suffit pas : on vient de l'oublier à un
 * endroit sur trois. En dérivant l'un de l'autre, l'écart cesse d'être exprimable.
 *
 * `compteursDepuisTotaux` reste la seule formule du pourcentage et du reste « sans réponse », pour
 * que cette carte compte exactement comme les agrégats SQL du tableau de bord.
 */
function compteursDeLaListe(liste: ListesParStatut, invites: number): Compteurs {
  return compteursDepuisTotaux({ PRESENT: liste.presents.length, ABSENT: liste.absents.length, PEUT_ETRE: liste.peutEtre.length }, invites);
}

/** Un invité avec sa réponse portée sur la même ligne (`null` = n'a pas encore répondu). */
export type ParticipantStatut = Participant & { statut: AttendanceStatut | null };

/**
 * Remet les quatre groupes d'une `ListesParStatut` en une seule liste ordonnée par nom.
 * L'affichage des cartes raisonne en colonnes (présents / peut-être / absents / sans réponse) ;
 * l'écran de gestion, lui, corrige les réponses une personne à la fois et a besoin de l'inverse :
 * une ligne par invité, chacune portant son statut, dans un ordre où l'on retrouve quelqu'un.
 */
export function participantsAPlat(liste: ListesParStatut): ParticipantStatut[] {
  const avecStatut = (gens: readonly Participant[], statut: AttendanceStatut | null): ParticipantStatut[] => gens.map((p) => ({ ...p, statut }));
  return trierParNom([
    ...avecStatut(liste.presents, "PRESENT"),
    ...avecStatut(liste.peutEtre, "PEUT_ETRE"),
    ...avecStatut(liste.absents, "ABSENT"),
    ...avecStatut(liste.sansReponse, null),
  ]);
}

function versCarte(s: SessionBrute, invites: readonly Participant[], user: UserLike & { id: string }, now: Date): SeanceCarte {
  const userId = user.id;
  // Une seule répartition, lue deux fois : le compteur en est le dénombrement, la liste l'affichage.
  const participants = listeParticipants(s.attendances, invites);
  return {
    id: s.id,
    periodId: s.periodId,
    periodNom: s.period.nom,
    date: s.date,
    heureDebut: s.heureDebut,
    heureFin: s.heureFin,
    lieu: s.lieu,
    adresse: s.adresse,
    disciplines: parseDisciplines(s.disciplines),
    theme: s.theme,
    alternative: s.alternative,
    annulee: s.annulee,
    motifAnnulation: s.motifAnnulation,
    instructeurs: s.instructeurs.map((i) => i.user),
    ateliers: s.ateliers.map((a) => ({ id: a.id, titre: a.titre, animateur: `${a.proposePar.prenom} ${a.proposePar.nom}` })),
    programme: programmeDepuisParties(s.parties),
    compteurs: compteursDeLaListe(participants, invites.length),
    monStatut: s.attendances.find((a) => a.userId === userId)?.statut ?? null,
    inscrit: invites.some((p) => p.id === userId),
    participants,
    commencee: seanceCommencee(s.date, s.heureDebut, now),
  };
}

/**
 * Prochaines séances : périodes ACTIVE où le membre est invité (l'équipe voit toutes les périodes actives),
 * séances d'aujourd'hui et à venir, la plus proche en premier.
 */
export async function prochainesSeances(user: UserLike & { id: string }, now = new Date()): Promise<SeanceCarte[]> {
  const userId = user.id;
  const sessions = await db.session.findMany({
    where: {
      date: { gte: todayIso(now) },
      period: { statut: "ACTIVE", ...(isStaff(user) ? {} : { membres: { some: { userId } } }) },
    },
    orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
    include: INCLUDE_CARTE,
  });
  // Une seule lecture de la liste des invités par période concernée, partagée par toutes ses cartes
  const invites = await invitesDesPeriodes(sessions.map((s) => s.periodId));
  return sessions.map((s) => versCarte(s, invites.get(s.periodId) ?? [], user, now));
}

/**
 * Toutes les séances d'une période, en une seule requête (même contenu de carte que les prochains cours,
 * même tri : date puis heure de début). L'appelant filtre ensuite ce qu'il affiche.
 *
 * Droits : la personne ne reçoit les séances que si elle est invitée sur la période ;
 * l'équipe voit toutes les périodes (exactement la règle de `prochainesSeances`).
 * La garantie est portée par la requête elle-même : un identifiant de période forgé ne renvoie rien.
 */
export async function seancesDePeriode(periodId: string, user: UserLike & { id: string }, now = new Date()): Promise<SeanceCarte[]> {
  const userId = user.id;
  const sessions = await db.session.findMany({
    where: { periodId, ...(isStaff(user) ? {} : { period: { membres: { some: { userId } } } }) },
    orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
    include: INCLUDE_CARTE,
  });
  if (sessions.length === 0) return [];
  const invites = (await invitesDesPeriodes([periodId])).get(periodId) ?? [];
  return sessions.map((s) => versCarte(s, invites, user, now));
}

export async function seanceCarte(id: string, user: UserLike & { id: string }, now = new Date()): Promise<SeanceCarte | null> {
  const s = await chargerUne(id);
  if (!s) return null;
  const invites = (await invitesDesPeriodes([s.periodId])).get(s.periodId) ?? [];
  return versCarte(s, invites, user, now);
}

/** "HH:MM" de l'instant donné, en heure de Paris (même repère que les heures stockées). */
function heureParis(now: Date): string {
  const local = new Date(now.getTime() + parisOffsetMinutes(now) * 60_000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Filtre SQL « séance déjà commencée » : date passée, ou séance du jour dont l'heure de début
 * est atteinte — la même règle que `seanceCommencee`, exprimée sur les colonnes indexées
 * (`Session(periodId, date)`). Aux heures de changement d'heure il peut retenir une séance du
 * jour de trop : l'appelant repasse `seanceCommencee` derrière, qui tranche.
 */
function dejaCommencees(now: Date) {
  const aujourdHui = todayIso(now);
  return { OR: [{ date: { lt: aujourdHui } }, { date: aujourdHui, heureDebut: { lte: heureParis(now) } }] };
}

export type HistoriquePeriode = {
  id: string;
  nom: string;
  statut: string;
  dateDebut: string;
  dateFin: string;
  seances: Array<{
    id: string;
    date: string;
    heureDebut: string;
    heureFin: string;
    lieu: string;
    theme: string;
    disciplines: string[];
    annulee: boolean;
    motifAnnulation: string | null;
    statut: string | null;
    compteurs: Compteurs;
    participants: ListesParStatut;
  }>;
  /** Séances passées non annulées / présences */
  presences: number;
  comptees: number;
  pourcentage: number;
  /** Vrai quand la liste des séances a été bornée et que des cours plus anciens n'ont pas été chargés. */
  aPlus: boolean;
};

/**
 * Historique complet du membre : toutes les périodes où il a été invité (la plus récente en premier),
 * séances déjà commencées uniquement, avec son statut et son taux personnel (séances non annulées).
 */
export async function historiquePresences(userId: string, now = new Date(), maxSeances?: number): Promise<HistoriquePeriode[]> {
  const periodes = await db.period.findMany({
    where: { membres: { some: { userId } } },
    orderBy: { dateDebut: "desc" },
    select: {
      id: true,
      nom: true,
      statut: true,
      dateDebut: true,
      dateFin: true,
      membres: SELECT_INVITES,
      sessions: {
        // Le tri des séances non commencées se faisait en JavaScript : après quelques saisons,
        // c'était des centaines de séances et des milliers de présences chargées pour rien.
        where: dejaCommencees(now),
        orderBy: [{ date: "desc" }, { heureDebut: "desc" }],
        // `maxSeances` ne borne que ce qui est **affiché** : chaque séance rapatriée emporte les
        // réponses de tout le club, et c'est ce qui fait de cet écran le plus lourd de
        // l'application (quatre-vingts membres sur deux saisons, c'est des milliers de lignes pour
        // un écran de membre). Le taux de la période, lui, ne s'en trouve pas faussé : il est
        // calculé plus bas sur la liste **complète** des cours, chargée à part en quatre colonnes.
        ...(maxSeances !== undefined ? { take: maxSeances } : {}),
        select: {
          id: true,
          date: true,
          heureDebut: true,
          heureFin: true,
          lieu: true,
          theme: true,
          disciplines: true,
          annulee: true,
          motifAnnulation: true,
          attendances: { select: { userId: true, statut: true } },
        },
      },
    },
  });
  /*
   * **Ce qui compte n'est pas ce qui s'affiche.** Quand la liste des séances est bornée, le taux du
   * trimestre ne peut plus se déduire de ce qu'on vient de charger — il dirait « 80 % sur 20 cours »
   * pour un trimestre qui en compte trente. On relit donc tous les cours passés de ces périodes,
   * mais en **quatre colonnes** et avec la seule réponse de la personne concernée : c'est quelques
   * kilo-octets, là où la liste complète des réponses de tout le club pèse des mégaoctets.
   */
  const tousLesCours =
    maxSeances === undefined
      ? null
      : await db.session.findMany({
          where: { periodId: { in: periodes.map((p) => p.id) }, ...dejaCommencees(now) },
          select: { periodId: true, date: true, heureDebut: true, annulee: true, attendances: { where: { userId }, select: { statut: true } } },
        });

  return periodes
    .map((p) => {
      // Même liste d'invités pour toutes les séances de la période : triée une fois (cf. `invitesDesPeriodes`)
      const invites = trierParNom(p.membres.map((m) => m.user));
      const seances = p.sessions
        // Le filtre SQL est volontairement un peu large (il compare des heures locales) : la règle
        // qui fait foi reste `seanceCommencee`, réappliquée ici sur les quelques séances du jour.
        .filter((s) => seanceCommencee(s.date, s.heureDebut, now))
        .map((s) => {
          // Même règle que les cartes : le compteur est le dénombrement de la liste affichée à côté.
          const participants = listeParticipants(s.attendances, invites);
          return {
            id: s.id,
            date: s.date,
            heureDebut: s.heureDebut,
            heureFin: s.heureFin,
            lieu: s.lieu,
            theme: s.theme,
            disciplines: parseDisciplines(s.disciplines),
            annulee: s.annulee,
            motifAnnulation: s.motifAnnulation,
            statut: s.attendances.find((a) => a.userId === userId)?.statut ?? null,
            compteurs: compteursDeLaListe(participants, invites.length),
            participants,
          };
        });
      /*
       * **Son dénominateur, ce sont SES cours** : ceux qui ont eu lieu depuis son entrée dans la
       * période, jamais tous ceux du trimestre — la même règle, et la même fonction, que le tableau
       * de bord (`statsPeriode`, `jourDArrivee`).
       *
       * Ce taux-ci s'affiche sur le troisième écran qui l'annonce, et c'est **celui où la personne
       * concernée lit son propre chiffre**. Il était seul à ne pas porter la borne : quelqu'un
       * inscrit à la Toussaint, douze cours déjà passés, cinq depuis son arrivée, présent quatre
       * fois, lisait « 80 % — 4 cours sur 5 » sur son accueil et « 33 % · 4 présences sur 12 » ici.
       * Un taux qui compte les cours d'avant l'arrivée de quelqu'un n'est pas un taux, c'est un
       * reproche.
       *
       * La **liste** des séances, elle, n'est pas bornée : c'est le registre des cours du trimestre,
       * comme les colonnes du tableau de bord, et le remplissage d'une séance est un fait qui ne se
       * lit pas du point de vue d'un membre. Seule la fraction annoncée en tête de période l'est.
       */
      const arrivee = jourDArrivee(p.membres.find((m) => m.user.id === userId)?.addedAt);
      const sienne = (c: { date: string }) => c.date >= arrivee;
      // Le taux se compte sur **tous** les cours de la période, jamais sur la tranche affichée.
      const coursDeLaPeriode = tousLesCours
        ? tousLesCours.filter((c) => c.periodId === p.id && seanceCommencee(c.date, c.heureDebut, now) && !c.annulee && sienne(c))
        : null;
      const passees = coursDeLaPeriode ?? seances.filter((s) => !s.annulee && sienne(s));
      const presences = coursDeLaPeriode
        ? coursDeLaPeriode.filter((c) => c.attendances[0]?.statut === "PRESENT").length
        : seances.filter((s) => !s.annulee && sienne(s) && s.statut === "PRESENT").length;
      return {
        id: p.id,
        nom: p.nom,
        statut: p.statut,
        dateDebut: p.dateDebut,
        dateFin: p.dateFin,
        seances,
        presences,
        // Ce que le bouton « tout l'historique » doit savoir : il reste des cours qu'on n'a pas lus.
        aPlus: coursDeLaPeriode !== null && tousLesCours!.filter((c) => c.periodId === p.id && seanceCommencee(c.date, c.heureDebut, now)).length > seances.length,
        comptees: passees.length,
        pourcentage: passees.length ? Math.round((presences / passees.length) * 100) : 0,
      };
    })
    .filter((p) => p.seances.length > 0);
}
