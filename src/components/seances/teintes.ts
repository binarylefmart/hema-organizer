import type { NatureElement } from "@/lib/constants";

/**
 * **La teinte de chaque élément et de chaque partie d'une séance** — une seule règle, sans React ni
 * base, que l'écriture (`teinteAEcrire`, appelée par les actions du planning) et la lecture
 * (`teintesProgramme`, appelée au chargement du planning, de la fiche, de l'accueil et des pages de
 * partage) partagent.
 *
 * Une couleur par **nature** ne distinguait pas deux cours d'une même séance : ils avaient la même
 * étiquette, et seul leur numéro les séparait. Désormais (décision du responsable du club) :
 *
 * - **la teinte d'un cours ou d'une option vient de son thème** : un même thème a toujours la même
 *   teinte, d'une séance à l'autre (« l'épée longue est toujours bleue »). Un thème de la liste du
 *   club (« Thèmes de cours et options », `/admin/themes`) prend la teinte de **sa place** dans la
 *   liste, modulo la palette ; un thème libre, absent de la liste, une teinte tirée de son texte
 *   **normalisé** (sans casse, sans accents, espaces resserrés) par un hachage stable — « Épée
 *   longue » et « epee  longue » tombent donc ensemble ; un thème **vide** (cours encore à remplir)
 *   la teinte 1 ;
 * - **même thème, même teinte, y compris dans une séance** (deux cours d'épée longue sont tous deux
 *   bleus) ; **deux thèmes différents n'ont jamais la même teinte dans une séance** : si celle d'un
 *   thème est déjà portée par un **autre** thème de la séance (collision du hachage, liste plus
 *   longue que la palette), l'élément prend la **suivante libre** ; quand les huit sont prises (cas
 *   extrême : neuf thèmes dans une même séance), il garde celle de son thème ;
 * - **elle est enregistrée** (`SessionPartie.teinte`) au moment où elle s'attribue — à la création
 *   de l'élément et quand son thème change — et **rien d'autre ne la touche** : réordonner, changer
 *   de partie, retirer un voisin, changer l'instructeur ou passer d'option à cours la laissent où
 *   elle est. Une couleur qui changerait quand on touche à autre chose ne voudrait plus rien dire ;
 * - **l'échauffement et l'atelier n'en prennent pas** (`null`) : ils gardent leur couleur à eux (la
 *   marque du thème du club, le vert), qui est justement ce qui les fait reconnaître ;
 * - **la partie N prend la teinte N** (titre « Partie N » et bande à gauche du bloc), seulement là où
 *   le titre s'affiche, c'est-à-dire quand la séance en a plusieurs (`partiesNommees`).
 *
 * **Une ligne d'avant la colonne** (`teinte` à `null` sur un cours) se lit avec la même règle, sans
 * rien écrire pendant un rendu : les teintes enregistrées de la séance sont prises d'abord, puis les
 * manquantes s'attribuent dans l'ordre de **création** des éléments (leur identifiant, un cuid qui
 * commence par l'horodatage de la création), jamais dans l'ordre de lecture — sans quoi réordonner
 * suffirait à les échanger. `scripts/reparer-donnees.ts` (contrôle `teintes`) les enregistre.
 *
 * La palette est **fixe** (`--teinte-1` à `--teinte-8`, `globals.css`) : elle ne suit pas le thème du
 * club. Les classes sont écrites **en entier**, jamais composées (`bg-teinte-${n}`) : Tailwind lit
 * les sources pour savoir quelles classes engendrer, et une classe calculée à l'exécution
 * n'existerait dans aucune feuille de style.
 */

/** Le nombre de teintes de la palette ; au-delà, on reboucle sur la première. */
export const NOMBRE_TEINTES = 8;
export type Teinte = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Les natures qui prennent une teinte de la palette : le cours et l'option. */
export function prendUneTeinte(nature: NatureElement): boolean {
  return nature === "COURS" || nature === "OPTION";
}

/** Une valeur lue en base est-elle une teinte de la palette ? (une valeur hors palette se recalcule) */
export function estTeinte(v: unknown): v is Teinte {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= NOMBRE_TEINTES;
}

/** La n-ième teinte (à partir de 1), en rebouclant au-delà de la palette. */
export function teinteDuRang(n: number): Teinte {
  const i = Math.max(1, Math.floor(n));
  return (((i - 1) % NOMBRE_TEINTES) + 1) as Teinte;
}

