import type { NomIcone } from "@/components/ui/Icone";
import { libelleDuree, libellePrix } from "@/components/evenements/libelles";
import { niveauAffiche, NIVEAU_DEFAUT, type NatureElement, type Niveau } from "./constants";
import { teintesProgramme, type Teinte } from "@/components/seances/teintes";
import { formatDateLongue, formatHeure, formatHoraire, todayIso } from "./dates";
import { db } from "./db";
// La liste des thèmes de cours du club : la teinte d'un élément qui n'en a pas encore s'en déduit.
import { getThemes } from "./planning";
import { evenementParId, evenementTermine } from "./evenements";
import {
  elementsRanges,
  ligneChiffres,
  lignesSeance,
  separerPictogramme,
  themeSeance,
  TITRE_ANNULATION,
  type ChiffresSeance,
  type SeanceResume,
} from "./notifications/contenu";
import { compteursDepuisTotaux, cumulerTotaux, type Compteurs, type TotauxStatuts } from "./presences";
import { minuscule } from "@/lib/dates";

/**
 * **Partage public** (`/partage/seance/<id>`, `/partage/planning/<periodId>`) : le résumé d'une
 * séance ou d'une période, lisible **sans connexion**, destiné à être collé dans WhatsApp, Signal,
 * Discord ou n'importe quel réseau.
 *
 * Deux règles tiennent tout ce module :
 *
 * 1. **Aucune donnée nominative, jamais.** Les requêtes ne chargent même pas les colonnes qui
 *    porteraient un nom : les présences ne remontent pas du tout — seulement leurs **totaux**,
 *    agrégés en base —, et les cases du planning ne donnent que leur thème et le titre de leur
 *    atelier, jamais l'animateur. Ce qui n'est pas sélectionné ne peut pas fuir par mégarde dans
 *    une future mise en forme. Ce qui sort d'une case, c'est son titre, son niveau et sa description —
 *    des textes sur le *contenu* du cours, qui ne nomment personne.
 * 2. **Une seule mise en forme**, celle des notifications (`src/lib/notifications/contenu.ts`), déjà
 *    utilisée par l'email de récap et l'embed Discord. Les pages publiques ne réécrivent pas le
 *    résumé : elles reprennent ses lignes et remplacent simplement chaque pictogramme par l'icône
 *    SVG correspondante (l'interface de l'application est sans emoji). Les métadonnées d'aperçu,
 *    elles, gardent les pictogrammes : c'est le texte que le club envoie déjà sur ses réseaux.
 */

/**
 * Une case du programme, réduite à ce qui est publiable : le titre, le niveau annoncé et la
 * description, **jamais l'animateur**.
 *
 * Le niveau ne désigne personne — il dit à qui le cours s'adresse, ce qui est exactement ce qu'un
 * lecteur du dehors vient chercher — et sort donc comme le thème. **La description aussi** : c'est
 * un texte sur le contenu du cours, de la même nature que le thème, et publier « Épée longue » sans
 * la phrase qui dit ce qu'on y fera reviendrait à couper l'annonce en deux. Le code n'y ajoute
 * **aucun nom** : ni celui qui mène, ni celui qui assiste, ni personne — et l'écran de saisie
 * annonce la publication à qui écrit (`CaseEditeur`), comme la règle du dossier l'exige.
 *
 * **Rangée dans sa partie** : `bloc` est le numéro de la partie, `nature` ce qu'est
 * l'élément, `nom` son nom court dans la partie (« Échauffement », « Cours 2 ») — calculés, jamais
 * saisis, comme `libelle` (« Partie 1 · Cours »), que l'API publique continue de publier.
 */
export type CasePartage = {
  ordre: number;
  bloc: number;
  nature: NatureElement;
  nom: string;
  /**
   * Teinte du cours ou de l'option (`teintesProgramme`), `null` pour un échauffement ou un atelier —
   * comptée sur la séance entière, avant le filtre des cases sans titre. Un repère d'affichage : l'API
   * publique ne la recopie pas (`versSeancePublique`, liste blanche).
   */
  teinte: Teinte | null;
  libelle: string;
  theme: string;
  description: string;
  niveau: Niveau;
  atelier: boolean;
};


