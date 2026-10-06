import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { couleurNature, grouperParPartie, lignesProgramme, partiesProgramme, programmeMuet, texteLibre } from "@/components/seances/programme-cours";
import { NATURES_ELEMENT } from "@/lib/constants";
import { programmeDepuisParties, type ProgrammeSeance } from "@/lib/planning";

/**
 * **Le programme d'un cours se lit même quand les cases sont à moitié remplies.**
 *
 * Un cours se programme rarement d'un coup : l'instructeur est souvent posé des semaines avant le
 * thème, un atelier validé se place parfois dans une case restée sans thème, et un thème effacé
 * laisse derrière lui une chaîne d'espaces. Ce fichier verrouille ce que chacun de ces états donne à
 * lire, et le fait que le composant disparaisse quand il n'y a rien à dire — c'est ce qui autorise
 * les écrans à le poser sans condition.
 *
 * Il tient aussi **la lecture par partie** — « Partie 1 », puis ses éléments
 * (« Échauffement », « Cours 2 », « Atelier ») — et **le repère de couleur d'un élément**, qui ne
 * dépend plus que de sa nature (`couleurNature`), identique sur le planning et sur la fiche puisque les
 * deux écrans appellent la même fonction.
 */

const lire = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const composant = lire("src/components/seances/ProgrammeCours.tsx");

const cas = (c: Partial<ProgrammeSeance[number]> & { ordre: number }): ProgrammeSeance[number] => ({
  id: `p${c.ordre}`,
  // Par défaut : le cours unique de la partie 1. Les cas où rang et nombre comptent vraiment sont
  // montés par `programmeDepuisParties`, seul endroit qui sache encore compter les éléments muets.
  bloc: 1,
  nature: "COURS",
  rang: 1,
  nombre: 1,
  libelle: "Partie 1 · Cours",
  instructeur: null,
  instructeurId: null,
  instructeurSecond: null,
  instructeurSecondId: null,
  theme: "",
  description: "",
  niveau: "INDIFFERENT",
  atelier: null,
  ...c,
});

describe("lignesProgramme", () => {
  it("garde le nom, le thème, l'atelier et l'instructeur d'une case complète", () => {
    const [l] = lignesProgramme([
      cas({ ordre: 0, nature: "ATELIER", libelle: "Partie 1 · Atelier", theme: "Messer", instructeur: "Chloé Durand", atelier: { id: "a1", titre: "Botte de Nevers" } }),
    ]);
    expect(l).toMatchObject({ nom: "Atelier", bloc: 1, nature: "ATELIER", theme: "Messer", atelier: "Botte de Nevers", instructeur: "Chloé Durand", enAttente: false });
  });

  it("annonce un thème à venir quand la case ne porte qu'un instructeur", () => {
    const [l] = lignesProgramme([cas({ ordre: 1, instructeur: "Charlie 03" })]);
    expect(l).toMatchObject({ theme: "", atelier: null, enAttente: true });
  });

  it("ne réclame pas de thème quand un atelier occupe la case : son titre dit déjà ce qu'on travaille", () => {
    const [l] = lignesProgramme([cas({ ordre: 2, nature: "ATELIER", atelier: { id: "a2", titre: "Lutte au sol" } })]);
    expect(l).toMatchObject({ theme: "", atelier: "Lutte au sol", enAttente: false });
  });

  it("traite un thème réduit à des espaces comme un thème absent", () => {
    const [l] = lignesProgramme([cas({ ordre: 0, theme: "   ", instructeur: " Chloé Durand " })]);
    expect(l).toMatchObject({ theme: "", instructeur: "Chloé Durand", enAttente: true });
  });

  it("écarte une case qui n'a plus rien à dire, et conserve l'ordre reçu", () => {
    const lignes = lignesProgramme([
      cas({ ordre: 0, rang: 1, nombre: 2, theme: "Dague" }),
      cas({ ordre: 1, rang: 2, nombre: 2, theme: " " }),
      cas({ ordre: 3, nature: "OPTION", rang: 2, nombre: 2, instructeur: "Léa Fabre" }),
    ]);
    expect(lignes.map((l) => l.ordre)).toEqual([0, 3]);
    expect(lignes.map((l) => l.nom)).toEqual(["Cours 1", "Option 2"]);
  });
});

