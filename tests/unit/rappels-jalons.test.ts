import { describe, expect, it, vi } from "vitest";
import { jalonsRappelSchema } from "@/lib/validation/gestion";
import { datesJalons, delaiCours, jalonPour, phraseJalons, titreRappel } from "@/lib/notifications/planification";
import { cleRappel } from "@/lib/notifications/rappels";
import { estimerEnvois } from "@/lib/email/volume";
import { preferencesDefaut } from "@/lib/notifications/preferences";

vi.mock("@/lib/db", () => ({ db: {} }));
const { lireJalonsRappel } = await import("@/lib/settings");

/**
 * **Les délais des rappels, réglables par le club** (`rappels.jalons`, retours du club d'Arras) : la
 * validation, la lecture tolérante, les mots des messages, et la clé de déduplication inchangée.
 */

describe("jalonsRappelSchema", () => {
  it("accepte de 0 à 3 délais uniques entre 1 et 30, rangés du plus lointain au plus proche", () => {
    expect(jalonsRappelSchema.parse([])).toEqual([]);
    expect(jalonsRappelSchema.parse([2, 7])).toEqual([7, 2]);
    expect(jalonsRappelSchema.parse([1, 30, 14])).toEqual([30, 14, 1]);
  });
  it("refuse les doublons, plus de trois délais, et ce qui sort de 1 à 30", () => {
    expect(jalonsRappelSchema.safeParse([2, 2]).error?.issues[0].message).toBe("Deux rappels ne peuvent pas tomber le même jour.");
    expect(jalonsRappelSchema.safeParse([1, 2, 3, 4]).success).toBe(false);
    expect(jalonsRappelSchema.safeParse([0]).success).toBe(false);
    expect(jalonsRappelSchema.safeParse([31]).success).toBe(false);
    expect(jalonsRappelSchema.safeParse([2.5]).success).toBe(false);
    expect(jalonsRappelSchema.safeParse([Number.NaN]).success).toBe(false);
  });
});

describe("lireJalonsRappel", () => {
  it("vaut 7 puis 2 tant que rien n'est réglé, et une chaîne vide coupe les rappels", () => {
    expect(lireJalonsRappel(null)).toEqual([7, 2]);
    expect(lireJalonsRappel("")).toEqual([]);
    expect(lireJalonsRappel("3, 1")).toEqual([3, 1]);
  });
  it("retombe sur le défaut devant une valeur illisible", () => {
    expect(lireJalonsRappel("7,7")).toEqual([7, 2]);
    expect(lireJalonsRappel("abc")).toEqual([7, 2]);
  });
});

describe("les mots des rappels", () => {
  it("disent l'échéance sans « une semaine » figée", () => {
    expect(titreRappel(1)).toBe("Cours demain");
    expect(titreRappel(7)).toBe("Cours dans 7 jours");
    expect(delaiCours(3)).toBe("dans 3 jours");
  });
  it("disent la cadence entière", () => {
    expect(phraseJalons([7, 2])).toBe("7 jours puis 2 jours avant chaque cours");
    expect(phraseJalons([14, 7, 2])).toBe("14 jours, 7 jours puis 2 jours avant chaque cours");
    expect(phraseJalons([3, 1])).toBe("3 jours avant chaque cours, puis la veille");
    expect(phraseJalons([1])).toBe("la veille de chaque cours");
  });
});

describe("la planification suit le réglage", () => {
  it("cherche les séances aux jalons réglés, et seulement à eux", () => {
    expect(datesJalons("2026-11-02", [3, 1])).toEqual(["2026-11-05", "2026-11-03"]);
    expect(jalonPour("2026-11-05", "2026-11-02", [3, 1])).toBe(3);
    expect(jalonPour("2026-11-09", "2026-11-02", [3, 1])).toBeNull();
    // Sans réglage passé, la fin de période garde ses jalons fixes.
    expect(jalonPour("2026-11-09", "2026-11-02")).toBe(7);
  });
  it("garde la forme de la clé de déduplication", () => {
    const s = { id: "s1", seance: { date: "2026-11-05", heureDebut: "19:30" } } as Parameters<typeof cleRappel>[0];
    expect(cleRappel(s, "u1", 3)).toMatch(/^rappel_j3_s1_.+_u1$/);
  });
});

describe("le volume d'emails compte une vague par jalon", () => {
  const assiette = { membresAvecEmail: 10, coursParSemaine: 2, instructeurs: 2, prefs: preferencesDefaut() };
  it("trois rappels, aucun, ou le défaut", () => {
    expect(estimerEnvois({ ...assiette, jalonsRappel: [14, 7, 2] }).pireJour).toBe(10 + 3 * 10);
    expect(estimerEnvois({ ...assiette, jalonsRappel: [] }).pireJour).toBe(10);
    expect(estimerEnvois(assiette).pireJour).toBe(10 + 2 * 10);
  });
});
