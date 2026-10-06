import { libelleElement, rangNature, type NatureElement } from "@/lib/constants";

/**
 * **Les trois invariants d'une séance, calculés sans rien écrire.**
 *
 * 1. `bloc` (le numéro de partie) est **contigu à partir de 1** : retirer le dernier élément de la
 *    partie 2 fait de la partie 3 la nouvelle partie 2.
 * 2. `ordre` est **contigu à partir de 0**, dans l'ordre de lecture : partie par partie, et dans une
 *    partie l'échauffement, puis les cours, les options, les ateliers (`NATURES_ELEMENT`) ; à nature
 *    égale, l'ordre d'avant, puis l'identifiant (l'ordre de naissance d'un `cuid`).
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

function comparer(a: PartieARanger, b: PartieARanger): number {
  return a.bloc - b.bloc || rangNature(a.nature) - rangNature(b.nature) || a.ordre - b.ordre || a.id.localeCompare(b.id);
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
