import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Où se pose un atelier retenu, et ce qu'il laisse en partant.**
 *
 * Deux décisions de Delta tiennent ce fichier :
 *
 * 1. **Si aucune option n'est libre, on en crée une à la fin** au lieu de rendre `null`. L'ancien
 *    code retombait sur la Cours 2 — ce qui revenait à prendre le cours principal —, puis
 *    abandonnait : l'atelier restait « planifié » sans être nulle part, et personne ne l'apprenait.
 * 2. **Retirer un atelier vide la case, il ne la supprime pas.** La ligne du programme était
 *    effacée avec lui ; depuis que les parties sont des données rangées par l'équipe, un refus
 *    d'atelier n'a aucune raison de défaire le programme.
 */

type Partie = {
  id: string;
  sessionId: string;
  libelle: string;
  ordre: number;
  estOption: boolean;
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
          estOption: data.estOption ?? false,
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
      updateMany: vi.fn(async ({ where, data }: { where: { atelierId: string }; data: Partial<Partie> }) => {
        for (const p of faux.parties.filter((x) => x.atelierId === where.atelierId)) Object.assign(p, data);
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
    libelle: `Partie ${p.ordre}`,
    estOption: false,
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

describe("placerAtelier", () => {
  it("prend la première option libre et y recopie le titre et le proposant", async () => {
    poser([
      { id: "c0", ordre: 0, libelle: "Cours 1" },
      { id: "c2", ordre: 2, libelle: "Option 1", estOption: true },
      { id: "c3", ordre: 3, libelle: "Option 2", estOption: true },
    ]);
    const posee = await placerAtelier("at-1", "s1", "u-admin");
    expect(posee).toMatchObject({ id: "c2", libelle: "Option 1" });
    expect(faux.parties.find((p) => p.id === "c2")).toMatchObject({ atelierId: "at-1", theme: "Nœuds de corde", instructeurId: "u-propose" });
  });

  it("**crée une option de plus à la fin** quand aucune n'est libre", async () => {
    poser([
      { id: "c0", ordre: 0, libelle: "Cours 1", theme: "Messer" },
      { id: "c2", ordre: 2, libelle: "Option 1", estOption: true, theme: "Dague" },
      { id: "c3", ordre: 3, libelle: "Option 2", estOption: true, atelierId: "at-0" },
    ]);
    const posee = await placerAtelier("at-1", "s1", "u-admin");
    expect(posee?.libelle).toBe("Option 3");
    const creee = faux.parties.at(-1)!;
    // En queue, en option, et contiguë : la séance passe de 3 à 4 parties, rangs 0 à 3.
    expect(creee).toMatchObject({ ordre: 3, estOption: true, atelierId: "at-1", theme: "Nœuds de corde" });
    // Et **toute** la séance est renumérotée : elle arrivait ici avec 0, 2, 3 — des rangs troués,
    // hérités de la migration — et la nouvelle ligne serait venue s'asseoir sur le 3.
    expect([...faux.parties].map((p) => p.ordre).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    // Le cours principal n'a pas été touché : l'ancien repli sur la Cours 2 n'existe plus.
    expect(faux.parties.find((p) => p.id === "c0")).toMatchObject({ theme: "Messer", atelierId: null });
  });

  it("n'écrit rien si la partie explicitement demandée n'existe plus", async () => {
    poser([{ id: "c2", ordre: 2, libelle: "Option 1", estOption: true }]);
    expect(await placerAtelier("at-1", "s1", "u-admin", "disparue")).toBeNull();
    expect(faux.parties.find((p) => p.id === "c2")?.atelierId).toBeNull();
  });

  it("détache l'atelier de la case qu'il occupait ailleurs : il n'est jamais à deux endroits", async () => {
    poser([
      { id: "c2", ordre: 2, libelle: "Option 1", estOption: true, atelierId: "at-1", theme: "Nœuds de corde" },
      { id: "c3", ordre: 3, libelle: "Option 2", estOption: true },
    ]);
    await placerAtelier("at-1", "s1", "u-admin", "c3");
    expect(faux.parties.find((p) => p.id === "c2")?.atelierId).toBeNull();
    expect(faux.parties.find((p) => p.id === "c3")?.atelierId).toBe("at-1");
  });
});

describe("retirerAtelier", () => {
  it("**vide** la case et la laisse en place", async () => {
    poser([
      { id: "c0", ordre: 0, libelle: "Cours 1", theme: "Messer" },
      { id: "c2", ordre: 2, libelle: "Option 1", estOption: true, atelierId: "at-1", theme: "Nœuds de corde", instructeurId: "u-propose", niveau: "AVANCE" },
    ]);
    await retirerAtelier("at-1");
    expect(faux.parties).toHaveLength(2);
    expect(faux.parties.find((p) => p.id === "c2")).toMatchObject({
      libelle: "Option 1",
      ordre: 2,
      estOption: true,
      atelierId: null,
      theme: "",
      instructeurId: null,
      niveau: "INDIFFERENT",
    });
  });

  it("ne fait rien quand l'atelier n'est nulle part", async () => {
    poser([{ id: "c0", ordre: 0, libelle: "Cours 1", theme: "Messer" }]);
    await retirerAtelier("at-inconnu");
    expect(faux.parties[0].theme).toBe("Messer");
  });
});
