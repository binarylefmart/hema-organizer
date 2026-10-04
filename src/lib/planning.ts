import { db } from "./db";
import { niveauAffiche, NIVEAU_DEFAUT, PARTIES_MODELE, prochainLibellePartie, THEMES_DEFAUT, type Niveau } from "./constants";
import { addDays, formatDateCourte, isoWeekday, nomMois, seanceCommencee, todayIso } from "./dates";
import { compterPresences, type Compteurs } from "./presences";
import { can, isStaff, type UserLike } from "./permissions";
import { nettoyerLieux, type Lieu } from "./lieux";
import { CLES, getSetting, setSetting } from "./settings";
// Module purement calculatoire (ni React, ni base) : la numérotation des parties y vit déjà, avec le
// repère de couleur qu'elle nourrit. L'importer d'ici évite d'en écrire une seconde version — et
// c'est bien la même règle qui doit servir aux deux bouts, sinon l'écart revient.
import { rangsDansNature } from "@/components/seances/programme-cours";
// Même raison : la définition de « case vide » doit être lisible par le navigateur (`CaseEditeur` ne
// peut rien importer d'ici) autant que par le serveur. Une seule règle, un seul fichier.
import { reglagesVides } from "@/components/planning/options";
// Le calcul des deux invariants d'une séance (rangs contigus, libellés d'accord avec eux) vit dans un
// module **sans Prisma** : le script de réparation doit pouvoir le relever sans ouvrir de base, et la
// règle ne doit exister qu'une fois (voir l'en-tête de `rangement.ts`).
import { rangementsParties, type PartieARanger, type RangementPartie } from "@/components/planning/rangement";

/**
 * Planning de cours : une colonne par séance, **autant de cases que la séance a de parties**,
 * chacune avec son (ou ses) instructeur(s), son thème, son niveau et sa description.
 *
 * Les cases étaient au nombre de quatre, figées dans le code, et le nom de la case servait de clé en
 * base. Une séance porte maintenant ses propres parties : elles s'ajoutent, se retirent, se
 * déplacent et changent de nature. L'`id` de la partie a remplacé son nom partout où il fallait la
 * désigner.
 *
 * **Le nom d'une partie n'est plus une donnée saisie** : il se calcule depuis le rang dans sa
 * nature (`libellePartie`) et la colonne `libelle` est tenue à jour par `rangerParties`, au seul
 * endroit où les parties d'une séance se rangent. Ce qui décrit la partie, c'est son contenu.
 *
 * Les cases restent la source de vérité du « programme » : après chaque modification,
 * `synchroniserSeance` recopie thèmes et instructeurs dans la séance (cartes, exports, récaps).
 */

export type Personne = { id: string; prenom: string; nom: string; role: string; couleur: number | null };

export type CasePlanning = {
  id: string;
  /** Rang dans la séance, contigu à partir de 0 (voir `renumeroter`) */
  ordre: number;
  /**
   * Rang **dans sa nature**, à partir de 1 (`rangsDansNature`) : le 2e cours de la séance, la 1ère
   * option. C'est le nombre que compte le libellé du modèle, donc le seul dont puisse dépendre ce qui
   * se pose à côté de lui — le repère de couleur (`couleurPartie`). Il est calculé ici, sur la séance
   * **entière**, comme pour les lignes de programme : recompté après un filtre, il donnerait le rang
   * 1 au second cours d'une séance dont le premier est vide.
   */
  rang: number;
  /**
   * Nom affiché de la partie — **calculé** depuis `rang` et `estOption` (`libellePartie`), jamais
   * saisi. La colonne est tenue à jour par `rangerParties` à chaque écriture.
   */
  libelle: string;
  /** **Option** : une partie qui se tient pendant un cours, et qui accueille les ateliers */
  estOption: boolean;
  instructeurId: string | null;
  instructeur: string | null;
  /** **Celui qui assiste** : un second encadrant, facultatif — jamais publié vers l'extérieur */
  instructeurSecondId: string | null;
  instructeurSecond: string | null;
  theme: string;
  /**
   * **Ce qu'on fera dans cette partie**, en texte libre, vide tant que personne ne l'a écrit. C'est
   * le seul champ de la case qui raconte plutôt que de désigner — et il **sort du club** (API
   * publique, pages de partage), comme le thème.
   */
  description: string;
  /** Niveau annoncé de la case — `INDIFFERENT` tant que personne n'en a choisi un (voir `niveauAffiche`) */
  niveau: Niveau;
  atelier: { id: string; titre: string; materiel: string | null } | null;
  modifiePar: string | null;
  modifieLe: string | null;
};

export type ColonnePlanning = {
  id: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  annulee: boolean;
  motifAnnulation: string | null;
  commencee: boolean;
  /** "AAAA-MM" pour le regroupement par mois */
  mois: string;
  /** Les parties de la séance, **déjà triées par `ordre`** : la grille les affiche telles quelles */
  parties: CasePlanning[];
  compteurs: Compteurs;
  /** Nombre de participants ayant répondu « Présent » parmi la liste nominative (pour l'infobulle) */
  presents: string[];
};

