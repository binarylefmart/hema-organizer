import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **La double authentification se gère dans l'espace admin** (« Comptes admin ») : la sienne
 * (codes de secours, nouveau téléphone) et celle qu'un membre garde d'avant. Mêmes verrous que la
 * réinitialisation de celle d'un autre administrateur : élévation, code récent, audit.
 */

const faux = vi.hoisted(() => ({
  acteur: {
    id: "a",
    email: "alix@club.test",
    role: "MEMBRE",
    estAdmin: true,
    actif: true,
    sessionForte: true,
    sessionId: "s-a",
  } as Record<string, unknown>,
  cible: null as Record<string, unknown> | null,
  motDePasseJuste: true,
  totpDesactives: [] as string[],
  sessionsRevoquees: [] as Array<[string, boolean]>,
  abaissees: [] as string[],
  reauth: [] as string[],
  audits: [] as Array<[string, string | null]>,
  avisTitulaire: [] as Array<{ id: string; evenement: string }>,
  cookies: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) => (nom in faux.cookies ? { name: nom, value: faux.cookies[nom] } : undefined),
    set: (nom: string, valeur: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) delete faux.cookies[nom];
      else faux.cookies[nom] = valeur;
    },
  }),
  headers: async () => new Headers(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUniqueOrThrow: vi.fn(async () => faux.cible),
      findUnique: vi.fn(async () => faux.cible),
    },
  },
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(
    async (_a: unknown, action: string, cible?: string | null) =>
      void faux.audits.push([action, cible ?? null]),
  ),
}));
vi.mock("@/lib/auth/deux-fa", () => ({
  desactiverTotp: vi.fn(
    async (id: string) => void faux.totpDesactives.push(id),
  ),
  ouvrirAffichageCodes: vi.fn(async () => {}),
  genererSecretTotp: vi.fn(() => "JBSWY3DPEHPK3PXP"),
}));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(async () => faux.motDePasseJuste),
}));
vi.mock("@/lib/auth/session", () => ({
  revokeAllSessions: vi.fn(async (id: string, sauf: boolean) => {
    faux.sessionsRevoquees.push([id, sauf]);
    return 2;
  }),
  abaisserSessionCourante: vi.fn(
    async (id: string) => void faux.abaissees.push(id),
  ),
}));
vi.mock("@/lib/auth/current-user", () => ({
  assertPermission: vi.fn(async () => faux.acteur),
  exigerReauth: vi.fn(
    async (_u: unknown, suite: string) => void faux.reauth.push(suite),
  ),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("@/lib/auth/demande-deux-fa", async (original) => ({
  ...(await original<typeof import("@/lib/auth/demande-deux-fa")>()),
  prevenirTitulaireDeuxFa: vi.fn(async (a: { titulaire: { id: string }; evenement: string }) => void faux.avisTitulaire.push({ id: a.titulaire.id, evenement: a.evenement })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { reinitialiserMaDeuxFa, retirerDeuxFaMembre } =
  await import("@/actions/admin");
const { utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");
const { lireReglage2fa } = await import("@/lib/auth/acces-admin");

const ACTIVE = new Date("2026-09-01T10:00:00Z");
const fd = () => {
  const f = new FormData();
  f.set("motDePasse", "secret");
  return f;
};

beforeEach(() => {
  utiliserMagasinMemoire();
  faux.cible = null;
  faux.motDePasseJuste = true;
  faux.totpDesactives = [];
  faux.sessionsRevoquees = [];
  faux.abaissees = [];
  faux.reauth = [];
  faux.audits = [];
  faux.avisTitulaire = [];
  faux.cookies = {};
});

describe("réinitialiser sa propre double authentification", () => {
  const moi = {
    id: "a",
    prenom: "Alix",
    email: "alix@club.test",
    role: "MEMBRE",
    estAdmin: true,
    actif: true,
    service: false,
    passwordHash: "h",
    totpSecret: "s",
    totpActiveAt: ACTIVE,
  };

  it("redemande un code récent et le mot de passe, puis renvoie sur le parcours de réglage", async () => {
    faux.cible = moi;
    await expect(reinitialiserMaDeuxFa({}, fd())).rejects.toThrow(
      "REDIRECTION:/admin/activer",
    );
    expect(faux.reauth).toEqual(["/admin/comptes#ma-deux-fa"]);
    expect(faux.totpDesactives).toEqual(["a"]);
    // Les autres appareils sont fermés, et l'élévation de celui-ci retombe : plus de second facteur.
    expect(faux.sessionsRevoquees).toEqual([["a", true]]);
    expect(faux.abaissees).toEqual(["s-a"]);
    expect(faux.audits).toContainEqual(["deux_fa.reinitialisee", "a"]);
    // Le QR code est prêt ; le code d'activation, lui, viendra d'un autre membre du bureau.
    expect(await lireReglage2fa("a")).toBe("JBSWY3DPEHPK3PXP");
    // Aucun code d'activation n'est généré ici : on ne s'en remet pas un à soi-même.
    expect(faux.audits.map(([action]) => action)).not.toContain("deux_fa.code_activation_genere");
  });

  it("un mot de passe faux ne retire rien", async () => {
    faux.cible = moi;
    faux.motDePasseJuste = false;
    expect((await reinitialiserMaDeuxFa({}, fd())).erreur).toBe(
      "Mot de passe incorrect.",
    );
    expect(faux.totpDesactives).toEqual([]);
  });

  it("vaut aussi pour le compte du portail, seul à pouvoir réinitialiser la sienne", async () => {
    faux.cible = { ...moi, service: true };
    await expect(reinitialiserMaDeuxFa({}, fd())).rejects.toThrow(
      "REDIRECTION:/admin/activer",
    );
    expect(faux.totpDesactives).toEqual(["a"]);
  });
});

describe("retirer la double authentification d'un membre (héritée, sans effet)", () => {
  const membre = {
    id: "m",
    email: "m@club.test",
    role: "MEMBRE",
    estAdmin: false,
    actif: true,
    service: false,
    totpSecret: "s",
    totpActiveAt: ACTIVE,
  };

  it("la retire, avec code récent et audit, sans fermer ses sessions", async () => {
    faux.cible = membre;
    await retirerDeuxFaMembre("m");
    expect(faux.reauth).toEqual(["/admin/comptes"]);
    expect(faux.totpDesactives).toEqual(["m"]);
    expect(faux.sessionsRevoquees).toEqual([]);
    expect(faux.audits).toContainEqual(["deux_fa.reinitialisee", "m"]);
    // La personne l'apprend elle-même
    expect(faux.avisTitulaire).toEqual([{ id: "m", evenement: "retiree" }]);
  });

  it("refuse un membre du bureau et le compte du portail", async () => {
    faux.cible = { ...membre, estAdmin: true };
    await expect(retirerDeuxFaMembre("m")).rejects.toThrow(/administrateur/);
    faux.cible = { ...membre, service: true };
    await expect(retirerDeuxFaMembre("m")).rejects.toThrow(/que par lui-même/);
    expect(faux.totpDesactives).toEqual([]);
  });
});
