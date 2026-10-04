import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **Une pile déclarée saine, et bonne à rien.**
 *
 * Le `docker-compose.yml` de la racine sert à vérifier l'image dans les conditions de la production
 * avant de publier (utilisateur non-root, `cap_drop`, `tmpfs`, volumes /data et /backups). Il
 * posait `NODE_ENV=production` avec `DOMAIN=localhost:3000` — et `env()` **refuse** un domaine
 * local en production (`src/lib/env.ts` : les liens des emails en dépendent). La configuration
 * était donc rejetée à chaque requête qui a besoin du domaine, c'est-à-dire dès la pose du cookie
 * de session (`baseUrl()`) : **personne ne pouvait se connecter**. Pendant ce temps `/api/health`,
 * qui ne regardait que la base, répondait `{"ok":true}`, et le `healthcheck` du compose déclarait
 * la pile saine toutes les 30 secondes. Deux défauts qui se couvraient l'un l'autre : celui qui
 * casse, et celui qui empêche de le voir. Corrigés.
 *
 * Le piège, celui qui fait revenir le défaut : **`docker compose` lit tout seul le `.env` de la
 * racine**, où `DOMAIN=localhost:3000` est la bonne valeur pour `npm run dev`. Un `${DOMAIN:-…}`
 * reprend donc cette valeur quel que soit le défaut écrit dans le compose — corriger le défaut sans
 * changer le **nom** de la variable n'aurait rien corrigé du tout. Ce fichier relit donc le compose
 * et interpole ses variables comme le fait Docker, avec puis sans `.env` de poste, avant de
 * demander à `env()` — la règle elle-même, jamais sa paraphrase — si elle accepte cette pile.
 *
 * Dans l'esprit de `tests/unit/affiches.test.ts`, qui relie un plafond annoncé à l'utilisateur et le
 * plafond technique de `next.config.ts` : ce qui n'est pas éprouvé se recassera.
 */

const racine = process.cwd();
const lire = (f: string) => readFileSync(path.join(racine, f), "utf8");

const COMPOSE_DEV = "docker-compose.yml";
const COMPOSE_PROD = "docs/portainer-stack.yml";

/** Le bloc `environment:` du service `app`, tel qu'il est écrit (valeurs non interpolées). */
function environnement(fichier: string): Record<string, string> {
  const lignes = lire(fichier).split("\n");
  const debut = lignes.findIndex((l) => /^\s{4}environment:\s*$/.test(l));
  expect(debut, `${fichier} : bloc environment: introuvable`).toBeGreaterThan(-1);
  const vars: Record<string, string> = {};
  for (const ligne of lignes.slice(debut + 1)) {
    if (/^\s*(#.*)?$/.test(ligne)) continue;
    // Retour à une clé du service (4 espaces ou moins) : le bloc est fini.
    if (!/^\s{6}/.test(ligne)) break;
    const m = ligne.match(/^\s{6}([A-Z_][A-Z0-9_]*):\s*(.*)$/);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

/**
 * Les trois formes d'interpolation que Docker applique, et rien de plus : `${VAR}`, `${VAR:-défaut}`
 * et `${VAR:?message}` — cette dernière **arrête** `docker compose up` si la variable manque, ce que
 * l'on reproduit en levant.
 */
function interpoler(valeur: string, vars: Record<string, string | undefined>): string {
  return valeur.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([-?])([^}]*))?\}/g, (_tout, nom: string, op?: string, suite?: string) => {
    const brut = vars[nom];
    if (brut !== undefined && brut !== "") return brut;
    if (op === "-") return suite ?? "";
    if (op === "?") throw new Error(`${nom} manquante : ${suite}`);
    return "";
  });
}

/** L'environnement que le conteneur recevrait, à partir des variables du poste. */
function environnementEffectif(poste: Record<string, string | undefined>): Record<string, string> {
  const vars = environnement(COMPOSE_DEV);
  return Object.fromEntries(Object.entries(vars).map(([cle, valeur]) => [cle, interpoler(valeur, poste)]));
}

/**
 * Les deux postes qui comptent, et ils ne se choisissent pas : **avec** le `.env` que
 * `.env.example` prescrit (`DOMAIN=localhost:3000`, la valeur juste pour `npm run dev`) et **sans**
 * aucun `.env`, comme sur une machine neuve ou dans la CI. `SESSION_SECRET` est fourni dans les deux
 * cas : le compose l'exige, et le test n'a pas à dépendre du secret réel du poste.
 */