export type SeancePartagee = SeanceResume & {
  id: string;
  adresse: string;
  annulee: boolean;
  motifAnnulation: string | null;
  compteurs: Compteurs;
  programme: CasePartage[];
  periode: { id: string; nom: string; statut: string };
};

export type PlanningPartage = {
  periode: { id: string; nom: string; statut: string; dateDebut: string; dateFin: string };
  /** Séances d'aujourd'hui et à venir (les plus proches d'abord), écrêtées à `MAX_SEANCES_PLANNING` */
  seances: SeancePartagee[];
  /** Nombre total de séances à venir, avant écrêtage */
  total: number;
};

export const MAX_SEANCES_PLANNING = 12;

/* ------------------------------------------------------------------ */
/* Mise en forme (fonctions pures)                                     */
/* ------------------------------------------------------------------ */

export type LigneResume = { icone: NomIcone; texte: string };

/** Pictogramme du contenu commun → icône du jeu de l'application (aucun emoji dans l'interface). */
const ICONES: Record<string, NomIcone> = {
  "📅": "calendrier",
  "📍": "lieu",
  "📖": "livre",
  "✅": "groupe",
  "❌": "interdit",
  "💬": "info",
};

/**
 * Sépare une ligne du contenu commun de son pictogramme de tête : « 📍 Villebourg » → icône `lieu` + « Villebourg ».
 * C'est le seul point de contact entre la mise en forme partagée et l'affichage web.
 *
 * Le découpage lui-même vit dans `contenu.ts` (`separerPictogramme`) : l'API publique en a besoin
 * aussi, et une seconde copie de l'expression régulière aurait fini par dériver de celle-ci.
 */
export function ligneSansPictogramme(ligne: string): LigneResume {
  const { picto, texte } = separerPictogramme(ligne);
  return { icone: (picto && ICONES[picto]) || "info", texte };
}

/** Chiffres globaux d'une séance, au format attendu par le contenu commun. */
export function chiffres(s: Pick<SeancePartagee, "compteurs">): ChiffresSeance {
  return { presents: s.compteurs.presents, invites: s.compteurs.invites };
}

/**
 * Les lignes du résumé public, dans l'ordre du contenu commun (date + horaire, lieu, thème, chiffres).
 * Une séance annulée remplace les chiffres — qui ne veulent plus rien dire — par son motif.
 */
export function lignesResume(s: SeancePartagee): LigneResume[] {
  const lignes = lignesSeance(s, chiffres(s)).map(ligneSansPictogramme);
  if (!s.annulee) return lignes;
  return [
    ...lignes.filter((l) => l.icone !== "groupe"),
    { icone: "interdit", texte: `Motif : ${s.motifAnnulation?.trim() || "non précisé"}` },
  ];
}

/** Titre du résumé : la première ligne du contenu commun (date en toutes lettres + horaire). */
export function titreResume(s: SeanceResume): string {
  return `${formatDateLongue(s.date)} — ${formatHoraire(s.heureDebut, s.heureFin)}`;
}

/** Libellé d'une séance annulée, repris du contenu commun (« Cours annulé »). */
export const LIBELLE_ANNULEE = ligneSansPictogramme(TITRE_ANNULATION).texte;

/**
 * Description d'aperçu (Open Graph, Twitter Card) d'une séance : les lignes du contenu commun,
 * pictogrammes compris — c'est exactement ce que le club poste déjà sur Discord et WhatsApp.
 */
export function descriptionSeance(s: SeancePartagee): string {
  // La date en toutes lettres est déjà le titre de l'aperçu : la description reprend la suite
  const lignes = lignesSeance(s, chiffres(s)).slice(1);
  if (!s.annulee) return lignes.join(" · ");
  return [
    TITRE_ANNULATION,
    ...lignes.filter((l) => ligneSansPictogramme(l).icone !== "groupe"),
    `💬 ${s.motifAnnulation?.trim() || "motif non précisé"}`,
  ].join(" · ");
}

