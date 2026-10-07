import { NOMS_NATURE, type NatureElement } from "@/lib/constants";
import type { EntreeListe } from "@/components/ui/liste-deroulante";

/**
 * **La carte d'une séance, rangée par parties** — la partie sans React, donc testable (les tests ne
 * peuvent pas importer de `.tsx`).
 *
 * Une séance se lit « Partie 1 », « Partie 2 »… et chaque partie porte ses éléments (échauffement,
 * cours, option, atelier). L'ordre des éléments est celui que le serveur rend (`sequenceRangee`) :
 * on ne le **recalcule** pas ici, on le **découpe** — un ordre d'affichage se stocke, il ne se
 * reconstruit pas dans chaque vue.
 */

/** Ce que l'encadrement peut poser à la main : un atelier, lui, arrive d'une proposition en attente. */
export const NATURES_AJOUTABLES = ["ECHAUFFEMENT", "COURS", "OPTION"] as const satisfies readonly NatureElement[];
export type NatureAjoutable = (typeof NATURES_AJOUTABLES)[number];

export function estNatureAjoutable(v: unknown): v is NatureAjoutable {
  return typeof v === "string" && (NATURES_AJOUTABLES as readonly string[]).includes(v);
}

/** Les éléments d'une partie, dans l'ordre reçu. */
export type GroupePartie<T> = { bloc: number; elements: T[] };

/**
 * **Découpe la liste rangée en parties**, sans la retrier : deux éléments consécutifs du même `bloc`
 * vont dans le même paquet. La liste arrive triée par (bloc, ordre) ; si elle ne l'était
 * pas, on verrait deux fois « Partie 2 » plutôt que des éléments déplacés en silence.
 */
export function grouperParPartie<T extends { bloc: number }>(parties: readonly T[]): GroupePartie<T>[] {
  const groupes: GroupePartie<T>[] = [];
  for (const p of parties) {
    const dernier = groupes.at(-1);
    if (dernier && dernier.bloc === p.bloc) dernier.elements.push(p);
    else groupes.push({ bloc: p.bloc, elements: [p] });
  }
  return groupes;
}

/** Le nombre de parties d'une séance : le plus grand `bloc` (contigu à partir de 1), 0 sans élément. */
export function nombreDeParties(parties: readonly { bloc: number }[]): number {
  return parties.reduce((max, p) => Math.max(max, p.bloc), 0);
}

/**
 * **Où mènent ↑ et ↓** pour un élément — `null` quand le bouton n'a rien à faire.
 *
 * ↑ passe dans la partie précédente ; il n'y en a pas avant la première. ↓ passe dans la suivante, et
 * sur la **dernière** partie il en ouvre une nouvelle — sauf si l'élément y est **seul** : sa partie
 * disparaîtrait au moment même où la nouvelle naît, sous le même numéro. Un bouton qui ne change
 * rien ne s'offre pas. `nouvelle` dit que ↓ ouvre une partie qui n'existe pas encore.
 */
export function blocsVoisins(element: { id: string; bloc: number }, parties: readonly { id: string; bloc: number }[]): { haut: number | null; bas: number | null; nouvelle: boolean } {
  const n = nombreDeParties(parties);
  const seul = parties.every((p) => p.id === element.id || p.bloc !== element.bloc);
  const bas = element.bloc < n ? element.bloc + 1 : seul ? null : n + 1;
  return { haut: element.bloc > 1 ? element.bloc - 1 : null, bas, nouvelle: bas !== null && bas > n };
}

/** Un pas de ↑ ou ↓ : où poser l'élément (`deplacerElement`), et ce que le bouton annonce. */
export type PasVoisin = { versBloc: number; avantId: string | null; titre: string };

/**
 * **Les flèches de l'ordinateur suivent l'ordre de lecture, une place à la fois.** L'ordre d'une
 * partie est libre : ↑ fait passer l'élément devant son voisin du dessus, dans sa partie ; premier
 * de sa partie, il passe à la **fin** de la précédente. ↓ fait l'inverse : derrière son voisin du
 * dessous, puis au **début** de la partie suivante, et — dernier de la dernière partie sans y être
 * seul — dans une partie nouvelle. Un seul geste pour « changer de place » et « changer de
 * partie », au lieu de deux paires de flèches côte à côte.
 *
 * `parties` est la séance **dans l'ordre de lecture** (partie, puis `ordre`), telle qu'elle s'affiche.
 * `null` quand le geste ne changerait rien (premier de la première partie ; seul dans la dernière).
 */
