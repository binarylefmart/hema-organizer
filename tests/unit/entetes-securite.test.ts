import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/constants";

/**
 * **Les six en-têtes de sécurité, et le jeton qui partait dans le `Referer`.**
 *
 * Aucune contre-épreuve ne touchait les en-têtes du middleware : ni la politique de sécurité du
 * contenu, ni la liste des chemins publics, ni le référent. C'est la lacune qui a laissé passer la
 * fuite ci-dessous — et c'est la raison de ce fichier.
 *
 * **La fuite.** `Referrer-Policy: strict-origin-when-cross-origin` ne réduit le référent à l'origine que
 * *cross-origin* : pour une requête **same-origin**, le navigateur envoie l'**URL entière**. Or
 * `/invitation/<jeton>` est une vraie page HTML — c'est le découpage voulu, un GET ne consomme rien, c'est
 * l'appui qui pose la session — et le navigateur y charge ses propres sous-ressources (morceaux de
 * JavaScript, feuille de style, logo). Chacune portait `Referer: https://…/invitation/<jeton>`.
 *
 * Ces requêtes-là ne tombent **pas** dans le `location ~ ^/invitation/` du proxy, où le dossier fait couper
 * le journal d'accès : elles tombent dans le `location /` par défaut, dont le format journalise
 * `"$http_referer"`. Le remède écrit protégeait la ligne de l'invitation et laissait le jeton ressortir dix
 * lignes plus bas, dans le même fichier — sauvegardé, recopié sur le partage, lisible par qui administre le
 * proxy. Un jeton de lien personnel vaut **quatre mois** et connecte sans second facteur ; la rétention de
 * sept jours du journal ne borne rien.
 */

vi.mock("@/lib/env", () => ({
  env: () => ({ SESSION_SECRET: "secret-de-test-assez-long-pour-passer-la-garde" }),
  baseUrl: () => "http://localhost:3000",
}));

const { NextRequest } = await import("next/server");
const { middleware } = await import("@/middleware");

async function reponse(url: string, avecSession = false) {
  const req = new NextRequest(new URL(url, "http://localhost:3000"));
  if (avecSession) req.cookies.set(SESSION_COOKIE, "jeton-quelconque");
  return middleware(req);
}

/** Les quatre familles de chemins qui portent un jeton dans leur URL (voir le middleware). */
const CHEMINS_A_JETON = ["/invitation/UN-JETON", "/reinitialiser/UN-JETON", "/annuler/UN-JETON", "/desinscription/UN-JETON"];

/**
 * **Trois valeurs possibles, une seule qui tient les deux bouts**, et l'histoire vaut d'être
 * retenue parce qu'elle s'est jouée dans la même journée :
 *
 * - `strict-origin-when-cross-origin` (le défaut du matin) envoie l'**URL entière** en same-origin :
 *   chaque sous-ressource de `/invitation/<jeton>` portait le jeton dans son référent, et le journal du
 *   proxy l'enregistre. Fuite réelle, corrigée le matin ;
 * - `no-referrer` (la correction du matin) ferme tout — **y compris l'en-tête `Origin` d'un POST de
 *   formulaire**, que Chrome passe alors à `null`. Next.js ouvre son contrôle anti-CSRF par
 *   `new URL(req.headers['origin'])` : **500** sur l'appui du lien personnel tant que la page n'est pas
 *   hydratée. La porte d'entrée du club, cassée « des fois » ;
 * - `origin` réduit le référent à `https://<domaine>/` — le chemin, donc le jeton, ne sort pas — et laisse
 *   l'`Origin` être une URL. C'est la valeur qui reste, et les deux autres sont nommées ici pour que
 *   personne ne les remette sans rouvrir l'un des deux défauts.
 */
describe("aucune adresse ne part dans le référent", () => {
  it("`origin` sur une page porteuse de jeton, et sur toutes les autres", async () => {
    for (const chemin of [...CHEMINS_A_JETON, "/connexion", "/", "/seances"]) {
      const res = await reponse(chemin);
      expect(res.headers.get("Referrer-Policy"), chemin).toBe("origin");
    }
  });

  it("et surtout pas la politique du matin, qui envoyait l'URL entière en same-origin", async () => {
    const res = await reponse("/invitation/UN-JETON");
    expect(res.headers.get("Referrer-Policy")).not.toContain("when-cross-origin");
  });

  /**
   * `no-referrer` est interdit **par un test**, et pas seulement par un commentaire : il se défend très
   * bien à la lecture (« aucune ressource tierce, rien ne lit `Referer` »), et c'est exactement pour ça
   * qu'il a été posé. Ce que la lecture ne montre pas, c'est le lecteur oublié : le navigateur, qui en
   * déduit `Origin: null` sur un POST de formulaire.
   */
  it("ni `no-referrer`, qui faisait répondre 500 à l'appui du lien personnel", async () => {
    const res = await reponse("/invitation/UN-JETON");
    expect(res.headers.get("Referrer-Policy")).not.toBe("no-referrer");
  });

  it("même sur une redirection vers la connexion, qui n'a pas de corps", async () => {
    const res = await reponse("/seances");
    expect(res.headers.get("location")).toContain("/connexion");
    expect(res.headers.get("Referrer-Policy")).toBe("origin");
  });
});

