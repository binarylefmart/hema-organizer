import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **L'espace admin est une élévation**, décidée par Delta : on s'y connecte explicitement (« Se
 * connecter en tant qu'administrateur »), on en sort d'un bouton, et il se referme tout seul.
 *
 * « Tout seul » reposait d'abord sur le cookie sans échéance, censé mourir avec le navigateur —
 * sauf que Chrome (« Continuer là où vous vous êtes arrêté »), Android et les applications
 * installées le **restaurent** au redémarrage. L'échéance qui compte vit donc côté serveur : **10
 * min sans rien faire dans l'espace admin**. Ce fichier verrouille les cinq propriétés qui font
 * tenir l'ensemble — pas de `maxAge`, lié à *cette* session, plafonné à 12 h, refermé par
 * inactivité, signé — et le fait que le rôle reste maître : le cookie est un second facteur, jamais
 * un droit.
 */

const cookiesFaux: Record<string, string> = {};
const options: Record<string, { maxAge?: number }> = {};
/** Ce que le middleware aurait posé, et l'état de la session lue en base. */
const etat: { chemin: string; forte: boolean; role: string; estAdmin: boolean; actif: boolean; elevationVueLe: Date | null } = {
  chemin: "/admin",
  forte: false,
  /*
   * **Un instructeur du bureau** : le rôle de base d'un côté, `estAdmin` de l'autre — le cas que
   * les trois rôles exclusifs d'avant rendaient impossible, et celui qui éprouve vraiment la
   * chaîne. `settings.technical` n'est ouverte à aucun instructeur : ici, tout ce qui passe ne
   * passe que par `estAdmin`, de `can()` jusqu'à `peutOuvrirSessionForte`. Avec `role: "ADMIN"`, le
   * repli de compatibilité de `can()` aurait masqué une garde restée sur le rôle.
   */
  role: "INSTRUCTEUR",
  estAdmin: true,
  actif: true,
  elevationVueLe: null,
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) => (nom in cookiesFaux ? { name: nom, value: cookiesFaux[nom] } : undefined),
    set: (nom: string, valeur: string, opts?: { maxAge?: number }) => {
      options[nom] = opts ?? {};
      if (opts?.maxAge === 0) delete cookiesFaux[nom];
      else cookiesFaux[nom] = valeur;
    },
    delete: (nom: string) => {
      delete cookiesFaux[nom];
    },
  }),
  headers: async () => new Headers({ "x-chemin": etat.chemin }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    authSession: {
      findUnique: vi.fn(async () => ({
        id: "session-1",
        forte: etat.forte,
        elevationVueLe: etat.elevationVueLe,
        expiresAt: new Date(Date.now() + 3_600_000),
        lastSeenAt: new Date(),
        reauthAt: null,
        user: { id: "u-admin", prenom: "Delta", nom: "Bretteur", email: "delta@club.test", role: etat.role, estAdmin: etat.estAdmin, actif: etat.actif, rappelEmail: true, theme: "hema", service: false },
      })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ SESSION_SECRET: "secret-de-test-pour-l-elevation" }),
  baseUrl: () => "https://organizer.mon-club.fr",
}));

const { ouvrirElevation, elevationOuverte, etatElevation, fermerElevation, toucherElevation } = await import("@/lib/auth/elevation");
const { DUREE_INACTIVITE_ELEVATION_MS, DUREE_REAUTH_MS } = await import("@/lib/constants");

/** Raccourci de lecture : par défaut, un geste vient d'être fait dans l'espace admin. */
const ouvert = (sessionId: string, vueLe: Date | null = new Date()) => elevationOuverte(sessionId, vueLe);
const { ELEVATION_COOKIE, DUREE_ELEVATION_MS, SESSION_COOKIE } = await import("@/lib/constants");
const { exigerReauth, requirePermission } = await import("@/lib/auth/current-user");
const { CHEMIN_ACTIVATION_ADMIN } = await import("@/lib/auth/acces-admin");

beforeEach(() => {
  for (const cle of Object.keys(cookiesFaux)) delete cookiesFaux[cle];
  for (const cle of Object.keys(options)) delete options[cle];
  etat.chemin = "/admin";
  etat.forte = false;
  etat.role = "INSTRUCTEUR";
  etat.estAdmin = true;
  etat.actif = true;
  etat.elevationVueLe = new Date();
});

