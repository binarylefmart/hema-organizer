import { describe, expect, it } from "vitest";
import { genererCodesSecours, normaliserCodeSecours, ressembleAUnCodeSecours } from "@/lib/auth/codes-secours";

describe("codes de secours 2FA", () => {
  it("génère 8 codes distincts au format XXXX-XXXX sans caractères ambigus", () => {
    const codes = genererCodesSecours();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
  it("normalise la saisie (casse, espaces, tirets) et distingue un code d'un TOTP", () => {
    expect(normaliserCodeSecours(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(ressembleAUnCodeSecours("abcd efgh")).toBe(true);
    expect(ressembleAUnCodeSecours("123456")).toBe(false);
  });
});
