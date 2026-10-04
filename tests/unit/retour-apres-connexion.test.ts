import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, SUITE_COOKIE } from "@/lib/constants";
import { cheminSuiteSur } from "@/lib/validation/auth";

/**
 * Retour à la page demandée après une connexion (« suite ») :
 * bouton d'un email de rappel → /connexion → lien personnel → retour sur l'URL de départ.
 * Le point non négociable est la validation : seul un chemin interne est accepté.
 */

/** Faux magasin de cookies / en-têtes : next/headers n'existe qu'en contexte de requête. */
const faux = { cookies: {} as Record<string, string>, entetes: {} as Record<string, string> };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) => (nom in faux.cookies ? { name: nom, value: faux.cookies[nom] } : undefined),
    delete: (nom: string) => {
      delete faux.cookies[nom];
    },
  }),
  headers: async () => new Headers(faux.entetes),
}));

beforeEach(() => {
  faux.cookies = {};
  faux.entetes = {};
});

/** Ce que Next donne à une page pour ?suite=… (décodage d'URL, une seule fois). */
function parametreSuite(url: string): string | null {
  return new URL(url, "http://localhost:3000").searchParams.get("suite");
}

/** Valeurs qu'un attaquant peut glisser dans ?suite= : toutes doivent retomber sur l'accueil. */
const HOSTILES = [
  "//evil.tld",
  "///evil.tld",
  "https://evil.tld",
  "http://evil.tld/x",
  "//evil.tld/chemin?a=b",
  "/\\evil.tld",
  "\\\\evil.tld",
  "\\/evil.tld",
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "mailto:a@b.c",
  "evil.tld",
  "",
];

/** Hostiles qu'un en-tête HTTP ne peut pas transporter tels quels (rognés ou refusés) : testés à part. */
const HOSTILES_HORS_ENTETE = [" /gestion", "\t//evil.tld", "/\t/evil.tld", "/\n/evil.tld", "/\r\n/evil.tld", "/gestion\u0000"];

describe("cheminSuiteSur — validateur unique des destinations", () => {
  it("refuse toute destination qui n'est pas un chemin interne", () => {
    for (const valeur of [...HOSTILES, ...HOSTILES_HORS_ENTETE]) expect(cheminSuiteSur(valeur), valeur).toBe("/");
  });

  it("refuse les caractères de contrôle (les navigateurs les retirent de l'URL : /<tab>/evil.tld → //evil.tld)", () => {
    expect(cheminSuiteSur("/\t/evil.tld")).toBe("/");
    expect(cheminSuiteSur("/\n//evil.tld")).toBe("/");
    expect(cheminSuiteSur("/gestion\r\nLocation: https://evil.tld")).toBe("/");
  });

  it("refuse l'absence de valeur", () => {
    expect(cheminSuiteSur(undefined)).toBe("/");
    expect(cheminSuiteSur(null)).toBe("/");
  });

  it("refuse un chemin externe encodé une ou plusieurs fois, tel que Next le livre", () => {
    // ?suite=%2F%2Fevil.tld → Next décode une fois → "//evil.tld" → refusé
    expect(cheminSuiteSur(parametreSuite("/connexion?suite=%2F%2Fevil.tld"))).toBe("/");
    // Double encodage : Next décode une fois → "%2F%2Fevil.tld", qui ne commence pas par "/"
    expect(cheminSuiteSur(parametreSuite("/connexion?suite=%252F%252Fevil.tld"))).toBe("/");
    expect(cheminSuiteSur(parametreSuite("/connexion?suite=%25252F%25252Fevil.tld"))).toBe("/");
    expect(cheminSuiteSur(parametreSuite("/connexion?suite=https%3A%2F%2Fevil.tld"))).toBe("/");
    expect(cheminSuiteSur(parametreSuite("/connexion?suite=%2F%5Cevil.tld"))).toBe("/");
  });

  it("accepte les chemins internes, paramètres compris", () => {
    expect(cheminSuiteSur("/")).toBe("/");
    expect(cheminSuiteSur("/?seance=abc&reponse=present")).toBe("/?seance=abc&reponse=present");
    expect(cheminSuiteSur("/gestion/seances?vue=liste")).toBe("/gestion/seances?vue=liste");
    // Aller-retour complet : ce que le middleware met dans l'URL revient intact
    const suite = "/?seance=abc&reponse=present";
    expect(cheminSuiteSur(parametreSuite(`/connexion?suite=${encodeURIComponent(suite)}`))).toBe(suite);
  });
});

