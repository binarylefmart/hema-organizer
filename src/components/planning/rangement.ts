import { libelleElement, rangDefautNature, type NatureElement } from "@/lib/constants";

/**
 * **Les trois invariants d'une séance, calculés sans rien écrire.**
 *
 * 1. `bloc` (le numéro de partie) est **contigu à partir de 1** : retirer le dernier élément de la
 *    partie 2 fait de la partie 3 la nouvelle partie 2.
 * 2. `ordre` est **contigu à partir de 0**, dans l'ordre de lecture : partie par partie, et dans une
 *    partie **l'ordre d'avant**, puis l'identifiant (l'ordre de naissance d'un `cuid`). La nature
 *    n'y entre pas : l'ordre d'une partie est **libre**, c'est l'équipe qui le règle. La nature ne
 *    décide que de la place d'un élément **qui arrive** (`ordreDInsertion`).
 * 3. `libelle` redit la partie — quand la séance en a plusieurs — et le **rang dans la nature et la
 *    partie** (`libelleElement`) : « Partie 1 · Cours », « Partie 2 · Option 2 », ou « Cours » seul.
 *
 * **Pourquoi un module à part, sans Prisma.** L'application écrit ces règles à chaque geste
 * (`rangerParties`, `src/lib/planning.ts`) et le script de réparation les **relève** sur une base
 * existante (`scripts/reparer-donnees.ts`) sans ouvrir de client : une seule écriture de la règle,
 * sinon le script finirait par « réparer » vers un invariant différent.
 *
 * **`updatedAt` est rendu tel quel** : ranger une séance n'est pas une modification du programme par
 * quelqu'un, et la bulle « Modifié par … le … » d'une case ne doit pas changer parce qu'une voisine a
 * bougé (Prisma respecte une valeur explicite, même sur un `@updatedAt`).
 */
export type PartieARanger = { id: string; ordre: number; bloc: number; nature: NatureElement; libelle: string; updatedAt: Date };

/** Ce qu'un élément doit recevoir pour être rangé — rien de plus que ce qui change, plus son horodatage **rendu**. */
export type RangementPartie = { id: string; data: { ordre?: number; bloc?: number; libelle?: string; updatedAt: Date } };

/** La place d'un élément dans sa partie : son rang dans sa nature (à partir de 1) et le nombre de sa nature. */
export type PlaceDansPartie = { rang: number; nombre: number };

/** Ce qu'il faut d'un élément pour le situer dans sa séance. */
type ElementSitue = Pick<PartieARanger, "id" | "bloc" | "ordre">;

/** L'ordre de lecture : la partie, puis le rang stocké, puis l'identifiant. Jamais la nature. */
function comparer(a: ElementSitue, b: ElementSitue): number {
  return a.bloc - b.bloc || a.ordre - b.ordre || a.id.localeCompare(b.id);
}

/** L'ordre dans lequel une séance se lit, identifiants en main, sans rien écrire. */
export function sequenceRangee(parties: ReadonlyArray<PartieARanger>): string[] {
  return [...parties].sort(comparer).map((p) => p.id);
}

/**
 * **Rang et nombre de chaque élément dans sa partie et sa nature**, pour une liste **déjà triée**
 * dans l'ordre de lecture. Le calcul qui décide du nom doit être exactement celui qui s'affiche à
 * côté : les écrans le reprennent d'ici.
 */
export function placesDansPartie(parties: ReadonlyArray<{ bloc: number; nature: NatureElement }>): PlaceDansPartie[] {
  const cle = (p: { bloc: number; nature: NatureElement }) => `${p.bloc}:${p.nature}`;
  const totaux = new Map<string, number>();
  for (const p of parties) totaux.set(cle(p), (totaux.get(cle(p)) ?? 0) + 1);
  const vus = new Map<string, number>();
  return parties.map((p) => {
    const rang = (vus.get(cle(p)) ?? 0) + 1;
    vus.set(cle(p), rang);
    return { rang, nombre: totaux.get(cle(p)) ?? 1 };
  });
}

/** Les numéros de partie présents, renumérotés contigus à partir de 1 : `bloc d'avant → bloc rangé`. */
function blocsContigus(parties: ReadonlyArray<{ bloc: number }>): Map<number, number> {
  const blocs = [...new Set(parties.map((p) => p.bloc))].sort((a, b) => a - b);
  return new Map(blocs.map((b, i) => [b, i + 1]));
}

/**
 * Les lignes d'une séance à corriger, et ce qu'elles doivent porter — **rien pour celles qui sont
 * déjà d'accord avec la règle**. Le tri est fait ici : l'appelant peut donc exprimer un déplacement
 * en changeant simplement le `bloc` d'un élément, ou un rang intercalaire (`ordre ± 0,5`).
 */
