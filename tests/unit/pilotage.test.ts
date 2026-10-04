import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Compteurs } from "@/lib/presences";
import {
  assiduite,
  coursEnDanger,
  decrochages,
  FENETRE_DECROCHAGE,
  meilleuresSeries,
  moyennesParJour,
  serieDeTete,
  SERIE_MINIMALE,
  SEUIL_NOYAU,
  tendance,
  type SeancePassee,
} from "@/lib/pilotage";

/**
 * Séances passées d'un trimestre : les dates de septembre 2026 tombent un mardi (01, 08, 15, 22)
 * ou un vendredi (04, 11, 18), ce dont se servent les cas sur les jours de la semaine.
 */
function seances(...presents: number[]): SeancePassee[] {
  const dates = ["2026-09-01", "2026-09-04", "2026-09-08", "2026-09-11", "2026-09-15", "2026-09-18", "2026-09-22"];
  return presents.map((n, i) => ({ id: `s${i + 1}`, date: dates[i], presents: n }));
}

describe("tendance de fréquentation du trimestre", () => {
  it("compare la moyenne de la première moitié à celle de la seconde", () => {
    // 4 cours : 2 + 2. Début = 5, fin = 10, soit le double.
    expect(tendance(seances(4, 6, 9, 11))).toEqual({ variation: 100, debut: 5, fin: 10 });
  });

  it("annonce une baisse avec une variation négative", () => {
    expect(tendance(seances(10, 10, 5, 5))).toEqual({ variation: -50, debut: 10, fin: 5 });
  });

  it("ne dit rien en dessous de 4 cours passés : une moitié d'un cours n'est pas une tendance", () => {
    expect(tendance([])).toBeNull();
    expect(tendance(seances(5))).toBeNull();
    expect(tendance(seances(5, 9))).toBeNull();
    expect(tendance(seances(5, 9, 12))).toBeNull();
  });

  it("compte le cours du milieu dans les deux moitiés quand le nombre de cours est impair", () => {
    // 5 cours : chaque moitié en fait 3, le troisième est pris des deux côtés.
    const t = tendance(seances(6, 6, 9, 12, 12));
    expect(t).not.toBeNull();
    expect(t?.debut).toBe(7); // (6 + 6 + 9) / 3
    expect(t?.fin).toBe(11); // (9 + 12 + 12) / 3
  });

  it("ne divise pas par zéro quand personne n'est venu en début de trimestre", () => {
    expect(tendance(seances(0, 0, 8, 9))).toBeNull();
  });

  it("rend les deux moyennes non arrondies, l'arrondi appartenant à l'affichage", () => {
    const t = tendance(seances(5, 6, 8, 9));
    expect(t?.debut).toBeCloseTo(5.5);
    expect(t?.fin).toBeCloseTo(8.5);
    expect(Number.isInteger(t?.variation)).toBe(true);
  });
});

describe("moyennes par jour de la semaine", () => {
  it("nomme les jours en français et n'en renvoie jamais plus de deux", () => {
    // Mardis : 10, 12, 14 (moyenne 12) ; vendredis : 6, 8, 10 (moyenne 8).
    const m = moyennesParJour(seances(10, 6, 12, 8, 14, 10, 0).slice(0, 6));
    expect(m).toHaveLength(2);
    expect(m.map((j) => j.jour)).toEqual(["mardi", "vendredi"]);
    expect(m[0]).toEqual({ jour: "mardi", moyenne: 12, cours: 3 });
    expect(m[1]).toEqual({ jour: "vendredi", moyenne: 8, cours: 3 });
  });

  it("écarte les jours comptant un seul cours : une moyenne sur un cours est ce cours-là", () => {
    // Deux mardis, deux vendredis, et un samedi de rattrapage très fréquenté.
    const avecSamedi: SeancePassee[] = [
      { id: "s1", date: "2026-09-01", presents: 10 },
      { id: "s2", date: "2026-09-04", presents: 8 },
      { id: "s3", date: "2026-09-05", presents: 30 },
      { id: "s4", date: "2026-09-08", presents: 10 },
      { id: "s5", date: "2026-09-11", presents: 8 },
    ];
    expect(moyennesParJour(avecSamedi).map((j) => j.jour)).toEqual(["mardi", "vendredi"]);
  });

  it("trie par nombre de cours décroissant, puis par moyenne décroissante", () => {
    // Vendredi : 2 cours à 20 de moyenne ; mardi : 3 cours à 5. Le mardi passe devant, il pèse plus.
    const m = moyennesParJour([
      { id: "s1", date: "2026-09-01", presents: 5 },
      { id: "s2", date: "2026-09-04", presents: 20 },
      { id: "s3", date: "2026-09-08", presents: 5 },
      { id: "s4", date: "2026-09-11", presents: 20 },
      { id: "s5", date: "2026-09-15", presents: 5 },
    ]);
    expect(m.map((j) => j.jour)).toEqual(["mardi", "vendredi"]);
    expect(m.map((j) => j.cours)).toEqual([3, 2]);
  });

  it("ne renvoie rien si un seul jour est qualifié : un club à un créneau n'a rien à comparer", () => {
    expect(moyennesParJour(seances(10, 0).slice(0, 1))).toEqual([]);
    expect(
      moyennesParJour([
        { id: "s1", date: "2026-09-01", presents: 10 },
        { id: "s2", date: "2026-09-08", presents: 12 },
        { id: "s3", date: "2026-09-15", presents: 11 },
      ]),
    ).toEqual([]);
  });

  it("ne renvoie rien sur un trimestre vide", () => {
    expect(moyennesParJour([])).toEqual([]);
  });
});