describe("lienConnexion — même format que pour les admins", () => {
  it("reprend le paramètre et l'encodage de exigerReauth", async () => {
    const { lienConnexion } = await import("@/lib/auth/current-user");
    const suite = "/?seance=abc&reponse=present";
    expect(lienConnexion(suite)).toBe(`/connexion?suite=${encodeURIComponent(suite)}`);
    expect(lienConnexion(suite)).toBe("/connexion?suite=%2F%3Fseance%3Dabc%26reponse%3Dpresent");
  });

  it("n'ajoute rien quand il n'y a pas de destination utile", async () => {
    const { lienConnexion } = await import("@/lib/auth/current-user");
    expect(lienConnexion("/")).toBe("/connexion");
    for (const valeur of HOSTILES) expect(lienConnexion(valeur), valeur).toBe("/connexion");
  });
});

describe("cheminCourant — page en cours vue par un layout", () => {
  it("reprend l'en-tête posé par le middleware", async () => {
    const { cheminCourant } = await import("@/lib/auth/current-user");
    faux.entetes["x-chemin"] = "/?seance=abc&reponse=present";
    expect(await cheminCourant()).toBe("/?seance=abc&reponse=present");
  });

  it("ignore un en-tête hostile ou absent, et les pages de connexion (pas de boucle)", async () => {
    const { cheminCourant } = await import("@/lib/auth/current-user");
    expect(await cheminCourant()).toBe("/");
    for (const valeur of HOSTILES) {
      faux.entetes["x-chemin"] = valeur;
      expect(await cheminCourant(), valeur).toBe("/");
    }
    faux.entetes["x-chemin"] = "/connexion/verifier?suite=%2Fadmin";
    expect(await cheminCourant()).toBe("/");
  });
});

describe("destinationRetour — destination gardée d'un bout à l'autre", () => {
  it("préfère la destination passée explicitement (URL ou formulaire)", async () => {
    const { destinationRetour } = await import("@/lib/auth/current-user");
    faux.cookies[SUITE_COOKIE] = "/gestion";
    expect(await destinationRetour("/?seance=abc&reponse=absent")).toBe("/?seance=abc&reponse=absent");
  });

  it("retombe sur le cookie du middleware (détour par la boîte mail)", async () => {
    const { destinationRetour } = await import("@/lib/auth/current-user");
    faux.cookies[SUITE_COOKIE] = encodeURIComponent("/?seance=abc&reponse=present");
    expect(await destinationRetour()).toBe("/?seance=abc&reponse=present");
    faux.cookies[SUITE_COOKIE] = "/?seance=abc&reponse=present";
    expect(await destinationRetour()).toBe("/?seance=abc&reponse=present");
  });

  it("ignore un cookie hostile", async () => {
    const { destinationRetour } = await import("@/lib/auth/current-user");
    for (const valeur of [...HOSTILES, encodeURIComponent("//evil.tld"), "%E0%A4%A"]) {
      faux.cookies[SUITE_COOKIE] = valeur;
      expect(await destinationRetour(), valeur).toBe("/");
    }
  });

  it("oublie la destination une fois servie", async () => {
    const { destinationRetour, oublierDestination } = await import("@/lib/auth/current-user");
    faux.cookies[SUITE_COOKIE] = "/gestion";
    await oublierDestination();
    expect(await destinationRetour()).toBe("/");
  });
});

describe("requireUser — le layout de l'espace connecté n'a plus le droit de perdre l'URL", () => {
  async function cibleDeLaRedirection(next?: string): Promise<string> {
    const { requireUser } = await import("@/lib/auth/current-user");
    try {
      await requireUser(next);
    } catch (e) {
      // next/navigation encode la cible dans le digest : NEXT_REDIRECT;<type>;<url>;...
      const digest = String((e as { digest?: string }).digest ?? "");
      expect(digest.startsWith("NEXT_REDIRECT")).toBe(true);
      return digest.split(";")[2];
    }
    throw new Error("aucune redirection");
  }

  it("emporte la destination demandée", async () => {
    expect(await cibleDeLaRedirection("/?seance=abc&reponse=present")).toBe("/connexion?suite=%2F%3Fseance%3Dabc%26reponse%3Dpresent");
  });

  it("à défaut, reprend la page en cours (cas du layout, rendu avant sa page)", async () => {
    faux.entetes["x-chemin"] = "/?seance=abc&reponse=absent";
    expect(await cibleDeLaRedirection()).toBe("/connexion?suite=%2F%3Fseance%3Dabc%26reponse%3Dabsent");
  });

  it("ne propose jamais une destination externe", async () => {
    for (const valeur of HOSTILES) {
      faux.entetes["x-chemin"] = valeur;
      expect(await cibleDeLaRedirection(valeur), valeur).toBe("/connexion");
    }
  });
});

