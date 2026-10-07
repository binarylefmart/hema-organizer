/**
 * **Téléphone ou ordinateur : la règle, et le cookie qui la retient** — module pur, lu par la mise en
 * page racine (serveur) comme par le navigateur.
 *
 * **La version téléphone vaut pour tout appareil qu'on pilote au doigt, quelle que soit sa largeur,
 * et pour toute fenêtre de moins de 768 px.** Une tablette, droite ou couchée, reçoit donc la version
 * téléphone ; un ordinateur à souris ou à pavé tactile reçoit la version ordinateur, sauf fenêtre
 * étroite. `(pointer: coarse)` décrit le pointeur **principal** : un portable à écran tactile garde
 * son pavé comme pointeur principal, et reste un ordinateur.
 *
 * La même règle s'écrit trois fois, et c'est ici qu'elle se lit :
 *  - en CSS, par les variantes `tel:` et `ordi:` de `src/app/globals.css` (rendu serveur, aucun
 *    script) — c'est la bascule de tout ce que le serveur peut rendre des deux façons ;
 *  - dans le navigateur, par {@link REQUETE_TELEPHONE} (`useEcranTelephone`), quand un écran ne peut
 *    pas tout rendre deux fois ;
 *  - et dans le cookie {@link COOKIE_ECRAN}, qui la rapporte au serveur pour la visite suivante.
 */

/** La requête de la version téléphone — la même que la variante `tel:` de `globals.css`. */
export const REQUETE_TELEPHONE = "(width < 48rem), (pointer: coarse)";

/**
 * **Le format retenu par le navigateur, rapporté au serveur.** Le serveur ne connaît ni la largeur de
 * l'écran ni son pointeur : sans ce cookie, un écran qui bascule au montage rend d'abord la version
 * ordinateur, puis saute. Le navigateur le pose dès son premier rendu et à chaque changement de format
 * (`MemoireEcran`), si bien que **le premier rendu est le bon dès la deuxième visite**. Il ne contient
 * que `tel` ou `ordi` : aucune donnée personnelle, rien qui identifie l'appareil.
 */
export const COOKIE_ECRAN = "ecran";

export type FormatEcran = "tel" | "ordi";

/** La valeur du cookie, ou `null` s'il manque ou ne dit rien de connu (première visite). */
export function lireFormatEcran(valeur: string | undefined | null): FormatEcran | null {
  return valeur === "tel" || valeur === "ordi" ? valeur : null;
}

/** Un an : le format d'un appareil change rarement, et le navigateur le réécrit dès qu'il change. */
const DUREE_COOKIE_S = 365 * 24 * 60 * 60;

/** La ligne `document.cookie` qui retient un format. `Secure` seulement en https (le dev tourne en http). */
export function cookieFormatEcran(format: FormatEcran, https: boolean): string {
  return `${COOKIE_ECRAN}=${format}; Path=/; Max-Age=${DUREE_COOKIE_S}; SameSite=Lax${https ? "; Secure" : ""}`;
}
