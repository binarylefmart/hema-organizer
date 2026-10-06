import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Où se pose un atelier retenu, et ce qu'il laisse en partant.**
 *
 * Deux décisions de Delta tiennent ce fichier :
 *
 * 1. **Où il se pose** : un élément Atelier vide d'abord, sinon une option libre, sinon **un élément
 *    Atelier de plus dans la dernière partie** — jamais `null` faute de place, jamais à la place d'un
 *    cours. L'élément choisi passe en nature ATELIER, et la séance est rangée (son nom change).
 * 2. **Retirer un atelier vide la case, il ne la supprime pas** : l'élément reste, Atelier et vide,
 *    prêt pour le suivant.
 */

type Partie = {
  id: string;
  sessionId: string;
  libelle: string;
  ordre: number;
  bloc: number;
  nature: string;
  updatedAt: Date;
  instructeurId: string | null;
  instructeurSecondId: string | null;
  theme: string;
  niveau: string;
  atelierId: string | null;
  modifieParId: string | null;
};

const faux = vi.hoisted(() => ({ parties: [] as Partie[], compteur: 0, synchronisees: [] as string[] }));

vi.mock("@/lib/db", () => {
  const client = {
    atelier: { findUniqueOrThrow: vi.fn(async () => ({ titre: "Nœuds de corde", proposeParId: "u-propose" })) },
    sessionPartie: {
      findMany: vi.fn(async ({ where }: { where: { sessionId?: string; atelierId?: string } }) =>
        faux.parties.filter((p) => (where.sessionId ? p.sessionId === where.sessionId : p.atelierId === where.atelierId)).map((p) => ({ ...p })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const p = faux.parties.find((x) => x.id === where.id);
        return p ? { ...p } : null;
      }),
      create: vi.fn(async ({ data }: { data: Partial<Partie> }) => {
        const creee: Partie = {
          id: `n${++faux.compteur}`,
          sessionId: data.sessionId!,
          libelle: data.libelle ?? "",
          ordre: data.ordre ?? 0,
          bloc: data.bloc ?? 1,
          nature: data.nature ?? "COURS",
          updatedAt: new Date(),
          instructeurId: null,
          instructeurSecondId: null,
          theme: "",
          niveau: "INDIFFERENT",
          atelierId: null,
          modifieParId: data.modifieParId ?? null,
        };
        faux.parties.push(creee);
        return { ...creee };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Partie> }) => {
        const p = faux.parties.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return { ...p };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { atelierId: string; id?: { not: string } }; data: Partial<Partie> }) => {
        for (const p of faux.parties.filter((x) => x.atelierId === where.atelierId && x.id !== where.id?.not)) Object.assign(p, data);
        return {};
      }),
    },
    session: { update: vi.fn(async () => ({})) },
    sessionInstructeur: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
  };
  const db = {
    ...client,
    /**
     * Les deux formes de `$transaction` : un tableau d'écritures, et une fonction qui reçoit le
     * client — c'est celle qu'emploie la création de l'option de secours, qui doit **relire la
     * séance dans** la transaction pour ne pas naître au rang d'une autre.
     */
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === "function" ? (arg as (c: typeof client) => Promise<unknown>)(client) : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  return { db };
});

const { placerAtelier, retirerAtelier } = await import("@/lib/planning");

function poser(parties: Array<Partial<Partie> & { id: string; ordre: number }>) {
  faux.parties = parties.map((p) => ({
    sessionId: "s1",
    libelle: "",
    bloc: 1,
    nature: "COURS",
    updatedAt: new Date(0),
    instructeurId: null,
    instructeurSecondId: null,
    theme: "",
    niveau: "INDIFFERENT",
    atelierId: null,
    modifieParId: null,
    ...p,
  }));
}

beforeEach(() => {
  faux.compteur = 0;
  vi.clearAllMocks();
});

const lue = (id: string) => faux.parties.find((p) => p.id === id);