export type Planning = {
  periode: { id: string; nom: string; dateDebut: string; dateFin: string; statut: string };
  colonnes: ColonnePlanning[];
  mois: Array<{ cle: string; label: string; nombre: number }>;
  /**
   * Personnes proposables dans une case — les **instructeurs**, plus celles déjà posées sur une case
   * de la période (`personnesPlanning`). **Vide** pour qui ne peut pas écrire : la liste ne sort pas.
   */
  personnes: Personne[];
  themes: string[];
  /** Ateliers en attente (proposables dans une case par l'équipe : un seul geste pour les placer) — vide sinon */
  ateliersDisponibles: Array<{ id: string; titre: string; proposePar: string; sessionId: string | null }>;
  /** L'utilisateur courant peut modifier les cases */
  modifiable: boolean;
  /** L'utilisateur courant peut programmer un atelier depuis une case */
  peutProgrammer: boolean;
};

/** Lundi de la semaine contenant la date (AAAA-MM-JJ). */
export function debutSemaine(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

/** Semaines d'un mois du planning : clé = lundi, libellé « Sem. du 1 sept. », colonnes concernées. */
export function semainesDuMois(colonnes: Array<{ date: string; mois: string }>, mois: string): Array<{ cle: string; label: string; nombre: number }> {
  const semaines: Array<{ cle: string; label: string; nombre: number }> = [];
  for (const c of colonnes.filter((c) => c.mois === mois)) {
    const cle = debutSemaine(c.date);
    const existante = semaines.find((s) => s.cle === cle);
    if (existante) existante.nombre++;
    else semaines.push({ cle, label: `Semaine du ${formatDateCourte(cle).split(" ").slice(1).join(" ")}`, nombre: 1 });
  }
  return semaines;
}

/** Liste des thèmes (réglage `themes`, sinon la liste par défaut). */
export async function getThemes(): Promise<string[]> {
  const brut = await getSetting(CLES.themes);
  if (!brut) return [...THEMES_DEFAUT];
  try {
    const liste = JSON.parse(brut);
    if (Array.isArray(liste) && liste.every((t) => typeof t === "string")) return liste;
  } catch {
    /* réglage corrompu : on retombe sur la liste par défaut */
  }
  return [...THEMES_DEFAUT];
}

export async function setThemes(themes: string[]): Promise<void> {
  await setSetting(CLES.themes, JSON.stringify(themes));
}

/**
 * **Les lieux habituels des cours**, rangés ici et non dans `src/lib/lieux.ts` : ce module-là est
 * **pur**, pour être lisible depuis le sélecteur de lieu, qui est un composant client. Importer une
 * lecture de base depuis le navigateur entraînerait `settings.ts`, donc `crypto.ts`, donc
 * `node:crypto` — et le build échoue (constaté, et c'est tant mieux).
 *
 * Vide par défaut : un club qui vient d'installer l'outil saisit le lieu séance par séance.
 */
export async function getLieux(): Promise<Lieu[]> {
  const brut = await getSetting(CLES.lieux);
  if (!brut) return [];
  try {
    const liste = JSON.parse(brut);
    if (!Array.isArray(liste)) return [];
    // On revalide en relisant : un réglage écrit par une version antérieure (ou abîmé) ne doit pas
    // faire tomber le formulaire de séance, qui est un écran de travail quotidien.
    return nettoyerLieux(
      liste
        .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
        .map((l) => `${typeof l.lieu === "string" ? l.lieu : ""} | ${typeof l.adresse === "string" ? l.adresse : ""}`)
        .join("\n"),
    );
  } catch {
    return [];
  }
}

export async function setLieux(lieux: Lieu[]): Promise<void> {
  await setSetting(CLES.lieux, JSON.stringify(lieux));
}

/** Nettoie une liste saisie (une ligne par thème) : coupe, dédoublonne, ignore les vides. */
export function nettoyerThemes(texte: string, max = 60): string[] {
  const vus = new Set<string>();
  const liste: string[] = [];
  for (const ligne of texte.split(/\r?\n|,/)) {
    const t = ligne.trim().slice(0, max);
    const cle = t.toLocaleLowerCase("fr");
    if (!t || vus.has(cle)) continue;
    vus.add(cle);
    liste.push(t);
  }
  return liste;
}

/**
 * Périodes qu'une personne a le droit de regarder : l'équipe les voit toutes, chacun d'autre
 * ne voit que celles où il est invité. Le même filtre qu'à l'onglet Séances, pour que la liste
 * proposée et le planning effectivement chargé disent exactement la même chose.
 */
export function periodesVisiblesPar(user: UserLike & { id: string }) {
  return isStaff(user) ? {} : { membres: { some: { userId: user.id } } };
}

/**
 * Période affichée par défaut : la période active en cours (ou la prochaine à démarrer),
 * sinon la période active la plus récente, sinon un brouillon, sinon la dernière.
 * Toujours parmi celles où la personne a sa place : proposer d'office le trimestre d'à côté
 * reviendrait à en ouvrir la porte sans que personne ne l'ait demandé.
 */
export async function periodePlanningParDefaut(user: UserLike & { id: string }, now = new Date()): Promise<{ id: string } | null> {
  const aujourdHui = todayIso(now);
  const sienne = periodesVisiblesPar(user);
  return (
    (await db.period.findFirst({ where: { ...sienne, statut: "ACTIVE", dateFin: { gte: aujourdHui } }, orderBy: { dateDebut: "asc" }, select: { id: true } })) ??
    (await db.period.findFirst({ where: { ...sienne, statut: "ACTIVE" }, orderBy: { dateDebut: "desc" }, select: { id: true } })) ??
    (await db.period.findFirst({ where: { ...sienne, statut: "BROUILLON" }, orderBy: { dateDebut: "desc" }, select: { id: true } })) ??
    (await db.period.findFirst({ where: sienne, orderBy: { dateDebut: "desc" }, select: { id: true } }))
  );
}

/**
 * Personnes proposables dans une case : **les instructeurs**, plus celles déjà posées sur une case.
 *
 * **Décision, Delta, après la v0.53.0** : « pour le champ des instructeurs dans planning tu as mis
 * en liste tous les users, je ne veux que ceux qui ont le rôle instructeur ».
 *
 * *Ce qu'elle remplace.* Le, la même liste avait été **ouverte à tout le club** (« dans planning je
 * veux que tous les users, même les prochains ajouts, soient visibles dans la liste déroulante ») :
 * elle était alors restreinte à l'équipe **plus les membres invités sur cette période**, si bien
 * qu'une personne inscrite après la génération du trimestre n'apparaissait nulle part. Le
 * commentaire d'alors défendait l'ouverture totale — « mener une partie de cours n'est pas un
 * droit » —, et c'est cette phrase-là qui tombe : **le vrai défaut était le filtre de période, pas
 * le filtre de rôle**. Les deux se confondaient dans une seule condition, les séparer les traite
 * chacun pour ce qu'il est. Un instructeur recruté demain reste donc dans la liste sans qu'on ait
 * rien à faire — c'est ce que l'ouverture cherchait —, mais les trente membres du club n'encombrent
 * plus un menu où l'on cherche un encadrant.
 *
 * *Le rôle retenu est `INSTRUCTEUR`, et lui seul — et c'est devenu la bonne réponse.* Ce paragraphe
 * disait l'inverse : les trois rôles étant exclusifs, « un administrateur qui anime un cours n'est
 * plus proposable tant qu'il est ADMIN », conséquence assumée faute de mieux. Depuis que le bureau
 * est un **supplément** (`User.estAdmin`) et non un rôle, un membre du bureau qui enseigne porte
 * `role = "INSTRUCTEUR"` : il est dans cette liste, sans qu'on ait rien ajouté. Et c'est bien
 * `role` qu'on interroge ici, **pas `estAdmin`** : mener une partie de cours est un métier, pas un
 * droit — un trésorier qui ne descend jamais sur la piste n'a rien à faire dans un menu
 * d'encadrants. Qui encadre se dit maintenant en une seule colonne, c'est tout l'intérêt du
 * changement.
 *
 * *`dejaPosees` : on ne fait jamais disparaître quelqu'un d'une case.* Une liste déroulante doit
 * **toujours** contenir sa propre valeur. Sans ce second terme, une partie menée par une personne
 * qui n'est pas (ou plus) instructeur se retrouverait avec un `<select>` sans entrée correspondante :
 * le navigateur afficherait alors la première entrée — `----------` —, et le premier enregistrement
 * de la case écraserait **en silence** une donnée juste. L'appelant (`chargerPlanning`) passe les
 * identifiants d'instructeur et de second lus sur les parties de la période affichée : ce sont
 * exactement les valeurs que les listes auront à représenter, et ça ne coûte aucune requête de plus.
 * Ces identifiants-là entrent **sans condition** — ni `actif`, ni `service`, ni rôle : le but n'est
 * pas de dire qui mérite d'être proposé, mais de savoir nommer ce qui est déjà écrit. Un compte
 * désactivé en cours de trimestre tombait dans le même piège, silencieusement, depuis toujours.
 *
 * *L'ordre est alphabétique, simplement.* Le tri rangeait les MEMBRE en dernier, derrière
 * l'encadrement : ça avait un sens quand la liste était le club entier, ça n'en a plus quand elle
 * est l'encadrement. Garder ce rang reviendrait à reléguer en queue de menu la poignée de personnes
 * retenues par `dejaPosees`, c'est-à-dire justement celles qu'on cherche à retrouver dans leur case.
 */
export async function personnesPlanning(dejaPosees: Iterable<string> = []): Promise<Personne[]> {
  const retenues = [...new Set([...dejaPosees].filter(Boolean))];
  const users = await db.user.findMany({
    // Deux branches, et pas un `AND` : la seconde est un **rattrapage**, elle doit pouvoir passer
    // outre les exclusions de la première (voir `dejaPosees` ci-dessus).
    where: { OR: [{ actif: true, service: false, role: "INSTRUCTEUR" }, { id: { in: retenues } }] },
    select: { id: true, prenom: true, nom: true, role: true, couleur: true },
  });
  return users.sort((a, b) => a.prenom.localeCompare(b.prenom, "fr") || a.nom.localeCompare(b.nom, "fr"));
}

export async function chargerPlanning(periodId: string, user: UserLike & { id: string }, now = new Date()): Promise<Planning | null> {
  const periode = await db.period.findUnique({
    where: { id: periodId },
    // `select` et non `include` : la grille n'affiche ni l'adresse, ni les disciplines, ni les dates techniques
    select: {
      id: true,
      nom: true,
      dateDebut: true,
      dateFin: true,
      statut: true,
      membres: { where: { user: { service: false } }, select: { user: { select: { id: true, prenom: true, nom: true } } } },
      sessions: {
        orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
        select: {
          id: true,
          date: true,
          heureDebut: true,
          heureFin: true,
          lieu: true,
          annulee: true,
          motifAnnulation: true,
          parties: {
            // Triées **par la base** : l'ordre des parties est une donnée de la séance, pas une
            // mise en forme de la grille — les écrans le reçoivent déjà juste.
            orderBy: { ordre: "asc" },
            select: {
              id: true,
              ordre: true,
              libelle: true,
              estOption: true,
              instructeurId: true,
              instructeurSecondId: true,
              theme: true,
              description: true,
              niveau: true,
              updatedAt: true,
              instructeur: { select: { prenom: true, nom: true } },
              instructeurSecond: { select: { prenom: true, nom: true } },
              atelier: { select: { id: true, titre: true, materiel: true } },
              modifiePar: { select: { prenom: true, nom: true } },
            },
          },
          /*
           * **Deux colonnes suffisent — mais seulement pour les invités de la période**.
           *
           * Cette lecture n'avait aucun filtre, alors que le dénominateur, lui, en a un
           * (`periode.membres`, `service: false`). Numérateur et dénominateur ne portaient donc pas
           * sur les mêmes personnes : `Attendance` pend à `User` et à `Session`, jamais à
           * `PeriodMember`, si bien qu'une réponse laissée par quelqu'un sorti du trimestre — ou le
           * compte de service du portail — comptait dans le chiffre **et** disparaissait de la
           * liste des noms, qui est filtrée juste en dessous. La grille annonçait « 12 / 12, 100 % »
           * au-dessus de onze noms, pendant que la fiche de la même séance, le tableau de bord et la
           * page publique disaient « 11 / 12 ».
           *
           * C'était le **cinquième** compteur du dossier à compter sans filtre ; les quatre autres
           * (carte de séance, tableau de bord, page publique, alerte d'effectif) ont été corrigés
           * les 29 et 30/09, et la docstring de `retirerMembrePeriode` annonçait déjà que le même
           * écart se propageait « au planning ». Il n'y avait pas suivi.
           *
           * **Le filtre est l'appartenance à la période, jamais la date d'arrivée** : le remplissage
           * d'une séance est un fait de la salle, pas un compte de personne. Borner à l'arrivée ferait
           * dire « 7 présents » au planning là où la fiche du même cours en montre 8 — le même défaut
           * déplacé d'un cran.
           */
          attendances: { where: { user: { service: false, periodes: { some: { periodId } } } }, select: { userId: true, statut: true } },
        },
      },
    },
  });
  if (!periode) return null;
  // Appartenance vérifiée ici, pas seulement par l'appelant : un identifiant de période recopié
  // dans l'URL ne doit rien ouvrir. La page affiche alors son état « rien à voir ».
  // (Pas de requête de plus : les invités de la période sont déjà dans `periode.membres`.)
  if (!isStaff(user) && !periode.membres.some((m) => m.user.id === user.id)) return null;

  const modifiable = can(user, "planning.edit") && periode.statut !== "CLOSE";
  const peutProgrammer = can(user, "ateliers.moderate") && periode.statut !== "CLOSE";
  // Les listes de *choix* — l'annuaire du club (prénom, nom, rôle) et les ateliers en attente avec
  // le nom de leur proposant — ne servent qu'à remplir une case. Qui ne peut pas écrire ne les reçoit
  // pas : sinon elles partiraient quand même dans la charge de la page, alors que `members.view` est
  // réservée au bureau. Les noms déjà posés dans les cases, eux, restent lisibles par tout le monde.
  const peutEcrire = modifiable || peutProgrammer;
  /*
   * Les personnes **déjà posées** sur une case de ce trimestre, lues dans ce qu'on vient de charger :
   * aucune requête de plus. Elles entrent dans la liste déroulante même si elles ne sont pas (ou
   * plus) instructrices, sans quoi leur case n'aurait plus d'entrée à sa valeur — et le premier
   * enregistrement l'effacerait (voir `personnesPlanning`).
   */
  const dejaPosees = periode.sessions.flatMap((s) =>
    s.parties.flatMap((p) => [p.instructeurId, p.instructeurSecondId].filter((id): id is string => Boolean(id))),
  );
  const [personnes, themes, ateliers] = await Promise.all([
    peutEcrire ? personnesPlanning(dejaPosees) : [],
    getThemes(),
    peutEcrire
      ? db.atelier.findMany({
          where: { statut: "PROPOSE", partie: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, titre: true, sessionId: true, proposePar: { select: { prenom: true, nom: true } } },
        })
      : [],
  ]);
  const nomParId = new Map(periode.membres.map((m) => [m.user.id, `${m.user.prenom} ${m.user.nom}`]));

  const colonnes: ColonnePlanning[] = periode.sessions.map((s) => {
    // Les rangs par nature, comptés sur la séance entière et **avant** tout filtre d'affichage : la
    // grille cache les parties vides aux membres, et les recompter là donnerait le rang 1 au second
    // cours (même règle, même fonction que `programmeDepuisParties`). Les parties arrivent déjà
    // triées par `ordre` (`include` de la requête), donc l'index suffit.
    const rangs = rangsDansNature(s.parties);
    const parties: CasePlanning[] = s.parties.map((p, i) => ({
      id: p.id,
      ordre: p.ordre,
      rang: rangs[i],
      libelle: p.libelle,
      estOption: p.estOption,
      instructeurId: p.instructeurId,
      instructeur: p.instructeur ? `${p.instructeur.prenom} ${p.instructeur.nom}` : null,
      instructeurSecondId: p.instructeurSecondId,
      instructeurSecond: p.instructeurSecond ? `${p.instructeurSecond.prenom} ${p.instructeurSecond.nom}` : null,
      theme: p.theme,
      description: p.description,
      niveau: niveauAffiche(p.niveau) ?? NIVEAU_DEFAUT,
      atelier: p.atelier,
      modifiePar: p.modifiePar ? `${p.modifiePar.prenom} ${p.modifiePar.nom}` : null,
      modifieLe: p.updatedAt.toISOString(),
    }));
    return {
      id: s.id,
      date: s.date,
      heureDebut: s.heureDebut,
      heureFin: s.heureFin,
      lieu: s.lieu,
      annulee: s.annulee,
      motifAnnulation: s.motifAnnulation,
      commencee: seanceCommencee(s.date, s.heureDebut, now),
      mois: s.date.slice(0, 7),
      parties,
      compteurs: compterPresences(
        s.attendances.map((a) => a.statut),
        periode.membres.length,
      ),
      presents: s.attendances
        .filter((a) => a.statut === "PRESENT")
        .map((a) => nomParId.get(a.userId) ?? "")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "fr")),
    };
  });

  const mois: Planning["mois"] = [];
  for (const c of colonnes) {
    const dernier = mois[mois.length - 1];
    if (dernier && dernier.cle === c.mois) dernier.nombre++;
    else mois.push({ cle: c.mois, label: nomMois(c.mois), nombre: 1 });
  }

  return {
    periode: { id: periode.id, nom: periode.nom, dateDebut: periode.dateDebut, dateFin: periode.dateFin, statut: periode.statut },
    colonnes,
    mois,
    personnes,
    themes,
    ateliersDisponibles: ateliers.map((a) => ({ id: a.id, titre: a.titre, sessionId: a.sessionId, proposePar: `${a.proposePar.prenom} ${a.proposePar.nom}` })),
    modifiable,
    peutProgrammer,
  };
}

