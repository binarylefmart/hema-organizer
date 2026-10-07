import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compteSelection,
  estUnAppui,
  indexFocusSuivant,
  libelleAffichees,
  questionSelection,
  SELECTEUR_INTERACTIF,
  suffixeSelection,
} from "@/components/ui/barre-selection";
import { libellePuceJour, type MotsLignes } from "@/components/ui/selection";
import type { Paire } from "@/components/planning/file-envoi";
import {
  elementsProposes,
  elementsRetenus,
  expliquerReglageElements,
  libelleReglerElements,
  libelleSuivantElements,
  messageElementsRegles,
  natureDesThemes,
  phrasesEcartsElements,
  planReglageElements,
  type LignePlanning,
  type PartieLigne,
} from "@/components/planning/selection-planning";
import {
  libelleBoutonVolet,
  type LigneChoix,
} from "@/app/(app)/admin/membres/choix-geste";

/**
 * **La sélection multiple au téléphone** — ce qui se teste sans navigateur : les mots de la barre et
 * du volet, la portée du bouton « les N affichées » (jamais « Tout »), les règles du geste « toucher
 * la carte », le piège du focus du volet, et « Régler des éléments » du planning, qui vise des
 * identifiants d'éléments et non plus un nom de partie.
 */

const SEANCES: MotsLignes = {
  singulier: "séance",
  pluriel: "séances",
  accord: "f",
};
const COMPTES: MotsLignes = {
  singulier: "compte",
  pluriel: "comptes",
  accord: "m",
};
const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("les mots de la barre et du volet", () => {
  it("le compte, accordé, et sa fin de phrase pour le lecteur d'écran", () => {
    expect(compteSelection(1, SEANCES)).toBe("1 séance");
    expect(compteSelection(3, SEANCES)).toBe("3 séances");
    expect(compteSelection(3, SEANCES) + suffixeSelection(3, SEANCES)).toBe(
      "3 séances sélectionnées",
    );
    expect(compteSelection(1, COMPTES) + suffixeSelection(1, COMPTES)).toBe(
      "1 compte sélectionné",
    );
    expect(compteSelection(2, COMPTES) + suffixeSelection(2, COMPTES)).toBe(
      "2 comptes sélectionnés",
    );
  });

  it("la question du gros bouton et du volet", () => {
    expect(questionSelection(3, SEANCES)).toBe("Que faire sur ces 3 séances ?");
    expect(questionSelection(1, SEANCES)).toBe("Que faire sur cette séance ?");
    expect(questionSelection(1, COMPTES)).toBe("Que faire sur ce compte ?");
  });

  it("le bouton qui coche ce qui est affiché nomme sa portée, et jamais « Tout »", () => {
    expect(libelleAffichees(5, SEANCES)).toBe("Les 5 affichées");
    expect(libelleAffichees(12, COMPTES)).toBe("Les 12 affichés");
    expect(libelleAffichees(1, SEANCES)).toBe("Celle affichée");
    for (const n of [1, 2, 40])
      for (const mots of [SEANCES, COMPTES])
        expect(libelleAffichees(n, mots)).not.toMatch(/\bTout/);
  });

  it("une puce par jour, au planning", () => {
    expect(libellePuceJour("mardi", 4)).toBe("Les mardis (4)");
    expect(libellePuceJour("vendredi", 1)).toBe("Le vendredi (1)");
  });
});

