import { beforeEach, describe, expect, it, vi } from "vitest";
import { parisDateTime } from "@/lib/dates";

/**
 * **Le tableau de bord, sa fenêtre de temps et son export : trois pièces qui doivent dire la même
 * chose de la même séance**.
 *
 * Trois défauts vivaient ensemble ici, et ils se tiennent par la même question — *de quoi parle ce
 * chiffre : d'un soir de cours, ou d'une personne ?*
 *
 * 1. **La fenêtre « passé » se referme à la veille** (`seancePassee`, demande de Delta) : le cours
 *    du jour, commencé ou non, ne compte qu'à partir du lendemain — la règle du planning et de
 *    l'onglet Séances. Un mardi soir, l'horizon « Dernier cours » montre le cours de la semaine
 *    dernière, jamais une ligne à « 0 % » pour un cours qui se donne encore.
 * 2. **Le CSV effaçait une cellule** avant l'arrivée de la personne, pendant que le compteur de la
 *    séance comptait tout le monde : la ligne « 01/09 » annonçait 8 présents et la colonne du fichier
 *    n'en portait que 7.
 * 3. **Le CSV gardait les colonnes des séances à venir**, cellules remplies : huit réponses en face
 *    d'une colonne « Présences » qui en annonçait cinq.
 *
 * **La règle tranchée, et elle est écrite ici comme dans `csvPresences` :** le remplissage d'une
 * séance est un fait (aucune borne d'arrivée), le taux d'une personne s'arrête à son arrivée dans la
 * période, et c'est la colonne « Arrivée » du fichier qui relie les deux. Une donnée saisie n'est
 * jamais masquée pour faire coïncider une colonne avec un total.
 *
 * La base n'est jamais touchée : `@/lib/db` est remplacé par un faux client qui applique les filtres
 * réellement émis (fenêtre de séances, appartenance à la période, cohortes d'arrivée), pour que ces
 * tests soient capables d'échouer.
 */

const PERIODE = "p1";

/** Ce mardi-là : deux cours, à 10 h et à 20 h. */
const MARDI = "2026-09-22";
/** 20 h 30 à Paris : les deux cours du mardi ont commencé, aucun n'est encore passé. */
const PENDANT_LE_COURS_DU_SOIR = parisDateTime(MARDI, "20:30");
/** Le lendemain matin : les deux cours du mardi ont rejoint le passé. */
const LE_LENDEMAIN = parisDateTime("2026-09-23", "08:00");

/**
 * Cinq séances : trois cours déjà donnés, le cours du soir de ce mardi, et un cours de jeudi.
 * Toutes non annulées — l'annulation a ses propres cas ailleurs.
 */
const SESSIONS = [
  { id: "s0", date: "2026-09-01", heureDebut: "20:00" },
  { id: "s1", date: "2026-09-15", heureDebut: "20:00" },
  { id: "s2", date: MARDI, heureDebut: "10:00" },
  { id: "s3", date: MARDI, heureDebut: "20:00" },
  { id: "s4", date: "2026-09-25", heureDebut: "20:00" },
];

/** Chloé est là depuis la rentrée ; Inga s'inscrit le 10 septembre. */
const MEMBRES = [
  { addedAt: new Date("2026-08-20T10:00:00Z"), user: { id: "u1", prenom: "Chloé", nom: "Arnaud" } },
  { addedAt: new Date("2026-09-10T10:00:00Z"), user: { id: "u2", prenom: "Inga", nom: "Vidal" } },
];
const MEMBRES_IDS = new Set(MEMBRES.map((m) => m.user.id));

/**
 * Les réponses en base. Deux choses s'y jouent :
 * - **Inga porte un « Présent » sur le cours du 1er septembre**, d'avant son inscription : elle était
 *   venue en essai, et le bureau l'a cochée après coup depuis `/admin/presences` ;
 * - **Chloé a répondu « Présent » au cours de jeudi**, qui n'a pas encore eu lieu : une intention,
 *   pas une présence.
 */
const REPONSES = [
  { userId: "u1", sessionId: "s0", statut: "PRESENT" },
  { userId: "u2", sessionId: "s0", statut: "PRESENT" },
  { userId: "u1", sessionId: "s1", statut: "PRESENT" },
  { userId: "u2", sessionId: "s1", statut: "PRESENT" },
  { userId: "u1", sessionId: "s2", statut: "PRESENT" },
  { userId: "u2", sessionId: "s2", statut: "ABSENT" },
  { userId: "u1", sessionId: "s4", statut: "PRESENT" },
];
const DATE_DE = new Map(SESSIONS.map((s) => [s.id, s.date]));