/**
 * **Une case est vide quand elle n'a rien à dire** : ni encadrant, ni thème, ni description, ni
 * atelier, ni niveau annoncé. Une seule définition, ici, pour les écrans comme pour le serveur —
 * c'est elle qui décide qu'un atelier peut venir se poser dans une partie, et qu'une séance est
 * « sans programme ».
 *
 * Le niveau en fait partie, et la description aussi : quelqu'un qui n'a écrit qu'une phrase sur ce
 * qu'on va travailler a bel et bien rempli sa case, et elle ne doit pas se faire prendre par le
 * premier atelier venu — il l'effacerait.
 *
 * Les cinq réglages sont pesés par `reglagesVides` (`src/components/planning/options.ts`), module
 * pur que le navigateur peut lire lui aussi : c'est la **même** définition qui décide ce que l'écran
 * propose et ce que le serveur accepte.
 */
export function caseVide(c: Pick<CasePlanning, "instructeur" | "instructeurSecond" | "theme" | "description" | "atelier" | "niveau">): boolean {
  return reglagesVides(c) && !c.atelier;
}

/** Une ligne du programme d'une séance, pour la carte Présences et la page de gestion. */
export type LigneProgrammeSeance = Pick<
  CasePlanning,
  "id" | "ordre" | "libelle" | "estOption" | "instructeur" | "instructeurId" | "instructeurSecond" | "instructeurSecondId" | "theme" | "description" | "niveau"
