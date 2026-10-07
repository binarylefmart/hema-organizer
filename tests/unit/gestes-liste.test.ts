import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  abonnerMeneuse,
  basUtileEcran,
  cibleDepot,
  clicApresGlisse,
  DELAI_CLIC_APRES_GLISSE_MS,
  decalageGlisse,
  demoAMontrer,
  DEMO_GESTES_FOIS,
  depotSansEffet,
  directionGeste,
  inscrireListe,
  LARGEUR_RETIRER_PX,
  lireCompteurDemo,
  listeMeneuse,
  prendreEntreeDemo,
  resteRevelee,
  resumeLigne,
  SEUIL_DIRECTION_PX,
  vitesseDefilement,
  type LigneMesuree,
} from "@/components/planning/gestes-liste";

/**
 * **Les gestes de la liste du planning sur téléphone** — ce qui se décide sur des nombres : le sens
 * d'un doigt, la course d'une ligne glissée, la place où tombe un élément lâché, le défilement
 * automatique, le compteur de la démonstration.
 */

describe("le sens du doigt", () => {
  it("ne décide rien sous le seuil, puis distingue glisser et défiler", () => {
    expect(directionGeste(3, 4)).toBeNull();
    expect(directionGeste(-SEUIL_DIRECTION_PX - 1, 0)).toBe("horizontal");
    expect(directionGeste(0, 30)).toBe("vertical");
    // Un geste oblique est un défilement : c'est le plus fréquent sur une liste.
    expect(directionGeste(20, 18)).toBe("vertical");
  });
});

describe("glisser vers la gauche", () => {
  it("borne la course entre la place de la ligne et la largeur du bouton", () => {
    expect(decalageGlisse(30, false)).toBe(0);
    expect(decalageGlisse(-40, false)).toBe(-40);
    expect(decalageGlisse(-400, false)).toBe(-LARGEUR_RETIRER_PX);
    // Révélée, la ligne part de la position ouverte, et glisser à droite la referme.
    expect(decalageGlisse(0, true)).toBe(-LARGEUR_RETIRER_PX);
    expect(decalageGlisse(400, true)).toBe(0);
  });

  it("reste ouverte au-delà de la moitié du chemin, et seulement là", () => {
    expect(resteRevelee(-LARGEUR_RETIRER_PX)).toBe(true);
    expect(resteRevelee(-LARGEUR_RETIRER_PX / 2)).toBe(true);
    expect(resteRevelee(-LARGEUR_RETIRER_PX / 2 + 1)).toBe(false);
    expect(resteRevelee(0)).toBe(false);
  });
});

/*
 * Deux parties : a, b, c dans la 1, d, e dans la 2. Lignes de 50 px, 10 px d'écart, un intitulé de
 * 40 px avant la partie 2.
 */
const LIGNES: LigneMesuree[] = [
  { id: "a", bloc: 1, haut: 0, bas: 50 },
  { id: "b", bloc: 1, haut: 60, bas: 110 },
  { id: "c", bloc: 1, haut: 120, bas: 170 },
  { id: "d", bloc: 2, haut: 230, bas: 280 },
  { id: "e", bloc: 2, haut: 290, bas: 340 },
];
const ORDRE = LIGNES.map(({ id, bloc }) => ({ id, bloc }));
const ZONE = { bloc: 3, haut: 360, bas: 416 };

describe("la place où tombe un élément lâché", () => {
  const sans = (c: ReturnType<typeof cibleDepot>) => c && { bloc: c.bloc, avantId: c.avantId, nouvelle: c.nouvelle };

  it("se pose devant la ligne la plus proche, dans sa partie", () => {
    expect(sans(cibleDepot(0, LIGNES, "c"))).toEqual({ bloc: 1, avantId: "a", nouvelle: false });
    expect(sans(cibleDepot(56, LIGNES, "c"))).toEqual({ bloc: 1, avantId: "b", nouvelle: false });
    expect(sans(cibleDepot(300, LIGNES, "a"))).toEqual({ bloc: 2, avantId: "e", nouvelle: false });
  });

  it("offre la fin de chaque partie, distincte du début de la suivante", () => {
    expect(sans(cibleDepot(180, LIGNES, "d"))).toEqual({ bloc: 1, avantId: null, nouvelle: false });
    expect(sans(cibleDepot(225, LIGNES, "a"))).toEqual({ bloc: 2, avantId: "d", nouvelle: false });
    expect(sans(cibleDepot(345, LIGNES, "a"))).toEqual({ bloc: 2, avantId: null, nouvelle: false });
  });

  it("ignore la ligne tenue : sa place et celle de sa voisine n'en font qu'une", () => {
    // b tenue : entre a et c, la seule place est « devant c ».
    expect(sans(cibleDepot(85, LIGNES, "b"))).toEqual({ bloc: 1, avantId: "c", nouvelle: false });
    // L'indicateur se pose au milieu de l'écart entre a et c.
    expect(cibleDepot(85, LIGNES, "b")?.y).toBe(85);
  });

  it("donne la nouvelle partie quand le doigt est dans sa zone", () => {
    expect(sans(cibleDepot(380, LIGNES, "a", ZONE))).toEqual({ bloc: 3, avantId: null, nouvelle: true });
    expect(cibleDepot(380, LIGNES, "a")?.nouvelle).toBe(false);
  });

  it("n'a rien à proposer quand la seule ligne est celle qu'on tient", () => {
    expect(cibleDepot(10, [LIGNES[0]], "a")).toBeNull();
  });
});

