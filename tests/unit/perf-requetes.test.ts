import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coût des requêtes des écrans de données.
 *
 * L'application tourne sur SQLite : ce qui la ralentit après quelques saisons, ce n'est pas le
 * moteur, c'est le nombre de lignes qu'on rapatrie pour n'en garder qu'un total, et le nombre
 * d'allers-retours émis. Ces tests figent les deux :
 * - le tableau de bord compte les présences en base (`groupBy`) au lieu de charger une ligne par
 *   membre et par séance (le planning, lui, a besoin des noms : il garde une lecture unique,
 *   mesurée plus rapide que l'agrégat + la liste des présents) ;
 * - les `select` ne ramènent que les colonnes affichées ;
 * - le balayage quotidien des liens ne fait pas une requête par lien (N+1).
 *
 * La base n'est jamais touchée : `@/lib/db` est remplacé par un faux client qui journalise
 * les appels et renvoie des réponses préparées.
 */

type Appel = { modele: string; operation: string; args: Record<string, unknown> };

const { appels, reponses, fauxDb } = vi.hoisted(() => {
  const appels: Array<{ modele: string; operation: string; args: Record<string, unknown> }> = [];
  const reponses = new Map<string, unknown>();
  const parDefaut = (operation: string) => (operation === "findMany" || operation === "groupBy" ? [] : null);
  const fauxDb = new Proxy(
    {},
    {
      get(_cible, modele) {
        if (typeof modele !== "string") return undefined;
        if (modele === "$transaction") return async (ops: unknown[]) => ops;
        return new Proxy(
          {},
          {
            get(_c2, operation) {
              if (typeof operation !== "string") return undefined;
              return async (args: Record<string, unknown> = {}) => {
                appels.push({ modele, operation, args });
                const prete = reponses.get(`${modele}.${operation}`);
                const valeur = typeof prete === "function" ? (prete as (a: unknown) => unknown)(args) : prete;
                return valeur === undefined ? parDefaut(operation) : valeur;
              };
            },
          },
        );
      },
    },
  );
  return { appels, reponses, fauxDb };
});

vi.mock("@/lib/db", () => ({ db: fauxDb }));

const MAINTENANT = new Date("2026-09-22T12:00:00Z");
const PERIODE = "p1";
const MEMBRES = [
  { user: { id: "u1", prenom: "Chloé", nom: "Arnaud" } },
  { user: { id: "u2", prenom: "Charlie", nom: "Bernard" } },
];
const SEANCES = [
  { id: "s1", date: "2026-09-01", heureDebut: "20:00", theme: "Messer", annulee: false },
  { id: "s2", date: "2026-09-08", heureDebut: "20:00", theme: "Dague", annulee: false },
];

/** Clés demandées dans un `select` imbriqué (un niveau : `{ sessions: { select: {...} } }`). */
function colonnes(select: unknown, chemin: string[]): string[] {
  let courant = select as Record<string, { select?: unknown }> | undefined;
  for (const etape of chemin) courant = (courant?.[etape] as { select?: Record<string, never> } | undefined)?.select as typeof courant;
  return Object.keys(courant ?? {}).filter((c) => typeof (courant as Record<string, unknown>)[c] === "boolean");
}

const appelsDe = (modele: string, operation?: string): Appel[] => appels.filter((a) => a.modele === modele && (!operation || a.operation === operation));

beforeEach(() => {
  appels.length = 0;
  reponses.clear();
});

describe("tableau de bord d'une période", () => {
  beforeEach(() => {
    reponses.set("period.findUnique", { id: PERIODE, nom: "Saison", statut: "ACTIVE", membres: MEMBRES, sessions: SEANCES });
    reponses.set("attendance.groupBy", (args: { by: string[] }) =>
      args.by[0] === "sessionId"
        ? [
            { sessionId: "s1", statut: "PRESENT", _count: { _all: 2 } },
            { sessionId: "s2", statut: "ABSENT", _count: { _all: 1 } },
          ]
        : [
            { userId: "u1", statut: "PRESENT", _count: { _all: 2 } },
            { userId: "u2", statut: "ABSENT", _count: { _all: 1 } },
          ],
    );
  });

  it("tient en trois requêtes : la période, puis deux agrégats de présences", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    await statsPeriode(PERIODE, MAINTENANT);
    expect(appels).toHaveLength(3);
    expect(appelsDe("attendance", "groupBy")).toHaveLength(2);
  });

  it("ne charge jamais les lignes de présence une par une", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    await statsPeriode(PERIODE, MAINTENANT);
    expect(appelsDe("attendance", "findMany")).toHaveLength(0);
    // Les présences ne doivent pas non plus revenir en relation imbriquée de la période
    const args = appelsDe("period", "findUnique")[0].args as { select?: Record<string, unknown>; include?: unknown };
    expect(args.include).toBeUndefined();
    expect(JSON.stringify(args.select)).not.toContain("attendances");
  });

  it("ne demande que les colonnes de séance affichées", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    await statsPeriode(PERIODE, MAINTENANT);
    const select = (appelsDe("period", "findUnique")[0].args as { select: unknown }).select;
    expect(colonnes(select, ["sessions"]).sort()).toEqual(["annulee", "date", "heureDebut", "id", "theme"]);
    for (const inutile of ["adresse", "disciplines", "alternative", "lieu", "createdAt", "updatedAt"]) {
      expect(colonnes(select, ["sessions"])).not.toContain(inutile);
    }
  });

  it("donne les mêmes totaux qu'un comptage ligne à ligne", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, MAINTENANT);
    expect(stats?.seances.map((s) => s.compteurs.presents)).toEqual([2, 0]);
    expect(stats?.seances[1].compteurs.absents).toBe(1);
    // 2 invités : une séance à 2 présents fait 100 %, l'autre 0 %
    expect(stats?.seances.map((s) => s.compteurs.pourcentage)).toEqual([100, 0]);
    // Les lignes sortent dans l'ordre alphabétique français de « Prénom Nom » — celui de l'écran,
    // donc celui du CSV : Charlie Bernard (u2) avant Chloé Arnaud (u1).
    expect(stats?.membres.map((m) => [m.id, m.presents, m.absents, m.sansReponse])).toEqual([
      ["u2", 0, 1, 1],
      ["u1", 2, 0, 0],
    ]);
    expect(stats?.moyenne).toBe(50);
  });
});

