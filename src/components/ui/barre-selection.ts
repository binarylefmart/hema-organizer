import type { MotsLignes } from "./selection";

/**
 * **La sélection multiple au téléphone** — la partie sans React, donc testable.
 *
 * En version téléphone, une fois des lignes cochées, les quatre écrans de masse (séances, planning, présences,
 * annuaire) montrent **la même barre sombre collée en bas** (`BarreSelection`) : le compte, « les N
 * affichées », ✕, puis un seul gros bouton qui ouvre un volet par le bas (`VoletBas`) — ou, aux
 * présences, les quatre réponses directement. Sur ordinateur, rien ne change.
 *
 * Ce module porte ce que ces écrans doivent dire **pareil** : les mots du compte et de la question, la
 * portée du bouton « les N affichées » (la règle de `CLAUDE.md` : une sélection nomme sa portée, et
 * le mot « Tout » ne s'écrit nulle part), et les deux règles du geste « toucher la carte pour la
 * cocher » — ce qui n'est pas une cible, et ce qui est un glissé plutôt qu'un appui.
 */

/** « 1 séance », « 3 séances » : la première ligne de la barre. */
export function compteSelection(n: number, mots: MotsLignes): string {
  return `${n} ${n > 1 ? mots.pluriel : mots.singulier}`;
}

/**
 * La fin de phrase que la barre garde pour le lecteur d'écran : « 3 séances » se lit seul à l'œil,
 * à côté des cases cochées, mais pas à l'oreille. Accordée comme la phrase de l'ordinateur
 * (« 3 séances sélectionnées », « 1 compte sélectionné »), qui reste ainsi la même des deux côtés.
 */
export function suffixeSelection(n: number, mots: MotsLignes): string {
  return ` sélectionné${mots.accord === "f" ? "e" : ""}${n > 1 ? "s" : ""}`;
}

/** Le gros bouton de la barre, et le titre du volet qu'il ouvre : « Que faire sur ces 3 séances ? ». */
export function questionSelection(n: number, mots: MotsLignes): string {
  if (n === 1)
    return `Que faire sur ${mots.accord === "f" ? "cette" : "ce"} ${mots.singulier} ?`;
  return `Que faire sur ces ${n} ${mots.pluriel} ?`;
}

/**
 * **Le bouton qui coche ce qui est affiché**, à côté du compte. La maquette l'appelait « Tout » ; le
 * mot est proscrit (`CLAUDE.md`, « Une sélection multiple nomme sa portée ») parce qu'il serait faux
 * dès qu'un repli ou une recherche est en jeu — c'est-à-dire là où l'on s'en sert. Il dit donc combien
 * il prend : « Les 5 affichées », « Les 12 affichés ».
 */
export function libelleAffichees(n: number, mots: MotsLignes): string {
  const e = mots.accord === "f" ? "e" : "";
  if (n === 1) return mots.accord === "f" ? "Celle affichée" : "Celui affiché";
  return `Les ${n} affiché${e}s`;
}

/**
 * **Ce qui n'est pas une cible du geste « toucher la carte »** : tout ce qui fait déjà quelque chose
 * sous le doigt. Une carte de séance porte des liens, les trois boutons de réponse, la liste des
 * participants ; une ligne de présence porte ses trois boutons ✓ ? ✕ ; une carte du planning porte
 * tous les réglages de ses éléments. Toucher l'un d'eux fait son geste à lui, jamais cocher la carte.
 */
export const SELECTEUR_INTERACTIF = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[role=button]",
  "[role=switch]",
  "[role=option]",
  "[role=listbox]",
  "[role=combobox]",
  "[contenteditable=true]",
  "[data-sans-cocher]",
].join(",");

/** La case que le geste coche : marquée, pour ne jamais être confondue avec une autre case de la carte. */
export const ATTRIBUT_CASE = "data-case-selection";

/**
 * **Un appui, ou un glissé ?** Au-delà de dix pixels entre le doigt posé et le doigt levé, c'est un
 * défilement ou un glissé (la ligne du planning se glisse à gauche pour révéler « Retirer ») : le
 * navigateur peut encore émettre un `click`, et il ne doit rien cocher.
 */
export const TOLERANCE_APPUI_PX = 10;

export function estUnAppui(
  depart: { x: number; y: number } | null,
  arrivee: { x: number; y: number },
): boolean {
  /*
   * **Sans départ connu, ce n'est pas un appui.** La zone n'a pas vu le doigt se poser : un enfant a
   * arrêté le `pointerdown` (la poignée ⋮⋮ du planning, qui déplace) — ou le départ retenu est celui
   * d'un appui précédent. Cocher sur un `click` dont on ignore l'origine cochait la séance qu'on
   * était en train de réordonner.
   */
  if (!depart) return false;
  return (
    Math.hypot(arrivee.x - depart.x, arrivee.y - depart.y) <= TOLERANCE_APPUI_PX
  );
}

/**
 * **La hauteur réelle de la barre d'édition du planning**, publiée par elle-même (`BarreEdition`) sur
 * la racine du document. La barre de sélection posée au-dessus (`auDessus`) s'y cale : une hauteur
 * fixe supposait une barre d'une ligne, et l'aide « i » ouverte ou un message les faisait se chevaucher.
 */
export const VARIABLE_HAUTEUR_BARRE_EDITION = "--hauteur-barre-edition";

/**
 * **Le focus piégé dans le volet** : Tab après le dernier contrôle revient au premier, Maj+Tab avant
 * le premier repart du dernier. `courant` vaut -1 quand le focus est hors des contrôles (sur le volet
 * lui-même, juste ouvert) : Tab va alors au premier, Maj+Tab au dernier.
 */
export function indexFocusSuivant(
  courant: number,
  total: number,
  arriere: boolean,
): number {
  if (total <= 0) return -1;
  if (courant < 0) return arriere ? total - 1 : 0;
  return arriere ? (courant - 1 + total) % total : (courant + 1) % total;
}
