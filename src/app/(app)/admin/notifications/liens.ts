import type { Canal } from "@/lib/notifications/preferences";

/**
 * Lien vers la page de configuration d'un canal, **dans l'espace admin**.
 *
 * Les quatre pages de canal — email, téléphone (push), discord, whatsapp — ont suivi le réglage des
 * notifications sous `/admin/notifications/…` : les liens de la grille et l'en-tête des pages de
 * canal passent tous par ici. Un canal ajouté à `CANAUX` a donc sa page au même endroit, sans
 * table à tenir à jour ici — mais il lui faut bien un `page.tsx`, sinon le lien tombe sur un 404.
 */
export function lienCanal(canal: Canal): string {
  return `/admin/notifications/${canal}`;
}
