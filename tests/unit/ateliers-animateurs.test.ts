import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **« Qui anime ? » et « Second animateur »** sur une proposition d'atelier.
 *
 * N'importe quel compte actif du club peut animer — membres et instructeurs, bureau compris —,
 * jamais le compte de service du portail ni un compte désactivé (sauf s'il était déjà enregistré sur
 * la proposition qu'on modifie). Le second est facultatif, jamais le même que le premier, jamais
 * sans premier.
 */

type FauxUser = { id: string; prenom: string; nom: string; actif: boolean; service: boolean };
type FauxAtelier = { id: string; proposeParId: string; statut: string; titre: string; animateurId: string | null; animateurSecondId: string | null };

const faux = vi.hoisted(() => ({
  acteur: { id: "u-membre", prenom: "Golf", nom: "09", email: "s@club.test", role: "MEMBRE", estAdmin: false, actif: true },
  users: [] as FauxUser[],
  ateliers: [] as FauxAtelier[],
  crees: [] as Record<string, unknown>[],
  modifies: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; service: boolean; OR: Array<{ actif?: boolean; id?: { in: string[] } }> } }) =>
        faux.users.filter(
          (u) =>
            where.id.in.includes(u.id) &&
            u.service === where.service &&
            where.OR.some((c) => (c.actif !== undefined && u.actif === c.actif) || (c.id && c.id.in.includes(u.id))),
        ),
      ),
    },
    atelier: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.crees.push(data);
        return { id: "at-neuf", ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.modifies.push(data);
        return { id: "at-1", ...data };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = faux.ateliers.find((x) => x.id === where.id);
        if (!a) throw new Error("introuvable");
        return a;
      }),
    },
    session: { findUnique: vi.fn(async () => null) },
  },
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/planning", () => ({ placerAtelier: vi.fn(async () => {}), retirerAtelier: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/ateliers", () => ({ notifierDecisionAtelier: vi.fn(async () => false) }));
vi.mock("@/lib/auth/current-user", () => ({ assertPermission: vi.fn(async () => faux.acteur) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { proposerAtelier, modifierAtelier } = await import("@/actions/ateliers");
const { atelierSchema } = await import("@/lib/validation/gestion");
const { libelleAnimation } = await import("@/lib/ateliers");

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ titre: "Lutte au sol", description: "", materiel: "", sessionId: "", ...champs })) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  faux.users = [
    { id: "u-membre", prenom: "Golf", nom: "09", actif: true, service: false },
    { id: "u-instr", prenom: "Bravo", nom: "02", actif: true, service: false },
    { id: "u-admin", prenom: "Delta", nom: "B", actif: true, service: false },
    { id: "u-parti", prenom: "Paul", nom: "Parti", actif: false, service: false },
    { id: "u-portail", prenom: "Portail", nom: "", actif: true, service: true },
  ];
  faux.ateliers = [{ id: "at-1", proposeParId: "u-membre", statut: "PROPOSE", titre: "Lutte", animateurId: "u-membre", animateurSecondId: "u-parti" }];
  faux.crees = [];
  faux.modifies = [];
});

