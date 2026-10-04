import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { couleurPartie, lignesProgramme, programmeMuet, rangsDansNature, texteLibre } from "@/components/seances/programme-cours";
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
 * Il tient aussi **le repère de couleur d'une partie**. Il ne peut plus venir d'une table à quatre
 * entrées : une séance a autant de parties qu'on lui en ajoute, chacune avec son libellé écrit à la
 * main. Il se déduit donc du **rang dans sa nature** et de cette nature — le même nombre que compte
 * le libellé du modèle (« Cours 2 », « Option 1 ») —, et la couleur est identique sur le
 * planning et sur la fiche puisque les deux écrans appellent la même fonction (la copie de
 * `COULEUR_PARTIE` qui vivait dans `GrillePlanning` a disparu avec le tableau).
 *
 * **Une seule mention de la partie à l'écran** : son libellé, qui est la donnée. L'étiquette courte
 * dérivée du rang (« Opt 1 ») a disparu de la fiche, comme elle avait disparu de la ligne du
 * planning la veille — deux mentions du même objet, dont l'une se remettait à mentir au premier
 * clic sur « En parallèle ».
 */

const lire = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const composant = lire("src/components/seances/ProgrammeCours.tsx");

const cas = (c: Partial<ProgrammeSeance[number]> & { ordre: number }): ProgrammeSeance[number] => ({
  id: `p${c.ordre}`,
  // Rang par défaut = rang dans la séance : c'est le cas des séances d'exemple ci-dessous, qui
  // n'ont que des cours. Les cas où rang et ordre divergent sont montés par
  // `programmeDepuisParties`, seul endroit qui sache encore compter les parties muettes.
  rang: c.ordre + 1,
  libelle: `Partie ${c.ordre + 1}`,
  estOption: false,
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
  it("garde le libellé, le thème, l'atelier et l'instructeur d'une case complète", () => {
    const [l] = lignesProgramme([
      cas({ ordre: 0, libelle: "Cours 1", theme: "Messer", instructeur: "Chloé Durand", atelier: { id: "a1", titre: "Botte de Nevers" } }),
    ]);
    expect(l).toMatchObject({ libelle: "Cours 1", theme: "Messer", atelier: "Botte de Nevers", instructeur: "Chloé Durand", enAttente: false });
  });

  it("annonce un thème à venir quand la case ne porte qu'un instructeur", () => {
    const [l] = lignesProgramme([cas({ ordre: 1, instructeur: "Charlie 03" })]);
    expect(l).toMatchObject({ theme: "", atelier: null, enAttente: true });
  });

  it("ne réclame pas de thème quand un atelier occupe la case : son titre dit déjà ce qu'on travaille", () => {
    const [l] = lignesProgramme([cas({ ordre: 2, estOption: true, atelier: { id: "a2", titre: "Lutte au sol" } })]);
    expect(l).toMatchObject({ theme: "", atelier: "Lutte au sol", enAttente: false });
  });

  it("traite un thème réduit à des espaces comme un thème absent", () => {
    const [l] = lignesProgramme([cas({ ordre: 0, theme: "   ", instructeur: " Chloé Durand " })]);
    expect(l).toMatchObject({ theme: "", instructeur: "Chloé Durand", enAttente: true });
  });

  it("écarte une case qui n'a plus rien à dire, et conserve l'ordre reçu", () => {
    const lignes = lignesProgramme([
      cas({ ordre: 0, libelle: "Cours 1", theme: "Dague" }),
      cas({ ordre: 1, libelle: "Cours 2", theme: " " }),
      cas({ ordre: 3, libelle: "Option 2", estOption: true, instructeur: "Léa Fabre" }),
    ]);
    expect(lignes.map((l) => l.ordre)).toEqual([0, 3]);
    expect(lignes.map((l) => l.libelle)).toEqual(["Cours 1", "Option 2"]);
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
    const liste = lire("src/components/planning/ListeParties.tsx");
    expect(grille).not.toContain("COULEUR_PARTIE");
    expect(liste).toContain('from "@/components/seances/programme-cours"');
    expect(liste).toContain("couleurPartie(");
  });
});

