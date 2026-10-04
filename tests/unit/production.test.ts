import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BEQUILLES_DEV, bequilleDev, bequilleDevActive } from "@/lib/env";
import { checkRateLimit, RATE_LIMITS, utiliserMagasinMemoire } from "@/lib/auth/rate-limit";
import { lienSature } from "@/lib/invitations";
import { DEMO_MOT_DE_PASSE, DEMO_TOTP_SECRET } from "../../prisma/comptes";

/**
 * Garde-fou de mise en production : les béquilles de développement (limiteur de débit désactivé,
 * tâches planifiées coupées, emails écrits sur disque, plafond d'appareils relevé) doivent être
 * hors d'atteinte dès que NODE_ENV vaut "production", et aucune donnée de démonstration
 * (comptes, secrets, jetons du seed) ne doit être référencée depuis src/.
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("béquilles de développement", () => {
  it("sont toutes neutralisées en production, même définies dans l'environnement", () => {
    for (const nom of BEQUILLES_DEV) vi.stubEnv(nom, "1");
    vi.stubEnv("NODE_ENV", "production");
    for (const nom of BEQUILLES_DEV) {
      expect(bequilleDev(nom)).toBeUndefined();
      expect(bequilleDevActive(nom)).toBe(false);
    }
  });

  it("restent utilisables en développement", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RATE_LIMIT_DISABLED", "1");
    vi.stubEnv("LIEN_MAX_APPAREILS", "50");
    expect(bequilleDevActive("RATE_LIMIT_DISABLED")).toBe(true);
    expect(bequilleDev("LIEN_MAX_APPAREILS")).toBe("50");
  });

  it("le limiteur de débit ne peut pas être désactivé en production", async () => {
    utiliserMagasinMemoire();
    vi.stubEnv("RATE_LIMIT_DISABLED", "1");
    vi.stubEnv("NODE_ENV", "production");
    const { max } = RATE_LIMITS.login_email;
    for (let i = 0; i < max; i++) expect(await checkRateLimit("login_email", "prod@club.test")).toBe(true);
    expect(await checkRateLimit("login_email", "prod@club.test")).toBe(false);
  });

  it("le plafond de 3 appareils par lien ne peut pas être relevé en production", () => {
    vi.stubEnv("LIEN_MAX_APPAREILS", "50");
    vi.stubEnv("NODE_ENV", "development");
    expect(lienSature(3)).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(lienSature(3)).toBe(true);
  });
});

describe("configuration de production", () => {
  it("refuse un domaine local quand NODE_ENV vaut production", async () => {
    vi.stubEnv("DOMAIN", "localhost:3000");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { env } = await import("@/lib/env");
    expect(() => env()).toThrow(/DOMAIN/);
  });

  it("déduit l'expéditeur des emails du domaine public quand SMTP_FROM et SMTP_USER sont absents", async () => {
    vi.stubEnv("SMTP_FROM", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("DOMAIN", "organizer.mon-club.fr");
    vi.resetModules();
    const { expediteur } = await import("@/lib/env");
    expect(expediteur()).toBe("HEMA Organizer <no-reply@organizer.mon-club.fr>");
  });

  /** Un serveur n'accepte souvent d'envoyer qu'au nom du compte authentifié : il passe avant l'adresse inventée. */
  it("préfère la boîte authentifiée à une adresse inventée sur le domaine", async () => {
    vi.stubEnv("SMTP_FROM", "");
    vi.stubEnv("SMTP_USER", "contact@mon-club.fr");
    vi.stubEnv("DOMAIN", "organizer.mon-club.fr");
    vi.resetModules();
    const { expediteur } = await import("@/lib/env");
    expect(expediteur()).toBe("HEMA Organizer <contact@mon-club.fr>");
  });
});

describe("aucune trace de démonstration dans l'application", () => {
  const racine = path.resolve(__dirname, "../../src");

  function fichiersSource(dossier: string): string[] {
    return readdirSync(dossier).flatMap((nom) => {
      const chemin = path.join(dossier, nom);
      if (statSync(chemin).isDirectory()) return fichiersSource(chemin);
      return /\.(ts|tsx)$/.test(nom) ? [chemin] : [];
    });
  }

  it("aucun fichier de src/ n'importe les jeux de données de démonstration", () => {
    const fautifs = fichiersSource(racine).filter((f) => /from\s+["'][^"']*(comptes|seed-demo|donnees-club)["']/.test(readFileSync(f, "utf8")));
    expect(fautifs).toEqual([]);
  });

  /**
   * **Le mot de passe de démonstration est lu, il n'est plus deviné.**
   *
   * Ce garde-fou cherchait le littéral `demo-hema`, qui n'existe plus depuis que le jeu de données a
   * été débaptisé : il ne protégeait plus rien. Il importe désormais la valeur réelle depuis
   * `prisma/comptes.ts` — elle ne peut donc plus se démoder — et balaie aussi `scripts/`, où un
   * script de captures avait justement redéclaré ce mot de passe en dur au lieu de l'importer.
   */
  it("aucun secret ni jeton de démonstration n'est codé en dur dans src/ ni dans scripts/", () => {
    // Les **valeurs**, jamais les noms : un script a parfaitement le droit d'importer
    // `DEMO_MOT_DE_PASSE`, c'est même ce qu'on lui demande. Ce qu'on traque, c'est la valeur
    // recopiée à la main — celle qui se démode en silence et qu'aucun garde-fou ne voit.
    const valeurs = [DEMO_MOT_DE_PASSE, DEMO_TOTP_SECRET, "demo-invitation"];
    const fautifs = [racine, path.join(process.cwd(), "scripts")]
      .flatMap((d) => fichiersSource(d))
      .filter((f) => {
        const code = readFileSync(f, "utf8");
        return valeurs.some((v) => code.includes(v));
      });
    expect(fautifs).toEqual([]);
  });
});
