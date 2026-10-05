import { afterEach, describe, expect, it } from "vitest";
import { entreesFuseaux, FUSEAU_LIVRE, fuseauCourant, fuseauValide, libelleDecalage, poserFuseau } from "@/lib/fuseau";
import { resoudreIdentite } from "@/lib/identite";
import { seanceCommencee, todayIso } from "@/lib/dates";

afterEach(() => {
  globalThis.__fuseauClub = undefined;
});

describe("le fuseau du club", () => {
  it("se règle, à défaut vient de TZ, à défaut Paris", () => {
    expect(resoudreIdentite({}).fuseau).toBe(FUSEAU_LIVRE);
    expect(resoudreIdentite({}, { fuseau: "America/Montreal" }).fuseau).toBe("America/Montreal");
    expect(resoudreIdentite({ fuseau: "Europe/Brussels" }, { fuseau: "America/Montreal" }).fuseau).toBe("Europe/Brussels");
    // Une valeur illisible (réglage abîmé, TZ fantaisiste) ne fait jamais tomber l'application.
    expect(resoudreIdentite({ fuseau: "Mars/Olympus" }, { fuseau: "n'importe quoi" }).fuseau).toBe(FUSEAU_LIVRE);
    expect(fuseauValide("Europe/Paris")).toBe(true);
    expect(fuseauValide("")).toBe(false);
  });

  it("change la date du jour et le début d'une séance", () => {
    // 3 h 30 UTC le 6 octobre : le 6 à Paris, encore le 5 à Montréal.
    const instant = new Date("2026-10-06T03:30:00Z");
    expect(fuseauCourant()).toBe(FUSEAU_LIVRE);
    expect(todayIso(instant)).toBe("2026-10-06");
    poserFuseau("America/Montreal");
    expect(todayIso(instant)).toBe("2026-10-05");
    // Une séance du 5 à 22 h 00 est commencée à Montréal à 23 h 30 locales…
    expect(seanceCommencee("2026-10-05", "22:00", instant)).toBe(true);
    // … et pas encore une du 5 à 23 h 45.
    expect(seanceCommencee("2026-10-05", "23:45", instant)).toBe(false);
  });

  it("propose les fuseaux courants en tête, avec leur décalage", () => {
    const entrees = entreesFuseaux("Europe/Paris", new Date("2026-07-01T12:00:00Z"));
    expect(entrees[0]).toEqual({ valeur: "Europe/Paris", libelle: "Paris — UTC+2", groupe: "Les plus courants" });
    expect(entrees.some((e) => e.valeur === "Asia/Tokyo" && e.groupe === "Asie")).toBe(true);
    expect(new Set(entrees.map((e) => e.valeur)).size).toBe(entrees.length);
    expect(libelleDecalage(-240)).toBe("UTC−4");
    expect(libelleDecalage(330)).toBe("UTC+5:30");
  });
});