describe("un atelier placé ne se dit pas deux fois", () => {
  it("efface le thème quand il n'est que le titre de l'atelier recopié", () => {
    const [ligne] = lignesProgramme([
      cas({ ordre: 2, estOption: true, theme: "Échauffement à la corde", instructeur: "Charlie 03", instructeurId: "u1", atelier: { id: "a1", titre: "Échauffement à la corde" } }),
    ]);
    expect(ligne.theme).toBe("");
    expect(ligne.atelier).toBe("Échauffement à la corde");
    // Le nom seul ne doit pas déclencher « Thème à venir » : l'atelier dit déjà ce qu'on va faire.
    expect(ligne.enAttente).toBe(false);
  });

  it("garde le thème quand il dit autre chose que l'atelier", () => {
    const [ligne] = lignesProgramme([cas({ ordre: 3, estOption: true, theme: "Épée longue", atelier: { id: "a2", titre: "Jeu de jambes" } })]);
    expect(ligne.theme).toBe("Épée longue");
    expect(ligne.atelier).toBe("Jeu de jambes");
  });
});

describe("la numérotation des parties", () => {
  /** Une séance telle qu'elle se présente le plus souvent : deux cours, deux choses en parallèle. */
  const seance = [
    { estOption: false },
    { estOption: false },
    { estOption: true },
    { estOption: true },
  ];

  it("compte chaque nature dans sa propre série : le rang dit ce que dit le libellé", () => {
    // C'est le désaccord relevé par posé à côté de « Option 1 ».
    expect(rangsDansNature(seance)).toEqual([1, 2, 1, 2]);
  });

  it("numérote à partir de 1, série par série, quelle que soit la longueur de la séance", () => {
    const longue = Array.from({ length: 12 }, (_, i) => ({ estOption: i % 3 === 0 }));
    const rangs = rangsDansNature(longue);
    for (const nature of [true, false]) {
      const serie = rangs.filter((_, i) => longue[i].estOption === nature);
      expect(serie).toEqual(serie.map((_, i) => i + 1));
    }
  });
});

/**
 * **Une seule mention de la partie sur la fiche** — son libellé, et rien d'autre.
 *
 * La fiche de l'accueil écrivait dans le **même `<span>`** une étiquette courte dérivée du rang
 * (« Opt 1 », `abregerPartie`) *et* le libellé écrit par l'équipe (« Option 1 »), l'un visible et
 * l'autre pour les lecteurs d'écran, donc lus à la suite par la synthèse vocale. C'est mot pour mot
 * le défaut corrigé la veille sur la ligne du planning, et il se recréait **en un clic** : basculer
 * « Cours 1 » en parallèle (ou le descendre d'un cran) change son rang sans toucher au libellé —
 * et c'est voulu, un libellé est une donnée que le club a peut-être écrite lui-même, on ne la
 * réécrit pas dans son dos. Résultat : « Opt 1 — Cours 1 », « Opt 3 — Option 1 ».
 *
 * Reste donc le libellé, comme sur le planning. Le rang, lui, ne sert plus qu'au repère de couleur —
 * qui ne prétend pas nommer la partie.
 */
describe("la fiche de l'accueil", () => {
  it("n'écrit plus de second nombre à côté du libellé", () => {
    expect(composant).not.toContain("abregerPartie");
  });

  it("écrit le libellé de la partie, tel que l'équipe l'a saisi", () => {
    expect(composant).toContain("l.libelle");
  });

  it("n'affiche la partie qu'une fois : plus de doublure pour les lecteurs d'écran", () => {
    // Le libellé était répété dans un `sr-only` sous l'étiquette courte — deux mentions du même
    // objet dans le même élément, la seconde étant la seule juste.
    expect(composant).not.toContain("sr-only");
  });
});

/** Une partie telle qu'elle arrive de la base, avant tout filtre. */
const brute = (ordre: number, libelle: string, estOption: boolean, theme = "") => ({
  id: `p${ordre}`,
  ordre,
  libelle,
  estOption,
  theme,
  niveau: null,
  instructeurId: null,
  instructeur: null,
  instructeurSecondId: null,
  instructeurSecond: null,
  atelier: null,
});

/**
 * Les teintes, écrites une fois : c'est le contrat de `couleurPartie`, on le relit tel quel.
 *
 * **Une par rang** (« met une couleur différente pour l'icône à chaque cours/option — cours/option
 * 1 couleur 1, cours/option 2 couleur 2, etc »). Elles ne nomment plus une couleur (`ocre`, `vert`)
 * mais **un rang** : les valeurs vivent dans `globals.css`, les douze thèmes les suivent, et le nom
 * de la classe ne mentira pas le jour où une teinte changera de nuance.
 */
