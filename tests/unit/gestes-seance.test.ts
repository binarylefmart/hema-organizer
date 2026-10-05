import { describe, expect, it } from "vitest";
import { gestesSeance } from "@/components/seances/gestes-seance";
import { varianteGeste } from "@/components/ui/choix-geste";

const noms = (o: Parameters<typeof gestesSeance>[0]) => gestesSeance(o).map((g) => g.geste);

describe("« Que veux-tu faire ? » d'une séance", () => {
  it("ne propose que les gestes applicables", () => {
    expect(noms({ annulee: false, passee: false, ouvrir: true, supprimer: false })).toEqual(["ouvrir", "annuler"]);
    expect(noms({ annulee: true, passee: false, ouvrir: false, supprimer: false })).toEqual(["retablir"]);
    // Une séance commencée ne s'annule ni ne se rétablit : on ne prévient pas les gens dans la salle.
    expect(noms({ annulee: false, passee: true, ouvrir: true, supprimer: false })).toEqual(["ouvrir"]);
    expect(noms({ annulee: true, passee: true, ouvrir: false, supprimer: false })).toEqual([]);
  });

  it("annuler et supprimer sont rouges et confirmés ; ouvrir et rétablir non", () => {
    const gestes = gestesSeance({ annulee: false, passee: false, ouvrir: true, supprimer: true });
    const variante = (g: string) => {
      const x = gestes.find((y) => y.geste === g)!;
      return varianteGeste(x.definitif, x.bouton);
    };
    expect(variante("annuler")).toBe("danger");
    expect(variante("supprimer")).toBe("danger");
    expect(variante("ouvrir")).toBe("primaire");
    expect(gestes.find((g) => g.geste === "annuler")!.confirmation).toBeTruthy();
    expect(gestes.find((g) => g.geste === "supprimer")!.confirmation).toBeTruthy();
    expect(gestesSeance({ annulee: true, passee: false, ouvrir: false, supprimer: false })[0].definitif).toBeFalsy();
  });
});
