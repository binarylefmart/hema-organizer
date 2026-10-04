import { redirect } from "next/navigation";

/**
 * **Fossile.** Les trimestres ont rejoint l'espace admin (`/admin/periodes`), mais l'ancienne
 * adresse est déjà partie dans des emails — le rappel « la période suivante reste à créer » la
 * portait — et peut dormir dans un favori. Sans cette page, on tomberait sur un 404 nu.
 *
 * Aucune garde ici : adresse fossile, on ne fait que réécrire l'adresse, et la destination vérifie
 * les droits (espace admin, donc élévation). Vérifier deux fois ne protégerait rien de plus et
 * ferait deux messages de refus différents selon le chemin emprunté. C'est la règle commune aux
 * relais — voir `gestion/page.tsx`.
 */
export default function PageAnciennesPeriodes() {
  redirect("/admin/periodes");
}