describe("les en-têtes posés sur toute réponse", () => {
  it("six en-têtes, et le même jeu avec ou sans session", async () => {
    for (const avecSession of [false, true]) {
      const res = await reponse("/seances", avecSession);
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
      expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
      expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
      // Toute la décision du middleware dépend du cookie de session : on le dit.
      expect(res.headers.get("Vary")).toContain("Cookie");
    }
  });

  it("la politique de contenu est réellement stricte", async () => {
    const csp = (await reponse("/seances", true)).headers.get("Content-Security-Policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'strict-dynamic'");
    // Le nonce est un UUID v4 encodé en base64 (122 bits d'aléa) : on vérifie la forme, pas la valeur.
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/]{40,}={0,2}'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  /**
   * `'unsafe-eval'` est la seule souplesse de la politique, et elle est conditionnée au développement
   * (Next en a besoin pour son rechargement à chaud). Le test porte sur la condition, pas sur la valeur
   * qu'on observe en lançant les tests — où `NODE_ENV` vaut « test », donc la souplesse est là.
   */
  it("`unsafe-eval` disparaît en production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const prod = (await reponse("/seances", true)).headers.get("Content-Security-Policy")!;
    expect(prod).not.toContain("'unsafe-eval'");
    vi.unstubAllEnvs();
    const dev = (await reponse("/seances", true)).headers.get("Content-Security-Policy")!;
    expect(dev).toContain("'unsafe-eval'");
  });

  /**
   * Un nonce réutilisé d'une requête à l'autre vide `'strict-dynamic'` de tout son sens : c'est le seul
   * endroit où il est engendré, et il doit l'être par requête.
   */
  it("le nonce change à chaque requête", async () => {
    const a = (await reponse("/seances", true)).headers.get("Content-Security-Policy")!;
    const b = (await reponse("/seances", true)).headers.get("Content-Security-Policy")!;
    expect(a).not.toBe(b);
  });
});

describe("le relais d'image reçoit sa propre politique", () => {
  /**
   * `/api/image` la posait sur sa propre réponse, et elle **n'arrivait jamais** : Next n'ajoute un en-tête
   * de route que si la réponse n'en porte pas déjà un du même nom, et le middleware avait posé celle de
   * l'application avant d'appeler la route. Du code qui ne fait rien et qu'un relecteur croit actif.
   *
   * Pourquoi cette route et pas une autre : elle sert, **depuis notre origine**, des octets venus d'un hôte
   * tiers, et prend le type à la parole du serveur distant — le `sandbox` est la seconde ceinture derrière
   * ce type.
   */
  it("la CSP du relais est `default-src 'none'; sandbox`, et elle sort d'ici", async () => {
    const res = await reponse("/api/image?url=https://exemple.test/x.png", true);
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    // Et le reste de l'application garde la sienne.
    expect((await reponse("/seances", true)).headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });
});

/**
 * **Un GET qui écrit au journal d'audit demande la même garde d'origine qu'un POST**.
 *
 * Les deux routes d'export journalisent l'export — une écriture — et les cookies sont en `SameSite=Lax`,
 * donc une **navigation de premier niveau** depuis un site tiers emporte la session *et* l'élévation. Un
 * administrateur élevé qui ouvre un lien piégé signait ainsi un export qu'il n'a pas fait : le journal
 * porte « export par lui » à une heure où il n'a rien exporté, et le fichier atterrit dans ses
 * téléchargements. Le tiers ne lit rien (aucun en-tête CORS, un CSV n'est pas lisible en JS cross-origin) :
 * l'atteinte porte sur **l'intégrité du récit du journal**, qui est précisément ce que ce journal existe
 * pour tenir — la même raison qui a fait retirer le port publié de la stack.
 *
 * Le balayage lit les deux sources plutôt que de monter les routes : elles tirent Prisma, le journal et les
 * permissions, et ce qu'on veut verrouiller ici tient en une garde posée **avant** la lecture.
 */
describe("les exports CSV refusent une requête venue d'ailleurs", () => {
  it("les deux routes portent la garde d'origine, avant toute écriture", async () => {
    const { readFileSync } = await import("node:fs");
    for (const chemin of ["src/app/api/export/audit/route.ts", "src/app/api/export/presences/route.ts"]) {
      const code = readFileSync(chemin, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${chemin} : garde d'origine absente`).toContain("sec-fetch-site");
      // Avant la permission, avant la requête, avant le journal : une garde qui vient après ne garde rien.
      expect(code.indexOf("memeSite(await headers())"), chemin).toBeLessThan(code.indexOf("audit("));
      expect(code, `${chemin} : le refus doit être muet`).toContain("status: 403");
    }
  });

  /** Même forme et même raison que la seule route POST du dépôt : une garde, un endroit, un texte. */
  it("c'est la garde de `/api/admin/quitter`, recopiée telle quelle", async () => {
    const { readFileSync } = await import("node:fs");
    const quitter = readFileSync("src/app/api/admin/quitter/route.ts", "utf8");
    expect(quitter).toContain("sec-fetch-site");
    expect(quitter).toContain('origine === baseUrl()');
    expect(readFileSync("src/app/api/export/audit/route.ts", "utf8")).toContain('origine === baseUrl()');
  });
});