const SECRET = "secret-de-test-0123456789-0123456789-0123456789";
const POSTES: Array<[nom: string, vars: Record<string, string | undefined>]> = [
  ["poste sans .env", { SESSION_SECRET: SECRET }],
  ["poste dont le .env porte DOMAIN=localhost:3000", { SESSION_SECRET: SECRET, DOMAIN: "localhost:3000" }],
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("le compose de développement fait tourner l'image qu'il vérifie", () => {
  for (const [nom, poste] of POSTES) {
    it(`la configuration qu'il pose est acceptée par env() — ${nom}`, async () => {
      const conteneur = environnementEffectif(poste);
      // L'image est en production quoi qu'il arrive (Dockerfile + server.js de la sortie standalone) :
      // c'est la combinaison NODE_ENV=production + DOMAIN qui doit tenir, pas une variante de dev.
      expect(conteneur.NODE_ENV).toBe("production");
      for (const [cle, valeur] of Object.entries(conteneur)) vi.stubEnv(cle, valeur);
      vi.resetModules();
      const { env, baseUrl } = await import("@/lib/env");
      expect(() => env()).not.toThrow();
      // Et le cookie de session doit pouvoir être posé sans TLS : c'est le premier geste de qui se
      // connecte, et `secure` se déduit du schéma de `baseUrl()`.
      expect(baseUrl().startsWith("http://")).toBe(true);
    });

    it(`la sonde /api/health répond 200 avec cette configuration — ${nom}`, async () => {
      const conteneur = environnementEffectif(poste);
      for (const [cle, valeur] of Object.entries(conteneur)) vi.stubEnv(cle, valeur);
      vi.resetModules();
      vi.doMock("@/lib/db", () => ({ db: { $queryRaw: async () => [{ 1: 1 }] } }));
      const { GET } = await import("@/app/api/health/route");
      const reponse = await GET();
      expect(reponse.status).toBe(200);
      await expect(reponse.json()).resolves.toEqual({ ok: true });
      vi.doUnmock("@/lib/db");
    });
  }

  /**
   * Le nom de la variable **est** le correctif : tant que le compose lit `DOMAIN`, le `.env` du poste
   * (et `.env.example`, qui le prescrit) décide de la valeur, et le défaut écrit ici ne sert à rien.
   */
  it("ne prend pas son domaine dans une variable que le .env du poste renseigne", () => {
    const vars = environnement(COMPOSE_DEV);
    expect(vars.DOMAIN).toBeDefined();
    expect(vars.DOMAIN).not.toMatch(/\$\{DOMAIN[:}]/);
    if (existsSync(path.join(racine, ".env"))) {
      const nommees = [...vars.DOMAIN.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
      const duPoste = new Set(
        lire(".env")
          .split("\n")
          .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
          .filter((n): n is string => !!n),
      );
      for (const n of nommees) expect(duPoste.has(n), `${n} est renseignée par le .env du poste`).toBe(false);
    }
  });

  /** Le port publié et le port du domaine par défaut sont la même chose : ils ne peuvent pas diverger. */
  it("le domaine par défaut porte le port publié par défaut", () => {
    const compose = lire(COMPOSE_DEV);
    const port = compose.match(/\$\{HEMA_PORT:-(\d+)\}:3000/)?.[1];
    const domaine = environnement(COMPOSE_DEV).DOMAIN.match(/:-([^}]+)\}/)?.[1];
    expect(port).toBeDefined();
    expect(domaine).toContain(`:${port}`);
  });

  /** CLAUDE.md : « développement local uniquement (build local, port 3000 publié, volumes locaux) ». */
  it("reste ce qu'il annonce : build local, port publié, volumes nommés", () => {
    const compose = lire(COMPOSE_DEV);
    expect(compose).toMatch(/build:\s*\n\s+context: \./);
    expect(compose).toMatch(/- "\$\{HEMA_PORT:-3000\}:3000"/);
    expect(compose).toMatch(/- hema_data_dev:\/data/);
    expect(compose).toMatch(/- hema_backups_dev:\/backups/);
    // Les contraintes de la production, qui sont la raison d'être de ce fichier.
    expect(compose).toMatch(/no-new-privileges:true/);
    expect(compose).toMatch(/cap_drop:\s*\n\s+- ALL/);
  });

  /**
   * L'image doit satisfaire le compose de référence : la pile de développement doit donc éprouver
   * **les mêmes variables**, sans en oublier ni en inventer. Une variable présente d'un seul côté,
   * c'est un chemin de code que le test local ne traverse jamais.
   */
  it("déclare exactement les variables de la stack de production", () => {
    expect(Object.keys(environnement(COMPOSE_DEV)).sort()).toEqual(Object.keys(environnement(COMPOSE_PROD)).sort());
  });
});

