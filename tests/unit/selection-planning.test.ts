import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIBELLE_VIDE } from "@/lib/constants";
import type { Paire } from "@/components/planning/file-envoi";
import { VARIABLE_HAUTEUR_BARRE_EDITION } from "@/components/ui/barre-selection";
import { casesAEnvoyer, paireImposee, poserEnMasse, texteEcartees, type EtatBrouillon } from "@/components/planning/brouillon";
import { AUTRE } from "@/components/planning/options";
import {
  blocsProposes,
  CHAMPS_INCHANGES,
  choisirInstructeur,
  confirmationPlanning,
  confirmationRetrait,
  elementsRetirablesPlanning,
  expliquerRetrait,
  libelleBoutonRetrait,
  seancesARetirer,
  ECRIRE,
  ENTREES_TETE,
  expliquerAjout,
  expliquerReglages,
  expliquerRemplacement,
  gestesPlanningApplicables,
  INVITE_PLANNING,
  issueReglage,
  libelleBlocPropose,
  libelleBoutonAjout,
  libelleBoutonReglages,
  libelleBoutonRemplacement,
  libellePartieProposee,
  libelleThemeTrouve,
  libelleToutesSeancesPlanning,
  lireChoix,
  messageReglages,
  messageRemplacement,
  NE_PAS_CHANGER,
  partiesProposees,
  phrasesEcarts,
  planReglage,
  planReglages,
  planRemplacement,
  reglageDepuisChamps,
  reglageVide,
  seancesSansLaPartie,
  texteSansCasePlanning,
  themeMixte,
  themeRetenu,
  themesRemplacants,
  themesTrouves,
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
  it("régler des éléments, remplacer un thème, ajouter dans une partie — chacun avec son nombre", () => {
    expect(gestesPlanningApplicables([a, b, c]).map((g) => [g.geste, g.nombre, g.libelle])).toEqual([
      ["regler", 2, "Régler des éléments (2 séances)"],
      // Seule « b » porte un thème (hors atelier).
      ["remplacer", 1, "Remplacer un thème (1 séance)"],
      ["ajouter", 3, "Ajouter dans une partie (3 séances)"],
      // « c » n'a qu'une case d'atelier : rien à retirer d'ici.
      ["retirer", 2, "Retirer un élément du programme (2 séances)"],
    ]);
  });

  it("« Remplacer un thème » n'est proposé que si un thème est présent — celui du brouillon compris", () => {
    expect(gestesPlanningApplicables([a]).map((g) => g.geste)).toEqual(["regler", "ajouter", "retirer"]);
    const brouillon = new Map([["a3", { ...VIDE, theme: "Dague" }]]);
    expect(gestesPlanningApplicables([a], brouillon).map((g) => g.geste)).toEqual(["regler", "remplacer", "ajouter", "retirer"]);
    // Un thème vidé dans le brouillon ne compte plus.
    expect(gestesPlanningApplicables([b], new Map([["b1", { ...VIDE }]])).map((g) => g.geste)).toEqual(["regler", "ajouter", "retirer"]);
    // Le thème d'un atelier (son titre) ne se remplace pas.
    const atelier = seance("t", [partie("t1", "Partie 1 · Cours", { atelier: true, serveur: { ...VIDE, theme: "Lutte" } })]);
    expect(gestesPlanningApplicables([atelier]).map((g) => g.geste)).toEqual(["ajouter"]);
  });

  it("la phrase d'invite nomme les quatre gestes", () => {
    expect(INVITE_PLANNING).toBe("Coche des lignes pour régler des éléments, remplacer un thème, ajouter ou retirer un élément sur plusieurs séances à la fois.");
  });

  it("une séance dont toutes les parties portent un atelier n'a rien à régler", () => {
    expect(gestesPlanningApplicables([c]).map((g) => g.geste)).toEqual(["ajouter"]);
  });

  it("retirer un élément : les noms du lot, comptés, sans les cases d'atelier", () => {
    expect(elementsRetirablesPlanning([a, b, c])).toEqual([
      { libelle: "Partie 1 · Cours", nombre: 2 },
      { libelle: "Partie 2 · Cours", nombre: 2 },
      { libelle: "Partie 2 · Option", nombre: 1 },
    ]);
    expect(seancesARetirer([a, b, c], "Partie 2 · Option").map((l) => l.id)).toEqual(["a"]);
    expect(seancesARetirer([a, b, c], "")).toEqual([]);
    expect(libelleBoutonRetrait(2)).toBe("Retirer de 2 séances");
    expect(confirmationRetrait("Partie 1 · Cours", 2, 1)).toBe("Retirer « Partie 1 · Cours » de 2 séances ? 1 séance de la sélection reste de côté. Rien ne se récupère.");
    const e = expliquerRetrait([a, b], "Partie 2 · Option");
    expect(e.titre).toBe("« Partie 2 · Option » disparaît du programme de la séance.");
    expect(e.phrases.join(" ")).toContain("1 séance ne porte pas cet élément");
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

  it("l'ordre est celui de la place par défaut — partie, nature (l'atelier avant l'option), rang —, pas celui de la première séance cochée", () => {
    const d = seance("d", [
      partie("d3", "Partie 2 · Option 2"),
      partie("d1", "Partie 3 · Cours"),
      partie("d4", "Partie 2 · Atelier"),
      partie("d0", "Partie 1 · Échauffement"),
    ]);
    expect(partiesProposees([d, a]).map((x) => x.libelle)).toEqual([
      "Partie 1 · Échauffement",
      "Partie 1 · Cours",
      "Partie 2 · Cours",
      "Partie 2 · Atelier",
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
    const e = expliquerAjout([a, c], { bloc: 2, nature: "OPTION" });
    expect(e.titre).toBe("Option s'ajoute dans la partie 2 sur chacune des 2 séances, tout de suite.");
    expect(e.phrases.join(" ")).toMatch(/1 séance n'a pas encore de partie 2 : l'élément y ouvre une nouvelle partie, à la fin/);
  });

  it("le bouton et la question nomment la nature et la partie", () => {
    expect(libelleBoutonAjout(4, { bloc: 1, nature: "ECHAUFFEMENT" })).toBe("Ajouter un échauffement dans la partie 1 à 4 séances");
    expect(libelleBoutonAjout(4, null)).toBe("Ajouter");
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
    const plan = planReglages([a, c], [{ libelle: "Partie 1 · Cours", reglage: { theme: "Dague" } }], new Map());
    const e = expliquerReglages(plan);
    expect(e.titre).toBe("1 élément est réglé sur 1 séance, dans le brouillon.");
    expect(e.phrases.join(" ")).toMatch(/Rien n'est encore enregistré/);
    expect(e.phrases).toContain("« Partie 1 · Cours » — 1 séance reste de côté : elle porte un atelier dans cette partie (il se change depuis la gestion des ateliers).");
    expect(libelleBoutonReglages(plan)).toBe("Appliquer à 1 séance");
    expect(libelleBoutonAjout(4, { bloc: 2, nature: "OPTION" })).toBe("Ajouter une option dans la partie 2 à 4 séances");
  });

  it("les ajouts disent qu'ils partent tout de suite, et qu'« Annuler » ne les défait pas", () => {
    const e = expliquerAjout([a, b], { bloc: 1, nature: "COURS" });
    expect(e.titre).toMatch(/tout de suite/);
    expect(e.phrases.join(" ")).toMatch(/« Annuler » ne le défait pas/);
  });
});

/**
 * **« Régler des éléments »** : plusieurs noms cochés, chacun avec ses réglages, posés
 * d'un seul appui sur toutes les séances cochées qui les portent.
 */
describe("régler plusieurs éléments d'un appui", () => {
  // Six séances au même programme : un échauffement et un cours dans la partie 1.
  const six = Array.from({ length: 6 }, (_, i) =>
    seance(`s${i}`, [partie(`s${i}e`, "Partie 1 · Échauffement"), partie(`s${i}c`, "Partie 1 · Cours")]),
  );

  it("l'exemple de Delta : échauffement « Footwork », cours « Messer » avec Charlie → 12 cases sur 6 séances", () => {
    const plan = planReglages(
      six,
      [
        { libelle: "Partie 1 · Échauffement", reglage: { theme: "Footwork" } },
        { libelle: "Partie 1 · Cours", reglage: { theme: "Messer", instructeurId: "u-charlie" } },
      ],
      new Map(),
    );
    expect(plan.ecritures).toHaveLength(12);
    expect(plan.seances).toBe(6);
    expect(plan.ecritures.find((e) => e.partieId === "s0e")?.paire).toEqual({ ...VIDE, theme: "Footwork" });
    expect(plan.ecritures.find((e) => e.partieId === "s3c")?.paire).toEqual({ ...VIDE, theme: "Messer", instructeurId: "u-charlie" });
    expect(libelleBoutonReglages(plan)).toBe("Appliquer aux 6 séances");
    expect(expliquerReglages(plan).titre).toBe("12 éléments sont réglés sur 6 séances, dans le brouillon.");
    expect(expliquerReglages(plan).phrases).toContain("« Partie 1 · Échauffement » : réglé sur 6 séances.");
    expect(messageReglages(plan)).toBe("12 éléments réglés sur 6 séances, pas encore appliqués : « Appliquer » les enregistre.");
  });

  it("chaque élément suit les règles d'un seul : atelier de côté, refus de la case, déjà au réglage", () => {
    const plan = planReglages(
      [a, b, c],
      [
        { libelle: "Partie 1 · Cours", reglage: { instructeurId: "u-alix" } },
        { libelle: "Partie 2 · Option", reglage: { niveau: "AVANCE" } },
      ],
      new Map(),
    );
    // Partie 1 · Cours : a1 change, b1 porte déjà Alix, c1 est un atelier. Partie 2 · Option : a3 n'a pas de thème.
    expect(plan.ecritures.map((e) => e.partieId)).toEqual(["a1"]);
    expect(plan.seances).toBe(1);
    const phrases = expliquerReglages(plan).phrases;
    expect(phrases).toContain("« Partie 1 · Cours » : réglé sur 1 séance ; 1 séance porte déjà ce réglage.");
    expect(phrases).toContain("« Partie 2 · Option » : aucune séance ne changerait.");
    expect(phrases).toContain("« Partie 2 · Option » — 1 séance reste de côté : elle n'a pas de thème : niveau et description l'attendent.");
  });

  it("deux éléments de la même séance ne la comptent qu'une fois, et un élément sans réglage n'écrit rien", () => {
    const plan = planReglages(
      [a],
      [
        { libelle: "Partie 1 · Cours", reglage: { theme: "Dague" } },
        { libelle: "Partie 2 · Cours", reglage: { theme: "Sabre" } },
        { libelle: "Partie 2 · Option", reglage: {} },
      ],
      new Map(),
    );
    expect(plan.ecritures.map((e) => e.partieId)).toEqual(["a1", "a2"]);
    expect(plan.seances).toBe(1);
    expect(plan.parElement.map((e) => [e.libelle, e.plan === null])).toEqual([
      ["Partie 1 · Cours", false],
      ["Partie 2 · Cours", false],
      ["Partie 2 · Option", true],
    ]);
    expect(expliquerReglages(plan).phrases).toContain("« Partie 2 · Option » : rien à changer pour l'instant, tout est sur « Ne pas changer ».");
  });

  it("rien de coché, ou tout sur « Ne pas changer » : le bouton reste muet", () => {
    expect(expliquerReglages(null).titre).toBe("Coche les éléments à régler, puis choisis ce qui change pour chacun.");
    const vide = planReglages([a], [{ libelle: "Partie 1 · Cours", reglage: {} }], new Map());
    expect(vide.ecritures).toEqual([]);
    expect(expliquerReglages(vide).titre).toBe("Choisis ce qui change pour chaque élément coché.");
    expect(libelleBoutonReglages(vide)).toBe("Régler les éléments");
  });

  it("part du brouillon de chaque case", () => {
    const brouillon = new Map([["a2", { ...VIDE, instructeurId: "u-noe" }]]);
    const plan = planReglages([a], [{ libelle: "Partie 2 · Cours", reglage: { theme: "Lance" } }], brouillon);
    expect(plan.ecritures[0].paire).toEqual({ ...VIDE, instructeurId: "u-noe", theme: "Lance" });
  });
});

describe("les listes d'un réglage traduites en réglage", () => {
  it("tout sur « Ne pas changer » ne règle rien", () => {
    expect(reglageVide(reglageDepuisChamps(CHAMPS_INCHANGES, ["Dague"]))).toBe(true);
  });

  it("un thème hors de la liste de sa nature revient à « Ne pas changer »", () => {
    const champs = { ...CHAMPS_INCHANGES, theme: "Messer" };
    expect(themeRetenu(champs, ["Footwork"])).toBe(NE_PAS_CHANGER);
    expect(reglageDepuisChamps(champs, ["Footwork"]).theme).toBeUndefined();
    expect(reglageDepuisChamps(champs, ["Messer"]).theme).toBe("Messer");
  });

  it("« Autre… » et « Écrire une description… » prennent le texte libre, vide = ne pas changer", () => {
    const champs = { ...CHAMPS_INCHANGES, theme: AUTRE, themeLibre: "  Dussack ", description: ECRIRE, descriptionTexte: "" };
    expect(reglageDepuisChamps(champs, [])).toEqual({ instructeurId: undefined, instructeurSecondId: undefined, theme: "Dussack", niveau: undefined, description: undefined });
  });

  it("choisir pour mener la personne qui assistait libère la place du second", () => {
    expect(choisirInstructeur({ ...CHAMPS_INCHANGES, second: "u-alix" }, "u-alix").second).toBe(NE_PAS_CHANGER);
    expect(choisirInstructeur({ ...CHAMPS_INCHANGES, second: "u-alix" }, "u-noe").second).toBe("u-alix");
  });
});

/**
 * **« Remplacer un thème »** : un thème trouvé dans les séances cochées, et son
 * remplaçant pris dans la bonne liste du club.
 */
describe("remplacer un thème", () => {
  const LISTES = { themes: ["Messer", "Sabre", "Épée longue"], themesEchauffement: ["Footwork", "Souplesse", "Messer"] };
  const t1 = seance("t1", [
    partie("t1e", "Partie 1 · Échauffement", { serveur: { ...VIDE, theme: "Footwork" } }),
    partie("t1c", "Partie 1 · Cours", { serveur: { ...VIDE, theme: "Messer", instructeurId: "u-alix", niveau: "AVANCE", description: "Garde haute" } }),
    partie("t1o", "Partie 1 · Option", { serveur: { ...VIDE, theme: "messer " } }),
  ]);
  const t2 = seance("t2", [
    partie("t2c", "Partie 1 · Cours", { serveur: { ...VIDE, theme: "Messer" } }),
    partie("t2a", "Partie 1 · Atelier", { atelier: true, serveur: { ...VIDE, theme: "Messer" } }),
  ]);
  const t3 = seance("t3", [partie("t3c", "Partie 1 · Cours", { serveur: { ...VIDE, theme: "Sabre" } })]);

  it("les thèmes présents, à la casse et aux espaces près, avec éléments et séances — atelier à part", () => {
    const trouves = themesTrouves([t1, t2, t3], new Map());
    expect(trouves.map(libelleThemeTrouve)).toEqual(["Footwork — 1 élément sur 1 séance", "Messer — 3 éléments sur 2 séances", "Sabre — 1 élément sur 1 séance"]);
    const messer = trouves[1];
    expect([messer.echauffements, messer.autres, messer.ateliers]).toEqual([0, 3, 1]);
  });

  it("lit le brouillon : un thème changé à la main compte sous son nouveau nom", () => {
    const trouves = themesTrouves([t3], new Map([["t3c", { ...VIDE, theme: "Épée longue" }]]));
    expect(trouves.map((t) => t.theme)).toEqual(["Épée longue"]);
  });

  it("propose la liste de la nature, sans le thème remplacé", () => {
    const [footwork, messer] = themesTrouves([t1, t2], new Map());
    expect(themesRemplacants(footwork, LISTES)).toEqual(["Souplesse", "Messer"]);
    expect(themesRemplacants(messer, LISTES)).toEqual(["Sabre", "Épée longue"]);
  });

  it("tous les éléments qui le portent reçoivent le nouveau thème, le reste de la case gardé", () => {
    const messer = themesTrouves([t1, t2, t3], new Map())[1];
    const plan = planRemplacement([t1, t2, t3], messer.cle, "Sabre", LISTES, new Map());
    expect(plan.ecritures.map((e) => e.partieId)).toEqual(["t1c", "t1o", "t2c"]);
    expect(plan.seances).toBe(2);
    expect(plan.ecritures[0].paire).toEqual({ ...VIDE, theme: "Sabre", instructeurId: "u-alix", niveau: "AVANCE", description: "Garde haute" });
    expect(libelleBoutonRemplacement(plan)).toBe("Remplacer sur 3 éléments (2 séances)");
    const e = expliquerRemplacement(messer, "Sabre", plan);
    expect(e.titre).toBe("3 éléments sur 2 séances passent de « Messer » à « Sabre », dans le brouillon.");
    expect(e.phrases.join(" ")).toMatch(/Rien n'est encore enregistré/);
    expect(e.phrases.join(" ")).toMatch(/1 atelier porte aussi ce thème : il garde son titre, figé/);
    expect(messageRemplacement("Messer", "Sabre", plan)).toBe(
      "« Messer » remplacé par « Sabre » sur 3 éléments (2 séances), pas encore appliqués : « Appliquer » les enregistre.",
    );
  });

  it("avant le remplaçant, l'explication annonce déjà « N éléments sur M séances »", () => {
    const messer = themesTrouves([t1, t2], new Map())[1];
    expect(expliquerRemplacement(messer, "", null).titre).toBe("« Messer » : 3 éléments sur 2 séances. Choisis son remplaçant.");
    expect(expliquerRemplacement(null, "", null).titre).toBe("Choisis le thème à remplacer, puis son remplaçant.");
    expect(libelleBoutonRemplacement(null)).toBe("Remplacer le thème");
  });

  it("un thème porté par un échauffement et un cours : listes réunies, chaque élément ne reçoit que la sienne", () => {
    const mixte = seance("m", [
      partie("me", "Partie 1 · Échauffement", { serveur: { ...VIDE, theme: "Messer" } }),
      partie("mc", "Partie 1 · Cours", { serveur: { ...VIDE, theme: "Messer" } }),
    ]);
    const [messer] = themesTrouves([mixte], new Map());
    expect(themeMixte(messer)).toBe(true);
    expect(themesRemplacants(messer, LISTES)).toEqual(["Footwork", "Souplesse", "Sabre", "Épée longue"]);
    const versSabre = planRemplacement([mixte], messer.cle, "Sabre", LISTES, new Map());
    expect(versSabre.ecritures.map((e) => e.partieId)).toEqual(["mc"]);
    expect(versSabre.horsListe).toEqual({ echauffements: 1, autres: 0 });
    const e = expliquerRemplacement(messer, "Sabre", versSabre);
    expect(e.phrases.join(" ")).toMatch(/porté par 1 échauffement et 1 cours ou option : la liste réunit/);
    expect(e.phrases).toContain("1 échauffement reste de côté : « Sabre » n'est pas un thème d'échauffement.");
    const versFootwork = planRemplacement([mixte], messer.cle, "Footwork", LISTES, new Map());
    expect(versFootwork.ecritures.map((x) => x.partieId)).toEqual(["me"]);
    expect(versFootwork.horsListe).toEqual({ echauffements: 0, autres: 1 });
  });

  it("le thème lui-même, ou un remplaçant vide, n'écrit rien", () => {
    const messer = themesTrouves([t2], new Map())[0];
    expect(planRemplacement([t2], messer.cle, "MESSER", LISTES, new Map()).ecritures).toEqual([]);
    expect(planRemplacement([t2], messer.cle, " ", LISTES, new Map()).ecritures).toEqual([]);
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

/**
 * **Un élément retiré ne bloque plus « Appliquer ».** Retiré pendant qu'il portait un réglage, il
 * laissait son identifiant dans le brouillon ; le serveur, tout-ou-rien, refusait alors le lot entier
 * (« Cette partie n'existe plus. Rien n'a été enregistré. ») et la seule issue était « Annuler ».
 */
describe("ce qu'« Appliquer » envoie", () => {
  it("écarte les éléments qui ne sont plus affichés, et garde l'ordre des autres", () => {
    const modifiees = new Map<string, Paire>([
      ["a", { ...VIDE, theme: "Dague" }],
      ["retiree", { ...VIDE, theme: "Sabre" }],
      ["b", { ...VIDE, theme: "Lance" }],
    ]);
    const { cases, ecartees } = casesAEnvoyer(modifiees, ["b", "a", "autre"]);
    expect(cases.map((c) => c.partieId)).toEqual(["a", "b"]);
    expect(cases[0]).toEqual({ partieId: "a", ...VIDE, theme: "Dague" });
    expect(ecartees).toEqual(["retiree"]);
  });

  it("n'écarte rien quand tout est encore là", () => {
    const { ecartees } = casesAEnvoyer(new Map([["a", VIDE]]), ["a"]);
    expect(ecartees).toEqual([]);
  });

  it("dit ce qu'il écarte", () => {
    expect(texteEcartees(1)).toBe("1 réglage portait sur un élément supprimé ou un cours commencé entre-temps : il a été écarté.");
    expect(texteEcartees(3)).toMatch(/^3 réglages portaient sur des éléments supprimés ou des cours commencés entre-temps/);
  });

  it("la barre d'édition passe par ce tri, avec les éléments que la page montre", () => {
    const barre = readFileSync(path.join(process.cwd(), "src/components/planning/BarreEdition.tsx"), "utf8");
    expect(barre).toContain("casesAEnvoyer(brouillon.modifiees, partiesAffichees)");
    expect(barre).not.toContain("[...brouillon.modifiees].map(");
    expect(readFileSync(path.join(process.cwd(), "src/components/planning/GrillePlanning.tsx"), "utf8")).toMatch(/<BarreEdition[^>]*partiesAffichees=/);
  });
});

/**
 * **La barre de sélection se cale sur la hauteur réelle de la barre d'édition.** Posée à `10rem`
 * fixes, elle supposait une barre d'édition d'une ligne : l'aide « i » ouverte ou un message
 * d'erreur la faisaient grandir, et « Appliquer » passait sous la barre de sélection.
 */
describe("les deux barres du bas du planning", () => {
  const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

  it("la barre de sélection lit la hauteur publiée quand elle se pose au-dessus d'une autre", () => {
    const selection = source("src/components/ui/BarreSelection.tsx");
    // Le nom publié et le nom lu sont le même : une faute de frappe ferait retomber sur la valeur par défaut.
    expect(selection).toContain(`var(${VARIABLE_HAUTEUR_BARRE_EDITION},`);
    expect(selection).not.toMatch(/\+10rem\)\]/);
  });
});

describe("l'écran", () => {
  const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

  it("« Régler des éléments » et « Remplacer un thème » vont dans le brouillon, sans action serveur à eux", () => {
    const code = source("src/components/planning/SelectionPlanning.tsx");
    expect(code).toContain("brouillon.poserPlusieurs(planOrdi.ecritures)");
    expect(code).toContain("brouillon.poserPlusieurs(planTheme.ecritures)");
    expect(code).toContain("brouillon.poserPlusieurs(planElements.ecritures)");
    expect(code).not.toContain("enregistrerCase");
    // Les seuls appels au serveur sont les ajouts et les retraits, confirmés.
    expect(code.match(/await \w+\(/g)).toEqual(["await appliquerGesteSeancesEnMasse(", "await ajouterPartiesEnMasse("]);
  });

  it("la case reprend ce que le brouillon lui impose, et se monte sur le brouillon en cours", () => {
    const code = source("src/components/planning/CaseEditeur.tsx");
    expect(code).toContain("paireImposee(imposee, tourVu)");
    expect(code).toContain("brouillon?.modifiees.get(valeur.id) ?? paireServeur(valeur)");
  });

  it("une séance annulée ou commencée n'a pas de case", () => {
    const code = source("src/components/planning/GrillePlanning.tsx");
    expect(code).toContain("enEdition && !c.annulee && !c.commencee ? <CaseSeancePlanning");
    expect(code).toMatch(/if \(c\.annulee \|\| c\.commencee\) return null;/);
  });

  it("une séance commencée reste affichée, grisée, et ses parties en lecture même en modification", () => {
    const code = source("src/components/planning/GrillePlanning.tsx");
    expect(code).toContain("const figee = c.commencee && !c.annulee;");
    expect(code).toContain("valeur={{ ...options, modifiable: false, peutProgrammer: false }}");
    expect(texteSansCasePlanning(0, 1)).toBe("1 séance commencée n'a pas de case : son programme ne se modifie plus.");
    expect(texteSansCasePlanning(1, 2)).toMatch(/1 séance annulée .* 2 séances commencées n'ont pas de case/);
  });

  it("le crayon ouvre les cases d'emblée : plus d'interrupteur, « Que veux-tu faire ? » avec une sélection", () => {
    const code = source("src/components/planning/SelectionPlanning.tsx");
    expect(code).not.toContain("InterrupteurSelection");
    expect(code).toContain("<ChoixGeste");
    expect(code).toContain("const montrerBarre = barreDeMasseVisible(selection);");
    expect(code).toContain('libelle="Continuer"');
  });
});
