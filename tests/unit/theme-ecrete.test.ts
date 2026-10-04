import { describe, expect, it, vi } from "vitest";

/**
 * **Le thème d'une séance n'avait plus de plafond, et cinq écrans le recopiaient.**
 *
 * Le thème saisi à la main est borné à 120 signes par le formulaire (`seanceSchema`). Le **repli**,
 * lui, ne l'était pas : `synchroniserSeance` écrit `disciplines: themes.join(",")` — un thème par
 * partie — et le nombre de parties d'une séance n'est plus borné à quatre depuis `a2b4002`. Quatre
 * parties donnaient ~260 signes au pire ; douze n'en donnent aucune borne.
 *
 * Ce que cette chaîne alimente : l'**objet de l'email de récap**, la **description Open Graph** des
 * pages de partage, le **texte WhatsApp**, le champ `theme` de l'**API publique** et l'embed
 * Discord. Trois d'entre eux sont coupés par quelqu'un d'autre — le client mail, le réseau social —
 * au milieu d'un mot, sans prévenir. Écrêter une fois, proprement, à la source, vaut mieux que cinq
 * coupes arbitraires : c'est la même famille de correctif que les bornes d'embed de `discord.ts`.
 */

// `partage.ts` tire le client Prisma pour ses requêtes ; ce fichier ne teste que des fonctions pures.
vi.mock("@/lib/db", () => ({ db: {} }));

const { THEME_MAX, embedSeance, lignesSeance, themePrincipal, themeSeance } = await import("@/lib/notifications/contenu");
const { themeAffiche } = await import("@/lib/partage");
const { versSeancePublique } = await import("@/lib/api-publique");

/** Une séance de douze parties, chacune avec son thème : ce que le planning écrit aujourd'hui. */
const DOUZE_PARTIES = Array.from({ length: 12 }, (_, i) => `Messer garde haute et travail au fer ${i + 1}`).join(",");

const SEANCE = {
  date: "2026-09-24",
  heureDebut: "19:30",
  heureFin: "21:30",
  lieu: "Gymnase municipal",
  theme: "",
  alternative: "",
  disciplines: DOUZE_PARTIES,
};

describe("écrêtage du thème d'une séance", () => {
  /**
   * **La préférence pour le séparateur de liste était morte**. Elle s'écrivait
   * `Math.max(coupe.lastIndexOf(" · "), coupe.lastIndexOf(" "))` — or « · » *contient* une espace,
   * donc l'espace gagnait toujours. Le commentaire promettait une coupe par article de liste, le
   * code coupait à la dernière espace, et le résultat pouvait abandonner un **séparateur pendu**
   * juste devant les points de suspension. Ça se lit : c'est l'objet de l'email de récap, la
   * description Open Graph des pages de partage et le texte WhatsApp.
   */
  it("coupe entre deux articles, et n'abandonne jamais de séparateur pendu", () => {
    // Trois articles dont le dernier dépasse : la coupe doit tomber après le second, séparateur retiré.
    const articles = ["Messer garde haute et liaisons au fer", "Dague au corps à corps et désarmements", "Bouclier et lutte en armure et travail de la pointe et du tranchant"];
    // Pas de virgule dans les articles : c'est `parseDisciplines` qui découpe là-dessus.
    const theme = themePrincipal({ ...SEANCE, disciplines: articles.join(",") });
    expect(theme.length).toBeLessThanOrEqual(THEME_MAX);
    expect(theme.endsWith("…")).toBe(true);
    // Ni « · » ni espace juste avant les points de suspension
    expect(theme).not.toMatch(/[\s·]…$/u);
    // Et la coupe tombe bien à une frontière d'article, pas au milieu du troisième
    expect(theme).toBe(`${articles[0]} · ${articles[1]}…`);
  });

  it("retombe sur la dernière espace quand aucun séparateur ne tombe assez loin", () => {
    // Un seul article, donc aucun « · » : la coupe se fait à la dernière espace, sans mot tronqué.
    const long = `Messer ${"garde ".repeat(40)}haute`;
    const theme = themePrincipal({ ...SEANCE, disciplines: long });
    expect(theme.length).toBeLessThanOrEqual(THEME_MAX);
    expect(theme).not.toMatch(/[\s·]…$/u);
    expect(theme.endsWith("garde…")).toBe(true);
  });

  it("coupe net un mot unique plus long que le plafond : il n'y a rien où reculer", () => {
    const theme = themePrincipal({ ...SEANCE, disciplines: "a".repeat(THEME_MAX + 40) });
    expect(theme.length).toBe(THEME_MAX);
    expect(theme.endsWith("…")).toBe(true);
  });

  it("borne le repli sur les disciplines, qui n'a aucun plafond en base", () => {
    expect(DOUZE_PARTIES.length).toBeGreaterThan(400);
    const theme = themePrincipal(SEANCE);
    expect(theme.length).toBeLessThanOrEqual(THEME_MAX);
    expect(theme.endsWith("…")).toBe(true);
  });

  it("coupe entre deux thèmes, jamais au milieu d'un mot", () => {
    const theme = themePrincipal(SEANCE);
    expect(theme).toContain("Messer garde haute et travail au fer 1");
    // Ce qui précède les points de suspension est un mot entier
    expect(theme.slice(0, -1)).toMatch(/[\wéèêàçùîô\d]$/);
  });

  it("ne touche pas à un thème ordinaire", () => {
    expect(themePrincipal({ ...SEANCE, theme: "Messer — garde haute" })).toBe("Messer — garde haute");
    expect(themePrincipal({ ...SEANCE, disciplines: "Messer,Dague" })).toBe("Messer · Dague");
  });

  it("protège d'un coup les cinq consommateurs du thème", () => {
    // 1. le contenu commun (email de rappel, WhatsApp, pages de partage)
    const ligneTheme = lignesSeance(SEANCE, { presents: 3, invites: 10 }).find((l) => l.startsWith("📖"));
    expect(ligneTheme!.length).toBeLessThanOrEqual(THEME_MAX + 3);
    // 2. l'embed Discord
    expect(embedSeance(SEANCE, { presents: 3, absents: 0, peutEtre: 0, enAttente: 7, invites: 10, pourcentage: 30 }, "HEMA", 6).description)
      .toContain(themePrincipal(SEANCE));
    // 3. l'affichage des pages publiques (titre, aperçu Open Graph)
    expect(themeAffiche(SEANCE).length).toBeLessThanOrEqual(THEME_MAX);
    // 4. l'API publique du site WordPress
    const publiee = versSeancePublique({
      ...SEANCE,
      id: "s1",
      adresse: "",
      annulee: false,
      motifAnnulation: null,
      compteurs: { presents: 3, absents: 0, peutEtre: 0, enAttente: 7, invites: 10, pourcentage: 30 },
      programme: [],
      periode: { id: "p1", nom: "T4", statut: "ACTIVE" },
    });
    expect(publiee.theme.length).toBeLessThanOrEqual(THEME_MAX);
  });

  it("garde l'alternative lisible derrière le thème écrêté", () => {
    const avecAlternative = themeSeance({ ...SEANCE, alternative: "Dague" });
    expect(avecAlternative).toContain("(ou Dague)");
    // Thème écrêté + « (ou … ) » : on reste dans ce qu'un objet d'email sait afficher
    expect(avecAlternative.length).toBeLessThanOrEqual(THEME_MAX + 60);
  });
});
