import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmationReponse, coursProposes, partiesAChoisir, planReponse, seancesPresentesApres, succesReponse } from "@/components/seances/reponse-periode";

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
  it("se limite aux dates choisies, sans jamais rouvrir une séance annulée ou commencée", () => {
    expect(planReponse(lot, "PRESENT", false, new Set(["b", "c", "d", "e"]))).toEqual({ aEcrire: ["b"], gardees: 0, remplacees: 1, deja: 1 });
    expect(planReponse(lot, "PRESENT", true, new Set(["a"]))).toEqual({ aEcrire: ["a"], gardees: 0, remplacees: 0, deja: 0 });
  });
  it("annonce les chiffres avant et après", () => {
    const plan = planReponse(lot, "PRESENT", false);
    expect(confirmationReponse("PRESENT", plan)).toBe("Répondre « Présent » pour 2 séances ? 1 réponse déjà donnée sera remplacée. 1 séance porte déjà cette réponse.");
    expect(succesReponse("PRESENT", plan)).toBe("C'est noté : Présent pour 2 séances. 1 réponse déjà donnée a été remplacée. 1 séance porte déjà cette réponse.");
    expect(succesReponse("ABSENT", planReponse([s("b", "ABSENT")], "ABSENT", true))).toBe("Rien à changer. 1 séance porte déjà cette réponse.");
  });
});

describe("choix des cours dans la réponse groupée", () => {
  const avecCours = [
    { ...s("a", null), cours: [{ partieId: "a1", nom: "Épée longue", choisi: false }, { partieId: "a2", nom: "Messer", choisi: false }] },
    { ...s("b", "ABSENT"), cours: [{ partieId: "b1", nom: "épée longue ", choisi: false }] },
    { ...s("c", "PRESENT"), cours: [{ partieId: "c1", nom: "Épée longue", choisi: true }, { partieId: "c2", nom: "Dague", choisi: false }] },
    { ...s("d", null, { annulee: true }), cours: [{ partieId: "d1", nom: "Épée longue", choisi: false }] },
  ];
  it("ne vise que les séances qui seront « Présent » après le geste", () => {
    expect(seancesPresentesApres(avecCours, "PRESENT", true)).toEqual(["a", "c"]);
    expect(seancesPresentesApres(avecCours, "PRESENT", false)).toEqual(["a", "b", "c"]);
    expect(seancesPresentesApres(avecCours, "PRESENT", false, new Set(["b"]))).toEqual(["b"]);
    expect(seancesPresentesApres(avecCours, "PEUT_ETRE", false)).toEqual([]);
  });
  it("propose chaque nom une fois, sans tenir compte de la casse", () => {
    expect(coursProposes(avecCours, ["a", "b", "c"])).toEqual([
      { cle: "épée longue", nom: "Épée longue", seances: 3 },
      { cle: "dague", nom: "Dague", seances: 1 },
      { cle: "messer", nom: "Messer", seances: 1 },
    ]);
  });
  it("coche les éléments du nom retenu sans reprendre ceux déjà choisis", () => {
    expect(partiesAChoisir(avecCours, ["a", "b", "c"], new Set(["épée longue"]))).toEqual(["a1", "b1"]);
    expect(partiesAChoisir(avecCours, ["a", "c"], new Set())).toEqual([]);
  });
});

const faux = vi.hoisted(() => ({
  user: { id: "u1", role: "MEMBRE", estAdmin: false, actif: true } as Record<string, unknown> | null,
  periode: { statut: "ACTIVE", membres: [{ userId: "u1" }] } as { statut: string; membres: unknown[] } | null,
  seances: [] as Array<{ id: string; date: string; heureDebut: string; annulee: boolean; attendances: Array<{ statut: string }> }>,
  ecrites: [] as Array<{ sessionId: string; statut: string }>,
  desistements: [] as Array<{ sessionId: string; avant: string | null }>,
  choixActif: true,
  parties: [] as Array<{ id: string; sessionId: string; nature: string; choix: unknown[] }>,
  choixEcrits: [] as string[],
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
    sessionPartie: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; sessionId: { in: string[] } } }) =>
        faux.parties.filter((p) => where.id.in.includes(p.id) && where.sessionId.in.includes(p.sessionId)),
      ),
    },
    attendanceChoix: {
      upsert: vi.fn(async ({ create }: { create: { partieId: string } }) => {
        faux.choixEcrits.push(create.partieId);
        return {};
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
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
vi.mock("@/lib/settings", () => ({ getChoixCoursActif: vi.fn(async () => faux.choixActif) }));

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
  faux.choixActif = true;
  faux.parties = [
    { id: "p1", sessionId: "s1", nature: "COURS", choix: [] },
    { id: "p2", sessionId: "s2", nature: "OPTION", choix: [] },
    { id: "p3", sessionId: "s2", nature: "ECHAUFFEMENT", choix: [] },
    { id: "p4", sessionId: "s3", nature: "COURS", choix: [] },
    { id: "p5", sessionId: "s2", nature: "COURS", choix: [{ userId: "u1" }] },
  ];
  faux.choixEcrits = [];
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
  it("répond sur les dates choisies seulement, et ignore une séance hors période, annulée ou passée", async () => {
    const res = await repondrePourLaPeriode({ periodId: "p1", statut: "ABSENT", garderReponses: false, seanceIds: ["s2", "s3", "s4", "inconnue"] });
    expect(faux.ecrites).toEqual([{ sessionId: "s2", statut: "ABSENT" }]);
    expect(res.succes).toBe("C'est noté : Absent pour 1 séance. 1 réponse déjà donnée a été remplacée.");
  });
  it("coche les cours demandés sur les séances « Présent », jamais l'échauffement ni une séance annulée", async () => {
    const res = await repondrePourLaPeriode({ periodId: "p1", statut: "PRESENT", garderReponses: true, partieIds: ["p1", "p2", "p3", "p4", "p5"] });
    expect(faux.ecrites).toEqual([{ sessionId: "s1", statut: "PRESENT" }]);
    expect(faux.choixEcrits).toEqual(["p1", "p2"]);
    expect(res.succes).toBe("C'est noté : Présent pour 1 séance. 1 séance porte déjà cette réponse. 2 cours ajoutés à tes choix.");
  });
  it("ajoute des cours même quand aucune réponse ne change", async () => {
    const res = await repondrePourLaPeriode({ periodId: "p1", statut: "PRESENT", garderReponses: true, seanceIds: ["s2"], partieIds: ["p2"] });
    expect(faux.ecrites).toEqual([]);
    expect(faux.choixEcrits).toEqual(["p2"]);
    expect(res.succes).toBe("C'est noté : 1 cours ajouté à tes choix.");
  });
  it("ne coche aucun cours quand le club n'a pas ouvert le choix, ou pour une autre réponse que « Présent »", async () => {
    faux.choixActif = false;
    await repondrePourLaPeriode({ periodId: "p1", statut: "PRESENT", garderReponses: true, partieIds: ["p1"] });
    faux.choixActif = true;
    await repondrePourLaPeriode({ periodId: "p1", statut: "PEUT_ETRE", garderReponses: true, partieIds: ["p1"] });
    expect(faux.choixEcrits).toEqual([]);
  });
  it("refuse une liste de dates vide", async () => {
    expect((await repondrePourLaPeriode({ periodId: "p1", statut: "ABSENT", garderReponses: true, seanceIds: [] })).erreur).toBe("Réponse non reconnue.");
    expect(faux.ecrites).toEqual([]);
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
