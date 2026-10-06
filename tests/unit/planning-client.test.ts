import { describe, expect, it } from "vitest";
import type { Personne } from "@/lib/planning";
import { abreger, optionsDepuis, personnesRendues, reglagesVides, themesDeNature, themesRendus } from "@/components/planning/options";
import type { Planning } from "@/lib/planning";

/**
 * Ce qui part vraiment dans le navigateur pour le planning.
 *
 * Les listes (personnes, thèmes, ateliers) sont communes à toutes les cases : elles sont montées
 * une seule fois (contexte React) et leurs entrées ne sont écrites dans le HTML qu'à l'ouverture
 * d'une liste déroulante. Fermée, une case ne doit contenir que sa propre valeur — sans quoi un
 * trimestre de 35 séances répéterait les mêmes listes une fois par liste et par partie : l'annuaire
 * y passe **deux** fois (l'instructeur et son second), et la liste des thèmes une fois.
 */

const personnes: Personne[] = [
  { id: "u1", prenom: "Chloé", nom: "Durand", role: "INSTRUCTEUR", couleur: 1 },
  { id: "u2", prenom: "Charlie", nom: "03", role: "INSTRUCTEUR", couleur: 2 },
  { id: "u3", prenom: "Alix", nom: "Bertin", role: "MEMBRE", couleur: null },
];

const themes = ["Épée longue", "Messer", "Dague"];

describe("personnesRendues", () => {
  it("n'écrit que la personne choisie tant que la liste n'a pas été ouverte", () => {
    expect(personnesRendues(personnes, false, "u2")).toEqual([personnes[1]]);
  });
  it("n'écrit rien quand la case est vide", () => {
    expect(personnesRendues(personnes, false, "")).toEqual([]);
  });
  it("écrit la liste entière une fois la liste ouverte", () => {
    expect(personnesRendues(personnes, true, "u2")).toEqual(personnes);
  });
  it("garde la valeur courante dans la liste fermée, pour que la case affiche le bon nom", () => {
    for (const p of personnes) expect(personnesRendues(personnes, false, p.id).map((x) => x.id)).toContain(p.id);
  });
  it("ignore une personne qui n'est plus dans la liste (compte désactivé)", () => {
    expect(personnesRendues(personnes, false, "u9")).toEqual([]);
  });
});

describe("themesRendus", () => {
  it("n'écrit que le thème choisi tant que la liste n'a pas été ouverte", () => {
    expect(themesRendus(themes, false, "Messer", false)).toEqual(["Messer"]);
  });
  it("n'écrit rien quand la case est vide", () => {
    expect(themesRendus(themes, false, "", false)).toEqual([]);
  });
  it("laisse le thème libre hors de la liste commune (il est rendu à part)", () => {
    expect(themesRendus(themes, false, "Botte secrète", false)).toEqual([]);
    expect(themesRendus(themes, false, "Messer", true)).toEqual([]);
  });
  it("écrit la liste entière une fois la liste ouverte", () => {
    expect(themesRendus(themes, true, "", false)).toEqual(themes);
  });
});

/**
 * **« La case est-elle vide ? » n'a qu'une seule réponse dans le dossier.**
 *
 * Le serveur la pose pour refuser qu'un atelier s'installe sur le travail de quelqu'un
 * (`partieLibre`, `programmerAtelierDansCase`), l'écran la pose pour ne pas **proposer** ce geste sur
 * une case remplie (`CaseEditeur`), et l'affichage la pose pour décider qu'une partie n'a rien à dire
 * (`caseVide`). Deux écritures de la règle, et le serveur refuserait ce que l'écran propose.
 */
describe("themesDeNature (avenant 4)", () => {
  const o = { themes: ["Messer", "Épée longue"], themesEchauffement: ["Cardio", "Assouplissements"] };
  it("donne la liste d'échauffement à un échauffement", () => {
    expect(themesDeNature(o, "ECHAUFFEMENT")).toEqual(["Cardio", "Assouplissements"]);
  });
  it("donne la liste des cours et options au reste", () => {
    for (const n of ["COURS", "OPTION", "ATELIER"] as const) expect(themesDeNature(o, n)).toEqual(["Messer", "Épée longue"]);
  });
});

describe("optionsDepuis : les deux listes de thèmes", () => {
  it("passe les thèmes d'échauffement, même en lecture seule (ils ne nomment personne)", () => {
    const p = { personnes: [], themes: ["Messer"], themesEchauffement: ["Cardio"], ateliersDisponibles: [], modifiable: false, peutProgrammer: false } as unknown as Planning;
    const res = optionsDepuis(p);
    expect(res.themesEchauffement).toEqual(["Cardio"]);
    expect(res.themes).toEqual(["Messer"]);
  });
});

describe("reglagesVides", () => {
  it("une case sans aucun réglage est vide", () => {
    expect(reglagesVides({})).toBe(true);
    expect(reglagesVides({ instructeur: null, instructeurSecond: null, theme: "", description: "", niveau: "INDIFFERENT" })).toBe(true);
  });

  it("des blancs ne remplissent pas une case", () => {
    expect(reglagesVides({ theme: "   ", description: "\n " })).toBe(true);
  });

  it("chacun des cinq réglages, seul, suffit à la remplir", () => {
    expect(reglagesVides({ instructeur: "u1" })).toBe(false);
    expect(reglagesVides({ instructeurSecond: "u2" })).toBe(false);
    expect(reglagesVides({ theme: "Messer" })).toBe(false);
    expect(reglagesVides({ description: "Trois passes lentes." })).toBe(false);
    expect(reglagesVides({ niveau: "DEBUTANT" })).toBe(false);
  });

  it("un niveau qu'aucune version ne connaît ne remplit rien : rien ne s'afficherait", () => {
    // Même silence que `niveauAffiche` : « EXPERT » écrit par une autre version ne doit pas entrer
    // dans l'interface, et ne doit donc pas réserver une case non plus.
    expect(reglagesVides({ niveau: "EXPERT" })).toBe(true);
  });
});

describe("abreger", () => {
  it("réduit un nom complet pour la grille compacte", () => {
    expect(abreger("Chloé Durand")).toBe("Chloé D.");
  });
  it("laisse un prénom seul intact", () => {
    expect(abreger("Chloé")).toBe("Chloé");
  });
});

describe("poids des listes du planning", () => {
  /**
   * Ce que pèse, en entrées de liste déroulante, un trimestre affiché en entier (35 séances de
   * quatre parties). **Une seule mise en page** depuis les cartes par séance : le facteur 2 qui
   * comptait ici la grille PC *et* la liste mobile a disparu avec l'arbre en double. En revanche
   * l'annuaire est demandé deux fois par partie — l'instructeur qui mène, et celui qui assiste.
   */
  const entrees = (ouvertes: boolean) => {
    const parties = 35 * 4;
    return parties * (2 * personnesRendues(personnes, ouvertes, "u2").length + themesRendus(themes, ouvertes, "Messer", false).length);
  };
  it("une page fraîche n'écrit qu'une entrée par liste, pas la liste entière", () => {
    expect(entrees(false)).toBe(140 * 3);
    expect(entrees(true)).toBe(140 * (2 * personnes.length + themes.length));
    expect(entrees(false)).toBeLessThan(entrees(true) / 2);
  });
});
