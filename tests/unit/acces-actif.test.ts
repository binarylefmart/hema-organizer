import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * **« Accès actif »** (src/lib/acces-actif.ts) : la condition pour recevoir une notification
 * personnelle.
 *
 * La règle existe sous deux formes — la fonction pure `aUnAccesActif` et le fragment Prisma
 * `accesActifWhere` — et ce fichier vérifie trois choses :
 *
 * 1. la fonction pure, cas par cas ;
 * 2. le fragment, **contre une vraie base SQLite** bâtie depuis `prisma/schema.prisma` : c'est lui qui
 *    trie les destinataires en production, et un `where` Prisma ne se vérifie pas en le relisant ;
 * 3. que les deux rendent **le même verdict** sur chaque compte du jeu d'essai.
 */

const tenu = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return tenu.client;
  },
}));

const { accesActifWhere, aUnAccesActif, filtrerAccesActif, idsAvecAccesActif, lienVivant } = await import("@/lib/acces-actif");
type CompteAcces = import("@/lib/acces-actif").CompteAcces;

const RACINE = path.resolve(__dirname, "../..");
const NOW = new Date("2026-10-04T12:00:00Z");
const PASSE = new Date("2026-10-01T12:00:00Z");
const FUTUR = new Date("2027-01-31T12:00:00Z");

const base: CompteAcces = { actif: true, service: false, passwordHash: null, invitations: [], authSessions: [] };

/**
 * Le jeu d'essai, un compte par situation. `attendu` est la réponse de la règle (sans option), et
 * `attenduAvecService` celle qui garde les comptes de service — elle ne diffère que pour eux.
 */
const CAS: Array<{ id: string; compte: CompteAcces; attendu: boolean; attenduAvecService?: boolean }> = [
  { id: "jamais-invite", compte: base, attendu: false },
  { id: "lien-vivant", compte: { ...base, invitations: [{ revokedAt: null, expiresAt: FUTUR }] }, attendu: true },
  { id: "lien-revoque", compte: { ...base, invitations: [{ revokedAt: PASSE, expiresAt: FUTUR }] }, attendu: false },
  { id: "lien-expire", compte: { ...base, invitations: [{ revokedAt: null, expiresAt: PASSE }] }, attendu: false },
  {
    id: "un-mort-un-vivant",
    compte: { ...base, invitations: [{ revokedAt: PASSE, expiresAt: FUTUR }, { revokedAt: null, expiresAt: FUTUR }] },
    attendu: true,
  },
  { id: "mot-de-passe", compte: { ...base, passwordHash: "$argon2id$faux" }, attendu: true },
  { id: "session-ouverte", compte: { ...base, authSessions: [{ expiresAt: FUTUR }] }, attendu: true },
  { id: "session-expiree", compte: { ...base, authSessions: [{ expiresAt: PASSE }] }, attendu: false },
  { id: "desactive-avec-mdp", compte: { ...base, actif: false, passwordHash: "$argon2id$faux" }, attendu: false },
  { id: "desactive-avec-lien", compte: { ...base, actif: false, invitations: [{ revokedAt: null, expiresAt: FUTUR }] }, attendu: false },
  { id: "service-avec-mdp", compte: { ...base, service: true, passwordHash: "$argon2id$faux" }, attendu: false, attenduAvecService: true },
  { id: "service-sans-acces", compte: { ...base, service: true }, attendu: false, attenduAvecService: false },
];

describe("la règle, en fonction pure", () => {
  it("un lien vivant n'est ni révoqué ni expiré", () => {
    expect(lienVivant({ revokedAt: null, expiresAt: FUTUR }, NOW)).toBe(true);
    expect(lienVivant({ revokedAt: PASSE, expiresAt: FUTUR }, NOW)).toBe(false);
    expect(lienVivant({ revokedAt: null, expiresAt: PASSE }, NOW)).toBe(false);
    // L'échéance pile maintenant : le lien ne sert plus (`gt`, comme la requête).
    expect(lienVivant({ revokedAt: null, expiresAt: NOW }, NOW)).toBe(false);
  });

  for (const c of CAS) {
    it(`${c.id} → ${c.attendu ? "accès actif" : "aucun accès"}`, () => {
      expect(aUnAccesActif(c.compte, NOW)).toBe(c.attendu);
      expect(aUnAccesActif(c.compte, NOW, { compteDeService: true })).toBe(c.attenduAvecService ?? c.attendu);
    });
  }
});

