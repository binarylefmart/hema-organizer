import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Agir sur plusieurs séances à la fois** (`appliquerGesteSeancesEnMasse`) : les verrous du geste
 * unitaire, tout ou rien, une entrée de journal par séance sous la même action, et les annonces
 * d'annulation — une par séance annulée, aucune ailleurs.
 */

type Seance = {
  id: string;
  periodId: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  adresse: string;
  annulee: boolean;
  motifAnnulation: string | null;
  statut: string;
};

const faux = vi.hoisted(() => ({
  acteur: { id: "u-charlie", email: "charlie@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true, sessionForte: false } as Record<string, unknown>,
  seances: [] as Seance[],
  reponses: {} as Record<string, number>,
  prevenus: [] as string[],
  reauths: [] as string[],
  ecritures: [] as Array<{ table: string; op: string; where: unknown; data?: unknown }>,
  transactions: 0,
  audits: [] as Array<{ action: string; cible: string | null; details: unknown }>,
}));

// L'annulation rend les ateliers à la file (`libererAteliersDesSeances`) : doublure, ce test ne porte pas
// sur les ateliers ; les appels sont relevés pour vérifier que chaque annulation les libère.
const liberation = vi.hoisted(() => ({ appels: [] as string[][] }));
vi.mock("@/lib/planning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/planning")>()),
  libererAteliersDesSeances: vi.fn(async (ids: readonly string[]) => {
    liberation.appels.push([...ids]);
    return [];
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    session: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = faux.seances.find((x) => x.id === where.id);
        return s ? { ...s, period: { statut: s.statut } } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        faux.ecritures.push({ table: "session", op: "update", where, data });
        return {};
      }),
      updateMany: vi.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        faux.ecritures.push({ table: "session", op: "updateMany", where, data });
        return { count: 0 };
      }),
      deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
        faux.ecritures.push({ table: "session", op: "deleteMany", where });
        return { count: 0 };
      }),
      delete: vi.fn(async ({ where }: { where: unknown }) => {
        faux.ecritures.push({ table: "session", op: "delete", where });
        return {};
      }),
    },
    atelier: {
      updateMany: vi.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        faux.ecritures.push({ table: "atelier", op: "updateMany", where, data });
        return { count: 0 };
      }),
    },
    attendance: { count: vi.fn(async ({ where }: { where: { sessionId: string } }) => faux.reponses[where.sessionId] ?? 0) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => {
      faux.transactions++;
      return Promise.all(operations);
    }),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/notifications/seances", () => ({
  notifierAnnulation: vi.fn(async (sessionId: string) => {
    faux.prevenus.push(sessionId);
    return 4;
  }),
  phraseAnnulation: vi.fn(async (n: number) => `${n} membres prévenus`),
  porteurJetonAnnulation: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/current-user", async () => {
  const { can } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof can>[1]) => {
      if (!can(faux.acteur as Parameters<typeof can>[0], permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async (_u: unknown, suite: string) => {
      faux.reauths.push(suite);
    }),
    requireUser: vi.fn(async () => faux.acteur),
    getCurrentUser: vi.fn(async () => faux.acteur),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { annulerSeance, appliquerGesteSeancesEnMasse, retablirSeance } = await import("@/actions/seances");

const seance = (id: string, x: Partial<Seance> = {}): Seance => ({
  id,
  periodId: "p1",
  date: "2099-10-06",
  heureDebut: "19:30",
  heureFin: "21:30",
  lieu: "Salle du Sud",
  adresse: "",
  annulee: false,
  motifAnnulation: null,
  statut: "ACTIVE",
  ...x,
});

const INSTRUCTEUR = { id: "u-charlie", email: "charlie@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true, sessionForte: false };
const BUREAU = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true, sessionForte: true };

beforeEach(() => {
  faux.acteur = { ...INSTRUCTEUR };
  faux.seances = [seance("s1"), seance("s2", { date: "2099-10-13" }), seance("s3", { date: "2099-10-20", annulee: true, motifAnnulation: "Pluie" })];
  faux.reponses = {};
  faux.prevenus = [];
  faux.reauths = [];
  faux.ecritures = [];
  faux.transactions = 0;
  faux.audits = [];
});

describe("annuler plusieurs séances", () => {
  it("une transaction, une entrée de journal et une annonce par séance — sous l'action du geste unitaire", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "annuler", sessionIds: ["s2", "s1"], motif: "Salle inondée" });
    expect(res.erreur).toBeUndefined();
    expect(res.succes).toContain("2 séances annulées");
    expect(res.succes).toContain("2 annonces d'annulation");
    expect(faux.transactions).toBe(1);
    expect(faux.ecritures).toEqual([{ table: "session", op: "updateMany", where: { id: { in: ["s1", "s2"] } }, data: { annulee: true, motifAnnulation: "Salle inondée" } }]);
    // L'ordre est celui du calendrier, pas celui des clics.
    expect(faux.audits).toEqual([
      { action: "seance.annulee", cible: "s1", details: { motif: "Salle inondée", enMasse: true } },
      { action: "seance.annulee", cible: "s2", details: { motif: "Salle inondée", enMasse: true } },
    ]);
    expect(faux.prevenus).toEqual(["s1", "s2"]);
    // Les ateliers planifiés sur ces séances repassent en attente, comme pour une suppression.
    expect(liberation.appels.at(-1)).toEqual(["s1", "s2"]);
  });

  it("une séance déjà annulée n'est ni réécrite, ni réannoncée", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "annuler", sessionIds: ["s1", "s3"], motif: "Salle inondée" });
    expect(res.succes).toContain("1 séance annulée");
    expect(res.succes).toContain("déjà annulée");
    expect(faux.prevenus).toEqual(["s1"]);
    expect(faux.audits.map((a) => a.cible)).toEqual(["s1"]);
  });

  it("un cours commencé refuse le lot entier : rien n'est écrit, rien ne part", async () => {
    faux.seances.push(seance("s4", { date: "2020-01-07" }));
    const res = await appliquerGesteSeancesEnMasse({ geste: "annuler", sessionIds: ["s1", "s4"], motif: "Salle inondée" });
    expect(res.erreur).toMatch(/lot entier est refusé/);
    expect(res.erreur).toMatch(/déjà commencé/);
    expect(faux.ecritures).toEqual([]);
    expect(faux.prevenus).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("le motif est exigé, comme à l'unité", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "annuler", sessionIds: ["s1"], motif: "  " });
    expect(res.erreur).toBeDefined();
    expect(faux.ecritures).toEqual([]);
  });
});