describe("un lâcher qui ne changerait rien n'appelle pas le serveur", () => {
  const el = (id: string) => ORDRE.find((x) => x.id === id)!;

  it("retomber à sa propre place", () => {
    expect(depotSansEffet({ bloc: 1, avantId: "c" }, el("b"), ORDRE)).toBe(true);
    expect(depotSansEffet({ bloc: 1, avantId: null }, el("c"), ORDRE)).toBe(true);
    expect(depotSansEffet({ bloc: 2, avantId: null }, el("e"), ORDRE)).toBe(true);
  });

  it("changer d'ordre dans sa partie, ou changer de partie, est un vrai geste", () => {
    expect(depotSansEffet({ bloc: 1, avantId: "a" }, el("b"), ORDRE)).toBe(false);
    expect(depotSansEffet({ bloc: 1, avantId: null }, el("a"), ORDRE)).toBe(false);
    expect(depotSansEffet({ bloc: 2, avantId: "d" }, el("c"), ORDRE)).toBe(false);
    expect(depotSansEffet({ bloc: 3, avantId: null }, el("d"), ORDRE)).toBe(false);
  });

  it("seul dans la dernière partie, en ouvrir une nouvelle ne change rien", () => {
    const ordre = [...ORDRE.filter((x) => x.id !== "e")];
    expect(depotSansEffet({ bloc: 3, avantId: null }, el("d"), ordre)).toBe(true);
    // Seul dans une partie qui n'est pas la dernière : il la quitte vraiment.
    const ordre2 = [{ id: "a", bloc: 1 }, { id: "d", bloc: 2 }, { id: "e", bloc: 3 }];
    expect(depotSansEffet({ bloc: 4, avantId: null }, { id: "d", bloc: 2 }, ordre2)).toBe(false);
  });
});

describe("le défilement automatique", () => {
  it("monte près du haut, descend près du bas, s'arrête au milieu", () => {
    expect(vitesseDefilement(400, 60, 800)).toBe(0);
    expect(vitesseDefilement(65, 60, 800)).toBeLessThan(0);
    expect(vitesseDefilement(795, 60, 800)).toBeGreaterThan(0);
    // Plus près du bord, plus vite.
    expect(Math.abs(vitesseDefilement(61, 60, 800))).toBeGreaterThan(Math.abs(vitesseDefilement(120, 60, 800)));
  });

  it("ne s'emballe pas hors de l'écran, et se tait sur un écran sans hauteur", () => {
    expect(vitesseDefilement(-500, 60, 800)).toBe(vitesseDefilement(60, 60, 800));
    expect(vitesseDefilement(100, 100, 100)).toBe(0);
  });
});

describe("le résumé d'une ligne repliée", () => {
  it("dit « Instructeur · Thème » avec ce qui est rempli, et rien sinon", () => {
    expect(resumeLigne("Prénom Nom", "Rapière")).toBe("Prénom Nom · Rapière");
    expect(resumeLigne(null, "Rapière")).toBe("Rapière");
    expect(resumeLigne("Prénom Nom", "  ")).toBe("Prénom Nom");
    expect(resumeLigne(null, "")).toBeNull();
  });
});

describe("la démonstration des gestes", () => {
  it("se montre les trois premières fois, puis plus", () => {
    expect(DEMO_GESTES_FOIS).toBe(3);
    expect(demoAMontrer(lireCompteurDemo(null))).toBe(true);
    expect(demoAMontrer(lireCompteurDemo("2"))).toBe(true);
    expect(demoAMontrer(lireCompteurDemo("3"))).toBe(false);
  });

  it("lit un compteur abîmé comme zéro", () => {
    expect(lireCompteurDemo("n'importe quoi")).toBe(0);
    expect(lireCompteurDemo("-4")).toBe(0);
    expect(lireCompteurDemo(undefined)).toBe(0);
  });

  it("n'est portée que par la première carte inscrite, et passe à la suivante", () => {
    const vus: Array<string | null> = [];
    const desabonner = abonnerMeneuse(() => vus.push(listeMeneuse()));
    const retirerA = inscrireListe("seance-a");
    const retirerB = inscrireListe("seance-b");
    expect(listeMeneuse()).toBe("seance-a");
    retirerA();
    expect(listeMeneuse()).toBe("seance-b");
    retirerB();
    expect(listeMeneuse()).toBeNull();
    desabonner();
    expect(vus).toEqual(["seance-a", "seance-a", "seance-b", null]);
  });
});