/** Description d'aperçu d'une période : le nombre de séances à venir, puis le résumé de la prochaine. */
export function descriptionPlanning(p: PlanningPartage): string {
  const nb = p.total;
  const entete = nb === 0 ? "Aucune séance à venir" : `${nb} séance${nb > 1 ? "s" : ""} à venir`;
  const prochaine = p.seances[0];
  if (!prochaine) return `${entete} — période « ${p.periode.nom} ».`;
  return [`${entete} · Prochaine : ${titreResume(prochaine)}`, ...lignesSeance(prochaine, chiffres(prochaine)).slice(1)].join(" · ");
}

/**
 * Les chiffres globaux découpés pour l'image d'aperçu : le taux en gros, l'effectif en légende.
 * Les deux morceaux viennent de la ligne du contenu commun (« ✅ 13 présents / 18 — 72 % »).
 */
export function chiffresImage(s: SeancePartagee): { taux: string; effectif: string } {
  const [effectif, taux] = ligneSansPictogramme(ligneChiffres(chiffres(s))).texte.split(" — ");
  return { taux: taux ?? `${s.compteurs.pourcentage} %`, effectif };
}

/** Thème affiché (thème, disciplines du planning, et l'alternative éventuelle) : celui du contenu commun. */
export function themeAffiche(s: SeanceResume): string {
  return themeSeance(s);
}

/* ------------------------------------------------------------------ */
/* Lecture en base (strictement non nominative)                        */
/* ------------------------------------------------------------------ */

/**
 * Colonnes publiables d'une séance. Les cases du planning ne donnent que leur thème et le titre de
 * leur atelier (jamais l'instructeur ni l'animateur, jamais la personne qui a modifié la case), et
 * **aucune ligne de présence ne remonte** : les chiffres sont des totaux agrégés en base
 * (`chiffresPartage`), ce qui est encore moins que « le statut sans le nom ».
 */
const SELECT_PARTAGE = {
  id: true,
  date: true,
  heureDebut: true,
  heureFin: true,
  lieu: true,
  adresse: true,
  theme: true,
  alternative: true,
  disciplines: true,
  annulee: true,
  motifAnnulation: true,
  periodId: true,
  period: { select: { id: true, nom: true, statut: true } },
  parties: {
    select: { id: true, libelle: true, ordre: true, bloc: true, nature: true, teinte: true, theme: true, description: true, niveau: true, atelier: { select: { titre: true } } },
    orderBy: { ordre: "asc" },
  },
} as const;

type SeanceBrute = {
  id: string;
  periodId: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  adresse: string;
  theme: string;
  alternative: string;
  disciplines: string;
  annulee: boolean;
  motifAnnulation: string | null;
  period: { id: string; nom: string; statut: string };
  parties: Array<{ id: string; libelle: string; ordre: number; bloc: number; nature: string; teinte: number | null; theme: string; description: string; niveau: string; atelier: { titre: string } | null }>;
};

/**
 * Ordre du planning, cases vides écartées ; le titre d'un atelier remplace le thème.
 *
 * « Vide » veut dire **sans titre** : une case qui n'a ni thème ni atelier n'a rien à annoncer
 * dehors, même si quelqu'un y a écrit une description — celle-ci précise un cours, elle ne le
 * remplace pas, et une ligne qui n'aurait qu'elle se lirait comme un commentaire sans objet.
 *
 * Les parties arrivent déjà triées (`orderBy: { ordre }`) ; on retrie quand même (`elementsRanges` :
 * partie, nature, ordre), parce que c'est cette fonction — et non la requête — qui promet l'ordre à
 * qui lit `CasePartage[]`. Le rang et le nombre de chaque élément s'y comptent **avant** le filtre,
 * et sa teinte aussi.
 */