export function rangementsParties(parties: ReadonlyArray<PartieARanger>): RangementPartie[] {
  const blocs = blocsContigus(parties);
  const rangees = parties.map((p) => ({ ...p, bloc: blocs.get(p.bloc) ?? p.bloc, blocAvant: p.bloc })).sort(comparer);
  const places = placesDansPartie(rangees);
  const nbParties = blocs.size;
  return rangees.flatMap((p, i) => {
    const libelle = libelleElement(p.bloc, p.nature, places[i].rang, places[i].nombre, nbParties);
    const data: RangementPartie["data"] = { updatedAt: p.updatedAt };
    if (p.ordre !== i) data.ordre = i;
    if (p.blocAvant !== p.bloc) data.bloc = p.bloc;
    if (p.libelle !== libelle) data.libelle = libelle;
    return data.ordre === undefined && data.bloc === undefined && data.libelle === undefined ? [] : [{ id: p.id, data }];
  });
}

/** Les éléments d'une partie, dans leur ordre de lecture. */
function partieLue<T extends ElementSitue>(existantes: ReadonlyArray<T>, bloc: number): T[] {
  return existantes.filter((p) => p.bloc === bloc).sort(comparer);
}

/** Un rang au-delà de toute la séance : la place d'un élément dans une partie encore vide. */
function apresTout(existantes: ReadonlyArray<ElementSitue>): number {
  return existantes.reduce((m, p) => Math.max(m, p.ordre), -1) + 1;
}

/**
 * **Le rang qu'un élément qui arrive dans la partie `bloc` doit porter pour se poser à sa place par
 * défaut** : juste après le dernier élément de la partie dont la nature vient avant la sienne ou
 * avec elle dans `ORDRE_DEFAUT_NATURES` (échauffement, cours, atelier, option), sinon en tête de la
 * partie. Un second cours se pose donc après le premier, un atelier avant les options, un
 * échauffement tout en haut — **même si l'équipe a réordonné la partie à la main** : on cherche le
 * dernier élément qui le précède par défaut, on ne retrie personne.
 *
 * La valeur rendue est **intercalaire** (un demi-rang, ou un rang hors de la partie) : c'est
 * `rangementsParties` qui renumérote ensuite toute la séance. `existantes` ne doit pas contenir
 * l'élément qu'on pose (celui qui change de partie en est retiré par l'appelant), et suppose des rangs
 * distincts dans la partie — ce que chaque écriture rétablit.
 */
export function ordreDInsertion(existantes: ReadonlyArray<ElementSitue & { nature: NatureElement }>, bloc: number, nature: NatureElement): number {
  const lus = partieLue(existantes, bloc);
  let dernier = -1;
  lus.forEach((p, i) => {
    if (rangDefautNature(p.nature) <= rangDefautNature(nature)) dernier = i;
  });
  if (dernier === -1) return lus.length > 0 ? lus[0].ordre - 1 : apresTout(existantes);
  const suivant = lus[dernier + 1];
  return suivant ? (lus[dernier].ordre + suivant.ordre) / 2 : lus[dernier].ordre + 1;
}

/**
 * **Le rang d'un élément posé à la main juste avant `avantId`** dans la partie `bloc`, ou en fin de
 * partie quand `avantId` vaut `null` — le geste du glisser-déposer. Rend `null` si `avantId` n'est pas
 * un élément de cette partie : l'écran a visé une place qui n'existe plus, l'appelant refuse.
 * Mêmes conventions que `ordreDInsertion` (valeur intercalaire, élément déplacé absent d'`existantes`).
 */
export function ordreAvant(existantes: ReadonlyArray<ElementSitue>, bloc: number, avantId: string | null): number | null {
  const lus = partieLue(existantes, bloc);
  if (avantId === null) return lus.length > 0 ? lus[lus.length - 1].ordre + 1 : apresTout(existantes);
  const i = lus.findIndex((p) => p.id === avantId);
  if (i === -1) return null;
  return i === 0 ? lus[0].ordre - 1 : (lus[i - 1].ordre + lus[i].ordre) / 2;
}

/**
 * **Ce qu'on peut écrire en base en attendant le rangement** : la colonne `ordre` est entière, un
 * rang intercalaire ne s'y stocke pas. L'appelant écrit donc la partie entière, et donne le rang
 * intercalaire à `rangerParties` **dans la même transaction**. Les deux restent d'accord : un rang
 * fractionnaire n'est jamais celui que le rangement attribue (il réécrit donc la ligne), et un rang
 * entier est déjà ce que porte la base (il ne la réécrit que s'il doit la renuméroter).
 */
export function ordreEntier(ordre: number): number {
  return Math.floor(ordre);
}
