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
  const option = (id: string, ordre: number, reste: Partial<PartiePlacable> = {}) => ({ id, ordre, estOption: true, ...vide, ...reste });

  it("prend la première option dans l'ordre de la séance", () => {
    expect(partieLibrePourAtelier([option("o2", 3), option("o1", 2)])).toBe("o1");
  });

  it("ignore les parties qui ne sont pas des options : un atelier ne prend pas le cours principal", () => {
    // L'ancienne règle retombait sur la Cours 2 quand les options étaient prises. Plus
    // maintenant : `placerAtelier` crée une option de plus, personne ne perd son cours.
    expect(partieLibrePourAtelier([{ id: "p1", ordre: 0, estOption: false, ...vide }])).toBeNull();
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
   * **Deux cours, et aucune option**. Le modèle en portait quatre, héritage des quatre cases
   * figées de la grille d' : **toute** séance du trimestre naissait avec deux options vides que
   * personne ne remplissait, et une case vide ne dit rien d'autre que « il manque quelque chose ».
   * Une option s'ajoute maintenant quand il y en a une.
   */
  it("donne les deux cours du modèle, rangés et numérotés à partir de 0", () => {
    expect(partiesInitiales()).toEqual([
      { libelle: "Cours 1", ordre: 0, estOption: false },
      { libelle: "Cours 2", ordre: 1, estOption: false },
    ]);
  });
});

/**
 * **La même question, posée sur une ligne de base.** `partieLibre` est ce que les **deux** portes
 * qui placent un atelier doivent demander : le choix automatique de la première option libre, et la
 * case désignée à la main depuis la grille — celle-ci ne le demandait pas, et écrasait cinq champs
 * sans confirmation.
 */
describe("partieLibre", () => {
  const libre: PartiePlacable = { id: "p1", ordre: 0, estOption: true, instructeurId: null, instructeurSecondId: null, theme: "", description: "", niveau: "INDIFFERENT", atelierId: null };

  it("une partie sans rien est libre — la nature n'y change rien", () => {
    expect(partieLibre(libre)).toBe(true);
    // Un cours vide est libre aussi : c'est l'équipe qui désigne la case depuis la grille.
    expect(partieLibre({ ...libre, estOption: false })).toBe(true);
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
    libelle: `Partie ${ordre}`,
    estOption: false,
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

  it("garde le libellé et le drapeau option tels quels", () => {
    const prog = programmeDepuisParties([ligne("c1", 2, { libelle: "Atelier dague", estOption: true, theme: "Dague" })]);
    expect(prog[0]).toMatchObject({ libelle: "Atelier dague", estOption: true, ordre: 2 });
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