describe("ouvrir et refermer l'espace admin", () => {
  it("n'est ouvert pour personne tant que rien n'a été fait", async () => {
    expect(await ouvert("session-1")).toBe(false);
  });

  it("s'ouvre pour la session qui vient de redonner mot de passe et code", async () => {
    await ouvrirElevation("session-1");
    expect(await ouvert("session-1")).toBe(true);
  });

  it("ne vaut que pour cette session-là", async () => {
    // Recopié sur un autre appareil, le cookie ne désigne pas la bonne session : il ne vaut rien.
    await ouvrirElevation("session-1");
    expect(await ouvert("session-2")).toBe(false);
  });

  it("se referme d'un bouton, sans toucher à la session", async () => {
    await ouvrirElevation("session-1");
    await fermerElevation();
    expect(await ouvert("session-1")).toBe(false);
    // La session, elle, n'est pas dans ce cookie : rien d'autre n'a été effacé
    expect(Object.keys(cookiesFaux)).toHaveLength(0);
  });

  it("ne se laisse pas fabriquer à la main", async () => {
    // Signature absente, puis charge utile retouchée : les deux sont refusées
    cookiesFaux[ELEVATION_COOKIE] = Buffer.from(JSON.stringify({ sid: "session-1", exp: Date.now() + 1000 })).toString("base64url");
    expect(await ouvert("session-1")).toBe(false);
    await ouvrirElevation("session-1");
    const [, signature] = cookiesFaux[ELEVATION_COOKIE].split(".");
    const autre = Buffer.from(JSON.stringify({ sid: "session-2", exp: Date.now() + 1000 })).toString("base64url");
    cookiesFaux[ELEVATION_COOKIE] = `${autre}.${signature}`;
    expect(await ouvert("session-2")).toBe(false);
  });

  it("tombe au bout de 12 h même sur un navigateur jamais fermé", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-23T08:00:00Z"));
      await ouvrirElevation("session-1");
      vi.setSystemTime(new Date("2026-09-23T08:00:00Z").getTime() + DUREE_ELEVATION_MS - 60_000);
      expect(await ouvert("session-1")).toBe(true);
      vi.setSystemTime(new Date("2026-09-23T08:00:00Z").getTime() + DUREE_ELEVATION_MS + 1);
      expect(await ouvert("session-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("se referme après 10 min sans rien faire dans l'espace admin", async () => {
    await ouvrirElevation("session-1");
    const juste = new Date(Date.now() - DUREE_INACTIVITE_ELEVATION_MS + 60_000);
    const trop = new Date(Date.now() - DUREE_INACTIVITE_ELEVATION_MS - 1);
    expect(await ouvert("session-1", juste)).toBe(true);
    expect(await ouvert("session-1", trop)).toBe(false);
  });

  /**
   * **Le cas vécu** : le navigateur rend son cookie intact au redémarrage (Chrome « Continuer là
   * où vous vous êtes arrêté », Android, PWA). Sans geste récent côté serveur, il ne rouvre rien.
   */
  it("un cookie restauré par le navigateur ne rouvre pas l'espace admin", async () => {
    await ouvrirElevation("session-1");
    expect(await ouvert("session-1", null)).toBe(false);
  });

  it("la sortie de l'application ne ferme qu'au bout de la grâce", async () => {
    const { GRACE_SORTIE_ELEVATION_MS } = await import("@/lib/constants");
    await ouvrirElevation("session-1");
    const vueLe = new Date();
    // Revenue à temps (changement de page, coup d'œil ailleurs) : rien n'est fermé
    expect(await elevationOuverte("session-1", vueLe, new Date(Date.now() - GRACE_SORTIE_ELEVATION_MS + 10_000))).toBe(true);
    // Partie pour de bon : l'élévation tombe
    expect(await elevationOuverte("session-1", vueLe, new Date(Date.now() - GRACE_SORTIE_ELEVATION_MS - 1))).toBe(false);
  });

  it("chaque geste dans l'espace admin repousse l'échéance et annule la sortie", async () => {
    const { db } = await import("@/lib/db");
    await toucherElevation("session-1");
    expect(db.authSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "session-1" }, data: { elevationVueLe: expect.any(Date), elevationSortieLe: null } }),
    );
  });

  /** Le cookie reste un cookie de session : c'est une ceinture de plus, pas la garantie. */
  it("est un cookie de session navigateur : aucune échéance posée dessus", async () => {
    await ouvrirElevation("session-1");
    expect(options[ELEVATION_COOKIE]).toBeDefined();
    expect(options[ELEVATION_COOKIE].maxAge).toBeUndefined();
    expect(options[ELEVATION_COOKIE]).toMatchObject({ httpOnly: true, sameSite: "lax" });
  });
});

