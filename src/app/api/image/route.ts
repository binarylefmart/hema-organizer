import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { db } from "@/lib/db";
import { ErreurApercu, IMAGE_CACHE_SECONDES, imageApercuAutorisee, recupererImage, URL_MAX_LONGUEUR } from "@/lib/lien-apercu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * **Un seul message pour tout échec réseau.** Les messages de `lien-apercu.ts` sont précis à
 * dessein — ils s'affichent à l'instructeur qui vient de coller un lien, et « nom de domaine
 * inconnu » lui apprend quelque chose. Ici, renvoyés au navigateur de n'importe quel membre, les
 * mêmes phrases distinguaient « nom de domaine inconnu », « met trop de temps à répondre »,
 * « demande une connexion », « erreur 404 » et « a répondu par une erreur (500) » : c'est un oracle,
 * qui répond par écrit à « cet hôte existe-t-il ? », « ce port est-il ouvert ? », « cette page
 * existe-t-elle ? ». Le détail reste dans les journaux du serveur, là où il sert à diagnostiquer.
 */
const ECHEC_RESEAU = "Cette image n'a pas pu être chargée.";
/** Refus d'adresse : il ne parle que de nous, jamais de l'hôte visé. */
const ADRESSE_INCONNUE = "Cette adresse n'est pas celle d'une affiche du club.";

/**
 * Relais d'image distante : /api/image?url=<URL de l'illustration d'un lien>.
 *
 * Pourquoi un relais plutôt qu'un `img-src` élargi ? La CSP de l'application est stricte
 * (`img-src 'self' data: blob:`, voir src/middleware.ts) : autoriser « n'importe quel domaine »
 * en source d'images pour afficher l'aperçu d'un lien reviendrait à affaiblir la page entière,
 * et à laisser chaque navigateur de membre appeler un serveur tiers (fuite d'IP, pisteurs).
 * On rapatrie donc l'image côté serveur, avec **exactement** les mêmes protections que l'aperçu :
 * schéma http/https, refus de toute adresse privée/locale/réservée revérifiée à chaque
 * redirection (3 au maximum), délai court, taille plafonnée à 3 Mo, type image exigé —
 * SVG explicitement exclu (un SVG servi depuis notre origine peut porter du script).
 * L'interface stocke l'URL d'origine et l'affiche par ici.
 *
 * **Et la route ne rapatrie que des adresses que le serveur connaît déjà**. Elle ne vérifiait
 * *jamais* que le paramètre `url` correspondait à quoi que ce soit : n'importe quel MEMBRE — une
 * session s'ouvre par simple lien personnel, sans mot de passe — pouvait faire chercher n'importe
 * quelle adresse publique, sur n'importe quel port, 300 fois par quart d'heure, **depuis l'adresse
 * IP du club et avec un `User-Agent` qui nomme son domaine**. Le réseau interne n'était pas en jeu
 * (la garde de `lien-apercu.ts` est stricte et revérifiée à chaque saut) : ce qui était en jeu,
 * c'est la **réputation de notre adresse**, et le fait qu'un balayage mené de chez nous se lit
 * comme un balayage de chez nous. Deux sources d'adresses, donc, et deux seulement :
 *
 *  1. l'affiche d'un **événement enregistré** (`Evenement.imageUrl`, lue en base) — c'est ce que
 *     servent les cartes, la fiche et le bandeau ;
 *  2. l'illustration qu'un **aperçu de lien** vient de proposer, retenue une heure par
 *     `lien-apercu.ts` — c'est le formulaire d'événement, qui montre l'affiche avant d'enregistrer.
 *
 * Le reste est refusé sans aller sur le réseau. Une adresse tapée à la main dans la barre du
 * navigateur n'aboutit donc plus, et c'est l'intention.
 */