> & {
  atelier: { id: string; titre: string } | null;
  /**
   * **Rang de la partie parmi celles de même nature** (2e cours, 1ère option), à partir de 1 —
   * compté sur la séance **entière**, avant que les parties muettes ne soient écartées.
   *
   * Il voyage avec la ligne au lieu d'être recalculé à l'affichage, et c'est tout l'objet du
   * champ : qui le recalcule sur la liste rendue ici compte sur une liste **déjà filtrée** et se
   * trompe. Le cas se produit à chaque séance neuve : quatre parties naissent avec le modèle,
   * l'encadrement ne remplit que « Cours n°2 » et « 2e option », les deux premières restent muettes
   * et disparaissent — l'accueil écrivait alors « 1ʳᵉ » à côté du libellé « Cours n°2 » et « Opt
   * 1 » à côté de « 2e option ». Deux mentions du même objet, deux nombres différents, lus à la
   * suite par la synthèse vocale.
   */
  rang: number;
};

export type ProgrammeSeance = LigneProgrammeSeance[];

/**
 * Le programme lisible d'une séance : les parties dans leur ordre, **les muettes écartées**.
 *
 * C'est ce filtre — et lui seul — qui définit « Sans programme » sur l'accueil : une partie qui n'a
 * ni encadrant, ni thème, ni atelier n'apprend rien à personne, et une séance neuve en porte quatre
 * d'office depuis qu'elles naissent avec le modèle. Les afficher toutes remplirait chaque fiche de
 * quatre lignes vides.
 *
 * Le niveau, lui, ne suffit pas à faire parler une partie : « Débutant » sans thème ni encadrant ne
 * dit rien au lecteur d'une fiche (à la différence d'une case du planning, qu'il ne faut pas
 * écraser — voir `caseVide`). La **description**, si : une phrase sur ce qu'on va travailler est
 * exactement ce qu'un membre vient lire, et la taire parce que le thème n'est pas encore choisi
 * serait perdre le seul renseignement disponible.
 */