const { fauxDb } = vi.hoisted(() => {
  return {
    fauxDb: {
      period: { findUnique: vi.fn() },
      attendance: { groupBy: vi.fn() },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: fauxDb }));

/** Séances visées par un agrégat : une liste d'identifiants, ou toute la période. */
function seancesVisees(where: Record<string, unknown>): string[] {
  const parId = where.sessionId as { in: string[] } | undefined;
  if (parId) return parId.in;
  return SESSIONS.map((s) => s.id);
}

/**
 * Faux `attendance.groupBy` : il applique **tous** les filtres émis — la fenêtre de séances,
 * l'appartenance à la période et les cohortes d'arrivée (`OR`). Sans cela, un test ne pourrait pas
 * distinguer un compteur borné d'un compteur qui ne l'est pas, c'est-à-dire tout l'objet du fichier.
 */
function groupBy(args: unknown) {
  const { by, where } = args as {
    by: string[];
    where: Record<string, unknown> & { user?: unknown; OR?: Array<{ userId: { in: string[] }; session?: { date: { gte: string } } }> };
  };
  const vises = new Set(seancesVisees(where));
  const cohortes = where.OR;
  const totaux = new Map<string, number>();
  for (const r of REPONSES) {
    if (!vises.has(r.sessionId)) continue;
    if (where.user && !MEMBRES_IDS.has(r.userId)) continue;
    const borne = !cohortes || cohortes.some((c) => c.userId.in.includes(r.userId) && (!c.session || (DATE_DE.get(r.sessionId) ?? "") >= c.session.date.gte));
    if (!borne) continue;
    const cle = `${by[0] === "sessionId" ? r.sessionId : r.userId}|${r.statut}`;
    totaux.set(cle, (totaux.get(cle) ?? 0) + 1);
  }
  return [...totaux].map(([cle, n]) => {
    const [valeur, statut] = cle.split("|");
    return { [by[0]]: valeur, statut, _count: { _all: n } };
  });
}

beforeEach(() => {
  fauxDb.period.findUnique.mockReset();
  fauxDb.attendance.groupBy.mockReset();
  fauxDb.period.findUnique.mockImplementation(async () => ({
    id: PERIODE,
    nom: "T4 2026",
    statut: "ACTIVE",
    membres: MEMBRES,
    sessions: SESSIONS.map((s) => ({ ...s, theme: "Messer", annulee: false })),
  }));
  fauxDb.attendance.groupBy.mockImplementation(async (args: unknown) => groupBy(args));
});

/** Les réponses brutes telles que la route d'export les rapatrie : sans aucune borne de date. */
function brut(): Map<string, Map<string, string>> {
  const parSeance = new Map<string, Map<string, string>>();
  for (const r of REPONSES) {
    if (!parSeance.has(r.sessionId)) parSeance.set(r.sessionId, new Map());
    parSeance.get(r.sessionId)!.set(r.userId, r.statut);
  }
  return parSeance;
}

describe("la fenêtre de temps du tableau de bord", () => {
  it("ne prend jamais pour « dernier cours » un cours du jour, même commencé", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, PENDANT_LE_COURS_DU_SOIR, "prochain");
    // 20 h 30 : les cours de 10 h et de 20 h ont commencé, le dernier cours **passé** reste le 15.
    expect(stats?.seances.map((s) => s.id)).toEqual(["s1"]);
    expect(stats?.seances[0].passee).toBe(true);
  });

  it("annonce la moyenne et les taux de ce cours-là, et non un écran tout à zéro", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, PENDANT_LE_COURS_DU_SOIR, "prochain");
    // Deux présents sur deux invités, le 15 : 100 %.
    expect(stats?.moyenne).toBe(100);
    const chloe = stats?.membres.find((m) => m.id === "u1");
    expect([chloe?.presents, chloe?.seances, chloe?.pourcentage]).toEqual([1, 1, 100]);
    const inga = stats?.membres.find((m) => m.id === "u2");
    expect([inga?.presents, inga?.seances, inga?.pourcentage]).toEqual([1, 1, 100]);
  });

  it("garde les cours du jour hors de la fenêtre resserrée, et les y fait entrer le lendemain", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const pendant = await statsPeriode(PERIODE, PENDANT_LE_COURS_DU_SOIR, "semaine");
    expect(pendant?.seances.map((s) => s.id)).toEqual(["s1"]);
    // Le mercredi, la semaine écoulée part du 16 : les deux cours du mardi, et eux seuls.
    const lendemain = await statsPeriode(PERIODE, LE_LENDEMAIN, "semaine");
    expect(lendemain?.seances.map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("garde en revanche tout le trimestre sur « toute la période », cours à venir compris", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, PENDANT_LE_COURS_DU_SOIR);
    expect(stats?.seances.map((s) => s.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    // Le tableau montre aussi les réponses déjà reçues pour ce qui vient : `passee` les distingue,
    // et les cours du jour n'en sont qu'à partir du lendemain.
    expect(stats?.seances.map((s) => s.passee)).toEqual([true, true, false, false, false]);
  });
});