export async function GET(req: NextRequest) {
  // Route non publique (middleware) : on revérifie tout de même la session côté serveur.
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Accès refusé", { status: 403, headers: NO_STORE });
  if (!(await checkRateLimit("image_distante_user", user.id))) {
    return new NextResponse("Trop d'images demandées, réessaie dans quelques minutes.", { status: 429, headers: NO_STORE });
  }

  const cible = req.nextUrl.searchParams.get("url") ?? "";
  // Le refus tombe **avant** toute requête sortante : c'est tout l'objet de la garde.
  if (!(await adresseConnue(cible))) return new NextResponse(ADRESSE_INCONNUE, { status: 400, headers: NO_STORE });

  try {
    const { octets, typeContenu } = await recupererImage(cible);
    // ArrayBuffer : corps de réponse accepté tel quel, sans recopie inutile côté Next
    const corps = octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer;
    return new NextResponse(corps, {
      status: 200,
      headers: {
        "Content-Type": typeContenu,
        "Content-Length": String(octets.byteLength),
        // Cache d'une journée, côté navigateur uniquement (la route est derrière une session)
        "Cache-Control": `private, max-age=${IMAGE_CACHE_SECONDES}`,
        "X-Content-Type-Options": "nosniff",
        /*
         * **La CSP stricte et `Referrer-Policy` ne sont plus posées ici** : elles ne sortaient pas.
         * Next n'ajoute un en-tête de route que si la réponse n'en porte pas déjà un du même nom,
         * et le middleware avait posé la CSP de l'application **avant** d'appeler cette route. Les
         * deux lignes étaient donc du code mort qu'un relecteur croyait actif. La CSP `default-src
         * 'none'; sandbox` de ce relais vit désormais dans `src/middleware.ts`, où elle survit, et
         * le `Referrer-Policy` de toute l'application s'y décide aussi — **`origin`**, et non
         * `no-referrer` comme cette phrase l'a longtemps affirmé : `no-referrer` a été abandonné,
         * parce qu'il faisait répondre 500 au POST natif de `/invitation/<jeton>`, et le
         * commentaire du middleware le raconte. `Cross-Origin-Resource-Policy` reste ici : le
         * middleware ne pose pas ce nom, donc celle-ci arrive bien.
         */
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (e) {
    // Un seul verdict, un seul statut, quelle que soit la raison : voir `ECHEC_RESEAU`.
    if (e instanceof ErreurApercu) console.info(`[/api/image] refus : ${e.message}`);
    else console.error("[/api/image] échec inattendu", e);
    return new NextResponse(ECHEC_RESEAU, { status: 502, headers: NO_STORE });
  }
}

/**
 * Cette adresse est-elle l'une des deux que nous acceptons de rapatrier ?
 *
 * La comparaison est une **égalité de chaînes**, sans normalisation : `sourceImage`
 * (`src/components/evenements/libelles.ts`) renvoie exactement ce que la base contient, et
 * `recupererApercu` exactement ce qu'il a retenu. Normaliser ici ferait deux écritures d'une même
 * adresse — celle qu'on compare et celle qu'on va chercher — et c'est ainsi qu'une liste blanche
 * devient contournable.
 *
 * Le registre d'abord : il tient en mémoire et évite une requête au cas le plus fréquent du
 * formulaire d'événement.
 */
async function adresseConnue(url: string): Promise<boolean> {
  const cible = url.trim();
  if (!cible || cible.length > URL_MAX_LONGUEUR) return false;
  /*
   * **Seule une adresse absolue `http(s)` peut être connue**.
   *
   * `afficheSchema` accepte aussi le chemin interne `/api/affiche/<sha256>.<ext>` d'une affiche déposée,
   * et cette fonction se contentait de comparer à la base. En aval, `validerUrlSaisie` complète le schéma
   * manquant — `"/api/affiche/x.png"` devenait donc `https://api/affiche/x.png`, avec `api` pour **nom
   * d'hôte**, que le résolveur du conteneur allait chercher via son domaine de recherche. L'interface
   * n'envoie jamais un chemin relatif au relais ; une requête à la main, si.
   *
   * La garde d'adresse en aval refusait un résultat privé, donc rien ne fuyait — mais un relais qui
   * fabrique un nom d'hôte à partir d'un chemin interne n'a aucune raison d'exister.
   */
  if (!/^https?:\/\//i.test(cible)) return false;
  if (imageApercuAutorisee(cible)) return true;
  try {
    return (await db.evenement.count({ where: { imageUrl: cible } })) > 0;
  } catch (e) {
    // Base illisible : on refuse. Une garde qui s'ouvre en cas de panne n'est pas une garde.
    console.error("[/api/image] impossible de vérifier l'affiche en base", e);
    return false;
  }
}
