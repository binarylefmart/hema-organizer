import { AJOUT_NATURE, LIBELLE_VIDE, NIVEAU_DEFAUT, NOMS_NATURE, nomPartie, rangDefautNature, type NatureElement, type Niveau } from "@/lib/constants";
import { pluriel, type Explication } from "@/components/ui/choix-geste";
import { texteInviteMasse, type MotsLignes } from "@/components/ui/selection";
import { pairesEgales, type Paire } from "./file-envoi";
import type { EcritureEnMasse } from "./brouillon";
import { NATURES_AJOUTABLES, nombreDeParties, type NatureAjoutable } from "./parties-carte";
import type { Teinte } from "@/components/seances/teintes";

/**
 * **Agir sur plusieurs séances du planning à la fois** — la partie sans React ni base, donc testable.
 *
 * Le planning, en mode modification, donne une case à chaque carte de séance quand l'interrupteur
 * « Sélection multiple » est allumé. La mécanique vient du module partagé
 * (`src/components/ui/selection.ts` : cocher, case maîtresse, raccourcis « Tous les mardis »), la
 * forme de la question de `ChoixGeste` ; **ce qui se duplique ici, ce sont les mots** du planning.
 *
 * Deux gestes :
 *
 * - **régler une partie** (« Partie 1 · Cours », « Partie 2 · Option 2 »…) sur toutes les séances
 *   cochées qui portent cet élément :
 *   instructeur, second, thème, niveau, description, chacun facultatif. **Rien ne part** : les
 *   réglages entrent dans le brouillon, comme si chaque case avait été réglée à la main, et c'est
 *   « Appliquer les modifications » qui les enregistre (`enregistrerCases`, ses verrous, son
 *   tout-ou-rien, son journal) ;
 * - **ajouter un élément** — un échauffement, un cours ou une option — dans la partie choisie
 *   (1 à la dernière + 1) de chaque séance cochée : celui-là s'enregistre **tout de suite**, comme
 *   son jumeau de la carte (`ajouterPartiesEnMasse`) — un élément provisoire n'aurait pas
 *   d'identifiant à donner au brouillon. Les ateliers n'y sont pas : un atelier ne se pose qu'une
 *   fois, sur une séance, depuis sa carte.
 *
 * **Pas de retrait en masse** : retirer une partie emporte ce qui y est écrit, sans brouillon pour
 * revenir en arrière. Le geste reste sur chaque carte, avec sa confirmation.
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

export type GestePlanning = "regler" | "ajouter";

/** Ce que l'ajout en masse pose : une nature, dans une partie. */
export type ChoixAjout = { bloc: number; nature: NatureAjoutable };

/** Les mots de cet écran pour les phrases partagées (`texteHorsAffichage`). */
export const MOTS_PLANNING: MotsLignes = { singulier: "séance", pluriel: "séances", accord: "f" };

/** La phrase posée sous la case maîtresse tant que rien n'est coché (`texteInviteMasse`). */
export const INVITE_PLANNING = texteInviteMasse("régler une partie ou ajouter un élément sur plusieurs séances à la fois");

const nbSeances = (n: number) => pluriel(n, "séance");

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

