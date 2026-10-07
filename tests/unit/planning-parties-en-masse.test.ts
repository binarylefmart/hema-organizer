import { beforeEach, describe, expect, it, vi } from "vitest";
import { libelleElement, type NatureElement } from "@/lib/constants";
import { placesDansPartie } from "@/components/planning/rangement";

/**
 * **Ajouter un même élément (échauffement, cours, option) dans une partie de plusieurs séances d'un
 * coup** (`ajouterPartiesEnMasse`), depuis la sélection multiple du planning.
 *
 * Ce que le geste promet, et que rien à l'écran ne montrerait s'il se brisait :
 *
 * 1. **les verrous du geste unitaire**, par les mêmes fonctions : `planning.edit`, la garde de la
 *    séance (trimestre clos, séance annulée, séance introuvable), le plafond de parties ;
 * 2. **tout ou rien** : une séance refusée, et aucune n'a reçu sa partie ;
 * 3. **la même écriture que l'ajout unitaire** : nom calculé, partie ramenée aux limites de chaque
 *    séance (une séance qui a moins de `bloc - 1` parties reçoit l'élément dans une partie nouvelle) ;
 * 4. **une entrée de journal par séance**, sous l'action de l'ajout unitaire, avec `enMasse: true` ;
 * 5. le plafond `SELECTION_MAX` et les doublons écartés.
 */

type Partie = { id: string; sessionId: string; libelle: string; ordre: number; bloc: number; nature: NatureElement; updatedAt: Date; modifieParId: string | null };
type Seance = { id: string; date: string; annulee: boolean; statut: string };

const faux = vi.hoisted(() => ({
  acteur: { id: "u-alix", role: "INSTRUCTEUR", estAdmin: false, service: false, actif: true },
  permissions: [] as string[],
  parties: [] as Partie[],
  seances: [] as Seance[],
  audits: [] as Array<{ action: string; cible: string | null; details: Record<string, unknown> }>,
  synchronisations: [] as string[],
  compteur: 0,
}));

vi.mock("@/lib/db", () => {
  const client = {
    // La liste des thèmes du club (teinte d'un élément) : le réglage n'est jamais enregistré ici.
    setting: { findUnique: vi.fn(async () => null) },
    sessionPartie: {
      findMany: vi.fn(async ({ where }: { where: { sessionId: string } }) => faux.parties.filter((p) => p.sessionId === where.sessionId).map((p) => ({ ...p }))),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ ...faux.parties.find((p) => p.id === where.id)! })),
      create: vi.fn(async ({ data }: { data: Partial<Partie> }) => {
        const creee: Partie = {
          id: `n-${++faux.compteur}`,
          sessionId: data.sessionId!,
          libelle: data.libelle ?? "",
          ordre: data.ordre ?? 0,
          bloc: data.bloc ?? 1,
          nature: data.nature ?? "COURS",
          updatedAt: new Date(),
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
    },
    session: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = faux.seances.find((x) => x.id === where.id);
        return s ? { id: s.id, date: s.date, annulee: s.annulee, period: { statut: s.statut } } : null;
      }),
    },
  };
  return {
    db: { ...client, $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (c: typeof client) => Promise<unknown>)(client) : Promise.all(arg as Promise<unknown>[]))) },
  };
});
vi.mock("@/lib/auth/current-user", () => ({
  assertPermission: vi.fn(async (p: string) => {
    faux.permissions.push(p);
    return faux.acteur;
  }),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_u: unknown, action: string, cible: string | null, details: Record<string, unknown>) => {
    faux.audits.push({ action, cible, details });
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/planning", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  synchroniserSeance: vi.fn(async (id: string) => {
    faux.synchronisations.push(id);
  }),
}));

const { ajouterPartie, ajouterPartiesEnMasse } = await import("@/actions/planning");
const { PARTIES_PAR_SEANCE_MAX } = await import("@/lib/validation/gestion");
const { SELECTION_MAX } = await import("@/lib/validation/presences");