describe("la sonde de santé ne déclare plus saine une pile qui ne sert à rien", () => {
  /** L'environnement d'un conteneur en bon état, d'où chaque cas retire une seule chose. */
  const SAIN = { NODE_ENV: "production", DOMAIN: "organizer.mon-club.fr", SESSION_SECRET: SECRET, DATABASE_URL: "file:/data/hema.db" };

  async function sonde(variables: Record<string, string>, baseOk = true) {
    for (const [cle, valeur] of Object.entries(variables)) vi.stubEnv(cle, valeur);
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      db: {
        $queryRaw: async () => {
          if (!baseOk) throw new Error("SQLITE_CANTOPEN");
          return [{ 1: 1 }];
        },
      },
    }));
    const { GET } = await import("@/app/api/health/route");
    const reponse = await GET();
    const corps = (await reponse.json()) as { ok: boolean; erreur?: string };
    vi.doUnmock("@/lib/db");
    return { status: reponse.status, corps };
  }

  it("reste verte quand tout va bien", async () => {
    const { status, corps } = await sonde(SAIN);
    expect(status).toBe(200);
    expect(corps).toEqual({ ok: true });
  });

  it("passe au rouge sur la combinaison même du compose fautif (domaine local en production)", async () => {
    const { status, corps } = await sonde({ ...SAIN, DOMAIN: "localhost:3000" });
    expect(status).toBe(503);
    expect(corps.ok).toBe(false);
  });

  it("passe au rouge sur un secret de session trop court", async () => {
    const { status } = await sonde({ ...SAIN, SESSION_SECRET: "trop-court" });
    expect(status).toBe(503);
  });

  /** Le contrôle ajouté ne doit pas faire oublier celui d'origine. */
  it("passe au rouge quand la base est inaccessible", async () => {
    const { status, corps } = await sonde(SAIN, false);
    expect(status).toBe(503);
    expect(corps.erreur).toBe("base");
  });

  /**
   * **Elle ne divulgue rien.** La route est joignable sans authentification (le proxy peut l'exposer) :
   * le corps porte un booléen et un mot, jamais un nom de variable, une valeur, un chemin ou une
   * trace. Le détail va au journal du conteneur, que l'administrateur lit déjà.
   */
  it("ne dit ni quelle variable, ni quelle valeur, ni où", async () => {
    for (const cas of [{ ...SAIN, DOMAIN: "localhost:3000" }, { ...SAIN, SESSION_SECRET: "trop-court" }]) {
      const { corps } = await sonde(cas);
      const texte = JSON.stringify(corps);
      for (const interdit of ["DOMAIN", "SESSION_SECRET", "localhost", "trop-court", "/data", "Error"]) {
        expect(texte, `${interdit} ne doit pas sortir de la sonde`).not.toContain(interdit);
      }
      expect(Object.keys(corps).sort()).toEqual(["erreur", "ok"]);
    }
  });

  /**
   * **Elle ne doit pas être fragile.** Ce que le contrôle ajouté touche est une validation pure et
   * mise en cache : appelée cent fois de suite — ce que fait Docker toutes les 30 secondes —, elle
   * rend le même verdict sans jamais toucher au disque ni au réseau, et n'interroge la base qu'une
   * fois par appel.
   */
  it("rend le même verdict à chaque appel et n'interroge la base qu'une fois par appel", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DOMAIN", SAIN.DOMAIN);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.resetModules();
    const requetes = vi.fn(async () => [{ 1: 1 }]);
    vi.doMock("@/lib/db", () => ({ db: { $queryRaw: requetes } }));
    const { GET } = await import("@/app/api/health/route");
    for (let i = 0; i < 5; i++) expect((await GET()).status).toBe(200);
    expect(requetes).toHaveBeenCalledTimes(5);
    vi.doUnmock("@/lib/db");
  });
});
