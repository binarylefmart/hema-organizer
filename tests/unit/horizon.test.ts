import { describe, expect, it } from "vitest";
import { parisDateTime } from "@/lib/dates";
import { filtrerHorizon, filtrerHorizonPasse, HORIZONS, lireHorizon } from "@/lib/horizon";

const AUJ = "2026-09-22";
const seances = [
  { date: "2026-09-08" },
  { date: "2026-09-18" },
  { date: "2026-09-22" },
  { date: "2026-09-25" },
  { date: "2026-10-02" },
  { date: "2026-10-15" },
  { date: "2026-11-30" },
];
const aVenir = seances.filter((s) => s.date >= AUJ);

describe("fenêtre de temps", () => {
  it("lit la fenêtre demandée et retombe sur la période", () => {
    expect(lireHorizon("semaine")).toBe("semaine");
    expect(lireHorizon("n'importe quoi")).toBe("periode");
    expect(lireHorizon(undefined)).toBe("periode");
    expect(lireHorizon("2mois")).toBe("2mois");
    expect(HORIZONS).toEqual(["periode", "2mois", "mois", "2semaines", "semaine", "prochain"]);
  });

  it("resserre les séances à venir, de la période au prochain cours", () => {
    expect(filtrerHorizon(aVenir, "periode", AUJ)).toHaveLength(5);
    // « 2 mois » s'arrête au 21 novembre : la séance du 30 reste au trimestre entier
    expect(filtrerHorizon(aVenir, "2mois", AUJ).map((s) => s.date)).toEqual(["2026-09-22", "2026-09-25", "2026-10-02", "2026-10-15"]);
    expect(filtrerHorizon(aVenir, "mois", AUJ).map((s) => s.date)).toEqual(["2026-09-22", "2026-09-25", "2026-10-02", "2026-10-15"]);
    expect(filtrerHorizon(aVenir, "2semaines", AUJ).map((s) => s.date)).toEqual(["2026-09-22", "2026-09-25", "2026-10-02"]);
    expect(filtrerHorizon(aVenir, "semaine", AUJ).map((s) => s.date)).toEqual(["2026-09-22", "2026-09-25"]);
    expect(filtrerHorizon(aVenir, "prochain", AUJ).map((s) => s.date)).toEqual(["2026-09-22"]);
  });

  it("resserre aussi vers le passé (tableau de bord)", () => {
    expect(filtrerHorizonPasse(seances, "periode", AUJ)).toHaveLength(7);
    expect(filtrerHorizonPasse(seances, "2mois", AUJ).map((s) => s.date)).toEqual(["2026-09-08", "2026-09-18", "2026-09-22"]);
    expect(filtrerHorizonPasse(seances, "semaine", AUJ).map((s) => s.date)).toEqual(["2026-09-18", "2026-09-22"]);
    expect(filtrerHorizonPasse(seances, "prochain", AUJ).map((s) => s.date)).toEqual(["2026-09-22"]);
  });
});

/**
 * **La fenêtre « passé » se referme au début du cours, pas à minuit**.
 *
 * Le découpage se faisait sur `s.date <= aujourdHui` : un mardi à 18 h, le cours de 20 h comptait
 * déjà pour passé. Les écrans de séances ne le voyaient pas — ils pré-filtrent avec `seanceCommencee`
 * avant d'appeler (`src/components/filtres/temps.ts`) — mais le tableau de bord, non : son horizon
 * « Dernier cours » retenait **le cours du soir non commencé**, affichait « moyenne 0 % », une seule
 * ligne, et tout le club à « 0 présence / 0 séance / 0 % », sans montrer le cours de jeudi dernier.
 * Un compensateur posé d'un côté et pas de l'autre est un défaut en attente : la règle est donc dans
 * la fonction, et ces cas l'y tiennent.
 */
describe("la frontière du passé est le début du cours", () => {
  const JOUR = "2026-09-22";
  /** Le même trimestre, horaires compris : deux cours ce mardi-là, à 10 h et à 20 h. */
  const avecHeures = [
    { date: "2026-09-15", heureDebut: "20:00" },
    { date: "2026-09-18", heureDebut: "20:00" },
    { date: JOUR, heureDebut: "10:00" },
    { date: JOUR, heureDebut: "20:00" },
    { date: "2026-09-25", heureDebut: "20:00" },
  ];
  /** 18 h à Paris : le cours du matin a eu lieu, celui de 20 h non. */
  const AVANT_LE_COURS = parisDateTime(JOUR, "18:00");
  /** 20 h 30 : il a commencé. */
  const APRES_LE_COURS = parisDateTime(JOUR, "20:30");

  it("ne retient pas comme « dernier cours » celui qui n'a pas commencé", () => {
    // C'est le défaut lui-même : à 18 h, le dernier cours **donné** est celui de 10 h.
    expect(filtrerHorizonPasse(avecHeures, "prochain", JOUR, AVANT_LE_COURS)).toEqual([{ date: JOUR, heureDebut: "10:00" }]);
    // Et dès 20 h 30, c'est celui du soir : la bascule se fait à l'heure du cours, pas à minuit.
    expect(filtrerHorizonPasse(avecHeures, "prochain", JOUR, APRES_LE_COURS)).toEqual([{ date: JOUR, heureDebut: "20:00" }]);
  });

  it("garde le cours du soir hors de la fenêtre tant qu'il n'a pas commencé", () => {
    const semaine = filtrerHorizonPasse(avecHeures, "semaine", JOUR, AVANT_LE_COURS).map((s) => `${s.date} ${s.heureDebut}`);
    // La semaine écoulée part du 15 (sept jours en arrière) et s'arrête au cours de 10 h.
    expect(semaine).toEqual(["2026-09-15 20:00", "2026-09-18 20:00", "2026-09-22 10:00"]);
    expect(semaine).not.toContain("2026-09-22 20:00");
    // Le cours à venir de vendredi n'y est jamais : la fenêtre regarde le passé.
    expect(semaine).not.toContain("2026-09-25 20:00");
  });

  it("garde « toute la période » entière, cours à venir compris : c'est le tableau de bord du trimestre", () => {
    // Le tableau de bord montre aussi les réponses déjà reçues pour les cours à venir ; seule la
    // fenêtre resserrée regarde le passé.
    expect(filtrerHorizonPasse(avecHeures, "periode", JOUR, AVANT_LE_COURS)).toHaveLength(5);
  });

  it("retombe sur la date seule quand la séance ne porte pas son heure", () => {
    // Une liste qui ne porte que des dates (jeu d'essai, frise) garde l'ancien comportement : c'est
    // le repli le plus prudent, et il n'y a rien d'autre à comparer.
    expect(filtrerHorizonPasse([{ date: JOUR }], "prochain", JOUR, AVANT_LE_COURS)).toEqual([{ date: JOUR }]);
  });
});
