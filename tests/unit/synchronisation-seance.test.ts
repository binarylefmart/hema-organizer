import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **`synchroniserSeance` — le recopiage des cases dans la séance.**
 *
 * Cette fonction n'avait aucun test alors qu'elle alimente deux colonnes lues partout ailleurs :
 * `Session.disciplines` (objet des emails, embed Discord, message WhatsApp, historique du membre) et
 * la table `SessionInstructeur` (qui encadre, donc qui reçoit les alertes d'effectif). Une erreur
 * ici ne se voit sur aucun écran de planning : elle se voit le soir, dans un email déjà parti.
 *
 * On la couvre donc **avant** de lui apprendre les parties libres et le second instructeur.
 */

type Partie = {
  ordre: number;
  theme: string;
  instructeurId: string | null;
  instructeurSecondId: string | null;
};

const faux = vi.hoisted(() => ({
  parties: [] as Array<Record<string, unknown>>,
  ecrit: [] as Array<{ quoi: string; data: unknown }>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    sessionPartie: {
      // La base trie (`orderBy: { ordre }`) : le faux le fait aussi, sans quoi le test vérifierait
      // un tri que le code n'a plus à faire.
      findMany: vi.fn(async ({ orderBy }: { orderBy?: { ordre?: "asc" | "desc" } }) => {
        const lignes = faux.parties.map((p) => ({ ...p }));
        return orderBy?.ordre === "asc" ? lignes.sort((a, b) => (a.ordre as number) - (b.ordre as number)) : lignes;
      }),
    },
    session: {
      update: vi.fn(({ data }: { data: unknown }) => {
        faux.ecrit.push({ quoi: "session.update", data });
        return Promise.resolve({});
      }),
    },
    sessionInstructeur: {
      deleteMany: vi.fn(() => {
        faux.ecrit.push({ quoi: "instructeurs.deleteMany", data: null });
        return Promise.resolve({});
      }),
      createMany: vi.fn(({ data }: { data: unknown }) => {
        faux.ecrit.push({ quoi: "instructeurs.createMany", data });
        return Promise.resolve({});
      }),
    },
    // Les trois écritures doivent partir ensemble : une séance sans instructeur le temps d'une
    // requête serait une séance qu'aucune alerte ne réveille.
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const { synchroniserSeance } = await import("@/lib/planning");

/** Ce que la séance a reçu : les disciplines et les identifiants d'encadrants, dans l'ordre écrit. */
function resultat() {
  const disciplines = faux.ecrit.find((e) => e.quoi === "session.update") as { data: { disciplines: string } } | undefined;
  const instructeurs = faux.ecrit.find((e) => e.quoi === "instructeurs.createMany") as { data: Array<{ userId: string }> } | undefined;
  return {
    disciplines: disciplines?.data.disciplines ?? "",
    instructeurs: (instructeurs?.data ?? []).map((i) => i.userId),
  };
}

function poser(parties: Partie[]) {
  faux.parties = parties as unknown as Array<Record<string, unknown>>;
}

beforeEach(() => {
  faux.parties = [];
  faux.ecrit = [];
  vi.clearAllMocks();
});

describe("synchroniserSeance", () => {
  it("recopie les thèmes dans l'ordre des parties, sans doublon ni case vide", async () => {
    poser([
      { ordre: 2, theme: "Messer", instructeurId: null, instructeurSecondId: null },
      { ordre: 0, theme: "Épée longue", instructeurId: null, instructeurSecondId: null },
      { ordre: 1, theme: "  ", instructeurId: null, instructeurSecondId: null },
      { ordre: 3, theme: "Épée longue", instructeurId: null, instructeurSecondId: null },
    ]);
    await synchroniserSeance("s1");
    // L'ordre des parties, pas celui de la requête : c'est ce qu'on lit dans l'objet de l'email.
    expect(resultat().disciplines).toBe("Épée longue,Messer");
  });

  it("coupe les espaces autour d'un thème saisi à la main", async () => {
    poser([{ ordre: 0, theme: "  Dague  ", instructeurId: null, instructeurSecondId: null }]);
    await synchroniserSeance("s1");
    expect(resultat().disciplines).toBe("Dague");
  });

  it("reprend les deux instructeurs de chaque partie, le premier avant le second", async () => {
    poser([
      { ordre: 0, theme: "Messer", instructeurId: "u1", instructeurSecondId: "u2" },
      { ordre: 1, theme: "Lutte", instructeurId: "u3", instructeurSecondId: null },
    ]);
    await synchroniserSeance("s1");
    expect(resultat().instructeurs).toEqual(["u1", "u2", "u3"]);
  });

  it("ne compte qu'une fois quelqu'un qui encadre deux parties, ou qui assiste là où il mène", async () => {
    poser([
      { ordre: 0, theme: "Messer", instructeurId: "u1", instructeurSecondId: "u2" },
      { ordre: 1, theme: "Lutte", instructeurId: "u2", instructeurSecondId: "u1" },
    ]);
    await synchroniserSeance("s1");
    expect(resultat().instructeurs).toEqual(["u1", "u2"]);
  });

  it("vide la séance quand plus aucune case ne dit rien", async () => {
    poser([{ ordre: 0, theme: "", instructeurId: null, instructeurSecondId: null }]);
    await synchroniserSeance("s1");
    expect(resultat()).toEqual({ disciplines: "", instructeurs: [] });
  });

  it("efface les anciens encadrants avant d'écrire les nouveaux, dans la même transaction", async () => {
    poser([{ ordre: 0, theme: "Messer", instructeurId: "u1", instructeurSecondId: null }]);
    await synchroniserSeance("s1");
    expect(faux.ecrit.map((e) => e.quoi)).toEqual(["session.update", "instructeurs.deleteMany", "instructeurs.createMany"]);
  });
});