describe("toucher la carte pour la cocher", () => {
  it("un appui, pas un glissé", () => {
    expect(estUnAppui({ x: 100, y: 100 }, { x: 106, y: 104 })).toBe(true);
    // La ligne du planning tirée à gauche pour révéler « Retirer » ne coche rien.
    expect(estUnAppui({ x: 300, y: 100 }, { x: 200, y: 102 })).toBe(false);
  });

  it("sans départ connu, ce n'est pas un appui", () => {
    // La poignée ⋮⋮ du planning arrête le `pointerdown` : la zone ne l'a pas vu, elle ne coche rien.
    expect(estUnAppui(null, { x: 5, y: 5 })).toBe(false);
  });

  it("ce qui fait déjà quelque chose sous le doigt n'est pas une cible", () => {
    for (const s of [
      "a",
      "button",
      "input",
      "label",
      "[role=combobox]",
      "[role=option]",
      "[data-sans-cocher]",
    ]) {
      expect(SELECTEUR_INTERACTIF.split(",")).toContain(s);
    }
  });

  it("chaque case cochable porte la marque que la zone cherche, et la carte cochée se lit sur elle", () => {
    for (const f of [
      "src/components/seances/SelectionSeances.tsx",
      "src/components/planning/SelectionPlanning.tsx",
      "src/components/gestion/PresencesEquipe.tsx",
      "src/app/(app)/admin/membres/SelectionRoles.tsx",
    ]) {
      expect(source(f), f).toContain("data-case-selection");
      expect(source(f), f).toContain("<ZoneCochable");
      expect(source(f), f).toContain("<BarreSelection");
    }
    for (const f of [
      "src/components/seances/CarteSeance.tsx",
      "src/components/planning/GrillePlanning.tsx",
      "src/components/gestion/PresencesEquipe.tsx",
      "src/app/(app)/admin/membres/page.tsx",
    ]) {
      expect(source(f), f).toContain(
        "tel:has-[[data-case-selection]:checked]:bg-primaire-doux",
      );
    }
  });
});

describe("le volet", () => {
  it("le focus tourne sur ses contrôles, aux deux bouts", () => {
    expect(indexFocusSuivant(-1, 4, false)).toBe(0);
    expect(indexFocusSuivant(-1, 4, true)).toBe(3);
    expect(indexFocusSuivant(3, 4, false)).toBe(0);
    expect(indexFocusSuivant(0, 4, true)).toBe(3);
    expect(indexFocusSuivant(1, 4, false)).toBe(2);
    expect(indexFocusSuivant(0, 0, false)).toBe(-1);
  });

  it("est une fenêtre modale, et la barre se pose au-dessus de la barre d'onglets", () => {
    const volet = source("src/components/ui/VoletBas.tsx");
    expect(volet).toContain('role="dialog"');
    expect(volet).toContain('aria-modal="true"');
    expect(volet).toContain('e.key === "Escape"');
    expect(volet).toContain("origine.current.focus()");
    const barre = source("src/components/ui/BarreSelection.tsx");
    expect(barre).toContain(
      "bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]",
    );
    // Aucun `<select>` : les personnes et les thèmes passent par la liste du dépôt.
    expect(
      volet + barre + source("src/components/ui/GestesVolet.tsx"),
    ).not.toMatch(/<select\b/);
  });
});

