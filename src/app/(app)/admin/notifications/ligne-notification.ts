/**
 * Ce que la matrice (composant serveur) et `LigneNotification` (composant client) partagent : un
 * module sans React, que les deux côtés peuvent appeler — une fonction exportée d'un module
 * `"use client"` n'arrive au serveur que comme une référence, pas comme une fonction.
 */
import { REQUETE_TELEPHONE } from "@/components/ui/ecran";

/**
 * Les rangées d'une notification repliée, cachées au téléphone — toutes sauf la première, qui est
 * le bouton de `LigneNotification` — ; et le titre de la fiche dépliée, que le bouton porte déjà.
 * Écrit une fois, rendu une fois par la matrice, sur la requête de la version téléphone
 * (`REQUETE_TELEPHONE`, la même que la variante `tel:`).
 */
export const STYLE_LIGNES_NOTIFICATION = `@media ${REQUETE_TELEPHONE} {
  tbody[data-replie] > tr:not(:first-child) { display: none; }
  tbody[data-notification] .titre-notification { display: none; }
}`;

/** Les identifiants des deux rangées d'une notification, que la matrice pose et que le bouton vise. */
export function idsRangeesNotification(type: string): [string, string] {
  return [`notification-${type}-cases`, `notification-${type}-mode`];
}

/**
 * Le résumé des canaux cochés : « Aucun », « Tous » (au-delà d'un canal), leurs noms jusqu'à deux,
 * puis leur nombre (« 4 canaux ») — quatre noms tenaient sur trois lignes dans une colonne de 45 %.
 * Le « · » est collé au nom qui le précède par une espace insécable : il ne commence jamais une ligne.
 */
export function resumeCanaux(coches: readonly string[], concernes: number): string {
  if (coches.length === 0) return "Aucun";
  if (concernes > 1 && coches.length === concernes) return "Tous";
  if (coches.length > 2) return `${coches.length}\u00a0canaux`;
  return coches.join("\u00a0· ");
}
