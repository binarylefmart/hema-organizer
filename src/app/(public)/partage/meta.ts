import type { Metadata } from "next";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { baseUrl } from "@/lib/env";
import { identite } from "@/lib/identite";
import { clientIp } from "@/lib/request-info";

/**
 * Deux services communs aux pages de partage : l'aperçu enrichi (Open Graph / Twitter Card) et la
 * garde de débit. Une page publique n'a ni session ni jeton à opposer à un robot : le seul
 * garde-fou est le limiteur par IP, le même mécanisme que pour les liens d'invitation.
 */

/**
 * Métadonnées d'aperçu « embarqué » : ce qui s'affiche quand le lien est collé dans WhatsApp,
 * Signal, Discord ou LinkedIn. L'image est produite par `opengraph-image.tsx` du même segment,
 * que Next déclare automatiquement (og:image, dimensions et type).
 *
 * `noindex` : ces pages sont faites pour être partagées de la main à la main, pas pour être
 * référencées — un moteur n'a pas à publier les chiffres de fréquentation du club.
 *
 * Asynchrone parce que le nom du club est une donnée, lue par `identite()` : la lecture est mise en
 * cache pour la requête, et les `generateMetadata` qui appellent cette fonction sont déjà `async`.
 */
export async function metadonneesPartage({ titre, description, chemin }: { titre: string; description: string; chemin: string }): Promise<Metadata> {
  const club = await identite();
  const url = `${baseUrl()}${chemin}`;
  return {
    metadataBase: new URL(baseUrl()),
    title: titre,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      // Tant que personne n'a nommé le club, `nomClub` vaut déjà le nom de l'application : on ne
      // l'écrit pas deux fois de suite dans le nom du site.
      siteName: club.club ? `${club.nomClub} — ${club.nomCourt}` : club.nomCourt,
      title: titre,
      description,
      locale: "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title: titre,
      description,
    },
  };
}

/** Une visite de plus depuis cette IP est-elle admise ? */
export async function gardePartage(): Promise<boolean> {
  return checkRateLimit("partage_ip", await clientIp());
}

/**
 * Identifiant inconnu : on compte à part (balayage d'identifiants par un robot), plus sévèrement
 * que les visites normales. Retourne `false` quand l'IP a dépassé le quota.
 */
export async function gardeInconnu(): Promise<boolean> {
  return checkRateLimit("partage_inconnu_ip", await clientIp());
}

export const TROP_DE_DEMANDES = "Trop de pages de partage demandées depuis ta connexion. Réessaie dans quelques minutes.";
