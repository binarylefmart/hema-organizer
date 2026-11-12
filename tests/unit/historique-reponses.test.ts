import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Historique des réponses et délai réglable des désistements**.
 */
const faux = vi.hoisted(() => ({
  reglage: null as string | null,
  seances: [{ id: "s1", date: "2026-10-08", heureDebut: "20:00" }],
  ecrits: [] as Array<Record<string, unknown>>,
  lignes: [] as Array<{ sessionId: string; tardif: boolean; derniereMinute?: boolean }>,
  /** `desistement.derniereMinuteMinutes` (null : défaut, 4 h). */
  reglageDerniereMinute: null as string | null,
  nonSignales: [] as Array<{ sessionId: string }>,
  panne: false,
  audits: [] as unknown[][],
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (...args: unknown[]) => faux.audits.push(args)) }));

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const v = where.key === "desistement.derniereMinuteMinutes" ? faux.reglageDerniereMinute : faux.reglage;
        return v === null ? null : { value: v };
      }),
    },
    session: { findMany: vi.fn(async () => faux.seances) },
    attendanceChange: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        if (faux.panne) throw new Error("base en panne");
        faux.ecrits.push(...data);
        return { count: data.length };
      }),
      findMany: vi.fn(async () => faux.lignes),
    },
    desistementNonSignale: { findMany: vi.fn(async () => faux.nonSignales) },
  },
}));

const { lireDelaiDesistement, getDelaiDesistementMin } = await import("@/lib/settings");
const { delaiDesistementSchema } = await import("@/lib/validation/gestion");
const { dansFenetreDesistementTardif } = await import("@/lib/notifications/desistement");
const { noterChangementsReponse, compterDesistements, calculerStatsDesistements, calculerDetailDesistements, desistementsParCreneau, typeDesistement, libelleAvantCours, minutesAvantCours } = await import("@/lib/historique-reponses");
const { libelleDelaiDesistement } = await import("@/lib/constants");

/** 20h00 à Paris le 8 octobre 2026 = 18:00 UTC. */
const DEBUT = new Date("2026-10-08T18:00:00Z");
const CHLOE = { id: "chloe", email: "chloe@club.fr" };
const heuresAvant = (h: number) => new Date(DEBUT.getTime() - h * 3_600_000);

beforeEach(() => {
  faux.reglage = null;
  faux.reglageDerniereMinute = null;
  faux.nonSignales = [];
  faux.ecrits = [];
  faux.lignes = [];
  faux.panne = false;
  faux.audits = [];
});

describe("délai des désistements", () => {
  it("se saisit en heures entières, de 1 heure à 2 semaines, et se range en minutes", () => {
    expect(delaiDesistementSchema.parse(24)).toBe(1440);
    expect(delaiDesistementSchema.parse(336)).toBe(14 * 1440);
    expect(delaiDesistementSchema.safeParse(0).success).toBe(false);
    expect(delaiDesistementSchema.safeParse(337).success).toBe(false);
    expect(delaiDesistementSchema.safeParse(1.5).success).toBe(false);
  });

  it("vaut deux jours tant que rien n'est réglé, ou si la valeur est illisible", async () => {
    expect(lireDelaiDesistement(null)).toBe(2880);
    expect(lireDelaiDesistement("abc")).toBe(2880);
    expect(lireDelaiDesistement("90")).toBe(2880);
    expect(lireDelaiDesistement("99999")).toBe(2880);
    expect(lireDelaiDesistement("1440")).toBe(1440);
    faux.reglage = "360";
    expect(await getDelaiDesistementMin()).toBe(360);
  });

  it("élargit la fenêtre de l'alerte", () => {
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", heuresAvant(5), 120)).toBe(false);
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", heuresAvant(5), 360)).toBe(true);
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", heuresAvant(24), 1440)).toBe(true);
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", heuresAvant(25), 1440)).toBe(false);
  });
});

