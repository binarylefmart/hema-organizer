import { formatDateLongue, formatHoraire } from "@/lib/dates";
import { chiffresImage, LIBELLE_ANNULEE, planningPartage } from "@/lib/partage";
import { imagePartage, TAILLE_OG, TYPE_OG } from "../../image";
import { gardeInconnu, gardePartage } from "../../meta";

/**
 * Vignette d'aperçu du planning d'une période : le nombre de séances à venir et la prochaine.
 *
 * Le texte de remplacement est une constante (exigence de Next) : le nom du club, qui se lit en
 * base, est écrit dans la vignette par `imagePartage` — voir la vignette d'une séance.
 */
export const alt = "Prochaines séances";
export const size = TAILLE_OG;
export const contentType = TYPE_OG;

export default async function Image({ params }: { params: Promise<{ periodId: string }> }) {
  const { periodId } = await params;
  // La vignette est une route publique comme la page : elle passe par le même limiteur par IP
  if (!(await gardePartage())) return new Response("Trop de demandes", { status: 429 });

  const planning = await planningPartage(periodId);
  if (!planning) {
    // Identifiant inconnu : compté à part, comme sur la page correspondante. La vignette se
    // demande sans la page : sans ce compteur-là, le balayage d'identifiants par un robot passait
    // ici sans jamais remplir la garde sévère prévue pour lui.
    if (!(await gardeInconnu())) return new Response("Trop de demandes", { status: 429 });
    return imagePartage({ surtitre: "Partage", titre: "Ce partage n'existe pas", lignes: ["Demande un nouveau lien"] });
  }

  const { total, seances, periode } = planning;
  const prochaine = seances[0];
  const lignes = prochaine
    ? [
        `Prochaine : ${formatDateLongue(prochaine.date)}`,
        `${formatHoraire(prochaine.heureDebut, prochaine.heureFin)} — ${prochaine.lieu}`,
        prochaine.annulee ? LIBELLE_ANNULEE : chiffresImage(prochaine).effectif,
      ]
    : ["Aucune séance à venir"];

  return imagePartage({
    surtitre: "Prochaines séances",
    titre: periode.nom,
    lignes,
    grand: String(total),
    grandLibelle: `séance${total > 1 ? "s" : ""} à venir`,
  });
}
