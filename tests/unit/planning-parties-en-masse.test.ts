import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Ajouter un cours ou une option à plusieurs séances d'un coup** (`ajouterPartiesEnMasse`), depuis
 * la sélection multiple du planning.
 *
 * Ce que le geste promet, et que rien à l'écran ne montrerait s'il se brisait :
 *
 * 1. **les verrous du geste unitaire**, par les mêmes fonctions : `planning.edit`, la garde de la
 *    séance (trimestre clos, séance annulée, séance introuvable), le plafond de parties ;
 * 2. **tout ou rien** : une séance refusée, et aucune n'a reçu sa partie ;
 * 3. **la même écriture que l'ajout unitaire** : nom calculé, cours devant les options ;
 * 4. **une entrée de journal par séance**, sous l'action de l'ajout unitaire, avec `enMasse: true` ;
 * 5. le plafond `SELECTION_MAX` et les doublons écartés.
 */

type Partie = { id: string; sessionId: string; libelle: string; ordre: number; estOption: boolean; updatedAt: Date; modifieParId: string | null };
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
    sessionPartie: {
      findMany: vi.fn(async ({ where }: { where: { sessionId: string } }) => faux.parties.filter((p) => p.sessionId === where.sessionId).map((p) => ({ ...p }))),
      create: vi.fn(async ({ data }: { data: Partial<Partie> }) => {
        const creee: Partie = {
          id: `n-${++faux.compteur}`,
          sessionId: data.sessionId!,
          libelle: data.libelle ?? "",
          ordre: data.ordre ?? 0,
          estOption: data.estOption ?? false,
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

/** Le modèle d'une séance neuve : deux cours, plus une option sur la seconde. */
function modele(sessionId: string, avecOption = false): Partie[] {
  const noms = ["Cours 1", "Cours 2", ...(avecOption ? ["Option 1"] : [])];
  return noms.map((libelle, ordre) => ({ id: `${sessionId}-${ordre}`, sessionId, libelle, ordre, estOption: libelle.startsWith("Option"), updatedAt: new Date(0), modifieParId: null }));
}
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
  faux.parties = [...modele("s-mar"), ...modele("s-sam", true)];
});

describe("ajouter un cours à plusieurs séances", () => {
  it("exige `planning.edit`, comme l'ajout unitaire", async () => {
    await ajouterPartiesEnMasse({ sessionIds: ["s-mar"] });
    expect(faux.permissions).toEqual(["planning.edit"]);
  });

  it("ajoute le cours en queue de sa série sur chaque séance — devant les options", async () => {
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-sam", "s-mar"], estOption: false });
    expect(res.succes).toBe("Cours ajouté à 2 séances.");
    expect(noms("s-mar")).toEqual(["Cours 1", "Cours 2", "Cours 3"]);
    expect(noms("s-sam")).toEqual(["Cours 1", "Cours 2", "Cours 3", "Option 1"]);
  });

  it("ajoute une option sous le nom de la série des options", async () => {
    await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-sam"], estOption: true });
    expect(noms("s-mar")).toEqual(["Cours 1", "Cours 2", "Option 1"]);
    expect(noms("s-sam")).toEqual(["Cours 1", "Cours 2", "Option 1", "Option 2"]);
  });

  it("écrit exactement ce qu'écrit l'ajout unitaire", async () => {
    await ajouterPartiesEnMasse({ sessionIds: ["s-mar"] });
    const masse = noms("s-mar");
    faux.parties = [...modele("s-mar"), ...modele("s-sam", true)];
    await ajouterPartie({ sessionId: "s-mar" });
    expect(noms("s-mar")).toEqual(masse);
  });

  it("une entrée de journal par séance, sous l'action de l'ajout unitaire, dans l'ordre du calendrier", async () => {
    await ajouterPartiesEnMasse({ sessionIds: ["s-sam", "s-mar"] });
    expect(faux.audits).toEqual([
      { action: "planning.partie.ajout", cible: "s-mar", details: { date: "2126-10-06", partie: "Cours 3", option: false, enMasse: true } },
      { action: "planning.partie.ajout", cible: "s-sam", details: { date: "2126-10-10", partie: "Cours 3", option: false, enMasse: true } },
    ]);
    expect(faux.synchronisations.sort()).toEqual(["s-mar", "s-sam"]);
  });

  it("une séance cochée deux fois ne reçoit qu'un cours", async () => {
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-mar"] });
    expect(res.succes).toBe("Cours ajouté à 1 séance.");
    expect(noms("s-mar")).toEqual(["Cours 1", "Cours 2", "Cours 3"]);
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
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-sam"] });
    expect(res.erreur).toMatch(/^Rien n'a été ajouté : le lot entier est refusé\. Cette séance est annulée/);
    rien();
  });

  it("un trimestre clos refuse le lot entier, et le dit une fois", async () => {
    for (const s of faux.seances) s.statut = "CLOSE";
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-sam"] });
    expect(res.erreur).toBeTruthy();
    expect(res.erreur!.split("clos").length).toBe(2);
    rien();
  });

  it("une séance introuvable refuse le lot entier", async () => {
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-effacee"] });
    expect(res.erreur).toMatch(/Séance introuvable/);
    rien();
  });

  it("une séance au plafond de parties refuse le lot entier, en nommant sa date", async () => {
    faux.parties = [
      ...modele("s-mar"),
      ...Array.from({ length: PARTIES_PAR_SEANCE_MAX }, (_, i) => ({ id: `p${i}`, sessionId: "s-sam", libelle: `Cours ${i + 1}`, ordre: i, estOption: false, updatedAt: new Date(0), modifieParId: null })),
    ];
    const avant = faux.parties.length;
    const res = await ajouterPartiesEnMasse({ sessionIds: ["s-mar", "s-sam"] });
    expect(res.erreur).toMatch(/jeudi 10 octobre/);
    expect(res.erreur).toMatch(/Rien n'a été ajouté/);
    // La séance du mardi, vérifiée la première, n'a rien reçu non plus.
    expect(faux.parties).toHaveLength(avant);
    expect(faux.audits).toEqual([]);
  });

  it("refuse un lot vide, ou plus grand que `SELECTION_MAX`", async () => {
    expect((await ajouterPartiesEnMasse({ sessionIds: [] })).erreur).toBeTruthy();
    const trop = Array.from({ length: SELECTION_MAX + 1 }, (_, i) => `s${i}`);
    expect((await ajouterPartiesEnMasse({ sessionIds: trop })).erreur).toBeTruthy();
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