export function programmeDepuisParties(
  // `niveau` facultatif : une case lue par une requête écrite avant ce champ (ou un jeu d'essai) ne
  // le porte pas, et son absence vaut « indifférent » — exactement ce que dit la colonne en base.
  parties: Array<{
    id: string;
    ordre: number;
    libelle: string;
    estOption: boolean;
    theme: string;
    /** Facultatif pour la même raison que `niveau` : une requête écrite avant ce champ ne le porte pas. */
    description?: string | null;
    niveau?: string | null;
    instructeurId: string | null;
    instructeur: { prenom: string; nom: string } | null;
    instructeurSecondId?: string | null;
    instructeurSecond?: { prenom: string; nom: string } | null;
    atelier: { id: string; titre: string } | null;
  }>,
): ProgrammeSeance {
  const ordonnees = [...parties].sort((a, b) => a.ordre - b.ordre);
  /*
   * **Les rangs se comptent ici, sur la séance entière, et jamais après le filtre.**
   *
   * C'est la seule place où la séance est encore complète : deux lignes plus bas, les parties
   * muettes ont disparu, et compter sur ce qui reste donne « 1ʳᵉ » en face de « Cours n°2 ». Le rang
   * part donc avec la ligne (voir `LigneProgrammeSeance.rang`) au lieu d'être redérivé à l'écran.
   */
  const rangs = rangsDansNature(ordonnees);
  return ordonnees
    .map((c, i) => ({
      id: c.id,
      ordre: c.ordre,
      rang: rangs[i],
      libelle: c.libelle,
      estOption: c.estOption,
      instructeur: c.instructeur ? `${c.instructeur.prenom} ${c.instructeur.nom}` : null,
      instructeurId: c.instructeurId,
      instructeurSecond: c.instructeurSecond ? `${c.instructeurSecond.prenom} ${c.instructeurSecond.nom}` : null,
      instructeurSecondId: c.instructeurSecondId ?? null,
      theme: c.theme,
      description: (c.description ?? "").trim(),
      niveau: niveauAffiche(c.niveau) ?? NIVEAU_DEFAUT,
      atelier: c.atelier,
    }))
    // Une description seule fait parler la partie : c'est précisément ce qu'elle est là pour dire.
    .filter((c) => c.instructeur || c.instructeurSecond || c.theme.trim() || c.description || c.atelier);
}

