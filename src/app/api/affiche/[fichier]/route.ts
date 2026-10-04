import { NextResponse } from "next/server";
import { lireAffiche } from "@/lib/affiches";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/request-info";

export const runtime = "nodejs";

type Props = { params: Promise<{ fichier: string }> };

/**
 * Sert une affiche d'événement déposée dans le formulaire : /api/affiche/<sha256>.<ext>.
 *
 * Route publique (voir CHEMINS_PUBLICS dans src/middleware.ts) : l'affiche accompagne les pages
 * de partage et les aperçus Open Graph, que des personnes non connectées ouvrent.
 *
 * `lireAffiche` valide le nom et refuse toute traversée de répertoire : on lui passe le paramètre
 * tel quel et on ne construit **jamais** de chemin ici. Introuvable — ou nom refusé — : 404 sobre,
 * sans dire lequel des deux.
 *
 * Cache « immutable » d'un an : le nom du fichier **est** le SHA-256 de son contenu, donc une URL
 * donnée ne peut jamais désigner une autre image. Remplacer l'affiche d'un événement produit un
 * autre nom, donc une autre URL — rien à invalider.
 *
 * **Un limiteur par IP, comme les autres portes publiques** (`affiche_ip`). Il ne protège aucun
 * secret — une affiche est faite pour être vue, et son adresse circule avec les annonces — mais une
 * boucle sur cette route fait lire jusqu'à 4 Mo sur le disque à chaque appel, sur une instance
 * unique qui sert aussi les réponses de présence du soir. C'est du débit gratuit, pris à ceux qui
 * cliquent. Le plafond est large exprès : une page en affiche plusieurs.
 */
export async function GET(_req: Request, { params }: Props) {
  if (!(await checkRateLimit("affiche_ip", await clientIp()))) {
    return new NextResponse("Trop de demandes.", { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
  const { fichier } = await params;
  const affiche = await lireAffiche(fichier);
  if (!affiche) return new NextResponse("Affiche introuvable.", { status: 404, headers: { "Cache-Control": "no-store" } });

  const corps = affiche.octets.buffer.slice(affiche.octets.byteOffset, affiche.octets.byteOffset + affiche.octets.byteLength) as ArrayBuffer;
  return new NextResponse(corps, {
    status: 200,
    headers: {
      "Content-Type": affiche.type,
      "Content-Length": String(affiche.octets.byteLength),
      // Type déduit des octets à l'enregistrement : on interdit au navigateur de le redeviner.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
