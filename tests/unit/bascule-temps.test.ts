import { describe, expect, it } from "vitest";
import { parisDateTime } from "@/lib/dates";
import { lienTemps, lireDateFiltre, lireQuand, QUAND_LABELS, seancesDuJour, selectionnerSeances, valeurQuand } from "@/components/filtres/temps";

/**
 * Bascule « À venir / Passé » des écrans de séances (planning, gestion des séances).
 *
 * Deux promesses à tenir :
 *  - par défaut on ne voit **que ce qui vient** — le passé ne s'affiche que si on le demande,
 *    et l'URL par défaut reste propre (aucun `quand=`) ;
 *  - la frontière n'est pas la date mais **le début du cours** : le cours de ce soir reste « à venir »
 *    toute la journée, et bascule dans le passé dès 19 h 30 passées.
 */

const AUJ = "2026-09-22";
/** Ce mardi-là, 20 h 00 à Paris : le cours de 19 h 30 a commencé, celui de 21 h 00 non. */
const MAINTENANT = parisDateTime(AUJ, "20:00");
const AVANT_LE_COURS = parisDateTime(AUJ, "19:00");

const seances = [
  { date: "2026-07-10", heureDebut: "19:30" },
  { date: "2026-09-08", heureDebut: "19:30" },
  { date: "2026-09-18", heureDebut: "19:30" },
  { date: "2026-09-22", heureDebut: "19:30" },
  { date: "2026-09-22", heureDebut: "21:00" },
  { date: "2026-09-25", heureDebut: "19:30" },
  { date: "2026-10-02", heureDebut: "19:30" },
  { date: "2026-10-15", heureDebut: "19:30" },
  { date: "2026-11-30", heureDebut: "19:30" },
];

const quandEt = (s: { date: string; heureDebut: string }) => `${s.date} ${s.heureDebut}`;

describe("position de la bascule", () => {
  it("regarde ce qui vient tant qu'on ne demande rien", () => {
    expect(lireQuand(undefined)).toBe("avenir");
    expect(lireQuand("")).toBe("avenir");
    expect(lireQuand("avenir")).toBe("avenir");
    expect(lireQuand("n'importe quoi")).toBe("avenir");
  });

  it("lit la position « Passé » dans l'URL", () => {
    expect(lireQuand("passe")).toBe("passe");
  });

  it("n'écrit dans l'URL que la position qui n'est pas celle par défaut", () => {
    expect(valeurQuand("avenir")).toBeUndefined();
    expect(valeurQuand("passe")).toBe("passe");
  });

  it("nomme les deux positions en toutes lettres", () => {
    expect(QUAND_LABELS).toEqual({ avenir: "À venir", passe: "Passé" });
  });
});

describe("liens de la bascule", () => {
  it("garde les autres filtres de la page (période, fenêtre de temps)", () => {
    expect(lienTemps("/planning", { periode: "p1", h: "mois", quand: valeurQuand("passe") })).toBe("/planning?periode=p1&h=mois&quand=passe");
    expect(lienTemps("/gestion/seances", { periode: "p1", h: "semaine", quand: valeurQuand("passe") })).toBe("/gestion/seances?periode=p1&h=semaine&quand=passe");
  });

  it("laisse l'URL propre en position par défaut", () => {
    expect(lienTemps("/planning", { periode: "p1", h: undefined, quand: valeurQuand("avenir") })).toBe("/planning?periode=p1");
    expect(lienTemps("/planning", { periode: undefined, h: undefined, quand: undefined })).toBe("/planning");
  });

  it("revient de « Passé » à « À venir » sans perdre la fenêtre de temps", () => {
    const retour = lienTemps("/planning", { periode: "p1", h: "2semaines", quand: valeurQuand("avenir") });
    expect(retour).toBe("/planning?periode=p1&h=2semaines");
    expect(retour).not.toContain("quand");
  });
});

describe("séances retenues de chaque côté", () => {
  it("ne montre que ce qui vient, dans l'ordre, par défaut", () => {
    expect(selectionnerSeances(seances, "avenir", "periode", MAINTENANT, AUJ).map(quandEt)).toEqual([
      "2026-09-22 21:00",
      "2026-09-25 19:30",
      "2026-10-02 19:30",
      "2026-10-15 19:30",
      "2026-11-30 19:30",
    ]);
  });

  it("ne montre que ce qui est écoulé, de la plus récente à la plus ancienne", () => {
    expect(selectionnerSeances(seances, "passe", "periode", MAINTENANT, AUJ).map(quandEt)).toEqual([
      "2026-09-22 19:30",
      "2026-09-18 19:30",
      "2026-09-08 19:30",
      "2026-07-10 19:30",
    ]);
  });

  it("range le cours du jour déjà commencé du côté du passé, l'autre du côté des prochains", () => {
    const aVenir = selectionnerSeances(seances, "avenir", "periode", MAINTENANT, AUJ).map(quandEt);
    const passe = selectionnerSeances(seances, "passe", "periode", MAINTENANT, AUJ).map(quandEt);
    expect(passe).toContain("2026-09-22 19:30");
    expect(aVenir).not.toContain("2026-09-22 19:30");
    expect(aVenir).toContain("2026-09-22 21:00");
    expect(passe).not.toContain("2026-09-22 21:00");
  });

  it("garde le cours du soir « à venir » tant qu'il n'a pas commencé", () => {
    expect(selectionnerSeances(seances, "avenir", "prochain", AVANT_LE_COURS, AUJ).map(quandEt)).toEqual(["2026-09-22 19:30"]);
    expect(selectionnerSeances(seances, "passe", "prochain", AVANT_LE_COURS, AUJ).map(quandEt)).toEqual(["2026-09-18 19:30"]);
  });

  it("aucune séance des deux côtés n'est perdue ni comptée deux fois", () => {
    const aVenir = selectionnerSeances(seances, "avenir", "periode", MAINTENANT, AUJ);
    const passe = selectionnerSeances(seances, "passe", "periode", MAINTENANT, AUJ);
    expect(aVenir.length + passe.length).toBe(seances.length);
  });
});

