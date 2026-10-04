import type { MetadataRoute } from "next";
import { identite } from "@/lib/identite";

/**
 * **Le manifeste PWA, engendré à chaque demande** (servi sur `/manifest.webmanifest`).
 *
 * C'était un fichier figé dans `public/`, où le nom du club et ses icônes étaient écrits en dur :
 * l'application installée sur un téléphone s'appelait « HEMA Organizer » chez tout le monde, quel que
 * soit le club. Il se lit désormais dans l'identité — nom, nom court, icône déposée —, ce qui veut
 * dire qu'un club qui se nomme dans l'espace admin voit changer le nom de l'application **installée**
 * sur les téléphones, sans reconstruire l'image.
 *
 * `force-dynamic` est indispensable : sans lui, Next tenterait de fabriquer ce fichier pendant le
 * `build`, où il n'y a pas de base à lire — le build échouerait.
 *
 * **Pas de limiteur de débit ici non plus** : `identite()` est mise en cache pour la durée de la
 * requête et ne lit qu'une ligne de `Setting`, quand le limiteur du projet, lui, écrit en base à
 * *chaque* appel — la garde coûterait plus cher que ce qu'elle garde. Un navigateur ne demande ce
 * fichier qu'à l'installation de l'application. Le débit gratuit se borne au proxy (`limit_req`,
 * voir `docs/SECURITE.md`).
 */
export const dynamic = "force-dynamic";

/** Type MIME d'une image déposée, d'après l'extension de son nom (elle vient de ses octets). */
function typeImage(url: string): string {
  if (url.endsWith(".jpg")) return "image/jpeg";
  if (url.endsWith(".webp")) return "image/webp";
  return "image/png";
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const club = await identite();
  return {
    name: club.nomLong,
    short_name: club.nomCourt,
    description: club.club ? `Indique ta présence aux cours de ${club.club}.` : "Indique ta présence aux cours de ton club.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#2B2622",
    background_color: "#F4F0EE",
    /*
     * **Une seule image quand l'écu a été déposé.** Les tailles d'un manifeste sont des *indices* :
     * `"any"` dit au système « sers-toi de celle-là, à toutes les tailles », et il la redimensionne.
     * C'est le choix assumé de ne pas fabriquer les variantes côté serveur (ce serait une
     * dépendance de traitement d'image dans l'image de production, pour un gain invisible sur un
     * logo déjà carré) ; le script `npm run icons:generate` reste là pour qui veut les tailles
     * exactes et peut redéployer.
     *
     * `purpose` est omis dans ce cas : déclarer `maskable` une image dont on ne connaît pas les
     * marges ferait rogner le logo en rond sur Android. Sans la mention, le système ajoute son
     * propre cadre — moins beau, mais jamais amputé.
     */
    icons: club.ecuDepose
      ? [{ src: club.ecu, sizes: "any", type: typeImage(club.ecu) }]
      : [
          { src: "/icons/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
  };
}