const APLAT = (n: number) => `bg-partie-${n} text-partie-texte`;
const CONTOUR = (n: number) => `border border-partie-${n} bg-partie-${n}-doux/60 text-partie-${n}`;

/**
 * **Le rang d'une partie ne doit pas se recompter à l'affichage** — sinon il compte sur une liste
 * déjà filtrée.
 *
 * `programmeDepuisParties` écarte les parties muettes, et une séance neuve en porte quatre d'office
 * (le modèle du club). Scénario reproduit sur l'accueil : l'encadrement ne remplit que « Cours 2 »
 * et « Option 2 » ; les deux premières parties disparaissent ; un rang recompté là donnerait « 1 »
 * au second cours. Le rang voyage donc **avec la ligne**, compté là où la séance est encore entière.
 *
 * Le test part des parties **brutes**, comme la base les rend, et traverse la chaîne entière : un
 * test qui partirait d'une `ProgrammeSeance` déjà filtrée ne pourrait pas voir ce défaut, puisqu'il
 * se serait chargé lui-même de poser les rangs.
 */
describe("le rang d'une partie survit au filtre des parties muettes", () => {
  /** Séance neuve : le modèle à quatre parties, dont seules la 2e et la 4e ont été remplies. */
  const seanceNeuve = [
    brute(0, "Cours 1", false),
    brute(1, "Cours 2", false, "Messer"),
    brute(2, "Option 1", true),
    brute(3, "Option 2", true, "Dague"),
  ];

  it("garde le rang 2 au second cours alors que « Cours 1 » est resté vide", () => {
    const lignes = lignesProgramme(programmeDepuisParties(seanceNeuve));
    expect(lignes.map((l) => l.libelle)).toEqual(["Cours 2", "Option 2"]);
    expect(lignes.map((l) => l.rang)).toEqual([2, 2]);
  });

  it("porte le rang sur la ligne elle-même : rien à recompter à l'affichage", () => {
    // Le champ existe pour cela : qui recompte sur la liste rendue recompte sur une liste filtrée.
    expect(programmeDepuisParties(seanceNeuve).map((c) => c.rang)).toEqual([2, 2]);
  });

  it("compte les rangs avant le filtre, même quand les parties arrivent en désordre", () => {
    // La requête peut rendre les parties dans n'importe quel ordre : le rang suit `ordre`, pas l'arrivée.
    const desordre = [seanceNeuve[3], seanceNeuve[1], seanceNeuve[0], seanceNeuve[2]];
    expect(lignesProgramme(programmeDepuisParties(desordre)).map((l) => l.rang)).toEqual([2, 2]);
  });

  it("numérote toujours à partir de 1 quand rien n'a été écarté", () => {
    const remplie = [
      brute(0, "Cours 1", false, "Dague"),
      brute(1, "Cours 2", false, "Messer"),
      brute(2, "Option 1", true, "Lutte"),
      brute(3, "Option 2", true, "Épée longue"),
    ];
    expect(lignesProgramme(programmeDepuisParties(remplie)).map((l) => l.rang)).toEqual([1, 2, 1, 2]);
  });
});

/**
 * **Un seul nombre par partie, donc une seule base pour sa teinte**.
 *
 * `couleurPartie` décidait de la teinte avec `l.ordre` — la place dans la séance — tandis que tout le
 * reste (le libellé du modèle, le rang porté par la ligne) compte **dans la nature**. Deux
 * numérotations sur un seul élément, et la propriété annoncée au-dessus de la fonction — « les rangs
 * alternent ocre et vert », pour séparer deux parties voisines d'un coup d'œil — tombait dès que les
 * deux séries s'entremêlaient : un clic sur « En parallèle » pour « Cours 1 » suffisait à donner la
 * même teinte à deux options qui se suivent.
 */