describe("planning d'une période", () => {
  beforeEach(() => {
    reponses.set("period.findUnique", {
      id: PERIODE,
      nom: "Saison",
      dateDebut: "2026-09-01",
      dateFin: "2026-12-20",
      statut: "ACTIVE",
      membres: MEMBRES,
      sessions: [
        { ...SEANCES[0], heureFin: "22:00", lieu: "Villebourg", motifAnnulation: null, parties: [], attendances: [{ userId: "u2", statut: "PRESENT" }, { userId: "u1", statut: "PRESENT" }] },
        { ...SEANCES[1], heureFin: "22:00", lieu: "Villebourg", motifAnnulation: null, parties: [], attendances: [{ userId: "u1", statut: "ABSENT" }] },
      ],
    });
  });

  it("charge la période en une requête et ne lit que deux colonnes de présence", async () => {
    const { chargerPlanning } = await import("@/lib/planning");
    // Le bureau se porte dans `estAdmin`, plus dans `role` : rôle de base `MEMBRE`, pour que la vue
    // d'équipe de la grille ne tienne qu'au supplément.
    const planning = await chargerPlanning(PERIODE, { id: "u1", role: "MEMBRE", estAdmin: true }, MAINTENANT);
    expect(appelsDe("period", "findUnique")).toHaveLength(1);
    const select = (appelsDe("period", "findUnique")[0].args as { select: Record<string, { select?: Record<string, unknown> }> }).select;
    const presences = select.sessions.select?.attendances as { select: Record<string, boolean> };
    expect(Object.keys(presences.select).sort()).toEqual(["statut", "userId"]);
    expect(planning?.colonnes[0].compteurs.presents).toBe(2);
    expect(planning?.colonnes[0].presents).toEqual(["Charlie Bernard", "Chloé Arnaud"]);
    expect(planning?.colonnes[1].presents).toEqual([]);
  });

  it("ne demande que les colonnes de séance affichées par la grille", async () => {
    const { chargerPlanning } = await import("@/lib/planning");
    await chargerPlanning(PERIODE, { id: "u1", role: "MEMBRE", estAdmin: true }, MAINTENANT);
    const args = appelsDe("period", "findUnique")[0].args as { select: unknown; include?: unknown };
    expect(args.include).toBeUndefined();
    for (const inutile of ["adresse", "disciplines", "alternative", "theme", "createdAt", "updatedAt"]) {
      expect(colonnes(args.select, ["sessions"])).not.toContain(inutile);
    }
    // Les cases du planning ne ramènent pas non plus leurs clés étrangères inutilisées
    const parties = (args.select as Record<string, { select: Record<string, { select: Record<string, unknown> }> }>).sessions.select.parties.select;
    expect(Object.keys(parties).sort()).toEqual([
      "atelier",
      "description",
      "estOption",
      "id",
      "instructeur",
      "instructeurId",
      "instructeurSecond",
      "instructeurSecondId",
      "libelle",
      "modifiePar",
      "niveau",
      "ordre",
      "theme",
      "updatedAt",
    ]);
  });
});

