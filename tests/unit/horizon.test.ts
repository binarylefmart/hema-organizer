import { describe, expect, it } from "vitest";
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
    // Le cours du jour n'y est pas : il ne rejoint le passé que le lendemain.
    expect(filtrerHorizonPasse(seances, "2mois", AUJ).map((s) => s.date)).toEqual(["2026-09-08", "2026-09-18"]);
    expect(filtrerHorizonPasse(seances, "semaine", AUJ).map((s) => s.date)).toEqual(["2026-09-18"]);
    expect(filtrerHorizonPasse(seances, "prochain", AUJ).map((s) => s.date)).toEqual(["2026-09-18"]);
  });
});

/**
 * **La fenêtre « passé » se referme à la veille, pas au début du cours** (`seancePassee`, demande de
 * Delta) : le cours du jour, commencé ou non, reste parmi les cours à venir jusqu'à minuit — la règle
 * du planning et de l'onglet Séances, que le tableau de bord, l'historique et l'accueil reçoivent
 * par cette fonction. Un mardi à 18 h comme à 21 h, l'horizon « Dernier cours » montre le cours de
 * vendredi dernier, jamais celui du soir.
 */
describe("la frontière du passé est le lendemain du cours", () => {
  const JOUR = "2026-09-22";
  /** Le même trimestre : deux cours ce mardi-là, à 10 h et à 20 h. */
  const avecHeures = [
    { date: "2026-09-15", heureDebut: "20:00" },
    { date: "2026-09-18", heureDebut: "20:00" },
    { date: JOUR, heureDebut: "10:00" },
    { date: JOUR, heureDebut: "20:00" },
    { date: "2026-09-25", heureDebut: "20:00" },
  ];

  it("ne retient jamais un cours du jour comme « dernier cours », même commencé", () => {
    expect(filtrerHorizonPasse(avecHeures, "prochain", JOUR)).toEqual([{ date: "2026-09-18", heureDebut: "20:00" }]);
    // Le lendemain, c'est celui de 20 h : le dernier du jour écoulé.
    expect(filtrerHorizonPasse(avecHeures, "prochain", "2026-09-23")).toEqual([{ date: JOUR, heureDebut: "20:00" }]);
  });

  it("arrête la semaine écoulée à la veille", () => {
    const semaine = filtrerHorizonPasse(avecHeures, "semaine", JOUR).map((s) => `${s.date} ${s.heureDebut}`);
    // Elle part du 15 (sept jours en arrière) et s'arrête au 18 : aucun cours du 22, ni de vendredi.
    expect(semaine).toEqual(["2026-09-15 20:00", "2026-09-18 20:00"]);
  });

  it("garde « toute la période » entière, cours à venir compris : c'est le tableau de bord du trimestre", () => {
    // Le tableau de bord montre aussi les réponses déjà reçues pour les cours à venir ; seule la
    // fenêtre resserrée regarde le passé.
    expect(filtrerHorizonPasse(avecHeures, "periode", JOUR)).toHaveLength(5);
  });
});