describe("atelierSchema : les deux animateurs", () => {
  const base = { titre: "Lutte", description: "", materiel: "", sessionId: "" };
  it("vide = pas de choix (l'action prend la personne qui propose)", () => {
    const r = atelierSchema.parse({ ...base, animateurId: "", animateurSecondId: "" });
    expect(r.animateurId).toBeUndefined();
    expect(r.animateurSecondId).toBeUndefined();
  });
  it("refuse le second égal au premier", () => {
    const r = atelierSchema.safeParse({ ...base, animateurId: "u-a", animateurSecondId: "u-a" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["animateurSecondId"]);
  });
  it("refuse un second sans premier", () => {
    const r = atelierSchema.safeParse({ ...base, animateurId: "", animateurSecondId: "u-b" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["animateurSecondId"]);
  });
  it("accepte deux personnes distinctes", () => {
    expect(atelierSchema.safeParse({ ...base, animateurId: "u-a", animateurSecondId: "u-b" }).success).toBe(true);
  });
});

describe("proposer un atelier : qui anime", () => {
  it("sans choix, la personne qui propose anime, sans second", async () => {
    await expect(proposerAtelier({}, formulaire({}))).rejects.toThrow("REDIRECTION:/ateliers?propose=ok");
    expect(faux.crees[0]).toMatchObject({ proposeParId: "u-membre", animateurId: "u-membre", animateurSecondId: null });
  });
  it("un membre peut faire animer un instructeur et un administrateur", async () => {
    await expect(proposerAtelier({}, formulaire({ animateurId: "u-instr", animateurSecondId: "u-admin" }))).rejects.toThrow("REDIRECTION");
    expect(faux.crees[0]).toMatchObject({ proposeParId: "u-membre", animateurId: "u-instr", animateurSecondId: "u-admin" });
  });
  it("refuse un compte désactivé ou le compte de service", async () => {
    const r1 = await proposerAtelier({}, formulaire({ animateurId: "u-parti" }));
    expect(r1.erreurs?.animateurId).toBeTruthy();
    const r2 = await proposerAtelier({}, formulaire({ animateurId: "u-instr", animateurSecondId: "u-portail" }));
    expect(r2.erreurs?.animateurSecondId).toBeTruthy();
    const r3 = await proposerAtelier({}, formulaire({ animateurId: "inconnu" }));
    expect(r3.erreurs?.animateurId).toBeTruthy();
    expect(faux.crees).toEqual([]);
  });
  it("refuse second = animateur, et second sans animateur", async () => {
    const r1 = await proposerAtelier({}, formulaire({ animateurId: "u-instr", animateurSecondId: "u-instr" }));
    expect(r1.erreurs?.animateurSecondId).toBeTruthy();
    const r2 = await proposerAtelier({}, formulaire({ animateurSecondId: "u-instr" }));
    expect(r2.erreurs?.animateurSecondId).toBeTruthy();
    expect(faux.crees).toEqual([]);
  });
});

describe("modifier sa proposition : qui anime", () => {
  it("change les animateurs", async () => {
    const r = await modifierAtelier("at-1", {}, formulaire({ animateurId: "u-instr", animateurSecondId: "" }));
    expect(r.succes).toBeTruthy();
    expect(faux.modifies[0]).toMatchObject({ animateurId: "u-instr", animateurSecondId: null });
  });
  it("garde un animateur déjà enregistré même désactivé depuis", async () => {
    const r = await modifierAtelier("at-1", {}, formulaire({ animateurId: "u-membre", animateurSecondId: "u-parti" }));
    expect(r.succes).toBeTruthy();
    expect(faux.modifies[0]).toMatchObject({ animateurId: "u-membre", animateurSecondId: "u-parti" });
  });
  it("mais n'en ajoute pas un autre désactivé, ni le compte de service", async () => {
    faux.ateliers[0].animateurSecondId = null;
    const r1 = await modifierAtelier("at-1", {}, formulaire({ animateurId: "u-parti" }));
    expect(r1.erreurs?.animateurId).toBeTruthy();
    const r2 = await modifierAtelier("at-1", {}, formulaire({ animateurId: "u-portail" }));
    expect(r2.erreurs?.animateurId).toBeTruthy();
    expect(faux.modifies).toEqual([]);
  });
  it("refuse second = animateur", async () => {
    const r = await modifierAtelier("at-1", {}, formulaire({ animateurId: "u-instr", animateurSecondId: "u-instr" }));
    expect(r.erreurs?.animateurSecondId).toBeTruthy();
    expect(faux.modifies).toEqual([]);
  });
});

describe("libelleAnimation", () => {
  const a = { prenom: "Bravo", nom: "02" };
  const b = { prenom: "Golf", nom: "09" };
  it("« Animé par X (avec Y) »", () => {
    expect(libelleAnimation(a, null)).toBe("Animé par Bravo 02");
    expect(libelleAnimation(a, b)).toBe("Animé par Bravo 02 (avec Golf 09)");
  });
  it("rien sans animateur ; le second seul si le premier a été effacé", () => {
    expect(libelleAnimation(null, null)).toBeNull();
    expect(libelleAnimation(null, b)).toBe("Animé par Golf 09");
  });
});