describe("le rôle reste maître : le cookie n'est qu'un second facteur", () => {
  const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

  it("vérifie le rôle, puis l'interrupteur serveur, puis le cookie", () => {
    // Trois conditions, dans cet ordre. Un instructeur qui obtiendrait le cookie n'ouvrirait
    // toujours rien (`peutOuvrirSessionForte` exige ADMIN) ; et `session.forte` rend « Quitter
    // l'espace admin » opposable côté serveur, là où le cookie seul dépendait du navigateur.
    const source = lire("src/lib/auth/current-user.ts");
    expect(source).toContain("const peutElever = peutOuvrirSessionForte(u) && session.forte;");
    expect(source).toContain('const forte = peutElever && etat === "ouverte";');
    expect(source).toContain("sessionForte: forte,");
    // Le drapeau « elle est tombée » ne donne jamais de droit : il exige exactement les mêmes
    // conditions, et il est faux chaque fois que `forte` est vrai.
    expect(source).toContain('const retombee = peutElever && etat === "retombee";');
    expect(source).toContain("elevationRetombee: retombee,");
  });

  it("force le réglage plutôt que de refuser, quand il manque le mot de passe ou la 2FA", () => {
    // Un administrateur dont l'accès n'est pas complet est déposé sur `/admin/activer` — par les
    // deux portes d'entrée (son lien, et son mot de passe), et par l'écran d'élévation lui-même.
    // Le refuser sans rien proposer le laisserait découvrir plus tard, devant une porte close,
    // qu'il lui manquait deux réglages.
    const actions = lire("src/actions/auth.ts");
    expect(actions).toContain("if (compte && peutReglerSonAcces(compte) && !accesAdminRegle(compte)) return CHEMIN_ACTIVATION_ADMIN;");
    const elevation = lire("src/app/(public)/connexion/admin/page.tsx");
    expect(elevation).toContain("if (!compte || !accesAdminRegle(compte)) redirect(CHEMIN_ACTIVATION_ADMIN);");
    // …et le parcours lui-même reste ouvert sans élévation, sinon il serait impossible à suivre
    const courant = lire("src/lib/auth/current-user.ts");
    expect(courant).toContain('if (chemin === CHEMIN_ACTIVATION_ADMIN || chemin.startsWith(`${CHEMIN_ACTIVATION_ADMIN}/`)) return user;');
  });

  it("n'annonce pas l'élévation sur le parcours de réglage, où l'on ne l'a pas encore", () => {
    const layout = lire("src/app/(app)/admin/layout.tsx");
    expect(layout).toContain("{user.sessionForte && (");
    expect(layout).not.toMatch(/<div className="flex flex-wrap items-center justify-between[\s\S]{0,80}Connecté\(e\) en tant/);
  });

  it("quitter l'application referme l'espace admin : le navigateur prévient, le serveur ferme", () => {
    // Le composant n'est monté que pendant l'élévation, et ne parle qu'une fois la page cachée
    const layout = lire("src/app/(app)/layout.tsx");
    expect(layout).toContain("{user.sessionForte && <FermerEnQuittant ouverteLe={user.elevationOuverteLe?.getTime() ?? null} />}");
    const composant = lire("src/components/admin/FermerEnQuittant.tsx");
    expect(composant).toContain('document.addEventListener("visibilitychange", surVisibilite)');
    expect(composant).toContain('window.addEventListener("pagehide", partir)');
    expect(composant).toContain('if (document.visibilityState !== "hidden" || cacheeDepuis !== null) return;');
    expect(composant).toContain('navigator.sendBeacon?.("/api/admin/quitter")');
    // La route ne fait que **fermer**, et seulement pour une requête venue de l'application
    const route = lire("src/app/api/admin/quitter/route.ts");
    expect(route).toContain('const memeSite = site ? site === "same-origin" : origine === baseUrl();');
    expect(route).toContain("if (!memeSite) return new NextResponse(null, { status: 403 });");
    expect(route).toContain("await signalerSortieElevation(user.sessionId);");
    // …et surtout : aucune ouverture, aucune élévation accordée par cette route
    expect(route).not.toContain("ouvrirElevation");
  });

  it("l'espace admin laissé ouvert se referme tout seul, et dépose à l'accueil", () => {
    /*
     * L'échéance d'inactivité vivait déjà en base, mais elle ne se **constatait** qu'au geste
     * suivant — et ce geste tombait sur `/connexion/admin`, c'est-à-dire une demande de mot de
     * passe servie à quelqu'un qui venait de reprendre son téléphone. Delta, : « je ne veux pas
     * que ça redemande, je veux que ça retourne à l'accueil déconnecté de l'espace admin ». Le
     * minuteur ne protège rien (la protection reste en base) : il choisit le moment et la
     * destination.
     */
    const minuteur = lire("src/components/admin/SortirApresInactivite.tsx");
    // La même constante que le serveur, jamais un nombre recopié à la main.
    expect(minuteur).toContain("DUREE_INACTIVITE_ELEVATION_MS");
    expect(minuteur).not.toMatch(/setTimeout\([^)]*\b\d{4,}\b/);
    // Il déclare la sortie comme le fait le retour d'absence, puis emmène à l'accueil.
    expect(minuteur).toContain('fetch("/api/admin/quitter?parti=1"');
    // La destination est écrite une seule fois, dans les constantes : le minuteur du navigateur et
    // la garde du serveur déposent au même endroit, sans qu'on puisse les désaccorder par recopie.
    expect(minuteur).toContain("ACCUEIL_ELEVATION_REFERMEE");
    expect(minuteur).toContain("window.location.assign(ACCUEIL_ELEVATION_REFERMEE)");
    // Jamais une navigation vers `/connexion/admin` : c'est exactement ce qu'on ne veut plus voir
    // arriver tout seul. (Le commentaire du fichier, lui, a le droit de le nommer pour l'expliquer.)
    expect(minuteur).not.toMatch(/assign\([^)]*connexion/);
    // Le minuteur repart à chaque page de l'espace admin, comme `toucherElevation` côté serveur.
    expect(minuteur).toContain("const chemin = usePathname();");
    expect(minuteur).toContain("}, [chemin]);");
    // Et il ne vit que pendant l'élévation : `/admin/activer` n'a rien à refermer.
    const layout = lire("src/app/(app)/admin/layout.tsx");
    expect(layout).toContain("{user.sessionForte && <SortirApresInactivite />}");
    // L'accueil dit ce qui s'est passé : un écran qui change tout seul sans un mot fait croire à une panne.
    const accueil = lire("src/app/(app)/page.tsx");
    expect(accueil).toContain('params.admin === "expire"');
  });

  it("le retour de l'application vérifie auprès du serveur, et repart de l'accueil", () => {
    /*
     * Le verrou qui manquait. Les deux échéances de l'élévation vivent côté serveur — mais **le
     * serveur n'est consulté que si on lui parle**. Une application installée qu'on rouvre restaure
     * sa page sans aucune requête, et la navigation suivante peut encore sortir du cache de
     * routeur : l'espace admin *paraissait* rester ouvert. Au retour au premier plan, l'application
     * déclare donc son absence et **repart de l'accueil**, ce qui vide ce cache et fait retomber
     * l'écran sur la vérité du serveur.
     *
     * L'accueil et non la page où l'on était : recharger sur place rendait une redirection vers
     * `/connexion/admin`, donc une demande de mot de passe au réveil de l'application. On revient
     * sur ses prochains cours, avec les droits d'un instructeur.
     */
    const composant = lire("src/components/admin/FermerEnQuittant.tsx");
    expect(composant).toContain('window.addEventListener("pageshow", revenir)');
    // Sous la grâce, c'était un changement de page : rien ne se referme (le cas d'après le détaille).
    expect(composant).toContain("if (absence <= GRACE_SORTIE_ELEVATION_MS) {");
    // Au-delà seulement : on déclare la sortie, et c'est cette déclaration qui referme.
    expect(composant).toContain('fetch("/api/admin/quitter?parti=1"');
    expect(composant).toContain("window.location.assign(ACCUEIL)");
    expect(composant).toContain('const ACCUEIL = "/";');
    // Jamais un simple rechargement : il laisserait revenir sur l'écran d'administration quitté.
    expect(composant).not.toContain("window.location.reload()");

    // Côté serveur, cette déclaration referme pour de bon : en base **et** en effaçant le cookie.
    const route = lire("src/app/api/admin/quitter/route.ts");
    expect(route).toContain('} else if (parametres.get("parti") === "1") {');
    expect(route).toContain("await refermerElevationSortie(user.sessionId);");
    expect(route).toContain("await fermerElevation();");
    // Se déclarer parti ne donne toujours aucun droit : la route ne sait que fermer.
    expect(route).not.toContain("ouvrirElevation");
  });

  /**
   * **Le retour sous la grâce se dit lui aussi**. La sortie notée au départ vieillissait toute
   * seule — elle mesure l'âge du signal, pas la durée de l'absence : un coup d'œil ailleurs, puis
   * une page laissée sous les yeux, et l'espace admin se refermait au premier clic trois minutes
   * plus tard, alors que personne n'était parti. Revenir se déclare donc aussi, et le serveur
   * efface la note au lieu de la laisser mûrir.
   */
  it("le retour sous la grâce est déclaré au serveur, qui efface la sortie notée", () => {
    const composant = lire("src/components/admin/FermerEnQuittant.tsx");
    // Le seuil vient de la constante partagée avec le serveur, jamais d'un nombre recopié.
    expect(composant).toContain('import { GRACE_SORTIE_ELEVATION_MS } from "@/lib/constants";');
    // Sous la grâce : on dit combien de temps a duré l'absence, et **rien d'autre** — ni fermeture,
    // ni navigation. C'est exactement ce que décrit cette branche, `return` compris.
    expect(composant).toMatch(
      /if \(absence <= GRACE_SORTIE_ELEVATION_MS\) \{\s*navigator\.sendBeacon\?\.\(`\/api\/admin\/quitter\?retour=\$\{absence\}`\);\s*return;\s*\}/,
    );

    // Une route, trois messages de la même absence : le départ, le retour, et « j'étais parti ».
    const route = lire("src/app/api/admin/quitter/route.ts");
    expect(route).toContain('const retour = parametres.get("retour");');
    // La durée vient du navigateur : une valeur illisible, négative ou infinie vaut une **longue
    // absence**, donc on referme. Le sens compte : ramenée à zéro, elle se serait fait passer pour
    // « revenu tout de suite » et aurait effacé la sortie notée.
    expect(route).toContain("await signalerRetourElevation(user.sessionId, Number.isFinite(absence) && absence >= 0 ? absence : Number.MAX_SAFE_INTEGER);");
    // Le départ, lui, ne fait toujours que **noter** : fermer sur-le-champ redemanderait mot de
    // passe et code au premier clic sur un lien.
    expect(route).toContain("await signalerSortieElevation(user.sessionId);");
    expect(route).not.toContain("ouvrirElevation");
  });

  it("quitter l'espace admin ne déconnecte pas", () => {
    const session = lire("src/lib/auth/session.ts");
    const depuis = session.slice(session.indexOf("export async function abaisserSessionCourante"));
    const fonction = depuis.slice(0, depuis.indexOf("\n}\n"));
    expect(fonction).toContain("fermerElevation()");
    // …et la date du dernier geste est effacée : un cookie restauré ne doit rien rouvrir
    expect(fonction).toContain("elevationVueLe: null");
    // Ni suppression de la ligne de session, ni effacement du cookie de connexion
    expect(fonction).not.toContain("deleteMany");
    expect(fonction).not.toContain("SESSION_COOKIE");
  });
});

/**
 * **La seule porte qui échappe à l'élévation, c'est le parcours qui sert à l'obtenir.**
 *
 * Elle se reconnaissait à un `startsWith` nu : n'importe quelle route future commençant par les
 * mêmes lettres — `/admin/activer-tout`, `/admin/activerons-nous` — en aurait hérité la dispense
 * sans que personne ne l'ait décidé, et se serait ouverte à un administrateur qui n'a pas redonné
 * mot de passe et code. La comparaison est donc exacte, au sous-chemin près.
 */
describe("dispense d'élévation sur le parcours de réglage", () => {
  /** Jeton de session bien formé (43 caractères base64url) : la ligne est ensuite simulée en base. */
  const JETON = "j".repeat(43);

  /** Rend le chemin de redirection, ou `null` si la page s'est ouverte. */
  async function ouvrir(chemin: string): Promise<string | null> {
    cookiesFaux[SESSION_COOKIE] = JETON;
    etat.chemin = chemin;
    try {
      await requirePermission("settings.technical");
      return null;
    } catch (e) {
      const message = (e as Error).message;
      if (!message.startsWith("REDIRECTION:")) throw e;
      return message.slice("REDIRECTION:".length);
    }
  }

  it("laisse entrer sur le parcours lui-même, qu'il porte ou non un paramètre", async () => {
    // Sans cette dispense, le parcours exigerait la session forte qu'il sert justement à obtenir.
    expect(await ouvrir(CHEMIN_ACTIVATION_ADMIN)).toBeNull();
    expect(await ouvrir(`${CHEMIN_ACTIVATION_ADMIN}?erreur=tentatives`)).toBeNull();
  });

  it("laisse entrer sur une étape du parcours (un sous-chemin)", async () => {
    expect(await ouvrir(`${CHEMIN_ACTIVATION_ADMIN}/deux-fa`)).toBeNull();
  });

  it("ne déborde pas sur une route qui commence par les mêmes lettres", async () => {
    for (const chemin of [`${CHEMIN_ACTIVATION_ADMIN}-tout`, `${CHEMIN_ACTIVATION_ADMIN}ons-nous`, "/admin/activerXYZ"]) {
      expect(await ouvrir(chemin), chemin).toBe("/connexion/admin?suite=%2Fadmin");
    }
  });

  it("renvoie sur l'élévation partout ailleurs dans l'espace admin", async () => {
    expect(await ouvrir("/admin/parametres")).toBe("/connexion/admin?suite=%2Fadmin");
  });

  it("n'a plus rien à dispenser une fois l'espace admin ouvert", async () => {
    await ouvrirElevation("session-1");
    etat.forte = true;
    expect(await ouvrir("/admin/parametres")).toBeNull();
  });
});

/**
 * **« Elle est tombée » n'est pas « elle n'a jamais été prise »** — et c'est toute la différence
 * entre une mise à la porte et une porte d'entrée.
 *
 * Delta, : « je veux qu'au clic après le timeout, retour sur l'accueil, déconnexion admin » — et,
 * sur l'onglet qui disparaît : « il ne faut pas que ça cache l'icône admin mais que ça déconnecte
 * vraiment de l'espace admin, comme quand on clique sur le bouton quitter ».
 */
describe("l'élévation qui tombe toute seule dépose à l'accueil", () => {
  const JETON = "j".repeat(43);

  it("sans cookie, personne n'est tombé de nulle part : c'est quelqu'un qui veut entrer", async () => {
    expect(await etatElevation("session-1", new Date())).toBe("aucune");
  });

  it("cookie illisible ou posé pour une autre session : « aucune », jamais une chute", async () => {
    cookiesFaux[ELEVATION_COOKIE] = "n-importe-quoi";
    expect(await etatElevation("session-1", new Date())).toBe("aucune");
    await ouvrirElevation("session-2");
    expect(await etatElevation("session-1", new Date())).toBe("aucune");
  });

  it("jamais rien fait dans l'espace admin : « aucune », il n'y avait rien à perdre", async () => {
    await ouvrirElevation("session-1");
    expect(await etatElevation("session-1", null)).toBe("aucune");
  });

  it("geste récent : « ouverte »", async () => {
    await ouvrirElevation("session-1");
    expect(await etatElevation("session-1", new Date())).toBe("ouverte");
  });

  it("dix minutes sans rien faire : « retombee »", async () => {
    await ouvrirElevation("session-1");
    expect(await etatElevation("session-1", new Date(Date.now() - DUREE_INACTIVITE_ELEVATION_MS - 1))).toBe("retombee");
  });

  it("absence trop longue, et plafond de douze heures : « retombee » aussi", async () => {
    const { GRACE_SORTIE_ELEVATION_MS } = await import("@/lib/constants");
    await ouvrirElevation("session-1");
    expect(await etatElevation("session-1", new Date(), new Date(Date.now() - GRACE_SORTIE_ELEVATION_MS - 1))).toBe("retombee");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + DUREE_ELEVATION_MS + 1);
      expect(await etatElevation("session-1", new Date())).toBe("retombee");
    } finally {
      vi.useRealTimers();
    }
  });

  it("le clic d'après dépose à l'accueil, et referme vraiment", async () => {
    const { db } = await import("@/lib/db");
    cookiesFaux[SESSION_COOKIE] = JETON;
    etat.chemin = "/admin/parametres";
    etat.forte = true;
    etat.elevationVueLe = new Date(Date.now() - DUREE_INACTIVITE_ELEVATION_MS - 60_000);
    await ouvrirElevation("session-1");

    await expect(requirePermission("settings.technical")).rejects.toThrow("REDIRECTION:/?admin=expire");

    // Vraiment sorti, comme le bouton « Quitter l'espace admin » : `forte` repasse à faux en base.
    // C'est ce qui fait disparaître l'onglet Admin — on ne le cache pas, il n'a plus lieu d'être.
    expect(db.authSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "session-1" },
        data: { forte: false, reauthAt: null, elevationVueLe: null, elevationSortieLe: null },
      }),
    );
  });

  it("et la fois d'après, « Espace admin » repasse par la porte", async () => {
    // La session n'est plus marquée élevée : on n'est plus quelqu'un qui tombe, mais qui entre.
    cookiesFaux[SESSION_COOKIE] = JETON;
    etat.chemin = "/admin/parametres";
    etat.forte = false;
    await expect(requirePermission("settings.technical")).rejects.toThrow("REDIRECTION:/connexion/admin?suite=%2Fadmin");
  });
});