/**
 * Recopie le contenu des cases dans la séance : `disciplines` = thèmes distincts (ordre des
 * parties), instructeurs = personnes distinctes, **celui qui mène et celui qui assiste**. Ainsi
 * cartes, exports et récaps restent alimentés sans requête supplémentaire.
 *
 * Le second instructeur entre dans `SessionInstructeur` par la même porte que le premier : il
 * encadre la séance, donc il reçoit ce que reçoit l'encadrement (l'alerte « peu de monde », le récap
 * du soir). C'est un mouvement **interne** — rien de tout cela ne sort vers le public.
 */
export async function synchroniserSeance(sessionId: string): Promise<void> {
  const parties = await db.sessionPartie.findMany({
    where: { sessionId },
    orderBy: { ordre: "asc" },
    select: { theme: true, instructeurId: true, instructeurSecondId: true },
  });
  const themes = [...new Set(parties.map((p) => p.theme.trim()).filter(Boolean))];
  // Celui qui mène avant celui qui assiste, partie par partie : l'ordre n'a pas d'effet visible
  // aujourd'hui, mais un ordre stable rend la table relisible et les tests lisibles.
  const instructeurs = [...new Set(parties.flatMap((p) => [p.instructeurId, p.instructeurSecondId]).filter((id): id is string => !!id))];
  await db.$transaction([
    db.session.update({ where: { id: sessionId }, data: { disciplines: themes.join(",") } }),
    db.sessionInstructeur.deleteMany({ where: { sessionId } }),
    db.sessionInstructeur.createMany({ data: instructeurs.map((userId) => ({ sessionId, userId })) }),
  ]);
}

