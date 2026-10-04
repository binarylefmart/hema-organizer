import { NextResponse } from "next/server";
import {
  ANNONCES_SEANCES_LUES,
  annoncesPubliques,
  entetesPubliques,
  reponseAnnonces,
  TYPES_ANNONCE,
} from "@/lib/api-publique";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { evenementsAVenir } from "@/lib/evenements";
import { identite } from "@/lib/identite";
import { expositionPossible, portesExposition } from "@/lib/notifications/canaux";
import { prochainesSeancesPubliques } from "@/lib/partage";
import { clientIp } from "@/lib/request-info";
import { isPublicApiEnabled } from "@/lib/settings";

/**
 * `GET /api/public/annonces` — **les annonces courantes du club**, en lecture seule et sans compte :
 * le cours de demain, les cours annulés, les événements publiés. C'est le canal « Site du club »
 * de la matrice des notifications (`/admin/notifications`), vu du dehors.
 *
 * **Rien n'est envoyé ici.** C'est une *exposition* : le site vient lire, et il lit l'état actuel de
 * la base — pas un journal de messages. Voir l'en-tête de `src/lib/api-publique.ts` (section
 * ANNONCES) et `CANAUX_EXPOSITION` dans `src/lib/notifications/preferences.ts`.
 *
 * **Les gardes sont exactement celles de `prochaines-seances`, dans le même ordre**, plus une :
 *
 * 1. **l'interrupteur de publication** (« Publier les prochains cours ») — fermé, `503` et
 *    `Cache-Control: no-store`, sans toucher la base. Un refus mis en cache par un proxy survivrait
 *    à l'ouverture de la case ;
 * 2. **le limiteur par IP** — le **même seau** que l'autre route (`public_api_ip`, 60 appels/minute).
 *    Un seul budget pour l'API publique : deux seaux séparés doubleraient ce qu'un robot peut tirer
 *    du même serveur ;
 * 3. **la matrice** : notification par notification, la case « Site du club ». Aucune case cochée ⇒
 *    `annonces: []` et un `200` — le club publie, il n'a simplement rien autorisé à republier. Ce
 *    n'est pas une erreur, et un site n'a pas à traiter un 4xx pour afficher une liste vide ;
 * 4. **le CORS**, restreint à `PUBLIC_API_ORIGIN`, et le cache de 5 minutes ;
 * 5. **la mise en forme** de `src/lib/api-publique.ts`, listes blanches `versSeancePublique` et
 *    `versEvenementPublic` : aucun nom, aucun identifiant interne, aucun effectif en clair.
 *
 * Aucun paramètre : ce qui sort est décidé par les cases et par la fenêtre des annonces, pas par
 * l'appelant. Une réponse, une seule forme, un cache qui sert tout le monde.
 *
 * **Les deux premières gardes valent aussi pour `OPTIONS`**, et à l'identique sur les deux routes :
 * elles partagent leur seau, elles partagent leurs refus.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
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
    /*
     * **La matrice d'abord, la base ensuite.** On ne va chercher les séances et les événements que si
     * quelque chose a le droit de sortir : un club qui a ouvert la publication pour le seul plugin
     * WordPress ne paye donc aucune requête de plus.
     *
     * **Les deux portes se lisent une fois** (`portesExposition`), pas une fois par type :
     * `getSetting` n'est pas mémoïsé, et la même réponse était relue quatre à sept fois par appel.
     * `expositionPossible` reste le seul endroit qui les compose.
     *
     * `TYPES_ANNONCE` est vérifié contre la matrice elle-même (`typesAnnonceDeLaMatrice`) par un test
     * unitaire : la liste ne peut pas dériver de la colonne « Site du club » sans le dire.
     */
    const portes = await portesExposition();
    const autorises = (await Promise.all(TYPES_ANNONCE.map(async (type) => ((await expositionPossible(type, portes)) ? type : null)))).filter(
      (type): type is (typeof TYPES_ANNONCE)[number] => type !== null,
    );
    const club = await identite();
    if (autorises.length === 0) {
      return NextResponse.json(reponseAnnonces(club.nomClub, []), { headers: entetesPubliques(env().PUBLIC_API_ORIGIN) });
    }
    const besoinSeances = autorises.some((type) => type === "recap_veille" || type === "seance_annulee");
    const besoinEvenements = autorises.includes("evenement_nouveau");
    const [seances, evenements] = await Promise.all([
      // Les mêmes colonnes que l'autre route et que les pages de partage : rien de nominatif n'est lu.
      besoinSeances ? prochainesSeancesPubliques(ANNONCES_SEANCES_LUES) : Promise.resolve([]),
      // **Lecteur anonyme explicite** (`null`) : `evenementsAVenir` ne rend alors que les annonces
      // publiées — un brouillon ne sort pas, même si la case est cochée.
      besoinEvenements ? evenementsAVenir(null) : Promise.resolve([]),
    ]);
    return NextResponse.json(reponseAnnonces(club.nomClub, annoncesPubliques({ seances, evenements, types: autorises })), {
      headers: entetesPubliques(env().PUBLIC_API_ORIGIN),
    });
  } catch (e) {
    console.error("[api-publique] annonces", e);
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