/**
 * **Fermer l'application ferme l'espace admin, même quand rien n'a prévenu.**
 *
 * Delta, : « si je ferme l'app sur mon téléphone ou PC et que je suis connecté en admin, si je
 * reviens je suis toujours connecté en admin ». Une application tuée net ne poste aucun
 * `sendBeacon`, et le cookie d'élévation — pourtant un cookie de session — revient **intact**,
 * restauré par le navigateur. Côté serveur, ce retour est indistinguable de quelqu'un qui n'a
 * jamais quitté l'écran : il fallait un témoin que le navigateur ne restaure pas.
 */
describe("une application redémarrée ne rouvre pas l'espace admin", () => {
  const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

  it("s'appuie sur sessionStorage, que rien ne restaure — jamais sur le cookie", () => {
    const composant = lire("src/components/admin/FermerEnQuittant.tsx");
    expect(composant).toContain('const CLE_NAVIGATION = "hema_elevation_navigation";');
    expect(composant).toContain("sessionStorage.getItem(CLE_NAVIGATION)");
    expect(composant).toContain("sessionStorage.setItem(CLE_NAVIGATION");
    // `localStorage` survivrait au redémarrage : il ne prouverait donc rien du tout.
    expect(composant).not.toContain("localStorage");
  });

  it("ne referme pas une élévation qu'on vient de prendre", () => {
    const composant = lire("src/components/admin/FermerEnQuittant.tsx");
    // Sans cette grâce, le premier écran qui suit la saisie du mot de passe se refermerait aussitôt :
    // la marque n'est pas encore posée, et l'élévation paraîtrait « restaurée ».
    expect(composant).toContain("if (ouverteLe !== null && Date.now() - ouverteLe < GRACE_OUVERTURE_MS)");
    expect(composant).toContain("marquer();");
  });

  it("demande aux autres onglets avant de conclure, et referme sans réponse", () => {
    const composant = lire("src/components/admin/FermerEnQuittant.tsx");
    // Un second onglet est une session de navigation neuve : sans cette question, l'ouvrir
    // refermerait l'espace admin de l'onglet d'à côté.
    expect(composant).toContain('canal.postMessage("qui-vive")');
    expect(composant).toContain('if (e.data === "present") repondu = true;');
    expect(composant).toContain("if (repondu) marquer();");
    expect(composant).toContain("else void quitterPourDeBon();");
    // Pas de `BroadcastChannel` du tout : on referme. Se tromper de ce côté coûte un mot de passe.
    expect(composant).toContain('if (typeof BroadcastChannel === "undefined") {');
  });

  it("la date d'ouverture vient du jeton signé, pas du navigateur", () => {
    const elevation = lire("src/lib/auth/elevation.ts");
    expect(elevation).toContain("export async function ouvertureElevation(");
    expect(elevation).toContain("return new Date(jeton.exp - DUREE_ELEVATION_MS);");
    // Le jeton est vérifié avant d'être lu : une date retouchée à la main ne passe pas. Et **la
    // vérification exige son usage** (`USAGES_JETON`, `src/lib/auth/tokens.ts`) : un seul secret signe
    // tout ce que l'application frappe, donc un lecteur qui ne nommerait pas sa famille accepterait
    // n'importe quel jeton de même forme. Un lecteur sans usage ne compile pas ; ce test garde en plus
    // le fait que **celui-ci** dise bien « elevation ».
    expect(elevation).toContain('const jeton = verifySignedPayload<JetonElevation>(brut, env().SESSION_SECRET, "elevation");');
    // Les deux frappes du cookie et ses deux lectures nomment le même usage, sans exception.
    expect(elevation.match(/"elevation"\)/g) ?? []).toHaveLength(3);
  });
});

