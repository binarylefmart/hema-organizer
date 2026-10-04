/**
 * **Le tri du tableau par membre.**
 *
 * On n'ouvre pas cet écran pour lire l'assiduité du club de A à Z : on l'ouvre pour trouver **les
 * décrocheurs** — celui qui vient de moins en moins, celui qui ne répond plus. Dans un club de
 * douze, la lecture entière fait ce travail toute seule ; dans un club de quatre-vingts, le nom
 * qu'on cherche est quelque part au milieu de quatre-vingts lignes, et aucun repli n'y changerait
 * rien : replier une liste qu'on doit parcourir ne fait que déplacer le problème d'un clic.
 *
 * Ici, **un tri vaut donc mieux qu'un repli**. Tout est déjà calculé côté serveur : le tri se pose
 * dans `searchParams`, l'écran reste un composant serveur, et le retour du navigateur ramène le
 * classement précédent.
 */
export type TriMembres = "nom" | "taux" | "sansReponse";

const TRIS: readonly TriMembres[] = ["nom", "taux", "sansReponse"];

/** Libellés des trois entrées, dans l'ordre où elles sont proposées. */
export const TRI_LABELS: Record<TriMembres, string> = {
  // « Alphabétique » et non « Nom » : la ligne s'écrit « Prénom Nom », et c'est sur elle entière
  // que le classement porte. « Nom » laissait croire à un classement par nom de famille — celui-là
  // même qui donnait une colonne d'apparence non triée (voir `comparerAlphabetique`).
  nom: "Alphabétique",
  taux: "Taux le plus bas",
  sansReponse: "Sans réponse",
};

/** Un paramètre d'URL inconnu — ou absent — retombe sur l'ordre alphabétique. */
export function lireTri(valeur: string | undefined): TriMembres {
  return TRIS.find((t) => t === valeur) ?? "nom";
}

type Assiduite = { prenom: string; nom: string; pourcentage: number; sansReponse: number };

/**
 * **Le classement alphabétique porte sur ce que la ligne affiche : « Prénom Nom ».**
 *
 * Le serveur rend les membres classés par nom de famille (`statsPeriode`), alors que le tableau
 * écrit le prénom en premier. À douze, personne ne le remarque ; à quatre-vingts, la colonne des
 * noms n'a plus aucune progression visible — « Zoé Aaron » avant « Alix Zimmer » — et on ne peut
 * plus sauter à une lettre. C'est le même classement que les listes de séance
 * (`/admin/periodes/[id]`, `orderBy: { user: { prenom: "asc" } }`) : **un seul ordre pour toute
 * l'application**, sans quoi on cherche quelqu'un au mauvais endroit d'un écran à l'autre.
 *
 * `localeCompare` en français, pour que « Élodie » tombe entre « Eliot » et « Emma » plutôt qu'à la
 * fin ; le nom de famille départage les homonymes de prénom (le club compte deux Foxtrot).
 */
function comparerAlphabetique(a: { prenom: string; nom: string }, b: { prenom: string; nom: string }): number {
  return `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, "fr", { sensitivity: "base" });
}

/**
 * Trie une copie de la liste. Le tri est **stable** : à égalité de taux ou de silences, l'ordre
 * alphabétique est conservé — deux membres à 50 % restent l'un derrière l'autre d'une ouverture à
 * la suivante, ce qui évite de croire que le classement a bougé.
 *
 * Les deux sens ne se choisissent pas : on trie **le taux en croissant** et **les sans-réponse en
 * décroissant**, parce que dans les deux cas c'est le même bout de la liste qui intéresse. Offrir
 * l'inverse serait offrir un classement que personne ne vient chercher.
 */
export function trierMembres<T extends Assiduite>(membres: readonly T[], tri: TriMembres): T[] {
  // Le classement alphabétique est refait ici plutôt que repris du serveur : celui-ci trie sur le
  // nom de famille, et l'écran affiche « Prénom Nom » (voir `comparerAlphabetique`).
  const alphabetique = [...membres].sort(comparerAlphabetique);
  if (tri === "nom") return alphabetique;
  // Les deux autres tris partent de l'ordre alphabétique : le tri étant **stable**, deux membres à
  // 50 % restent classés par prénom, et non dans l'ordre où la base les a rendus.
  if (tri === "taux") return alphabetique.sort((a, b) => a.pourcentage - b.pourcentage);
  return alphabetique.sort((a, b) => b.sansReponse - a.sansReponse);
}
