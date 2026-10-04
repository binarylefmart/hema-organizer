import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { genererSeances } from "@/lib/periodes";

/**
 * **Les dates écartées à la génération sont mémorisées.**
 *
 * L'écran « Reste à créer » propose, cochées, toutes les dates que les créneaux donnent et que la
 * période n'a pas encore. On y décoche les vacances et les jours fériés — et, la visite suivante,
 * elles revenaient cochées : le paramètre `exclusions` de `genererSeances` n'était appelé par
 * personne (`[]` des deux côtés), et rien ne gardait trace du geste. Il fallait redécocher, et
 * surtout se souvenir desquelles.
 *
 * Décision de Delta : **en base** (`PeriodDateExclue`). Une date écartée l'est pour la période, à
 * la génération comme à la régénération, jusqu'à ce qu'on la repropose explicitement.
 */

const CRENEAUX = [
  { jourSemaine: 2, heureDebut: "18:00", heureFin: "19:30", lieu: "Villebourg", adresse: "" },
  { jourSemaine: 2, heureDebut: "20:00", heureFin: "22:00", lieu: "Villebourg", adresse: "" },
];

describe("genererSeances : une exclusion par journée ou par créneau", () => {
  it("écarte toute la journée quand la clé est une date seule", () => {
    const s = genererSeances("2026-10-05", "2026-10-18", CRENEAUX, ["2026-10-13"]);
    expect(s.map((x) => `${x.date} ${x.heureDebut}`)).toEqual(["2026-10-06 18:00", "2026-10-06 20:00"]);
  });

  /**
   * Un club à deux cours le même soir doit pouvoir n'en écarter qu'un : c'est exactement ce que
   * les cases de l'écran permettent, une par créneau. La clé fine (« date heure ») est la même que
   * celle des cases et que celle des séances déjà créées — une seule forme dans tout le code.
   */
  it("n'écarte qu'un seul créneau quand la clé porte l'heure", () => {
    const s = genererSeances("2026-10-05", "2026-10-18", CRENEAUX, ["2026-10-13 18:00"]);
    expect(s.map((x) => `${x.date} ${x.heureDebut}`)).toEqual(["2026-10-06 18:00", "2026-10-06 20:00", "2026-10-13 20:00"]);
  });

  it("cumule exclusions et séances déjà créées sans jamais proposer deux fois la même", () => {
    const s = genererSeances("2026-10-05", "2026-10-18", CRENEAUX, ["2026-10-06"], ["2026-10-13 18:00"]);
    expect(s.map((x) => `${x.date} ${x.heureDebut}`)).toEqual(["2026-10-13 20:00"]);
  });
});

/* ------------------------------------------------------------------ */
/* L'action : ce qu'elle lit, ce qu'elle crée, ce qu'elle mémorise      */
/* ------------------------------------------------------------------ */

const faux = vi.hoisted(() => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `periods.manage` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true } as { id: string; email: string; role: string; estAdmin: boolean; actif: boolean },
  periode: {} as Record<string, unknown>,
  /** Ce que la période porte déjà comme dates écartées. */
  exclues: [] as Array<{ cle: string }>,
  creees: [] as Array<{ date: string; heureDebut: string }>,
  memorisees: [] as unknown[],
  exclusionsEffacees: [] as unknown[],
  audits: [] as { action: string; cible: string | null; details: unknown }[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    period: {
      findUniqueOrThrow: vi.fn(async () => ({ ...faux.periode, datesExclues: faux.exclues })),
      update: vi.fn(async () => ({})),
    },
    session: {
      create: vi.fn(async ({ data }: { data: { date: string; heureDebut: string } }) => {
        faux.creees.push({ date: data.date, heureDebut: data.heureDebut });
        return { id: `s-${faux.creees.length}` };
      }),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    periodDateExclue: {
      createMany: vi.fn(async ({ data }: { data: unknown }) => {
        faux.memorisees.push(data);
        return { count: Array.isArray(data) ? data.length : 0 };
      }),
      deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
        faux.exclusionsEffacees.push(where);
        return { count: faux.exclues.length };
      }),
    },
    attendance: { count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    atelier: { updateMany: vi.fn(async () => ({ count: 0 })) },
    invitation: { updateMany: vi.fn(async () => ({ count: 0 })) },
    periodMember: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/invitations", () => ({
  envoyerInvitation: vi.fn(async () => true),
  revokeInvitation: vi.fn(async () => {}),
  ERREUR_COMPTE_SERVICE: "compte de service",
  LIENS_AVANT_DEBUT_JOURS: 3,
}));