describe("requêtes de service", () => {
  it("un réglage ne rapatrie que sa valeur", async () => {
    reponses.set("setting.findUnique", { value: "18:00" });
    const { getSetting } = await import("@/lib/settings");
    expect(await getSetting("recapHour")).toBe("18:00");
    const args = appelsDe("setting", "findUnique")[0].args as { select: Record<string, boolean> };
    expect(Object.keys(args.select)).toEqual(["value"]);
  });

  it("l'email d'invitation ne charge ni mot de passe ni secret 2FA", async () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/invitations.ts"), "utf8");
    const bloc = /const \[user, period\] = await Promise\.all\(\[[\s\S]*?\]\);/.exec(source)?.[0] ?? "";
    expect(bloc).toContain("select: { id: true, prenom: true, email: true }");
    expect(bloc).toContain("select: { nom: true }");
  });

  it("le balayage des liens à renouveler ne fait pas une requête par lien", async () => {
    const aRenouveler = [
      { id: "i1", userId: "u1", periodId: PERIODE, expiresAt: new Date("2026-09-24") },
      { id: "i2", userId: "u2", periodId: PERIODE, expiresAt: new Date("2026-09-25") },
      { id: "i3", userId: "u3", periodId: PERIODE, expiresAt: new Date("2026-09-26") },
    ];
    let appel = 0;
    reponses.set("invitation.findMany", () => (appel++ === 0 ? aRenouveler : aRenouveler.map(({ userId, periodId }) => ({ userId, periodId }))));
    const { renouvelerLiensExpirants } = await import("@/lib/invitations");
    // Tous ces membres ont déjà un lien plus récent : rien à renvoyer, donc aucun email déclenché
    expect(await renouvelerLiensExpirants(MAINTENANT)).toBe(0);
    expect(appelsDe("invitation", "findMany")).toHaveLength(2);
    expect(appelsDe("invitation", "findFirst")).toHaveLength(0);
  });
});

describe("index de la base", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");

  it("le journal d'audit est indexé par action et par date (surveillance ciblée)", () => {
    expect(schema).toMatch(/@@index\(\[action, date\]\)/);
  });

  it("les sessions de connexion sont indexées par date d'expiration (liste et purge)", () => {
    const bloc = /model AuthSession \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? "";
    expect(bloc).toMatch(/@@index\(\[expiresAt\]\)/);
  });

  it("la migration d'index reste additive : que des CREATE INDEX", () => {
    const racine = path.join(process.cwd(), "prisma/migrations");
    const dossier = readdirSync(racine).find((d) => d.endsWith("_index_performances"));
    expect(dossier).toBeDefined();
    const sql = readFileSync(path.join(racine, dossier!, "migration.sql"), "utf8");
    const instructions = sql
      .split(";")
      .map((i) => i.replace(/--[^\n]*/g, "").trim())
      .filter(Boolean);
    expect(instructions.length).toBeGreaterThan(0);
    for (const i of instructions) expect(i).toMatch(/^CREATE INDEX/i);
  });
});