describe("assiduité du club", () => {
  it("médiane d'un nombre impair de taux = la valeur du milieu", () => {
    expect(assiduite([20, 50, 90]).mediane).toBe(50);
  });

  it("médiane d'un nombre pair = moyenne arrondie des deux valeurs centrales", () => {
    expect(assiduite([20, 40, 70, 90]).mediane).toBe(55);
    expect(assiduite([0, 33]).mediane).toBe(17); // 16,5 arrondi
  });

  it("ne dépend pas de l'ordre dans lequel les taux arrivent", () => {
    expect(assiduite([90, 20, 50]).mediane).toBe(50);
  });

  it("compte dans le noyau à partir du seuil exact, celui-ci compris", () => {
    expect(SEUIL_NOYAU).toBe(67);
    expect(assiduite([66, 67, 68]).noyau).toBe(2);
    expect(assiduite([66, 66]).noyau).toBe(0);
    expect(assiduite([100, 100]).noyau).toBe(2);
  });

  it("ne renvoie jamais NaN sur une liste vide", () => {
    const a = assiduite([]);
    expect(a).toEqual({ mediane: 0, noyau: 0 });
    expect(Number.isNaN(a.mediane)).toBe(false);
  });
});

/**
 * **Les séries, telles que l'accueil les livre**.
 *
 * Le module portait un `plusLongueSerie` que **personne n'appelait** : l'accueil réécrivait le même
 * parcours en ligne, les deux versions avaient déjà divergé, et ces assertions éprouvaient la copie
 * non livrée. Les deux fonctions d'ici sont désormais celles qu'appelle `blocAdmin` — le classement
 * pour le podium de la bulle, sa tête pour la tuile — et c'est la condition pour que ce fichier dise
 * encore quelque chose du produit.
 */
