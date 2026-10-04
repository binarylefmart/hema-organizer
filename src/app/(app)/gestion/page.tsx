import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";

/**
 * `/gestion` n'a plus d'écran à elle : l'aperçu faisait doublon avec la page d'accueil, devenue le
 * compte rendu de l'association (indicateurs, prochaines séances, prochain événement), et les
 * séances ont rejoint l'onglet Séances de la barre principale. Depuis, les membres et les périodes
 * sont partis dans l'espace admin : la section s'ouvre donc sur **Ateliers**, la porte la plus
 * utilisée de ce qui reste — et la seule qui ne suppose aucune élévation.
 *
 * On garde une page qui **redirige** plutôt que de supprimer le fichier : des liens existants mènent
 * à `/gestion` — l'onglet « Espace instructeur » de l'en-tête, le cookie de reprise après connexion,
 * les parcours e2e — et sans page, Next répondrait 404. La sous-navigation, elle, ne pointe plus ici.
 *
 * **Une seule règle pour les pages qui ne font que rediriger**, pour que le code et les
 * commentaires disent enfin la même chose :
 *
 * - une adresse **fossile** — que plus aucune navigation ne montre, et qui se contente de réécrire
 *   une ancienne URL vers son nouvel emplacement — ne vérifie rien : la destination garde, et elle
 *   seule (`gestion/membres`, `gestion/periodes`, `gestion/seances`). Vérifier deux fois ne
 *   protégerait rien de plus et donnerait deux refus différents selon le chemin emprunté ;
 * - une **entrée annoncée** garde, elle, avant de rediriger. `/gestion` est l'onglet « Espace
 *   instructeur » de l'en-tête : un visiteur sans droits doit être arrêté ici, pas renvoyé ailleurs
 *   pour s'y faire refouler. Même chose pour `/admin`.
 */
export default async function PageGestion() {
  await requirePermission("sessions.manage");
  redirect("/gestion/ateliers");
}