describe("le clic qui suit un glissé", () => {
  it("n'avale que l'écho du glissé, pas le toucher d'après", () => {
    // Aucun glissé en cours : un toucher est un toucher.
    expect(clicApresGlisse(null, 5_000)).toBe(false);
    // Le clic que le navigateur émet au lever du doigt d'un glissé : ignoré.
    expect(clicApresGlisse(1_000, 1_000 + 40)).toBe(true);
    // Un glissé qui n'a pas émis de clic, puis un vrai toucher une seconde plus tard : il déplie la ligne.
    expect(clicApresGlisse(1_000, 1_000 + 1_000)).toBe(false);
    expect(clicApresGlisse(1_000, 1_000 + DELAI_CLIC_APRES_GLISSE_MS)).toBe(false);
    expect(DELAI_CLIC_APRES_GLISSE_MS).toBeLessThanOrEqual(300);
  });
});

describe("le bas de ce que le doigt peut viser", () => {
  it("s'arrête à la plus haute des barres collées en bas, pas aux onglets", () => {
    // 844 px de haut, 88 px d'onglets : sans barre, le bas utile est au-dessus des onglets.
    expect(basUtileEcran(844, 88, [])).toBe(756);
    // La barre d'édition (haut à 690) et la barre de sélection posée au-dessus (haut à 560).
    expect(basUtileEcran(844, 88, [690, 560])).toBe(560);
  });

  it("ignore une barre mesurée hors de l'écran", () => {
    expect(basUtileEcran(844, 88, [1_400, -20, 0])).toBe(756);
  });
});

describe("la démonstration comptée une fois par entrée", () => {
  it("ne recompte pas quand la carte meneuse se démonte et que la suivante reprend", () => {
    const retirerA = inscrireListe("seance-a");
    const retirerB = inscrireListe("seance-b");
    expect(prendreEntreeDemo()).toBe(true);
    // La meneuse disparaît : la suivante reprend la parole, mais l'entrée est déjà comptée.
    retirerA();
    expect(listeMeneuse()).toBe("seance-b");
    expect(prendreEntreeDemo()).toBe(false);
    // Sortie du mode : plus aucune liste. L'entrée suivante compte de nouveau.
    retirerB();
    const retirerC = inscrireListe("seance-c");
    expect(prendreEntreeDemo()).toBe(true);
    retirerC();
  });
});

describe("l'écran", () => {
  const lire = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  const telephone = lire("src/components/planning/ListePartiesTelephone.tsx");
  const liste = lire("src/components/planning/ListeParties.tsx");

  it("ne bascule sur les gestes qu'en modification et sur téléphone", () => {
    expect(liste).toContain("if (modifiable && telephone) {");
    expect(lire("src/components/ui/ecran.ts")).toContain('"(width < 48rem), (pointer: coarse)"');
  });

  it("appelle les gestes du contrat, avec la confirmation du retrait", () => {
    expect(telephone).toContain("deplacerElement({ partieId: element.id, versBloc: cible.bloc, avantId: cible.avantId })");
    expect(telephone).toContain("retirerPartie({ partieId: partie.id })");
    expect(telephone).toContain("window.confirm(confirmationRetrait(partie.libelle, partie.atelier))");
  });

  it("laisse défiler la page sur la ligne, et n'attrape que par la poignée", () => {
    expect(telephone).toContain('touchAction: "pan-y"');
    expect(telephone.match(/touchAction: "none"/g)).toHaveLength(1);
  });

  it("la poignée ne coche pas la séance quand la sélection multiple est allumée", () => {
    // `ZoneCochable` ne voit pas le `pointerdown` arrêté par la poignée : elle doit être marquée.
    expect(telephone).toMatch(/data-sans-cocher\s+title="Tenir puis glisser pour déplacer"/);
  });

  it("le retrait oublie le réglage du brouillon, sur téléphone comme sur ordinateur", () => {
    expect(telephone).toContain("brouillon?.oublier(partie.id)");
    expect(liste).toContain("brouillon?.oublier(partie.id)");
  });

  it("le défilement automatique mesure les barres collées en bas", () => {
    expect(telephone).toContain('querySelectorAll<HTMLElement>("[data-barre-basse]")');
    expect(lire("src/components/planning/BarreEdition.tsx")).toContain('data-barre-basse="edition"');
    expect(lire("src/components/ui/BarreSelection.tsx")).toContain('data-barre-basse="selection"');
  });

  it("ne dit plus que l'ordre d'une partie est celui des natures", () => {
    // L'ordre est libre (colonne `ordre`) : la phrase d'avant contredisait l'écran du téléphone.
    expect(liste).not.toMatch(/l'ordre est celui des natures/);
    expect(liste).not.toMatch(/il ne\s+(\*\s+)?se règle pas/);
  });

  it("n'a ni liste native ni petite police", () => {
    expect(telephone).not.toMatch(/<select/);
    expect(telephone).not.toContain("text-xs");
    expect(telephone).not.toContain("text-sm");
  });

  it("touche le stockage du navigateur toujours dans un try", () => {
    const acces = telephone.match(/localStorage\.\w+/g) ?? [];
    expect(acces.length).toBeGreaterThan(0);
    expect(telephone.match(/try \{\s*(dejaVue = lireCompteurDemo\(window\.localStorage|window\.localStorage\.setItem)/g)).toHaveLength(acces.length);
  });
});