describe("séries de présences", () => {
  const noms = new Map([
    ["u1", "Camille"],
    ["u2", "Dominique"],
    ["u3", "Alix"],
  ]);
  const passees = seances(0, 0, 0, 0, 0);
  /** La tuile, telle que l'accueil la remplit : un seul classement, sa tête. */
  const tuile = (presences: ReadonlyMap<string, ReadonlySet<string>>, annuaire = noms) => serieDeTete(meilleuresSeries(passees, presences, annuaire));

  it("compte les présences consécutives sur les séances prises dans l'ordre", () => {
    const presences = new Map([["u1", new Set(["s1", "s2", "s3", "s4", "s5"])]]);
    expect(tuile(presences)).toEqual({ longueur: 5, qui: "Camille", combien: 1 });
  });

  it("remet le compteur à zéro dès qu'un cours est manqué", () => {
    // Présent aux 2 premiers, absent au 3e, présent aux 2 derniers : la série vaut 2, pas 4.
    const presences = new Map([["u1", new Set(["s1", "s2", "s4", "s5"])]]);
    expect(tuile(presences)?.longueur).toBe(2);
  });

  it("ne rend rien quand le maximum est d'une seule présence : « série de 1 » n'est pas une série", () => {
    const presences = new Map([
      ["u1", new Set(["s1", "s3", "s5"])],
      ["u2", new Set(["s2"])],
    ]);
    expect(SERIE_MINIMALE).toBe(2);
    expect(meilleuresSeries(passees, presences, noms)).toEqual([]);
    expect(tuile(presences)).toBeNull();
  });

  it("compte les ex æquo et nomme la première personne dans l'ordre de l'annuaire", () => {
    const presences = new Map([
      ["u1", new Set(["s1", "s2"])],
      ["u2", new Set(["s3", "s4"])],
      ["u3", new Set(["s4", "s5"])],
    ]);
    expect(tuile(presences)).toEqual({ longueur: 2, qui: "Camille", combien: 3 });
  });

  it("ignore les identifiants sans nom connu et les membres sans aucune présence", () => {
    const presences = new Map([
      ["inconnu", new Set(["s1", "s2", "s3", "s4"])],
      ["u2", new Set(["s1", "s2", "s3"])],
      ["u3", new Set<string>()],
    ]);
    expect(tuile(presences)).toEqual({ longueur: 3, qui: "Dominique", combien: 1 });
  });

  it("ne rend rien sans séance passée ni sans annuaire", () => {
    expect(serieDeTete(meilleuresSeries([], new Map(), noms))).toBeNull();
    expect(tuile(new Map())).toBeNull();
    expect(tuile(new Map([["u1", new Set(["s1", "s2"])]]), new Map())).toBeNull();
  });

  /**
   * **La tuile et sa bulle citent le même nom, par construction** : elles sortent du même classement,
   * calculé une seule fois. Deux parcours indépendants finiraient par afficher un nom dans la tuile
   * et un autre en tête de la bulle qui s'ouvre au-dessus.
   */
  it("classe les séries de la plus longue à la plus courte, l'annuaire départageant les égalités", () => {
    const presences = new Map([
      ["u1", new Set(["s1", "s2"])], // Camille : 2
      ["u2", new Set(["s1", "s2", "s3", "s4"])], // Dominique : 4
      ["u3", new Set(["s3", "s4"])], // Alix : 2
    ]);
    const classement = meilleuresSeries(passees, presences, noms);
    expect(classement).toEqual([
      { qui: "Dominique", longueur: 4 },
      { qui: "Camille", longueur: 2 },
      { qui: "Alix", longueur: 2 },
    ]);
    // La tête du classement est bien ce que la tuile annonce, ex æquo comptés.
    expect(serieDeTete(classement)).toEqual({ longueur: 4, qui: "Dominique", combien: 1 });
  });

  it("ne laisse pas une séance étrangère aux cours reçus prolonger une série", () => {
    // Une réponse d'un autre trimestre, ou d'un cours annulé retiré de la liste : elle ne compte pas.
    const presences = new Map([["u1", new Set(["s1", "autre-trimestre", "s2"])]]);
    expect(tuile(presences)).toEqual({ longueur: 2, qui: "Camille", combien: 1 });
  });
});

/**
 * **Les décrochages, nommés et non comptés**.
 *
 * La fonction rendait un nombre et n'était appelée par personne ; l'accueil, qui a besoin des noms
 * (« on ne t'a pas vu depuis trois cours » ne s'écrit pas à une liste anonyme), en tenait sa propre
 * version — et les deux ne parcouraient pas le même ensemble : celle-ci prenait **tout identifiant
 * présent en table**, compte de service du portail compris, quand la copie livrée écartait qui n'est
 * pas de l'annuaire. C'est l'annuaire qui décide, et il arrive en argument.
 */
