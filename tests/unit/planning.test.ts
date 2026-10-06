import { describe, expect, it } from "vitest";
import { nomMois } from "@/lib/dates";
import { caseVide, nettoyerThemes, partieLibre, partieLibrePourAtelier, partiesInitiales, programmeDepuisParties, type PartiePlacable } from "@/lib/planning";

describe("nettoyerThemes", () => {
  it("coupe, dédoublonne (sans casse) et ignore les vides", () => {
    expect(nettoyerThemes("Épée longue\n messer \n\nMESSER\nDague, Lutte")).toEqual(["Épée longue", "messer", "Dague", "Lutte"]);
  });
  it("tronque les thèmes trop longs", () => {
    expect(nettoyerThemes("a".repeat(80), 60)[0]).toHaveLength(60);
  });
});

describe("partieLibrePourAtelier", () => {
  const vide = { instructeurId: null, instructeurSecondId: null, theme: "", atelierId: null };
  const element = (id: string, ordre: number, nature: string, reste: Partial<PartiePlacable> = {}) => ({ id, ordre, nature, ...vide, ...reste });
  const option = (id: string, ordre: number, reste: Partial<PartiePlacable> = {}) => element(id, ordre, "OPTION", reste);

  it("prend la première option dans l'ordre de la séance", () => {
    expect(partieLibrePourAtelier([option("o2", 3), option("o1", 2)])).toBe("o1");
  });

  it("préfère un élément **Atelier vide** à une option libre, même placé après", () => {
    // L'élément qu'un atelier retiré a laissé est fait pour en recevoir un autre.
    expect(partieLibrePourAtelier([option("o1", 1), element("a1", 4, "ATELIER")])).toBe("a1");
    // Occupé, il est sauté comme le reste.
    expect(partieLibrePourAtelier([option("o1", 1), element("a1", 4, "ATELIER", { theme: "Dague" })])).toBe("o1");
  });

  it("ignore les cours et les échauffements : un atelier ne prend pas le cours principal", () => {
    // `placerAtelier` crée un élément Atelier de plus : personne ne perd son cours.
    expect(partieLibrePourAtelier([element("p1", 0, "COURS"), element("e1", 1, "ECHAUFFEMENT")])).toBeNull();
  });

  it("saute les options occupées (instructeur, second instructeur, thème, description, atelier ou niveau annoncé)", () => {
    expect(partieLibrePourAtelier([option("o1", 2, { atelierId: "a1" }), option("o2", 3)])).toBe("o2");
    expect(partieLibrePourAtelier([option("o1", 2, { theme: "Lutte" }), option("o2", 3)])).toBe("o2");
    expect(partieLibrePourAtelier([option("o1", 2, { instructeurId: "u" }), option("o2", 3)])).toBe("o2");
    expect(partieLibrePourAtelier([option("o1", 2, { instructeurSecondId: "u" }), option("o2", 3)])).toBe("o2");
    expect(partieLibrePourAtelier([option("o1", 2, { niveau: "DEBUTANT" }), option("o2", 3)])).toBe("o2");
    // Une description écrite occupe la case comme le reste : l'atelier passerait par-dessus.
    expect(partieLibrePourAtelier([option("o1", 2, { description: "Sparring encadré." }), option("o2", 3)])).toBe("o2");
  });

  it("retourne null quand toutes les options sont prises — à charge d'en créer une", () => {
    expect(partieLibrePourAtelier([option("o1", 2, { instructeurId: "u" }), option("o2", 3, { theme: "Dague" })])).toBeNull();
    expect(partieLibrePourAtelier([])).toBeNull();
  });
});

describe("partiesInitiales", () => {
  /**
   * **Une seule partie, un seul cours** (« par défaut 1 seule partie par
   * séance, qui n'est pas notifiée partie 1, uniquement à partir de 2 »). Cours, échauffements,
   * options, ateliers et parties s'ajoutent quand il y en a : une case vide ne dit rien d'autre que
   * « il manque quelque chose ».
   */
  it("donne la partie unique du modèle, un cours, nommé « Cours » sans préfixe", () => {
    expect(partiesInitiales()).toEqual([{ libelle: "Cours", ordre: 0, bloc: 1, nature: "COURS" }]);
  });
});

/**
 * **La même question, posée sur une ligne de base.** `partieLibre` est ce que les **deux** portes
 * qui placent un atelier doivent demander : le choix automatique, et la case désignée à la main
 * depuis la grille — celle-ci ne le demandait pas, et écrasait cinq champs sans confirmation.
 */
describe("partieLibre", () => {
  const libre: PartiePlacable = { id: "p1", ordre: 0, nature: "OPTION", instructeurId: null, instructeurSecondId: null, theme: "", description: "", niveau: "INDIFFERENT", atelierId: null };

  it("un élément sans rien est libre — la nature n'y change rien", () => {
    expect(partieLibre(libre)).toBe(true);
    // Un cours vide est libre aussi : c'est l'équipe qui désigne la case depuis la grille.
    expect(partieLibre({ ...libre, nature: "COURS" })).toBe(true);
  });

  it("chacun des cinq réglages la réserve, et un atelier déjà posé aussi", () => {
    expect(partieLibre({ ...libre, instructeurId: "u1" })).toBe(false);
    expect(partieLibre({ ...libre, instructeurSecondId: "u2" })).toBe(false);
    expect(partieLibre({ ...libre, theme: "Messer" })).toBe(false);
    expect(partieLibre({ ...libre, description: "Trois passes lentes." })).toBe(false);
    expect(partieLibre({ ...libre, niveau: "DEBUTANT" })).toBe(false);
    expect(partieLibre({ ...libre, atelierId: "at-1" })).toBe(false);
  });

  it("dit exactement la même chose que le choix automatique de l'option libre", () => {
    // Les deux portes ne peuvent pas répondre différemment : c'est la même fonction qui décide.
    for (const reste of [{}, { theme: "Messer" }, { description: "x" }, { niveau: "AVANCE" }, { instructeurSecondId: "u2" }]) {
      const p = { ...libre, ...reste };
      expect(partieLibrePourAtelier([p]) === p.id).toBe(partieLibre(p));
    }
  });
});