describe("le fragment Prisma, contre une vraie base", () => {
  let dossier = "";
  let db: PrismaClient;

  beforeAll(async () => {
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), "hema-acces-actif-"));
    db = new PrismaClient({ datasources: { db: { url: `file:${path.join(dossier, "t.db")}?connection_limit=1` } } });
    tenu.client = db;
    // Le schéma tel que Prisma le crée : pas de recopie à la main qui pourrait dériver.
    const sql = execFileSync(path.join(RACINE, "node_modules/.bin/prisma"), ["migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], {
      cwd: RACINE,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const instructions = sql
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const i of instructions) await db.$executeRawUnsafe(i);

    await db.period.create({ data: { id: "p1", nom: "T4", dateDebut: "2026-10-01", dateFin: "2027-01-31", statut: "ACTIVE" } });
    let n = 0;
    for (const c of CAS) {
      await db.user.create({
        data: {
          id: c.id,
          prenom: c.id,
          nom: "Essai",
          actif: c.compte.actif,
          service: c.compte.service,
          passwordHash: c.compte.passwordHash,
          invitations: { create: c.compte.invitations.map((i) => ({ periodId: "p1", tokenHash: `jeton-${n++}`, revokedAt: i.revokedAt, expiresAt: i.expiresAt })) },
          authSessions: { create: c.compte.authSessions.map((s) => ({ tokenHash: `session-${n++}`, expiresAt: s.expiresAt })) },
        },
      });
    }
  }, 60_000);

  afterAll(async () => {
    await db?.$disconnect();
    if (dossier) fs.rmSync(dossier, { recursive: true, force: true });
  });

  it("rend exactement les comptes que la fonction pure accepte", async () => {
    const enBase = (await db.user.findMany({ where: accesActifWhere(NOW), select: { id: true } })).map((u) => u.id).sort();
    const attendus = CAS.filter((c) => aUnAccesActif(c.compte, NOW))
      .map((c) => c.id)
      .sort();
    expect(enBase).toEqual(attendus);
    expect(enBase).toEqual(["lien-vivant", "mot-de-passe", "session-ouverte", "un-mort-un-vivant"]);
  });

  it("garde le compte de service qui a un accès, et lui seul, quand on le demande", async () => {
    const enBase = (await db.user.findMany({ where: accesActifWhere(NOW, { compteDeService: true }), select: { id: true } })).map((u) => u.id).sort();
    const attendus = CAS.filter((c) => aUnAccesActif(c.compte, NOW, { compteDeService: true }))
      .map((c) => c.id)
      .sort();
    expect(enBase).toEqual(attendus);
    expect(enBase).toContain("service-avec-mdp");
    expect(enBase).not.toContain("service-sans-acces");
  });

  it("suit l'horloge : le même lien ne compte plus une fois son échéance passée", async () => {
    const apres = new Date(FUTUR.getTime() + 1000);
    const enBase = (await db.user.findMany({ where: accesActifWhere(apres), select: { id: true } })).map((u) => u.id);
    expect(enBase).toEqual(["mot-de-passe"]);
  });

  it("filtrerAccesActif garde l'ordre reçu et ne retient que les comptes demandés", async () => {
    const personnes = [{ id: "session-ouverte" }, { id: "jamais-invite" }, { id: "lien-vivant" }, { id: "inconnu" }];
    expect((await filtrerAccesActif(personnes, NOW)).map((p) => p.id)).toEqual(["session-ouverte", "lien-vivant"]);
    // `mot-de-passe` a un accès, mais n'était pas demandé : il ne revient pas.
    expect([...(await idsAvecAccesActif(["lien-revoque", "lien-vivant"], NOW))]).toEqual(["lien-vivant"]);
    expect(await filtrerAccesActif([], NOW)).toEqual([]);
  });

  it("se combine à un autre filtre qui porte son propre OR, sans l'écraser", async () => {
    const enBase = await db.user.findMany({
      where: { AND: [{ OR: [{ id: "mot-de-passe" }, { id: "jamais-invite" }] }, accesActifWhere(NOW)] },
      select: { id: true },
    });
    expect(enBase.map((u) => u.id)).toEqual(["mot-de-passe"]);
  });
});

/**
 * **Aucun envoi personnel n'échappe au tri.** Tout module de `src/lib/notifications/` qui écrit à
 * quelqu'un (`enqueueEmail(`) ou réveille un téléphone (`notifierParPush(`) doit passer par
 * l'accès actif — `filtrerAccesActif`, ou le drapeau `accesActif` des invités d'une séance. Un envoi
 * ajouté demain sans y penser fait échouer ce balayage.
 *
 * Exceptions, avec leur raison : `journal.ts` définit `notifierParPush` sans choisir personne, et
 * `securite.ts` porte les alertes de sécurité, qui ne se filtrent pas — ce sont elles qui protègent
 * l'accès.
 */
describe("balayage des modules d'envoi", () => {
  const EXCEPTIONS: Record<string, string> = {
    "journal.ts": "définit le transport, ne choisit aucun destinataire",
    "securite.ts": "alertes de sécurité : jamais filtrées",
  };
  const dossier = path.join(RACINE, "src/lib/notifications");
  const modules = fs.readdirSync(dossier).filter((f) => f.endsWith(".ts"));

  it("trouve bien des modules qui envoient (le balayage n'est pas vide)", () => {
    const envoient = modules.filter((f) => /\b(enqueueEmail|notifierParPush)\(/.test(fs.readFileSync(path.join(dossier, f), "utf8")));
    expect(envoient.length).toBeGreaterThanOrEqual(7);
  });

  for (const f of modules) {
    const source = fs.readFileSync(path.join(dossier, f), "utf8");
    if (!/\b(enqueueEmail|notifierParPush)\(/.test(source)) continue;
    it(`${f} trie ses destinataires sur l'accès actif${EXCEPTIONS[f] ? ` (exception : ${EXCEPTIONS[f]})` : ""}`, () => {
      if (EXCEPTIONS[f]) return;
      expect(/filtrerAccesActif|\.accesActif\b/.test(source)).toBe(true);
    });
  }
});