describe("noterChangementsReponse", () => {
  it("note chaque vrai changement, marque les désistements et ceux du délai", async () => {
    faux.reglage = "1440";
    await noterChangementsReponse(
      CHLOE,
      [
        { sessionId: "s1", userId: "chloe", avant: "PRESENT", apres: "ABSENT" },
        { sessionId: "s1", userId: "chloe", avant: "ABSENT", apres: "ABSENT" },
        { sessionId: "s1", userId: "m1", avant: null, apres: "ABSENT" },
        { sessionId: "s1", userId: "m2", avant: "PEUT_ETRE", apres: null },
      ],
      heuresAvant(10),
    );
    expect(faux.ecrits.map((e) => [e.userId, e.desistement, e.tardif])).toEqual([
      ["chloe", true, true],
      ["m1", false, false],
      ["m2", false, false],
    ]);
    // Le journal d'audit horodate les seuls gestes de la personne elle-même (ici, Chloé).
    expect(faux.audits.map((a) => a[1])).toEqual(["presence.desistement"]);
    expect(faux.audits[0][3]).toMatchObject({ sessionId: "s1", avant: "PRESENT", apres: "ABSENT", derniereMinute: false, signale: true, avantCoursMin: 600 });
    expect(faux.ecrits[0]).toMatchObject({ derniereMinute: false });
  });

  it("dans la fenêtre de dernière minute : marqué, et une action à part au journal", async () => {
    await noterChangementsReponse(CHLOE, [{ sessionId: "s1", userId: "chloe", avant: "PRESENT", apres: "ABSENT" }], heuresAvant(3));
    expect(faux.ecrits[0]).toMatchObject({ desistement: true, tardif: true, derniereMinute: true });
    expect(faux.audits.map((a) => a[1])).toEqual(["presence.desistement_derniere_minute"]);
    expect(faux.audits[0][3]).toMatchObject({ derniereMinute: true, signale: true, avantCoursMin: 180 });
  });

  it("le délai de dernière minute réglé par le club fait foi", async () => {
    faux.reglageDerniereMinute = "60";
    await noterChangementsReponse(CHLOE, [{ sessionId: "s1", userId: "chloe", avant: "PRESENT", apres: "ABSENT" }], heuresAvant(1.5));
    expect(faux.ecrits[0]).toMatchObject({ tardif: true, derniereMinute: false });
  });

  it("hors du délai : désistement noté, mais pas « de dernière minute »", async () => {
    await noterChangementsReponse(CHLOE, [{ sessionId: "s1", userId: "chloe", avant: "PRESENT", apres: "PEUT_ETRE" }], heuresAvant(72));
    expect(faux.ecrits[0]).toMatchObject({ desistement: true, tardif: false, auteurId: "chloe" });
  });

  it("ne lève jamais", async () => {
    faux.panne = true;
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(noterChangementsReponse({ id: "x", email: null }, [{ sessionId: "s1", userId: "x", avant: "PRESENT", apres: "ABSENT" }])).resolves.toBeUndefined();
    erreur.mockRestore();
  });
});

describe("compterDesistements", () => {
  it("compte des séances distinctes", async () => {
    faux.lignes = [
      { sessionId: "s1", tardif: false },
      { sessionId: "s1", tardif: true, derniereMinute: true },
      { sessionId: "s2", tardif: false },
    ];
    // s2 n'a qu'un retrait anticipé (hors délai d'alerte) : ce n'est pas un désistement.
    expect(await compterDesistements("chloe")).toEqual({ seances: 1, tardifs: 1, derniereMinute: 1, nonSignales: 0 });
  });

  it("compte un désistement non signalé, et il l'emporte sur un retrait de la même séance", async () => {
    faux.lignes = [{ sessionId: "s1", tardif: true, derniereMinute: true }];
    faux.nonSignales = [{ sessionId: "s1" }, { sessionId: "s3" }];
    expect(await compterDesistements("chloe")).toEqual({ seances: 2, tardifs: 0, derniereMinute: 0, nonSignales: 2 });
  });
});

describe("libellés", () => {
  it("dit le délai dans la plus grande unité juste", () => {
    expect(libelleDelaiDesistement(120)).toBe("2 heures");
    expect(libelleDelaiDesistement(1440)).toBe("1 jour");
    expect(libelleDelaiDesistement(3 * 1440)).toBe("3 jours");
    expect(libelleDelaiDesistement(14 * 1440)).toBe("2 semaines");
    expect(libelleDelaiDesistement(30 * 60)).toBe("30 heures");
  });

  it("dit l'écart au cours", () => {
    expect(libelleAvantCours(45)).toBe("45 min avant le cours");
    expect(libelleAvantCours(200)).toBe("3 h 20 avant le cours");
    expect(libelleAvantCours(180)).toBe("3 h avant le cours");
    expect(libelleAvantCours(2 * 1440 + 240)).toBe("2 j 4 h avant le cours");
    expect(libelleAvantCours(0)).toBe("après le début du cours");
    expect(minutesAvantCours(heuresAvant(3), "2026-10-08", "20:00")).toBe(180);
  });
});

