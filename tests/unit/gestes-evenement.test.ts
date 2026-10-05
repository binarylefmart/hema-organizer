import { describe, expect, it } from "vitest";
import { gestesEvenement } from "@/components/evenements/gestes-evenement";
import { varianteGeste } from "@/components/ui/choix-geste";

const TOUS = { modifier: true, supprimer: true };
const noms = (publie: boolean, droits = TOUS) => gestesEvenement({ nom: "Stage d'épée", publie }, droits).map((g) => g.geste);

describe("« Que veux-tu faire ? » d'une annonce d'événement", () => {
  it("propose publier OU dépublier selon l'état, jamais les deux, et la suppression en dernier", () => {
    expect(noms(false)).toEqual(["modifier", "publier", "supprimer"]);
    expect(noms(true)).toEqual(["modifier", "depublier", "supprimer"]);
  });

  it("ne propose que ce que la personne peut aboutir", () => {
    // `evenements.edit` seul : modifier et publier/dépublier, pas la suppression.
    expect(noms(true, { modifier: true, supprimer: false })).toEqual(["modifier", "depublier"]);
    // `evenements.creer_supprimer` seul : la suppression, et rien d'autre — un bouton seul à l'écran.
    expect(noms(false, { modifier: false, supprimer: true })).toEqual(["supprimer"]);
    // Ni l'un ni l'autre (un membre) : aucun geste, rien n'est rendu.
    expect(noms(true, { modifier: false, supprimer: false })).toEqual([]);
  });

  it("dépublier et supprimer sont rouges et confirmés ; modifier et publier neutres, sans confirmation", () => {
    const tous = [...gestesEvenement({ nom: "Stage", publie: true }, TOUS), ...gestesEvenement({ nom: "Stage", publie: false }, TOUS)];
    const g = (nom: string) => tous.find((x) => x.geste === nom)!;
    for (const rouge of ["depublier", "supprimer"]) {
      expect(varianteGeste(g(rouge).definitif, g(rouge).bouton), rouge).toBe("danger");
      expect(g(rouge).confirmation, rouge).toBeTruthy();
    }
    for (const neutre of ["modifier", "publier"]) {
      expect(varianteGeste(g(neutre).definitif, g(neutre).bouton), neutre).toBe("primaire");
      expect(g(neutre).confirmation, neutre).toBeUndefined();
    }
  });

  it("garde mot pour mot les confirmations des anciens boutons, avec le nom de l'annonce", () => {
    const [, depublier, supprimer] = gestesEvenement({ nom: "Stage d'épée", publie: true }, TOUS);
    expect(depublier.confirmation).toBe("Retirer « Stage d'épée » de la vue des membres ? L'annonce redevient un brouillon.");
    expect(supprimer.confirmation).toBe("Supprimer « Stage d'épée » ? Cette annonce disparaîtra pour tout le monde.");
  });

  it("dit avant d'agir qui sera prévenu : publier annonce, corriger une annonce publiée ne réannonce pas", () => {
    const publier = gestesEvenement({ nom: "Stage", publie: false }, TOUS).find((g) => g.geste === "publier")!;
    expect([publier.explication.titre, ...publier.explication.phrases].join(" ")).toMatch(/annoncée une fois/);
    const modifier = gestesEvenement({ nom: "Stage", publie: true }, TOUS).find((g) => g.geste === "modifier")!;
    expect(modifier.explication.phrases.join(" ")).toMatch(/ne l'annonce pas une seconde fois/);
  });
});