describe("le second instructeur", () => {
  it("suit le premier quand ils sont deux à encadrer", () => {
    const [l] = lignesProgramme([cas({ ordre: 0, theme: "Messer", instructeur: "Chloé Durand", instructeurSecond: "Charlie 03" })]);
    expect(l.instructeur).toBe("Chloé Durand");
    expect(l.instructeurSecond).toBe("Charlie 03");
  });

  it("n'assiste personne quand le premier a été effacé : « avec Charlie » sous une case sans personne ne veut rien dire", () => {
    const [l] = lignesProgramme([cas({ ordre: 0, theme: "Messer", instructeur: null, instructeurSecond: "Charlie 03" })]);
    expect(l.instructeurSecond).toBeNull();
  });
});

describe("texteLibre", () => {
  it("ne retient que ce qui a été réellement saisi", () => {
    expect(texteLibre("Messer — garde haute")).toBe("Messer — garde haute");
    expect(texteLibre("  ")).toBeNull();
    expect(texteLibre(undefined)).toBeNull();
  });
});

describe("programmeMuet", () => {
  it("est vrai quand aucune case n'est remplie et qu'aucun champ libre n'est saisi : le composant s'efface", () => {
    expect(programmeMuet(lignesProgramme([]), null, null)).toBe(true);
  });

  it("est faux dès qu'une alternative est saisie, même sans aucune case", () => {
    expect(programmeMuet(lignesProgramme([]), null, "Salle occupée : travail à mains nues")).toBe(false);
  });

  it("est faux dès qu'une case porte quelque chose, même sans thème", () => {
    expect(programmeMuet(lignesProgramme([cas({ ordre: 0, instructeur: "Chloé Durand" })]), null, null)).toBe(false);
  });
});

describe("la mise en forme du programme", () => {
  it("se rend sur le serveur, sans emoji et sans couleur en dur", () => {
    expect(composant).not.toContain('"use client"');
    expect(composant).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(composant).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });

  it("le planning et la fiche appellent la même fonction de couleur : plus aucune table à recopier", () => {
    const grille = lire("src/components/planning/GrillePlanning.tsx");
    expect(grille).not.toContain("COULEUR_PARTIE");
    expect(composant).toContain("couleurNature(l.nature)");
    expect(composant).not.toContain("couleurPartie");
  });
});

describe("un atelier placé ne se dit pas deux fois", () => {
  it("efface le thème quand il n'est que le titre de l'atelier recopié", () => {
    const [ligne] = lignesProgramme([
      cas({ ordre: 2, nature: "ATELIER", theme: "Échauffement à la corde", instructeur: "Charlie 03", instructeurId: "u1", atelier: { id: "a1", titre: "Échauffement à la corde" } }),
    ]);
    expect(ligne.theme).toBe("");
    expect(ligne.atelier).toBe("Échauffement à la corde");
    // Le nom seul ne doit pas déclencher « Thème à venir » : l'atelier dit déjà ce qu'on va faire.
    expect(ligne.enAttente).toBe(false);
  });

  it("garde le thème quand il dit autre chose que l'atelier", () => {
    const [ligne] = lignesProgramme([cas({ ordre: 3, nature: "ATELIER", theme: "Épée longue", atelier: { id: "a2", titre: "Jeu de jambes" } })]);
    expect(ligne.theme).toBe("Épée longue");
    expect(ligne.atelier).toBe("Jeu de jambes");
  });
});

/** Un élément tel qu'il arrive de la base, avant tout filtre. */
const brute = (ordre: number, bloc: number, nature: string, theme = "") => ({
  id: `p${ordre}`,
  ordre,
  bloc,
  nature,
  libelle: `Partie ${bloc}`,
  theme,
  niveau: null,
  instructeurId: null,
  instructeur: null,
  instructeurSecondId: null,
  instructeurSecond: null,
  atelier: null,
});

/**
 * **Le programme se lit partie par partie** (« fais une gestion par partie, partie 1, 2,
 * 3 ») : le titre de la partie, puis ses éléments, chacun nommé dans sa partie.
 */