vi.mock("@/lib/auth/current-user", async () => {
  const { can: vraiCan } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof vraiCan>[1]) => {
      if (!vraiCan(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async () => {}),
    getCurrentUser: vi.fn(async () => null),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { genererSeancesPeriode, reproposerDatesExclues } = await import("@/actions/periodes");

/** Le formulaire de l'écran : une entrée `dates` par case restée cochée. */
function cochees(...cles: string[]): FormData {
  const fd = new FormData();
  for (const c of cles) fd.append("dates", c);
  return fd;
}

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  // Deux mardis, un seul créneau : le 6 et
  faux.periode = { id: "p-1", dateDebut: "2026-10-05", dateFin: "2026-10-18", creneaux: [CRENEAUX[1]], instructeurs: [], sessions: [] };
  faux.exclues = [];
  faux.creees = [];
  faux.memorisees = [];
  faux.exclusionsEffacees = [];
  faux.audits = [];
});

describe("génération : ce qui est décoché est mémorisé", () => {
  it("crée les dates cochées et retient les autres comme écartées", async () => {
    const etat = await genererSeancesPeriode("p-1", { }, cochees("2026-10-06 20:00"));
    expect(etat.succes).toBeDefined();
    expect(faux.creees).toEqual([{ date: "2026-10-06", heureDebut: "20:00" }]);
    // Le 13 était proposé et a été décoché : c'est une vacance, elle se retient.
    expect(faux.memorisees).toEqual([[{ periodId: "p-1", cle: "2026-10-13 20:00" }]]);
  });

  it("ne repropose plus une date déjà écartée, même si on regénère", async () => {
    faux.exclues = [{ cle: "2026-10-13 20:00" }];
    await genererSeancesPeriode("p-1", {}, cochees("2026-10-06 20:00"));
    expect(faux.creees).toEqual([{ date: "2026-10-06", heureDebut: "20:00" }]);
    // Rien de neuf à retenir : la seule candidate restante a été cochée.
    expect(faux.memorisees).toEqual([]);
  });

  /**
   * Le cas qui faisait revenir les vacances : on coche une date qui a été écartée. Elle n'est plus
   * proposée par l'écran, donc elle ne doit pas non plus être créée par l'action — la garde est ici,
   * pas dans le navigateur.
   */
  it("refuse de créer une date écartée, même si la requête la réclame", async () => {
    faux.exclues = [{ cle: "2026-10-13 20:00" }];
    const etat = await genererSeancesPeriode("p-1", {}, cochees("2026-10-13 20:00"));
    expect(faux.creees).toEqual([]);
    expect(etat.succes).toContain("existaient déjà");
  });

  it("journalise les dates écartées avec les séances créées", async () => {
    await genererSeancesPeriode("p-1", {}, cochees("2026-10-06 20:00"));
    expect(faux.audits).toEqual([{ action: "periode.seances_generees", cible: "p-1", details: { nombre: 1, ecartees: ["2026-10-13 20:00"] } }]);
  });
});

describe("reproposer les dates écartées", () => {
  it("efface les exclusions de la période et les rend aux propositions", async () => {
    faux.exclues = [{ cle: "2026-10-13 20:00" }];
    const etat = await reproposerDatesExclues("p-1");
    expect(faux.exclusionsEffacees).toEqual([{ periodId: "p-1" }]);
    expect(etat.succes).toBeDefined();
    expect(faux.audits).toEqual([{ action: "periode.dates_reproposees", cible: "p-1", details: { nombre: 1 } }]);
  });

  it("reste réservé au bureau", async () => {
    faux.acteur = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    await expect(reproposerDatesExclues("p-1")).rejects.toThrow("Accès refusé");
    expect(faux.exclusionsEffacees).toEqual([]);
  });
});

/**
 * **Ce que l'écran en dit, avant le clic.** L'action mémorise les dates décochées ; l'encart
 * « Reste à créer », lui, disait seulement « Décoche les vacances et jours fériés » et « Créer N
 * séances ». Un administrateur qui ne crée que le premier mois — geste banal quand la salle n'est
 * pas confirmée — écartait sans le savoir les 22 dates suivantes, et ne l'apprenait qu'à la visite
 * d'après. Le décompte des décochées est donc annoncé **avant** le bouton, et jusque dans son
 * libellé, avec la porte de sortie (« Reproposer »).
 */
describe("l'écran annonce ce que décocher emporte", () => {
  const source = readFileSync("src/app/(app)/admin/periodes/[id]/SelectionDates.tsx", "utf-8");

  it("compte les dates décochées", () => {
    expect(source).toContain("const decochees = candidates.length - cochees.size;");
  });

  it("le dit avant le bouton, et nomme la porte de sortie", () => {
    expect(source).toContain("ne seront plus proposées");
    expect(source).toContain("« Reproposer »");
    // L'avertissement précède le bouton d'envoi : c'est là que la décision se prend.
    expect(source.indexOf("ne seront plus proposées")).toBeLessThan(source.indexOf("<BoutonEnvoi enCours=\"Création…\""));
  });

  it("met le décompte des écartées dans le libellé du bouton", () => {
    expect(source).toContain("et écarter ${decochees} date");
  });
});