describe("les verrous de la séance seule, séance par séance", () => {
  it("une séance d'un trimestre clos refuse le lot entier, avec le refus de la séance seule", async () => {
    faux.seances[1].statut = "CLOSE";
    const res = await appliquerGesteSeancesEnMasse({ geste: "lieu", sessionIds: ["s1", "s2"], lieu: "Gymnase du Nord", adresse: "" });
    expect(res.erreur).toMatch(/clos/i);
    expect(faux.ecritures).toEqual([]);
  });

  it("une séance disparue depuis l'affichage refuse le lot", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "retablir", sessionIds: ["s3", "fantome"] });
    expect(res.erreur).toMatch(/introuvable/);
    expect(faux.ecritures).toEqual([]);
  });

  it("un membre n'a pas `sessions.manage` : refusé avant toute lecture", async () => {
    faux.acteur = { ...INSTRUCTEUR, role: "MEMBRE" };
    await expect(appliquerGesteSeancesEnMasse({ geste: "retablir", sessionIds: ["s3"] })).rejects.toThrow("Accès refusé");
    expect(faux.ecritures).toEqual([]);
  });

  it("le plafond de lot est celui de tous les gestes de masse", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `s${i}`);
    const res = await appliquerGesteSeancesEnMasse({ geste: "retablir", sessionIds: ids });
    expect(res.erreur).toMatch(/Sélection invalide/);
  });
});

