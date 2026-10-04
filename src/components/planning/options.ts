import { niveauAffiche, NIVEAU_LABELS } from "@/lib/constants";
import type { Personne, Planning } from "@/lib/planning";

/**
 * Listes communes à toutes les cases du planning : les mêmes personnes, les mêmes thèmes
 * et les mêmes ateliers pour toutes les parties de chacune des séances affichées.
 *
 * Elles ne voyagent qu'**une seule fois** vers le navigateur (`FournisseurOptions`, contexte React) :
 * chaque case ne reçoit plus que ce qui lui est propre (sa séance, sa valeur).
 */
export type OptionsCase = {
  personnes: Personne[];
  themes: string[];
  ateliersDisponibles: Array<{ id: string; titre: string; proposePar: string; sessionId: string | null }>;
  modifiable: boolean;
  peutProgrammer: boolean;
};

/**
 * Listes remises aux cases à partir du planning chargé.
 *
 * Second verrou, après celui de `chargerPlanning` : les listes de **choix** — l'annuaire du club
 * (prénom, nom, rôle, couleur) et les ateliers en attente avec le nom de leur proposant — ne
 * traversent vers le navigateur que si quelqu'un peut s'en servir. Ce qui est déjà écrit dans une
 * case (instructeur, thème) vient de la case elle-même : il reste lisible par tout le monde.
 */
export function optionsDepuis(p: Planning): OptionsCase {
  const peutEcrire = p.modifiable || p.peutProgrammer;
  return {
    personnes: peutEcrire ? p.personnes : [],
    themes: p.themes,
    ateliersDisponibles: peutEcrire ? p.ateliersDisponibles : [],
    modifiable: p.modifiable,
    peutProgrammer: p.peutProgrammer,
  };
}

/** Une valeur d'une case, avec le mot qui dit ce qu'elle est. */
export type ChampLu = { intitule: string; valeur: string };

/**
 * **Ce qu'un membre lit d'une case du planning : les valeurs renseignées, chacune sous son nom.**
 *
 * Deux décisions de Delta, tenues ici et nulle part ailleurs pour qu'aucun écran ne puisse les
 * oublier dans son coin :
 *
 * 1. **Chaque valeur porte son libellé.** La carte empilait quatre valeurs nues — un nom, un autre
 *    nom, un thème, un niveau — sans dire lesquelles : à la lecture, le second instructeur passait
 *    pour un co-thème et le thème pour un lieu. On écrit « Instructeur », « Second instructeur »,
 *    « Thème », « Niveau », « Description » devant chacune.
 * 2. **Ce qui vaut `----------` ne s'affiche pas du tout** — ni la valeur, ni son intitulé. Un
 *    champ vide est un champ que l'encadrement n'a pas encore rempli : il a sa place dans l'écran
 *    de saisie, aucune dans ce que lit le club. Écrire « Thème : — » sur trois lignes de chaque
 *    séance remplirait la carte de tirets à la place du programme.
 *
 * Deux règles de fond y passent aussi : un **second sans premier** n'annonce rien (il assiste
 * quelqu'un, et ce quelqu'un n'est pas là — même garde-fou que `lignesProgramme`), et un niveau
 * inconnu, écrit par une autre version, se tait plutôt que de faire entrer « EXPERT » dans
 * l'interface (`niveauAffiche`).
 *
 * **Le nom de la partie n'est pas dans cette liste**, et c'est voulu : il ne se saisit plus, il se
 * calcule, et il est écrit **au-dessus** de la case comme titre de la ligne (voir `ListeParties`) —
 * pas dans la liste des valeurs que quelqu'un a remplies ou laissées vides.
 */
export function champsLus(c: {
  instructeur: string | null | undefined;
  instructeurSecond: string | null | undefined;
  theme: string | null | undefined;
  description?: string | null | undefined;
  niveau: string | null | undefined;
}): ChampLu[] {
  const propre = (v: string | null | undefined) => (v ?? "").trim();
  const instructeur = propre(c.instructeur);
  const second = instructeur ? propre(c.instructeurSecond) : "";
  const niveau = niveauAffiche(c.niveau);
  return [
    { intitule: "Instructeur", valeur: instructeur },
    { intitule: "Second instructeur", valeur: second },
    { intitule: "Thème", valeur: propre(c.theme) },
    { intitule: "Niveau", valeur: niveau ? NIVEAU_LABELS[niveau] : "" },
    /*
     * **La description vient en dernier, et c'est une phrase.** Les quatre champs d'avant nomment ou
     * qualifient en deux ou trois mots ; celle-ci raconte ce qu'on va faire, et se lit donc après —
     * comme on lit un titre avant son texte. Vide, elle disparaît avec son intitulé, comme les
     * autres : c'est l'objet même de `champsLus`, et c'est ce qui rend un champ **facultatif**
     * supportable sur une carte lue par tout le club.
     */
    { intitule: "Description", valeur: propre(c.description) },
  ].filter((champ) => champ.valeur !== "");
}

