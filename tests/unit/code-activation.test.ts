import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Code d'activation à usage unique, remis hors bande.**
 *
 * Ce que ce fichier verrouille (le parcours `/admin/activer` lui-même est éprouvé dans
 * `admin-activation.test.ts`, « code d'activation exigé à l'étape 2 ») :
 * - la forme du code (alphabet sans 0/O/1/I/L, six signes, `K7P-42M`) et la saisie tolérante ;
 * - l'empreinte (HMAC liée au compte et au secret du serveur, jamais le code) et l'échéance ;
 * - l'usage unique par écriture conditionnelle ;
 * - le cookie d'affichage : signé, chiffré, **nommé à l'administrateur** qui l'a généré, d'un usage à lui ;
 * - les quatre portes qui font naître un code (nomination — voir `nommer-admins-en-masse.test.ts` —,
 *   réinitialisation de la 2FA d'un autre, remise à zéro de l'accès, bouton « Générer ») et leurs gardes ;
 * - le journal : l'échéance, jamais le code ; l'avis au titulaire : jamais le code.
 */

type Cible = {
  id: string;
  prenom: string;
  nom: string;
  email: string | null;
  role: string;
  estAdmin: boolean;
  actif: boolean;
  service: boolean;
  totpSecret: string | null;
  totpActiveAt: Date | null;
  passwordHash?: string | null;
  codeActivationHash?: string | null;
  codeActivationExpireLe?: Date | null;
};

const faux = vi.hoisted(() => ({
  acteur: { id: "u-delta", prenom: "Delta", nom: "L.", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true, sessionForte: true, sessionId: "s" } as Record<string, unknown>,
  comptes: {} as Record<string, Record<string, unknown>>,
  audits: [] as { action: string; cible: string | null; details: unknown }[],
  reauth: [] as string[],
  avis: [] as unknown[],
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

/** Base minimale, mais qui **respecte le `where` conditionnel** : c'est lui qui fait l'usage unique. */
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.comptes[where.id] ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const u = faux.comptes[where.id];
        if (!u) throw new Error("introuvable");
        return u;
      }),
      update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const u = faux.comptes[where.id as string];
        const correspond = u && Object.entries(where).every(([k, v]) => k === "id" || u[k] === v);
        if (!correspond) throw Object.assign(new Error("Record not found"), { code: "P2025" });
        Object.assign(u, data);
        return u;
      }),
    },
    authSession: { deleteMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(async () => ({ count: 0 })) },
  },
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, cible?: string | null, details?: unknown) => {
    faux.audits.push({ action, cible: cible ?? null, details: details ?? null });
  }),
}));
vi.mock("@/lib/auth/current-user", async () => {
  const { can } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof can>[1]) => {
      if (!can(faux.acteur as Parameters<typeof can>[0], permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async (_u: unknown, suite: string) => void faux.reauth.push(suite)),
    getCurrentUser: vi.fn(async () => faux.acteur),
  };
});
vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0), abaisserSessionCourante: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/demande-deux-fa", async (original) => ({
  ...(await original<typeof import("@/lib/auth/demande-deux-fa")>()),
  prevenirTitulaireDeuxFa: vi.fn(async (a: unknown) => void faux.avis.push(a)),
}));
vi.mock("@/lib/reinitialisation-acces", () => ({
  remettreAccesAZero: vi.fn(async () => ({ liensRevoques: 0, sessionsFermees: 0, lienRenvoye: true })),
}));

const forme = await import("@/lib/auth/code-activation");
const {
  ALPHABET_CODE_ACTIVATION,
  DUREE_CODE_ACTIVATION_MS,
  codeActivationEnCours,
  empreinteCodeActivation,
  exigeCodeActivation,
  formaterCodeActivation,
  genererCodeActivation,
  normaliserCodeActivation,
  verifierCodeActivation,
} = forme;
const { afficherCodesActivation, consommerCodeActivation, controlerCodeActivation, emettreCodeActivation, fermerCodesActivationAffiches, lireCodesActivationAffiches } =
  await import("@/lib/auth/activation-bureau");