/** La teinte de la partie N : la N-ième de la palette. */
export function teintePartie(bloc: number): Teinte {
  return teinteDuRang(bloc);
}

/** Un thème ramené à ce qui le distingue : sans casse, sans accents, espaces resserrés. */
export function normaliserTheme(theme: string): string {
  return (theme ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** FNV-1a sur 32 bits : court, stable d'une version de Node à l'autre et d'un navigateur à l'autre. */
function hachage(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * **La teinte que veut un thème**, avant de savoir si elle est libre dans la séance : sa place dans
 * la liste du club, sinon le hachage de son texte normalisé, et la teinte 1 pour un thème vide.
 */
export function teinteDuTheme(theme: string, themesClub: readonly string[]): Teinte {
  const cle = normaliserTheme(theme);
  if (!cle) return 1;
  const place = themesClub.findIndex((t) => normaliserTheme(t) === cle);
  return teinteDuRang((place >= 0 ? place : hachage(cle)) + 1);
}

/** La première teinte libre à partir de celle voulue, en tournant dans la palette ; la voulue si toutes sont prises. */
export function teinteLibre(voulue: Teinte, prises: ReadonlySet<number>): Teinte {
  for (let k = 0; k < NOMBRE_TEINTES; k++) {
    const t = teinteDuRang(voulue + k);
    if (!prises.has(t)) return t;
  }
  return voulue;
}

/** Ce qu'il faut d'un élément pour lui trouver sa teinte. */
export type ElementTeinte = { id: string; bloc: number; nature: NatureElement; theme: string; teinte?: number | null };

/**
 * **Les teintes d'une séance, telles qu'elles se lisent** — la séance **entière**, dans n'importe quel
 * ordre (rien ne dépend de la position). `elements[i]` est la teinte du i-ème élément reçu, ou `null`
 * pour un échauffement ou un atelier ; `parties` donne celle de chaque partie présente.
 *
 * La teinte enregistrée fait foi ; une ligne qui n'en a pas encore reçoit la règle de l'écriture
 * (`teinteAEcrire`), dans l'ordre de création, après que les teintes enregistrées ont été prises.
 */
export function teintesProgramme(
  elements: readonly ElementTeinte[],
  themesClub: readonly string[],
): { elements: Array<Teinte | null>; parties: Map<number, Teinte> } {
  const parties = new Map<number, Teinte>();
  for (const e of elements) if (!parties.has(e.bloc)) parties.set(e.bloc, teintePartie(e.bloc));
  const teintes: Array<Teinte | null> = elements.map((e) => (prendUneTeinte(e.nature) && estTeinte(e.teinte) ? e.teinte : null));
  // Qui porte quoi : teinte → thèmes (normalisés) qui la portent dans la séance.
  const occupees = new Map<Teinte, Set<string>>();
  elements.forEach((e, i) => porter(occupees, teintes[i], e.theme));
  const manquantes = elements
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => prendUneTeinte(e.nature) && teintes[i] === null)
    .sort((a, b) => (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
  for (const { e, i } of manquantes) {
    const t = teinteDansSeance(e.theme, themesClub, occupees);
    teintes[i] = t;
    porter(occupees, t, e.theme);
  }
  return { elements: teintes, parties };
}

/**
 * **La teinte à enregistrer pour un élément qu'on crée ou dont le thème change** : celle que porte
 * déjà le même thème dans la séance, sinon celle de son thème si aucun autre thème ne la porte, sinon
 * la suivante libre ; `null` pour un
 * échauffement ou un atelier. `autres` est le reste de la séance, **lu dans la même transaction** que
 * l'écriture : deux écritures simultanées ne peuvent pas se donner la même teinte.
 */
export function teinteAEcrire(
  element: { nature: NatureElement; theme: string },
  autres: readonly ElementTeinte[],
  themesClub: readonly string[],
): Teinte | null {
  if (!prendUneTeinte(element.nature)) return null;
  const lues = teintesProgramme(autres, themesClub).elements;
  const occupees = new Map<Teinte, Set<string>>();
  autres.forEach((e, i) => porter(occupees, lues[i], e.theme));
  return teinteDansSeance(element.theme, themesClub, occupees);
}

/** Note qu'une teinte est portée par un thème dans la séance (une teinte peut en avoir plusieurs). */
function porter(occupees: Map<Teinte, Set<string>>, t: Teinte | null, theme: string): void {
  if (t === null) return;
  const porteurs = occupees.get(t) ?? new Set<string>();
  porteurs.add(normaliserTheme(theme));
  occupees.set(t, porteurs);
}

/**
 * **La teinte d'un thème dans une séance** : celle qu'y porte déjà le même thème, s'il y est ; sinon
 * celle du thème si aucun **autre** thème ne la porte ; sinon la suivante libre.
 */
function teinteDansSeance(theme: string, themesClub: readonly string[], occupees: ReadonlyMap<Teinte, ReadonlySet<string>>): Teinte {
  const cle = normaliserTheme(theme);
  // Un thème vide (cours encore à remplir) n'est pas un thème : il ne partage pas sa teinte.
  if (cle !== "") for (const [t, porteurs] of occupees) if (porteurs.has(cle)) return t;
  return teinteLibre(teinteDuTheme(theme, themesClub), new Set<number>(occupees.keys()));
}

/** Le cours, en aplat : la teinte en fond, le texte posé dessus (`--teinte-texte`). */
export const APLAT_TEINTE: Record<Teinte, string> = {
  1: "bg-teinte-1 text-teinte-texte",
  2: "bg-teinte-2 text-teinte-texte",
  3: "bg-teinte-3 text-teinte-texte",
  4: "bg-teinte-4 text-teinte-texte",
  5: "bg-teinte-5 text-teinte-texte",
  6: "bg-teinte-6 text-teinte-texte",
  7: "bg-teinte-7 text-teinte-texte",
  8: "bg-teinte-8 text-teinte-texte",
};

/** L'option, en contour : la teinte douce en fond, la teinte au bord et au texte. */
export const CONTOUR_TEINTE: Record<Teinte, string> = {
  1: "border border-teinte-1 bg-teinte-1-doux text-teinte-1",
  2: "border border-teinte-2 bg-teinte-2-doux text-teinte-2",
  3: "border border-teinte-3 bg-teinte-3-doux text-teinte-3",
  4: "border border-teinte-4 bg-teinte-4-doux text-teinte-4",
  5: "border border-teinte-5 bg-teinte-5-doux text-teinte-5",
  6: "border border-teinte-6 bg-teinte-6-doux text-teinte-6",
  7: "border border-teinte-7 bg-teinte-7-doux text-teinte-7",
  8: "border border-teinte-8 bg-teinte-8-doux text-teinte-8",
};

/** La pièce de l'écu sur un aplat : découpée dans la teinte, c'est-à-dire le fond de l'étiquette. */
export const PIECE_APLAT_TEINTE: Record<Teinte, string> = {
  1: "fill-teinte-1",
  2: "fill-teinte-2",
  3: "fill-teinte-3",
  4: "fill-teinte-4",
  5: "fill-teinte-5",
  6: "fill-teinte-6",
  7: "fill-teinte-7",
  8: "fill-teinte-8",
};

/** La pièce de l'écu sur un contour : découpée dans la teinte douce, le fond de l'étiquette. */
export const PIECE_CONTOUR_TEINTE: Record<Teinte, string> = {
  1: "fill-teinte-1-doux",
  2: "fill-teinte-2-doux",
  3: "fill-teinte-3-doux",
  4: "fill-teinte-4-doux",
  5: "fill-teinte-5-doux",
  6: "fill-teinte-6-doux",
  7: "fill-teinte-7-doux",
  8: "fill-teinte-8-doux",
};

/** Le titre « Partie N », écrit dans la teinte de la partie. */
const TITRE_PARTIE: Record<Teinte, string> = {
  1: "text-teinte-1",
  2: "text-teinte-2",
  3: "text-teinte-3",
  4: "text-teinte-4",
  5: "text-teinte-5",
  6: "text-teinte-6",
  7: "text-teinte-7",
  8: "text-teinte-8",
};

/** La bande de 4 px à gauche du bloc de la partie, sans fond. */
const BANDE_PARTIE: Record<Teinte, string> = {
  1: "border-l-4 border-teinte-1",
  2: "border-l-4 border-teinte-2",
  3: "border-l-4 border-teinte-3",
  4: "border-l-4 border-teinte-4",
  5: "border-l-4 border-teinte-5",
  6: "border-l-4 border-teinte-6",
  7: "border-l-4 border-teinte-7",
  8: "border-l-4 border-teinte-8",
};

/** Les classes du bloc d'une partie nommée : son titre en couleur et sa bande à gauche. */
export function classesPartie(bloc: number): { titre: string; bande: string } {
  const t = teintePartie(bloc);
  return { titre: TITRE_PARTIE[t], bande: BANDE_PARTIE[t] };
}
