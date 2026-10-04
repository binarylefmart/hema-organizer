import { libellePartie } from "@/lib/constants";
// La numérotation par nature, déjà écrite une fois pour le repère de couleur et les lignes de
// programme : le rang qui décide du nom doit être exactement celui qui s'affiche à côté.
import { rangsDansNature } from "@/components/seances/programme-cours";

/**
 * **Les deux invariants d'une séance, calculés sans rien écrire.**
 *
 * 1. `ordre` est **contigu à partir de 0**, et **les cours passent devant les options** — sans quoi
 *    les rangs finissent troués (0, 1, 3) puis dupliqués, et c'est l'ordre d'insertion en base,
 *    c'est-à-dire le hasard, qui décide de l'affichage.
 * 2. `libelle` redit le **rang dans sa nature** (`libellePartie`) : « Cours 1 », « Cours 2 »…, «
 *    Option 1 », « Option 2 »… Depuis que le nom ne se saisit plus, il n'a plus de raison d'être vrai
 *    tout seul.
 *
 * **Pourquoi un module à part, sans Prisma.** Deux programmes tiennent cette règle et doivent la
 * tenir au caractère près : l'application, qui l'écrit à chaque geste (`rangerParties`,
 * `src/lib/planning.ts`), et le script de réparation, qui la **relève** sur une base existante avant
 * de proposer de l'écrire (`scripts/reparer-donnees.ts`). Le script promet en outre de ne charger
 * Prisma qu'au moment de s'exécuter — ses contrôles s'éprouvent sans approcher la moindre base —, il
 * ne peut donc pas importer `src/lib/planning.ts`, qui ouvre le client. Une seconde écriture de la
 * règle dans le script, c'est un contrôle qui finit par valider un invariant différent de celui que
 * l'application tient : le jour où ils divergent, le script « répare » vers le faux.
 */
export type PartieARanger = { id: string; ordre: number; estOption: boolean; libelle: string; updatedAt: Date };

/** Ce qu'une partie doit recevoir pour être rangée : son rang, son nom, et son horodatage **rendu**. */
export type RangementPartie = { id: string; data: { ordre?: number; libelle?: string; updatedAt: Date } };

/**
 * Les lignes d'une séance à corriger, et ce qu'elles doivent porter — **rien pour celles qui sont
 * déjà d'accord avec la règle**.
 *
 * Les deux corrections vivent dans la même fonction, et c'est voulu : le libellé dépend du rang
 * *final*, celui que la renumérotation vient de décider. Deux fonctions séparées obligeraient la
 * seconde à refaire le calcul de la première — donc à s'en écarter un jour. Et une partie qui change
 * à la fois de rang et de nom ne coûte ainsi qu'une seule écriture.
 *
 * **`updatedAt` est rendu tel quel**, et c'est le cœur de la décision : ranger une séance n'est pas
 * une modification du programme par quelqu'un. Le champ est un `@updatedAt`, et la grille l'affiche
 * dans la bulle « Modifié par … le … » de chaque case, avec `modifieParId` inchangé — renommer «
 * Option 1 » parce que sa voisine a changé de nature ferait donc dire à sa case que la personne qui
 * l'a remplie la semaine dernière y est revenue à l'instant. Prisma respecte une valeur explicite,
 * même sur un `@updatedAt` (vérifié sur SQLite).
 *
 * Le tri est fait **ici** sur `ordre`, ce qui laisse l'appelant exprimer un déplacement par un rang
 * **intercalaire** (`vers ± 0,5`) plutôt que par un tableau déjà réordonné — voir `deplacerPartie`.
 */
/**
 * **L'ordre dans lequel une séance se lit**, identifiants en main, sans rien écrire.
 *
 * Extrait pour que l'appelant puisse répondre à « est-ce que ce déplacement change quelque chose ? »
 * **avant** d'écrire — et il ne peut pas le déduire des écritures : un rang intercalaire (`vers ± 0,5`)
 * est toujours réécrit en entier, même quand la partie retombe exactement là où elle était. C'est le
 * cas d'une option qu'on monte « tout en haut » : elle vise un rang situé avant le premier cours, et
 * le tri la repose en tête de **sa** série, c'est-à-dire chez elle.
 */
export function sequenceRangee(parties: ReadonlyArray<PartieARanger>): string[] {
  return trierParties(parties).map((p) => p.id);
}

function trierParties(parties: ReadonlyArray<PartieARanger>): PartieARanger[] {
  /*
   * **Les cours d'abord, les options ensuite**.
   *
   * C'est un invariant de **rangement**, pas une règle d'affichage posée dans un écran : le planning,
   * la fiche d'une séance, la carte de l'accueil, les pages de partage et l'API lisent tous la même
   * liste triée. Une règle recopiée dans cinq vues finirait par ne plus dire la même chose dans
   * l'une d'elles — c'est précisément ce que `ordre` existe pour éviter (« un ordre d'affichage se
   * stocke, il ne se reconstruit pas »).
   *
   * Ce que ça rend cohérent : les deux séries se numérotent déjà chacune de son côté (« Cours 2 »
   * peut être la cinquième ligne), et lire « Option 1, Cours 1, Option 2 » demandait au lecteur de
   * recomposer deux suites entremêlées. Elles sont maintenant posées l'une après l'autre.
   *
   * Conséquence assumée sur les flèches : monter ou descendre **ne fait plus traverser la frontière**
   * — un rang intercalaire qui viserait l'autre groupe est ramené dans le sien par ce tri. Changer la
   * nature d'une partie reste le geste qui la fait passer d'une série à l'autre, et elle y arrive en
   * queue, ce que son nouveau nom annonce.
   *
   * **À rang égal, l'identifiant tranche** — c'est l'ordre de naissance (un `cuid` commence par son
   * horodatage), et la règle que les trois migrations de rangs ont appliquée. L'application ne peut
   * plus produire deux rangs égaux, mais la base en porte et le script de réparation les lit dans
   * l'ordre que la base veut : sans ce départage, la même base rangée deux fois pourrait l'être
   * différemment.
   */
  const ordonnees = [...parties].sort(
    (a, b) => Number(a.estOption) - Number(b.estOption) || a.ordre - b.ordre || a.id.localeCompare(b.id),
  );
  return ordonnees;
}

export function rangementsParties(parties: ReadonlyArray<PartieARanger>): RangementPartie[] {
  const ordonnees = trierParties(parties);
  const rangs = rangsDansNature(ordonnees);
  return ordonnees.flatMap((p, i) => {
    const libelle = libellePartie(rangs[i], p.estOption);
    const data: RangementPartie["data"] = { updatedAt: p.updatedAt };
    if (p.ordre !== i) data.ordre = i;
    if (p.libelle !== libelle) data.libelle = libelle;
    // `updatedAt` seul ne justifie pas une écriture : il n'est là que pour **empêcher** le champ de
    // bouger quand le rang ou le nom, eux, changent vraiment.
    return data.ordre === undefined && data.libelle === undefined ? [] : [{ id: p.id, data }];
  });
}