/**
 * **Se connecter n'ouvre pas l'espace admin**.
 *
 * Signalé par Delta : « je viens de me reconnecter et j'étais en admin… ça aurait dû couper
 * l'accès admin à la connexion ». La session d'un ADMIN naissait « forte » quand il se connectait
 * au mot de passe *et* au code — au motif que la porte d'à côté demande exactement ces deux
 * preuves. Résultat : on ouvrait l'application et l'on était dans les réglages sans l'avoir
 * demandé, avec les douze heures de l'élévation qui partaient toutes seules.
 *
 * C'était aussi une contradiction interne : `seConnecterCommeAdmin` écrit noir sur blanc que les
 * deux preuves sont redemandées « même si la session vient d'être ouverte au mot de passe ».
 */
describe("la connexion n'élève personne", () => {
  const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

  it("la session naît ordinaire, même pour un administrateur qui a donné mot de passe et code", () => {
    const actions = lire("src/actions/auth.ts");
    // Le 4e argument est `forte`, resté `false` ; le 3e dit seulement par quelle porte on est entré
    // et n'ouvre rien de plus.
    expect(actions).toContain('await createSession(user.id, attente.remember === 1, "mot-de-passe", false);');
    // Plus aucune création de session ne demande la force : elle ne s'obtient qu'en s'élevant
    expect(actions).not.toMatch(/createSession\([^)]*,\s*forte\s*\)/);
    expect(actions).not.toContain("const forte = peutOuvrirSessionForte(user);");
  });

  it("la force ne s'obtient que par la porte, qui redemande les deux preuves", () => {
    const actions = lire("src/actions/auth.ts");
    // `seConnecterCommeAdmin` : mot de passe **et** code, puis renforcement de la session courante
    expect(actions).toContain("await renforcerSessionCourante(user.sessionId);");
    expect(actions).toContain('await audit({ id: user.id, email: user.email }, "admin.espace_ouvert");');
    const session = lire("src/lib/auth/session.ts");
    // Le seul endroit qui pose `forte: true` reste l'élévation elle-même
    expect(session).toContain("export async function renforcerSessionCourante(sessionId: string): Promise<void> {");
    expect(session.match(/forte: true/g) ?? []).toHaveLength(1);
  });

  it("le journal d'audit ne raconte plus de connexion forte", () => {
    const actions = lire("src/actions/auth.ts");
    expect(actions).toContain("deuxFa: true, forte: false,");
  });
});