describe("caseVide", () => {
  const vide = { instructeur: null, instructeurSecond: null, theme: "", description: "", atelier: null, niveau: "INDIFFERENT" as const };
  it("une case sans rien est vide, un niveau annoncé suffit à la remplir", () => {
    expect(caseVide(vide)).toBe(true);
    expect(caseVide({ ...vide, theme: "   " })).toBe(true);
    expect(caseVide({ ...vide, niveau: "DEBUTANT" })).toBe(false);
    expect(caseVide({ ...vide, instructeurSecond: "Marion I." })).toBe(false);
  });

  /**
   * **Une description suffit à remplir la case**, exactement comme le niveau : quelqu'un qui a écrit
   * une phrase sur ce qu'on va travailler a rempli sa case, et un atelier retenu ne doit pas venir
   * l'effacer en s'y posant (`partieLibrePourAtelier` lit la même définition).
   */
  it("une description écrite suffit, un blanc ne suffit pas", () => {
    expect(caseVide({ ...vide, description: "On révise les trois gardes." })).toBe(false);
    expect(caseVide({ ...vide, description: "   " })).toBe(true);
  });
});

describe("programmeDepuisParties", () => {
  const ligne = (id: string, ordre: number, reste: Record<string, unknown> = {}) => ({
    id,
    ordre,
    libelle: `Partie ${ordre + 1} · Cours`,
    bloc: ordre + 1,
    nature: "COURS",
    theme: "",
    instructeurId: null,
    instructeur: null,
    atelier: null,
    ...reste,
  });

  it("trie par ordre et écarte les parties muettes", () => {
    const prog = programmeDepuisParties([
      ligne("c3", 3, { theme: "Sparring" }),
      ligne("c1", 0, { theme: "Messer", instructeurId: "u1", instructeur: { prenom: "Marion", nom: "I." } }),
      ligne("c2", 1),
    ]);
    expect(prog.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(prog[0].instructeur).toBe("Marion I.");
  });

  it("porte le second instructeur, et une partie qui n'a que lui n'est pas muette", () => {
    const prog = programmeDepuisParties([
      ligne("c1", 0, { instructeurSecondId: "u2", instructeurSecond: { prenom: "Charlie", nom: "M." } }),
    ]);
    expect(prog).toHaveLength(1);
    expect(prog[0].instructeurSecond).toBe("Charlie M.");
  });

  it("garde le libellé, la partie et la nature tels quels", () => {
    const prog = programmeDepuisParties([ligne("c1", 2, { libelle: "Partie 2 · Atelier", bloc: 2, nature: "ATELIER", theme: "Dague" })]);
    expect(prog[0]).toMatchObject({ libelle: "Partie 2 · Atelier", bloc: 2, nature: "ATELIER", ordre: 2 });
  });

  it("compte rang et nombre sur la séance **entière**, avant d'écarter les muets", () => {
    // Deux cours dans la partie 1, le premier muet : le second reste « Cours 2 sur 2 », pas « Cours ».
    const prog = programmeDepuisParties([
      ligne("c1", 0, { bloc: 1, libelle: "Partie 1 · Cours 1" }),
      ligne("c2", 1, { bloc: 1, libelle: "Partie 1 · Cours 2", theme: "Dague" }),
    ]);
    expect(prog).toHaveLength(1);
    expect(prog[0]).toMatchObject({ id: "c2", rang: 2, nombre: 2 });
  });

  it("lit une nature inconnue comme un cours, plutôt que de faire tomber l'écran", () => {
    const prog = programmeDepuisParties([ligne("c1", 0, { nature: "SPARRING", theme: "Libre" })]);
    expect(prog[0].nature).toBe("COURS");
  });
});

describe("nomMois", () => {
  it("met la majuscule et l'année", () => {
    expect(nomMois("2026-10")).toBe("Octobre 2026");
  });
});

describe("semaines du planning", () => {
  it("regroupe les séances d'un mois par semaine (lundi)", async () => {
    const { debutSemaine, semainesDuMois } = await import("@/lib/planning");
    expect(debutSemaine("2026-09-22")).toBe("2026-09-21"); // mardi → lundi
    expect(debutSemaine("2026-09-21")).toBe("2026-09-21");
    const s = semainesDuMois(
      [
        { date: "2026-09-01", mois: "2026-09" },
        { date: "2026-09-04", mois: "2026-09" },
        { date: "2026-09-08", mois: "2026-09" },
        { date: "2026-10-02", mois: "2026-10" },
      ],
      "2026-09",
    );
    expect(s.map((x) => [x.cle, x.nombre])).toEqual([
      ["2026-08-31", 2],
      ["2026-09-07", 1],
    ]);
    expect(s[0].label).toBe("Semaine du 31 août");
  });
});