function programme(parties: SeanceBrute["parties"], themesClub: readonly string[]): CasePartage[] {
  const cases: CasePartage[] = [];
  const ranges = elementsRanges(parties);
  const teintes = teintesProgramme(ranges, themesClub).elements;
  for (const [i, c] of ranges.entries()) {
    const titre = (c.atelier?.titre ?? "").trim() || c.theme.trim();
    if (!titre) continue;
    cases.push({
      // **Aucun identifiant de ligne ici.** La case portait le `cuid` de sa `SessionPartie`,
      // recopié tel quel par l'API publique (`versSeancePublique`) dans une réponse non
      // authentifiée et mise en cache. C'est la règle que ce fichier applique déjà à l'identifiant
      // de séance, retiré de l'API : les pages de partage ne tiennent que sur la non-devinabilité
      // de leur adresse, et publier des identifiants internes est exactement ce qui les use. Rien
      // n'en avait besoin — la liste du programme est rendue par le serveur et prend son rang pour
      // clé.
      ordre: c.ordre,
      bloc: c.bloc,
      nature: c.nature,
      nom: c.nom,
      teinte: teintes[i],
      libelle: c.libelle,
      theme: titre,
      description: c.description.trim(),
      niveau: niveauAffiche(c.niveau) ?? NIVEAU_DEFAUT,
      atelier: Boolean(c.atelier),
    });
  }
  return cases;
}

function versPartage(s: SeanceBrute, invites: number, totaux: TotauxStatuts, themesClub: readonly string[]): SeancePartagee {
  return {
    id: s.id,
    date: s.date,
    heureDebut: s.heureDebut,
    heureFin: s.heureFin,
    lieu: s.lieu,
    adresse: s.adresse,
    theme: s.theme,
    alternative: s.alternative,
    disciplines: s.disciplines,
    annulee: s.annulee,
    motifAnnulation: s.motifAnnulation,
    compteurs: compteursDepuisTotaux(totaux, invites),
    programme: programme(s.parties, themesClub),
    periode: s.period,
  };
}

/**
 * **Les chiffres d'un lot de séances : numérateur et dénominateur comptés sur les mêmes personnes.**
 *
 * Dénominateur : les membres invités sur la période, **compte de service exclu** — exactement la
 * règle des écrans de l'application (`src/lib/seances.ts`), pour que le chiffre partagé soit le même
 * que celui affiché aux membres.
 *
 * Numérateur : les présences **de ces mêmes invités**, agrégées en base. Il se comptait sur toutes
 * les lignes de présence de la séance, sans regarder l'appartenance : une réponse laissée derrière
 * par quelqu'un retiré de la période restait dans le total, et la page publique comme l'API du site
 * annonçaient « 19/18 » et des taux au-dessus de 100 %.
 *
 * Le regroupement se fait **par période** parce que c'est la période qui définit l'appartenance :
 * les prochaines séances publiques peuvent en croiser plusieurs, et une seule requête pour tout le
 * lot compterait un invité d'un trimestre dans le taux d'un autre. En pratique le club n'a qu'une
 * période ouverte : deux requêtes, lancées ensemble.
 *
 * **Les deux moitiés sont séparées exprès** : le dénominateur ne dépend que de la *période*, le
 * numérateur des *séances*. Un appelant qui connaît déjà sa période (`planningPartage`) peut donc
 * lancer le dénominateur dans le même `Promise.all` que la requête des séances, au lieu de
 * l'attendre derrière elle — c'est ce que faisait le code avant que les deux soient réunis ici.
 */
async function chiffresPartage(sessions: Array<{ id: string; periodId: string }>): Promise<{
  invites: Map<string, number>;
  totaux: Map<string, TotauxStatuts>;
}> {
  const [invites, totaux] = await Promise.all([
    invitesParPeriode(sessions.map((s) => s.periodId)),
    totauxParSeance(sessions),
  ]);
  return { invites, totaux };
}

/** Dénominateur : les membres invités sur ces périodes, compte de service exclu. */
async function invitesParPeriode(periodIds: readonly string[]): Promise<Map<string, number>> {
  const uniques = [...new Set(periodIds)];
  const nombres = await Promise.all(
    uniques.map((periodId) => db.periodMember.count({ where: { periodId, user: { service: false } } })),
  );
  return new Map(uniques.map((periodId, i) => [periodId, nombres[i]]));
}