describe("le repère de couleur d'une partie", () => {
  it("donne au rang 1 la première teinte et au rang 2 la deuxième, plein pour le cours", () => {
    expect(couleurPartie({ rang: 1, estOption: false })).toBe(APLAT(1));
    expect(couleurPartie({ rang: 2, estOption: false })).toBe(APLAT(2));
    expect(couleurPartie({ rang: 1, estOption: true })).toBe(CONTOUR(1));
    expect(couleurPartie({ rang: 2, estOption: true })).toBe(CONTOUR(2));
  });

  /**
   * **Six couleurs, toutes différentes, puis la série recommence**. C'est la demande elle-même, en
   * deux temps : « une couleur différente à chaque cours/option », puis, devant un premier essai
   * dérivé du thème, « tu n'as mis que des nuances, je veux de vraies autres couleurs rouge bleu
   * etc ». La palette est donc **fixe** (ambre, vert, bleu, rouge, violet, sarcelle) et ne suit
   * plus le thème : elle distingue des lignes voisines, elle ne dit pas la marque du club. Le
   * recommencement à sept est assumé — une couleur ne nomme pas la partie ; c'est le libellé qui le
   * fait.
   */
  it("donne six couleurs distinctes aux six premiers rangs, dans les deux natures", () => {
    for (const estOption of [false, true]) {
      const teintes = [1, 2, 3, 4, 5, 6].map((rang) => couleurPartie({ rang, estOption }));
      expect(new Set(teintes).size, `${estOption ? "options" : "cours"} : six rangs, six couleurs`).toBe(6);
    }
    // Et la septième reprend la première, sans trou ni classe vide.
    expect(couleurPartie({ rang: 7, estOption: false })).toBe(couleurPartie({ rang: 1, estOption: false }));
    expect(couleurPartie({ rang: 13, estOption: true })).toBe(couleurPartie({ rang: 1, estOption: true }));
  });

  /**
   * Un rang absurde ne doit pas rendre une classe vide : l'étiquette sortirait **sans couleur**, ce
   * qui se lit comme un défaut d'affichage plutôt que comme une partie sans repère.
   */
  it("retombe sur la première teinte pour un rang qui n'en est pas un", () => {
    for (const rang of [0, -3, 1.4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(couleurPartie({ rang, estOption: false }), String(rang)).toBe(couleurPartie({ rang: 1, estOption: false }));
    }
  });

  it("distingue toujours ce qui se mène en parallèle : contour d'un côté, aplat de l'autre", () => {
    for (const rang of [1, 2, 3, 4, 5, 6]) {
      expect(couleurPartie({ rang, estOption: true })).toContain("border");
      expect(couleurPartie({ rang, estOption: false })).not.toContain("border");
    }
  });

  it("n'écrit aucune couleur en dur : les douze thèmes de l'application suivent sans retouche", () => {
    for (const rang of [1, 2, 3, 4]) {
      for (const estOption of [true, false]) {
        expect(couleurPartie({ rang, estOption })).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl)a?\(/);
      }
    }
  });

  it("compte le même nombre que le libellé : le premier de sa série porte la teinte 1, cours ou option", () => {
    // Une séance d'un cours et d'une partie menée en parallèle : les deux sont les **premières** de
    // leur série. Tirée de `ordre`, la teinte de l'option sortait celle du rang 2 — le badge
    // « Option 1 » portait donc la couleur de « Cours 2 ».
    const duo = [brute(0, "Cours 1", false, "Messer"), brute(1, "Option 1", true, "Lutte")];
    expect(lignesProgramme(programmeDepuisParties(duo)).map(couleurPartie)).toEqual([APLAT(1), CONTOUR(1)]);
  });

  it("garde deux parties voisines d'une même série distinctes, même après une bascule de nature", () => {
    // « Cours 1 » passé « En parallèle » : la séance porte trois options (rangs 1, 2, 3) et un
    // cours. Tirées de `ordre`, les options 1 et 2 sortaient **de la même teinte** — deux lignes
    // voisines identiques, ce que le repère existe précisément pour éviter. Et, la troisième ne
    // reprend plus celle de la première : il y a six teintes avant que ça recommence.
    const apresBascule = [
      brute(0, "Cours 1", true, "Dague"),
      brute(1, "Cours 2", false, "Messer"),
      brute(2, "Option 1", true, "Lutte"),
      brute(3, "Option 2", true, "Épée longue"),
    ];
    const options = lignesProgramme(programmeDepuisParties(apresBascule))
      .filter((l) => l.estOption)
      .map(couleurPartie);
    expect(options).toEqual([CONTOUR(1), CONTOUR(2), CONTOUR(3)]);
  });

  it("ne change pas de teinte quand une partie muette disparaît de l'affichage", () => {
    // La séance désalignée : « Cours 1 » est resté vide, le second cours est seul à l'écran — il
    // reste le **deuxième** de sa série, donc la teinte 2, et non la première.
    const desalignee = [brute(0, "Cours 1", false), brute(1, "Cours 2", false, "Messer")];
    expect(lignesProgramme(programmeDepuisParties(desalignee)).map(couleurPartie)).toEqual([APLAT(2)]);
  });
});