/** Une séance rangée, nommée comme le code la nomme. */
function seance(sessionId: string, elements: Array<[number, NatureElement]>): Partie[] {
  const places = placesDansPartie(elements.map(([bloc, nature]) => ({ bloc, nature })));
  const nbParties = new Set(elements.map(([bloc]) => bloc)).size;
  return elements.map(([bloc, nature], ordre) => ({
    id: `${sessionId}-${ordre}`,
    sessionId,
    libelle: libelleElement(bloc, nature, places[ordre].rang, places[ordre].nombre, nbParties),
    ordre,
    bloc,
    nature,
    updatedAt: new Date(0),
    modifieParId: null,
  }));
}
/** Mardi : deux parties d'un cours. Samedi : trois parties, une option dans la première. */
const depart = () => [
  ...seance("s-mar", [[1, "COURS"], [2, "COURS"]]),
  ...seance("s-sam", [[1, "COURS"], [1, "OPTION"], [2, "COURS"]]),
];
const noms = (sessionId: string) =>
  faux.parties
    .filter((p) => p.sessionId === sessionId)
    .sort((x, y) => x.ordre - y.ordre)
    .map((p) => p.libelle);

beforeEach(() => {
  faux.permissions = [];
  faux.audits = [];
  faux.synchronisations = [];
  faux.compteur = 0;
  // La séance la plus tardive en premier dans la base : le journal doit suivre le calendrier, pas l'ordre reçu.
  faux.seances = [
    { id: "s-sam", date: "2126-10-10", annulee: false, statut: "ACTIVE" },
    { id: "s-mar", date: "2126-10-06", annulee: false, statut: "ACTIVE" },
  ];
  faux.parties = depart();
});

describe("ajouter un élément à plusieurs séances", () => {
  it("exige `planning.edit`, comme l'ajout unitaire", async () => {
    await ajouterPartiesEnMasse({ sessionIds: ["s-mar"], bloc: 1, nature: "COURS" });
    expect(faux.permissions).toEqual(["planning.edit"]);
  });

  it("ajoute un échauffement dans la partie 1 de chaque séance — devant le cours", async () => {
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-sam", "s-mar"], bloc: 1, nature: "ECHAUFFEMENT" });
    expect(res.succes).toBe("Échauffement ajouté à 2 séances.");
    expect(noms("s-mar")).toEqual(["Partie 1 · Échauffement", "Partie 1 · Cours", "Partie 2 · Cours"]);
    expect(noms("s-sam")).toEqual(["Partie 1 · Échauffement", "Partie 1 · Cours", "Partie 1 · Option", "Partie 2 · Cours"]);
  });

  it("une séance qui n'a pas assez de parties reçoit l'élément dans une partie nouvelle, à la fin", async () => {
    // Partie 4 demandée : le mardi n'en a que deux, le samedi aussi — chacun ouvre sa partie 3.
    await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-sam"], bloc: 4, nature: "OPTION" });
    expect(noms("s-mar")).toEqual(["Partie 1 · Cours", "Partie 2 · Cours", "Partie 3 · Option"]);
    expect(noms("s-sam")).toEqual(["Partie 1 · Cours", "Partie 1 · Option", "Partie 2 · Cours", "Partie 3 · Option"]);
  });

  it("numérote les éléments de même nature dans une partie", async () => {
    await ajouterPartiesEnMasse({ sessionIds: ["s-sam"], bloc: 1, nature: "OPTION" });
    expect(noms("s-sam")).toEqual(["Partie 1 · Cours", "Partie 1 · Option 1", "Partie 1 · Option 2", "Partie 2 · Cours"]);
  });

  it("refuse un atelier : il se place un à un, depuis sa proposition", async () => {
    expect((await ajouterPartiesEnMasse({ sessionIds: ["s-mar"], bloc: 1, nature: "ATELIER" as never })).erreur).toBeTruthy();
    expect(faux.parties).toHaveLength(5);
  });

  it("écrit exactement ce qu'écrit l'ajout unitaire", async () => {
    await ajouterPartiesEnMasse({ sessionIds: ["s-mar"], bloc: 2, nature: "COURS" });
    const masse = noms("s-mar");
    faux.parties = depart();
    await ajouterPartie({ sessionId: "s-mar", bloc: 2, nature: "COURS" });
    expect(noms("s-mar")).toEqual(masse);
  });

  it("une entrée de journal par séance, sous l'action de l'ajout unitaire, dans l'ordre du calendrier", async () => {
    await ajouterPartiesEnMasse({ sessionIds: ["s-sam", "s-mar"], bloc: 2, nature: "COURS" });
    expect(faux.audits).toEqual([
      { action: "planning.partie.ajout", cible: "s-mar", details: { date: "2126-10-06", partie: "Partie 2 · Cours 2", bloc: 2, nature: "COURS", enMasse: true } },
      { action: "planning.partie.ajout", cible: "s-sam", details: { date: "2126-10-10", partie: "Partie 2 · Cours 2", bloc: 2, nature: "COURS", enMasse: true } },
    ]);
    expect(faux.synchronisations.sort()).toEqual(["s-mar", "s-sam"]);
  });

  it("une séance cochée deux fois ne reçoit qu'un élément", async () => {
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-mar"], bloc: 3, nature: "COURS" });
    expect(res.succes).toBe("Cours ajouté à 1 séance.");
    expect(noms("s-mar")).toEqual(["Partie 1 · Cours", "Partie 2 · Cours", "Partie 3 · Cours"]);
    expect(faux.audits).toHaveLength(1);
  });
});