describe("calculerStatsDesistements", () => {
  const ligne = (id: string, userId: string, sessionId: string, h: number, tardif = false) => ({
    id,
    userId,
    sessionId,
    avant: "PRESENT",
    apres: "ABSENT",
    tardif,
    createdAt: heuresAvant(h),
    user: { prenom: userId, nom: "" },
    session: { date: "2026-10-08", heureDebut: "20:00" },
  });

  it("compte personne × séance une fois, classe par délai et par personne", () => {
    // Du plus récent au plus ancien, comme la lecture en base. 20 h à Paris en novembre = 19:00 UTC.
    const st = calculerStatsDesistements(9, [
      ligne("a", "chloe", "s1", 1, true),
      ligne("b", "chloe", "s1", 50),
      ligne("c", "charlie", "s1", 30, true),
      ligne("d", "chloe", "s2", 200, true),
      ligne("e", "alix", "s2", 400),
    ]);
    // Alix n'a qu'un retrait anticipé : ni compté, ni nommé.
    expect(st.desistements).toBe(3);
    expect(st.tardifs).toBe(3);
    expect(st.personnes).toBe(2);
    expect(st.compteParMembre.alix).toBeUndefined();
    expect(st.parMembre[0]).toMatchObject({ userId: "chloe", n: 2, tardifs: 2 });
    expect(st.parSeance[0]).toMatchObject({ id: "s1", n: 2 });
    expect(st.tranches.map((t) => t.n)).toEqual([1, 0, 1, 0, 1, 0]);
    expect(st.medianeMin).toBe(30 * 60);
    expect(st.derniers).toHaveLength(3);
    // Le compte de chacun, pour le tableau des membres (pas seulement les dix premiers)
    expect(st.compteParMembre).toEqual({ chloe: { n: 2, derniereMinute: 0, nonSignales: 0 }, charlie: { n: 1, derniereMinute: 0, nonSignales: 0 } });
  });

  it("rien à compter", () => {
    expect(calculerStatsDesistements(0, [])).toMatchObject({ desistements: 0, medianeMin: null });
  });
});

describe("calculerDetailDesistements (page Désistements)", () => {
  const ligne = (id: string, userId: string, prenom: string, sessionId: string, date: string, extra: { tardif?: boolean; derniereMinute?: boolean; heures?: number } = {}) => ({
    id,
    sessionId,
    userId,
    avant: "PRESENT",
    apres: "ABSENT",
    tardif: extra.tardif ?? false,
    derniereMinute: extra.derniereMinute ?? false,
    createdAt: new Date(new Date(`${date}T19:00:00Z`).getTime() - (extra.heures ?? 30) * 3_600_000),
    user: { prenom, nom: "Test" },
    session: { date, heureDebut: "20:00", lieu: "Gymnase" },
  });
  // Du plus récent au plus ancien, comme la lecture en base. 20 h à Paris en novembre = 19:00 UTC.
  const brutes = [
    ligne("c3", "chloe", "Chloé", "s2", "2026-11-19", { tardif: true, derniereMinute: true, heures: 2 }),
    ligne("b1", "charlie", "Charlie", "s2", "2026-11-19", { tardif: true }),
    ligne("c2", "chloe", "Chloé", "s1", "2026-11-12"),
    ligne("c1", "chloe", "Chloé", "s1", "2026-11-12", { tardif: true }),
  ];

  it("une ligne par personne et par séance, le dernier retrait, qualifié par les plus anciens", () => {
    const d = calculerDetailDesistements(brutes);
    expect(d.total).toBe(3);
    expect(d.lignes.map((l) => l.id)).toEqual(["b1", "c3", "c2"]);
    expect(d.lignes.find((l) => l.id === "c2")).toMatchObject({ signale: true, derniereMinute: false });
    expect(d.derniereMinute).toBe(1);
  });

  it("compte par personne, le plus de désistements d'abord, avec le dernier cours concerné", () => {
    const d = calculerDetailDesistements(brutes);
    expect(d.parPersonne).toEqual([
      { userId: "chloe", nom: "Chloé Test", n: 2, derniereMinute: 1, signales: 1, nonSignales: 0, dernierCours: "2026-11-19" },
      { userId: "charlie", nom: "Charlie Test", n: 1, derniereMinute: 0, signales: 1, nonSignales: 0, dernierCours: "2026-11-19" },
    ]);
    expect(d.personnes).toBe(2);
  });

  it("filtre par type : de dernière minute, ou signalés seulement", () => {
    expect(calculerDetailDesistements(brutes, "derniere_minute").lignes.map((l) => l.id)).toEqual(["c3"]);
    expect(calculerDetailDesistements(brutes, "signales").lignes.map((l) => l.id).sort()).toEqual(["b1", "c2"]);
  });

  it("dit l'écart au cours, pas l'instant du retrait", () => {
    const l = calculerDetailDesistements(brutes).lignes.find((x) => x.id === "c3")!;
    expect(l.avantCoursMin).toBe(120);
    expect(l).not.toHaveProperty("quand");
  });
});