describe("décrochages", () => {
  const passees = seances(0, 0, 0, 0, 0);
  const noms = new Map([
    ["u1", "Camille"],
    ["u2", "Dominique"],
    ["u3", "Alix"],
  ]);

  it("nomme qui est venu au moins une fois puis a manqué les trois derniers cours", () => {
    expect(FENETRE_DECROCHAGE).toBe(3);
    const presences = new Map([
      ["u1", new Set(["s1", "s2"])], // venu au début, disparu depuis : décroché
      ["u2", new Set(["s1", "s5"])], // revenu au dernier cours : pas décroché
      ["u3", new Set(["s4"])], // présent dans la fenêtre : pas décroché
    ]);
    expect(decrochages(passees, presences, noms)).toEqual(["Camille"]);
  });

  it("ignore qui n'est jamais venu, pour ne jamais nommer la même personne que « jamais venus »", () => {
    const presences = new Map([
      ["u1", new Set<string>()],
      ["u2", new Set(["s1"])],
    ]);
    expect(decrochages(passees, presences, noms)).toEqual(["Dominique"]);
  });

  it("écarte qui n'est pas de l'annuaire : le compte de service du portail ne décroche de rien", () => {
    // C'est exactement ce qui divergeait entre les deux versions : celle-ci comptait le fantôme.
    const presences = new Map([
      ["compte-de-service", new Set(["s1"])],
      ["u1", new Set(["s1"])],
    ]);
    expect(decrochages(passees, presences, noms)).toEqual(["Camille"]);
  });

  it("rend les noms dans l'ordre de l'annuaire, jamais dans celui de la table des présences", () => {
    const presences = new Map([
      ["u3", new Set(["s1"])],
      ["u1", new Set(["s2"])],
      ["u2", new Set(["s1", "s2"])],
    ]);
    // L'annuaire dit Camille, Dominique, Alix : c'est l'ordre des bulles, quel que soit celui de la Map.
    expect(decrochages(passees, presences, noms)).toEqual(["Camille", "Dominique", "Alix"]);
  });

  it("ne compte pas une présence à une séance étrangère aux séances passées reçues", () => {
    const presences = new Map([["u1", new Set(["autre-trimestre"])]]);
    expect(decrochages(passees, presences, noms)).toEqual([]);
  });

  it("ne dit rien tant qu'il y a moins de trois cours passés", () => {
    const presences = new Map([["u1", new Set(["s1"])]]);
    expect(decrochages([], presences, noms)).toEqual([]);
    expect(decrochages(seances(0), presences, noms)).toEqual([]);
    expect(decrochages(seances(0, 0), presences, noms)).toEqual([]);
    // Au troisième cours, la fenêtre est enfin complète — et il est dedans, donc il ne décroche pas.
    expect(decrochages(seances(0, 0, 0), presences, noms)).toEqual([]);
  });

  it("ne nomme personne sans aucune présence chargée", () => {
    expect(decrochages(passees, new Map(), noms)).toEqual([]);
  });
});

/**
 * **Les cours en danger, par leurs dates** : la fonction rendait `{ nombre, prochain }` et n'était
 * appelée par personne, quand la tuile a besoin de **toutes** les dates — trois cours creux
 * d'affilée en novembre ne se relancent pas comme un mardi isolé. Le compteur est la longueur de la
 * liste et la date annoncée en est la première : les trois ne peuvent plus se contredire.
 */
describe("cours à venir en danger", () => {
  /** Compteurs d'une séance à venir ; seuls présents, peut-être et invités entrent dans le palier. */
  function compteurs(presents: number, peutEtre: number, invites = 18): Compteurs {
    return { invites, presents, absents: 0, peutEtre, enAttente: invites - presents - peutEtre, pourcentage: 0 };
  }

  /** La part livrée : 20 % des invités, soit 4 personnes sur les 18 invités de ces exemples. */
  const PART = 20;

  it("donne les dates des cours sous le seuil, la plus proche d'abord", () => {
    const dates = coursEnDanger(
      [
        { date: "2026-10-09", compteurs: compteurs(1, 0) },
        { date: "2026-10-02", compteurs: compteurs(9, 2) },
        { date: "2026-10-06", compteurs: compteurs(2, 1) },
      ],
      PART,
    );
    // Deux cours en danger, et le tri ne suit pas l'ordre reçu : c'est la première date qui compte.
    expect(dates).toEqual(["2026-10-06", "2026-10-09"]);
  });

  it("suit le palier commun : les peut-être comptent pour moitié", () => {
    // 3 présents + 2 peut-être = 4 attendus, soit le seuil atteint : pas en danger.
    expect(coursEnDanger([{ date: "2026-10-02", compteurs: compteurs(3, 2) }], PART)).toEqual([]);
    // 3 présents seuls : en dessous.
    expect(coursEnDanger([{ date: "2026-10-02", compteurs: compteurs(3, 0) }], PART)).toEqual(["2026-10-02"]);
  });

  it("suit l'effectif du club, à part réglée identique", () => {
    // Le même cours — neuf présents — et la même part réglée (20 %) : personne ne s'inquiète dans un
    // club de dix-huit (seuil 4), le cours manque de monde dans un club de quatre-vingts (seuil 16).
    // C'est tout l'objet de la part : le bureau ne rerègle rien quand le club grandit.
    expect(coursEnDanger([{ date: "2026-10-02", compteurs: compteurs(9, 0, 18) }], PART)).toEqual([]);
    expect(coursEnDanger([{ date: "2026-10-02", compteurs: compteurs(9, 0, 80) }], PART)).toEqual(["2026-10-02"]);
  });

  it("ne colore pas un trimestre trop petit pour que le seuil ait un sens", () => {
    // Palier « indéterminé » : avec 4 invités, aucun effectif n'atteindra jamais le seuil.
    expect(coursEnDanger([{ date: "2026-10-02", compteurs: compteurs(0, 0, 4) }], PART)).toEqual([]);
  });

  it("ne renvoie aucune date quand tout va bien, ni sur une liste vide", () => {
    expect(coursEnDanger([], PART)).toEqual([]);
    expect(coursEnDanger([{ date: "2026-10-02", compteurs: compteurs(12, 0) }], PART)).toEqual([]);
  });
});

