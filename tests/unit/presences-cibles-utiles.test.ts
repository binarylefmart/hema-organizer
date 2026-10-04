import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ciblesUtiles } from "@/components/gestion/selection-presences";

/**
 * **La barre de correction des présences ne propose que les réponses qui changeraient quelqu'un** :
 * un bouton qui ne s'applique pas n'apparaît pas, comme partout dans l'administration.
 */
describe("les réponses proposées au lot", () => {
  it("toutes, quand le lot mélange les réponses", () => {
    expect(ciblesUtiles([{ id: "a", statut: "PRESENT" }, { id: "b", statut: null }])).toEqual(["PRESENT", "ABSENT", "PEUT_ETRE", null]);
  });

  it("pas celle que tout le lot porte déjà", () => {
    expect(ciblesUtiles([{ id: "a", statut: "PRESENT" }, { id: "b", statut: "PRESENT" }])).toEqual(["ABSENT", "PEUT_ETRE", null]);
    expect(ciblesUtiles([{ id: "a", statut: null }])).toEqual(["PRESENT", "ABSENT", "PEUT_ETRE"]);
  });

  it("rien sans sélection", () => {
    expect(ciblesUtiles([])).toEqual([]);
  });

  it("la barre s'en sert, et garde sa confirmation", () => {
    const code = readFileSync(path.join(process.cwd(), "src/components/gestion/PresencesEquipe.tsx"), "utf8");
    expect(code).toContain("ciblesUtiles(");
    expect(code).toContain("window.confirm(texteConfirmation(resume, cible))");
  });
});
