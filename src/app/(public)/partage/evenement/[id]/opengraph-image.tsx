import { evenementPartage, lignesEvenement, tronquer } from "@/lib/partage";
import { imagePartage, TAILLE_OG, TYPE_OG } from "../../image";
import { gardeInconnu, gardePartage } from "../../meta";

/**
 * Vignette d'aperçu d'un événement partagé.
 *
 * Toujours la vignette maison (parchemin + écu) : l'illustration distante de l'annonce n'est
 * **jamais** rapatriée ici. Générer la vignette est déclenché par un inconnu qui colle le lien —
 * ce n'est pas le moment d'aller chercher un fichier sur un domaine tiers.
 *
 * Le texte de remplacement est une constante (exigence de Next) : le nom du club, lu en base, est
 * écrit dans la vignette par `imagePartage`.
 */
export const alt = "Événement";
export const size = TAILLE_OG;
export const contentType = TYPE_OG;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await gardePartage())) return new Response("Trop de demandes", { status: 429 });

  // Brouillon compris : rien ne sort d'une annonce non publiée, pas même son nom dans une vignette
  const evenement = await evenementPartage(id);
  if (!evenement) {
    // Identifiant inconnu : compté à part, comme sur la page correspondante. La vignette se
    // demande sans la page : sans ce compteur-là, le balayage d'identifiants par un robot passait
    // ici sans jamais remplir la garde sévère prévue pour lui.
    if (!(await gardeInconnu())) return new Response("Trop de demandes", { status: 429 });
    return imagePartage({ surtitre: "Partage", titre: "Ce partage n'existe pas", lignes: ["Demande un nouveau lien"] });
  }

  return imagePartage({
    surtitre: "Événement",
    titre: tronquer(evenement.nom, 64),
    lignes: lignesEvenement(evenement).map((l) => l.texte),
    ...(evenement.termine ? { alerte: "Événement passé" } : {}),
  });
}
