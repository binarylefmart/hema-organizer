import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estNatureElement, type NatureElement } from "@/lib/constants";
import { rangementsParties } from "@/components/planning/rangement";

/**
 * **La migration « Parties et éléments », rejouée pour de vrai.**
 *
 * Même méthode que `migration-rangs-parties.test.ts` : le vrai fichier `migration.sql`, sur une base
 * SQLite jetable, par le client Prisma — le moteur qui l'appliquera en production. La table de départ
 * est celle que laissait `20260930120000` (avec `estOption`, `description` ajoutée en fin de table
 * par `ALTER TABLE`). `Session` garde `date` et `annulee` : la reprise ne les lit plus, et le test
 * vérifie justement que ni l'une ni l'autre ne change rien (aucun ajout nulle part).
 *
 * Ce qu'il verrouille (reprise revue par Delta le 06/10 au soir : « par défaut 1 seule partie par
 * séance, qui n'est pas notifiée partie 1, uniquement à partir de 2 ») :
 * 1. **tout va dans la partie 1** : les cours restent des COURS, les options des OPTION, une option
 *    qui porte un atelier devient un élément ATELIER ;
 * 2. **aucune ligne ajoutée** — ni partie, ni cours vide, quelle que soit la séance (à venir, passée,
 *    annulée, vide) ;
 * 3. **les libellés d'avant se relisent tels quels** (« Cours 1 », « Cours 2 », « Option 1 ») : pas
 *    de préfixe « Partie 1 · » sur une séance d'une seule partie — seul un nom unique perd son
 *    numéro (« Cours 1 » seul → « Cours »), et l'option-atelier devient « Atelier » ;
 * 4. **ordre et libellé = `rangementsParties`** : la règle du code ne trouve rien à corriger, sur
 *    aucune séance — le SQL et le code ne peuvent pas diverger sans que ce test tombe ;
 * 5. **`updatedAt` intact** sur toute ligne ;
 * 6. **`estOption` a disparu**, les index sont là.
 */

const RACINE = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(RACINE, "prisma/migrations");
const PARTIES_ET_ELEMENTS = "20261006100000_parties_et_elements";
const POSE_LE = 1_790_000_000_000; // millisecondes, comme Prisma écrit un DateTime en SQLite
const FUTUR = "2999-01-01";
const PASSE = "2000-01-01";

const AVANT = [
  `CREATE TABLE "Session" ("id" TEXT NOT NULL PRIMARY KEY, "date" TEXT NOT NULL, "annulee" BOOLEAN NOT NULL DEFAULT false)`,
  `CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY)`,
  `CREATE TABLE "Atelier" ("id" TEXT NOT NULL PRIMARY KEY)`,
  `CREATE TABLE "SessionPartie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "estOption" BOOLEAN NOT NULL DEFAULT false,
    "instructeurId" TEXT,
    "instructeurSecondId" TEXT,
    "theme" TEXT NOT NULL DEFAULT '',
    "niveau" TEXT NOT NULL DEFAULT 'INDIFFERENT',
    "atelierId" TEXT,
    "modifieParId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "SessionPartie_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_atelierId_fkey" FOREIGN KEY ("atelierId") REFERENCES "Atelier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX "SessionPartie_atelierId_key" ON "SessionPartie"("atelierId")`,
  `CREATE INDEX "SessionPartie_sessionId_ordre_idx" ON "SessionPartie"("sessionId", "ordre")`,
];

/** Une ligne d'avant : `c` = cours, `o` = option, `a` = option qui porte un atelier. */
type Avant = "c" | "o" | "a";

/**
 * Les séances fabriquées. L'ordre de la liste est l'ordre d'avant (`ordre` = index), sauf pour
 * `s-ex-aequo`, dont les lignes ont toutes le rang 0 : l'identifiant doit trancher.
 */