describe("la fenêtre de temps fonctionne dans les deux positions", () => {
  it("resserre vers l'avant en position « À venir »", () => {
    expect(selectionnerSeances(seances, "avenir", "semaine", MAINTENANT, AUJ).map(quandEt)).toEqual(["2026-09-22 21:00", "2026-09-25 19:30"]);
    expect(selectionnerSeances(seances, "avenir", "mois", MAINTENANT, AUJ)).toHaveLength(4);
    expect(selectionnerSeances(seances, "avenir", "prochain", MAINTENANT, AUJ).map(quandEt)).toEqual(["2026-09-22 21:00"]);
  });

  it("se lit vers l'arrière en position « Passé »", () => {
    expect(selectionnerSeances(seances, "passe", "semaine", MAINTENANT, AUJ).map(quandEt)).toEqual(["2026-09-22 19:30", "2026-09-18 19:30"]);
    expect(selectionnerSeances(seances, "passe", "mois", MAINTENANT, AUJ).map(quandEt)).toEqual([
      "2026-09-22 19:30",
      "2026-09-18 19:30",
      "2026-09-08 19:30",
    ]);
    // « Prochain cours » devient « Dernier cours » : la séance écoulée la plus récente
    expect(selectionnerSeances(seances, "passe", "prochain", MAINTENANT, AUJ).map(quandEt)).toEqual(["2026-09-22 19:30"]);
  });

  it("ne rend rien plutôt que d'élargir quand la fenêtre est vide", () => {
    const seules = [{ date: "2026-11-30", heureDebut: "19:30" }];
    expect(selectionnerSeances(seules, "passe", "periode", MAINTENANT, AUJ)).toEqual([]);
    expect(selectionnerSeances(seules, "avenir", "semaine", MAINTENANT, AUJ)).toEqual([]);
  });
});

/**
 * **Chercher une date précise** — le filtre qui répond à une autre question que les deux autres. «
 * À venir / Passé » et la fenêtre disent *ce qui vient* ; une date dit *ce jour-là*, et doit donc
 * les court-circuiter : les croiser ne pourrait que rendre une liste vide sur une date qui existe,
 * ce qui se lit comme une panne.
 */
describe("chercher une date précise", () => {
  it("ne retient que les cours de ce jour, les deux du même soir compris", () => {
    expect(seancesDuJour(seances, "2026-09-22")).toEqual([
      { date: "2026-09-22", heureDebut: "19:30" },
      { date: "2026-09-22", heureDebut: "21:00" },
    ]);
  });

  it("rend une liste vide sur un jour sans cours, sans se plaindre", () => {
    // C'est à l'écran de dire « aucun cours ce jour-là » : la fonction, elle, n'a pas d'avis.
    expect(seancesDuJour(seances, "2026-09-23")).toEqual([]);
  });

  it("ignore le sens du temps et la fenêtre : un cours passé se retrouve aussi bien qu'un cours à venir", () => {
    expect(seancesDuJour(seances, "2026-07-10")).toHaveLength(1);
    expect(seancesDuJour(seances, "2026-11-30")).toHaveLength(1);
  });

  it("garde l'ordre du calendrier sans retrier", () => {
    const desordre = [
      { date: "2026-09-22", heureDebut: "21:00" },
      { date: "2026-09-22", heureDebut: "19:30" },
    ];
    expect(seancesDuJour(desordre, "2026-09-22")).toEqual(desordre);
  });
});

describe("la date venue de l'URL", () => {
  it("accepte un jour du calendrier", () => {
    expect(lireDateFiltre("2026-09-22")).toBe("2026-09-22");
    expect(lireDateFiltre("2024-02-29")).toBe("2024-02-29"); // année bissextile
  });

  it("refuse ce qui n'a pas la forme d'un jour", () => {
    for (const valeur of [undefined, "", "hier", "22/09/2026", "2026-9-22", "2026-09-22T19:30"]) {
      expect(lireDateFiltre(valeur), String(valeur)).toBeUndefined();
    }
  });

  /*
   * Le cas qui justifie la seconde vérification : `2026-02-31` a la bonne forme et n'est pas un
   * jour. Sans elle, l'écran filtrerait sur une date que personne ne peut atteindre et n'afficherait
   * plus rien, sans dire pourquoi. Un filtre illisible vaut un filtre absent.
   */
  it("refuse une date bien formée qui n'existe pas", () => {
    for (const valeur of ["2026-02-31", "2026-13-01", "2026-00-10", "2025-02-29"]) {
      expect(lireDateFiltre(valeur), valeur).toBeUndefined();
    }
  });

  it("disparaît de l'URL quand elle est absente, et y figure sinon", () => {
    expect(lienTemps("/seances", { date: undefined })).toBe("/seances");
    expect(lienTemps("/seances", { date: "2026-09-22" })).toBe("/seances?date=2026-09-22");
  });
});
