import { describe, expect, it } from "vitest";
import {
  bilanApplication,
  elementsTemplateSchema,
  normaliserElements,
  partiesDepuisTemplate,
  planApplication,
  type ElementTemplate,
  type SeanceExistante,
} from "@/lib/templates";

/**
 * **Les templates de cours** : la règle d'application tient dans `planApplication`, que
 * l'écran et le serveur appellent tous les deux. Ces cas la gardent : on crée ce qui manque, on remplit
 * un programme vide, et **on n'écrase jamais rien**.
 */

const el = (p: Partial<ElementTemplate> = {}): ElementTemplate => ({
  bloc: 1,
  nature: "COURS",
  theme: "",
  niveau: "INDIFFERENT",
  description: "",
  instructeurId: null,
  instructeurSecondId: null,
  ...p,
});

const PERIODE = { dateDebut: "2026-09-01", dateFin: "2026-12-20" };
const seance = (p: Partial<SeanceExistante> & { date: string }): SeanceExistante => ({
  id: `s-${p.date}`,
  heureDebut: "19:30",
  annulee: false,
  commencee: false,
  programmeVide: true,
  ...p,
});
const plan = (dates: string[], seances: SeanceExistante[] = [], heureDebut = "19:30") =>
  planApplication({ dates, aujourdHui: "2026-10-26", periode: PERIODE, heureDebut, seances });

describe("le programme d'un template", () => {
  it("renumérote les parties sans trou et garde l'ordre reçu dans une partie", () => {
    const r = normaliserElements([el({ bloc: 3, theme: "B" }), el({ bloc: 1, nature: "ECHAUFFEMENT", theme: "A" }), el({ bloc: 3, nature: "OPTION", theme: "C" })]);
    expect(r.map((e) => [e.bloc, e.theme])).toEqual([
      [1, "A"],
      [2, "B"],
      [2, "C"],
    ]);
  });

  it("efface un second identique au premier : on ne s'assiste pas soi-même", () => {
    expect(normaliserElements([el({ instructeurId: "u1", instructeurSecondId: "u1" })])[0].instructeurSecondId).toBeNull();
  });

  it("calcule les libellés comme le planning : « Cours » seul, préfixe « Partie N » dès deux parties", () => {
    expect(partiesDepuisTemplate([el()], []).map((p) => p.libelle)).toEqual(["Cours"]);
    const deux = partiesDepuisTemplate([el({ nature: "ECHAUFFEMENT" }), el(), el({ bloc: 2, nature: "OPTION" }), el({ bloc: 2, nature: "OPTION" })], []);
    expect(deux.map((p) => p.libelle)).toEqual(["Partie 1 · Échauffement", "Partie 1 · Cours", "Partie 2 · Option 1", "Partie 2 · Option 2"]);
    expect(deux.map((p) => p.ordre)).toEqual([0, 1, 2, 3]);
  });

  it("donne une teinte aux cours et aux options, jamais à l'échauffement", () => {
    const parties = partiesDepuisTemplate([el({ nature: "ECHAUFFEMENT" }), el({ theme: "Messer" }), el({ nature: "OPTION", theme: "Dague" })], ["Messer", "Dague"]);
    expect(parties[0].teinte).toBeNull();
    expect(parties[1].teinte).not.toBeNull();
    expect(parties[2].teinte).not.toBe(parties[1].teinte);
  });

  it("refuse un atelier, un programme vide et un thème trop long", () => {
    expect(elementsTemplateSchema.safeParse([{ ...el(), nature: "ATELIER" }]).success).toBe(false);
    expect(elementsTemplateSchema.safeParse([]).success).toBe(false);
    expect(elementsTemplateSchema.safeParse([el({ theme: "x".repeat(61) })]).success).toBe(false);
    expect(elementsTemplateSchema.safeParse([el({ theme: "Messer" })]).success).toBe(true);
  });
});

describe("appliquer un template à des dates", () => {
  it("crée la séance d'un jour qui n'en a pas", () => {
    expect(plan(["2026-11-03"])).toEqual([{ date: "2026-11-03", action: "creer" }]);
  });

  it("remplit le programme vide d'une séance existante, et n'écrase jamais un programme réglé", () => {
    expect(plan(["2026-11-03"], [seance({ date: "2026-11-03" })])).toEqual([{ date: "2026-11-03", action: "remplir", sessionId: "s-2026-11-03" }]);
    expect(plan(["2026-11-03"], [seance({ date: "2026-11-03", programmeVide: false })])).toEqual([
      { date: "2026-11-03", action: "ignorer", raison: "programme déjà rempli" },
    ]);
  });

  it("écarte une séance annulée ou déjà commencée, une date passée ou hors de la période", () => {
    const r = plan(
      ["2026-11-03", "2026-10-26", "2026-10-20", "2027-01-05"],
      [seance({ date: "2026-11-03", annulee: true }), seance({ date: "2026-10-26", commencee: true })],
    );
    expect(r.map((e) => (e.action === "ignorer" ? e.raison : e.action))).toEqual(["date passée", "séance déjà commencée", "séance annulée", "hors de la période"]);
  });

  it("vise la séance à l'heure du template quand le jour en porte plusieurs, et n'en choisit aucune sinon", () => {
    const matinEtSoir = [seance({ id: "matin", date: "2026-11-07", heureDebut: "10:00" }), seance({ id: "soir", date: "2026-11-07", heureDebut: "19:30" })];
    expect(plan(["2026-11-07"], matinEtSoir)).toEqual([{ date: "2026-11-07", action: "remplir", sessionId: "soir" }]);
    expect(plan(["2026-11-07"], matinEtSoir, "14:00")).toEqual([{ date: "2026-11-07", action: "ignorer", raison: "plusieurs séances ce jour-là" }]);
  });

  it("dédoublonne et range les dates dans l'ordre du calendrier", () => {
    expect(plan(["2026-11-10", "2026-11-03", "2026-11-10"]).map((e) => e.date)).toEqual(["2026-11-03", "2026-11-10"]);
  });

  it("dit le bilan dans les mots de l'écran", () => {
    expect(bilanApplication(plan(["2026-11-03", "2026-11-10", "2020-01-01"], [seance({ date: "2026-11-10" })]))).toBe(
      "1 séance créée · 1 programme rempli · 1 date écartée",
    );
    expect(bilanApplication([])).toBe("Rien à faire.");
  });
});