/**
 * **Aucun des cinq réglages n'est renseigné** : la case n'a rien à dire, et rien à perdre.
 *
 * C'est la définition **unique** de « vide » pour une case du planning, et elle vit ici — dans un
 * module pur, sans React ni base — parce que les trois qui s'en servent ne peuvent pas partager
 * autre chose : `caseVide` et `partieLibre` (serveur, `src/lib/planning.ts`, qui lit la base) et
 * `CaseEditeur` (navigateur, qui ne peut rien importer de `src/lib/planning.ts` sans entraîner
 * `node:crypto` dans son paquet). Deux écritures de la même règle, c'est la règle qui diverge : le
 * serveur refuserait ce que l'écran propose, ou l'inverse.
 *
 * Les noms des champs sont volontairement ceux de la **lecture** (`instructeur`, pas
 * `instructeurId`) : ce qui compte n'est pas la forme de la valeur mais le fait qu'il y en ait une.
 * L'appelant qui a des identifiants les passe tels quels.
 *
 * Le niveau passe par `niveauAffiche` : `INDIFFERENT` — et tout mot qu'une autre version aurait
 * écrit — ne compte pas comme un réglage, puisque rien ne s'affiche.
 */
export function reglagesVides(c: {
  instructeur?: string | null;
  instructeurSecond?: string | null;
  theme?: string | null;
  description?: string | null;
  niveau?: string | null;
}): boolean {
  const propre = (v: string | null | undefined) => (v ?? "").trim();
  return (
    !propre(c.instructeur) && !propre(c.instructeurSecond) && !propre(c.theme) && !propre(c.description) && niveauAffiche(c.niveau) === null
  );
}

/*
 * `LIBELLE_PARTIE_MAX` vivait ici : quarante signes, le plafond du champ texte qui servait à nommer
 * une partie. Le champ a disparu — le nom se calcule désormais depuis le rang (`libellePartie`,
 * src/lib/constants.ts) —, et la constante avec lui. Le seul texte libre d'une partie est
 * maintenant sa **description**, plafonnée par `PARTIE_DESCRIPTION_MAX`, qui vit dans
 * `constants.ts` avec les autres valeurs que le navigateur et le serveur partagent.
 */

/** Valeur de l'entrée « Autre… » (thème libre) dans la liste déroulante des thèmes. */
export const AUTRE = "__autre__";

/** « Chloé Durand » → « Chloé D. » (grille compacte) */
export function abreger(nomComplet: string): string {
  const [prenom, ...reste] = nomComplet.split(" ");
  return reste.length ? `${prenom} ${reste[reste.length - 1].charAt(0)}.` : prenom;
}

/**
 * Personnes réellement écrites dans le HTML d'une case.
 *
 * Une liste déroulante fermée n'affiche qu'une chose : sa valeur courante. Tant qu'elle n'a pas été
 * ouverte, inutile d'envoyer les autres entrées — sur un trimestre, la liste complète serait répétée
 * une fois par liste et par partie, soit quatre listes pour chacune des parties de chacune des
 * séances. Au premier contact (survol, appui, tabulation), la case bascule sur la liste entière,
 * avant que le menu ne s'ouvre.
 */
export function personnesRendues(personnes: Personne[], ouverte: boolean, selection: string): Personne[] {
  if (ouverte) return personnes;
  const choisie = personnes.find((p) => p.id === selection);
  return choisie ? [choisie] : [];
}

/**
 * Thèmes réellement écrits dans le HTML d'une case (même principe que `personnesRendues`).
 * Fermée, la liste ne garde que le thème choisi — et rien quand la case est vide ou en saisie libre
 * (« Autre… » et le thème hors liste sont rendus à part, ils ne viennent pas de la liste commune).
 */
export function themesRendus(themes: string[], ouverte: boolean, theme: string, autre: boolean): string[] {
  if (ouverte) return themes;
  return !autre && theme && themes.includes(theme) ? [theme] : [];
}