/** Les séances annulées n'ont pas de case : on le dit, sans quoi la case maîtresse semble compter faux. */
export function texteSansCasePlanning(annulees: number): string | null {
  if (annulees === 0) return null;
  return annulees === 1
    ? "1 séance annulée n'a pas de case : son programme ne se règle plus."
    : `${annulees} séances annulées n'ont pas de case : leur programme ne se règle plus.`;
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
 * zéro n'est pas proposé (« Régler une partie (0 séance) » ne fait rien).
 */
export function gestesPlanningApplicables(lot: readonly LignePlanning[]): GestePlanningOffert[] {
  const offres: GestePlanningOffert[] = [];
  const reglables = seancesReglables(lot).length;
  if (reglables > 0) offres.push({ geste: "regler", nombre: reglables, libelle: `Régler une partie (${nbSeances(reglables)})` });
  if (lot.length > 0) offres.push({ geste: "ajouter", nombre: lot.length, libelle: `Ajouter dans une partie (${nbSeances(lot.length)})` });
  return offres;
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
/* Régler une partie : du réglage au brouillon                         */
/* ------------------------------------------------------------------ */

/**
 * **Le réglage d'une partie, champ par champ.** `undefined` = « ne pas changer » (le défaut de chaque
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
/* Les mots du geste                                                   */
/* ------------------------------------------------------------------ */

/** L'unique bouton : un verbe et un nombre. */
export function libelleBoutonPlanning(geste: GestePlanning, n: number, libelle = "", ajout: ChoixAjout | null = null): string {
  const s = nbSeances(n);
  if (geste === "regler") return libelle ? `Régler « ${libelle} » sur ${s}` : "Régler la partie";
  return ajout ? `Ajouter ${AJOUT_NATURE[ajout.nature]} dans la partie ${ajout.bloc} à ${s}` : "Ajouter";
}

/** La question d'avant, pour le geste qui écrit tout de suite. Régler n'en a pas : rien ne part. */
export function confirmationPlanning(ajout: ChoixAjout, n: number): string {
  return `Ajouter ${AJOUT_NATURE[ajout.nature]} dans la partie ${ajout.bloc} de ${nbSeances(n)} ? C'est enregistré tout de suite, sans passer par « Appliquer les modifications ».`;
}

/**
 * **Le geste expliqué avant d'agir** : ce qui arrive, quand c'est écrit, ce qui reste de côté.
 * `plan` n'a de sens que pour « régler » une fois la partie et un champ choisis.
 */
export function expliquerGestePlanning(geste: GestePlanning, lot: readonly LignePlanning[], plan: PlanReglage | null, libelle = "", ajout: ChoixAjout | null = null): Explication {
  if (geste === "regler") {
    if (!libelle) return { titre: "Choisis la partie, puis ce qui change.", phrases: ["Chaque réglage reste « Ne pas changer » tant que tu n'y touches pas ; « ---------- » vide le champ."] };
    if (!plan) return { titre: `« ${libelle} » : choisis ce qui change.`, phrases: ["Chaque réglage reste « Ne pas changer » tant que tu n'y touches pas ; « ---------- » vide le champ."] };
    const n = plan.ecritures.length;
    return {
      titre:
        n === 0
          ? "Aucune case ne changerait avec ce réglage."
          : `« ${libelle} » est réglé sur ${n === 1 ? "1 séance" : `${n} séances`}, dans le brouillon.`,
      phrases: [
        "Rien n'est encore enregistré : chaque case réglée dit « Modifié — pas encore appliqué », et « Appliquer les modifications » écrit tout d'un coup, avec ce que tu as réglé à la main.",
        ...(plan.deja > 0 ? [`${nbSeances(plan.deja)} ${plan.deja > 1 ? "portent" : "porte"} déjà ce réglage : rien n'y change.`] : []),
        ...phrasesEcarts(plan.ecarts),
      ],
    };
  }
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
      "C'est enregistré sans attendre « Appliquer les modifications », et « Annuler » ne le défait pas : on retire un élément depuis sa carte.",
      "Tout ou rien : si une séance refuse (trop d'éléments), aucune n'est modifiée.",
    ],
  };
}

/** L'entrée « ne pas changer » des listes du réglage : la valeur par défaut, distincte du vide. */
export const NE_PAS_CHANGER = "__inchange__";
export const LIBELLE_NE_PAS_CHANGER = "Ne pas changer";

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

/* ------------------------------------------------------------------ */
/* Au téléphone : régler des éléments, choisis un par un               */
/* ------------------------------------------------------------------ */

/**
 * **« Régler des éléments »**, la variante du téléphone de « Régler une partie ».
 *
 * Sur l'ordinateur, on choisit **un nom** (« Partie 1 · Cours ») et le réglage vise cet élément-là
 * dans chaque séance cochée. Au téléphone, le volet montre toutes les séances cochées avec **leurs**
 * éléments, et l'on coche ceux qu'on veut — le cours de mardi et l'option de vendredi ensemble, si
 * c'est ce qu'on règle. Le réglage vise donc des **identifiants**, plus des noms. Le reste ne change
 * pas : même `issueReglage` (les règles de la case), même point de départ (le brouillon s'il y a lieu,
 * sinon le serveur), mêmes écritures — elles entrent dans le brouillon (`poserPlusieurs`), et c'est
 * « Appliquer les modifications » qui les enregistre.
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

const nbElements = (n: number) => pluriel(n, "élément");

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
  if (n === 1) return "1 élément réglé, pas encore appliqué : « Appliquer les modifications » l'enregistre.";
  return `${n} éléments réglés, pas encore appliqués : « Appliquer les modifications » les enregistre.`;
}

/** L'explication de la seconde étape, avant d'appuyer : même promesse que « Régler une partie ». */
export function expliquerReglageElements(plan: PlanElements | null, retenus: number): Explication {
  if (!plan) return { titre: `${nbElements(retenus)} : choisis ce qui change.`, phrases: ["Chaque réglage reste « Ne pas changer » tant que tu n'y touches pas ; « ---------- » vide le champ."] };
  const n = plan.ecritures.length;
  return {
    titre: n === 0 ? "Aucune case ne changerait avec ce réglage." : `${n === 1 ? "1 élément est réglé" : `${n} éléments sont réglés`} dans le brouillon.`,
    phrases: [
      "Rien n'est encore enregistré : chaque case réglée dit « Modifié — pas encore appliqué », et « Appliquer les modifications » écrit tout d'un coup, avec ce que tu as réglé à la main.",
      ...(plan.deja > 0 ? [`${nbElements(plan.deja)} ${plan.deja > 1 ? "portent" : "porte"} déjà ce réglage : rien n'y change.`] : []),
      ...phrasesEcartsElements(plan.ecarts),
    ],
  };
}
