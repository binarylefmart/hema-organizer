/**
 * **Repartir de la valeur du serveur après un enregistrement réussi.**
 *
 * React n'applique `defaultValue` (et `defaultChecked`) qu'au **montage**, et React 19
 * réinitialise un formulaire dès que son action a rendu la main. Un champ non contrôlé retombe
 * donc sur la valeur qu'il avait au chargement de la page : l'écran affiche l'ancienne valeur
 * alors que le serveur a bien enregistré la nouvelle. Et ce n'est pas qu'un affichage qui ment —
 * un **second clic sur « Enregistrer » renvoie l'ancienne valeur au serveur**, qui l'écrit
 * par-dessus la bonne. Vu en production sur les thèmes du planning et sur les dates d'une période.
 *
 * Le remède est une `key` qui suit la valeur du serveur : quand elle change, React remonte le
 * champ, et le montage relit `defaultValue`. Elle est posée sur le **contrôle** et non sur le
 * formulaire, pour que le message « … enregistré » survive au remontage.
 *
 * Deux règles s'y cachent :
 *  - un champ **piloté par React** (`value=` / `checked=`) n'a pas de clé : sa valeur vient de son
 *    état, la lui réimposer entrerait en conflit avec lui ;
 *  - tant que la valeur du serveur ne bouge pas, la clé ne bouge pas : ce qu'on est en train de
 *    taper n'est jamais effacé par un rafraîchissement venu d'ailleurs, et la saisie restaurée
 *    après une erreur (voir `FormulaireAction`) reste en place.
 */
type ProprietesChamp = {
  value?: unknown;
  checked?: unknown;
  defaultValue?: string | number | readonly string[];
  defaultChecked?: boolean;
};

export function cleValeurServeur(props: ProprietesChamp): string | undefined {
  // Champ piloté par React : ni clé, ni remontage — son état fait déjà foi.
  if (props.value !== undefined || props.checked !== undefined) return undefined;
  if (props.defaultChecked !== undefined) return `coche:${props.defaultChecked}`;
  if (props.defaultValue === undefined) return undefined;
  return `valeur:${String(props.defaultValue)}`;
}
