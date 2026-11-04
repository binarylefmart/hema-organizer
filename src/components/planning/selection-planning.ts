import { AJOUT_NATURE, LIBELLE_VIDE, NIVEAU_DEFAUT, NOMS_NATURE, nomPartie, rangDefautNature, type NatureElement, type Niveau } from "@/lib/constants";
import { pluriel, type Explication } from "@/components/ui/choix-geste";
import { texteInviteMasse, type MotsLignes } from "@/components/ui/selection";
import { pairesEgales, type Paire } from "./file-envoi";
import { AUTRE } from "./options";
import type { EcritureEnMasse } from "./brouillon";
import { NATURES_AJOUTABLES, nombreDeParties, type NatureAjoutable } from "./parties-carte";
import { normaliserTheme, type Teinte } from "@/components/seances/teintes";

/**
 * **Agir sur plusieurs séances du planning à la fois** — la partie sans React ni base, donc testable.
 *
 * Le planning, en mode modification (ouvert par le bouton crayon), donne une case à chaque carte de
 * séance. La mécanique vient du module partagé
 * (`src/components/ui/selection.ts` : cocher, case maîtresse, raccourcis « Tous les mardis »), la
 * forme de la question de `ChoixGeste` ; **ce qui se duplique ici, ce sont les mots** du planning.
 *
 * Quatre gestes :
 *
 * - **régler des éléments** : on coche, parmi les noms calculés des séances cochées (« Partie 1 ·
 *   Échauffement », « Partie 1 · Cours », « Partie 2 · Option 2 »…), **un ou plusieurs** éléments, et
 *   chacun reçoit **ses** réglages — instructeur, second, thème (de la liste de sa nature), niveau,
 *   description, chacun facultatif (« Ne pas changer » par défaut). Un seul appui les pose tous, sur
 *   toutes les séances cochées qui portent ces éléments (demande de Delta : « aujourd'hui
 *   tu es obligé de répéter pour chaque cours ») ;
 * - **remplacer un thème** : un thème présent dans les séances cochées (« Messer — 5 éléments sur 3
 *   séances ») et son remplaçant, pris dans la liste du club de la bonne nature ; tous les éléments
 *   qui le portent (atelier excepté) reçoivent le nouveau ;
 *
 *   pour ces deux-là, **rien ne part** : les réglages entrent dans le brouillon, comme si chaque case
 *   avait été réglée à la main, et c'est « Appliquer » qui les enregistre
 *   (`enregistrerCases`, ses verrous, son tout-ou-rien, son journal — et la teinte, recalculée côté
 *   serveur pour chaque case dont le thème change) ;
 * - **ajouter un élément** — un échauffement, un cours ou une option — dans la partie choisie
 *   (1 à la dernière + 1) de chaque séance cochée : celui-là s'enregistre **tout de suite**, comme
 *   son jumeau de la carte (`ajouterPartiesEnMasse`) — un élément provisoire n'aurait pas
 *   d'identifiant à donner au brouillon. Les ateliers n'y sont pas : un atelier ne se pose qu'une
 *   fois, sur une séance, depuis sa carte.
 *
 * - **retirer un élément du programme** (« Partie 2 · Option ») de chaque séance cochée qui le porte :
 *   lui aussi s'enregistre **tout de suite**, après confirmation (`appliquerGesteSeancesEnMasse`,
 *   geste `retirer`). Une case occupée par un atelier n'est jamais retirée d'ici : elle se retire sur
 *   sa carte, et l'atelier retourne dans la file. Ce geste vivait dans la sélection de l'onglet
 *   Séances ; il est revenu ici avec les autres gestes du programme.
 */

/** Une partie d'une séance cochable, telle que la sélection la connaît. */
export type PartieLigne = {
  id: string;
  /** « Partie 1 · Cours » — le nom **calculé**, qui sert ici de clé de regroupement entre séances. */
  libelle: string;
  /** Numéro de la partie, à partir de 1. */
  bloc: number;
  nature: NatureElement;
  /** Rang dans sa nature et sa partie, à partir de 1 : l'ordre des noms proposés. */
  rang: number;
  /** Teinte du cours ou de l'option (`teintesProgramme`), pour que son écu ait la couleur du planning. */
  teinte?: Teinte | null;
  /** Un atelier occupe la case : elle ne se règle pas ici (le serveur la refuserait). */
  atelier: boolean;
  /** Ce que le serveur porte : le point de comparaison du brouillon. */
  serveur: Paire;
};

/**
 * Une séance cochable du planning. Une séance **annulée** n'en a pas — son programme est verrouillé
 * (`partiePourEcriture`) — et un trimestre clos n'ouvre pas le mode modification du tout.
 */
export type LignePlanning = {
  id: string;
  /** « AAAA-MM-JJ » : le jour de la semaine des raccourcis. */
  date: string;
  /** « mardi 6 octobre » : le nom de la case, et celui des séances citées. */
  jour: string;
  parties: PartieLigne[];
};

export type GestePlanning = "regler" | "remplacer" | "ajouter" | "retirer";

/** Ce que l'ajout en masse pose : une nature, dans une partie. */
export type ChoixAjout = { bloc: number; nature: NatureAjoutable };

/** Les mots de cet écran pour les phrases partagées (`texteHorsAffichage`). */
export const MOTS_PLANNING: MotsLignes = { singulier: "séance", pluriel: "séances", accord: "f" };

/** La phrase posée sous la case maîtresse tant que rien n'est coché (`texteInviteMasse`). */
export const INVITE_PLANNING = texteInviteMasse("régler des éléments, remplacer un thème, ajouter ou retirer un élément sur plusieurs séances à la fois");

const nbSeances = (n: number) => pluriel(n, "séance");
const nbElements = (n: number) => pluriel(n, "élément");
/** « 1 séance » / « les 6 séances » : le complément du bouton « Appliquer à… ». */
const aSeances = (n: number) => (n === 1 ? "à 1 séance" : `aux ${n} séances`);

/** Le libellé de la case maîtresse : les séances **affichées**, jamais « Tout ». */
export function libelleToutesSeancesPlanning(affichees: number): string {
  if (affichees === 0) return "Aucune séance à sélectionner";
  if (affichees === 1) return "Sélectionner la séance affichée";
  return `Sélectionner les ${affichees} séances affichées`;
}

/** Le second bouton, quand des cartes sont repliées : déplier et tout prendre en un geste. */
export function libelleAfficherEtSelectionnerPlanning(total: number): string {
  return `Afficher et sélectionner les ${total} séances`;
}