describe("le remplissage d'une séance et le taux d'une personne", () => {
  it("compte la séance sur tout le monde, y compris une réponse d'avant l'arrivée", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, PENDANT_LE_COURS_DU_SOIR);
    // Le cours du 1er septembre a bien rassemblé deux personnes : Inga y était, en essai. La fiche
    // de la séance et `/admin/presences` le disent, ce total doit le dire aussi.
    expect(stats?.seances.find((s) => s.id === "s0")?.compteurs.presents).toBe(2);
  });

  it("ne compte pas ce cours-là dans le taux d'Inga : il est d'avant son inscription", async () => {
    const { statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, LE_LENDEMAIN);
    const inga = stats?.membres.find((m) => m.id === "u2");
    // Le lendemain : trois cours depuis son arrivée (s1, s2, s3), une présence, 33 %. Le « Présent »
    // du 1er septembre n'est ni au numérateur ni au dénominateur — on ne compte à personne les cours
    // d'avant son arrivée.
    expect([inga?.presents, inga?.seances, inga?.pourcentage]).toEqual([1, 3, 33]);
    expect(inga?.arrivee).toBe("2026-09-10");
  });
});

describe("l'export CSV", () => {
  it("n'efface plus une cellule : elle dit ce qui a été saisi, arrivée ou pas", async () => {
    const { csvPresences, statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, LE_LENDEMAIN);
    if (!stats) throw new Error("la période du faux client devrait exister");
    const lignes = csvPresences(stats, brut()).split("\r\n");
    const inga = lignes.find((l) => l.includes("Inga"))!.split(";");
    // Prénom, nom, arrivée, puis une colonne par cours donné : le « Présent » du 1er septembre est là.
    expect(inga.slice(0, 3)).toEqual(['"Inga"', '"Vidal"', '"2026-09-10"']);
    // Le lendemain, les quatre cours donnés : le 1er, le 15, et les deux du mardi (Inga n'a rien dit à 20 h).
    expect(inga.slice(3, 7)).toEqual(['"PRESENT"', '"PRESENT"', '"ABSENT"', '""']);
    // Et la ligne assume de porter deux « Présent » pour une seule présence comptée : c'est la date
    // d'arrivée qui l'explique, et c'est pour ça qu'elle est écrite juste à côté du nom.
    expect(inga.slice(7)).toEqual(['"1"', '"3"', '"33"']);
  });

  it("dit dans son en-tête que les trois totaux s'arrêtent à l'arrivée", async () => {
    const { csvPresences, statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, PENDANT_LE_COURS_DU_SOIR);
    if (!stats) throw new Error("la période du faux client devrait exister");
    const entete = csvPresences(stats, brut()).split("\r\n")[0].split(";");
    expect(entete.slice(0, 3)).toEqual(['"Prénom"', '"Nom"', '"Arrivée"']);
    expect(entete.slice(-3)).toEqual(['"Présences depuis l\'arrivée"', '"Séances depuis l\'arrivée"', '"Taux % depuis l\'arrivée"']);
  });

  it("ne donne aucune colonne aux séances qui n'ont pas eu lieu", async () => {
    const { csvPresences, statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, PENDANT_LE_COURS_DU_SOIR);
    if (!stats) throw new Error("la période du faux client devrait exister");
    const lignes = csvPresences(stats, brut()).split("\r\n");
    const entete = lignes[0];
    // Les deux cours passés ont leur colonne…
    for (const date of ["2026-09-01 20:00", "2026-09-15 20:00"]) expect(entete).toContain(date);
    // …les deux du jour, commencés, et celui de jeudi, non : ils ne sont passés que le lendemain.
    expect(entete).not.toContain("2026-09-22 10:00");
    expect(entete).not.toContain("2026-09-22 20:00");
    expect(entete).not.toContain("2026-09-25 20:00");
    // Chloé a répondu « Présent » à mardi 10 h et à jeudi : la ligne compte deux cellules de réponse,
    // comme ses deux cours passés — et non quatre en face d'une colonne « Présences » qui en annonce deux.
    const chloe = lignes.find((l) => l.includes("Chloé"))!.split(";");
    expect(chloe).toHaveLength(3 + 2 + 3);
    expect(chloe.slice(3, 5)).toEqual(['"PRESENT"', '"PRESENT"']);
    expect(chloe.slice(5)).toEqual(['"2"', '"2"', '"100"']);
  });

  it("suit la fenêtre de temps de l'écran, colonnes comme totaux", async () => {
    const { csvPresences, statsPeriode } = await import("@/lib/tableau-de-bord");
    const stats = await statsPeriode(PERIODE, PENDANT_LE_COURS_DU_SOIR, "prochain");
    if (!stats) throw new Error("la période du faux client devrait exister");
    const entete = csvPresences(stats, brut()).split("\r\n")[0];
    // « Dernier cours » : une seule colonne de séance, celle du 15 — pas un cours du jour.
    expect(entete).toContain("2026-09-15 20:00");
    expect(entete).not.toContain("2026-09-01 20:00");
    expect(entete).not.toContain("2026-09-22 10:00");
  });
});
