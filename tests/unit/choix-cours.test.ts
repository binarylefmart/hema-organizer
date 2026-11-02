import { beforeEach, describe, expect, it, vi } from "vitest";
import { choixDeLaSeance, compteApres, libelleCompte, libelleMois, natureChoisissable, nomOption, statsChoix } from "@/components/seances/choix-cours";

/**
 * **Le choix des cours par présence** (retours du club d'Arras) : ce qui se choisit, ce qui compte,
 * les statistiques, l'action et ses verrous, et l'effacement après « Absent ».
 */

describe("ce qui se choisit", () => {
  it("cours, options et ateliers — jamais l'échauffement", () => {
    expect(["COURS", "OPTION", "ATELIER"].every(natureChoisissable)).toBe(true);
    expect(natureChoisissable("ECHAUFFEMENT")).toBe(false);
  });
  it("se nomme par son thème, puis par l'atelier, puis par sa place", () => {
    expect(nomOption({ libelle: "Cours 1", theme: "Épée longue" })).toBe("Épée longue");
    expect(nomOption({ libelle: "Atelier", theme: "", atelier: { titre: "Jeu de la hache" } })).toBe("Jeu de la hache");
    expect(nomOption({ libelle: "Option", theme: " " })).toBe("Option");
  });
});

describe("choixDeLaSeance", () => {
  const parties = [
    { id: "e", nature: "ECHAUFFEMENT", libelle: "Échauffement", theme: "Mobilité", choix: [{ userId: "u1" }] },
    { id: "c", nature: "COURS", libelle: "Cours", theme: "Épée longue", choix: [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }] },
    { id: "o", nature: "OPTION", libelle: "Option", theme: "", choix: [{ userId: "u2" }] },
    { id: "muet", nature: "OPTION", libelle: "Option 2", theme: "", choix: [] },
  ];
  it("ne propose que les éléments choisissables du programme lisible, et ne compte que les présents", () => {
    const r = choixDeLaSeance(parties, new Set(["e", "c", "o"]), new Set(["u1", "u2"]), "u1");
    expect(r.options).toEqual([
      { partieId: "c", nom: "Épée longue", detail: "Cours", compte: 2 },
      { partieId: "o", nom: "Option", detail: "", compte: 1 },
    ]);
    expect(r.mesChoix).toEqual(["c"]);
  });
});

describe("les compteurs", () => {
  it("suivent le geste avant la réponse du serveur", () => {
    const o = { partieId: "c", nom: "Épée longue", detail: "", compte: 3 };
    expect(compteApres(o, new Set(), new Set(["c"]))).toBe(4);
    expect(compteApres(o, new Set(["c"]), new Set())).toBe(2);
    expect(compteApres({ ...o, compte: 0 }, new Set(["c"]), new Set())).toBe(0);
  });
  it("se disent en mots", () => {
    expect(libelleCompte(0)).toBe("personne pour l'instant");
    expect(libelleCompte(1)).toBe("1 inscrit");
    expect(libelleCompte(5)).toBe("5 inscrits");
  });
});

describe("statsChoix", () => {
  it("compte par cours, par niveau et par mois", () => {
    const lus = [
      { partieId: "a", sessionId: "s1", nom: "Épée longue", niveau: "DEBUTANT", date: "2026-11-03" },
      { partieId: "a", sessionId: "s1", nom: "Épée longue", niveau: "DEBUTANT", date: "2026-11-03" },
      { partieId: "b", sessionId: "s2", nom: "épée longue", niveau: "AVANCE", date: "2026-12-01" },
      { partieId: "c", sessionId: "s2", nom: "Messer", niveau: "INDIFFERENT", date: "2026-12-01" },
    ];
    const st = statsChoix(lus, (n) => n.toLowerCase());
    expect(st.total).toBe(4);
    expect(st.parCours).toEqual([
      { cle: "épée longue", libelle: "Épée longue", choix: 3, seances: 2 },
      { cle: "messer", libelle: "Messer", choix: 1, seances: 1 },
    ]);
    expect(st.parNiveau[0]).toEqual({ cle: "DEBUTANT", libelle: "debutant", choix: 2, seances: 1 });
    expect(st.parMois.map((m) => [m.libelle, m.choix])).toEqual([
      ["novembre 2026", 2],
      ["décembre 2026", 2],
    ]);
    expect(libelleMois("2027-01-15")).toBe("janvier 2027");
  });
});

