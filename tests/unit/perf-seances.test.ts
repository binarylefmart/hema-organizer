import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seanceCommencee } from "@/lib/dates";
import { compterPresences } from "@/lib/presences";
import { parseDisciplines } from "@/lib/constants";

/**
 * Coût des écrans « séances » après plusieurs saisons.
 *
 * Trois habitudes coûteuses sont figées ici :
 * - l'historique ne charge plus toutes les séances pour jeter ensuite, en JavaScript, celles qui
 *   n'ont pas commencé : le tri se fait en SQL (date, puis heure de début pour le jour même) ;
 * - la liste nominative des invités appartient à la période : elle est lue une fois par période,
 *   pas une fois par carte de séance ;
 * - ce qui est chargé se limite aux colonnes affichées.
 *
 * Le résultat, lui, ne doit pas bouger d'un octet : le test de référence rejoue l'ancienne
 * méthode (tout charger, filtrer en JavaScript) et compare les deux sorties.
 *
 * La base n'est jamais touchée : `@/lib/db` est remplacé par un faux client qui journalise les
 * appels, applique le filtre de séances demandé et renvoie des réponses préparées.
 */

type Appel = { modele: string; operation: string; args: Record<string, unknown> };

const { appels, reponses, fauxDb } = vi.hoisted(() => {
  const appels: Array<{ modele: string; operation: string; args: Record<string, unknown> }> = [];
  const reponses = new Map<string, unknown>();
  const parDefaut = (operation: string) => (operation === "findMany" || operation === "groupBy" ? [] : null);
  const fauxDb = new Proxy(
    {},
    {
      get(_cible, modele) {
        if (typeof modele !== "string") return undefined;
        return new Proxy(
          {},
          {
            get(_c2, operation) {
              if (typeof operation !== "string") return undefined;
              return async (args: Record<string, unknown> = {}) => {
                appels.push({ modele, operation, args });
                const prete = reponses.get(`${modele}.${operation}`);
                const valeur = typeof prete === "function" ? (prete as (a: unknown) => unknown)(args) : prete;
                return valeur === undefined ? parDefaut(operation) : valeur;
              };
            },
          },
        );
      },
    },
  );
  return { appels, reponses, fauxDb };
});

vi.mock("@/lib/db", () => ({ db: fauxDb }));

const appelsDe = (modele: string, operation?: string): Appel[] => appels.filter((a) => a.modele === modele && (!operation || a.operation === operation));
const lire = (fichier: string) => readFileSync(path.join(process.cwd(), fichier), "utf8");

/** Midi (heure de Paris) le 22 septembre 2026. */
const MIDI = new Date("2026-09-22T10:00:00Z");
const MEMBRE = "u1";

const INVITES = [
  { id: "u3", prenom: "Chloé", nom: "Arnaud", couleur: 3 },
  { id: "u1", prenom: "Charlie", nom: "Bernard", couleur: 1 },
  { id: "u2", prenom: "Charlie", nom: "Aubry", couleur: 2 },
];

type SeanceFixture = {
  id: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  theme: string;
  disciplines: string;
  annulee: boolean;
  motifAnnulation: string | null;
  attendances: Array<{ userId: string; statut: string }>;
};

/** Séances d'une période, de la plus récente à la plus ancienne (l'ordre que rend la base). */
const SEANCES: SeanceFixture[] = [
  { id: "s5", date: "2026-09-29", heureDebut: "20:00", heureFin: "22:00", lieu: "Villebourg", theme: "À venir", disciplines: "Messer", annulee: false, motifAnnulation: null, attendances: [] },
  { id: "s4", date: "2026-09-22", heureDebut: "20:00", heureFin: "22:00", lieu: "Villebourg", theme: "Ce soir", disciplines: "Messer", annulee: false, motifAnnulation: null, attendances: [{ userId: "u1", statut: "PRESENT" }] },
  { id: "s3", date: "2026-09-22", heureDebut: "10:00", heureFin: "12:00", lieu: "Villebourg", theme: "Ce matin", disciplines: "Dague", annulee: false, motifAnnulation: null, attendances: [{ userId: "u1", statut: "PEUT_ETRE" }, { userId: "u2", statut: "PRESENT" }] },
  { id: "s2", date: "2026-09-15", heureDebut: "20:00", heureFin: "22:00", lieu: "Villebourg", theme: "Annulée", disciplines: "Messer", annulee: true, motifAnnulation: "Salle indisponible", attendances: [{ userId: "u1", statut: "PRESENT" }] },
  { id: "s1", date: "2026-09-08", heureDebut: "20:00", heureFin: "22:00", lieu: "Villebourg", theme: "Passée", disciplines: "Messer,Dague", annulee: false, motifAnnulation: null, attendances: [{ userId: "u1", statut: "PRESENT" }, { userId: "u3", statut: "ABSENT" }, { userId: "u2", statut: "ABSENT" }] },
];

