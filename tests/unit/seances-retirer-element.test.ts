import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Retirer un élément du programme de plusieurs séances** (`appliquerGesteSeancesEnMasse`, geste
 * « retirer ») : l'élément visé par son nom, les séances annulées ou commencées écartées sans refuser
 * le lot, les ateliers liés jamais touchés, le rangement des voisins, une entrée de journal par
 * séance et un seul message aux instructeurs.
 */

type Element = { id: string; sessionId: string; libelle: string; nature: string; bloc: number; ordre: number; atelierId: string | null; theme: string };
type Seance = { id: string; date: string; heureDebut: string; annulee: boolean; statut: string };

const faux = vi.hoisted(() => ({
  acteur: { id: "u-charlie", prenom: "Charlie", nom: "B", email: "charlie@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true } as Record<string, unknown>,
  seances: [] as Seance[],
  elements: [] as Element[],
  supprimes: [] as string[],
  ranges: [] as Array<{ id: string; data: unknown }>,
  audits: [] as Array<{ action: string; cible: string | null; details: Record<string, unknown> }>,
  annonces: [] as Array<{ changements: Array<{ libelle: string; retire?: boolean }> }>,
  synchronisees: [] as string[],
}));

vi.mock("@/lib/db", () => {
  const db = {
    session: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = faux.seances.find((x) => x.id === where.id);
        return s ? { ...s, periodId: "p1", heureFin: "21:30", lieu: "", adresse: "", motifAnnulation: null, period: { statut: s.statut } } : null;
      }),
    },
    sessionPartie: {
      findMany: vi.fn(async ({ where }: { where: { sessionId: string } }) =>
        faux.elements
          .filter((e) => e.sessionId === where.sessionId && !faux.supprimes.includes(e.id))
          .map((e) => ({ ...e, updatedAt: new Date(0), description: "", niveau: "INDIFFERENT", instructeur: { prenom: "Ana", nom: "C" }, instructeurSecond: null })),
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        faux.supprimes.push(where.id);
        return {};
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: unknown }) => {
        faux.ranges.push({ id: where.id, data });
        return {};
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { db };
});