export function pasVoisins(element: { id: string; bloc: number }, parties: readonly { id: string; bloc: number }[]): { haut: PasVoisin | null; bas: PasVoisin | null } {
  const n = nombreDeParties(parties);
  const nommees = n > 1;
  const memePartie = parties.filter((p) => p.bloc === element.bloc);
  const i = memePartie.findIndex((p) => p.id === element.id);
  const dans = nommees ? ` dans la partie ${element.bloc}` : "";

  let haut: PasVoisin | null = null;
  if (i > 0) haut = { versBloc: element.bloc, avantId: memePartie[i - 1].id, titre: `Monter d'une place${dans}` };
  else if (element.bloc > 1) haut = { versBloc: element.bloc - 1, avantId: null, titre: `Passer à la fin de la partie ${element.bloc - 1}` };

  let bas: PasVoisin | null = null;
  if (i >= 0 && i < memePartie.length - 1) {
    bas = { versBloc: element.bloc, avantId: memePartie[i + 2]?.id ?? null, titre: `Descendre d'une place${dans}` };
  } else if (element.bloc < n) {
    const suivante = parties.find((p) => p.bloc === element.bloc + 1);
    bas = { versBloc: element.bloc + 1, avantId: suivante?.id ?? null, titre: `Passer au début de la partie ${element.bloc + 1}` };
  } else if (memePartie.length > 1) {
    bas = { versBloc: n + 1, avantId: null, titre: "Passer dans une nouvelle partie" };
  }
  return { haut, bas };
}

/** Le préfixe des entrées « atelier » du menu d'ajout (le reste est l'identifiant de l'atelier). */
export const PREFIXE_ATELIER = "atelier:";

/** Un atelier proposé, tel que le planning le connaît (`OptionsCase.ateliersDisponibles`). */
export type AtelierPropose = { id: string; titre: string; proposePar: string; sessionId: string | null };

/**
 * **Le menu « Ajouter dans la partie N… »**. Il commande, il ne mémorise rien : sa valeur reste
 * l'entrée de tête, et choisir une ligne lance l'ajout. Les ateliers n'y figurent que s'il y en a
 * en attente — c'est les placer qui décide de leur sort, d'où leur groupe à part.
 */
export function entreesAjout(bloc: number, ateliers: readonly AtelierPropose[], sessionId: string): EntreeListe[] {
  return [
    { valeur: "", libelle: `Ajouter dans la partie ${bloc}…` },
    ...NATURES_AJOUTABLES.map((n) => ({ valeur: n, libelle: NOMS_NATURE[n] })),
    ...ateliers.map((a) => ({
      valeur: `${PREFIXE_ATELIER}${a.id}`,
      libelle: `Atelier — ${a.titre} (${a.proposePar})${a.sessionId === sessionId ? " · souhaité ici" : ""}`,
      groupe: "Ateliers en attente",
    })),
  ];
}

/** Ce qu'une entrée du menu d'ajout demande au serveur — `null` pour l'entrée de tête. */
export function lireAjout(valeur: string): { nature: NatureAjoutable } | { nature: "ATELIER"; atelierId: string } | null {
  if (valeur.startsWith(PREFIXE_ATELIER)) {
    const atelierId = valeur.slice(PREFIXE_ATELIER.length);
    return atelierId ? { nature: "ATELIER", atelierId } : null;
  }
  return estNatureAjoutable(valeur) ? { nature: valeur } : null;
}

/**
 * **La question avant de retirer un élément.** Un atelier ne se perd pas : il repart dans les
 * propositions en attente (le serveur le rend à `PROPOSE`), et c'est ce qu'il faut savoir avant de
 * confirmer. Le reste emporte ce qui y est écrit.
 */
export function confirmationRetrait(libelle: string, atelier: { titre: string } | null): string {
  if (atelier) {
    return `Retirer l'atelier « ${atelier.titre} » de cette séance ? Il repart dans les propositions en attente, où il pourra être placé ailleurs.`;
  }
  return `Retirer « ${libelle} » de cette séance ? Son instructeur, son thème et sa description seront perdus.`;
}

