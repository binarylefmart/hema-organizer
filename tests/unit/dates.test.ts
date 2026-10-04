import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDateLongue,
  formatHoraire,
  isoWeekday,
  moisAvant,
  parisDateTime,
  parisOffsetMinutes,
  seanceCommencee,
} from "@/lib/dates";

describe("dates Europe/Paris", () => {
  it("formate une date en toutes lettres en français", () => {
    expect(formatDateLongue("2026-09-24")).toBe("Jeudi 24 septembre 2026");
    expect(formatHoraire("19:30", "21:30")).toBe("19h30 à 21h30");
  });

  it("calcule le jour de semaine ISO et l'ajout de jours", () => {
    expect(isoWeekday("2026-09-24")).toBe(4); // jeudi
    expect(isoWeekday("2026-09-27")).toBe(7); // dimanche
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("convertit une heure locale en instant UTC (été +2, hiver +1)", () => {
    expect(parisDateTime("2026-09-24", "19:30").toISOString()).toBe("2026-09-24T17:30:00.000Z");
    expect(parisDateTime("2026-12-10", "19:30").toISOString()).toBe("2026-12-10T18:30:00.000Z");
    expect(parisOffsetMinutes(new Date("2026-07-01T12:00:00Z"))).toBe(120);
    expect(parisOffsetMinutes(new Date("2026-01-01T12:00:00Z"))).toBe(60);
  });

  it("sait si une séance a commencé", () => {
    expect(seanceCommencee("2026-09-24", "19:30", new Date("2026-09-24T17:29:00Z"))).toBe(false);
    expect(seanceCommencee("2026-09-24", "19:30", new Date("2026-09-24T17:30:00Z"))).toBe(true);
  });

  it("recule de n mois sans déborder sur le mois suivant", () => {
    expect(moisAvant("2026-09-23", 6)).toBe("2026-03-23");
    // Le cas qui piège `setUTCMonth` : 6 mois avant le 31 août, c'est fin février, pas début mars.
    expect(moisAvant("2026-08-31", 6)).toBe("2026-02-28");
    expect(moisAvant("2028-08-31", 6)).toBe("2028-02-29"); // année bissextile
    expect(moisAvant("2026-01-15", 6)).toBe("2025-07-15"); // passage d'année
    expect(moisAvant("2026-05-31", 3)).toBe("2026-02-28");
    expect(moisAvant("2026-09-23", 0)).toBe("2026-09-23");
  });
});