/** Numérateur : les présences **des invités de la période**, agrégées en base, séance par séance. */
async function totauxParSeance(sessions: Array<{ id: string; periodId: string }>): Promise<Map<string, TotauxStatuts>> {
  const parPeriode = new Map<string, string[]>();
  for (const s of sessions) parPeriode.set(s.periodId, [...(parPeriode.get(s.periodId) ?? []), s.id]);
  const totaux = new Map<string, TotauxStatuts>();
  await Promise.all(
    [...parPeriode].map(async ([periodId, ids]) => {
      const groupes = await db.attendance.groupBy({
        by: ["sessionId", "statut"],
        where: { sessionId: { in: ids }, user: { service: false, periodes: { some: { periodId } } } },
        _count: { _all: true },
      });
      for (const g of groupes) cumulerTotaux(totaux, g.sessionId, g.statut, g._count._all);
    }),
  );
  return totaux;
}

/**
 * Statut d'une période qui n'a pas encore été ouverte au club. Rien de ce qu'elle contient n'est
 * publiable : le trimestre est en cours d'écriture, ses dates et ses lieux peuvent encore bouger.
 */
const PERIODE_BROUILLON = "BROUILLON";

/**
 * Résumé public d'une séance. Identifiant inconnu → `null` (la page affiche « Ce partage n'existe
 * pas »). Une séance d'une période close reste consultable : un lien partagé ne doit pas mourir.
 *
 * Une période en **brouillon**, elle, n'a jamais été annoncée : sa séance rend `null`, exactement
 * comme un identifiant inventé. C'est la règle des événements (`evenementPartage`), où seule une
 * annonce publiée se partage — publier par un lien ce que l'équipe n'a pas encore ouvert serait un
 * accident, pas un choix.
 */
export async function seancePartagee(id: string): Promise<SeancePartagee | null> {
  if (!id || id.length > 64) return null;
  const s = await db.session.findUnique({ where: { id }, select: SELECT_PARTAGE });
  if (!s || s.period.statut === PERIODE_BROUILLON) return null;
  const [{ invites, totaux }, themes] = await Promise.all([chiffresPartage([s]), getThemes()]);
  return versPartage(s, invites.get(s.periodId) ?? 0, totaux.get(s.id) ?? {}, themes);
}

/**
 * Résumé public d'une période : ses séances d'aujourd'hui et à venir, la plus proche en premier.
 * Les séances passées ne sont pas publiées — le partage sert à annoncer, pas à archiver.
 *
 * Même porte que pour une séance : un trimestre en brouillon rend `null`, un trimestre clos reste
 * consultable.
 */
export async function planningPartage(periodId: string, now = new Date()): Promise<PlanningPartage | null> {
  if (!periodId || periodId.length > 64) return null;
  const periode = await db.period.findUnique({
    where: { id: periodId },
    select: { id: true, nom: true, statut: true, dateDebut: true, dateFin: true },
  });
  if (!periode || periode.statut === PERIODE_BROUILLON) return null;
  const where = { periodId, date: { gte: todayIso(now) } };
  // Le dénominateur part **avec** la requête des séances : il ne dépend que de la période, qui est
  // l'argument de cette fonction. Seul le numérateur a besoin de savoir quelles séances sortent.
  const [total, sessions, invites] = await Promise.all([
    db.session.count({ where }),
    db.session.findMany({
      where,
      orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
      take: MAX_SEANCES_PLANNING,
      select: SELECT_PARTAGE,
    }),
    invitesParPeriode([periodId]),
  ]);
  const [totaux, themes] = await Promise.all([totauxParSeance(sessions), getThemes()]);
  return { periode, seances: sessions.map((s) => versPartage(s, invites.get(s.periodId) ?? 0, totaux.get(s.id) ?? {}, themes)), total };
}