const { genererCodeActivationCompte, masquerCodesActivation, reinitialiserDeuxFaCompte } = await import("@/actions/admin");
const { reinitialiserAccesMembre } = await import("@/actions/membres");
const { signPayload } = await import("@/lib/auth/tokens");
const { utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");

const SECRET = "secret-de-test-0123456789-0123456789-0123456789";

function cible(id: string, p: Partial<Cible> = {}): Cible {
  const c: Cible = {
    id,
    prenom: id[0].toUpperCase() + id.slice(1),
    nom: "Test",
    email: `${id}@club.test`,
    role: "MEMBRE",
    estAdmin: true,
    actif: true,
    service: false,
    totpSecret: null,
    totpActiveAt: null,
    passwordHash: null,
    codeActivationHash: null,
    codeActivationExpireLe: null,
    ...p,
  };
  faux.comptes[id] = c as unknown as Record<string, unknown>;
  return c;
}

beforeEach(() => {
  utiliserMagasinMemoire();
  faux.acteur = { id: "u-delta", prenom: "Delta", nom: "L.", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true, sessionForte: true, sessionId: "s" };
  faux.comptes = {};
  faux.audits = [];
  faux.reauth = [];
  faux.avis = [];
  faux.cookies = {};
  cible("u-delta", { prenom: "Delta", totpSecret: "x", totpActiveAt: new Date() });
});

/* ---------------------------------------------------------------- */
/* Forme                                                             */
/* ---------------------------------------------------------------- */

describe("forme du code", () => {
  it("six signes d'un alphabet de 31, sans 0, O, 1, I ni L", () => {
    expect(ALPHABET_CODE_ACTIVATION).toHaveLength(31);
    for (const interdit of ["0", "O", "1", "I", "L"]) expect(ALPHABET_CODE_ACTIVATION).not.toContain(interdit);
    expect(new Set(ALPHABET_CODE_ACTIVATION).size).toBe(31);
    for (let i = 0; i < 500; i++) expect(genererCodeActivation()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  });

  it("est tiré au hasard : mille codes, mille valeurs, et tout l'alphabet sert", () => {
    const codes = Array.from({ length: 1000 }, genererCodeActivation);
    expect(new Set(codes).size).toBe(1000);
    expect(new Set(codes.join("")).size).toBe(31);
  });

  it("s'affiche en deux groupes de trois", () => {
    expect(formaterCodeActivation("K7P42M")).toBe("K7P-42M");
  });

  it("se saisit sans souci de casse, d'espaces ni de tiret", () => {
    for (const saisie of ["K7P-42M", "k7p-42m", " K7P 42M ", "k7p42m", "K7P‑42M", "K7P – 42M", "K7P.42M", "K7P 42M"]) {
      expect(normaliserCodeActivation(saisie)).toBe("K7P42M");
    }
  });

  it("refuse ce qui n'a pas la forme d'un code", () => {
    for (const saisie of ["", "K7P42", "K7P-42M-2", "K0P42M", "KOP42M", "K1P42M", "KIP42M", "KLP42M", "K7P_42M", "x".repeat(100)]) {
      expect(normaliserCodeActivation(saisie)).toBeNull();
    }
    for (const saisie of [null, undefined, 123456, { code: "K7P42M" }]) expect(normaliserCodeActivation(saisie)).toBeNull();
  });

  it("est exigé des membres du bureau nominatifs, pas du compte du portail ni hors du bureau", () => {
    expect(exigeCodeActivation({ estAdmin: true, service: false })).toBe(true);
    expect(exigeCodeActivation({ estAdmin: true, service: true })).toBe(false);
    expect(exigeCodeActivation({ estAdmin: false, service: false })).toBe(false);
    expect(exigeCodeActivation(null)).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* Empreinte, échéance, usage unique                                 */
/* ---------------------------------------------------------------- */

describe("empreinte et vérification", () => {
  it("garde une empreinte HMAC liée au compte et au secret du serveur, jamais le code", () => {
    const e = empreinteCodeActivation("u1", "K7P42M", SECRET);
    expect(e).toMatch(/^[0-9a-f]{64}$/);
    expect(e).not.toContain("K7P42M");
    expect(empreinteCodeActivation("u2", "K7P42M", SECRET)).not.toBe(e);
    expect(empreinteCodeActivation("u1", "K7P42M", `${SECRET}-autre`)).not.toBe(e);
    expect(empreinteCodeActivation("u1", "K7P42N", SECRET)).not.toBe(e);
  });

  it("dit absent, forme, faux, expiré ou juste — et « expiré » seulement au bon code", () => {
    const maintenant = Date.parse("2026-10-14T10:00:00Z");
    const etat = { codeActivationHash: empreinteCodeActivation("u1", "K7P42M", SECRET), codeActivationExpireLe: new Date(maintenant + 1000) };
    expect(verifierCodeActivation("u1", null, "K7P-42M", SECRET, maintenant)).toEqual({ ok: false, raison: "absent" });
    expect(verifierCodeActivation("u1", { codeActivationHash: null, codeActivationExpireLe: null }, "K7P-42M", SECRET, maintenant)).toEqual({ ok: false, raison: "absent" });
    expect(verifierCodeActivation("u1", etat, "K7P", SECRET, maintenant)).toEqual({ ok: false, raison: "forme" });
    expect(verifierCodeActivation("u1", etat, "K7P-42N", SECRET, maintenant)).toEqual({ ok: false, raison: "faux" });
    expect(verifierCodeActivation("u2", etat, "K7P-42M", SECRET, maintenant)).toEqual({ ok: false, raison: "faux" });
    expect(verifierCodeActivation("u1", etat, "k7p 42m", SECRET, maintenant)).toEqual({ ok: true, empreinte: etat.codeActivationHash });
    expect(verifierCodeActivation("u1", etat, "K7P-42M", SECRET, maintenant + 1000)).toEqual({ ok: false, raison: "expire" });
    expect(verifierCodeActivation("u1", etat, "K7P-42N", SECRET, maintenant + 5000)).toEqual({ ok: false, raison: "faux" });
  });

  it("vaut 48 heures", async () => {
    const c = cible("camille");
    const avant = Date.now();
    const { expireLe } = await emettreCodeActivation(c.id);
    expect(expireLe.getTime() - avant).toBeGreaterThanOrEqual(DUREE_CODE_ACTIVATION_MS - 1000);
    expect(expireLe.getTime() - avant).toBeLessThanOrEqual(DUREE_CODE_ACTIVATION_MS + 1000);
    expect(DUREE_CODE_ACTIVATION_MS).toBe(48 * 60 * 60 * 1000);
    expect(codeActivationEnCours(c)).toEqual(expireLe);
    expect(codeActivationEnCours(c, expireLe.getTime())).toBeNull();
  });

  it("n'écrit en base que l'empreinte et l'échéance", async () => {
    const c = cible("camille");
    const { code } = await emettreCodeActivation(c.id);
    expect(JSON.stringify(faux.comptes.camille)).not.toContain(code);
    expect(c.codeActivationHash).toBe(empreinteCodeActivation(c.id, code, SECRET));
  });

  it("un nouveau code remplace le précédent", async () => {
    const c = cible("camille");
    const premier = (await emettreCodeActivation(c.id)).code;
    const second = (await emettreCodeActivation(c.id)).code;
    expect((await controlerCodeActivation(c.id, premier)).ok).toBe(premier === second);
    expect((await controlerCodeActivation(c.id, second)).ok).toBe(true);
  });

  it("ne se consomme qu'une fois, même par deux appels qui l'ont vérifié ensemble", async () => {
    const c = cible("camille");
    const { code } = await emettreCodeActivation(c.id);
    const a = await controlerCodeActivation(c.id, code);
    const b = await controlerCodeActivation(c.id, code);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(await consommerCodeActivation(c.id, a.empreinte)).toBe(true);
    expect(await consommerCodeActivation(c.id, b.empreinte)).toBe(false);
    expect(c.codeActivationHash).toBeNull();
    expect(await controlerCodeActivation(c.id, code)).toEqual({ ok: false, raison: "absent" });
  });

  it("un code remplacé entre la vérification et la consommation n'est plus consommable", async () => {
    const c = cible("camille");
    const { code } = await emettreCodeActivation(c.id);
    const v = await controlerCodeActivation(c.id, code);
    await emettreCodeActivation(c.id);
    expect(v.ok && (await consommerCodeActivation(c.id, v.empreinte))).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* Cookie d'affichage                                                */
/* ---------------------------------------------------------------- */

describe("affichage unique à l'administrateur qui l'a généré", () => {
  const ligne = (userId: string, code = "K7P42M") => ({ userId, nom: `Nom ${userId}`, code, expireLe: Date.now() + DUREE_CODE_ACTIVATION_MS });

  it("se relit pour lui, pas pour un autre, et ne porte pas le code en clair", async () => {
    await afficherCodesActivation("u-delta", [ligne("camille")]);
    expect(await lireCodesActivationAffiches("u-delta")).toEqual([ligne("camille")].map((l) => ({ ...l, expireLe: expect.any(Number) })));
    expect(await lireCodesActivationAffiches("u-foxtrot")).toEqual([]);
    expect(faux.cookies.hema_codes_activation).toBeDefined();
    expect(faux.cookies.hema_codes_activation).not.toContain("K7P42M");
    expect(Buffer.from(faux.cookies.hema_codes_activation.split(".")[0], "base64url").toString()).not.toContain("K7P42M");
  });

  it("garde les codes déjà affichés, sauf celui d'une même personne, que le nouveau remplace", async () => {
    await afficherCodesActivation("u-delta", [ligne("camille", "AAAAAA"), ligne("dominique", "BBBBBB")]);
    await afficherCodesActivation("u-delta", [ligne("camille", "CCCCCC")]);
    expect((await lireCodesActivationAffiches("u-delta")).map((l) => [l.userId, l.code])).toEqual([
      ["dominique", "BBBBBB"],
      ["camille", "CCCCCC"],
    ]);
  });

  it("refuse un jeton d'un autre usage posé sous son nom, et une charge mal formée", async () => {
    const { chiffrer } = await import("@/lib/crypto");
    const charge = { uid: "u-delta", exp: Date.now() + 60_000, codes: chiffrer(JSON.stringify([ligne("camille")])) };
    faux.cookies.hema_codes_activation = signPayload(charge, SECRET, "codes-secours");
    expect(await lireCodesActivationAffiches("u-delta")).toEqual([]);
    faux.cookies.hema_codes_activation = signPayload({ uid: "u-delta", exp: Date.now() + 60_000, codes: 42 }, SECRET, "code-activation");
    expect(await lireCodesActivationAffiches("u-delta")).toEqual([]);
    faux.cookies.hema_codes_activation = signPayload({ ...charge, exp: Date.now() - 1 }, SECRET, "code-activation");
    expect(await lireCodesActivationAffiches("u-delta")).toEqual([]);
    faux.cookies.hema_codes_activation = signPayload(charge, SECRET, "code-activation");
    expect(await lireCodesActivationAffiches("u-delta")).toHaveLength(1);
  });

  it("se referme sur « C'est noté »", async () => {
    await afficherCodesActivation("u-delta", [ligne("camille")]);
    await masquerCodesActivation();
    expect(await lireCodesActivationAffiches("u-delta")).toEqual([]);
    await fermerCodesActivationAffiches();
  });
});

/* ---------------------------------------------------------------- */
/* Les portes qui font naître un code                                */
/* ---------------------------------------------------------------- */

describe("« Générer un code d'activation » (Comptes admin)", () => {
  it("émet un code, l'affiche à qui l'a généré, journalise l'échéance sans le code, après le code récent", async () => {
    const c = cible("camille");
    const res = await genererCodeActivationCompte(c.id);
    expect(res.succes).toContain("Camille Test");
    expect(faux.reauth).toEqual(["/admin/comptes"]);
    const [affiche] = await lireCodesActivationAffiches("u-delta");
    expect(affiche.userId).toBe("camille");
    expect((await controlerCodeActivation(c.id, affiche.code)).ok).toBe(true);
    const journal = faux.audits.filter((a) => a.action === "deux_fa.code_activation_genere");
    expect(journal).toHaveLength(1);
    expect(journal[0].cible).toBe("camille");
    expect(journal[0].details).toMatchObject({ echeance: expect.any(String), origine: "demande" });
    expect(JSON.stringify(faux.audits)).not.toContain(affiche.code);
  });

  it("refuse le compte du portail, soi-même, hors du bureau, un compte désactivé et une 2FA déjà active — sans code redemandé", async () => {
    cible("portail", { service: true });
    cible("membre", { estAdmin: false });
    cible("off", { actif: false });
    cible("regle", { totpSecret: "s", totpActiveAt: new Date() });
    expect((await genererCodeActivationCompte("portail")).erreur).toContain("portail");
    expect((await genererCodeActivationCompte("u-delta")).erreur).toContain("jamais à soi-même");
    expect((await genererCodeActivationCompte("membre")).erreur).toContain("pas administrateur");
    expect((await genererCodeActivationCompte("off")).erreur).toContain("désactivé");
    expect((await genererCodeActivationCompte("regle")).erreur).toContain("déjà active");
    expect((await genererCodeActivationCompte("inconnu")).erreur).toContain("pas administrateur");
    expect(faux.reauth).toEqual([]);
    expect(faux.audits).toEqual([]);
    expect(await lireCodesActivationAffiches("u-delta")).toEqual([]);
  });

  it("est fermé à qui n'a pas la gestion des comptes admin", async () => {
    faux.acteur = { id: "u-charlie", email: "b@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    cible("camille");
    await expect(genererCodeActivationCompte("camille")).rejects.toThrow("Accès refusé");
  });
});

describe("réinitialiser la 2FA d'un autre membre du bureau", () => {
  it("fait naître un code, affiché à qui a réinitialisé — et l'avis au titulaire ne le porte pas", async () => {
    const c = cible("camille", { totpSecret: "s", totpActiveAt: new Date() });
    await reinitialiserDeuxFaCompte(c.id);
    const [affiche] = await lireCodesActivationAffiches("u-delta");
    expect(affiche.userId).toBe("camille");
    expect((await controlerCodeActivation(c.id, affiche.code)).ok).toBe(true);
    expect(faux.audits.find((a) => a.action === "deux_fa.code_activation_genere")?.details).toMatchObject({ origine: "reinitialisation_2fa" });
    expect(faux.avis).toHaveLength(1);
    expect(JSON.stringify(faux.avis)).not.toContain(affiche.code);
    expect(JSON.stringify(faux.avis)).not.toContain(formaterCodeActivation(affiche.code));
  });
});

describe("remettre à zéro l'accès d'un membre", () => {
  it("fait naître un code si la personne est du bureau", async () => {
    // Déjà entrée (un mot de passe) : c'est la condition de la remise à zéro (`aDejaUnAcces`)
    cible("camille", { passwordHash: "h", totpSecret: "s", totpActiveAt: new Date() });
    await reinitialiserAccesMembre("camille");
    const [affiche] = await lireCodesActivationAffiches("u-delta");
    expect(affiche?.userId).toBe("camille");
    expect(faux.audits.find((a) => a.action === "deux_fa.code_activation_genere")?.details).toMatchObject({ origine: "reinitialisation_acces" });
  });

  it("n'en fait pas naître pour un membre ou un instructeur", async () => {
    cible("chloe", { estAdmin: false, passwordHash: "h" });
    await reinitialiserAccesMembre("chloe");
    expect(await lireCodesActivationAffiches("u-delta")).toEqual([]);
    expect(faux.audits.map((a) => a.action)).not.toContain("deux_fa.code_activation_genere");
  });
});