describe("Régler des éléments, au planning", () => {
  const VIDE: Paire = {
    instructeurId: "",
    instructeurSecondId: "",
    theme: "",
    description: "",
    niveau: "INDIFFERENT",
  };
  const el = (id: string, x: Partial<PartieLigne> = {}): PartieLigne => ({
    id,
    libelle: "Cours",
    bloc: 1,
    nature: "COURS",
    rang: 1,
    atelier: false,
    serveur: { ...VIDE },
    ...x,
  });
  const seance = (id: string, parties: PartieLigne[]): LignePlanning => ({
    id,
    date: "2026-10-06",
    jour: `jour ${id}`,
    parties,
  });
  const a = seance("a", [
    el("a1"),
    el("a2", { libelle: "Option", nature: "OPTION" }),
    el("a3", { libelle: "Atelier", nature: "ATELIER", atelier: true }),
  ]);
  const b = seance("b", [
    el("b1", {
      libelle: "Échauffement",
      nature: "ECHAUFFEMENT",
      serveur: { ...VIDE, instructeurId: "u-alix", theme: "Souplesse" },
    }),
  ]);

  it("les séances cochées avec leurs éléments ; un atelier ne se coche pas", () => {
    const vus = elementsProposes([a, b]);
    expect(vus.map((v) => v.seance.id)).toEqual(["a", "b"]);
    expect(vus[0].elements.map((e) => [e.partie.id, e.cochable])).toEqual([
      ["a1", true],
      ["a2", true],
      ["a3", false],
    ]);
  });

  it("les éléments retenus : cochés, encore dans le lot, jamais un atelier", () => {
    expect(
      elementsRetenus([a, b], new Set(["a2", "a3", "b1", "zz"])).map(
        (p) => p.id,
      ),
    ).toEqual(["a2", "b1"]);
    // Une séance décochée emporte ses éléments.
    expect(
      elementsRetenus([a], new Set(["a1", "b1"])).map((p) => p.id),
    ).toEqual(["a1"]);
  });

  it("la liste de thèmes suit la nature, et aucune ne vaut pour un mélange", () => {
    expect(natureDesThemes([a.parties[0], a.parties[1]])).toBe("COURS");
    expect(natureDesThemes([b.parties[0]])).toBe("ECHAUFFEMENT");
    expect(natureDesThemes([a.parties[0], b.parties[0]])).toBeNull();
  });

  it("le plan vise des identifiants, part du brouillon, et dit ce qui reste de côté", () => {
    const brouillon = new Map<string, Paire>([
      ["a1", { ...VIDE, theme: "Déjà posé à la main" }],
    ]);
    const plan = planReglageElements(
      [a.parties[0], a.parties[1], b.parties[0]],
      { instructeurId: "u-alix" },
      brouillon,
    );
    // a1 garde le thème du brouillon ; b1 porte déjà Alix : rien n'y change.
    expect(
      plan.ecritures.map((e) => [
        e.partieId,
        e.paire.instructeurId,
        e.paire.theme,
      ]),
    ).toEqual([
      ["a1", "u-alix", "Déjà posé à la main"],
      ["a2", "u-alix", ""],
    ]);
    expect(plan.deja).toBe(1);
    const refus = planReglageElements(
      [a.parties[1]],
      { niveau: "AVANCE" },
      new Map(),
    );
    expect(refus.ecritures).toEqual([]);
    expect(phrasesEcartsElements(refus.ecarts)).toEqual([
      "1 élément reste de côté : il n'a pas de thème : niveau et description l'attendent.",
    ]);
  });

  it("les boutons et le message disent le nombre d'éléments", () => {
    expect(libelleSuivantElements(0)).toBe("Coche au moins un élément");
    expect(libelleSuivantElements(4)).toBe("Suivant : 4 éléments");
    expect(libelleReglerElements(1)).toBe("Régler 1 élément");
    expect(libelleReglerElements(4)).toBe("Régler 4 éléments");
    expect(messageElementsRegles(3)).toBe(
      "3 éléments réglés, pas encore appliqués : « Appliquer les modifications » les enregistre.",
    );
    expect(expliquerReglageElements(null, 2).titre).toBe(
      "2 éléments : choisis ce qui change.",
    );
  });
});

describe("l'annuaire, au téléphone : le bouton annonce les emails", () => {
  const ligne = (nom: string, autre: Partial<LigneChoix> = {}): LigneChoix => ({
    id: nom,
    nom,
    role: "MEMBRE",
    actif: true,
    reponses: 0,
    estAdmin: false,
    aUnEmail: true,
    lienEnCours: true,
    dejaEntre: true,
    recoitInvitation: true,
    ...autre,
  });
  const lot = [
    ligne("Alix Exemple"),
    ligne("Basile Exemple"),
    ligne("Camille Exemple", { aUnEmail: false }),
  ];

  it("renvoyer : les liens, puis le nombre d'emails", () => {
    expect(libelleBoutonVolet("renvoyer", 2, lot)).toBe(
      "Renvoyer 2 liens (2 emails)",
    );
  });

  it("le rôle : « Appliquer le rôle » tant qu'aucun n'est choisi", () => {
    expect(libelleBoutonVolet("role", 3, lot)).toBe("Appliquer le rôle");
    expect(
      libelleBoutonVolet("role", 3, lot, {
        libelle: "Instructeur",
        changent: 3,
      }),
    ).toBe("Passer 3 comptes en Instructeur");
  });

  it("un geste sans email garde le bouton de l'ordinateur", () => {
    expect(libelleBoutonVolet("desactiver", 3, lot)).toBe(
      "Désactiver 3 comptes",
    );
  });
});
