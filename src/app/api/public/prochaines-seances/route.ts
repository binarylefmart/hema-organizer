import { NextResponse } from "next/server";
import { entetesPubliques, limiteDemandee, reponsePublique } from "@/lib/api-publique";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { identite } from "@/lib/identite";
import { prochainesSeancesPubliques } from "@/lib/partage";
import { clientIp } from "@/lib/request-info";
import { isPublicApiEnabled } from "@/lib/settings";

/**
 * `GET /api/public/prochaines-seances?limit=5` — les prochains cours du club, en lecture seule et
 * sans compte : c'est ce que le site WordPress du club affiche sur sa page d'accueil (le plugin
 * fourni dans `wordpress-plugin/`).
 *
 * Quatre gardes, dans cet ordre :
 * 1. **l'interrupteur** de l'espace admin (« API publique activée ») — coupé, la route ne répond
 *    plus rien d'autre qu'un 503, sans toucher la base ;
 * 2. **le limiteur par IP** (`public_api_ip`, 60 appels/minute) — une page publique n'a ni session
 *    ni jeton à opposer à un robot ;
 * 3. **le CORS**, restreint à `PUBLIC_API_ORIGIN` : le navigateur d'un autre site ne lira pas
 *    cette réponse en JavaScript (un serveur, lui, le peut toujours — c'est une API publique, et
 *    le plugin WordPress appelle justement depuis le serveur) ;
 * 4. **la mise en forme** de `src/lib/api-publique.ts`, qui ne recopie que ce qui est publiable.
 *
 * **Les deux premières valent aussi pour `OPTIONS`** : une garde qui ne tient qu'un verbe sur deux
 * n'en est pas une.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  if (!(await isPublicApiEnabled())) {
    return NextResponse.json({ erreur: "API publique désactivée" }, { status: 503, headers: NO_STORE });
  }
  if (!(await checkRateLimit("public_api_ip", await clientIp()))) {
    return NextResponse.json(
      { erreur: "Trop de demandes. Réessaie dans une minute." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }
  try {
    const limite = limiteDemandee(new URL(request.url).searchParams.get("limit"));
    const seances = await prochainesSeancesPubliques(limite);
    // Le nom du club voyage dans la réponse : il se lit en base (écran *Identité*), il n'est plus
    // écrit dans le code — c'est ce nom-là que le site affiche au-dessus des cartes.
    const club = await identite();
    return NextResponse.json(reponsePublique(club.nomClub, seances), {
      headers: entetesPubliques(env().PUBLIC_API_ORIGIN),
    });
  } catch (e) {
    console.error("[api-publique] prochaines séances", e);
    return NextResponse.json({ erreur: "Service indisponible" }, { status: 503, headers: NO_STORE });
  }
}

/**
 * Requête préalable du navigateur (CORS) : mêmes en-têtes, pas de corps — **et les deux mêmes
 * gardes que `GET`, dans le même ordre**.
 *
 * Elle répondait `204` avec l'origine autorisée du site du club alors que `GET` rendait `503`, et
 * elle n'entrait dans aucun seau. Deux conséquences, la seconde plus gênante que la première :
 * publication **fermée**, un `curl -X OPTIONS` annonçait tout de même qu'une API vit ici et pour
 * quelle origine elle est ouverte — un interrupteur qui coupe la moitié des verbes n'est pas un
 * interrupteur ; et les « 60 appels/min/IP » écrits dans `docs/SECURITE.md` ne couvraient qu'un
 * verbe sur deux, alors qu'un préalable coûte au serveur exactement ce que coûte n'importe quelle
 * requête. Un refus ne porte donc **aucun** en-tête CORS : il n'y a rien à autoriser quand il n'y a
 * rien à lire.
 *
 * **Parité exacte avec l'autre route publique**, vérifiée par `tests/unit/api-publique-options.test.ts` :
 * les deux portes partagent leur seau, elles doivent partager leurs refus.
 */
export async function OPTIONS() {
  if (!(await isPublicApiEnabled())) return new Response(null, { status: 503, headers: NO_STORE });
  if (!(await checkRateLimit("public_api_ip", await clientIp()))) {
    return new Response(null, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
  return new Response(null, { status: 204, headers: entetesPubliques(env().PUBLIC_API_ORIGIN) });
}
