import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Le lien « annuler cette séance » du mail d'effectif faible.**
 *
 * C'est le seul geste de l'application qui écrit sans session : il annule un cours, prévient tous
 * les invités par email et l'annonce sur le salon. On vérifie donc ce qui remplace l'authentification :
 * le jeton est **nominatif** (il porte le compte du destinataire), le porteur est revérifié au clic
 * (actif, toujours habilité), l'audit retient **qui** a annulé, un limiteur borne le geste, et une
 * séance déjà annulée ne se rejoue pas.
 */

const faux = vi.hoisted(() => ({
  membres: [] as Array<{ id: string; email: string | null; role: string; actif: boolean }>,
  seances: [] as Array<{ id: string; annulee: boolean; date: string; heureDebut: string; period: { statut: string } }>,
  ecritures: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  notifiees: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.membres.find((m) => m.id === where.id) ?? null) },
    session: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.seances.find((s) => s.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        faux.ecritures.push({ table: "session", id: where.id, data });
        const s = faux.seances.find((x) => x.id === where.id);
        if (s) Object.assign(s, data);
        return s;
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => faux.audits.push(data)) },
  },
}));

vi.mock("@/lib/request-info", () => ({ clientIp: vi.fn(async () => "10.0.0.1") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(() => {}) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));
// L'envoi lui-même est testé ailleurs : ici, seul compte le fait qu'il parte (ou non)
vi.mock("@/lib/notifications/seances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/seances")>()),
  notifierAnnulation: vi.fn(async (sessionId: string) => {
    faux.notifiees.push(sessionId);
    return 3;
  }),
}));

