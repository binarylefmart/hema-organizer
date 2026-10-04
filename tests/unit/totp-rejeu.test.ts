import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Un code TOTP ne sert qu'une fois**.
 *
 * Rien ne marquait un code comme consommé : `verifierCodeTotp` ne regarde que l'horloge, et le même
 * code à six chiffres restait donc juste pendant toute sa fenêtre de 30 s **plus la tolérance d'un
 * pas de chaque côté** — 30 à 90 s. Qui apercevait un code par-dessus une épaule, le retrouvait sur
 * une capture d'écran ou dans le journal d'un proxy pouvait le rejouer sur la porte même qui est
 * censée prouver la possession du téléphone : connexion, élévation dans l'espace admin,
 * ré-authentification d'un geste sensible.
 *
 * Ce que ce fichier verrouille :
 * - le pas de temps employé est **retenu** (`User.totpDernierPas`) et tout pas inférieur ou égal est
 *   refusé — le même code deux fois de suite, non ; le code suivant, oui ;
 * - **un compte qui n'a jamais consommé de code continue de fonctionner** : c'est l'état de tous les
 *   comptes d'avant la colonne, et une correction de sécurité qui enferme dehors les gens qu'elle
 *   protège n'en est pas une ;
 * - « une seule fois » vaut aussi quand **deux requêtes arrivent ensemble** (écriture conditionnelle,
 *   même doctrine que `consommerCodeSecours`) ;
 * - les **trois portes d'authentification** passent par là — un chemin corrigé ne dit rien de ses
 *   voisins, et c'est une leçon déjà écrite dans CLAUDE.md. Le dernier test relit la source des trois
 *   pour qu'aucune ne retombe sur la fonction pure.
 */

type FauxCompte = Record<string, unknown> & { id: string; totpDernierPas?: number | null };

const faux = vi.hoisted(() => ({
  comptes: [] as Record<string, unknown>[],
  sessions: [] as Record<string, unknown>[],
  cookies: {} as Record<string, string>,
  /** Décalage appliqué à l'horloge : c'est ainsi qu'on obtient « le code suivant ». */
  decalage: 0,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) => (nom in faux.cookies ? { name: nom, value: faux.cookies[nom] } : undefined),
    set: (nom: string, valeur: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) delete faux.cookies[nom];
      else faux.cookies[nom] = valeur;
    },
    delete: (nom: string) => {
      delete faux.cookies[nom];
    },
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

vi.mock("@/lib/email/mailer", () => ({ enqueueEmail: vi.fn() }));

const trouverCompte = (where: { id?: string; email?: string }) => faux.comptes.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null;

/** Ce que Prisma lève quand un `where` ne désigne plus aucune ligne (écriture conditionnelle perdue). */
const absente = () => Object.assign(new Error("Record to update not found"), { code: "P2025" });

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => trouverCompte(where)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        const u = trouverCompte(where);
        if (!u) throw absente();
        return u;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string; totpDernierPas?: number | null }; data: Record<string, unknown> }) => {
        const u = trouverCompte(where) as FauxCompte | null;
        if (!u) throw absente();
        // Le `where` de `consommerCodeTotp` porte la valeur **attendue** : si la ligne a changé entre
        // temps, Prisma ne trouve rien et lève. Le faux le rejoue, sans quoi le test de concurrence
        // ne vérifierait que lui-même.
        if ("totpDernierPas" in where && (u.totpDernierPas ?? null) !== (where.totpDernierPas ?? null)) throw absente();
        Object.assign(u, data);
        return u;
      }),
    },
    authSession: {
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const s = faux.sessions.find((x) => x.tokenHash === where.tokenHash);
        return s ? { ...s, user: trouverCompte({ id: s.userId as string }) } : null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const s = { id: `sess-${faux.sessions.length + 1}`, createdAt: new Date(), lastSeenAt: new Date(), elevationVueLe: null, elevationSortieLe: null, ...data };
        faux.sessions.push(s);
        return s;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = faux.sessions.find((x) => x.id === where.id);
        if (!s) throw absente();
        Object.assign(s, data);
        return s;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        faux.sessions = faux.sessions.filter((x) => x.id !== where.id);
        return {};
      }),
      deleteMany: vi.fn(async ({ where }: { where: { tokenHash?: string; userId?: string } }) => {
        const avant = faux.sessions.length;
        faux.sessions = faux.sessions.filter((x) => (where.tokenHash ? x.tokenHash !== where.tokenHash : where.userId ? x.userId !== where.userId : false));
        return { count: avant - faux.sessions.length };
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
  },
}));