/** Ce que la barre dit en clair, et que la région vivante annonce. */
export function compteurPlanning(n: number): string {
  if (n === 0) return "";
  return n === 1 ? "1 séance sélectionnée" : `${n} séances sélectionnées`;
}

/**
 * Les séances annulées et les séances commencées n'ont pas de case : on le dit, sans quoi la case
 * maîtresse semble compter faux. Une séance commencée reste affichée (grisée) parmi les cours à
 * venir jusqu'au lendemain, mais son programme est verrouillé (`partiePourEcriture`).
 */
export function texteSansCasePlanning(annulees: number, commencees = 0): string | null {
  const phrases: string[] = [];
  if (annulees > 0)
    phrases.push(
      annulees === 1
        ? "1 séance annulée n'a pas de case : son programme ne se règle plus."
        : `${annulees} séances annulées n'ont pas de case : leur programme ne se règle plus.`,
    );
  if (commencees > 0)
    phrases.push(
      commencees === 1
        ? "1 séance commencée n'a pas de case : son programme ne se modifie plus."
        : `${commencees} séances commencées n'ont pas de case : leur programme ne se modifie plus.`,
    );
  return phrases.length > 0 ? phrases.join(" ") : null;
}

/* ------------------------------------------------------------------ */
/* Les gestes proposés                                                  */
/* ------------------------------------------------------------------ */

export type GestePlanningOffert = { geste: GestePlanning; libelle: string; nombre: number };

/** Les séances du lot qui portent au moins une partie réglable (sans atelier). */
function seancesReglables(lot: readonly LignePlanning[]): LignePlanning[] {
  return lot.filter((l) => l.parties.some((p) => !p.atelier));
}

/**
 * **Les gestes applicables au lot**, chacun avec le nombre de séances qu'il toucherait. Un geste à
 * zéro n'est pas proposé (« Régler des éléments (0 séance) » ne fait rien) : « Remplacer un thème »
 * n'apparaît donc que si au moins un élément réglable des séances cochées porte un thème — celui
 * du brouillon s'il y en a un, puisque c'est lui que la case montre.
 */
export function gestesPlanningApplicables(lot: readonly LignePlanning[], brouillon: ReadonlyMap<string, Paire> = new Map()): GestePlanningOffert[] {
  const offres: GestePlanningOffert[] = [];
  const reglables = seancesReglables(lot).length;
  if (reglables > 0) offres.push({ geste: "regler", nombre: reglables, libelle: `Régler des éléments (${nbSeances(reglables)})` });
  const avecTheme = lot.filter((l) => l.parties.some((p) => !p.atelier && themeActuel(p, brouillon) !== "")).length;
  if (avecTheme > 0) offres.push({ geste: "remplacer", nombre: avecTheme, libelle: `Remplacer un thème (${nbSeances(avecTheme)})` });
  if (lot.length > 0) offres.push({ geste: "ajouter", nombre: lot.length, libelle: `Ajouter dans une partie (${nbSeances(lot.length)})` });
  const avecRetirable = lot.filter((l) => l.parties.some(partieRetirable)).length;
  if (avecRetirable > 0) offres.push({ geste: "retirer", nombre: avecRetirable, libelle: `Retirer un élément du programme (${nbSeances(avecRetirable)})` });
  return offres;
}

/* ------------------------------------------------------------------ */
/* Retirer un élément du programme                                      */
/* ------------------------------------------------------------------ */

/** Une case occupée par un atelier ne se retire pas en masse : elle se retire sur sa carte. */
const partieRetirable = (p: PartieLigne) => !p.atelier;

/**
 * **Les éléments qu'on peut retirer du lot, par leur nom** (« Partie 2 · Option »), chacun avec le
 * nombre de séances cochées qui le portent — dans l'ordre de lecture des séances. Le nom est calculé
 * par la place de l'élément : retirer « Partie 2 · Option » retire, dans chaque séance, celui qui
 * occupe cette place (le serveur refait ce calcul, `retirerElementEnMasse`).
 */
export function elementsRetirablesPlanning(lot: readonly LignePlanning[]): Array<{ libelle: string; nombre: number }> {
  const comptes = new Map<string, number>();
  for (const l of lot) {
    for (const libelle of new Set(l.parties.filter(partieRetirable).map((p) => p.libelle))) comptes.set(libelle, (comptes.get(libelle) ?? 0) + 1);
  }
  return [...comptes].map(([libelle, nombre]) => ({ libelle, nombre }));
}

/** Les séances cochées qui portent cet élément, retirable : celles que le retrait touche. */
export function seancesARetirer(lot: readonly LignePlanning[], libelle: string): LignePlanning[] {
  if (!libelle) return [];
  return lot.filter((l) => l.parties.some((p) => partieRetirable(p) && p.libelle === libelle));
}

/** L'unique bouton du retrait : « Retirer de 3 séances ». */
export function libelleBoutonRetrait(n: number): string {
  return n === 0 ? "Retirer" : `Retirer de ${nbSeances(n)}`;
}

/** La question d'avant : ce qui disparaît, et que rien ne se récupère. */
export function confirmationRetrait(libelle: string, n: number, ecartees: number): string {
  return `Retirer « ${libelle} » de ${nbSeances(n)} ?${ecartees > 0 ? ` ${nbSeances(ecartees)} de la sélection ${ecartees > 1 ? "restent" : "reste"} de côté.` : ""} Rien ne se récupère.`;
}

/** Le retrait expliqué avant d'agir : quel élément, combien de séances, ce qui se perd. */
export function expliquerRetrait(lot: readonly LignePlanning[], libelle: string): Explication {
  const n = seancesARetirer(lot, libelle).length;
  const sans = libelle ? lot.length - n : 0;
  return {
    titre: libelle
      ? `« ${libelle} » disparaît du programme de ${n === 1 ? "la séance" : `${n} séances`}.`
      : "Choisis l'élément à retirer : il disparaît du programme de chaque séance cochée qui le porte.",
    phrases: [
      "Les parties suivantes se renumérotent, comme quand on retire un élément sur une carte. Ce qu'il portait (thème, instructeurs, description) est perdu, et reste lisible au journal. Le retrait s'enregistre tout de suite.",
      ...(sans > 0 ? [`${nbSeances(sans)} ne ${sans > 1 ? "portent" : "porte"} pas cet élément : rien n'y change.`] : []),
      "Un atelier placé sur une séance n'est jamais retiré d'ici : il se retire sur sa carte, et retourne alors dans la file des propositions.",
      "Les instructeurs reçoivent un seul message « Planning modifié » pour tout le lot.",
    ],
  };
}

