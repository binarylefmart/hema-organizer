import { describe, expect, it } from "vitest";
import { membrePeutModifier, transitionAutorisee } from "@/lib/ateliers";

describe("cycle de vie d'un atelier (minimal)", () => {
  it("en attente → dans le planning ou refusé", () => {
    expect(transitionAutorisee("PROPOSE", "PLANIFIE")).toBe(true);
    expect(transitionAutorisee("PROPOSE", "REFUSE")).toBe(true);
    expect(transitionAutorisee("PROPOSE", "PROPOSE")).toBe(false);
  });
  it("dans le planning → retiré (en attente) ou refusé ; refusé → réexaminé", () => {
    expect(transitionAutorisee("PLANIFIE", "PROPOSE")).toBe(true);
    expect(transitionAutorisee("PLANIFIE", "REFUSE")).toBe(true);
    expect(transitionAutorisee("REFUSE", "PROPOSE")).toBe(true);
    expect(transitionAutorisee("REFUSE", "PLANIFIE")).toBe(false);
  });
  it("refuse les statuts inconnus", () => {
    expect(transitionAutorisee("BIDON", "PLANIFIE")).toBe(false);
    expect(transitionAutorisee("PROPOSE", "VALIDE")).toBe(false);
  });
  it("le membre ne modifie que tant que la proposition est en attente", () => {
    expect(membrePeutModifier("PROPOSE")).toBe(true);
    for (const s of ["REFUSE", "PLANIFIE"]) expect(membrePeutModifier(s)).toBe(false);
  });
});