const { porteurJetonAnnulation, urlAnnulation } = await import("@/lib/notifications/seances");
const { annulerDepuisEmail } = await import("@/actions/seances");
const { utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");

const INSTRUCTEUR = { id: "u-charlie", email: "charlie@exemple.fr", role: "INSTRUCTEUR", actif: true };
const jetonPour = (sessionId: string, userId: string) => urlAnnulation(sessionId, userId).split("/annuler/")[1];
const motif = (texte = "Trop peu de participants") => {
  const fd = new FormData();
  fd.set("motif", texte);
  return fd;
};
const redirection = async (promesse: Promise<unknown>): Promise<string> => {
  try {
    await promesse;
  } catch (e) {
    return (e as { url: string }).url;
  }
  throw new Error("aucune redirection");
};

beforeEach(() => {
  utiliserMagasinMemoire();
  faux.membres = [INSTRUCTEUR, { id: "u-parti", email: "parti@exemple.fr", role: "INSTRUCTEUR", actif: false }, { id: "u-membre", email: "chloe@exemple.fr", role: "MEMBRE", actif: true }];
  faux.seances = [{ id: "s-1", annulee: false, date: "2099-09-25", heureDebut: "19:30", period: { statut: "ACTIVE" } }];
  faux.ecritures = [];
  faux.audits = [];
  faux.notifiees = [];
});

describe("porteur du lien d'annulation", () => {
  it("reconnaît le destinataire du mail : un instructeur en exercice", async () => {
    expect(await porteurJetonAnnulation(jetonPour("s-1", "u-charlie"))).toEqual({ sessionId: "s-1", acteur: { id: "u-charlie", email: "charlie@exemple.fr" } });
  });

  it("refuse un compte désactivé, un compte sans `sessions.manage`, un compte inconnu", async () => {
    expect(await porteurJetonAnnulation(jetonPour("s-1", "u-parti"))).toBeNull();
    expect(await porteurJetonAnnulation(jetonPour("s-1", "u-membre"))).toBeNull();
    expect(await porteurJetonAnnulation(jetonPour("s-1", "u-inconnu"))).toBeNull();
  });

  /**
   * **Un trimestre clos ne porte plus de lien valable**. Le lien vaut une semaine, il est envoyé à
   * J-3, et une période close **peut** porter des séances à venir — on clôt un trimestre sans
   * attendre son dernier cours. Un vieil email pouvait donc annuler un cours d'un trimestre
   * terminé, ce qui prévient tous ses invités par email et annonce l'annulation sur Discord et
   * Telegram. Le refus est posé sur le porteur du jeton, et pas seulement dans l'action : la page
   * de confirmation passe par la même fonction, elle ne doit donc pas proposer un bouton qui
   * refuserait.
   */
  it("refuse un lien dont le trimestre est clos, et une séance disparue", async () => {
    faux.seances[0].period.statut = "CLOSE";
    expect(await porteurJetonAnnulation(jetonPour("s-1", "u-charlie"))).toBeNull();
    faux.seances = [];
    expect(await porteurJetonAnnulation(jetonPour("s-1", "u-charlie"))).toBeNull();
  });

  /**
   * **Un cours commencé ne s'annule plus par ce lien**.
   *
   * Le lien vaut une semaine et ne vérifiait que le statut de la période. L'écran, lui, masque déjà
   * « Annuler » sur une séance passée — « on ne prévient pas les gens d'une annulation pendant qu'ils
   * sont dans la salle ». Le chemin par email ignorait la règle : un clic le mardi annulait le stage du
   * samedi et envoyait « ❌ Cours annulé — samedi 3 octobre » à tous les invités.
   *
   * Le lien peut parfaitement arriver après le cours : l'alerte « peu de monde » part jusqu'au jour même.
   */
  it("refuse un lien dont le cours a déjà commencé", async () => {
    faux.seances[0].date = "2020-09-25";
    expect(await porteurJetonAnnulation(jetonPour("s-1", "u-charlie"))).toBeNull();
    // Le jour même, avant l'heure : le lien vaut encore, c'est tout son objet.
    const aujourdHui = new Date().toISOString().slice(0, 10);
    faux.seances[0].date = aujourdHui;
    faux.seances[0].heureDebut = "23:59";
    expect(await porteurJetonAnnulation(jetonPour("s-1", "u-charlie"))).not.toBeNull();
  });

  it("refuse un jeton trafiqué ou vide", async () => {
    expect(await porteurJetonAnnulation(`${jetonPour("s-1", "u-charlie")}x`)).toBeNull();
    expect(await porteurJetonAnnulation("")).toBeNull();
  });
});

describe("annulation depuis le lien du mail", () => {
  it("annule, prévient, et journalise le porteur du jeton comme acteur", async () => {
    const jeton = jetonPour("s-1", "u-charlie");
    expect(await redirection(annulerDepuisEmail(jeton, motif("Salle indisponible")))).toBe(`/annuler/${jeton}?fait=ok`);
    expect(faux.ecritures).toEqual([{ table: "session", id: "s-1", data: { annulee: true, motifAnnulation: "Salle indisponible", annulationLienUtiliseLe: expect.any(Date) } }]);
    expect(faux.notifiees).toEqual(["s-1"]);
    // Le journal disait « anonyme » : c'était tout le problème
    expect(faux.audits).toEqual([
      expect.objectContaining({ acteurId: "u-charlie", acteurEmail: "charlie@exemple.fr", action: "seance.annulee", cible: "s-1" }),
    ]);
  });

  it("n'écrit rien et ne prévient personne sur un trimestre clos", async () => {
    faux.seances[0].period.statut = "CLOSE";
    expect(await redirection(annulerDepuisEmail(jetonPour("s-1", "u-charlie"), motif()))).toBe("/connexion?erreur=session");
    expect(faux.ecritures).toEqual([]);
    expect(faux.notifiees).toEqual([]);
    expect(faux.seances[0].annulee).toBe(false);
  });

  it("n'écrit rien et ne prévient personne pour un compte désactivé ou sans droit d'annuler", async () => {
    for (const userId of ["u-parti", "u-membre", "u-inconnu"]) {
      expect(await redirection(annulerDepuisEmail(jetonPour("s-1", userId), motif()))).toBe("/connexion?erreur=session");
    }
    expect(faux.ecritures).toEqual([]);
    expect(faux.notifiees).toEqual([]);
    expect(faux.audits).toEqual([]);
    expect(faux.seances[0].annulee).toBe(false);
  });

  it("ne se rejoue pas sur une séance déjà annulée : aucune écriture, aucun second envoi", async () => {
    faux.seances[0].annulee = true;
    const jeton = jetonPour("s-1", "u-charlie");
    expect(await redirection(annulerDepuisEmail(jeton, motif()))).toBe(`/annuler/${jeton}?fait=ok`);
    expect(faux.ecritures).toEqual([]);
    expect(faux.notifiees).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("ne sert qu'une fois : le lien d'une séance rétablie entre-temps ne la réannule pas", async () => {
    const jeton = jetonPour("s-1", "u-charlie");
    await redirection(annulerDepuisEmail(jeton, motif()));
    // Un membre de l'encadrement rétablit la séance depuis l'application : `retablirSeance` remet
    // `annulee` à faux **et** efface la date d'usage. Ici on simule l'oubli de cette remise à zéro —
    // c'est le cas que le lien à usage unique doit couvrir : la séance est debout, le vieil email
    // traîne toujours dans une boîte, il ne doit plus rien pouvoir.
    faux.seances[0].annulee = false;
    faux.ecritures = [];
    faux.notifiees = [];
    faux.audits = [];

    expect(await redirection(annulerDepuisEmail(jeton, motif()))).toBe(`/annuler/${jeton}?erreur=deja`);
    expect(faux.ecritures).toEqual([]);
    expect(faux.notifiees).toEqual([]);
    expect(faux.audits).toEqual([]);
    expect(faux.seances[0].annulee).toBe(false);
  });

  it("borne les annulations d'un même porteur (5 par heure)", async () => {
    for (let i = 0; i < 5; i++) {
      faux.seances = [{ id: "s-1", annulee: false, date: "2099-09-25", heureDebut: "19:30", period: { statut: "ACTIVE" } }];
      await redirection(annulerDepuisEmail(jetonPour("s-1", "u-charlie"), motif()));
    }
    faux.seances = [{ id: "s-1", annulee: false, date: "2099-09-25", heureDebut: "19:30", period: { statut: "ACTIVE" } }];
    const jeton = jetonPour("s-1", "u-charlie");
    expect(await redirection(annulerDepuisEmail(jeton, motif()))).toBe(`/annuler/${jeton}?erreur=trop`);
    expect(faux.notifiees).toHaveLength(5);
  });
});
