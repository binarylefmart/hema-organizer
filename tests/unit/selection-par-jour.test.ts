import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDays, isoWeekday } from "@/lib/dates";
import { basculerJour, CHOIX_JOUR_VIDE, entreesJours, jourDeSemaine, joursProposes, LIBELLE_PAR_JOUR, libelleJour } from "@/components/ui/selection";

/**
 * **« Sélectionner par jour »** — la liste dépliante posée à côté de la case maîtresse du planning en
 * mode modification : une entrée par jour de la semaine présent parmi les cartes affichées, du lundi
 * au dimanche, jamais deux jours groupés. Choisir ajoute ces séances ; quand elles y sont toutes,
 * l'entrée devient « Retirer les mardis » et les retire.
 */

/** Un trimestre du mardi et du vendredi : trois semaines à partir du mardi 6 octobre 2026. */
const MARDI = "2026-10-06";
const VENDREDI = "2026-10-09";
const seances = [0, 7, 14].flatMap((d) => [
  { id: `ma-${d}`, date: addDays(MARDI, d) },
  { id: `ve-${d}`, date: addDays(VENDREDI, d) },
]);

describe("le jour de la semaine d'une date", () => {
  it("dit la même chose que `isoWeekday`, sur deux ans entiers (changements d'heure compris)", () => {
    for (let i = 0; i < 730; i++) {
      const iso = addDays("2026-01-01", i);
      expect(jourDeSemaine(iso), iso).toBe(isoWeekday(iso));
    }
  });

  it("ne dépend pas du fuseau : le mardi reste un mardi", () => {
    expect(jourDeSemaine(MARDI)).toBe(2);
    expect(jourDeSemaine("2026-10-11")).toBe(7);
  });
});

describe("les entrées proposées", () => {
  it("une entrée par jour présent, du lundi au dimanche, avec le nombre de séances affichées", () => {
    const jours = joursProposes(seances, new Set());
    expect(jours.map((j) => j.libelle)).toEqual(["Tous les mardis (3)", "Tous les vendredis (3)"]);
    expect(jours[0].ids).toEqual(["ma-0", "ma-7", "ma-14"]);
  });

  it("lundi, mercredi et dimanche donnent trois entrées séparées, dans l'ordre de la semaine", () => {
    const lignes = [
      { id: "d", date: "2026-10-11" },
      { id: "l", date: "2026-10-05" },
      { id: "me", date: "2026-10-07" },
      { id: "l2", date: "2026-10-12" },
    ];
    expect(joursProposes(lignes, new Set()).map((j) => j.libelle)).toEqual(["Tous les lundis (2)", "Le mercredi (1)", "Le dimanche (1)"]);
  });

  it("un seul jour présent garde son entrée", () => {
    expect(joursProposes([{ id: "a", date: MARDI }, { id: "b", date: addDays(MARDI, 7) }], new Set()).map((j) => j.libelle)).toEqual(["Tous les mardis (2)"]);
  });

  it("aucune ligne, aucune entrée", () => {
    expect(joursProposes([], new Set())).toEqual([]);
  });

  it("devient « Retirer les mardis » quand tous les mardis affichés sont cochés", () => {
    const jours = joursProposes(seances, new Set(["ma-0", "ma-7", "ma-14", "ve-0"]));
    expect(jours.map((j) => [j.libelle, j.complet])).toEqual([
      ["Retirer les mardis (3)", true],
      ["Tous les vendredis (3)", false],
    ]);
    expect(libelleJour("mardi", 1, true)).toBe("Retirer le mardi (1)");
  });

  it("la liste s'ouvre sur « Choisir un jour… », puis un jour par entrée", () => {
    expect(LIBELLE_PAR_JOUR).toBe("Sélectionner par jour");
    expect(entreesJours(joursProposes(seances, new Set()))).toEqual([
      { ...CHOIX_JOUR_VIDE },
      { valeur: "2", libelle: "Tous les mardis (3)" },
      { valeur: "5", libelle: "Tous les vendredis (3)" },
    ]);
  });
});

describe("choisir une entrée", () => {
  it("ajoute les séances du jour sans toucher au reste du lot", () => {
    const [mardis] = joursProposes(seances, new Set(["ve-7"]));
    expect([...basculerJour(new Set(["ve-7"]), mardis)].sort()).toEqual(["ma-0", "ma-14", "ma-7", "ve-7"]);
  });

  it("retire les séances du jour quand elles y étaient toutes, et elles seules", () => {
    const avant = new Set(["ma-0", "ma-7", "ma-14", "ve-0"]);
    const [mardis] = joursProposes(seances, avant);
    expect([...basculerJour(avant, mardis)]).toEqual(["ve-0"]);
  });

  it("cumuler deux jours, c'est choisir deux entrées", () => {
    let lot: Set<string> = new Set();
    for (const j of joursProposes(seances, lot)) lot = basculerJour(lot, j);
    expect(lot.size).toBe(6);
  });

  it("ne reçoit pas la sélection d'origine en la modifiant (c'est un état React)", () => {
    const avant = new Set<string>();
    basculerJour(avant, joursProposes(seances, avant)[0]);
    expect(avant.size).toBe(0);
  });
});

describe("le planning seulement", () => {
  const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  it("la sélection du planning s'en sert, l'onglet Séances non", () => {
    expect(source("src/components/planning/SelectionPlanning.tsx")).toContain("joursProposes(affichees, selection)");
    expect(source("src/components/seances/SelectionSeances.tsx")).not.toContain("joursProposes");
  });

  it("ne porte que sur les cartes affichées", () => {
    // Les mêmes lignes que la case maîtresse : jamais toute la liste en silence.
    const code = source("src/components/planning/SelectionPlanning.tsx");
    expect(code).toContain("etatToutCocher(affichees, selection)");
    expect(code).toMatch(/<ListeDeroulante[\s\S]*?valeur=\{CHOIX_JOUR_VIDE\.valeur\}/);
  });
});