/** Le thème que la case montre : celui du brouillon s'il y a lieu, sinon celui du serveur. */
function themeActuel(p: PartieLigne, brouillon: ReadonlyMap<string, Paire>): string {
  return (brouillon.get(p.id) ?? p.serveur).theme.trim();
}

/** Un élément proposé au réglage : son nom, et combien de séances cochées le portent. */
export type PartieProposee = { libelle: string; bloc: number; nature: NatureElement; rang: number; nombre: number };

/**
 * **Les éléments qu'on peut choisir** : ceux qui existent dans au moins une séance cochée, par leur
 * nom calculé (« Partie 1 · Cours »), partie par partie et, dans une partie, dans l'ordre par défaut
 * des natures (`ORDRE_DEFAUT_NATURES` : l'atelier avant l'option) puis des rangs. Les séances cochées
 * peuvent avoir réordonné leurs parties chacune à sa façon : la liste ne suit donc l'ordre d'aucune
 * carte, elle suit celui où un élément se pose par défaut — le plus probable.
 * Le nombre compte les séances qui portent la partie, atelier compris : c'est ce que la carte montre.
 */
export function partiesProposees(lot: readonly LignePlanning[]): PartieProposee[] {
  const parNom = new Map<string, PartieProposee>();
  for (const l of lot) {
    const vues = new Set<string>();
    for (const p of l.parties) {
      if (vues.has(p.libelle)) continue;
      vues.add(p.libelle);
      const deja = parNom.get(p.libelle);
      if (deja) deja.nombre += 1;
      else parNom.set(p.libelle, { libelle: p.libelle, bloc: p.bloc, nature: p.nature, rang: p.rang, nombre: 1 });
    }
  }
  return [...parNom.values()].sort((a, b) => a.bloc - b.bloc || rangDefautNature(a.nature) - rangDefautNature(b.nature) || a.rang - b.rang);
}

/** « Partie 1 · Cours (5 séances) » : l'entrée de la liste des parties. */
export function libellePartieProposee(p: PartieProposee): string {
  return `${p.libelle} (${nbSeances(p.nombre)})`;
}

/* ------------------------------------------------------------------ */
/* Ajouter un élément : la partie et la nature                          */
/* ------------------------------------------------------------------ */

/**
 * **Les parties où l'on peut ajouter** : de 1 à la plus longue séance du lot, plus une — la nouvelle
 * partie. Une séance qui en compte moins reçoit l'élément dans une nouvelle partie à sa fin
 * (`ajouterPartiesEnMasse`), et l'explication le dit.
 */
export function blocsProposes(lot: readonly LignePlanning[]): number[] {
  const max = lot.reduce((m, l) => Math.max(m, nombreDeParties(l.parties)), 0);
  return Array.from({ length: max + 1 }, (_, i) => i + 1);
}

/** « Partie 3 (nouvelle) » quand aucune séance du lot ne l'a encore. */
export function libelleBlocPropose(bloc: number, lot: readonly LignePlanning[]): string {
  const existe = lot.some((l) => nombreDeParties(l.parties) >= bloc);
  return existe ? nomPartie(bloc) : `${nomPartie(bloc)} (nouvelle)`;
}

/** Les natures qu'on ajoute en masse, dans l'ordre d'une partie. */
export const NATURES_AJOUT_MASSE: ReadonlyArray<{ valeur: NatureAjoutable; libelle: string }> = NATURES_AJOUTABLES.map((n) => ({ valeur: n, libelle: NOMS_NATURE[n] }));

/** Les séances du lot qui n'ont pas encore la partie visée : l'élément y ouvre une partie à la fin. */
export function seancesSansLaPartie(lot: readonly LignePlanning[], bloc: number): number {
  return lot.filter((l) => nombreDeParties(l.parties) < bloc).length;
}

/* ------------------------------------------------------------------ */
/* Régler des éléments : du réglage au brouillon                       */
/* ------------------------------------------------------------------ */

/**
 * **Le réglage d'un élément, champ par champ.** `undefined` = « ne pas changer » (le défaut de chaque
 * liste) ; une chaîne vide = vider (`----------`, `LIBELLE_VIDE`) ; sinon la valeur voulue.
 */
export type ReglagePartie = {
  instructeurId?: string;
  instructeurSecondId?: string;
  theme?: string;
  description?: string;
  niveau?: Niveau;
};

/** Aucun champ n'est à changer : le bouton reste inerte. */
export function reglageVide(r: ReglagePartie): boolean {
  return r.instructeurId === undefined && r.instructeurSecondId === undefined && r.theme === undefined && r.description === undefined && r.niveau === undefined;
}

/**
 * Pourquoi une séance reste de côté. Les trois dernières sont **les refus du serveur**
 * (`REFUS_CASE`, `sansThemeNiDetails`) pesés d'avance : une case qui serait refusée à « Appliquer »
 * ferait tomber tout le lot, et elle n'a donc rien à faire dans le brouillon.
 */
export type RaisonEcart = "absente" | "atelier" | "secondSansPremier" | "memePersonne" | "sansTheme";

/**
 * **Ce que devient une case** sous un réglage — ou pourquoi elle reste de côté.
 *
 * Les règles de cohérence de la case (`CaseEditeur`) s'appliquent : vider l'instructeur vide le second,
 * et vider le thème emporte le niveau et la description — le serveur ferait de même. Mais un réglage
 * qui **demande** un second, un niveau ou une description que la case ne peut pas tenir (pas
 * d'instructeur, la même personne deux fois, pas de thème) n'est pas réécrit en silence : la séance
 * reste de côté, et l'écran le dit.
 */
export function issueReglage(base: Paire, r: ReglagePartie): { paire: Paire } | { ecart: RaisonEcart } {
  const instructeurId = r.instructeurId ?? base.instructeurId;
  let instructeurSecondId = r.instructeurSecondId ?? base.instructeurSecondId;
  // Le premier qui s'efface emporte le second — la règle de la case, sauf si le réglage en demande un.
  if (!instructeurId) {
    if (r.instructeurSecondId) return { ecart: "secondSansPremier" };
    instructeurSecondId = "";
  }
  if (instructeurId && instructeurId === instructeurSecondId) {
    // Le nouveau premier était le second : on libère la place, comme la case — sauf si c'est demandé.
    if (r.instructeurSecondId !== undefined || r.instructeurId === undefined) return { ecart: "memePersonne" };
    instructeurSecondId = "";
  }
  const theme = (r.theme ?? base.theme).trim();
  let description = (r.description ?? base.description).trim();
  let niveau = r.niveau ?? base.niveau;
  if (!theme) {
    if (r.description || (r.niveau !== undefined && r.niveau !== NIVEAU_DEFAUT)) return { ecart: "sansTheme" };
    description = "";
    niveau = NIVEAU_DEFAUT;
  }
  return { paire: { instructeurId, instructeurSecondId, theme, description, niveau } };
}