/**
 * **Ranger les parties d'une séance : les rangs contigus, et les noms d'accord avec eux.**
 *
 * Les deux invariants d'une séance tiennent ici, et **nulle part ailleurs** :
 *
 * 1. `ordre` redevient **contigu à partir de 0**. Sans cette renumérotation, les rangs finiraient
 *    troués (0, 1, 3) puis dupliqués, et c'est alors l'ordre d'insertion en base — c'est-à-dire le
 *    hasard — qui déciderait de l'affichage.
 * 2. `libelle` redit le **rang dans sa nature** (`libellePartie`) : « Cours 1 », « Cours 2 »…, «
 *    Option 1 », « Option 2 »… Depuis que le nom ne se saisit plus, il n'a plus de raison d'être vrai
 *    tout seul : ajouter, retirer, déplacer une partie ou changer sa nature décale l'une des deux
 *    séries, et c'est cette fonction qui remet la colonne d'accord.
 *
 * **Les deux dans la même fonction, et c'est voulu** : le libellé dépend du rang *final*, celui que
 * la renumérotation vient de décider. Deux fonctions séparées obligeraient la seconde à refaire le
 * calcul de la première — donc à s'en écarter un jour. Et une partie qui change à la fois de rang et
 * de nom ne coûte ainsi **qu'une seule écriture**.
 *
 * **On n'émet une écriture que pour ce qui change vraiment**, champ par champ. C'est la règle
 * commune aux renumérotations et aux migrations de libellés : `SessionPartie.updatedAt` est un
 * `@updatedAt`, et la grille affiche ce champ dans la bulle « Modifié par … le … » de chaque case,
 * avec `modifieParId` inchangé. Réécrire toute la séance ferait donc dire à une case que la personne
 * qui l'a remplie le 12 septembre y est revenue le 30 à 20h14 — elle n'a rien fait ce soir-là.
 * Ranger une séance n'est pas une modification du programme par quelqu'un.
 *
 * **Et ce filtre ne suffisait pas**. Depuis que le nom suit le rang, ranger une séance réécrit
 * vraiment les **voisines** : un « Option » cliqué sur « Cours 1 » renomme « Cours 2 » et « Option
 * 1 », dont l'`updatedAt` passait alors à l'instant du clic — pendant que `modifieParId` continuait
 * de nommer celui qui les avait remplies la semaine d'avant. La bulle de la case de Charlie annonçait
 * « Modifié par Charlie à 20:14 », et Chloé, qui venait de cliquer, n'apparaissait nulle part. Le
 * mensonge avait seulement déménagé : de « toute la séance » vers « les voisines dont le nom
 * glisse ».
 *
 * **Le choix : ranger ne touche plus `updatedAt` du tout.** Chaque écriture émise ici renvoie
 * l'horodatage que la ligne portait déjà — Prisma respecte une valeur explicite, même sur un
 * `@updatedAt`. C'est l'esprit des migrations qui réparent des rangs (« `updatedAt` n'est
 * volontairement pas touché : réparer un rang n'est pas une modification du programme par
 * quelqu'un »), et c'est le seul des deux choix qui tient pour un **voisin** : porter l'auteur à sa
 * place ferait écrire le nom de Chloé sur une case qu'elle n'a jamais remplie, et ferait perdre le
 * seul renseignement que la bulle donne — qui a écrit ce qui y est. Ce qui a vraiment changé (le
 * rang) est un geste sur la **séance**, et il se lit dans le journal d'audit, qui le nomme
 * (`planning.partie.ordre`, `planning.partie.nature`). Conséquence assumée : la case qu'on vient de
 * déplacer ne repeint pas sa bulle non plus — c'est sa place qui a bougé, pas son contenu. La partie
 * dont on change la **nature**, elle, est marquée par `changerNaturePartie` lui-même : ce clic-là
 * porte bien sur cette partie-là.
 *
 * La fonction rend les écritures à faire : l'appelant les glisse dans **sa** transaction, pour qu'on
 * ne puisse jamais lire une séance à moitié rangée. Le client est un paramètre parce que les deux
 * formes de transaction Prisma en ont besoin : le tableau d'écritures (`db`, pour le retrait et le
 * déplacement) et la fonction qui reçoit le client (`tx`, pour l'ajout, qui doit relire la séance à
 * l'intérieur de la transaction). Elle vit ici, avec les autres invariants du planning, et non dans
 * les actions : `placerAtelier` en a besoin aussi, et l'importer depuis les actions ferait un cycle.
 *
 * Le **calcul**, lui, vit dans `src/components/planning/rangement.ts` — module sans Prisma, pour que
 * le script de réparation puisse relever les deux invariants sans ouvrir de base. Ici, il ne reste
 * que le passage à l'écriture.
 *
 * Le tri est fait **ici** sur `ordre`, ce qui laisse l'appelant exprimer un déplacement par un rang
 * **intercalaire** (`vers ± 0,5`) plutôt que par un tableau déjà réordonné — voir `deplacerPartie`.
 */
export function rangerParties<R>(
  parties: ReadonlyArray<PartieARanger>,
  client: { sessionPartie: { update: (args: { where: { id: string }; data: RangementPartie["data"] }) => R } },
): R[] {
  return rangementsParties(parties).map((r) => client.sessionPartie.update({ where: { id: r.id }, data: r.data }));
}

/**
 * **Les parties d'une séance qui vient de naître** : le modèle du club (`PARTIES_MODELE`), rangé.
 *
 * Une séance naissait sans aucune ligne, et les quatre cases de la grille étaient dessinées par
 * l'écran. Maintenant que les parties sont des données, une séance vide serait une séance **sans
 * rien à remplir** : le modèle est donc posé en base à la création, comme la migration l'a fait
 * pour les séances qui existaient déjà.
 */
export function partiesInitiales(): Array<{ libelle: string; ordre: number; estOption: boolean }> {
  return PARTIES_MODELE.map((p, ordre) => ({ libelle: p.libelle, ordre, estOption: p.estOption }));
}

/** Ce qu'il faut savoir d'une partie pour décider si un atelier peut s'y poser. */
export type PartiePlacable = {
  id: string;
  ordre: number;
  estOption: boolean;
  instructeurId: string | null;
  instructeurSecondId?: string | null;
  theme: string;
  description?: string | null;
  niveau?: string | null;
  atelierId: string | null;
};

/**
 * **Une partie où un atelier peut se poser sans rien effacer** : aucun atelier, et aucun des cinq
 * réglages renseignés.
 *
 * C'est `caseVide` vue depuis la base — les mêmes champs, sous leur nom de colonne —, et c'est la
 * seule question que doivent poser les **deux** portes qui placent un atelier : le choix
 * automatique de la première option libre (`partieLibrePourAtelier`, ci-dessous) et la case
 * désignée à la main depuis la grille (`programmerAtelierDansCase`). La seconde ne la posait pas,
 * et posait donc un atelier par-dessus le travail de quelqu'un.
 */
export function partieLibre(p: PartiePlacable): boolean {
  return (
    !p.atelierId &&
    reglagesVides({ instructeur: p.instructeurId, instructeurSecond: p.instructeurSecondId, theme: p.theme, description: p.description, niveau: p.niveau })
  );
}