const PERIODE = { id: "p1", nom: "Rentrée 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" };

/** Applique le `where` de séances demandé par la requête (date passée, ou jour même déjà commencé). */
function filtrerCommeLaBase(where: unknown, seances: SeanceFixture[]): SeanceFixture[] {
  const clauses = (where as { OR?: Array<{ date: string | { lt: string }; heureDebut?: { lte: string } }> } | undefined)?.OR;
  if (!clauses) return seances;
  return seances.filter((s) =>
    clauses.some((c) => {
      const surLaDate = typeof c.date === "string" ? s.date === c.date : s.date < c.date.lt;
      return surLaDate && (!c.heureDebut || s.heureDebut <= c.heureDebut.lte);
    }),
  );
}

/** Ancienne méthode : tout charger, filtrer et trier en JavaScript. Sert de référence. */
function historiqueDeReference(seances: SeanceFixture[], invites: typeof INVITES, userId: string, now: Date) {
  const trier = (l: typeof INVITES) => l.sort((a, b) => a.prenom.localeCompare(b.prenom, "fr") || a.nom.localeCompare(b.nom, "fr"));
  const retenues = seances
    .filter((s) => seanceCommencee(s.date, s.heureDebut, now))
    .map((s) => {
      const statuts = new Map(s.attendances.map((a) => [a.userId, a.statut]));
      const liste = { presents: [] as typeof INVITES, peutEtre: [] as typeof INVITES, absents: [] as typeof INVITES, sansReponse: [] as typeof INVITES };
      for (const user of invites) {
        const st = statuts.get(user.id);
        (st === "PRESENT" ? liste.presents : st === "PEUT_ETRE" ? liste.peutEtre : st === "ABSENT" ? liste.absents : liste.sansReponse).push(user);
      }
      return {
        id: s.id,
        date: s.date,
        heureDebut: s.heureDebut,
        heureFin: s.heureFin,
        lieu: s.lieu,
        theme: s.theme,
        disciplines: parseDisciplines(s.disciplines),
        annulee: s.annulee,
        motifAnnulation: s.motifAnnulation,
        statut: statuts.get(userId) ?? null,
        compteurs: compterPresences(
          s.attendances.map((a) => a.statut),
          invites.length,
        ),
        participants: {
          presents: trier(liste.presents),
          peutEtre: trier(liste.peutEtre),
          absents: trier(liste.absents),
          sansReponse: trier(liste.sansReponse),
        },
      };
    });
  const passees = retenues.filter((s) => !s.annulee);
  const presences = passees.filter((s) => s.statut === "PRESENT").length;
  return [
    {
      ...PERIODE,
      seances: retenues,
      presences,
      // Sans borne demandée, tout l'historique est chargé : il n'y a jamais « plus » à aller chercher.
      aPlus: false,
      comptees: passees.length,
      pourcentage: passees.length ? Math.round((presences / passees.length) * 100) : 0,
    },
  ];
}

/** Réponse du faux client pour `period.findMany` : filtre les séances comme le ferait SQLite. */
function periodeAvecSeances(seances = SEANCES) {
  return (args: { select?: { sessions?: { where?: unknown } } }) => [
    {
      ...PERIODE,
      membres: INVITES.map((user) => ({ user })),
      sessions: filtrerCommeLaBase(args.select?.sessions?.where, seances),
    },
  ];
}

beforeEach(() => {
  appels.length = 0;
  reponses.clear();
});