/** Le plan d'un réglage sur le lot : les cases à poser, et ce qui reste de côté, compté par raison. */
export type PlanReglage = {
  ecritures: EcritureEnMasse[];
  /** Séances dont la case porte déjà exactement ce réglage. */
  deja: number;
  ecarts: Record<RaisonEcart, number>;
};

/**
 * **Le plan d'un réglage** : pour chaque séance cochée, la case de la partie choisie — partant de ce
 * que le **brouillon** porte déjà s'il y a lieu, sinon de la valeur du serveur : un réglage en masse
 * ne doit pas défaire ce qu'on vient de régler à la main sur un autre champ de la même case.
 */
export function planReglage(lot: readonly LignePlanning[], libelle: string, r: ReglagePartie, brouillon: ReadonlyMap<string, Paire>): PlanReglage {
  const plan: PlanReglage = { ecritures: [], deja: 0, ecarts: { absente: 0, atelier: 0, secondSansPremier: 0, memePersonne: 0, sansTheme: 0 } };
  for (const l of lot) {
    const partie = l.parties.find((p) => p.libelle === libelle);
    if (!partie) {
      plan.ecarts.absente += 1;
      continue;
    }
    if (partie.atelier) {
      plan.ecarts.atelier += 1;
      continue;
    }
    const base = brouillon.get(partie.id) ?? partie.serveur;
    const issue = issueReglage(base, r);
    if ("ecart" in issue) {
      plan.ecarts[issue.ecart] += 1;
      continue;
    }
    if (pairesEgales(issue.paire, base)) {
      plan.deja += 1;
      continue;
    }
    plan.ecritures.push({ partieId: partie.id, paire: issue.paire, serveur: partie.serveur });
  }
  return plan;
}

const PHRASES_ECART: Record<RaisonEcart, [string, string]> = {
  absente: ["n'a pas cette partie", "n'ont pas cette partie"],
  atelier: ["porte un atelier dans cette partie (il se change depuis la gestion des ateliers)", "portent un atelier dans cette partie (il se change depuis la gestion des ateliers)"],
  secondSansPremier: ["n'a personne qui mène : un second viendrait n'assister personne", "n'ont personne qui mène : un second viendrait n'assister personne"],
  memePersonne: ["aurait la même personne pour mener et assister", "auraient la même personne pour mener et assister"],
  sansTheme: ["n'a pas de thème : niveau et description l'attendent", "n'ont pas de thème : niveau et description l'attendent"],
};

/** « 2 séances restent de côté : elles n'ont pas cette partie. » — une phrase par raison. */
export function phrasesEcarts(ecarts: Record<RaisonEcart, number>): string[] {
  return (Object.keys(PHRASES_ECART) as RaisonEcart[])
    .filter((r) => ecarts[r] > 0)
    .map((r) => {
      const n = ecarts[r];
      return n === 1 ? `1 séance reste de côté : elle ${PHRASES_ECART[r][0]}.` : `${n} séances restent de côté : elles ${PHRASES_ECART[r][1]}.`;
    });
}

/* ------------------------------------------------------------------ */
/* Régler des éléments : plusieurs noms, chacun ses réglages           */
/* ------------------------------------------------------------------ */

/** Un élément coché (« Partie 1 · Cours ») et **ses** réglages. */
export type ReglageElement = { libelle: string; reglage: ReglagePartie };

/** Le plan d'un élément du lot : son nom, et ce que son réglage ferait des séances qui le portent. */
export type PlanParElement = { libelle: string; plan: PlanReglage | null };

/**
 * Le plan de « Régler des éléments » : toutes les cases à poser — chaque élément visé dans chaque
 * séance cochée qui le porte —, le nombre de séances touchées, et le détail élément par élément.
 */
export type PlanReglages = {
  ecritures: EcritureEnMasse[];
  /** Les séances où au moins une case changera : le nombre du bouton (« Appliquer aux 6 séances »). */
  seances: number;
  parElement: PlanParElement[];
};

/**
 * **Plusieurs éléments réglés d'un appui.** Chaque élément coché garde **son** réglage, calculé
 * exactement comme un seul l'était (`planReglage` : point de départ dans le brouillon, mêmes refus
 * de la case, même case portant un atelier laissée de côté). Un élément coché dont tout est resté
 * sur « Ne pas changer » n'écrit rien : son plan vaut `null`, et l'explication le dit.
 *
 * Deux éléments différents d'une même séance sont deux cases différentes (deux identifiants) : leurs
 * écritures ne se marchent pas dessus, et la séance ne se compte qu'une fois.
 */
export function planReglages(lot: readonly LignePlanning[], reglages: readonly ReglageElement[], brouillon: ReadonlyMap<string, Paire>): PlanReglages {
  const ecritures: EcritureEnMasse[] = [];
  const parElement: PlanParElement[] = [];
  for (const { libelle, reglage } of reglages) {
    if (reglageVide(reglage)) {
      parElement.push({ libelle, plan: null });
      continue;
    }
    const plan = planReglage(lot, libelle, reglage, brouillon);
    parElement.push({ libelle, plan });
    ecritures.push(...plan.ecritures);
  }
  return { ecritures, seances: seancesTouchees(lot, ecritures), parElement };
}

/** Les séances du lot dont au moins une case est écrite. */
function seancesTouchees(lot: readonly LignePlanning[], ecritures: readonly EcritureEnMasse[]): number {
  const ids = new Set(ecritures.map((e) => e.partieId));
  return lot.filter((l) => l.parties.some((p) => ids.has(p.id))).length;
}

const PHRASE_NE_PAS_CHANGER = "Chaque réglage reste « Ne pas changer » tant que tu n'y touches pas ; « ---------- » vide le champ.";
const PHRASE_BROUILLON =
  "Rien n'est encore enregistré : chaque case réglée dit « Modifié — pas encore appliqué », et « Appliquer » écrit tout d'un coup, avec ce que tu as réglé à la main.";

/** L'unique bouton de « Régler des éléments » : « Appliquer aux 6 séances ». */
export function libelleBoutonReglages(plan: PlanReglages | null): string {
  if (!plan || plan.ecritures.length === 0) return "Régler les éléments";
  return `Appliquer ${aSeances(plan.seances)}`;
}

