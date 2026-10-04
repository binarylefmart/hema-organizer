import { NextResponse, type NextRequest } from "next/server";
import { DUREE_SUITE_MS, SESSION_COOKIE, SUITE_COOKIE } from "@/lib/constants";

/**
 * Middleware (edge) :
 * - en-têtes de sécurité (CSP stricte avec nonce, X-Frame-Options, Referrer-Policy…)
 * - garde d'authentification légère : sans cookie de session, redirection vers /connexion
 *   (la validation réelle de la session se fait côté serveur dans les pages/actions).
 * - mémorisation de la page demandée (« suite ») : dans l'URL de /connexion et dans un cookie
 *   court, pour la retrouver même si la personne passe par son lien personnel (email) entre-temps.
 */

/**
 * **La barre finale compte.** `/invitation/<jeton>/` n'était pas reconnu comme public : le chemin
 * était alors traité comme privé, et le jeton recopié dans `?suite=` de la page de connexion **et**
 * dans un cookie de 30 minutes — précisément ce que tout le reste du code s'interdit. D'où le `/?`
 * final sur les quatre motifs qui portent un jeton.
 */
const CHEMINS_PUBLICS = [
  /^\/connexion$/,
  /^\/connexion\/code$/,
  /^\/invitation\/[^/]+\/?$/,
  /^\/mot-de-passe-oublie$/,
  /^\/reinitialiser\/[^/]+\/?$/,
  /^\/annuler\/[^/]+\/?$/,
  /^\/desinscription\/[^/]+\/?$/,
  // Pages publiques de partage (résumé d'une séance / du planning) et leurs images d'aperçu
  // (Next suffixe la route de l'image d'un identifiant de version : « /opengraph-image-1nbrup »).
  // Barre finale tolérée ici aussi : `[^/]+` interdit toujours un segment de plus, le motif ne
  // s'ouvre donc qu'à `/partage/seance/<id>/`, pas à un sous-chemin.
  /^\/partage\/(seance|planning|evenement)\/[^/]+(\/opengraph-image[^/]*)?\/?$/,
  // Affiches d'événements : elles s'affichent sur les pages de partage publiques
  // (/partage/evenement/<id>) et dans les aperçus Open Graph, donc sans session. Le nom de
  // fichier est un SHA-256 opaque (rien à deviner), et ces affiches sont faites pour être vues.
  /^\/api\/affiche\//,
  /^\/api\/health$/,
  /^\/api\/public(\/|$)/,
  /^\/manifest\.webmanifest$/,
  /^\/sw\.js$/,
  /^\/logo(-ecu)?\.png$/,
  /^\/icons\//,
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const estPublic = CHEMINS_PUBLICS.some((re) => re.test(pathname));
  // Chemin interne demandé, paramètres compris (« /?seance=…&reponse=present » depuis un email de rappel)
  const demande = pathname + search;

  if (!estPublic && !request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    // Un chemin porteur de jeton ne se recopie **jamais** : ni dans l'adresse, ni dans le cookie de
    // retour. Les motifs ci-dessus le rendent déjà improbable ; ceci le rend impossible, y compris
    // pour une variante d'URL à laquelle personne n'a pensé.
    const porteUnJeton = /^\/(invitation|reinitialiser|annuler|desinscription)\//.test(pathname);
    const retour = porteUnJeton ? "/" : demande;
    url.search = retour !== "/" ? `?suite=${encodeURIComponent(retour)}` : "";
    const redirection = NextResponse.redirect(url);
    // Le détour par la boîte mail (lien personnel) fait perdre l'URL : on la garde aussi côté navigateur
    if (retour !== "/") {
      redirection.cookies.set(SUITE_COOKIE, retour, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: DUREE_SUITE_MS / 1000,
      });
    } else {
      redirection.cookies.delete(SUITE_COOKIE);
    }
    return enTetesSecurite(redirection, "default-src 'none'; frame-ancestors 'none'");
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const cspApplication = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  /*
   * **Le relais d'image reçoit une CSP à lui, et c'est ici qu'elle doit être posée**.
   *
   * `/api/image` posait `default-src 'none'; sandbox` sur sa propre réponse — et cet en-tête **n'arrivait
   * jamais au navigateur** : Next n'ajoute un en-tête de route que si la réponse n'en porte pas déjà un du
   * même nom, et le middleware avait posé la CSP de l'application avant d'appeler la route. Du code qui ne
   * fait rien et qu'un relecteur croit actif.
   *
   * Pourquoi ça compte sur cette route et pas ailleurs : elle sert, **depuis notre origine**, des octets
   * venus d'un hôte tiers, et elle prend le type à la parole du serveur distant (contrairement à
   * `/api/affiche`, qui le déduit des octets). Le `sandbox` est la seconde ceinture derrière ce type. Rien
   * de scriptable ne passe la liste blanche (SVG en est exclu) et `nosniff` est posé : il n'y a pas de
   * chemin praticable, c'est une défense en profondeur — mais elle existe, maintenant.
   */
  const csp = pathname === "/api/image" ? "default-src 'none'; sandbox" : cspApplication;

  const requestHeaders = new Headers(request.headers);
  /*
   * **Le nonce voyage par la CSP de requête, pas par `x-nonce`**. Cet en-tête n'était lu nulle
   * part : Next relit le `nonce-…` de l'en-tête `Content-Security-Policy` de la **requête**
   * (`get-script-nonce-from-header`) et l'applique lui-même à ses balises. On le garde parce qu'un
   * composant serveur pourrait vouloir le lire un jour (une balise `<style>` à nous), et le
   * commentaire évite de croire que c'est lui qui fait marcher la CSP — c'est la ligne d'en
   * dessous.
   */
  requestHeaders.set("x-nonce", nonce);
  // Page en cours : permet aux layouts (rendus avant les pages) de renvoyer vers /connexion avec la bonne « suite »
  requestHeaders.set("x-chemin", demande);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return enTetesSecurite(response, csp);
}