describe("desistementsParCreneau (par jour de cours)", () => {
  // 2026-11-17 et 2026-11-24 sont des mardis, 2026-11-20 un vendredi.
  const seances = [
    { id: "m1", date: "2026-11-17", heureDebut: "19:00" },
    { id: "v1", date: "2026-11-20", heureDebut: "19:00" },
    { id: "m2", date: "2026-11-24", heureDebut: "19:00" },
  ];
  it("regroupe par jour de la semaine, compte les cours, le plus touché d'abord", () => {
    const c = desistementsParCreneau(seances, [
      { sessionId: "v1", signale: true, derniereMinute: true },
      { sessionId: "v1", signale: true, derniereMinute: false },
      { sessionId: "m1", signale: false, derniereMinute: false },
    ]);
    expect(c).toEqual([
      { cle: "5", libelle: "Vendredi", cours: 1, desistements: 2, derniereMinute: 1, signales: 1, nonSignales: 0 },
      { cle: "2", libelle: "Mardi", cours: 2, desistements: 1, derniereMinute: 0, signales: 0, nonSignales: 0 },
    ]);
  });
  it("sépare les horaires d'un même jour seulement quand il en a plusieurs", () => {
    const c = desistementsParCreneau([...seances, { id: "m3", date: "2026-11-24", heureDebut: "20:30" }], []);
    expect(c.map((x) => x.libelle)).toEqual(["Mardi · 19h00", "Mardi · 20h30", "Vendredi"]);
  });
});

describe("désistement non signalé (inscrit Présent, pas venu)", () => {
  const ns = (id: string, userId: string, sessionId: string, date = "2026-11-20") => ({ id, sessionId, userId, user: { prenom: userId, nom: "Test" }, session: { date, heureDebut: "20:00", lieu: "Gymnase" } });
  const retrait = (id: string, userId: string, sessionId: string, tardif = false, derniereMinute = false) => ({
    id,
    sessionId,
    userId,
    avant: "PRESENT",
    apres: "ABSENT",
    tardif,
    derniereMinute,
    createdAt: new Date("2026-11-10T19:00:00Z"),
    user: { prenom: userId, nom: "Test" },
    session: { date: "2026-11-20", heureDebut: "20:00", lieu: "Gymnase" },
  });

  it("quatre types, du moins grave au plus grave", () => {
    expect(typeDesistement({ signale: false, derniereMinute: false, nonSignale: false })).toBe("anticipe");
    expect(typeDesistement({ signale: true, derniereMinute: false, nonSignale: false })).toBe("signale");
    expect(typeDesistement({ signale: true, derniereMinute: true, nonSignale: false })).toBe("derniere_minute");
    expect(typeDesistement({ signale: true, derniereMinute: true, nonSignale: true })).toBe("non_signale");
  });

  it("entre dans le détail, sans délai, et l'emporte sur un retrait de la même séance", () => {
    const d = calculerDetailDesistements([retrait("r1", "alix", "s1", true, true), retrait("r2", "charlie", "s1")], "tous", [ns("n1", "alix", "s1"), ns("n2", "chloe", "s1")]);
    // Charlie n'a qu'un retrait anticipé : il ne paraît pas.
    expect(d.total).toBe(2);
    expect(d.lignes.some((l) => l.userId === "charlie")).toBe(false);
    expect(d.nonSignales).toBe(2);
    expect(d.derniereMinute).toBe(0);
    expect(d.lignes.find((l) => l.userId === "alix")).toMatchObject({ nonSignale: true, avantCoursMin: 0 });
    // Un retrait anticipé (hors délai) n'est pas un désistement : il ne paraît pas.
    expect(calculerDetailDesistements([retrait("r2", "charlie", "s1")], "tous", []).lignes).toEqual([]);
    expect(calculerDetailDesistements([retrait("r2", "charlie", "s1")], "non_signales", [ns("n2", "chloe", "s1")]).lignes.map((l) => l.userId)).toEqual(["chloe"]);
  });

  it("entre dans les chiffres, mais ni dans le délai médian ni dans les tranches", () => {
    const st = calculerStatsDesistements(1, [retrait("r2", "charlie", "s1", true)], [ns("n2", "chloe", "s1")]);
    expect(st.desistements).toBe(2);
    expect(st.nonSignales).toBe(1);
    expect(st.tranches.reduce((t, x) => t + x.n, 0)).toBe(1);
    expect(st.compteParMembre.chloe).toEqual({ n: 1, derniereMinute: 0, nonSignales: 1 });
  });
});