/**
 * **« Régler des éléments » expliqué avant d'agir** : combien de cases, sur combien de séances, et
 * pour chaque élément coché ce qu'il touche, ce qui porte déjà son réglage et ce qui reste de côté.
 */
export function expliquerReglages(plan: PlanReglages | null): Explication {
  if (!plan || plan.parElement.length === 0) return { titre: "Coche les éléments à régler, puis choisis ce qui change pour chacun.", phrases: [PHRASE_NE_PAS_CHANGER] };
  if (plan.parElement.every((e) => e.plan === null)) return { titre: "Choisis ce qui change pour chaque élément coché.", phrases: [PHRASE_NE_PAS_CHANGER] };
  const n = plan.ecritures.length;
  const details = plan.parElement.flatMap(({ libelle, plan: p }) => {
    if (!p) return [`« ${libelle} » : rien à changer pour l'instant, tout est sur « Ne pas changer ».`];
    const touche = p.ecritures.length;
    return [
      `« ${libelle} » : ${touche === 0 ? "aucune séance ne changerait" : `réglé sur ${nbSeances(touche)}`}${
        p.deja > 0 ? ` ; ${nbSeances(p.deja)} ${p.deja > 1 ? "portent" : "porte"} déjà ce réglage` : ""
      }.`,
      ...phrasesEcarts(p.ecarts).map((phrase) => `« ${libelle} » — ${phrase}`),
    ];
  });
  return {
    titre: n === 0 ? "Aucune case ne changerait avec ces réglages." : `${nbElements(n)} ${n > 1 ? "sont réglés" : "est réglé"} sur ${nbSeances(plan.seances)}, dans le brouillon.`,
    phrases: [PHRASE_BROUILLON, ...details],
  };
}

/** Ce que dit le message, une fois les cases posées dans le brouillon. */
export function messageReglages(plan: PlanReglages): string {
  const n = plan.ecritures.length;
  return `${nbElements(n)} ${n > 1 ? "réglés" : "réglé"} sur ${nbSeances(plan.seances)}, pas encore ${n > 1 ? "appliqués" : "appliqué"} : « Appliquer » ${n > 1 ? "les enregistre" : "l'enregistre"}.`;
}

/* ------------------------------------------------------------------ */
/* Les champs d'un réglage, tels que l'écran les tient                 */
/* ------------------------------------------------------------------ */

/** L'entrée « ne pas changer » des listes du réglage : la valeur par défaut, distincte du vide. */
export const NE_PAS_CHANGER = "__inchange__";
export const LIBELLE_NE_PAS_CHANGER = "Ne pas changer";
/** L'entrée « écrire une description » de la liste du même nom (les deux autres sont communes). */
export const ECRIRE = "__ecrire__";

/**
 * La valeur d'une liste du réglage traduite en réglage : « ne pas changer » vaut `undefined`, le vide
 * (`----------`) vaut une chaîne vide. Rappel : `LIBELLE_VIDE` est un libellé, jamais une donnée.
 */
export function lireChoix(valeur: string): string | undefined {
  return valeur === NE_PAS_CHANGER ? undefined : valeur;
}

/** Les deux entrées de tête de chaque liste du réglage, dans cet ordre. */
export const ENTREES_TETE = [
  { valeur: NE_PAS_CHANGER, libelle: LIBELLE_NE_PAS_CHANGER },
  { valeur: "", libelle: LIBELLE_VIDE },
] as const;

/**
 * **Les listes d'un réglage, telles que l'écran les tient** : la valeur de chaque liste déroulante
 * (`NE_PAS_CHANGER`, `""` pour vider, `AUTRE` / `ECRIRE` pour un texte libre, sinon la valeur) et
 * les deux textes libres. Un élément coché de « Régler des éléments » a les siens ; le volet du
 * téléphone n'en a qu'un jeu, pour tous les éléments cochés.
 */
export type ChampsReglage = {
  instructeur: string;
  second: string;
  theme: string;
  themeLibre: string;
  niveau: string;
  description: string;
  descriptionTexte: string;
};

export const CHAMPS_INCHANGES: ChampsReglage = {
  instructeur: NE_PAS_CHANGER,
  second: NE_PAS_CHANGER,
  theme: NE_PAS_CHANGER,
  themeLibre: "",
  niveau: NE_PAS_CHANGER,
  description: NE_PAS_CHANGER,
  descriptionTexte: "",
};

/**
 * **Le thème retenu par la liste** : un thème qui n'est pas (ou plus) dans la liste proposée revient
 * à « Ne pas changer » — on n'écrit pas sur un échauffement un thème qu'il ne proposerait pas.
 */
export function themeRetenu(champs: ChampsReglage, themesListe: readonly string[]): string {
  const t = champs.theme;
  return t === NE_PAS_CHANGER || t === "" || t === AUTRE || themesListe.includes(t) ? t : NE_PAS_CHANGER;
}

/** **Des listes au réglage** : ce que l'écran montre, traduit en ce que `issueReglage` attend. */
export function reglageDepuisChamps(champs: ChampsReglage, themesListe: readonly string[]): ReglagePartie {
  const theme = themeRetenu(champs, themesListe);
  return {
    instructeurId: lireChoix(champs.instructeur),
    instructeurSecondId: lireChoix(champs.second),
    theme: theme === AUTRE ? champs.themeLibre.trim() || undefined : lireChoix(theme),
    niveau: lireChoix(champs.niveau) as Niveau | undefined,
    description: champs.description === ECRIRE ? champs.descriptionTexte.trim() || undefined : lireChoix(champs.description),
  };
}

/** Choisir l'instructeur libère la place du second s'il s'agit de la même personne. */
export function choisirInstructeur(champs: ChampsReglage, v: string): ChampsReglage {
  return { ...champs, instructeur: v, second: v !== NE_PAS_CHANGER && v === champs.second ? NE_PAS_CHANGER : champs.second };
}

/* ------------------------------------------------------------------ */
/* Remplacer un thème                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un thème trouvé dans les séances cochées : son texte (tel qu'il s'écrit la première fois qu'on le
 * rencontre), sa clé (à la casse, aux accents et aux espaces près — `normaliserTheme`, la règle des
 * teintes), combien d'éléments réglables le portent, sur combien de séances, et de quelles natures.
 */
export type ThemeTrouve = {
  cle: string;
  theme: string;
  elements: number;
  seances: number;
  echauffements: number;
  /** Cours et options : ceux qui puisent dans « Thèmes de cours et options ». */
  autres: number;
  /** Ateliers qui portent ce thème (leur titre) : ils le gardent, figé côté serveur. */
  ateliers: number;
};