describe("tout ou rien", () => {
  const rien = () => {
    expect(faux.parties).toHaveLength(5);
    expect(faux.audits).toEqual([]);
    expect(faux.synchronisations).toEqual([]);
  };

  it("une séance annulée refuse le lot entier", async () => {
    faux.seances[0].annulee = true;
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-sam"], bloc: 1, nature: "COURS" });
    expect(res.erreur).toMatch(/^Rien n'a été ajouté : le lot entier est refusé\. Cette séance est annulée/);
    rien();
  });

  it("un trimestre clos refuse le lot entier, et le dit une fois", async () => {
    for (const s of faux.seances) s.statut = "CLOSE";
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-sam"], bloc: 1, nature: "COURS" });
    expect(res.erreur).toBeTruthy();
    expect(res.erreur!.split("clos").length).toBe(2);
    rien();
  });

  it("une séance introuvable refuse le lot entier", async () => {
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-effacee"], bloc: 1, nature: "COURS" });
    expect(res.erreur).toMatch(/Séance introuvable/);
    rien();
  });

  it("une séance au plafond de parties refuse le lot entier, en nommant sa date", async () => {
    faux.parties = [
      ...seance("s-mar", [[1, "COURS"], [2, "COURS"]]),
      ...seance("s-sam", Array.from({ length: PARTIES_PAR_SEANCE_MAX }, (_, i) => [i + 1, "COURS"] as [number, NatureElement])),
    ];
    const avant = faux.parties.length;
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-sam"], bloc: 1, nature: "COURS" });
    expect(res.erreur).toMatch(/jeudi 10 octobre/);
    expect(res.erreur).toMatch(/Rien n'a été ajouté/);
    // La séance du mardi, vérifiée la première, n'a rien reçu non plus.
    expect(faux.parties).toHaveLength(avant);
    expect(faux.audits).toEqual([]);
  });

  it("refuse un lot vide, ou plus grand que `SELECTION_MAX`", async () => {
    expect((await ajouterPartiesEnMasse({ sessionIds: [], bloc: 1, nature: "COURS" })).erreur).toBeTruthy();
    const trop = Array.from({ length: SELECTION_MAX + 1 }, (_, i) => `s${i}`);
    expect((await ajouterPartiesEnMasse({ sessionIds: trop, bloc: 1, nature: "COURS" })).erreur).toBeTruthy();
    rien();
  });

  it("refuse une entrée qui n'est pas un lot", async () => {
    expect((await ajouterPartiesEnMasse(null as never)).erreur).toBeTruthy();
    rien();
  });
});

describe("deux portes, une serrure", () => {
  it("l'ajout unitaire et l'ajout en masse passent par les mêmes fonctions", async () => {
    const { readFileSync } = await import("node:fs");
    const code = readFileSync("src/actions/planning.ts", "utf8");
    const corps = (nom: string) => code.slice(code.indexOf(`export async function ${nom}(`), code.indexOf("\n}\n", code.indexOf(`export async function ${nom}(`)));
    for (const nom of ["ajouterPartie", "ajouterPartiesEnMasse"]) {
      expect(corps(nom), nom).toContain('assertPermission("planning.edit")');
      expect(corps(nom), nom).toContain("seancePourEcriture(");
      expect(corps(nom), nom).toContain("creerPartie(tx,");
      expect(corps(nom), nom).toContain('"planning.partie.ajout"');
    }
  });
});
