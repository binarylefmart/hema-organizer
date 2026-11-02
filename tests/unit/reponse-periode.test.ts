import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmationReponse, planReponse, succesReponse } from "@/components/seances/reponse-periode";

/**
 * **« Répondre pour toutes les séances à venir »** : le tri (séances ouvertes seulement, réponses
 * gardées ou remplacées), les phrases, puis l'action serveur et ses verrous.
 */

const s = (id: string, monStatut: string | null, x: { annulee?: boolean; commencee?: boolean } = {}) => ({ id, monStatut, annulee: false, commencee: false, ...x });
const lot = [s("a", null), s("b", "ABSENT"), s("c", "PRESENT"), s("d", null, { annulee: true }), s("e", null, { commencee: true })];

describe("planReponse", () => {
  it("garde les réponses déjà données par défaut, et ignore annulées et commencées", () => {
    expect(planReponse(lot, "PRESENT", true)).toEqual({ aEcrire: ["a"], gardees: 1, remplacees: 0, deja: 1 });
  });
  it("remplace les réponses différentes quand la case est décochée", () => {
    expect(planReponse(lot, "PRESENT", false)).toEqual({ aEcrire: ["a", "b"], gardees: 0, remplacees: 1, deja: 1 });
  });
  it("annonce les chiffres avant et après", () => {
    const plan = planReponse(lot, "PRESENT", false);
    expect(confirmationReponse("PRESENT", plan)).toBe("Répondre « Présent » pour 2 séances ? 1 réponse déjà donnée sera remplacée. 1 séance porte déjà cette réponse.");
    expect(succesReponse("PRESENT", plan)).toBe("C'est noté : Présent pour 2 séances. 1 réponse déjà donnée a été remplacée. 1 séance porte déjà cette réponse.");
    expect(succesReponse("ABSENT", planReponse([s("b", "ABSENT")], "ABSENT", true))).toBe("Rien à changer. 1 séance porte déjà cette réponse.");
  });
});

const faux = vi.hoisted(() => ({
  user: { id: "u1", role: "MEMBRE", estAdmin: false, actif: true } as Record<string, unknown> | null,
  periode: { statut: "ACTIVE", membres: [{ userId: "u1" }] } as { statut: string; membres: unknown[] } | null,
  seances: [] as Array<{ id: string; date: string; heureDebut: string; annulee: boolean; attendances: Array<{ statut: string }> }>,
  ecrites: [] as Array<{ sessionId: string; statut: string }>,
  desistements: [] as Array<{ sessionId: string; avant: string | null }>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    period: { findUnique: vi.fn(async () => faux.periode) },
    session: { findMany: vi.fn(async () => faux.seances) },
    attendance: {
      upsert: vi.fn(async ({ create }: { create: { sessionId: string; statut: string } }) => {
        faux.ecrites.push({ sessionId: create.sessionId, statut: create.statut });
        return {};
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => faux.user), assertPermission: vi.fn(), AccesRefuse: class extends Error {} }));
vi.mock("@/lib/auth/session", () => ({ touchSession: vi.fn() }));
vi.mock("@/lib/auth/elevation", () => ({ toucherElevation: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/notifications/desistement", () => ({
  signalerDesistementTardif: vi.fn(async (x: { sessionId: string; avant: string | null }) => {
    faux.desistements.push({ sessionId: x.sessionId, avant: x.avant });
    return 0;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { repondrePourLaPeriode } = await import("@/actions/presences");

beforeEach(() => {
  faux.user = { id: "u1", role: "MEMBRE", estAdmin: false, actif: true };
  faux.periode = { statut: "ACTIVE", membres: [{ userId: "u1" }] };
  faux.seances = [
    { id: "s1", date: "2099-10-06", heureDebut: "19:30", annulee: false, attendances: [] },
    { id: "s2", date: "2099-10-13", heureDebut: "19:30", annulee: false, attendances: [{ statut: "PRESENT" }] },
    { id: "s3", date: "2099-10-20", heureDebut: "19:30", annulee: true, attendances: [] },
    { id: "s4", date: "2000-01-04", heureDebut: "19:30", annulee: false, attendances: [] },
  ];
  faux.ecrites = [];
  faux.desistements = [];
});

describe("repondrePourLaPeriode", () => {
  it("écrit seulement les séances à venir sans réponse, case cochée", async () => {
    const res = await repondrePourLaPeriode({ periodId: "p1", statut: "ABSENT", garderReponses: true });
    expect(faux.ecrites).toEqual([{ sessionId: "s1", statut: "ABSENT" }]);
    expect(res.succes).toBe("C'est noté : Absent pour 1 séance. 1 réponse déjà donnée est gardée.");
    expect(faux.desistements).toEqual([]);
  });
  it("remplace les réponses déjà données, case décochée, et passe chaque remplacement au désistement tardif", async () => {
    await repondrePourLaPeriode({ periodId: "p1", statut: "ABSENT", garderReponses: false });
    expect(faux.ecrites.map((e) => e.sessionId)).toEqual(["s1", "s2"]);
    expect(faux.desistements).toEqual([{ sessionId: "s2", avant: "PRESENT" }]);
  });
  it("refuse une période non active ou où l'on n'est pas invité", async () => {
    faux.periode = { statut: "BROUILLON", membres: [{ userId: "u1" }] };
    expect((await repondrePourLaPeriode({ periodId: "p1", statut: "PRESENT", garderReponses: true })).erreur).toBe("Cette période n'est pas disponible.");
    faux.periode = { statut: "ACTIVE", membres: [] };
    expect((await repondrePourLaPeriode({ periodId: "p1", statut: "PRESENT", garderReponses: true })).erreur).toBe("Cette période n'est pas disponible.");
    expect(faux.ecrites).toEqual([]);
  });
  it("refuse sans session et une réponse inconnue", async () => {
    expect((await repondrePourLaPeriode({ periodId: "p1", statut: "OUI", garderReponses: true })).erreur).toBe("Réponse non reconnue.");
    faux.user = null;
    expect((await repondrePourLaPeriode({ periodId: "p1", statut: "PRESENT", garderReponses: true })).erreur).toContain("session a expiré");
  });
});