/* ─────────── L'action et l'effacement ─────────── */

const faux = vi.hoisted(() => ({
  user: { id: "u1", role: "MEMBRE", estAdmin: false, actif: true } as Record<string, unknown> | null,
  actif: true,
  partie: null as Record<string, unknown> | null,
  ecrits: [] as string[],
  effaces: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    sessionPartie: { findUnique: vi.fn(async () => faux.partie) },
    attendanceChoix: {
      upsert: vi.fn(async ({ create }: { create: { partieId: string } }) => {
        faux.ecrits.push(`+${create.partieId}`);
        return {};
      }),
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        if ("partieId" in args.where) faux.ecrits.push(`-${String(args.where.partieId)}`);
        else faux.effaces.push(args.where);
        return { count: 0 };
      }),
    },
    attendance: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    session: { findUnique: vi.fn(async () => ({ id: "s1", date: "2099-01-01", heureDebut: "19:30", annulee: false, period: { statut: "ACTIVE", membres: [{ userId: "u1" }] } })) },
  },
}));
vi.mock("@/lib/settings", () => ({ getChoixCoursActif: vi.fn(async () => faux.actif) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => faux.user), assertPermission: vi.fn(), AccesRefuse: class extends Error {} }));
vi.mock("@/lib/auth/session", () => ({ touchSession: vi.fn() }));
vi.mock("@/lib/auth/elevation", () => ({ toucherElevation: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/notifications/desistement", () => ({ signalerDesistementTardif: vi.fn(async () => 0) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { choisirCours, indiquerPresence } = await import("@/actions/presences");

const partie = (x: { nature?: string; statut?: string | null; annulee?: boolean; date?: string; periode?: string } = {}) => ({
  nature: x.nature ?? "COURS",
  session: {
    id: "s1",
    date: x.date ?? "2099-01-01",
    heureDebut: "19:30",
    annulee: x.annulee ?? false,
    period: { statut: x.periode ?? "ACTIVE", membres: [{ userId: "u1" }] },
    attendances: x.statut === null ? [] : [{ statut: x.statut ?? "PRESENT" }],
  },
});

beforeEach(() => {
  faux.user = { id: "u1", role: "MEMBRE", estAdmin: false, actif: true };
  faux.actif = true;
  faux.partie = partie();
  faux.ecrits = [];
  faux.effaces = [];
});

describe("choisirCours", () => {
  it("enregistre et retire un choix d'un présent", async () => {
    expect(await choisirCours({ partieId: "p1", choisi: true })).toEqual({ ok: true });
    expect(await choisirCours({ partieId: "p1", choisi: false })).toEqual({ ok: true });
    expect(faux.ecrits).toEqual(["+p1", "-p1"]);
  });
  it("refuse quand le club n'a pas ouvert le réglage", async () => {
    faux.actif = false;
    expect(await choisirCours({ partieId: "p1", choisi: true })).toMatchObject({ ok: false });
    expect(faux.ecrits).toEqual([]);
  });
  it("refuse l'échauffement, une réponse autre que « Présent », un cours commencé ou annulé", async () => {
    for (const p of [partie({ nature: "ECHAUFFEMENT" }), partie({ statut: "PEUT_ETRE" }), partie({ statut: null }), partie({ date: "2000-01-01" }), partie({ annulee: true }), partie({ periode: "CLOSE" })]) {
      faux.partie = p;
      expect((await choisirCours({ partieId: "p1", choisi: true })).ok).toBe(false);
    }
    expect(faux.ecrits).toEqual([]);
  });
});

describe("« Absent » efface les choix", () => {
  it("efface ceux de la séance quand le membre répond Absent, pas quand il répond Présent", async () => {
    await indiquerPresence({ sessionId: "s1", statut: "PRESENT" });
    expect(faux.effaces).toEqual([]);
    await indiquerPresence({ sessionId: "s1", statut: "ABSENT" });
    expect(faux.effaces).toEqual([{ userId: { in: ["u1"] }, partie: { sessionId: { in: ["s1"] } } }]);
  });
});