/**
 * **Les thèmes présents dans les séances cochées** — sur ce que la case montre (le brouillon s'il y a
 * lieu, sinon le serveur), en ordre alphabétique. Un élément sans thème n'en porte aucun ; un atelier
 * n'est pas compté dans les éléments (son thème est son titre), mais il l'est à part, pour le dire.
 */
export function themesTrouves(lot: readonly LignePlanning[], brouillon: ReadonlyMap<string, Paire>): ThemeTrouve[] {
  const parCle = new Map<string, ThemeTrouve & { vues: Set<string> }>();
  for (const l of lot) {
    for (const p of l.parties) {
      const theme = themeActuel(p, brouillon);
      const cle = normaliserTheme(theme);
      if (!cle) continue;
      const t = parCle.get(cle) ?? { cle, theme, elements: 0, seances: 0, echauffements: 0, autres: 0, ateliers: 0, vues: new Set<string>() };
      parCle.set(cle, t);
      if (p.atelier) {
        t.ateliers += 1;
        continue;
      }
      t.elements += 1;
      if (p.nature === "ECHAUFFEMENT") t.echauffements += 1;
      else t.autres += 1;
      if (!t.vues.has(l.id)) {
        t.vues.add(l.id);
        t.seances += 1;
      }
    }
  }
  return [...parCle.values()]
    .filter((t) => t.elements > 0)
    .map((t): ThemeTrouve => ({ cle: t.cle, theme: t.theme, elements: t.elements, seances: t.seances, echauffements: t.echauffements, autres: t.autres, ateliers: t.ateliers }))
    .sort((a, b) => a.theme.localeCompare(b.theme, "fr", { sensitivity: "base" }));
}

/** « Messer — 5 éléments sur 3 séances » : l'entrée de la liste des thèmes trouvés. */
export function libelleThemeTrouve(t: ThemeTrouve): string {
  return `${t.theme} — ${nbElements(t.elements)} sur ${nbSeances(t.seances)}`;
}

/** Les deux listes de thèmes du club (`OptionsCase`). */
export type ListesThemes = { themes: readonly string[]; themesEchauffement: readonly string[] };

/** Un thème appartient-il à la liste ? À la casse et aux accents près, comme les teintes. */
const dansListe = (liste: readonly string[], theme: string) => liste.some((t) => normaliserTheme(t) === normaliserTheme(theme));

/** Le thème trouvé est-il porté à la fois par des échauffements et par des cours ou options ? */
export const themeMixte = (t: ThemeTrouve) => t.echauffements > 0 && t.autres > 0;

/**
 * **Les remplaçants proposés** : la liste du club de la nature des éléments qui portent le thème —
 * « Thèmes d'échauffement » pour des échauffements, « Thèmes de cours et options » pour des cours et
 * options (`themesDeNature`). Quand le thème est porté **des deux côtés**, la liste réunit les deux
 * (sans doublon, dans l'ordre : échauffement d'abord), et **chaque élément ne reçoit qu'un thème de sa
 * propre liste** ({@link planRemplacement}) : les autres restent de côté, comptés et dits. Le thème
 * remplacé lui-même n'est pas proposé.
 */
export function themesRemplacants(t: ThemeTrouve, listes: ListesThemes): string[] {
  const sources = [...(t.echauffements > 0 ? listes.themesEchauffement : []), ...(t.autres > 0 ? listes.themes : [])];
  const vues = new Set<string>([t.cle]);
  const rendus: string[] = [];
  for (const theme of sources) {
    const cle = normaliserTheme(theme);
    if (!cle || vues.has(cle)) continue;
    vues.add(cle);
    rendus.push(theme);
  }
  return rendus;
}

/** Le plan d'un remplacement : les cases à poser, les séances touchées, et ce qui reste de côté. */
export type PlanRemplacement = {
  ecritures: EcritureEnMasse[];
  seances: number;
  /** Éléments qui portent le thème mais dont la liste ne propose pas le remplaçant (thème mixte). */
  horsListe: { echauffements: number; autres: number };
};

/**
 * **Le plan d'un remplacement** : chaque élément réglable des séances cochées dont le thème montré
 * (brouillon, sinon serveur) est le thème trouvé reçoit le nouveau — par `issueReglage`, donc
 * instructeurs, niveau et description gardés tels quels. Un élément dont la liste de nature ne
 * propose pas le remplaçant reste de côté (cas d'un thème porté par des échauffements et des cours).
 */
export function planRemplacement(lot: readonly LignePlanning[], cle: string, nouveau: string, listes: ListesThemes, brouillon: ReadonlyMap<string, Paire>): PlanRemplacement {
  const plan: PlanRemplacement = { ecritures: [], seances: 0, horsListe: { echauffements: 0, autres: 0 } };
  const theme = nouveau.trim();
  if (!cle || !theme || normaliserTheme(theme) === cle) return plan;
  for (const l of lot) {
    for (const p of l.parties) {
      if (p.atelier || normaliserTheme(themeActuel(p, brouillon)) !== cle) continue;
      const echauffement = p.nature === "ECHAUFFEMENT";
      if (!dansListe(echauffement ? listes.themesEchauffement : listes.themes, theme)) {
        plan.horsListe[echauffement ? "echauffements" : "autres"] += 1;
        continue;
      }
      const base = brouillon.get(p.id) ?? p.serveur;
      const issue = issueReglage(base, { theme });
      if ("ecart" in issue || pairesEgales(issue.paire, base)) continue;
      plan.ecritures.push({ partieId: p.id, paire: issue.paire, serveur: p.serveur });
    }
  }
  plan.seances = seancesTouchees(lot, plan.ecritures);
  return plan;
}

/** L'unique bouton : « Remplacer sur 5 éléments (3 séances) ». */
export function libelleBoutonRemplacement(plan: PlanRemplacement | null): string {
  if (!plan || plan.ecritures.length === 0) return "Remplacer le thème";
  return `Remplacer sur ${nbElements(plan.ecritures.length)} (${nbSeances(plan.seances)})`;
}

/**
 * **« Remplacer un thème » expliqué avant d'agir** : combien d'éléments sur combien de séances, que
 * rien ne part avant « Appliquer », et — pour un thème porté des deux côtés — pourquoi la liste
 * réunit deux listes et qui reste de côté.
 */
