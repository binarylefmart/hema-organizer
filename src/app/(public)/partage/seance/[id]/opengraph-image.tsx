import { formatDateLongue, formatHoraire } from "@/lib/dates";
import { chiffresImage, LIBELLE_ANNULEE, seancePartagee, themeAffiche } from "@/lib/partage";
import { imagePartage, TAILLE_OG, TYPE_OG } from "../../image";
import { gardeInconnu, gardePartage } from "../../meta";

/**
 * Vignette d'aperçu d'une séance partagée (WhatsApp, Signal, Discord, LinkedIn).
 *
 * Le texte de remplacement ne nomme pas le club : Next exige ici une **chaîne constante**, et le nom
 * du club est désormais une donnée lue en base (`identite()`, asynchrone). Il est écrit dans la
 * vignette elle-même, par `imagePartage`.
 */
export const alt = "Résumé d'un cours";
export const size = TAILLE_OG;
export const contentType = TYPE_OG;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // La vignette est une route publique comme la page : elle passe par le même limiteur par IP
  if (!(await gardePartage())) return new Response("Trop de demandes", { status: 429 });

  const seance = await seancePartagee(id);
  if (!seance) {
    // Identifiant inconnu : compté à part, comme sur la page correspondante. La vignette se
    // demande sans la page : sans ce compteur-là, le balayage d'identifiants par un robot passait
    // ici sans jamais remplir la garde sévère prévue pour lui.
    if (!(await gardeInconnu())) return new Response("Trop de demandes", { status: 429 });
    return imagePartage({ surtitre: "Partage", titre: "Ce partage n'existe pas", lignes: ["Demande un nouveau lien"] });
  }

  const sujet = themeAffiche(seance);
  const { taux, effectif } = chiffresImage(seance);
  return imagePartage({
    surtitre: "Cours",
    titre: formatDateLongue(seance.date),
    lignes: [formatHoraire(seance.heureDebut, seance.heureFin), seance.lieu, ...(sujet ? [sujet] : [])],
    ...(seance.annulee
      ? { alerte: `${LIBELLE_ANNULEE} — ${seance.motifAnnulation?.trim() || "motif non précisé"}` }
      : { grand: taux, grandLibelle: effectif }),
  });
}
