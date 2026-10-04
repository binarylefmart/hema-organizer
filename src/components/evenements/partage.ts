import { baseUrl } from "@/lib/env";
import { lienPartageWhatsApp } from "@/lib/notifications/whatsapp";
import type { Partage } from "@/components/partage/contenu";
import { dateEvenement, horaireEvenement, libelleDuree, libellePrix, type EvenementAffiche } from "./libelles";

/**
 * **Ce qui part quand on partage un événement** — le message, le lien public, et l'adresse `wa.me`.
 *
 * Même doctrine que le partage d'une séance (`src/components/partage/contenu.ts`) : tout est
 * assemblé **côté serveur**, et le texte ne dit rien de plus que ce que la page publique
 * `/partage/evenement/<id>` montre déjà — ni nom de membre, ni chiffre interne. Les pictogrammes
 * sont ceux du contenu commun des notifications : c'est un message pour WhatsApp, pas de
 * l'interface (où le club n'en veut aucun).
 *
 * Écrit ici plutôt que dans `src/components/partage/` : ce dossier est celui d'un autre chantier,
 * et le composant `BoutonPartager` ne demande qu'un objet `Partage` tout fait.
 */
export function partageEvenement(e: EvenementAffiche): Partage {
  const url = `${baseUrl()}/partage/evenement/${e.id}`;
  const horaire = horaireEvenement(e.heureDebut, e.heureFin);
  const duree = libelleDuree(e.dureeNombre, e.dureeUnite);
  const titre = `🗡️ ${e.nom}`;
  const lignes = [
    `📅 ${dateEvenement(e.dateDebut, e.dateFin)}${horaire ? ` — ${horaire}` : ""}`,
    ...(duree ? [`⏳ Durée : ${duree}`] : []),
    ...(e.lieu ? [`📍 ${e.lieu}`] : []),
    ...(e.organisateur ? [`👥 Organisé par ${e.organisateur}`] : []),
    // Le tarif est toujours dit : sans prix saisi, c'est « Gratuit », comme sur la page publique
    `🏷️ ${libellePrix(e.prix, e.prixAdherent)}`,
    ...(e.lienInscription ? [`👉 Inscriptions : ${e.lienInscription}`] : []),
  ];
  const texte = [titre, ...lignes].join("\n");
  return { titre, texte, url, whatsapp: lienPartageWhatsApp(`${texte}\n${url}`) };
}