export function expliquerRemplacement(trouve: ThemeTrouve | null, nouveau: string, plan: PlanRemplacement | null): Explication {
  if (!trouve) return { titre: "Choisis le thème à remplacer, puis son remplaçant.", phrases: ["Seuls les thèmes portés par les séances cochées sont proposés, avec le nombre d'éléments qui les portent."] };
  const mixte = themeMixte(trouve)
    ? [
        `« ${trouve.theme} » est porté par ${pluriel(trouve.echauffements, "échauffement")} et ${pluriel(trouve.autres, "cours ou option", "cours ou options")} : la liste réunit les thèmes d'échauffement et ceux de cours et options, et chaque élément ne reçoit qu'un thème de sa propre liste.`,
      ]
    : [];
  const ateliers =
    trouve.ateliers > 0 ? [`${trouve.ateliers === 1 ? "1 atelier porte" : `${trouve.ateliers} ateliers portent`} aussi ce thème : ${trouve.ateliers === 1 ? "il garde" : "ils gardent"} son titre, figé.`] : [];
  if (!plan || !nouveau.trim())
    return {
      titre: `« ${trouve.theme} » : ${nbElements(trouve.elements)} sur ${nbSeances(trouve.seances)}. Choisis son remplaçant.`,
      phrases: [...mixte, ...ateliers],
    };
  const n = plan.ecritures.length;
  const horsListe = [
    ...(plan.horsListe.echauffements > 0
      ? [`${pluriel(plan.horsListe.echauffements, "échauffement")} ${plan.horsListe.echauffements > 1 ? "restent" : "reste"} de côté : « ${nouveau.trim()} » n'est pas un thème d'échauffement.`]
      : []),
    ...(plan.horsListe.autres > 0
      ? [`${pluriel(plan.horsListe.autres, "cours ou option", "cours ou options")} ${plan.horsListe.autres > 1 ? "restent" : "reste"} de côté : « ${nouveau.trim()} » n'est pas un thème de cours et options.`]
      : []),
  ];
  return {
    titre:
      n === 0
        ? "Aucun élément ne changerait avec ce remplacement."
        : `${nbElements(n)} sur ${nbSeances(plan.seances)} ${n > 1 ? "passent" : "passe"} de « ${trouve.theme} » à « ${nouveau.trim()} », dans le brouillon.`,
    phrases: [
      "Seul le thème change : instructeurs, niveau et description restent tels quels. La couleur de chaque cours ou option suit son nouveau thème à l'enregistrement.",
      PHRASE_BROUILLON,
      ...mixte,
      ...horsListe,
      ...ateliers,
    ],
  };
}

/** Ce que dit le message, une fois les cases posées dans le brouillon. */
export function messageRemplacement(ancien: string, nouveau: string, plan: PlanRemplacement): string {
  const n = plan.ecritures.length;
  return `« ${ancien} » remplacé par « ${nouveau.trim()} » sur ${nbElements(n)} (${nbSeances(plan.seances)}), pas encore ${n > 1 ? "appliqués" : "appliqué"} : « Appliquer » ${n > 1 ? "les enregistre" : "l'enregistre"}.`;
}

/* ------------------------------------------------------------------ */
/* Ajouter dans une partie : les mots du geste                         */
/* ------------------------------------------------------------------ */

/** L'unique bouton de l'ajout : un verbe et un nombre. */
export function libelleBoutonAjout(n: number, ajout: ChoixAjout | null): string {
  return ajout ? `Ajouter ${AJOUT_NATURE[ajout.nature]} dans la partie ${ajout.bloc} à ${nbSeances(n)}` : "Ajouter";
}

/** La question d'avant, pour le geste qui écrit tout de suite. Régler et remplacer n'en ont pas : rien ne part. */
export function confirmationPlanning(ajout: ChoixAjout, n: number): string {
  return `Ajouter ${AJOUT_NATURE[ajout.nature]} dans la partie ${ajout.bloc} de ${nbSeances(n)} ? C'est enregistré tout de suite, sans passer par « Appliquer ».`;
}