vi.mock("@/lib/planning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/planning")>()),
  synchroniserSeance: vi.fn(async (id: string) => {
    faux.synchronisees.push(id);
  }),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, cible: string | null, details: Record<string, unknown>) => {
    faux.audits.push({ action, cible, details });
  }),
}));
vi.mock("@/lib/notifications/planning-modifie", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/planning-modifie")>()),
  signalerModificationsPlanning: vi.fn(async (s: { changements: Array<{ libelle: string; retire?: boolean }> }) => {
    faux.annonces.push(s);
    return 1;
  }),
}));
vi.mock("@/lib/notifications/seances", () => ({ notifierAnnulation: vi.fn(), phraseAnnulation: vi.fn(), porteurJetonAnnulation: vi.fn() }));
vi.mock("@/lib/auth/current-user", async () => {
  const { can } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof can>[1]) => {
      if (!can(faux.acteur as Parameters<typeof can>[0], permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(),
    requireUser: vi.fn(async () => faux.acteur),
    getCurrentUser: vi.fn(async () => faux.acteur),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { appliquerGesteSeancesEnMasse } = await import("@/actions/seances");

const el = (id: string, sessionId: string, libelle: string, bloc: number, ordre: number, x: Partial<Element> = {}): Element => ({
  id,
  sessionId,
  libelle,
  nature: "COURS",
  bloc,
  ordre,
  atelierId: null,
  theme: "",
  ...x,
});

beforeEach(() => {
  faux.acteur = { id: "u-charlie", prenom: "Charlie", nom: "B", email: "charlie@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
  faux.seances = [
    { id: "s1", date: "2099-10-06", heureDebut: "19:30", annulee: false, statut: "ACTIVE" },
    { id: "s2", date: "2099-10-13", heureDebut: "19:30", annulee: false, statut: "ACTIVE" },
    { id: "s3", date: "2099-10-20", heureDebut: "19:30", annulee: true, statut: "ACTIVE" },
    { id: "s4", date: "2000-01-04", heureDebut: "19:30", annulee: false, statut: "ACTIVE" },
  ];
  faux.elements = [
    el("a1", "s1", "Partie 1 · Cours", 1, 0, { theme: "Épée longue" }),
    el("a2", "s1", "Partie 2 · Option", 2, 1, { nature: "OPTION" }),
    el("a3", "s1", "Partie 3 · Cours", 3, 2),
    el("b1", "s2", "Partie 1 · Cours", 1, 0),
    el("b2", "s2", "Partie 2 · Option", 2, 1, { nature: "ATELIER", atelierId: "at1" }),
    el("c1", "s3", "Partie 2 · Option", 2, 0, { nature: "OPTION" }),
    el("d1", "s4", "Partie 2 · Option", 2, 0, { nature: "OPTION" }),
  ];
  faux.supprimes = [];
  faux.ranges = [];
  faux.audits = [];
  faux.annonces = [];
  faux.synchronisees = [];
});

describe("Retirer un élément en masse", () => {
  it("retire l'élément nommé des seules séances ouvertes, et range les parties suivantes", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "retirer", sessionIds: ["s1", "s3", "s4"], libelle: "Partie 2 · Option" });
    expect(res.erreur).toBeUndefined();
    expect(faux.supprimes).toEqual(["a2"]);
    // La partie 3 devient la partie 2, avec son nom recalculé.
    expect(faux.ranges).toContainEqual({ id: "a3", data: expect.objectContaining({ bloc: 2, libelle: "Partie 2 · Cours" }) });
    expect(res.succes).toBe("« Partie 2 · Option » retiré de 1 séance. 2 séances sont restées de côté : annulées ou déjà commencées.");
  });

  it("ne retire jamais un élément Atelier qui porte un atelier", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "retirer", sessionIds: ["s1", "s2"], libelle: "Partie 2 · Option" });
    expect(faux.supprimes).toEqual(["a2"]);
    expect(res.succes).toContain("1 séance ne le portait pas.");
  });

  it("journalise une entrée par séance sous l'action du retrait unitaire, et annonce une seule fois", async () => {
    await appliquerGesteSeancesEnMasse({ geste: "retirer", sessionIds: ["s2", "s1"], libelle: "Partie 1 · Cours" });
    expect(faux.supprimes).toEqual(["a1", "b1"]);
    expect(faux.audits.map((a) => [a.action, a.cible])).toEqual([
      ["planning.partie.retrait", "s1"],
      ["planning.partie.retrait", "s2"],
    ]);
    expect(faux.audits[0].details).toMatchObject({ partie: "Partie 1 · Cours", theme: "Épée longue", instructeur: "Ana C", enMasse: true });
    expect(faux.annonces).toHaveLength(1);
    expect(faux.annonces[0].changements.map((c) => c.retire)).toEqual([true, true]);
    expect(faux.synchronisees).toEqual(["s1", "s2"]);
  });

  it("refuse le lot entier si une séance est d'un trimestre clos", async () => {
    faux.seances[1].statut = "CLOSE";
    const res = await appliquerGesteSeancesEnMasse({ geste: "retirer", sessionIds: ["s1", "s2"], libelle: "Partie 1 · Cours" });
    expect(res.erreur).toContain("le lot entier est refusé");
    expect(faux.supprimes).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("n'écrit rien ni n'annonce rien quand aucune séance ne porte l'élément", async () => {
    const res = await appliquerGesteSeancesEnMasse({ geste: "retirer", sessionIds: ["s2"], libelle: "Partie 3 · Cours" });
    expect(res.succes).toBe("Aucun changement : aucune séance ouverte ne porte « Partie 3 · Cours ».");
    expect(faux.annonces).toEqual([]);
  });

  it("exige le droit de régler le planning", async () => {
    faux.acteur = { ...faux.acteur, role: "MEMBRE" };
    await expect(appliquerGesteSeancesEnMasse({ geste: "retirer", sessionIds: ["s1"], libelle: "Partie 1 · Cours" })).rejects.toThrow("Accès refusé");
  });
});