describe("la lecture par partie", () => {
  const seance = [
    brute(0, 1, "ECHAUFFEMENT", "Mobilité"),
    brute(1, 1, "COURS", "Messer"),
    brute(2, 1, "COURS", "Dague"),
    brute(3, 2, "COURS"),
    brute(4, 3, "COURS", "Épée longue"),
    brute(5, 3, "OPTION", "Lutte"),
  ];

  it("groupe les éléments sous leur partie, dans l'ordre, et écarte la partie muette", () => {
    const parties = partiesProgramme(lignesProgramme(programmeDepuisParties(seance)));
    expect(parties.map((p) => p.nom)).toEqual(["Partie 1", "Partie 3"]);
    expect(parties.map((p) => p.elements.map((l) => l.nom))).toEqual([
      ["Échauffement", "Cours 1", "Cours 2"],
      ["Cours", "Option"],
    ]);
  });

  it("ne titre pas la partie quand la séance n'en a qu'une : le programme se lit comme avant", () => {
    const parties = partiesProgramme(lignesProgramme(programmeDepuisParties([brute(0, 1, "ECHAUFFEMENT", "Mobilité"), brute(1, 1, "COURS", "Messer")])));
    expect(parties.map((p) => [p.nom, p.elements.map((l) => l.nom)])).toEqual([[null, ["Échauffement", "Cours"]]]);
  });

  it("compte les parties affichées, pas les parties réelles : une seule remplie sur trois → pas de titre", () => {
    const parties = partiesProgramme(lignesProgramme(programmeDepuisParties([brute(0, 1, "COURS"), brute(1, 2, "COURS"), brute(2, 3, "COURS", "Épée longue")])));
    expect(parties.map((p) => [p.bloc, p.nom, p.elements.map((l) => l.nom)])).toEqual([[3, null, ["Cours"]]]);
  });

  it("garde « Cours 2 » au second cours quand le premier est resté vide : le nombre se compte avant le filtre", () => {
    const desalignee = [brute(0, 1, "COURS"), brute(1, 1, "COURS", "Messer")];
    const [l] = lignesProgramme(programmeDepuisParties(desalignee));
    expect(l.nom).toBe("Cours 2");
  });

  it("regroupe par numéro, pas par voisinage : une liste mal triée ne coupe pas une partie en deux", () => {
    const groupes = grouperParPartie([{ bloc: 2 }, { bloc: 1 }, { bloc: 2 }]);
    expect(groupes.map((g) => [g.nom, g.elements.length])).toEqual([
      ["Partie 1", 1],
      ["Partie 2", 2],
    ]);
  });

  it("la fiche écrit le titre de la partie puis le nom de l'élément — jamais le libellé complet en double", () => {
    expect(composant).toContain("partiesProgramme(lignes)");
    expect(composant).toContain("{p.nom}");
    // Sans titre (`nom: null`, une seule partie affichée), ni intitulé ni filet.
    expect(composant).toContain("if (!p.nom)");
    expect(composant).toContain("{l.nom}");
    expect(composant).not.toContain("{l.libelle}");
  });

  it("n'affiche l'élément qu'une fois : pas de doublure pour les lecteurs d'écran", () => {
    expect(composant).not.toContain("abregerPartie");
    expect(composant).not.toContain("sr-only");
  });
});

/**
 * **Une teinte par nature** : la partie se lit à son titre, la couleur ne dit plus que *ce qu'est*
 * l'élément. La forme double la teinte — ce qui se mène en parallèle (option, atelier) est en contour.
 */
describe("le repère de couleur d'un élément", () => {
  it("donne une teinte différente à chaque nature", () => {
    const teintes = NATURES_ELEMENT.map(couleurNature);
    expect(new Set(teintes).size).toBe(NATURES_ELEMENT.length);
  });

  it("met en contour ce qui se mène en parallèle, en aplat l'échauffement et le cours", () => {
    expect(couleurNature("OPTION")).toContain("border");
    expect(couleurNature("ATELIER")).toContain("border");
    expect(couleurNature("COURS")).not.toContain("border");
    expect(couleurNature("ECHAUFFEMENT")).not.toContain("border");
  });

  it("puise dans les couleurs du thème du club, sans couleur en dur ni classe composée", () => {
    // Des paires que chaque thème définit pour le clair et le sombre (marque/encre, primaire,
    // vert) : le contraste est celui que le thème garantit déjà.
    for (const n of NATURES_ELEMENT) {
      expect(couleurNature(n)).toMatch(/\b(bg|border)-(marque|primaire|vert)\b/);
      expect(couleurNature(n)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl)a?\(/);
    }
  });

  it("ne rend jamais une classe vide, même pour une nature inconnue", () => {
    expect(couleurNature("INCONNUE" as never)).toBe(couleurNature("COURS"));
  });
});