/** **L'ajout expliqué avant d'agir** : ce qui arrive, quand c'est écrit, et où l'élément se range. */
export function expliquerAjout(lot: readonly LignePlanning[], ajout: ChoixAjout | null): Explication {
  if (!ajout) return { titre: "Choisis la partie, puis ce qu'on y ajoute.", phrases: ["Un échauffement, un cours ou une option : il naît vide, à remplir."] };
  const ou = lot.length === 1 ? "la séance" : `chacune des ${lot.length} séances`;
  const sans = seancesSansLaPartie(lot, ajout.bloc);
  // Le serveur range l'élément dans une **nouvelle** partie à la fin d'une séance trop courte : la
  // partie 4 visée devient la partie 3 d'une séance qui n'en avait que deux. On le dit avant.
  const nouvelles =
    sans === 0
      ? []
      : [
          sans === lot.length
            ? `La partie ${ajout.bloc} n'existe encore sur aucune : elle est créée${sans === 1 ? "" : " sur chacune"}, à la fin.`
            : `${sans === 1 ? "1 séance n'a" : `${sans} séances n'ont`} pas encore de partie ${ajout.bloc} : l'élément y ouvre une nouvelle partie, à la fin.`,
        ];
  return {
    titre: `${NOMS_NATURE[ajout.nature]} s'ajoute dans la partie ${ajout.bloc} sur ${ou}, tout de suite.`,
    phrases: [
      "Comme le menu de la carte : son nom se calcule (« Partie 2 · Cours », « Partie 2 · Option 2 »…), et il naît vide, à remplir.",
      ...nouvelles,
      "C'est enregistré sans attendre « Appliquer », et « Annuler » ne le défait pas : on retire un élément depuis sa carte.",
      "Tout ou rien : si une séance refuse (trop d'éléments), aucune n'est modifiée.",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Au téléphone : régler des éléments, choisis un par un               */
/* ------------------------------------------------------------------ */

/**
 * **« Régler des éléments »**, la variante du téléphone.
 *
 * Sur l'ordinateur, on coche **des noms** (« Partie 1 · Cours », « Partie 1 · Échauffement »), chacun
 * avec ses réglages, et chaque réglage vise cet élément-là dans chaque séance cochée
 * (`planReglages`). Au téléphone, le volet montre toutes les séances cochées avec **leurs**
 * éléments, et l'on coche ceux qu'on veut — le cours de mardi et l'option de vendredi ensemble, si
 * c'est ce qu'on règle. Le réglage vise donc des **identifiants**, plus des noms. Le reste ne change
 * pas : même `issueReglage` (les règles de la case), même point de départ (le brouillon s'il y a lieu,
 * sinon le serveur), mêmes écritures — elles entrent dans le brouillon (`poserPlusieurs`), et c'est
 * « Appliquer » qui les enregistre.
 *
 * Un atelier n'est pas cochable : son thème est son titre, figé côté serveur, et le réglage en masse
 * l'a toujours laissé de côté.
 */

/** Les séances cochées, chacune avec ses éléments dans l'ordre de sa carte ; un atelier ne se coche pas. */
export function elementsProposes(lot: readonly LignePlanning[]): { seance: LignePlanning; elements: { partie: PartieLigne; cochable: boolean }[] }[] {
  return lot.map((seance) => ({ seance, elements: seance.parties.map((partie) => ({ partie, cochable: !partie.atelier })) }));
}

/** Les éléments cochés qui existent encore dans le lot (une séance décochée emporte les siens). */
export function elementsRetenus(lot: readonly LignePlanning[], coches: ReadonlySet<string>): PartieLigne[] {
  return lot.flatMap((l) => l.parties.filter((p) => !p.atelier && coches.has(p.id)));
}

/**
 * **La liste de thèmes à proposer** pour des éléments cochés : celle de leur nature (`themesDeNature`
 * — l'échauffement a la sienne, cours et options partagent l'autre). Quand les éléments mêlent un
 * échauffement et un cours ou une option, **aucune** liste ne vaut pour tous : la fonction rend
 * `null`, et l'écran ne propose que « Ne pas changer », le vide et un thème libre — plutôt que
 * d'écrire sur un échauffement un thème de cours que sa case ne proposerait pas.
 */
export function natureDesThemes(elements: readonly PartieLigne[]): NatureElement | null {
  const echauffement = elements.some((p) => p.nature === "ECHAUFFEMENT");
  const autre = elements.some((p) => p.nature !== "ECHAUFFEMENT");
  if (echauffement && autre) return null;
  return echauffement ? "ECHAUFFEMENT" : "COURS";
}

/** Le plan d'un réglage d'éléments : comme `PlanReglage`, mais compté par élément. */
export type PlanElements = { ecritures: EcritureEnMasse[]; deja: number; ecarts: Record<RaisonEcart, number> };

/**
 * **Le plan d'un réglage sur des éléments choisis** — `planReglage`, par identifiant. Chaque élément
 * part de ce que le brouillon porte déjà, sinon du serveur ; un élément déjà au réglage n'est pas
 * réécrit, et un réglage que sa case refuserait (second sans premier, même personne, niveau sans
 * thème) le laisse de côté, compté.
 */
export function planReglageElements(elements: readonly PartieLigne[], r: ReglagePartie, brouillon: ReadonlyMap<string, Paire>): PlanElements {
  const plan: PlanElements = { ecritures: [], deja: 0, ecarts: { absente: 0, atelier: 0, secondSansPremier: 0, memePersonne: 0, sansTheme: 0 } };
  for (const partie of elements) {
    if (partie.atelier) {
      plan.ecarts.atelier += 1;
      continue;
    }
    const base = brouillon.get(partie.id) ?? partie.serveur;
    const issue = issueReglage(base, r);
    if ("ecart" in issue) {
      plan.ecarts[issue.ecart] += 1;
      continue;
    }
    if (pairesEgales(issue.paire, base)) {
      plan.deja += 1;
      continue;
    }
    plan.ecritures.push({ partieId: partie.id, paire: issue.paire, serveur: partie.serveur });
  }
  return plan;
}

const PHRASES_ECART_ELEMENT: Record<RaisonEcart, [string, string]> = {
  absente: ["n'existe plus", "n'existent plus"],
  atelier: ["est un atelier : son thème est figé", "sont des ateliers : leur thème est figé"],
  secondSansPremier: ["n'a personne qui mène : un second viendrait n'assister personne", "n'ont personne qui mène : un second viendrait n'assister personne"],
  memePersonne: ["aurait la même personne pour mener et assister", "auraient la même personne pour mener et assister"],
  sansTheme: ["n'a pas de thème : niveau et description l'attendent", "n'ont pas de thème : niveau et description l'attendent"],
};

/** « 2 éléments restent de côté : ils n'ont pas de thème… » — une phrase par raison. */
export function phrasesEcartsElements(ecarts: Record<RaisonEcart, number>): string[] {
  return (Object.keys(PHRASES_ECART_ELEMENT) as RaisonEcart[])
    .filter((r) => ecarts[r] > 0)
    .map((r) => {
      const n = ecarts[r];
      return n === 1 ? `1 élément reste de côté : il ${PHRASES_ECART_ELEMENT[r][0]}.` : `${n} éléments restent de côté : ils ${PHRASES_ECART_ELEMENT[r][1]}.`;
    });
}

/** Le bouton de la première étape : « Suivant : 4 éléments ». */
export function libelleSuivantElements(n: number): string {
  return n === 0 ? "Coche au moins un élément" : `Suivant : ${nbElements(n)}`;
}

/** Le bouton de la seconde : « Régler 4 éléments » — le nombre de cases qui changeront vraiment. */
export function libelleReglerElements(n: number): string {
  return n === 0 ? "Régler les éléments" : `Régler ${nbElements(n)}`;
}

/** Ce que dit le message, une fois les cases posées dans le brouillon. */
export function messageElementsRegles(n: number): string {
  if (n === 1) return "1 élément réglé, pas encore appliqué : « Appliquer » l'enregistre.";
  return `${n} éléments réglés, pas encore appliqués : « Appliquer » les enregistre.`;
}

/** L'explication de la seconde étape, avant d'appuyer : même promesse que sur l'ordinateur. */
export function expliquerReglageElements(plan: PlanElements | null, retenus: number): Explication {
  if (!plan) return { titre: `${nbElements(retenus)} : choisis ce qui change.`, phrases: ["Chaque réglage reste « Ne pas changer » tant que tu n'y touches pas ; « ---------- » vide le champ."] };
  const n = plan.ecritures.length;
  return {
    titre: n === 0 ? "Aucune case ne changerait avec ce réglage." : `${n === 1 ? "1 élément est réglé" : `${n} éléments sont réglés`} dans le brouillon.`,
    phrases: [
      "Rien n'est encore enregistré : chaque case réglée dit « Modifié — pas encore appliqué », et « Appliquer » écrit tout d'un coup, avec ce que tu as réglé à la main.",
      ...(plan.deja > 0 ? [`${nbElements(plan.deja)} ${plan.deja > 1 ? "portent" : "porte"} déjà ce réglage : rien n'y change.`] : []),
      ...phrasesEcartsElements(plan.ecarts),
    ],
  };
}
