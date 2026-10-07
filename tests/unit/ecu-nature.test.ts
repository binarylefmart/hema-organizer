import { describe, expect, it } from "vitest";
import { NATURES_ELEMENT } from "@/lib/constants";
import { FOND_PIECE_NATURE, PIECES_NATURE } from "@/components/seances/ecu-nature";

describe("écu des natures d'élément", () => {
  it("chaque nature a sa pièce et sa couleur de pièce", () => {
    for (const n of NATURES_ELEMENT) {
      expect(PIECES_NATURE[n]).toMatch(/^M/);
      expect(FOND_PIECE_NATURE[n]).toMatch(/^fill-/);
    }
  });

  it("deux natures ne portent jamais la même pièce", () => {
    const pieces = NATURES_ELEMENT.map((n) => PIECES_NATURE[n]);
    expect(new Set(pieces).size).toBe(pieces.length);
  });
});
