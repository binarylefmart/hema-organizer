import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Un taux ne dépasse jamais 100 %** — la ceinture de sécurité des calculs.
 *
 * Le dénominateur de tous les taux du club, c'est le nombre d'**invités de la période**
 * (`PeriodMember`, compte de service exclu). Le numérateur, lui, se comptait sur *toutes* les
 * lignes de présence de la séance, sans regarder si la personne était encore invitée : une réponse
 * laissée derrière par quelqu'un retiré de la période restait dans le total. D'où des « 19/18 » et
 * des « 106 % » sur le tableau de bord, sur la page publique de partage et dans l'API du site.
 *
 * Deux garde-fous, posés ici :
 *  1. **les agrégats sont filtrés sur les membres de la période** (en base, dans le `where`, pour ne
 *     pas rapatrier les lignes pour les jeter ensuite) ;
 *  2. **le taux est borné à 100 %** dans `calculerTaux` — si une donnée aberrante repassait un jour
 *     par un autre chemin, l'écran resterait lisible au lieu d'annoncer un pourcentage impossible.
 *
 * La base n'est jamais touchée : `@/lib/db` est remplacé par un faux client qui journalise les
 * appels. Son `groupBy` **respecte** le filtre d'appartenance — c'est ce qui rend ces tests capables
 * d'échouer : sans le filtre, le fantôme remonte dans le total.
 */

type Appel = { modele: string; operation: string; args: Record<string, unknown> };

/** Présences en base : deux invités de la période, plus une réponse laissée par un retiré. */
const PRESENCES = [
  { userId: "u1", sessionId: "s1", statut: "PRESENT" },
  { userId: "u2", sessionId: "s1", statut: "PRESENT" },
  { userId: "fantome", sessionId: "s1", statut: "PRESENT" },
];