describe("historique des présences d'un membre", () => {
  beforeEach(() => {
    reponses.set("period.findMany", periodeAvecSeances());
  });

  it("écarte les séances non commencées en SQL, pas en JavaScript", async () => {
    const { historiquePresences } = await import("@/lib/seances");
    const periodes = await historiquePresences(MEMBRE, MIDI);
    const where = (appelsDe("period", "findMany")[0].args as { select: { sessions: { where: { OR: unknown[] } } } }).select.sessions.where;
    // Deux cas, comme `seanceCommencee` : une date déjà passée, ou le jour même à l'heure atteinte
    expect(where.OR).toEqual([{ date: { lt: "2026-09-22" } }, { date: "2026-09-22", heureDebut: { lte: "12:00" } }]);
    // La séance du soir et celle de la semaine prochaine ne sont jamais rapatriées
    expect(periodes[0].seances.map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
  });

  it("rend exactement le même résultat que l'ancien filtrage en JavaScript", async () => {
    const { historiquePresences } = await import("@/lib/seances");
    const obtenu = await historiquePresences(MEMBRE, MIDI);
    const reference = historiqueDeReference(SEANCES, [...INVITES], MEMBRE, MIDI);
    expect(JSON.parse(JSON.stringify(obtenu))).toEqual(JSON.parse(JSON.stringify(reference)));
  });

  it("garde la règle de `seanceCommencee` pour la séance du jour (avant / après l'heure de début)", async () => {
    const { historiquePresences } = await import("@/lib/seances");
    // 19 h 59 à Paris : la séance de 20 h n'a pas commencé ; 20 h 30 : elle est dans l'historique
    const avant = await historiquePresences(MEMBRE, new Date("2026-09-22T17:59:00Z"));
    const apres = await historiquePresences(MEMBRE, new Date("2026-09-22T18:30:00Z"));
    expect(avant[0].seances.map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
    expect(apres[0].seances.map((s) => s.id)).toEqual(["s4", "s3", "s2", "s1"]);
    for (const [instant, attendu] of [
      [new Date("2026-09-22T17:59:00Z"), avant],
      [new Date("2026-09-22T18:30:00Z"), apres],
    ] as const) {
      expect(JSON.parse(JSON.stringify(attendu))).toEqual(JSON.parse(JSON.stringify(historiqueDeReference(SEANCES, [...INVITES], MEMBRE, instant))));
    }
  });

  it("ne demande que les colonnes affichées, et deux colonnes de présence", async () => {
    const { historiquePresences } = await import("@/lib/seances");
    await historiquePresences(MEMBRE, MIDI);
    const args = appelsDe("period", "findMany")[0].args as { select: Record<string, { select?: Record<string, unknown> }>; include?: unknown };
    expect(args.include).toBeUndefined();
    const seance = args.select.sessions.select as Record<string, unknown>;
    expect(Object.keys(seance).filter((c) => typeof seance[c] === "boolean").sort()).toEqual([
      "annulee",
      "date",
      "disciplines",
      "heureDebut",
      "heureFin",
      "id",
      "lieu",
      "motifAnnulation",
      "theme",
    ]);
    expect(Object.keys((seance.attendances as { select: Record<string, boolean> }).select).sort()).toEqual(["statut", "userId"]);
  });

  it("tient en une seule requête de période", async () => {
    const { historiquePresences } = await import("@/lib/seances");
    await historiquePresences(MEMBRE, MIDI);
    expect(appels).toHaveLength(1);
    expect(appelsDe("attendance")).toHaveLength(0);
  });
});

describe("cartes de séances", () => {
  const CARTES = [
    { id: "s1", periodId: "p1", period: { nom: "Rentrée 2026" }, date: "2026-09-29", heureDebut: "20:00", heureFin: "22:00", lieu: "Villebourg", adresse: "", disciplines: "Messer", theme: "A", alternative: "", annulee: false, motifAnnulation: null, instructeurs: [], parties: [], ateliers: [], attendances: [{ userId: "u1", statut: "PRESENT" }, { userId: "u2", statut: "ABSENT" }] },
    { id: "s2", periodId: "p1", period: { nom: "Rentrée 2026" }, date: "2026-10-06", heureDebut: "20:00", heureFin: "22:00", lieu: "Villebourg", adresse: "", disciplines: "Messer", theme: "B", alternative: "", annulee: false, motifAnnulation: null, instructeurs: [], parties: [], ateliers: [], attendances: [] },
    { id: "s3", periodId: "p2", period: { nom: "Stage" }, date: "2026-10-10", heureDebut: "10:00", heureFin: "18:00", lieu: "Villebourg", adresse: "", disciplines: "Dague", theme: "C", alternative: "", annulee: false, motifAnnulation: null, instructeurs: [], parties: [], ateliers: [], attendances: [{ userId: "u3", statut: "PRESENT" }] },
  ];

  beforeEach(() => {
    reponses.set("session.findMany", CARTES);
    reponses.set("periodMember.findMany", [
      ...INVITES.map((user) => ({ periodId: "p1", user })),
      { periodId: "p2", user: INVITES[0] },
    ]);
  });

  it("lit la liste nominative une fois par période, pas une fois par carte", async () => {
    const { prochainesSeances } = await import("@/lib/seances");
    await prochainesSeances({ id: MEMBRE, role: "MEMBRE" }, MIDI);
    // Une requête de séances, une requête d'invités — quel que soit le nombre de cartes
    expect(appelsDe("periodMember", "findMany")).toHaveLength(1);
    const args = appelsDe("periodMember", "findMany")[0].args as { where: { periodId: { in: string[] } } };
    expect(args.where.periodId.in).toEqual(["p1", "p2"]);
    // Les cartes ne ramènent plus les invités de la période une fois par séance
    const include = (appelsDe("session", "findMany")[0].args as { include: { period: { select: Record<string, unknown> } } }).include;
    expect(Object.keys(include.period.select)).toEqual(["nom"]);
  });

  it("ne change rien à la forme des cartes (compteurs, listes triées, statut, inscription)", async () => {
    const { prochainesSeances } = await import("@/lib/seances");
    const cartes = await prochainesSeances({ id: MEMBRE, role: "MEMBRE" }, MIDI);
    expect(cartes.map((c) => c.id)).toEqual(["s1", "s2", "s3"]);
    expect(cartes[0].compteurs).toEqual({ invites: 3, presents: 1, absents: 1, peutEtre: 0, enAttente: 1, pourcentage: 33 });
    // Tri alphabétique par prénom puis nom, conservé alors que la liste n'est triée qu'une fois
    expect(cartes[0].participants.sansReponse.map((p) => p.id)).toEqual(["u3"]);
    expect(cartes[1].participants.sansReponse.map((p) => `${p.prenom} ${p.nom}`)).toEqual(["Charlie Aubry", "Charlie Bernard", "Chloé Arnaud"]);
    expect(cartes[0].monStatut).toBe("PRESENT");
    expect(cartes[0].inscrit).toBe(true);
    // Période où le membre n'est pas invité : consultation seule, dénominateur de la période
    expect(cartes[2].inscrit).toBe(false);
    expect(cartes[2].compteurs.invites).toBe(1);
  });
});

describe("écrans d'administration", () => {
  it("la liste des membres n'ouvre plus tous les liens de tout le monde", () => {
    const source = lire("src/app/(app)/admin/membres/page.tsx");
    // Le libellé du bouton et la pastille viennent de deux agrégats, pas d'une relation chargée
    expect(source).not.toMatch(/invitations: \{ select:/);
    expect(source).not.toContain("authSessions");
    expect(source).toContain('db.invitation.groupBy({ by: ["userId"]');
    expect(source).toContain("usedAt: { not: null }");
    expect(source).toContain("revokedAt: null");
  });

  it("les raccourcis du journal d'audit filtrent sur un préfixe d'action", () => {
    const source = lire("src/app/(app)/admin/audit/page.tsx");
    expect(source).toContain("action: { startsWith: prefixe }");
    // La recherche libre, elle, reste un `contains` sur les trois colonnes
    expect(source).toContain("{ action: { contains: q } }, { acteurEmail: { contains: q } }, { cible: { contains: q } }");
    // Le raccourci « 2FA » couvre aussi les actions de l'administration : sinon il en perdrait
    expect(source).toContain('prefixes: ["deux_fa", "admin.deux_fa"]');
  });

  it("l'export CSV des présences lance ses deux lectures en même temps", () => {
    const source = lire("src/app/api/export/presences/route.ts");
    // Les arguments de `statsPeriode` ne sont pas l'objet de ce test — la fenêtre de temps s'y est
    // ajoutée, pour que le fichier couvre ce que l'écran montre —, seul le parallélisme des deux
    // lectures l'est.
    expect(source).toMatch(/const \[stats, brut\] = await Promise\.all\(\[\s*statsPeriode\(periodId[^)]*\),/);
  });
});
