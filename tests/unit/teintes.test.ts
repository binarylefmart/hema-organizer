import { describe, expect, it } from "vitest";
import type { NatureElement } from "@/lib/constants";
import {
  classesPartie,
  NOMBRE_TEINTES,
  normaliserTheme,
  prendUneTeinte,
  teinteAEcrire,
  teinteDuTheme,
  teinteLibre,
  teintePartie,
  teintesProgramme,
  type ElementTeinte,
} from "@/components/seances/teintes";
import { FOND_PIECE_NATURE, piece } from "@/components/seances/ecu-nature";

/**
 * **La teinte de chaque élément et de chaque partie** (`teintes.ts`) — la règle que l'écriture et la
 * lecture partagent : un cours ou une option prend la teinte de **son thème** (place dans la liste du
 * club, sinon hachage du texte normalisé, teinte 1 pour un thème vide), la suivante libre si un autre
 * élément de la séance la porte déjà ; elle est enregistrée et ne bouge plus que si le thème change.
 * L'échauffement et l'atelier n'en prennent pas ; la partie N prend la teinte N.
 */
const CLUB = ["Épée longue", "Messer", "Dague", "Lutte", "Sabre", "Bâton", "Rapière", "Épée-bocle", "Hallebarde"];
let suite = 0;
const el = (nature: NatureElement, theme = "", x: Partial<ElementTeinte> = {}): ElementTeinte => ({ id: `c${String(++suite).padStart(3, "0")}`, bloc: 1, nature, theme, teinte: null, ...x });

describe("la teinte d'un thème", () => {
  it("vient de la place du thème dans la liste du club, et reboucle au-delà de la palette", () => {
    expect(teinteDuTheme("Épée longue", CLUB)).toBe(1);
    expect(teinteDuTheme("Dague", CLUB)).toBe(3);
    expect(teinteDuTheme("Hallebarde", CLUB)).toBe(((CLUB.length - 1) % NOMBRE_TEINTES) + 1);
  });

  it("ignore la casse, les accents et les espaces : c'est le même thème", () => {
    expect(normaliserTheme("  Épée   LONGUE ")).toBe("epee longue");
    expect(teinteDuTheme("epee longue", CLUB)).toBe(1);
  });

  it("donne à un thème libre une teinte tirée de son texte, la même partout, et la 1 à un thème vide", () => {
    const libre = teinteDuTheme("Escrime de spectacle", CLUB);
    expect(teinteDuTheme("escrime de SPECTACLE", [])).toBe(teinteDuTheme("Escrime de spectacle", []));
    expect(libre).toBeGreaterThanOrEqual(1);
    expect(libre).toBeLessThanOrEqual(NOMBRE_TEINTES);
    expect(teinteDuTheme("   ", CLUB)).toBe(1);
  });

  it("prend la suivante libre quand la sienne est prise, et la sienne quand tout est pris", () => {
    expect(teinteLibre(3, new Set([3, 4]))).toBe(5);
    expect(teinteLibre(NOMBRE_TEINTES, new Set([NOMBRE_TEINTES]))).toBe(1);
    expect(teinteLibre(2, new Set(Array.from({ length: NOMBRE_TEINTES }, (_, i) => i + 1)))).toBe(2);
  });

  it("ne donne une teinte qu'au cours et à l'option", () => {
    expect((["ECHAUFFEMENT", "COURS", "OPTION", "ATELIER"] as const).filter(prendUneTeinte)).toEqual(["COURS", "OPTION"]);
  });
});