describe("placerAtelier", () => {
  it("prend la première option libre, la passe en Atelier et y recopie le titre et le proposant", async () => {
    poser([
      { id: "c0", ordre: 0, bloc: 1 },
      { id: "c1", ordre: 1, bloc: 1, nature: "OPTION" },
      { id: "c2", ordre: 2, bloc: 2 },
      { id: "c3", ordre: 3, bloc: 2, nature: "OPTION" },
    ]);
    const posee = await placerAtelier("at-1", "s1", "u-admin");
    expect(posee).toMatchObject({ id: "c1", libelle: "Partie 1 · Atelier" });
    expect(lue("c1")).toMatchObject({ nature: "ATELIER", atelierId: "at-1", theme: "Nœuds de corde", instructeurId: "u-propose" });
  });

  it("recopie l'animateur et le second animateur choisis dans la proposition", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.atelier.findUniqueOrThrow).mockResolvedValueOnce({ titre: "Nœuds de corde", proposeParId: "u-propose", animateurId: "u-anime", animateurSecondId: "u-second" } as never);
    poser([{ id: "c0", ordre: 0, bloc: 1, nature: "OPTION" }]);
    await placerAtelier("at-1", "s1", "u-admin");
    expect(lue("c0")).toMatchObject({ instructeurId: "u-anime", instructeurSecondId: "u-second" });
  });

  it("sans animateur, le second mène seul ; sans aucun des deux, c'est la personne qui propose", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.atelier.findUniqueOrThrow).mockResolvedValueOnce({ titre: "T", proposeParId: "u-propose", animateurId: null, animateurSecondId: "u-second" } as never);
    poser([{ id: "c0", ordre: 0, bloc: 1, nature: "OPTION" }]);
    await placerAtelier("at-1", "s1", "u-admin");
    expect(lue("c0")).toMatchObject({ instructeurId: "u-second", instructeurSecondId: null });
  });

  it("préfère un élément Atelier vide — celui qu'un atelier retiré a laissé", async () => {
    poser([
      { id: "c0", ordre: 0, bloc: 1 },
      { id: "c1", ordre: 1, bloc: 1, nature: "OPTION" },
      { id: "c2", ordre: 2, bloc: 2, nature: "ATELIER" },
    ]);
    expect((await placerAtelier("at-1", "s1", "u-admin"))?.id).toBe("c2");
  });

  it("**crée un élément Atelier dans la dernière partie** quand rien n'est libre, et range la séance", async () => {
    poser([
      { id: "c0", ordre: 0, bloc: 1, theme: "Messer" },
      { id: "c2", ordre: 2, bloc: 1, nature: "OPTION", theme: "Dague" },
      { id: "c3", ordre: 3, bloc: 2, nature: "ATELIER", atelierId: "at-0" },
    ]);
    const posee = await placerAtelier("at-1", "s1", "u-admin");
    expect(posee?.libelle).toBe("Partie 2 · Atelier 2");
    const creee = faux.parties.at(-1)!;
    expect(creee).toMatchObject({ bloc: 2, nature: "ATELIER", atelierId: "at-1", theme: "Nœuds de corde" });
    // Toute la séance est renumérotée : elle arrivait avec 0, 2, 3 — des rangs troués.
    expect([...faux.parties].map((p) => p.ordre).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(lue("c3")?.libelle).toBe("Partie 2 · Atelier 1");
    // Le cours principal n'a pas été touché.
    expect(lue("c0")).toMatchObject({ theme: "Messer", atelierId: null, nature: "COURS" });
  });

  it("crée l'élément dans la partie 1 d'une séance qui n'a rien", async () => {
    poser([]);
    const posee = await placerAtelier("at-1", "s1", "u-admin");
    // Une seule partie : pas de « Partie 1 · » (avenant du 06/10).
    expect(posee?.libelle).toBe("Atelier");
  });

  it("n'écrit rien si l'élément explicitement demandé n'existe plus", async () => {
    poser([{ id: "c2", ordre: 2, nature: "OPTION" }]);
    expect(await placerAtelier("at-1", "s1", "u-admin", "disparue")).toBeNull();
    expect(lue("c2")?.atelierId).toBeNull();
  });

  it("l'élément désigné à la main passe en Atelier, même un cours vide", async () => {
    poser([
      { id: "c0", ordre: 0, bloc: 1 },
      { id: "c1", ordre: 1, bloc: 2 },
    ]);
    await placerAtelier("at-1", "s1", "u-admin", "c1");
    expect(lue("c1")).toMatchObject({ nature: "ATELIER", libelle: "Partie 2 · Atelier", atelierId: "at-1" });
  });

  it("détache l'atelier de la case qu'il occupait ailleurs : il n'est jamais à deux endroits", async () => {
    poser([
      { id: "c2", ordre: 0, nature: "ATELIER", atelierId: "at-1", theme: "Nœuds de corde" },
      { id: "c3", ordre: 1, nature: "OPTION" },
    ]);
    await placerAtelier("at-1", "s1", "u-admin", "c3");
    expect(lue("c2")).toMatchObject({ atelierId: null, nature: "ATELIER" });
    expect(lue("c3")?.atelierId).toBe("at-1");
  });
});

describe("retirerAtelier", () => {
  it("**vide** la case et la laisse en place, Atelier et vide", async () => {
    poser([
      { id: "c0", ordre: 0, libelle: "Partie 1 · Cours", theme: "Messer" },
      { id: "c2", ordre: 1, libelle: "Partie 1 · Atelier", nature: "ATELIER", atelierId: "at-1", theme: "Nœuds de corde", instructeurId: "u-propose", niveau: "AVANCE" },
    ]);
    await retirerAtelier("at-1");
    expect(faux.parties).toHaveLength(2);
    expect(lue("c2")).toMatchObject({
      libelle: "Partie 1 · Atelier",
      ordre: 1,
      nature: "ATELIER",
      atelierId: null,
      theme: "",
      instructeurId: null,
      niveau: "INDIFFERENT",
    });
  });

  it("ne fait rien quand l'atelier n'est nulle part", async () => {
    poser([{ id: "c0", ordre: 0, theme: "Messer" }]);
    await retirerAtelier("at-inconnu");
    expect(faux.parties[0].theme).toBe("Messer");
  });
});