/**
 * **Les prochaines séances du club**, toutes périodes actives confondues : la source de l'API
 * publique (`/api/public/prochaines-seances`), donc du site WordPress. Elle passe par les mêmes
 * colonnes que le partage — rien de nominatif n'est lu — et par le même calcul de taux que les
 * écrans de l'application, pour que le chiffre affiché sur le site soit celui du club.
 *
 * Les séances **annulées restent de la partie** : le site doit pouvoir écrire « annulé » plutôt
 * que de laisser quelqu'un traverser la Saône pour une salle fermée.
 */
export async function prochainesSeancesPubliques(limite: number, now = new Date()): Promise<SeancePartagee[]> {
  const sessions = await db.session.findMany({
    where: { date: { gte: todayIso(now) }, period: { statut: "ACTIVE" } },
    orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
    take: limite,
    select: SELECT_PARTAGE,
  });
  const [{ invites, totaux }, themes] = await Promise.all([chiffresPartage(sessions), getThemes()]);
  return sessions.map((s) => versPartage(s, invites.get(s.periodId) ?? 0, totaux.get(s.id) ?? {}, themes));
}

/* ------------------------------------------------------------------ */
/* Événements (stages, tournois, démonstrations)                       */
/* ------------------------------------------------------------------ */

/**
 * Un événement **réduit à ce qui est publiable**. Tout le reste de la ligne reste en base :
 * ni `creeParId` (qui a saisi l'annonce), ni `publie`, ni `lienSource`, ni `imageUrl` — recopier
 * un champ ici, c'est décider de le publier, et rien d'autre ne franchit cette porte.
 *
 * Le tarif et la durée en font partie : ce ne sont pas des données de personne, et ce sont les deux
 * questions qui suivent « c'est quand ? » chez qui découvre l'annonce par un lien partagé.
 */
export type EvenementPartage = {
  id: string;
  nom: string;
  description: string;
  dateDebut: string;
  heureDebut: string | null;
  dateFin: string | null;
  heureFin: string | null;
  lieu: string;
  adresse: string;
  /** Qui organise : le club, une association amie, une fédération */
  organisateur: string;
  /** Tarif en texte libre ("45 €") ; "" = gratuit, et la page le dit */
  prix: string;
  /** Tarif réduit pour les adhérents ; "" = il n'y en a pas, et la page n'en dit rien */
  prixAdherent: string;
  /** Nombre d'unités de durée ("2" de "2 jours") ; null = durée non précisée */
  dureeNombre: number | null;
  /** Unité de la durée : "demi-journee", "jour", "semaine" ou "mois" */
  dureeUnite: string;
  /** Lien d'inscription déjà filtré (http/https uniquement) ; "" s'il n'y en a pas */
  lienInscription: string;
  /** L'événement est passé — la page reste consultable, un lien partagé ne meurt pas */
  termine: boolean;
};

/** Ligne du résumé, avec le pictogramme qu'elle porte dans l'aperçu des réseaux sociaux. */
export type LigneEvenementPartage = LigneResume & { picto: string };

