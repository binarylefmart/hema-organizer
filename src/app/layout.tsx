import type { Metadata, Viewport } from "next";
import { IM_Fell_Great_Primer_SC } from "next/font/google";
import { getCurrentUser } from "@/lib/auth/current-user";
import { identite } from "@/lib/identite";
import { choixOuDefaut } from "@/lib/themes";
import { RelanceRendu } from "@/components/layout/RelanceRendu";
import "./globals.css";
import { poserFuseau } from "@/lib/fuseau";

// Police des titres : une romaine à empattements anciens, dans l'esprit des traités d'escrime
const fell = IM_Fell_Great_Primer_SC({
  variable: "--font-fell",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

/**
 * **Le nom et les icônes viennent de l'identité du club**, pas d'une constante : c'est la même
 * lecture que celle du manifeste (`src/app/manifest.ts`) et de l'en-tête, mise en cache pour la
 * requête. Un club qui change son nom dans l'espace admin voit changer le titre de l'onglet, le nom
 * de l'application installée et l'icône, sans qu'on reconstruise l'image.
 */
export async function generateMetadata(): Promise<Metadata> {
  const club = await identite();
  return {
    title: { default: club.nomCourt, template: `%s — ${club.nomCourt}` },
    description: club.club ? `Indique ta présence aux cours de ${club.club}.` : "Indique ta présence aux cours de ton club.",
    applicationName: club.nomLong,
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: club.nomCourt, statusBarStyle: "default" },
    // Écu déposé s'il y en a un, sinon les icônes livrées avec le code.
    icons: club.ecuDepose
      ? { icon: club.ecu, apple: club.ecu }
      : { icon: "/icons/icone-192.png", apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  // Encre de l'en-tête : la barre du navigateur prolonge la barre de l'application
  themeColor: "#2B2622",
  width: "device-width",
  initialScale: 1,
  /**
   * **Indispensable à l'application installée sur iPhone.** Sans `viewport-fit=cover`, iOS met la
   * page en page dans une zone réduite, et les `env(safe-area-inset-*)` que la barre de navigation
   * du bas utilise pour s'écarter de la barre de gestes valent tous zéro : la barre se retrouve
   * décrochée du bas de l'écran. C'est la configuration standard d'une PWA en plein écran, et elle
   * manquait ici — le manifeste déclare pourtant `display: standalone` depuis le début.
   */
  viewportFit: "cover",
};

/**
 * Palette appliquée, posée sur `<html data-theme=…>`.
 *
 * **Pourquoi ici, et nulle part ailleurs ?** Les variables de couleur sont déclarées sur `:root`
 * (voir globals.css) : seule la balise `<html>` peut donc porter le thème, et c'est la mise en page
 * racine qui la rend. Le faire côté serveur évite le clignotement classique d'un thème appliqué
 * après coup en JavaScript — la première image peinte est déjà la bonne.
 *
 * **Deux choix, dans cet ordre** : celui du membre s'il en a fait un, sinon **celui du club**
 * (réglé dans *Identité*). Presque personne n'ouvre « Mon profil » : c'est donc le thème du club
 * qui décide des couleurs pour la quasi-totalité des écrans, et c'est ce qui permet à un club de
 * déployer l'outil à ses couleurs sans demander quoi que ce soit à ses membres.
 *
 * **Le mode suit le choix** : un thème pris dans « Mon profil » est clair ou sombre et s'impose
 * (`data-mode`) ; le thème du club, lui, laisse l'appareil décider.
 *
 * **Contrepartie assumée** : lire la session ici rend le rendu dynamique pour *toutes* les pages, y
 * compris les pages publiques `/partage/*`. C'est acceptable pour un outil de club (base SQLite
 * locale, quelques dizaines de visiteurs), et ça évite d'avoir à tenir un second mécanisme (un
 * cookie de thème) en parallèle de la base.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // `getCurrentUser` et `identite` sont mis en cache pour la durée de la requête : la session est de
  // toute façon lue une fois par page, et l'identité l'est déjà par les métadonnées.
  const [user, club] = await Promise.all([getCurrentUser(), identite()]);
  const theme = choixOuDefaut(user?.theme, club.theme);
  // Garde le fuseau du serveur aligné sur le réglage, même si un autre processus l'a changé.
  poserFuseau(club.fuseau);
  return (
    <html
      lang="fr"
      className={fell.variable}
      data-theme={theme.id}
      /* **Le fuseau du club, pour le navigateur** (`src/lib/fuseau.ts`) : présent dans le HTML avant
         l'hydratation, il fait calculer au navigateur les mêmes dates que le serveur. */
      data-fuseau={club.fuseau}
      data-mode={theme.mode ?? undefined}
      /* **La couleur de marque du club, quand elle est réglée.** Une seule variable posée en ligne,
         par-dessus celle du thème : c'est le nom du club dans l'en-tête et les liserés qui la
         portent. Réglée à vide, rien n'est écrit et le thème garde la main — on ne veut pas d'une
         palette à moitié remplacée. */
      style={club.marque ? ({ "--marque": club.marque } as React.CSSProperties) : undefined}
    >
      <body>
        {children}
        {/* Débloque une transition que React aurait laissée suspendue après une réponse du
            serveur (voir `src/lib/relance-rendu.ts`). Ne dessine rien. */}
        <RelanceRendu />
      </body>
    </html>
  );
}