/**
 * **Un calcul de pilotage n'existe qu'une fois, et c'est l'exemplaire livré**.
 *
 * Trois fonctions de ce module ont vécu sans appelant — `plusLongueSerie`, `decrochages` et
 * `coursEnDanger` — pendant que `src/lib/accueil.ts` les réécrivait en ligne. Les deux versions
 * avaient **déjà divergé** : celle d'ici comptait tout identifiant présent dans la table des
 * présences, compte de service du portail compris, quand la copie livrée écartait qui n'est pas de
 * l'annuaire. Vingt-six assertions donnaient une confiance qui ne portait sur rien — le pire état
 * possible d'un test, puisqu'il rassure.
 *
 * Ce balayage tient la porte fermée : les calculs de ce fichier sont ceux que l'accueil appelle, et
 * il ne reste plus dans l'accueil de boucle qui les refasse. Il se fait sur la **source**, faute de
 * pouvoir demander à un module qui l'appelle.
 */
describe("les calculs livrés sont ceux qui sont éprouvés", () => {
  const ACCUEIL = readFileSync(path.join(process.cwd(), "src/lib/accueil.ts"), "utf8");

  it("fait appeler les quatre calculs par l'accueil, depuis ce module", () => {
    // L'import lui-même : c'est la seule preuve qu'il n'existe pas une seconde version quelque part.
    expect(ACCUEIL).toMatch(/import \{[^}]*coursEnDanger[^}]*\} from "\.\/pilotage"/);
    expect(ACCUEIL).toMatch(/import \{[^}]*decrochages[^}]*\} from "\.\/pilotage"/);
    expect(ACCUEIL).toMatch(/import \{[^}]*meilleuresSeries[^}]*\} from "\.\/pilotage"/);
    expect(ACCUEIL).toMatch(/import \{[^}]*serieDeTete[^}]*\} from "\.\/pilotage"/);
    for (const appel of ["coursEnDanger(", "decrochages(", "meilleuresSeries(", "serieDeTete("]) expect(ACCUEIL).toContain(appel);
  });

  it("ne garde dans l'accueil aucune copie de ces boucles", () => {
    // Les trois marqueurs de la copie qui vivait là : le parcours des séries, la fenêtre des trois
    // derniers cours, et le filtre de palier recopié.
    expect(ACCUEIL).not.toMatch(/passees\.slice\(-FENETRE_DECROCHAGE\)/);
    expect(ACCUEIL).not.toMatch(/palierEffectif\(/);
    expect(ACCUEIL).not.toMatch(/let courante = 0/);
  });

  it("ne définit `SERIE_MINIMALE` qu'ici, l'accueil la réexportant telle quelle", () => {
    // Deux constantes du même nom à deux valeurs, le dépôt en a déjà connu : un auto-import du mauvais
    // compile sans broncher. Celle-ci vit avec le calcul des séries, et la vue Personnel la relit.
    expect(ACCUEIL).toMatch(/export \{ SERIE_MINIMALE \} from "\.\/pilotage";/);
    expect(ACCUEIL).not.toMatch(/export const SERIE_MINIMALE/);
  });
});