/** Coupe proprement un texte trop long pour un aperçu ou un titre de vignette. */
export function tronquer(texte: string, max: number): string {
  const t = (texte ?? "").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Un lien saisi par l'équipe n'est rendu que s'il est **http(s)** : une page publique ne relaie
 * pas un « javascript: » ni un « data: » arrivé par le formulaire d'annonce.
 */
export function lienExterneSur(url: string | null | undefined): string {
  try {
    const u = new URL((url ?? "").trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

/** « Samedi 10 octobre 2026 », ou « Du samedi 10 au dimanche 11 octobre 2026 ». */
export function dateEvenement(e: Pick<EvenementPartage, "dateDebut" | "dateFin">): string {
  if (!e.dateFin || e.dateFin === e.dateDebut) return formatDateLongue(e.dateDebut);
  return `Du ${minuscule(formatDateLongue(e.dateDebut))} au ${minuscule(formatDateLongue(e.dateFin))}`;
}

/** « 10h00 à 17h30 », « à partir de 19h30 », « jusqu'à 17h30 », ou "" (journée entière). */
export function horaireEvenement(e: Pick<EvenementPartage, "heureDebut" | "heureFin">): string {
  if (e.heureDebut && e.heureFin) return formatHoraire(e.heureDebut, e.heureFin);
  if (e.heureDebut) return `à partir de ${formatHeure(e.heureDebut)}`;
  if (e.heureFin) return `jusqu'à ${formatHeure(e.heureFin)}`;
  return "";
}

/**
 * Les lignes du résumé d'un événement : date, horaire, lieu, organisateur. Une seule construction
 * pour les deux usages — la page (icône + texte) et l'aperçu des réseaux (pictogramme + texte).
 * Le nom de la personne qui a saisi l'annonce n'en fait évidemment pas partie.
 */
export function lignesEvenement(e: EvenementPartage): LigneEvenementPartage[] {
  const lignes: LigneEvenementPartage[] = [{ icone: "calendrier", picto: "📅", texte: dateEvenement(e) }];
  const horaire = horaireEvenement(e);
  if (horaire) lignes.push({ icone: "horloge", picto: "🕒", texte: horaire });
  // Durée annoncée à la main : ce n'est pas un calcul sur les dates, et rien ne l'oblige à s'y
  // accorder. Non renseignée, la ligne disparaît — « non précisée » n'apprendrait rien à qui lit
  // l'annonce. Le mot « Durée : » est dans le texte parce que ces lignes voyagent aussi **sans
  // leur icône** (vignette d'aperçu, message WhatsApp), où « 2 jours » seul se lirait mal.
  const duree = libelleDuree(e.dureeNombre, e.dureeUnite);
  if (duree) lignes.push({ icone: "sablier", picto: "⏳", texte: `Durée : ${duree}` });
  if (e.lieu.trim()) lignes.push({ icone: "lieu", picto: "📍", texte: e.lieu.trim() });
  if (e.organisateur.trim()) lignes.push({ icone: "groupe", picto: "👥", texte: `Organisé par ${e.organisateur.trim()}` });
  // Le tarif, lui, est **toujours** annoncé : un champ vide veut dire gratuit, et c'est justement
  // ce qu'on vient vérifier avant de s'inscrire. Le mot « Gratuit » ne vit que dans l'affichage.
  lignes.push({ icone: "etiquette", picto: "🏷️", texte: libellePrix(e.prix, e.prixAdherent) });
  return lignes;
}

/** Longueur de l'extrait de description repris dans l'aperçu (les réseaux coupent au-delà). */
export const EXTRAIT_MAX = 180;

/** Description d'aperçu d'un événement : ses lignes, puis un extrait de l'annonce. */
export function descriptionEvenement(e: EvenementPartage): string {
  const extrait = tronquer(e.description.replace(/\s+/g, " "), EXTRAIT_MAX);
  return [...lignesEvenement(e).map((l) => `${l.picto} ${l.texte}`), ...(extrait ? [extrait] : [])].join(" · ");
}

/**
 * Résumé public d'un événement. **Seule une annonce publiée est partageable** : la règle est celle
 * de l'application (`evenementParId`), interrogée en lecteur anonyme explicite (`null`) — un
 * brouillon rend `null`, donc la page « Ce partage n'existe pas », jamais son contenu. Le second
 * contrôle sur `publie` est volontairement redondant : c'est la garantie qui ne dépend d'aucun appelant.
 */
export async function evenementPartage(id: string, now = new Date()): Promise<EvenementPartage | null> {
  if (!id || id.length > 64) return null;
  const e = await evenementParId(id, null);
  if (!e || !e.publie) return null;
  return {
    id: e.id,
    nom: e.nom,
    description: e.description,
    dateDebut: e.dateDebut,
    heureDebut: e.heureDebut,
    dateFin: e.dateFin,
    heureFin: e.heureFin,
    lieu: e.lieu,
    adresse: e.adresse,
    organisateur: e.organisateur,
    prix: e.prix,
    prixAdherent: e.prixAdherent,
    dureeNombre: e.dureeNombre,
    dureeUnite: e.dureeUnite,
    lienInscription: lienExterneSur(e.lienInscription),
    termine: evenementTermine(e, now),
  };
}
