import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIBELLE_VIDE } from "@/lib/constants";
import type { Paire } from "@/components/planning/file-envoi";
import { paireImposee, poserEnMasse, type EtatBrouillon } from "@/components/planning/brouillon";
import {
  blocsProposes,
  confirmationPlanning,
  ENTREES_TETE,
  expliquerGestePlanning,
  gestesPlanningApplicables,
  issueReglage,
  libelleBlocPropose,
  libelleBoutonPlanning,
  libellePartieProposee,
  libelleToutesSeancesPlanning,
  lireChoix,
  NE_PAS_CHANGER,
  partiesProposees,
  phrasesEcarts,
  planReglage,
  reglageVide,
  seancesSansLaPartie,
  texteSansCasePlanning,
  type LignePlanning,
  type PartieLigne,
} from "@/components/planning/selection-planning";

/**
 * **La sélection multiple du planning** — les règles sans React : les gestes proposés, les parties
 * qu'on peut régler, ce qu'un réglage fait d'une case (ou pourquoi il la laisse de côté), et le
 * brouillon qu'il remplit sans rien envoyer.
 */

const VIDE: Paire = { instructeurId: "", instructeurSecondId: "", theme: "", description: "", niveau: "INDIFFERENT" };
/** « Partie 1 · Cours », « Partie 2 · Option 2 » : la partie, la nature et le rang se lisent dans le nom. */
const partie = (id: string, libelle: string, x: Partial<PartieLigne> = {}): PartieLigne => {
  const [, bloc, mot, rang] = /^Partie (\d+) · (\S+)(?: (\d+))?$/.exec(libelle) ?? [];
  const nature = mot === "Option" ? "OPTION" : mot === "Échauffement" ? "ECHAUFFEMENT" : mot === "Atelier" ? "ATELIER" : "COURS";
  return { id, libelle, bloc: Number(bloc), nature, rang: Number(rang ?? 1), atelier: false, serveur: { ...VIDE }, ...x };
};
const seance = (id: string, parties: PartieLigne[]): LignePlanning => ({ id, date: "2026-10-06", jour: `jour ${id}`, parties });

const a = seance("a", [partie("a1", "Partie 1 · Cours"), partie("a2", "Partie 2 · Cours"), partie("a3", "Partie 2 · Option")]);
const b = seance("b", [partie("b1", "Partie 1 · Cours", { serveur: { ...VIDE, instructeurId: "u-alix", theme: "Épée longue" } }), partie("b2", "Partie 2 · Cours")]);
const c = seance("c", [partie("c1", "Partie 1 · Cours", { atelier: true })]);