/**
 * Les en-têtes de sécurité, posés sur **toute** réponse qui sort d'ici — y compris la redirection
 * vers la connexion, qui sortait sans. Elle n'a pas de corps, donc rien n'en dépendait en pratique ;
 * mais une réponse qui échappe à la règle est une exception qu'il faudra se rappeler, et celle-ci
 * ne coûte rien à supprimer.
 */
function enTetesSecurite(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  /*
   * **`origin` : le chemin ne sort jamais, l'origine si**. C'est la correction d'une fuite réelle
   * de jeton — puis la correction de sa propre correction, qui fermait la porte d'entrée du club.
   *
   * `strict-origin-when-cross-origin` ne réduit le référent à l'origine que **cross-origin** : pour une
   * requête **same-origin**, le navigateur envoie l'**URL entière**. Or `/invitation/<jeton>` est une vraie
   * page HTML (c'est le découpage voulu : un GET ne consomme rien, c'est l'appui qui pose la session), et
   * le navigateur y charge donc ses propres sous-ressources — les morceaux de JavaScript, la feuille de
   * style, le logo. Chacune de ces requêtes portait
   * `Referer: https://…/invitation/<jeton>`.
   *
   * Et ces requêtes-là ne tombent **pas** dans le `location ~ ^/invitation/` du proxy, où le dossier fait
   * couper le journal d'accès : elles tombent dans le `location /` par défaut, dont le format journalise
   * `"$http_referer"`. Le remède qu'on avait écrit protégeait la ligne de l'invitation et laissait le
   * jeton ressortir dix lignes plus bas, dans le même fichier — un fichier sauvegardé, recopié sur le
   * partage, et lisible par qui administre le proxy. Un jeton de lien personnel vaut **quatre mois** et
   * connecte sans second facteur ; la rétention de sept jours du journal ne borne rien.
   *
   * **Ce qui a été posé d'abord, et pourquoi ça ne tenait pas : `no-referrer`.** L'argument était
   * qu'il ne coûtait rien — aucune ressource tierce (la CSP est `default-src 'self'`), rien dans le
   * code ne lit `Referer`, les liens sortants portent `rel="noopener noreferrer"`. Il manquait un
   * lecteur : **le navigateur lui-même**. Avec `no-referrer`, Chrome envoie `Origin: null` sur un
   * **POST de formulaire**, et Next.js ouvre son contrôle anti-CSRF par `new
   * URL(req.headers['origin'])` — d'où un `TypeError: Invalid URL` et une **500**. Le formulaire
   * concerné est celui de `/invitation/<jeton>` : la porte d'entrée de tout le club. Mesuré : appui
   * **avant** la fin de l'hydratation (le POST natif de l'amélioration progressive, c'est-à-dire un
   * téléphone lent ou un doigt rapide) → 500 ou page rechargée sans rien faire ; appui après → la
   * requête part en `fetch` et passe. « Des fois ça ne marche pas », donc, et la cause n'était pas
   * dans notre code.
   *
   * **`origin` tient les deux bouts** : le référent est réduit à `https://<domaine>/` — **le jeton ne
   * sort pas**, y compris pour les sous-ressources de la page du lien, qui était tout l'objet de la
   * correction du matin (le journal du proxy les enregistre avec `"$http_referer"`) — et l'en-tête
   * `Origin` redevient une URL que Next sait lire. Vérifié des deux côtés : aucun référent ne porte le
   * jeton, et l'appui sans JavaScript ouvre bien la session (`tests/e2e/zzz-lien-sans-js.spec.ts`).
   *
   * Ce qu'on perd par rapport à `no-referrer` : les sites tiers vers lesquels on enverrait quelqu'un
   * apprendraient notre domaine. Il est écrit dans chaque email que le club envoie.
   */
  response.headers.set("Referrer-Policy", "origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  /*
   * **Une réponse de cette application ne se garde pas en cache partagé**.
   *
   * Rien ne cassait aujourd'hui : le layout racine lit la session, donc Next rend **toutes** les pages
   * dynamiques et pose lui-même `private, no-store`. Mais la protection était **accidentelle** — un
   * `revalidate` posé un jour sur une page de partage, ou une redirection passée de 307 à 308, et une page
   * personnelle devient partageable par un proxy. Toute la décision de ce middleware dépend du cookie de
   * session : on le dit, au lieu d'en dépendre sans le dire.
   */
  response.headers.set("Vary", "Cookie");
  return response;
}

export const config = {
  matcher: [
    // Tout sauf les fichiers statiques de Next
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