describe("teintesProgramme : les teintes d'une séance à la lecture", () => {
  it("garde la teinte enregistrée, même si son thème en voudrait une autre", () => {
    const { elements } = teintesProgramme([el("COURS", "Dague", { teinte: 6 })], CLUB);
    expect(elements).toEqual([6]);
  });

  it("ne dépend pas de l'ordre : réordonner deux cours n'échange pas leurs teintes", () => {
    const a = el("COURS", "Messer");
    const b = el("OPTION", "Lutte");
    const avant = teintesProgramme([a, b], CLUB).elements;
    const apres = teintesProgramme([b, a], CLUB).elements;
    expect(apres).toEqual([avant[1], avant[0]]);
    expect(avant[0]).not.toBe(avant[1]);
  });

  it("ne dépend pas de la partie : changer un élément de partie ne change pas sa teinte", () => {
    const a = el("COURS", "Lutte");
    const b = el("COURS", "Sabre");
    const avant = teintesProgramme([a, b], CLUB).elements;
    const apres = teintesProgramme([a, { ...b, bloc: 2 }], CLUB).elements;
    expect(apres).toEqual(avant);
  });

  it("donne la même teinte à deux cours au même thème, dans une séance comme d'une séance à l'autre", () => {
    const seanceA = teintesProgramme([el("COURS", "Messer"), el("OPTION", "Messer")], CLUB).elements;
    const seanceB = teintesProgramme([el("COURS", "Dague"), el("OPTION", "Messer")], CLUB).elements;
    expect(seanceA[0]).toBe(seanceA[1]);
    expect(seanceA[0]).toBe(seanceB[1]);
  });

  it("ne fait pas partager sa teinte à deux cours encore sans thème", () => {
    const { elements } = teintesProgramme([el("COURS", ""), el("COURS", "")], CLUB);
    expect(elements[0]).not.toBe(elements[1]);
  });

  it("attribue les lignes sans teinte après les teintes enregistrées, dans l'ordre de création", () => {
    // La plus ancienne (identifiant le plus petit) choisit d'abord, quel que soit l'ordre reçu.
    const ancienne = el("COURS", "Dague");
    const recente = el("COURS", "Dague");
    const posee = el("OPTION", "Épée longue", { teinte: 3 });
    const { elements } = teintesProgramme([recente, posee, ancienne], CLUB);
    // La teinte de « Dague » est prise par « Épée longue » (enregistrée) : la plus ancienne prend la
    // suivante libre, et la récente, au même thème, la partage.
    expect(elements).toEqual([4, 3, 4]);
  });

  it("ne donne ni ne consomme de teinte pour l'échauffement et l'atelier, même enregistrée par erreur", () => {
    const { elements } = teintesProgramme([el("ECHAUFFEMENT", "Mobilité", { teinte: 1 }), el("ATELIER", "Lutte au sol"), el("COURS", "Épée longue")], CLUB);
    expect(elements).toEqual([null, null, 1]);
  });

  it("donne à la partie N la teinte N, quelle que soit la nature de ses éléments", () => {
    const { parties } = teintesProgramme([el("ECHAUFFEMENT"), el("ATELIER", "", { bloc: 2 }), el("COURS", "", { bloc: 3 })], CLUB);
    expect([...parties.entries()]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(teintePartie(NOMBRE_TEINTES + 1)).toBe(1);
  });
});

describe("teinteAEcrire : la teinte qu'on enregistre", () => {
  it("prend celle du thème si elle est libre dans la séance, sinon la suivante libre", () => {
    expect(teinteAEcrire({ nature: "COURS", theme: "Dague" }, [], CLUB)).toBe(3);
    expect(teinteAEcrire({ nature: "COURS", theme: "Dague" }, [el("OPTION", "Sabre", { teinte: 3 })], CLUB)).toBe(4);
  });

  it("compte aussi les voisins dont la teinte n'est pas encore enregistrée, avec la valeur qu'ils affichent", () => {
    expect(teinteAEcrire({ nature: "OPTION", theme: "Messer" }, [el("COURS", "Messer")], CLUB)).toBe(2);
    expect(teinteAEcrire({ nature: "OPTION", theme: "Lutte" }, [el("COURS", "Messer", { teinte: 4 })], CLUB)).toBe(5);
  });

  it("change avec le thème : un autre thème, une autre teinte", () => {
    const autres = [el("COURS", "Lutte", { teinte: 4 })];
    expect(teinteAEcrire({ nature: "COURS", theme: "Messer" }, autres, CLUB)).toBe(2);
    expect(teinteAEcrire({ nature: "COURS", theme: "Sabre" }, autres, CLUB)).toBe(5);
  });

  it("rend null pour un échauffement ou un atelier", () => {
    expect(teinteAEcrire({ nature: "ECHAUFFEMENT", theme: "Mobilité" }, [], CLUB)).toBeNull();
    expect(teinteAEcrire({ nature: "ATELIER", theme: "Lutte" }, [], CLUB)).toBeNull();
  });
});

describe("les classes d'une partie et de l'écu", () => {
  it("écrit le titre et la bande de 4 px de la partie dans sa teinte, sans fond", () => {
    expect(classesPartie(2)).toEqual({ titre: "text-teinte-2", bande: "border-l-4 border-teinte-2" });
    expect(classesPartie(2).bande).not.toMatch(/\bbg-/);
  });

  it("découpe la pièce de l'écu dans le fond réel de l'étiquette", () => {
    // Aplat du cours : la pièce a la teinte (le fond) ; contour de l'option : la teinte douce.
    expect(piece("COURS", 3)).toBe("fill-teinte-3");
    expect(piece("OPTION", 3)).toBe("fill-teinte-3-doux");
    // Échauffement et atelier : leur fond à eux, teinte ou pas.
    expect(piece("ECHAUFFEMENT", 2)).toBe(FOND_PIECE_NATURE.ECHAUFFEMENT);
    expect(piece("ATELIER", null)).toBe(FOND_PIECE_NATURE.ATELIER);
  });
});