describe("middleware — première marche du parcours", () => {
  async function redirection(url: string, avecSession = false) {
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("@/middleware");
    const req = new NextRequest(new URL(url, "http://localhost:3000"));
    if (avecSession) req.cookies.set(SESSION_COOKIE, "jeton-quelconque");
    return middleware(req);
  }

  it("garde les paramètres de l'URL demandée, même à la racine", async () => {
    const res = await redirection("/?seance=abc&reponse=present");
    expect(res.headers.get("location")).toBe("http://localhost:3000/connexion?suite=%2F%3Fseance%3Dabc%26reponse%3Dpresent");
    expect(res.cookies.get(SUITE_COOKIE)?.value).toBe("/?seance=abc&reponse=present");
    expect(res.cookies.get(SUITE_COOKIE)?.httpOnly).toBe(true);
  });

  it("ne mémorise rien pour un simple accès à l'accueil", async () => {
    const res = await redirection("/");
    expect(res.headers.get("location")).toBe("http://localhost:3000/connexion");
    expect(res.cookies.get(SUITE_COOKIE)?.value).toBe("");
  });

  it("laisse passer une session et annonce la page en cours aux layouts", async () => {
    const res = await redirection("/?seance=abc&reponse=present", true);
    expect(res.headers.get("location")).toBeNull();
  });

  it("la destination mémorisée se relit telle quelle", async () => {
    const { destinationRetour } = await import("@/lib/auth/current-user");
    const res = await redirection("/?seance=abc&reponse=present");
    faux.cookies[SUITE_COOKIE] = res.cookies.get(SUITE_COOKIE)!.value;
    expect(await destinationRetour()).toBe("/?seance=abc&reponse=present");
  });
});

/**
 * **Se connecter dépose à l'accueil**.
 *
 * La mémorisation ci-dessus reste : elle sert le cas pour lequel elle a été écrite — un bouton
 * d'email, un lien partagé. Ce qu'elle ne doit plus faire, c'est rendre à la connexion **l'écran qui
 * était simplement ouvert la dernière fois**. Sur l'application installée, c'est souvent « Mon
 * profil », d'où l'on prend l'espace admin : on se reconnecte, et on atterrit dans ses réglages.
 */
describe("destinationApresConnexion — un écran rouvert n'est pas une destination", () => {
  it("un écran de l'application sans paramètre : l'accueil", async () => {
    const { destinationApresConnexion } = await import("@/lib/validation/auth");
    for (const page of ["/profil", "/planning", "/seances", "/ateliers", "/evenements", "/gestion", "/admin", "/"]) {
      expect(destinationApresConnexion(page), page).toBe("/");
    }
  });

  it("une adresse qui porte des paramètres : on y va (le « Je viens » d'un email de rappel)", async () => {
    const { destinationApresConnexion } = await import("@/lib/validation/auth");
    expect(destinationApresConnexion("/seances?seance=abc&reponse=present")).toBe("/seances?seance=abc&reponse=present");
    expect(destinationApresConnexion("/?seance=abc&reponse=present")).toBe("/?seance=abc&reponse=present");
    expect(destinationApresConnexion("/profil#securite")).toBe("/");
    expect(destinationApresConnexion("/profil?codes=epuises")).toBe("/profil?codes=epuises");
  });

  it("une adresse à plus d'un niveau : on y va (un lien précis, cliqué)", async () => {
    const { destinationApresConnexion } = await import("@/lib/validation/auth");
    expect(destinationApresConnexion("/evenements/evt-1")).toBe("/evenements/evt-1");
    expect(destinationApresConnexion("/admin/membres")).toBe("/admin/membres");
    expect(destinationApresConnexion("/admin/activer")).toBe("/admin/activer");
  });

  it("une destination hostile retombe sur l'accueil, comme le validateur qu'elle appelle", async () => {
    const { destinationApresConnexion } = await import("@/lib/validation/auth");
    for (const valeur of HOSTILES) expect(destinationApresConnexion(valeur), valeur).toBe("/");
    expect(destinationApresConnexion(null)).toBe("/");
    expect(destinationApresConnexion(undefined)).toBe("/");
  });

  /**
   * **Le filtre se pose sur la mémoire du middleware, pas sur les destinations de l'application.**
   * Les deux portes d'entrée (mot de passe, lien personnel) le passent sur ce que rend
   * `destinationRetour` ; les redirections que l'application se donne à elle-même — la fin du
   * parcours d'activation qui mène à `/admin`, le détour par les codes de secours — ne le voient
   * pas, sans quoi un administrateur qui vient de tout régler serait déposé sur l'accueil.
   */
  it("les redirections internes de l'application ne sont pas filtrées", async () => {
    const { apresInvitation } = await import("@/lib/auth/apres-invitation");
    const vu = new Date("2026-09-01T00:00:00Z");
    expect(apresInvitation(vu, "/planning")).toBe("/planning");
    expect(apresInvitation(null, "/planning")).toBe(`/bienvenue?suite=${encodeURIComponent("/planning")}`);
  });
});