const { appels, reponses, fauxDb } = vi.hoisted(() => {
  const appels: Array<{ modele: string; operation: string; args: Record<string, unknown> }> = [];
  const reponses = new Map<string, unknown>();
  const parDefaut = (operation: string) => (operation === "findMany" || operation === "groupBy" ? [] : operation === "count" ? 0 : null);
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

const PERIODE = "p1";
const MEMBRES_IDS = new Set(["u1", "u2"]);
const MAINTENANT = new Date("2026-09-22T12:00:00Z");

/**
 * Faux `attendance.groupBy` : il n'agrège que ce que le `where` demande. Sans filtre
 * d'appartenance, il rend aussi la ligne du fantôme — exactement ce que faisait la base.
 */
function groupByPresences(args: unknown) {
  const { by, where } = args as { by: string[]; where?: { user?: unknown } };
  const membresSeuls = Boolean(where?.user);
  const totaux = new Map<string, number>();
  for (const a of PRESENCES) {
    if (membresSeuls && !MEMBRES_IDS.has(a.userId)) continue;
    const cle = `${by[0] === "userId" ? a.userId : a.sessionId}|${a.statut}`;
    totaux.set(cle, (totaux.get(cle) ?? 0) + 1);
  }
  return [...totaux].map(([cle, n]) => {
    const [valeur, statut] = cle.split("|");
    return { [by[0]]: valeur, statut, _count: { _all: n } };
  });
}

/** Le filtre attendu dans un `where` de présences : membre de la période, compte de service exclu. */
function filtreAppartenance(where: unknown) {
  return (where as { user?: unknown } | undefined)?.user;
}

beforeEach(() => {
  appels.length = 0;
  reponses.clear();
  reponses.set("attendance.groupBy", groupByPresences);
});

const appelsDe = (modele: string, operation: string): Appel[] => appels.filter((a) => a.modele === modele && a.operation === operation);

/* ------------------------------------------------------------------ */
/* Tableau de bord                                                     */
/* ------------------------------------------------------------------ */

describe("tableau de bord d'une période", () => {
  beforeEach(() => {
    reponses.set("period.findUnique", {
      id: PERIODE,
      nom: "Saison",
      statut: "ACTIVE",
      membres: [
        { user: { id: "u1", prenom: "Chloé", nom: "Arnaud" } },
        { user: { id: "u2", prenom: "Charlie", nom: "Bernard" } },
      ],
      sessions: [{ id: "s1", date: "2026-09-01", heureDebut: "20:00", theme: "Messer", annulee: false }],
    });
  });

  it("ne compte que les présences des invités de la période, jamais celles d'un retiré", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, MAINTENANT);
    // Deux invités, deux présents : 100 %. Sans le filtre, la réponse du fantôme faisait 3/2 = 150 %.
    expect(stats?.seances[0].compteurs.presents).toBe(2);
    expect(stats?.seances[0].compteurs.pourcentage).toBe(100);
    expect(stats?.moyenne).toBe(100);
  });

  it("pose le filtre d'appartenance dans les deux agrégats, sans requête de plus", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    await statsPeriode(PERIODE, MAINTENANT);
    const agregats = appelsDe("attendance", "groupBy");
    expect(agregats).toHaveLength(2);
    for (const a of agregats) {
      expect(filtreAppartenance(a.args.where)).toEqual({ service: false, periodes: { some: { periodId: PERIODE } } });
    }
    // Le compte des requêtes reste celui que fige `perf-requetes.test.ts` : la période + deux agrégats
    expect(appels).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */
/* Taux personnel : les cours de chacun, pas ceux du trimestre         */
/* ------------------------------------------------------------------ */

/**
 * Quelqu'un inscrit en cours de trimestre n'a pas « manqué » les cours d'avant son arrivée : il n'y
 * était pas invité. Son dénominateur, ce sont **ses** cours — la même règle que la tuile « Jamais
 * venus » de l'accueil, qui se compte déjà depuis la date d'arrivée.
 */
describe("dénominateur personnel d'un membre arrivé en cours de trimestre", () => {
  const SEANCES = [
    { id: "s0", date: "2026-09-01", heureDebut: "20:00", theme: "Messer", annulee: false },
    { id: "s1", date: "2026-09-15", heureDebut: "20:00", theme: "Dague", annulee: false },
  ];

  /** Une période dont les deux séances sont passées, avec les dates d'arrivée données. */
  function periodeAvec(arrivees: Array<[string, Date | undefined]>) {
    reponses.set("period.findUnique", {
      id: PERIODE,
      nom: "Saison",
      statut: "ACTIVE",
      membres: arrivees.map(([id, addedAt]) => ({ addedAt, user: { id, prenom: id, nom: id } })),
      sessions: SEANCES,
    });
  }

  it("ne compte que les cours postérieurs à son arrivée", async () => {
    periodeAvec([
      ["u1", new Date("2026-08-20T10:00:00Z")], // là depuis la rentrée
      ["u2", new Date("2026-09-10T10:00:00Z")], // arrivée entre les deux cours
    ]);
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const membres = (await statsPeriode(PERIODE, MAINTENANT))?.membres ?? [];
    expect(membres.map((m) => [m.id, m.seances, m.presents, m.pourcentage])).toEqual([
      ["u1", 2, 1, 50],
      // u2 n'a eu qu'un cours à honorer, et il y était : 100 %, pas 50 %
      ["u2", 1, 1, 100],
    ]);
    expect(membres.map((m) => m.sansReponse)).toEqual([1, 0]);
  });

  it("compte « pas encore de cours » — jamais NaN — pour qui arrive après le dernier", async () => {
    periodeAvec([["u1", new Date("2026-09-21T10:00:00Z")]]);
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const m = (await statsPeriode(PERIODE, MAINTENANT))?.membres[0];
    expect(m?.seances).toBe(0);
    expect(m?.pourcentage).toBe(0);
    expect(Number.isNaN(m?.pourcentage)).toBe(false);
    expect(m?.sansReponse).toBe(0);
  });

  it("retombe sur le trimestre entier quand la date d'arrivée manque", async () => {
    periodeAvec([["u1", undefined]]);
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    // Repli prudent : donnée ancienne = présent depuis le début, l'ancien comportement
    expect((await statsPeriode(PERIODE, MAINTENANT))?.membres[0].seances).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Partage public et API publique                                      */
/* ------------------------------------------------------------------ */

const LIGNE_SEANCE = {
  id: "s1",
  date: "2026-09-24",
  heureDebut: "19:30",
  heureFin: "21:30",
  lieu: "Gymnase municipal",
  adresse: "1 rue des Lices",
  theme: "Messer",
  alternative: "",
  disciplines: "Messer",
  annulee: false,
  motifAnnulation: null,
  periodId: PERIODE,
  period: { id: PERIODE, nom: "Rentrée 2026", statut: "ACTIVE" },
  parties: [],
};

describe("pages publiques de partage", () => {
  beforeEach(() => {
    reponses.set("periodMember.count", 2);
    reponses.set("session.findUnique", LIGNE_SEANCE);
    reponses.set("session.findMany", [LIGNE_SEANCE]);
    reponses.set("session.count", 1);
    reponses.set("period.findUnique", { id: PERIODE, nom: "Rentrée 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-10-31" });
  });

  it("le résumé d'une séance ne compte que les invités de la période", async () => {
    const { seancePartagee } = await import("@/lib/partage");
    const s = await seancePartagee("s1");
    expect(s?.compteurs).toMatchObject({ presents: 2, invites: 2, pourcentage: 100 });
    expect(filtreAppartenance(appelsDe("attendance", "groupBy")[0]?.args.where)).toEqual({
      service: false,
      periodes: { some: { periodId: PERIODE } },
    });
  });

  it("le planning partagé compte sur la même règle", async () => {
    const { planningPartage } = await import("@/lib/partage");
    const p = await planningPartage(PERIODE, MAINTENANT);
    expect(p?.seances[0].compteurs).toMatchObject({ presents: 2, invites: 2, pourcentage: 100 });
  });

  it("l'API publique du site affiche le même chiffre que la page", async () => {
    const { prochainesSeancesPubliques } = await import("@/lib/partage");
    const seances = await prochainesSeancesPubliques(5, MAINTENANT);
    expect(seances[0].compteurs).toMatchObject({ presents: 2, invites: 2, pourcentage: 100 });
  });

  it("ne lit toujours aucune colonne nominative pour autant", async () => {
    const { seancePartagee } = await import("@/lib/partage");
    await seancePartagee("s1");
    const select = JSON.stringify(appelsDe("session", "findUnique")[0].args.select);
    for (const interdit of ["prenom", "email", "userId", "instructeur", "proposePar", "modifiePar"]) {
      expect(select).not.toContain(interdit);
    }
    // Le numérateur est un total agrégé en base : aucune ligne de présence ne remonte, même anonyme
    expect(JSON.stringify(appelsDe("attendance", "groupBy")[0].args)).not.toContain("select");
  });
});

/* ------------------------------------------------------------------ */
/* Cartes de séance : le compteur et la liste nominative               */
/* ------------------------------------------------------------------ */

/**
 * **Le compteur d'une carte et sa liste de noms doivent être deux lectures du même ensemble.**
 *
 * C'est la leçon du bug des réponses fantômes. `listeParticipants` répartit les **invités** de la
 * période (liste filtrée) ; le compteur, lui, se calculait sur les **lignes de présence** brutes de
 * la séance. Sur une base qui porte encore des réponses laissées par quelqu'un retiré du trimestre,
 * la même carte annonçait donc « 3 présents » au-dessus d'une liste de deux noms — et le tableau de
 * bord, la page publique et l'API du site, eux, disaient « 2 ». Deux écrans, deux chiffres, pour la
 * même séance.
 *
 * La garantie n'est pas « les deux comptages sont filtrés pareil » (on vient de voir qu'on l'oublie
 * à un endroit sur trois) : c'est **le compteur se dérive de la liste**, si bien qu'aucun écart
 * n'est plus exprimable.
 */
describe("carte d'une séance : compteur et liste nominative", () => {
  /** Une séance telle que la rend `INCLUDE_CARTE`, avec une réponse laissée par un retiré. */
  const SEANCE_BRUTE = {
    id: "s1",
    periodId: PERIODE,
    period: { nom: "Saison" },
    date: "2026-09-24",
    heureDebut: "19:30",
    heureFin: "21:30",
    lieu: "Gymnase municipal",
    adresse: "1 rue des Lices",
    disciplines: "Messer",
    theme: "Messer",
    alternative: "",
    annulee: false,
    motifAnnulation: null,
    instructeurs: [],
    parties: [],
    ateliers: [],
    attendances: [
      { userId: "u1", statut: "PRESENT" },
      { userId: "u2", statut: "PRESENT" },
      // Retiré de la période : il n'est plus invité, sa réponse est restée en base.
      { userId: "fantome", statut: "PRESENT" },
    ],
  };
  const INVITES = [
    { periodId: PERIODE, user: { id: "u1", prenom: "Chloé", nom: "Arnaud", couleur: null } },
    { periodId: PERIODE, user: { id: "u2", prenom: "Charlie", nom: "Bernard", couleur: null } },
  ];
  const MEMBRE = { id: "u1", role: "MEMBRE", actif: true };

  beforeEach(() => {
    reponses.set("session.findUnique", SEANCE_BRUTE);
    reponses.set("session.findMany", [SEANCE_BRUTE]);
    reponses.set("periodMember.findMany", INVITES);
  });

  it("n'annonce jamais plus de présents que sa liste n'affiche de noms", async () => {
    const { seanceCarte } = await import("@/lib/seances");
    const carte = await seanceCarte("s1", MEMBRE, MAINTENANT);
    // Le compteur brut disait 3 (la réponse du fantôme comprise) au-dessus de deux noms.
    expect(carte?.compteurs.presents).toBe(2);
    // Triés par prénom, comme partout ailleurs : Charlie avant Chloé.
    expect(carte?.participants.presents.map((p) => p.id)).toEqual(["u2", "u1"]);
    expect(carte?.compteurs.invites).toBe(2);
    expect(carte?.compteurs.pourcentage).toBe(100);
  });

  it("dit le même chiffre que le tableau de bord pour la même séance", async () => {
    const { seanceCarte } = await import("@/lib/seances");
    const carte = await seanceCarte("s1", MEMBRE, MAINTENANT);
    reponses.set("period.findUnique", {
      id: PERIODE,
      nom: "Saison",
      statut: "ACTIVE",
      membres: INVITES.map((i) => ({ addedAt: new Date("2026-08-01T10:00:00Z"), user: i.user })),
      sessions: [{ id: "s1", date: "2026-09-01", heureDebut: "20:00", theme: "Messer", annulee: false }],
    });
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, MAINTENANT);
    expect(carte?.compteurs.presents).toBe(stats?.seances[0].compteurs.presents);
    expect(carte?.compteurs.invites).toBe(stats?.seances[0].compteurs.invites);
  });

  /** Les quatre longueurs de la liste et les quatre compteurs sont le même dénombrement. */
  it("garde compteur et liste d'accord sur les quatre statuts, carte par carte", async () => {
    reponses.set("session.findMany", [
      {
        ...SEANCE_BRUTE,
        attendances: [
          { userId: "u1", statut: "PRESENT" },
          { userId: "u2", statut: "ABSENT" },
          { userId: "fantome", statut: "PEUT_ETRE" },
        ],
      },
    ]);
    const { prochainesSeances } = await import("@/lib/seances");
    const [carte] = await prochainesSeances(MEMBRE, MAINTENANT);
    const { compteurs, participants } = carte;
    expect([compteurs.presents, compteurs.absents, compteurs.peutEtre, compteurs.enAttente]).toEqual([
      participants.presents.length,
      participants.absents.length,
      participants.peutEtre.length,
      participants.sansReponse.length,
    ]);
    // Le « Peut-être » du fantôme n'entre nulle part : ni dans le compteur, ni dans la liste.
    expect(compteurs.peutEtre).toBe(0);
  });

  it("applique la même règle à l'historique personnel", async () => {
    reponses.set("period.findMany", [
      {
        id: PERIODE,
        nom: "Saison",
        statut: "ACTIVE",
        dateDebut: "2026-09-01",
        dateFin: "2026-12-20",
        membres: INVITES.map((i) => ({ user: i.user })),
        sessions: [
          {
            id: "s1",
            date: "2026-09-01",
            heureDebut: "20:00",
            heureFin: "22:00",
            lieu: "Gymnase municipal",
            theme: "Messer",
            disciplines: "Messer",
            annulee: false,
            motifAnnulation: null,
            attendances: SEANCE_BRUTE.attendances,
          },
        ],
      },
    ]);
    const { historiquePresences } = await import("@/lib/seances");
    const [periode] = await historiquePresences("u1", MAINTENANT);
    expect(periode.seances[0].compteurs.presents).toBe(periode.seances[0].participants.presents.length);
    expect(periode.seances[0].compteurs.presents).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Taux personnel : numérateur et dénominateur, mêmes séances          */
/* ------------------------------------------------------------------ */

/**
 * **Le numérateur d'un taux personnel porte sur les mêmes séances que son dénominateur.**
 *
 * Le dénominateur est devenu « ses » cours — ceux qui ont eu lieu depuis son arrivée dans la
 * période. Le numérateur, lui, restait l'agrégat de **toutes** les séances passées du trimestre.
 *
 * Ce n'est pas un cas d'école : `/admin/presences` existe précisément pour corriger la réponse de
 * n'importe qui, même après le cours (`modifierPresenceMembre` n'a volontairement aucune garde de
 * date). Le geste courant, c'est d'inscrire quelqu'un arrivé à la Toussaint puis de cocher les
 * cours d'octobre où il était venu avant d'être enregistré. Le tableau de bord lisait alors
 * « 3 présences sur 1 séance » — taux de 300 %, ramené à 100 % par la borne de `calculerTaux`,
 * donc invisible, et « sans réponse » à zéro. La borne reste (elle protège des données anciennes
 * qui passeraient par un autre chemin), mais elle ne masque plus rien d'actuel.
 */
describe("numérateur et dénominateur du taux personnel", () => {
  const SEANCES = [
    { id: "s0", date: "2026-09-01", heureDebut: "20:00", theme: "Messer", annulee: false },
    { id: "s1", date: "2026-09-03", heureDebut: "20:00", theme: "Dague", annulee: false },
    { id: "s2", date: "2026-09-05", heureDebut: "20:00", theme: "Épée", annulee: false },
    { id: "s3", date: "2026-09-15", heureDebut: "20:00", theme: "Lutte", annulee: false },
  ];
  const DATE_DE = new Map(SEANCES.map((s) => [s.id, s.date]));
  /**
   * Inga arrive le 10 septembre ; le bureau coche ensuite les trois cours de début de mois où elle
   * était venue avant d'être enregistrée, et elle manque le seul cours qui soit vraiment le sien.
   */
  const PRESENCES_DATEES = [
    { userId: "u1", sessionId: "s3", statut: "PRESENT" },
    { userId: "u2", sessionId: "s0", statut: "PRESENT" },
    { userId: "u2", sessionId: "s1", statut: "PRESENT" },
    { userId: "u2", sessionId: "s2", statut: "PRESENT" },
    { userId: "u2", sessionId: "s3", statut: "ABSENT" },
  ];

  /**
   * Faux `attendance.groupBy` qui applique **aussi** la borne de date émise par cohorte d'arrivée.
   * C'est ce qui rend ce test capable d'échouer : sans borne dans le `where`, il rend les trois
   * présences d'avant l'arrivée, exactement comme la base.
   */
  function groupByDate(args: unknown) {
    const { by, where } = args as {
      by: string[];
      where?: { user?: unknown; OR?: Array<{ userId: { in: string[] }; session?: { date: { gte: string } } }> };
    };
    const membresSeuls = Boolean(where?.user);
    const cohortes = where?.OR;
    const totaux = new Map<string, number>();
    for (const a of PRESENCES_DATEES) {
      if (membresSeuls && !MEMBRES_IDS.has(a.userId)) continue;
      const retenue = !cohortes || cohortes.some((c) => c.userId.in.includes(a.userId) && (!c.session || (DATE_DE.get(a.sessionId) ?? "") >= c.session.date.gte));
      if (!retenue) continue;
      const cle = `${by[0] === "sessionId" ? a.sessionId : a.userId}|${a.statut}`;
      totaux.set(cle, (totaux.get(cle) ?? 0) + 1);
    }
    return [...totaux].map(([cle, n]) => {
      const [valeur, statut] = cle.split("|");
      return { [by[0]]: valeur, statut, _count: { _all: n } };
    });
  }

  beforeEach(() => {
    reponses.set("attendance.groupBy", groupByDate);
    reponses.set("period.findUnique", {
      id: PERIODE,
      nom: "Saison",
      statut: "ACTIVE",
      membres: [
        { addedAt: new Date("2026-08-20T10:00:00Z"), user: { id: "u1", prenom: "Chloé", nom: "Arnaud" } },
        { addedAt: new Date("2026-09-10T10:00:00Z"), user: { id: "u2", prenom: "Inga", nom: "Vidal" } },
      ],
      sessions: SEANCES,
    });
  });

  it("ne compte pas contre quelqu'un les présences d'avant son arrivée", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const membres = (await statsPeriode(PERIODE, MAINTENANT))?.membres ?? [];
    const inga = membres.find((m) => m.id === "u2");
    // Un seul cours depuis son arrivée, et elle y était absente : 0 %, pas 100 % masqué par la borne.
    expect([inga?.presents, inga?.absents, inga?.seances]).toEqual([0, 1, 1]);
    expect(inga?.pourcentage).toBe(0);
    expect(inga?.sansReponse).toBe(0);
    // Celle qui est là depuis la rentrée garde son trimestre entier : 1 présence sur 4 cours.
    const chloe = membres.find((m) => m.id === "u1");
    expect([chloe?.presents, chloe?.seances, chloe?.pourcentage]).toEqual([1, 4, 25]);
  });

  /** L'invariant, écrit tel quel : aucune ligne du tableau ne peut annoncer « 3 sur 1 ». */
  it("ne rend jamais un membre dont les réponses dépassent ses propres séances", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    for (const m of (await statsPeriode(PERIODE, MAINTENANT))?.membres ?? []) {
      expect(m.presents + m.absents + m.peutEtre).toBeLessThanOrEqual(m.seances);
      expect(m.sansReponse).toBe(m.seances - m.presents - m.absents - m.peutEtre);
    }
  });

  it("borne l'agrégat par cohorte d'arrivée, sans une requête de plus", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    await statsPeriode(PERIODE, MAINTENANT);
    const parMembre = appelsDe("attendance", "groupBy").find((a) => (a.args.by as string[])[0] === "userId");
    expect((parMembre?.args.where as { OR?: unknown[] }).OR).toEqual([
      { userId: { in: ["u1"] }, session: { date: { gte: "2026-08-20" } } },
      { userId: { in: ["u2"] }, session: { date: { gte: "2026-09-10" } } },
    ]);
    // Le contrat de `perf-requetes.test.ts` tient : la période, puis deux agrégats. Les bornes
    // partent avec la requête qui existait déjà, elles n'en ajoutent aucune.
    expect(appels).toHaveLength(3);
  });

  it("garde le compteur par séance sur tout le monde : une séance n'a pas de date d'arrivée", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, MAINTENANT);
    // Le cours du 1er septembre a bien rassemblé Inga, même si ce cours ne compte pas dans SON taux :
    // le remplissage d'une séance est un fait, il ne se lit pas du point de vue d'un membre.
    expect(stats?.seances[0].compteurs.presents).toBe(1);
    expect(stats?.seances[3].compteurs.presents).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Ordre des membres : celui de l'écran, jusque dans le fichier CSV    */
/* ------------------------------------------------------------------ */

/**
 * **On cherche Éric à sa lettre dans le CSV, et il est tout en bas du fichier.**
 *
 * Le tableau de bord affiche les membres dans l'ordre alphabétique français : « Éric » tombe entre
 * « Emma » et « Fabien ». On clique sur « Exporter », on ouvre le fichier, on descend jusqu'au E…
 * et il n'y est pas : SQLite classe avec une collation binaire, où « É » (U+00C9) passe après
 * « Z ». Éric se retrouvait donc dernier du fichier, derrière Zoé. Deux ordres pour la même liste,
 * et l'export devient un document dans lequel on ne sait plus chercher — quelqu'un finit par
 * conclure qu'il « manque » du monde dans l'export.
 *
 * Le faux `db` rend ici les membres dans l'ordre **binaire**, celui de la base ; le tri français
 * doit donc être posé par le code, et non attendu de la requête.
 */
describe("ordre des membres du tableau de bord", () => {
  /** Ce que SQLite rend avec `orderBy: prenom asc` : « Éric » après « Zoé ». */
  const ORDRE_BINAIRE = [
    { user: { id: "u-emma", prenom: "Emma", nom: "Durand" } },
    { user: { id: "u-fabien", prenom: "Fabien", nom: "Gauthier" } },
    { user: { id: "u-zoe", prenom: "Zoé", nom: "Wagner" } },
    { user: { id: "u-eric", prenom: "Éric", nom: "Lefranc" } },
  ];

  const ORDRE_FRANCAIS = ["Emma", "Éric", "Fabien", "Zoé"];

  beforeEach(() => {
    reponses.set("attendance.groupBy", () => []);
    reponses.set("period.findUnique", {
      id: PERIODE,
      nom: "Saison",
      statut: "ACTIVE",
      membres: ORDRE_BINAIRE,
      sessions: [{ id: "s1", date: "2026-09-01", heureDebut: "20:00", theme: "Messer", annulee: false }],
    });
  });

  it("range les membres dans l'ordre alphabétique français, prénom accentué compris", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const membres = (await statsPeriode(PERIODE, MAINTENANT))?.membres ?? [];
    expect(membres.map((m) => m.prenom)).toEqual(ORDRE_FRANCAIS);
  });

  it("sort le CSV dans l'ordre affiché : Éric à sa lettre, pas en fin de fichier", async () => {
    const { csvPresences, statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, MAINTENANT);
    if (!stats) throw new Error("la période du faux client devrait exister");
    // L'export consomme `stats.membres` tel quel : c'est là, et nulle part ailleurs, que l'ordre du
    // fichier se décide. Première colonne = le prénom, entre guillemets comme toutes les cellules.
    const prenoms = csvPresences(stats, new Map())
      .split("\r\n")
      .slice(1)
      .map((l) => l.split(";")[0]);
    expect(prenoms).toEqual(ORDRE_FRANCAIS.map((p) => `"${p}"`));
  });

  it("donne exactement l'ordre que l'écran appliquerait de son côté", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const { trierMembres } = await import("@/app/(app)/gestion/tableau-de-bord/tri");
    const membres = (await statsPeriode(PERIODE, MAINTENANT))?.membres ?? [];
    // Le tableau retrie en JavaScript (`trierMembres(..., "nom")`) : si les deux règles divergeaient,
    // l'écran et le fichier téléchargé ne montreraient plus la même liste dans le même ordre.
    expect(trierMembres(membres, "nom").map((m) => m.id)).toEqual(membres.map((m) => m.id));
  });

  it("expose le comparateur, pour que la règle n'ait qu'une définition", async () => {
    const { comparerAlphabetique } = await import("@/lib/tableau-de-bord");
    const gens = [
      { prenom: "Zoé", nom: "Wagner" },
      { prenom: "Éric", nom: "Lefranc" },
      { prenom: "Emma", nom: "Durand" },
      { prenom: "Fabien", nom: "Gauthier" },
    ];
    expect([...gens].sort(comparerAlphabetique).map((p) => p.prenom)).toEqual(ORDRE_FRANCAIS);
    // Le nom de famille départage les homonymes de prénom (le club compte deux Foxtrot).
    expect(comparerAlphabetique({ prenom: "Foxtrot", nom: "Aaron" }, { prenom: "Foxtrot", nom: "Zimmer" })).toBeLessThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Le même taux personnel sur les trois écrans qui l'affichent          */
/* ------------------------------------------------------------------ */

/**
 * **Le chiffre que le membre lit doit être celui que le bureau lit.**
 *
 * La borne d'arrivée (`PeriodMember.addedAt`) n'avait été posée que sur `statsPeriode` — donc sur le
 * tableau de bord, sur l'export CSV et, par ricochet, sur l'accueil du membre, qui lit la même ligne.
 * Or **trois** écrans annoncent ce taux, et le troisième — « Mes présences » — le calcule ailleurs
 * (`historiquePresences`) et sans aucune borne : `passees` y était *tous* les cours passés non
 * annulés de la période.
 *
 * Résultat, à un onglet d'écart dans le même téléphone : quelqu'un inscrit à la Toussaint, douze
 * cours déjà passés, cinq depuis son arrivée, présent quatre fois, lisait « 80 % — 4 cours sur 5 »
 * sur son accueil et « 33 % · 4 présences sur 12 » sur « Mes présences ». C'est exactement le mal
 * que la borne visait, resté entier sur le seul écran où la personne concernée lit son propre
 * chiffre — et un taux qui compte des cours antérieurs à l'arrivée de quelqu'un n'est pas un taux,
 * c'est un reproche.
 *
 * Les deux chemins de chargement sont éprouvés : la liste entière (`maxSeances` absent) et la liste
 * bornée, qui relit les cours à part en quatre colonnes.
 */
describe("taux personnel : les trois écrans, un seul chiffre", () => {
  /** Quatre cours passés, deux semaines avant `MAINTENANT` pour les trois premiers. */
  const COURS = [
    { id: "s0", date: "2026-09-01" },
    { id: "s1", date: "2026-09-03" },
    { id: "s2", date: "2026-09-05" },
    { id: "s3", date: "2026-09-15" },
  ];
  /** Inga arrive le 10 septembre ; le bureau coche après coup les trois cours d'avant, où elle était
   *  venue sans être encore inscrite, et elle manque le seul cours qui soit vraiment le sien. */
  const ARRIVEES = new Map([
    ["u1", new Date("2026-08-20T10:00:00Z")],
    ["u2", new Date("2026-09-10T10:00:00Z")],
  ]);
  const REPONSES = [
    { userId: "u1", sessionId: "s3", statut: "PRESENT" },
    { userId: "u2", sessionId: "s0", statut: "PRESENT" },
    { userId: "u2", sessionId: "s1", statut: "PRESENT" },
    { userId: "u2", sessionId: "s2", statut: "PRESENT" },
    { userId: "u2", sessionId: "s3", statut: "ABSENT" },
  ];
  const DATE_DE = new Map(COURS.map((s) => [s.id, s.date]));
  const MEMBRES = [
    { addedAt: ARRIVEES.get("u1"), user: { id: "u1", prenom: "Chloé", nom: "Arnaud", couleur: null } },
    { addedAt: ARRIVEES.get("u2"), user: { id: "u2", prenom: "Inga", nom: "Vidal", couleur: null } },
  ];

  /** Faux agrégat qui applique la borne d'arrivée émise par cohorte (comme la base le ferait). */
  function groupByBorne(args: unknown) {
    const { by, where } = args as {
      by: string[];
      where?: { user?: unknown; OR?: Array<{ userId: { in: string[] }; session?: { date: { gte: string } } }> };
    };
    const cohortes = where?.OR;
    const totaux = new Map<string, number>();
    for (const a of REPONSES) {
      if (where?.user && !MEMBRES_IDS.has(a.userId)) continue;
      const retenue = !cohortes || cohortes.some((c) => c.userId.in.includes(a.userId) && (!c.session || (DATE_DE.get(a.sessionId) ?? "") >= c.session.date.gte));
      if (!retenue) continue;
      const cle = `${by[0] === "sessionId" ? a.sessionId : a.userId}|${a.statut}`;
      totaux.set(cle, (totaux.get(cle) ?? 0) + 1);
    }
    return [...totaux].map(([cle, n]) => {
      const [valeur, statut] = cle.split("|");
      return { [by[0]]: valeur, statut, _count: { _all: n } };
    });
  }

  /** La période telle que la lit « Mes présences » : ses séances portent les réponses de tout le club. */
  function periodePourHistorique() {
    return [
      {
        id: PERIODE,
        nom: "Saison",
        statut: "ACTIVE",
        dateDebut: "2026-09-01",
        dateFin: "2026-12-20",
        membres: MEMBRES,
        sessions: [...COURS].reverse().map((s) => ({
          id: s.id,
          date: s.date,
          heureDebut: "20:00",
          heureFin: "22:00",
          lieu: "Gymnase municipal",
          theme: "Messer",
          disciplines: "Messer",
          annulee: false,
          motifAnnulation: null,
          attendances: REPONSES.filter((r) => r.sessionId === s.id).map((r) => ({ userId: r.userId, statut: r.statut })),
        })),
      },
    ];
  }

  beforeEach(() => {
    reponses.set("attendance.groupBy", groupByBorne);
    reponses.set("period.findMany", periodePourHistorique());
    reponses.set("period.findUnique", {
      id: PERIODE,
      nom: "Saison",
      statut: "ACTIVE",
      membres: MEMBRES.map(({ addedAt, user }) => ({ addedAt, user: { id: user.id, prenom: user.prenom, nom: user.nom } })),
      sessions: COURS.map((s) => ({ id: s.id, date: s.date, heureDebut: "20:00", theme: "Messer", annulee: false })),
    });
  });

  it("ne compte à personne les cours d'avant son arrivée dans « Mes présences »", async () => {
    const { historiquePresences } = await import("@/lib/seances");
    const [periode] = await historiquePresences("u2", MAINTENANT);
    // Un seul cours depuis son arrivée, et elle y était absente. Sans borne : « 75 % · 3 sur 4 ».
    expect([periode.presences, periode.comptees, periode.pourcentage]).toEqual([0, 1, 0]);
  });

  it("garde son trimestre entier à qui est là depuis la rentrée", async () => {
    const { historiquePresences } = await import("@/lib/seances");
    const [periode] = await historiquePresences("u1", MAINTENANT);
    expect([periode.presences, periode.comptees, periode.pourcentage]).toEqual([1, 4, 25]);
  });

  it("annonce le même taux que le tableau de bord — donc que l'accueil, qui lit la même ligne", async () => {
    const { historiquePresences } = await import("@/lib/seances");
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const membres = (await statsPeriode(PERIODE, MAINTENANT))?.membres ?? [];
    for (const id of ["u1", "u2"]) {
      const [periode] = await historiquePresences(id, MAINTENANT);
      const ligne = membres.find((m) => m.id === id);
      expect([periode.pourcentage, periode.presences, periode.comptees], id).toEqual([ligne?.pourcentage, ligne?.presents, ligne?.seances]);
    }
  });

  it("borne aussi le chemin où la liste des séances est coupée (relecture en quatre colonnes)", async () => {
    // `maxSeances` défini : le taux ne se déduit plus des séances affichées mais d'une seconde
    // lecture, légère, de tous les cours de la période. Elle doit porter la même borne.
    reponses.set(
      "session.findMany",
      COURS.map((s) => ({
        periodId: PERIODE,
        date: s.date,
        heureDebut: "20:00",
        annulee: false,
        attendances: REPONSES.filter((r) => r.sessionId === s.id && r.userId === "u2").map((r) => ({ statut: r.statut })),
      })),
    );
    const { historiquePresences } = await import("@/lib/seances");
    const [periode] = await historiquePresences("u2", MAINTENANT, 2);
    expect([periode.presences, periode.comptees, periode.pourcentage]).toEqual([0, 1, 0]);
  });

  /**
   * **La règle tranchée, du côté du fichier.**
   *
   * Le CSV effaçait les cellules d'avant l'arrivée, pour que la ligne ne compte pas plus de réponses
   * que de « Présences ». Mais le compteur **par séance**, lui, n'a aucune borne — le remplissage d'un
   * cours est un fait, la fiche de la séance et `/admin/presences` le disent —, si bien que la même
   * séance valait 8 présents sur le tableau de bord et 7 cellules dans le fichier. Deux pièces qui ne
   * disent pas la même chose du même soir, et une donnée saisie invisible partout sauf dans un total.
   *
   * On ne masque donc plus rien : la cellule dit ce qui a été saisi, et c'est la colonne **« Arrivée »**
   * — plus les intitulés « depuis l'arrivée » des trois totaux — qui explique l'écart. Voir
   * `csvPresences` pour la règle écrite en entier, et `tests/unit/tableau-de-bord-fenetre.test.ts`
   * pour les deux bouts éprouvés ensemble.
   */
  it("montre la cellule d'un cours d'avant l'arrivée, et écrit la date qui explique l'écart", async () => {
    const { csvPresences, statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, MAINTENANT);
    if (!stats) throw new Error("la période du faux client devrait exister");
    const brut = new Map<string, Map<string, string>>();
    for (const r of REPONSES) {
      if (!brut.has(r.sessionId)) brut.set(r.sessionId, new Map());
      brut.get(r.sessionId)!.set(r.userId, r.statut);
    }
    const lignes = csvPresences(stats, brut).split("\r\n");
    const inga = lignes.find((l) => l.includes("Inga"))!.split(";");
    // Prénom, nom, **arrivée**, puis une colonne par cours donné : ses trois « Présent » d'avant
    // l'inscription sont là, son absence au seul cours qui soit le sien aussi.
    expect(inga[2]).toBe('"2026-09-10"');
    expect(inga.slice(3, 7)).toEqual(['"PRESENT"', '"PRESENT"', '"PRESENT"', '"ABSENT"']);
    // Et les trois totaux restent bornés à son arrivée : c'est son taux, pas le registre du club.
    expect(inga.slice(7)).toEqual(['"0"', '"1"', '"0"']);
  });
});