/**
 * **La première option libre** d'une séance, ou `null` si aucune ne l'est.
 *
 * L'ancienne règle retombait sur la 2nde partie quand les deux options étaient prises : elle n'a
 * plus de sens — « la 2nde partie » n'existe plus comme repère, et poser un atelier dans le cours
 * principal était de toute façon un choix que personne n'avait fait. Quand cette fonction rend
 * `null`, `placerAtelier` **crée une option de plus à la fin** : une séance a désormais la place.
 */
export function partieLibrePourAtelier(parties: readonly PartiePlacable[]): string | null {
  const libre =
    [...parties]
      .filter((p) => p.estOption)
      .sort((a, b) => a.ordre - b.ordre)
      .find(partieLibre) ?? null;
  return libre?.id ?? null;
}

/**
 * Place un atelier planifié dans le planning de sa séance (option libre, animateur = proposeur,
 * thème = titre). Rend la partie utilisée.
 *
 * **Plus jamais `null` faute de place** : quand aucune option n'est libre, on en ajoute une à la fin
 * de la séance. Un atelier validé par l'équipe doit se poser quelque part — le rendre invisible
 * parce que quatre cases étaient prises était un refus silencieux d'une décision déjà prise.
 * (`null` ne subsiste que pour une partie explicitement demandée qui n'existe plus.)
 */
export async function placerAtelier(atelierId: string, sessionId: string, acteurId: string, partieId?: string): Promise<{ id: string; libelle: string } | null> {
  const atelier = await db.atelier.findUniqueOrThrow({ where: { id: atelierId }, select: { titre: true, proposeParId: true } });
  const existantes = await db.sessionPartie.findMany({
    where: { sessionId },
    select: { id: true, ordre: true, estOption: true, instructeurId: true, instructeurSecondId: true, theme: true, description: true, niveau: true, atelierId: true },
  });
  let cible = partieId ?? partieLibrePourAtelier(existantes);
  if (partieId && !existantes.some((p) => p.id === partieId)) return null;
  if (!cible) {
    /*
     * **L'option de secours naît en queue d'une séance dont les rangs sont sains**, dans une seule
     * transaction. `ordre = existantes.length` était juste tant que les rangs étaient contigus — et
     * ils ne le sont pas toujours : une séance sortie de la migration pouvait porter 0, 2, 2, et la
     * nouvelle ligne serait venue s'asseoir sur un rang déjà pris. On renumérote donc l'existant en
     * même temps qu'on crée, et la relecture se fait **dans** la transaction : deux ateliers
     * programmés au même instant sur la même séance liraient sinon la même longueur.
     *
     * Pas de plafond ici, à la différence de `ajouterPartie` : un atelier validé par l'équipe doit
     * se poser quelque part, et cette création n'est pas une boucle ouverte sur le réseau — il faut
     * une décision de modération pour chaque atelier.
     */
    cible = await db.$transaction(async (tx) => {
      const parties = await tx.sessionPartie.findMany({ where: { sessionId }, select: { id: true, ordre: true, estOption: true, libelle: true, updatedAt: true } });
      const creee = await tx.sessionPartie.create({
        data: {
          sessionId,
          // Le nom que la ligne portera de toute façon après rangement (« Option 3 »…) : on le pose
          // à la création pour que `rangerParties` n'ait rien à réécrire dessus.
          libelle: prochainLibellePartie(parties, true),
          ordre: parties.length,
          estOption: true,
          modifieParId: acteurId,
        },
        select: { id: true },
      });
      for (const ecriture of rangerParties(parties, tx)) await ecriture;
      return creee.id;
    });
  }
  await db.$transaction([
    // L'atelier ne peut être que dans une seule case
    db.sessionPartie.updateMany({ where: { atelierId }, data: { atelierId: null } }),
    db.sessionPartie.update({
      where: { id: cible },
      // Le niveau repart à « indifférent » comme le reste : placer un atelier **remplace** le contenu
      // de la case, et garder le niveau du cours d'avant ferait porter à l'atelier une annonce que
      // personne n'a faite pour lui. Le second instructeur et la description partent pour la même
      // raison — une phrase qui décrivait le cours d'avant mentirait sur l'atelier qui prend sa place.
      data: {
        atelierId,
        instructeurId: atelier.proposeParId,
        instructeurSecondId: null,
        theme: atelier.titre,
        description: "",
        niveau: NIVEAU_DEFAUT,
        modifieParId: acteurId,
      },
    }),
  ]);
  await synchroniserSeance(sessionId);
  const posee = await db.sessionPartie.findUnique({ where: { id: cible }, select: { id: true, libelle: true } });
  return posee;
}

/**
 * Retire un atelier du planning (déprogrammation, refus) : **la case est vidée, pas supprimée**.
 *
 * Elle était effacée — et la partie disparaissait de la séance avec elle. Depuis que les parties
 * sont des données que l'équipe range elle-même, un refus d'atelier n'a aucune raison de défaire le
 * programme : la ligne reste, vide, prête à recevoir autre chose. Retirer une partie est un autre
 * geste, qui se demande (`retirerPartie`).
 */
export async function retirerAtelier(atelierId: string): Promise<void> {
  const cases = await db.sessionPartie.findMany({ where: { atelierId }, select: { id: true, sessionId: true } });
  if (cases.length === 0) return;
  await db.sessionPartie.updateMany({
    where: { atelierId },
    data: { atelierId: null, instructeurId: null, instructeurSecondId: null, theme: "", description: "", niveau: NIVEAU_DEFAUT },
  });
  for (const c of new Set(cases.map((c) => c.sessionId))) await synchroniserSeance(c);
}
