import { describe, expect, it } from "vitest";
import { blocDate, groupesParEtat } from "@/components/evenements/groupes-gestion";

const e = (id: string, publie: boolean | null | undefined) => ({ id, publie });

describe("la liste de gestion des événements au téléphone, rangée par état", () => {
  it("met « À publier » (les brouillons) en tête, puis « Publiés »", () => {
    const groupes = groupesParEtat([e("a", true), e("b", false), e("c", true)]);
    expect(groupes.map((g) => g.titre)).toEqual(["À publier", "Publiés"]);
    expect(groupes.map((g) => g.cle)).toEqual(["a-publier", "publies"]);
  });

  it("garde l'ordre reçu (celui des dates) dans chaque groupe", () => {
    // À venir : dates croissantes ; Passé : décroissantes — le regroupement n'en refait aucun.
    const groupes = groupesParEtat([e("1", true), e("2", false), e("3", true), e("4", false), e("5", true)]);
    expect(groupes[0].evenements.map((x) => x.id)).toEqual(["2", "4"]);
    expect(groupes[1].evenements.map((x) => x.id)).toEqual(["1", "3", "5"]);
  });

  it("n'affiche pas un groupe vide", () => {
    expect(groupesParEtat([e("a", true)]).map((g) => g.titre)).toEqual(["Publiés"]);
    expect(groupesParEtat([e("a", false)]).map((g) => g.titre)).toEqual(["À publier"]);
    expect(groupesParEtat([])).toEqual([]);
  });

  it("compte une annonce sans état connu comme un brouillon, comme la pastille de l'ordinateur", () => {
    expect(groupesParEtat([e("a", null), e("b", undefined)])[0]).toMatchObject({ cle: "a-publier", evenements: [{ id: "a" }, { id: "b" }] });
  });

  it("n'oublie ni ne double aucune annonce", () => {
    const liste = [e("1", true), e("2", false), e("3", null), e("4", true)];
    const ids = groupesParEtat(liste).flatMap((g) => g.evenements.map((x) => x.id));
    expect(ids.sort()).toEqual(["1", "2", "3", "4"]);
  });
});

describe("le bloc date de la ligne", () => {
  it("donne le jour de la semaine abrégé et le numéro du jour", () => {
    expect(blocDate("2026-10-31")).toEqual({ semaine: "sam.", jour: "31" });
    expect(blocDate("2026-11-02")).toEqual({ semaine: "lun.", jour: "2" });
  });
});