/* ---------------------------------------------------------------- */
/* Le code récent : une garde qui s'ouvre en silence ne se voit pas  */
/* ---------------------------------------------------------------- */

/**
 * **`exigerReauth` n'avait aucune contre-épreuve de comportement, et c'est ce qui a coûté cher**.
 * Deux tests la gardaient — `ecritures-code-recent` relit les sources pour vérifier que chaque
 * écriture sensible l'**appelle**, `refus-avant-demande-de-code` vérifie l'**ordre** des gardes —
 * mais tous deux la remplacent par un bouchon. Personne n'exécutait donc son corps, et sa première
 * ligne (`if (user.role !== "ADMIN") return;`) a cessé de distinguer qui que ce soit le jour où le
 * bureau est passé dans `estAdmin` : elle rendait la main **tout de suite, pour tout le monde**, et
 * plus un seul geste ne redemandait de code. Un refus de trop finit par être signalé par
 * quelqu'un ; une garde qui s'ouvre en silence, jamais.
 */
function acteur(champs: { estAdmin: boolean; sessionForte: boolean; reauthAt?: Date | null }) {
  return { id: "u-admin", role: "INSTRUCTEUR", reauthAt: null, ...champs } as unknown as Parameters<typeof exigerReauth>[0];
}

describe("le code récent exigé avant une écriture sensible", () => {
  it("ne demande rien à qui n'est pas du bureau", async () => {
    // Un instructeur entre par son lien, sans mot de passe ni 2FA : il n'y a pas de code à redemander.
    await expect(exigerReauth(acteur({ estAdmin: false, sessionForte: false }), "/admin/membres")).resolves.toBeUndefined();
  });

  it("renvoie à la porte de l'espace admin un membre du bureau qui ne s'est pas élevé", async () => {
    await expect(exigerReauth(acteur({ estAdmin: true, sessionForte: false }), "/admin/membres")).rejects.toThrow(
      "REDIRECTION:/connexion/admin?suite=%2Fadmin%2Fmembres",
    );
  });

  it("redemande le code quand la dernière vérification est trop vieille, et se tait quand elle est fraîche", async () => {
    const vieux = new Date(Date.now() - DUREE_REAUTH_MS - 1_000);
    await expect(exigerReauth(acteur({ estAdmin: true, sessionForte: true, reauthAt: vieux }), "/admin/membres")).rejects.toThrow(
      "REDIRECTION:/connexion/verifier?suite=%2Fadmin%2Fmembres",
    );
    // Jamais vérifié du tout : c'est le cas le plus demandeur, pas le plus permissif.
    await expect(exigerReauth(acteur({ estAdmin: true, sessionForte: true, reauthAt: null }), "/admin/membres")).rejects.toThrow("REDIRECTION:/connexion/verifier");
    await expect(exigerReauth(acteur({ estAdmin: true, sessionForte: true, reauthAt: new Date() }), "/admin/membres")).resolves.toBeUndefined();
  });
});