describe("rétablir, déplacer, changer l'horaire : aucune annonce", () => {
  it("rétablir rouvre aussi le lien d'annulation, et ne prévient personne", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "retablir", sessionIds: ["s3", "s1"] });
    expect(res.succes).toContain("1 séance rétablie");
    expect(faux.ecritures[0].data).toEqual({ annulee: false, motifAnnulation: null, annulationLienUtiliseLe: null });
    expect(faux.audits).toEqual([{ action: "seance.retablie", cible: "s3", details: { enMasse: true } }]);
    expect(faux.prevenus).toEqual([]);
  });

  it("le lieu : seules les séances qui changent sont écrites, sous `seance.modifiee`", async () => {
    faux.seances[1].lieu = "Gymnase du Nord";
    const res = await appliquerGesteSeancesEnMasse({ geste: "lieu", sessionIds: ["s1", "s2"], lieu: "Gymnase du Nord", adresse: "" });
    expect(res.succes).toContain("1 séance déplacée");
    expect(faux.ecritures).toEqual([{ table: "session", op: "updateMany", where: { id: { in: ["s1"] } }, data: { lieu: "Gymnase du Nord", adresse: "" } }]);
    expect(faux.audits).toEqual([{ action: "seance.modifiee", cible: "s1", details: { lieu: "Gymnase du Nord", adresse: "", enMasse: true } }]);
    expect(faux.prevenus).toEqual([]);
  });

  it("l'horaire à l'envers est refusé et dit pourquoi", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "horaire", sessionIds: ["s1"], heureDebut: "21:00", heureFin: "20:00" });
    expect(res.erreur).toMatch(/fin doit suivre/);
    expect(faux.ecritures).toEqual([]);
  });

  it("l'horaire : écrit et journalisé par séance", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "horaire", sessionIds: ["s1", "s2"], heureDebut: "20:00", heureFin: "22:00" });
    expect(res.succes).toContain("2 séances passées de 20:00 à 22:00");
    expect(faux.audits.map((a) => a.action)).toEqual(["seance.modifiee", "seance.modifiee"]);
  });
});

describe("supprimer plusieurs séances : la serrure de `supprimerSeance`", () => {
  it("refuse un instructeur, qui n'a pas `periods.manage`", async () => {
    await expect(appliquerGesteSeancesEnMasse({ geste: "supprimer", sessionIds: ["s1"] })).rejects.toThrow("Accès refusé");
    expect(faux.ecritures).toEqual([]);
  });

  it("au bureau : code récent redemandé, ateliers détachés, réponses perdues au journal", async () => {
    faux.acteur = { ...BUREAU };
    faux.reponses = { s1: 12, s2: 3 };
    const res = await appliquerGesteSeancesEnMasse({ geste: "supprimer", sessionIds: ["s1", "s2"] });
    expect(res.succes).toContain("2 séances supprimées");
    expect(res.succes).toContain("15 réponses");
    expect(faux.reauths).toEqual(["/seances?modifier=1"]);
    expect(faux.transactions).toBe(1);
    expect(faux.ecritures).toEqual([
      { table: "atelier", op: "updateMany", where: { sessionId: { in: ["s1", "s2"] }, statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } },
      { table: "atelier", op: "updateMany", where: { sessionId: { in: ["s1", "s2"] } }, data: { sessionId: null } },
      { table: "session", op: "deleteMany", where: { id: { in: ["s1", "s2"] } } },
    ]);
    expect(faux.audits).toEqual([
      { action: "seance.supprimee", cible: "s1", details: { date: "2099-10-06", reponses: 12, enMasse: true } },
      { action: "seance.supprimee", cible: "s2", details: { date: "2099-10-13", reponses: 3, enMasse: true } },
    ]);
    expect(faux.prevenus).toEqual([]);
  });

  it("un trimestre clos refuse avant même l'élévation", async () => {
    faux.acteur = { ...BUREAU };
    faux.seances[0].statut = "CLOSE";
    const res = await appliquerGesteSeancesEnMasse({ geste: "supprimer", sessionIds: ["s1"] });
    expect(res.erreur).toMatch(/clos/i);
    expect(faux.reauths).toEqual([]);
  });
});

describe("le geste unitaire tient la même règle du cours commencé", () => {
  it("annulerSeance refuse un cours commencé, et rien ne part", async () => {
    faux.seances = [seance("s9", { date: "2020-01-07" })];
    const fd = new FormData();
    fd.set("sessionId", "s9");
    fd.set("motif", "Pluie");
    const res = await annulerSeance({}, fd);
    expect(res.erreur).toMatch(/déjà commencé/);
    expect(faux.prevenus).toEqual([]);
    expect(faux.ecritures).toEqual([]);
  });

  it("retablirSeance refuse un cours commencé", async () => {
    faux.seances = [seance("s9", { date: "2020-01-07", annulee: true })];
    await expect(retablirSeance("s9")).rejects.toThrow(/déjà commencé/);
    expect(faux.ecritures).toEqual([]);
  });
});