describe("les gestes proposés", () => {
  it("régler une partie, ajouter dans une partie — chacun avec son nombre", () => {
    expect(gestesPlanningApplicables([a, b, c]).map((g) => [g.geste, g.nombre, g.libelle])).toEqual([
      ["regler", 2, "Régler une partie (2 séances)"],
      ["ajouter", 3, "Ajouter dans une partie (3 séances)"],
    ]);
  });

  it("une séance dont toutes les parties portent un atelier n'a rien à régler", () => {
    expect(gestesPlanningApplicables([c]).map((g) => g.geste)).toEqual(["ajouter"]);
  });

  it("aucun geste de retrait en masse", () => {
    expect(gestesPlanningApplicables([a]).map((g) => g.geste)).not.toContain("retirer");
  });

  it("le libellé de la case maîtresse nomme les séances affichées, jamais « Tout »", () => {
    expect(libelleToutesSeancesPlanning(5)).toBe("Sélectionner les 5 séances affichées");
    expect(libelleToutesSeancesPlanning(1)).toBe("Sélectionner la séance affichée");
    expect(texteSansCasePlanning(2)).toMatch(/2 séances annulées n'ont pas de case/);
    expect(texteSansCasePlanning(0)).toBeNull();
  });
});

describe("les parties qu'on peut choisir", () => {
  it("celles qui existent dans au moins une séance cochée, partie par partie, avec leur nombre", () => {
    const p = partiesProposees([a, b, c]);
    expect(p.map(libellePartieProposee)).toEqual(["Partie 1 · Cours (3 séances)", "Partie 2 · Cours (2 séances)", "Partie 2 · Option (1 séance)"]);
  });

  it("l'ordre est celui d'une carte — partie, nature, rang —, pas celui de la première séance cochée", () => {
    const d = seance("d", [partie("d3", "Partie 2 · Option 2"), partie("d1", "Partie 3 · Cours"), partie("d0", "Partie 1 · Échauffement")]);
    expect(partiesProposees([d, a]).map((x) => x.libelle)).toEqual([
      "Partie 1 · Échauffement",
      "Partie 1 · Cours",
      "Partie 2 · Cours",
      "Partie 2 · Option",
      "Partie 2 · Option 2",
      "Partie 3 · Cours",
    ]);
  });
});

describe("ajouter dans une partie", () => {
  it("propose les parties de 1 à la plus longue séance du lot, plus une nouvelle", () => {
    expect(blocsProposes([a, b, c])).toEqual([1, 2, 3]);
    expect(blocsProposes([c])).toEqual([1, 2]);
    expect(libelleBlocPropose(2, [a, c])).toBe("Partie 2");
    expect(libelleBlocPropose(3, [a, c])).toBe("Partie 3 (nouvelle)");
  });

  it("compte les séances trop courtes, où l'élément ouvre une partie à la fin", () => {
    expect(seancesSansLaPartie([a, b, c], 2)).toBe(1);
    expect(seancesSansLaPartie([a, b, c], 3)).toBe(3);
    const e = expliquerGestePlanning("ajouter", [a, c], null, "", { bloc: 2, nature: "OPTION" });
    expect(e.titre).toBe("Option s'ajoute dans la partie 2 sur chacune des 2 séances, tout de suite.");
    expect(e.phrases.join(" ")).toMatch(/1 séance n'a pas encore de partie 2 : l'élément y ouvre une nouvelle partie, à la fin/);
  });

  it("le bouton et la question nomment la nature et la partie", () => {
    expect(libelleBoutonPlanning("ajouter", 4, "", { bloc: 1, nature: "ECHAUFFEMENT" })).toBe("Ajouter un échauffement dans la partie 1 à 4 séances");
    expect(libelleBoutonPlanning("ajouter", 4)).toBe("Ajouter");
    expect(confirmationPlanning({ bloc: 3, nature: "COURS" }, 2)).toMatch(/^Ajouter un cours dans la partie 3 de 2 séances \? C'est enregistré tout de suite/);
  });
});

describe("ce qu'un réglage fait d'une case", () => {
  it("« ne pas changer » garde la valeur, une chaîne vide vide", () => {
    expect(lireChoix(NE_PAS_CHANGER)).toBeUndefined();
    expect(lireChoix("")).toBe("");
    expect(ENTREES_TETE.map((e) => e.libelle)).toEqual(["Ne pas changer", LIBELLE_VIDE]);
    expect(reglageVide({})).toBe(true);
    expect(reglageVide({ theme: "" })).toBe(false);
  });

  it("pose l'instructeur sans toucher au thème", () => {
    const base: Paire = { ...VIDE, theme: "Dague", niveau: "AVANCE" };
    expect(issueReglage(base, { instructeurId: "u-alix" })).toEqual({ paire: { ...base, instructeurId: "u-alix" } });
  });

  it("vider l'instructeur emporte le second, comme dans la case", () => {
    const base: Paire = { ...VIDE, instructeurId: "u-alix", instructeurSecondId: "u-noe" };
    expect(issueReglage(base, { instructeurId: "" })).toEqual({ paire: { ...VIDE } });
  });

  it("vider le thème emporte niveau et description, comme le serveur", () => {
    const base: Paire = { ...VIDE, theme: "Dague", niveau: "AVANCE", description: "Désarmements" };
    expect(issueReglage(base, { theme: "" })).toEqual({ paire: { ...VIDE } });
  });

  it("un second demandé sans personne qui mène reste de côté", () => {
    expect(issueReglage(VIDE, { instructeurSecondId: "u-noe" })).toEqual({ ecart: "secondSansPremier" });
  });

  it("la même personne pour mener et assister reste de côté", () => {
    expect(issueReglage({ ...VIDE, instructeurId: "u-alix" }, { instructeurSecondId: "u-alix" })).toEqual({ ecart: "memePersonne" });
  });

  it("le nouveau premier qui était le second libère la place, comme dans la case", () => {
    const base: Paire = { ...VIDE, instructeurId: "u-noe", instructeurSecondId: "u-alix" };
    expect(issueReglage(base, { instructeurId: "u-alix" })).toEqual({ paire: { ...VIDE, instructeurId: "u-alix" } });
  });

  it("un niveau ou une description sans thème reste de côté", () => {
    expect(issueReglage(VIDE, { niveau: "DEBUTANT" })).toEqual({ ecart: "sansTheme" });
    expect(issueReglage(VIDE, { description: "Feintes" })).toEqual({ ecart: "sansTheme" });
    expect(issueReglage(VIDE, { theme: "Sabre", niveau: "DEBUTANT" })).toEqual({ paire: { ...VIDE, theme: "Sabre", niveau: "DEBUTANT" } });
  });
});

describe("le plan d'un réglage sur le lot", () => {
  it("écrit ce qui change, compte ce qui y est déjà et ce qui reste de côté", () => {
    const plan = planReglage([a, b, c, seance("e", [partie("e2", "Partie 2 · Cours")])], "Partie 1 · Cours", { theme: "Épée longue" }, new Map());
    // « b » porte déjà ce thème : compté, pas réécrit.
    expect(plan.ecritures.map((e) => e.partieId)).toEqual(["a1"]);
    expect(plan.ecritures[0].paire.theme).toBe("Épée longue");
    expect(plan.ecritures[0].serveur).toEqual(VIDE);
    expect(plan.deja).toBe(1);
    expect(plan.ecarts.atelier).toBe(1);
    expect(plan.ecarts.absente).toBe(1);
    expect(phrasesEcarts(plan.ecarts)).toEqual([
      "1 séance reste de côté : elle n'a pas cette partie.",
      "1 séance reste de côté : elle porte un atelier dans cette partie (il se change depuis la gestion des ateliers).",
    ]);
  });

  it("une case qui porte déjà le réglage n'est pas réécrite", () => {
    const plan = planReglage([b], "Partie 1 · Cours", { instructeurId: "u-alix" }, new Map());
    expect(plan.ecritures).toEqual([]);
    expect(plan.deja).toBe(1);
  });

  it("part de ce que le brouillon porte déjà : un réglage à la main sur un autre champ n'est pas défait", () => {
    const brouillon = new Map([["a1", { ...VIDE, instructeurId: "u-noe" }]]);
    const plan = planReglage([a], "Partie 1 · Cours", { theme: "Dague" }, brouillon);
    expect(plan.ecritures[0].paire).toEqual({ ...VIDE, instructeurId: "u-noe", theme: "Dague" });
  });

  it("l'explication dit que rien n'est encore enregistré, et ce qui reste de côté", () => {
    const plan = planReglage([a, c], "Partie 1 · Cours", { theme: "Dague" }, new Map());
    const e = expliquerGestePlanning("regler", [a, c], plan, "Partie 1 · Cours");
    expect(e.titre).toBe("« Partie 1 · Cours » est réglé sur 1 séance, dans le brouillon.");
    expect(e.phrases.join(" ")).toMatch(/Rien n'est encore enregistré/);
    expect(e.phrases.join(" ")).toMatch(/atelier/);
    expect(libelleBoutonPlanning("regler", 1, "Partie 1 · Cours")).toBe("Régler « Partie 1 · Cours » sur 1 séance");
    expect(libelleBoutonPlanning("ajouter", 4, "", { bloc: 2, nature: "OPTION" })).toBe("Ajouter une option dans la partie 2 à 4 séances");
  });

  it("les ajouts disent qu'ils partent tout de suite, et qu'« Annuler » ne les défait pas", () => {
    const e = expliquerGestePlanning("ajouter", [a, b], null, "", { bloc: 1, nature: "COURS" });
    expect(e.titre).toMatch(/tout de suite/);
    expect(e.phrases.join(" ")).toMatch(/« Annuler » ne le défait pas/);
  });
});

describe("le brouillon écrit en masse", () => {
  const etat0: EtatBrouillon = { modifiees: new Map(), imposees: new Map() };

  it("pose les cases qui changent, oublie celles ramenées à la valeur du serveur", () => {
    const avant: EtatBrouillon = { modifiees: new Map([["x", { ...VIDE, theme: "Dague" }]]), imposees: new Map() };
    const suite = poserEnMasse(
      avant,
      [
        { partieId: "x", paire: { ...VIDE }, serveur: { ...VIDE } },
        { partieId: "y", paire: { ...VIDE, theme: "Sabre" }, serveur: { ...VIDE } },
      ],
      1,
    );
    expect([...suite.modifiees.keys()]).toEqual(["y"]);
    expect(suite.posees).toEqual(["y"]);
    expect(suite.oubliees).toEqual(["x"]);
    // Les deux cases reprennent la valeur imposée, y compris celle qui sort du brouillon.
    expect(suite.imposees.get("x")).toEqual({ paire: { ...VIDE }, tour: 1 });
    expect(avant.modifiees.size).toBe(1);
  });

  it("garde ce que la case avait posé elle-même ailleurs", () => {
    const avant: EtatBrouillon = { modifiees: new Map([["z", { ...VIDE, theme: "Lance" }]]), imposees: new Map() };
    const suite = poserEnMasse(avant, [{ partieId: "y", paire: { ...VIDE, theme: "Sabre" }, serveur: VIDE }], 1);
    expect([...suite.modifiees.keys()].sort()).toEqual(["y", "z"]);
  });

  it("la case reprend une imposition neuve une fois, et une seule", () => {
    const suite = poserEnMasse(etat0, [{ partieId: "y", paire: { ...VIDE, theme: "Sabre" }, serveur: VIDE }], 3);
    const imposee = suite.imposees.get("y");
    expect(paireImposee(imposee, 0)).toEqual({ ...VIDE, theme: "Sabre" });
    expect(paireImposee(imposee, 3)).toBeNull();
    expect(paireImposee(undefined, 0)).toBeNull();
  });
});

describe("l'écran", () => {
  const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

  it("« Régler une partie » va dans le brouillon, sans action serveur à lui", () => {
    const code = source("src/components/planning/SelectionPlanning.tsx");
    expect(code).toContain("brouillon.poserPlusieurs(plan.ecritures)");
    expect(code).not.toContain("enregistrerCase");
    // Les seuls appels au serveur sont les ajouts, confirmés.
    expect(code.match(/await \w+\(/g)).toEqual(["await ajouterPartiesEnMasse("]);
  });

  it("la case reprend ce que le brouillon lui impose, et se monte sur le brouillon en cours", () => {
    const code = source("src/components/planning/CaseEditeur.tsx");
    expect(code).toContain("paireImposee(imposee, tourVu)");
    expect(code).toContain("brouillon?.modifiees.get(valeur.id) ?? paireServeur(valeur)");
  });

  it("une séance annulée n'a pas de case", () => {
    const code = source("src/components/planning/GrillePlanning.tsx");
    expect(code).toContain("enEdition && !c.annulee ? <CaseSeancePlanning");
    expect(code).toMatch(/if \(c\.annulee\) return null;/);
  });

  it("la barre est la forme commune : interrupteur, « Que veux-tu faire ? », visible avec une sélection", () => {
    const code = source("src/components/planning/SelectionPlanning.tsx");
    expect(code).toContain("<InterrupteurSelection");
    expect(code).toContain("<ChoixGeste");
    expect(code).toContain("actif && barreDeMasseVisible(selection)");
  });
});
