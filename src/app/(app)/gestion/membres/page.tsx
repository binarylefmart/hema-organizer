import { redirect } from "next/navigation";

/**
 * **Fossile.** L'annuaire a rejoint l'espace admin (`/admin/membres`). L'ancienne adresse a
 * longtemps été la porte d'entrée de la gestion : elle dort dans des favoris et dans l'historique
 * des navigateurs. Sans cette page, on tomberait sur un 404 nu.
 *
 * Aucune garde ici : adresse fossile, on ne fait que réécrire l'URL et la destination vérifie les
 * droits (espace admin, donc élévation). C'est la règle commune aux relais — voir `gestion/page.tsx`.
 */
export default function PageAnciensMembres() {
  redirect("/admin/membres");
}