const SEANCES: Array<{ id: string; date: string; annulee?: boolean; lignes: Avant[]; exAequo?: boolean }> = [
  { id: "s-2c2o", date: FUTUR, lignes: ["c", "o", "c", "a"] },
  { id: "s-1c3o", date: FUTUR, lignes: ["o", "c", "o", "o"] },
  { id: "s-0c2o", date: FUTUR, lignes: ["o", "a"] },
  { id: "s-4c", date: FUTUR, lignes: ["c", "c", "c", "c"] },
  { id: "s-passee", date: PASSE, lignes: ["c", "c", "o"] },
  { id: "s-annulee", date: FUTUR, annulee: true, lignes: ["c", "c"] },
  { id: "s-vide-futur", date: FUTUR, lignes: [] },
  { id: "s-vide-passee", date: PASSE, lignes: [] },
  { id: "s-ex-aequo", date: FUTUR, lignes: ["o", "c", "c"], exAequo: true },
  { id: "s-passee-1c", date: PASSE, lignes: ["c", "o", "o"] },
  { id: "s-annulee-1c", date: FUTUR, annulee: true, lignes: ["a", "c"] },
];

function instructions(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

let db: PrismaClient;
let dossier: string;

beforeAll(async () => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "hema-migration-elements-"));
  db = new PrismaClient({ datasources: { db: { url: `file:${path.join(dossier, "t.db")}?connection_limit=1` } } });
  for (const sql of AVANT) await db.$executeRawUnsafe(sql);
  for (const s of SEANCES) {
    await db.$executeRawUnsafe(`INSERT INTO "Session" ("id", "date", "annulee") VALUES (?, ?, ?)`, s.id, s.date, s.annulee ? 1 : 0);
    // Les libellés d'avant, à l'ancienne règle (`libellePartie` : « Cours N » / « Option N », toujours
    // numérotés). Les lignes ex aequo sont posées à l'envers : ni l'ordre d'insertion ni le `rowid` ne
    // doivent pouvoir passer pour le départage par identifiant.
    const rangs = { c: 0, o: 0 };
    const posees = s.lignes.map((l, i) => {
      const cle = l === "c" ? "c" : "o";
      rangs[cle] += 1;
      return { l, i, libelle: `${cle === "c" ? "Cours" : "Option"} ${rangs[cle]}` };
    });
    for (const { l, i, libelle } of s.exAequo ? posees.reverse() : posees) {
      const atelierId = l === "a" ? `at-${s.id}-${i}` : null;
      if (atelierId) await db.$executeRawUnsafe(`INSERT INTO "Atelier" ("id") VALUES (?)`, atelierId);
      await db.$executeRawUnsafe(
        `INSERT INTO "SessionPartie" ("id", "sessionId", "libelle", "ordre", "estOption", "atelierId", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `${s.id}-l${i}`,
        s.id,
        libelle,
        s.exAequo ? 0 : i,
        l === "c" ? 0 : 1,
        atelierId,
        POSE_LE,
      );
    }
  }
  const sql = fs.readFileSync(path.join(MIGRATIONS, PARTIES_ET_ELEMENTS, "migration.sql"), "utf8");
  for (const i of instructions(sql)) await db.$executeRawUnsafe(i);
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dossier) fs.rmSync(dossier, { recursive: true, force: true });
});

type Ligne = { id: string; sessionId: string; libelle: string; ordre: number; bloc: number; nature: NatureElement; atelierId: string | null; updatedAt: number };

async function lignesDe(sessionId?: string): Promise<Ligne[]> {
  const lignes = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT "id", "sessionId", "libelle", "ordre", "bloc", "nature", "atelierId", CAST("updatedAt" AS INTEGER) AS "updatedAt" FROM "SessionPartie" ORDER BY "sessionId", "ordre", "id"`,
  );
  return lignes
    .map((l) => ({ ...l, ordre: Number(l.ordre), bloc: Number(l.bloc), updatedAt: Number(l.updatedAt) }) as Ligne)
    .filter((l) => sessionId === undefined || l.sessionId === sessionId);
}

/** « 1:COURS:Cours 1 » — la séance se lit en une ligne par élément. */
async function lecture(sessionId: string): Promise<string[]> {
  return (await lignesDe(sessionId)).map((l) => `${l.bloc}:${l.nature}:${l.libelle}`);
}

describe("migration « Parties et éléments »", () => {
  it("met tout en partie 1 : cours en COURS, options en OPTION, l'option-atelier en élément ATELIER", async () => {
    expect(await lecture("s-2c2o")).toEqual(["1:COURS:Cours 1", "1:COURS:Cours 2", "1:OPTION:Option", "1:ATELIER:Atelier"]);
    const atelier = (await lignesDe("s-2c2o")).find((l) => l.nature === "ATELIER");
    expect(atelier?.atelierId).toBe("at-s-2c2o-3");
    expect((await lignesDe()).every((l) => l.bloc === 1)).toBe(true);
  });

  it("garde les libellés d'avant — « Cours 1, Cours 2, Option 1… » — sans préfixe « Partie 1 · »", async () => {
    expect(await lecture("s-1c3o")).toEqual(["1:COURS:Cours", "1:OPTION:Option 1", "1:OPTION:Option 2", "1:OPTION:Option 3"]);
    expect(await lecture("s-4c")).toEqual(["1:COURS:Cours 1", "1:COURS:Cours 2", "1:COURS:Cours 3", "1:COURS:Cours 4"]);
    expect(await lecture("s-passee")).toEqual(["1:COURS:Cours 1", "1:COURS:Cours 2", "1:OPTION:Option"]);
    expect(await lecture("s-passee-1c")).toEqual(["1:COURS:Cours", "1:OPTION:Option 1", "1:OPTION:Option 2"]);
    expect((await lignesDe()).filter((l) => l.libelle.startsWith("Partie"))).toEqual([]);
  });

  it("range une séance sans cours telle quelle : ses options, son atelier", async () => {
    expect(await lecture("s-0c2o")).toEqual(["1:OPTION:Option", "1:ATELIER:Atelier"]);
    expect(await lecture("s-annulee-1c")).toEqual(["1:COURS:Cours", "1:ATELIER:Atelier"]);
  });

  it("n'ajoute aucune ligne, à aucune séance — à venir, passée, annulée ou vide", async () => {
    for (const s of SEANCES) expect((await lignesDe(s.id)).length, s.id).toBe(s.lignes.length);
    expect(await lecture("s-vide-futur")).toEqual([]);
    expect(await lecture("s-vide-passee")).toEqual([]);
    expect(await lecture("s-annulee")).toEqual(["1:COURS:Cours 1", "1:COURS:Cours 2"]);
  });

  it("départage les rangs égaux par l'identifiant", async () => {
    expect((await lignesDe("s-ex-aequo")).map((l) => `${l.id}:${l.libelle}`)).toEqual([
      "s-ex-aequo-l1:Cours 1",
      "s-ex-aequo-l2:Cours 2",
      "s-ex-aequo-l0:Option",
    ]);
  });

  it("laisse chaque séance exactement comme `rangementsParties` la rangerait — rien à corriger", async () => {
    const toutes = await lignesDe();
    const par = new Map<string, Ligne[]>();
    for (const l of toutes) par.set(l.sessionId, [...(par.get(l.sessionId) ?? []), l]);
    for (const [sessionId, lignes] of par) {
      expect(lignes.every((l) => estNatureElement(l.nature)), sessionId).toBe(true);
      const aCorriger = rangementsParties(lignes.map((l) => ({ ...l, updatedAt: new Date(l.updatedAt) })));
      expect(aCorriger, sessionId).toEqual([]);
    }
  });

  it("n'a déplacé aucun `updatedAt`", async () => {
    expect((await lignesDe()).filter((l) => l.updatedAt !== POSE_LE)).toEqual([]);
  });

  it("retire `estOption` et garde les index de la table", async () => {
    const colonnes = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("SessionPartie")`);
    expect(colonnes.map((c) => c.name)).not.toContain("estOption");
    expect(colonnes.map((c) => c.name)).toEqual(expect.arrayContaining(["bloc", "nature", "description"]));
    const index = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA index_list("SessionPartie")`);
    expect(index.map((i) => i.name)).toEqual(expect.arrayContaining(["SessionPartie_atelierId_key", "SessionPartie_sessionId_ordre_idx"]));
  });
});
