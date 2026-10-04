import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHOIX_VIDE,
  entreesGestes,
  gesteRetenu,
  messageApresGeste,
  nomsCourts,
  phraseEmails,
  QUESTION_GESTE,
  varianteGeste,
} from "@/components/ui/choix-geste";

/**
 * **Une seule grammaire « Que veux-tu faire ? » dans toute l'administration.** Ce fichier garde la
 * mécanique commune : la liste part de « Choisir une action… », un choix qui ne s'applique plus y
 * revient, seul le définitif est rouge, un geste dit toujours quelque chose après coup — et la
 * confirmation de chaque geste est gardée.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("la forme commune", () => {
  it("pose la même question et part de « Choisir une action… »", () => {
    expect(QUESTION_GESTE).toBe("Que veux-tu faire ?");
    expect(entreesGestes([{ geste: "a", libelle: "Faire A (2 personnes)" }])).toEqual([
      { valeur: "", libelle: "Choisir une action…" },
      { valeur: "a", libelle: "Faire A (2 personnes)" },
    ]);
    expect(CHOIX_VIDE.valeur).toBe("");
  });

  it("revient au choix vide quand le geste ne s'applique plus", () => {
    expect(gesteRetenu("a", [{ geste: "a" }])).toBe("a");
    expect(gesteRetenu("a", [{ geste: "b" }])).toBe("");
    expect(gesteRetenu("", [{ geste: "a" }])).toBe("");
  });

  it("n'est rouge que pour un geste marqué, ou dont le libellé commence par un verbe du rouge", () => {
    expect(varianteGeste(true)).toBe("danger");
    expect(varianteGeste(false)).toBe("primaire");
    expect(varianteGeste(undefined)).toBe("primaire");
    expect(varianteGeste(undefined, "Retirer du planning")).toBe("danger");
  });

  it("nomme trois personnes, puis compte", () => {
    expect(nomsCourts(["Anne"])).toBe("Anne");
    expect(nomsCourts(["Anne", "Paul"])).toBe("Anne et Paul");
    expect(nomsCourts(["A", "B", "C", "D", "E"])).toBe("A, B, C et 2 autres");
    expect(phraseEmails(1)).toBe("1 email partira.");
    expect(phraseEmails(3)).toBe("3 emails partiront.");
  });

  it("dit toujours quelque chose après le geste", () => {
    expect(messageApresGeste(undefined, "C'est fait.")).toEqual({ type: "ok", texte: "C'est fait." });
    expect(messageApresGeste({ succes: "3 liens partis." }, "x")).toEqual({ type: "ok", texte: "3 liens partis." });
    expect(messageApresGeste({ erreur: "Refusé." }, "x")).toEqual({ type: "erreur", texte: "Refusé." });
    expect(messageApresGeste("aucun compte à réactiver", "x")).toEqual({ type: "ok", texte: "Aucun compte à réactiver" });
  });
});

describe("les composants", () => {
  it("gardent la confirmation de chaque geste et ne lancent rien sans choix", () => {
    const proposes = source("src/components/ui/GestesProposes.tsx");
    expect(proposes).toContain("window.confirm(retenu.confirmation)");
    expect(proposes).toContain("inerte={!retenu}");
    expect(proposes).toContain('setChoisi("")');
    const choix = source("src/components/ui/ChoixGeste.tsx");
    expect(choix).toContain("disabled={inerte || enCours}");
    expect(choix).toContain("<ExplicationGeste");
  });

  it("servent à l'annuaire comme aux autres écrans : une seule forme", () => {
    expect(source("src/app/(app)/admin/membres/SelectionRoles.tsx")).toContain("<ChoixGeste");
    expect(source("src/app/(app)/admin/membres/ChoixToutLeMonde.tsx")).toContain("<GestesProposes");
  });
});
