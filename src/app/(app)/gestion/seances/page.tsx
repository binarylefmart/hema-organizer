import { redirect } from "next/navigation";

/**
 * La liste des séances de l'équipe a rejoint l'onglet **Séances**, commun à tout le club : une
 * seule liste, où l'encadrement retrouve ses actions au pied de chaque carte. L'adresse survit
 * pour les favoris et pour le retour après connexion (cookie « suite »).
 *
 * Aucune garde ici : adresse fossile, la destination vérifie les droits (règle commune aux relais,
 * voir `gestion/page.tsx`) — `/seances` est d'ailleurs ouvert à tout le club.
 */
export default async function PageGestionSeances({ searchParams }: { searchParams: Promise<{ periode?: string; h?: string; quand?: string }> }) {
  const { periode, h, quand } = await searchParams;
  const q = new URLSearchParams();
  for (const [cle, valeur] of Object.entries({ periode, h, quand })) if (valeur) q.set(cle, valeur);
  const qs = q.toString();
  redirect(qs ? `/seances?${qs}` : "/seances");
}