const { seConnecter, verifierCode2fa, seConnecterCommeAdmin, reverifierCode2fa } = await import("@/actions/auth");
const { consommerCodeTotp } = await import("@/lib/auth/deux-fa");
const { codeTotp, pasDuCodeTotp, verifierCodeTotp } = await import("@/lib/auth/totp");
const { chiffrer } = await import("@/lib/crypto");
const { utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");

const MOT_DE_PASSE = "grand-escrimeur-2026";
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
/** Un pas de temps dure 30 s : avancer d'autant donne le code suivant, et rien d'autre ne bouge. */
const UN_PAS_MS = 30_000;

let delta: FauxCompte;

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

/** Les server actions signalent leur redirection en levant : on lit la destination. */
async function redirectionDe(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    const m = /^REDIRECTION:(.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("aucune redirection");
}

beforeEach(async () => {
  faux.comptes = [];
  faux.sessions = [];
  faux.cookies = {};
  faux.decalage = 0;
  utiliserMagasinMemoire();
  const reel = Date.now;
  vi.spyOn(Date, "now").mockImplementation(() => reel.call(Date) + faux.decalage);
  const { hashPassword } = await import("@/lib/auth/password");
  delta = {
    id: "u-delta",
    prenom: "Delta",
    nom: "Bretteur",
    email: "delta@club.test",
    // Un instructeur **du bureau** : le rôle de base d'un côté, `estAdmin` de l'autre. Les trois
    // portes éprouvées ici — connexion, élévation, ré-authentification — ne s'ouvrent que par
    // `estAdmin` ; avec `role: "ADMIN"` elles se seraient ouvertes par le repli de compatibilité de
    // `can()`, et une garde restée sur le rôle n'aurait pas été vue.
    role: "INSTRUCTEUR",
    estAdmin: true,
    actif: true,
    service: false,
    theme: "parchemin",
    rappelEmail: true,
    createdAt: new Date(),
    auClubDepuis: null,
    passwordHash: await hashPassword(MOT_DE_PASSE),
    totpSecret: chiffrer(SECRET),
    totpActiveAt: new Date(),
    codesSecours: "[]",
    doitChangerMotDePasse: false,
    deuxFaProposeeLe: null,
    totpDernierPas: null,
  };
  faux.comptes.push(delta);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------- */
/* La borne elle-même                                                */
/* ---------------------------------------------------------------- */

describe("consommer un code TOTP", () => {
  it("accepte un compte qui n'a jamais consommé de code, et retient le pas employé", async () => {
    // L'état de tous les comptes d'avant la colonne : `null`, et la porte s'ouvre.
    expect(delta.totpDernierPas).toBeNull();
    expect(await consommerCodeTotp(delta.id, SECRET, codeTotp(SECRET))).toBe(true);
    expect(delta.totpDernierPas).toBe(pasDuCodeTotp(SECRET, codeTotp(SECRET)));
  });

  it("refuse le même code une seconde fois, et accepte le suivant", async () => {
    const code = codeTotp(SECRET);
    expect(await consommerCodeTotp(delta.id, SECRET, code)).toBe(true);
    // **Le scénario du défaut** : le même code, tout de suite après.
    expect(await consommerCodeTotp(delta.id, SECRET, code)).toBe(false);
    expect(await consommerCodeTotp(delta.id, SECRET, code)).toBe(false);

    // Trente secondes plus tard, l'application en affiche un autre : il passe.
    faux.decalage += UN_PAS_MS;
    const suivant = codeTotp(SECRET);
    expect(suivant).not.toBe(code);
    expect(await consommerCodeTotp(delta.id, SECRET, suivant)).toBe(true);
  });

  it("refuse aussi le code du pas précédent, que la tolérance de dérive laissait passer", async () => {
    // C'est la moitié cachée du défaut : la tolérance d'un pas en arrière rallongeait la vie d'un
    // code jusqu'à 90 s. La borne porte sur le pas, elle ne se laisse pas contourner par la dérive.
    expect(await consommerCodeTotp(delta.id, SECRET, codeTotp(SECRET))).toBe(true);
    const precedent = codeTotp(SECRET, Date.now(), -1);
    expect(verifierCodeTotp(SECRET, precedent)).toBe(true); // la fonction pure, elle, l'accepte encore
    expect(await consommerCodeTotp(delta.id, SECRET, precedent)).toBe(false);
  });

  it("ne retient rien d'un code faux ou mal formé", async () => {
    expect(await consommerCodeTotp(delta.id, SECRET, "000000")).toBe(false);
    expect(await consommerCodeTotp(delta.id, SECRET, "abcdef")).toBe(false);
    expect(delta.totpDernierPas).toBeNull();
    // …et la porte reste ouverte au bon code : un refus ne consomme pas le pas.
    expect(await consommerCodeTotp(delta.id, SECRET, codeTotp(SECRET))).toBe(true);
  });

  it("ne sert qu'une fois même à deux requêtes simultanées", async () => {
    // Deux envois du même code qui se croisent : ils lisent la même borne, un seul l'écrit.
    const code = codeTotp(SECRET);
    const [a, b] = await Promise.all([consommerCodeTotp(delta.id, SECRET, code), consommerCodeTotp(delta.id, SECRET, code)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- */
/* Les trois portes, dans l'ordre où on les franchit                 */
/* ---------------------------------------------------------------- */

describe("connexion, élévation, ré-authentification", () => {
  it("refuse de rejouer le code de la connexion, puis accepte le suivant à chaque porte", async () => {
    // 1. Connexion : mot de passe, puis code de l'application.
    expect(await redirectionDe(seConnecter({}, formulaire({ email: "delta@club.test", motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    const codeConnexion = codeTotp(SECRET);
    expect(await redirectionDe(verifierCode2fa({}, formulaire({ code: codeConnexion })))).toBe("/");
    expect(faux.sessions).toHaveLength(1);

    // 2. L'élévation vers l'espace admin, avec **le code qui vient de servir** : refusée. C'est le
    // rejeu de quelqu'un qui a lu le code par-dessus l'épaule et connaît le mot de passe.
    const rejeu = await seConnecterCommeAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: codeConnexion, suite: "/admin" }));
    expect(rejeu.erreur).toContain("Un code déjà utilisé ne sert pas une seconde fois");
    expect(faux.sessions[0].forte).toBeFalsy();

    // Le code suivant, lui, élève : la borne n'enferme pas le titulaire dehors.
    faux.decalage += UN_PAS_MS;
    const codeElevation = codeTotp(SECRET);
    expect(await redirectionDe(seConnecterCommeAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: codeElevation, suite: "/admin" })))).toBe("/admin");
    expect(faux.sessions[0].forte).toBe(true);

    // 3. Ré-authentification d'un geste sensible : le code de l'élévation ne se rejoue pas non plus.
    const rejeuReauth = await reverifierCode2fa("/admin/membres", {}, formulaire({ code: codeElevation }));
    expect(rejeuReauth.erreurs?.code).toBeDefined();
    faux.decalage += UN_PAS_MS;
    expect(await redirectionDe(reverifierCode2fa("/admin/membres", {}, formulaire({ code: codeTotp(SECRET) })))).toBe("/admin/membres");
  });

  it("n'ouvre pas deux sessions avec le même code de connexion", async () => {
    expect(await redirectionDe(seConnecter({}, formulaire({ email: "delta@club.test", motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    const code = codeTotp(SECRET);
    expect(await redirectionDe(verifierCode2fa({}, formulaire({ code })))).toBe("/");
    expect(faux.sessions).toHaveLength(1);

    // Le voisin recopie le code et refait le parcours depuis son propre navigateur : il a le mot de
    // passe, il a vu le code — et il n'entre pas.
    faux.cookies = {};
    expect(await redirectionDe(seConnecter({}, formulaire({ email: "delta@club.test", motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    const second = await verifierCode2fa({}, formulaire({ code }));
    expect(second.erreurs?.code).toBeDefined();
    expect(faux.sessions).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- */
/* Aucune porte ne retombe sur la fonction pure                      */
/* ---------------------------------------------------------------- */

/**
 * Le balayage qui garde la correction en vie. `verifierCodeTotp` est **pure** : elle ignore le compte,
 * donc les codes déjà consommés. Une porte d'authentification qui l'appellerait à nouveau en direct
 * rouvrirait le rejeu sans que rien ne le signale — c'est exactement ainsi que les défauts de cette
 * famille reviennent (voir CLAUDE.md, « un chemin corrigé ne dit rien de son voisin »).
 */
describe("les lecteurs de code de src/actions/auth.ts", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/actions/auth.ts"), "utf8");
  const corps = new Map<string, string>();
  for (const [, nom, suite] of source.matchAll(/export async function (\w+)\(([\s\S]*?)(?=\nexport async function |\n\/\*\*|$)/g)) corps.set(nom, suite);

  it.each(["verifierCode2fa", "seConnecterCommeAdmin", "reverifierCode2fa"])("%s consomme le code au lieu de le vérifier", (nom) => {
    const body = corps.get(nom);
    expect(body, `fonction ${nom} introuvable : le balayage doit suivre les renommages`).toBeDefined();
    expect(body).toContain("consommerCodeTotp(");
    expect(body).not.toMatch(/[^r]verifierCodeTotp\(/);
  });
});
