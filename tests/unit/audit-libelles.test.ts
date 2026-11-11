import { describe, expect, it } from "vitest";
import { detailsLisibles, libelleAction, tonAction } from "@/lib/audit-libelles";

/** Journal d'audit en français : phrases d'action et détails en clair. */
describe("libellés du journal d'audit", () => {
  it("dit l'action en français, et garde lisible une action inconnue", () => {
    expect(libelleAction("presence.desistement")).toBe("s'est désisté(e)");
    expect(libelleAction("truc.nouveau_geste")).toBe("truc · nouveau geste");
  });

  it("colore refus, désistements et gestes du bureau", () => {
    expect(tonAction("connexion.echec")).toBe("rouge");
    expect(tonAction("presence.desistement")).toBe("ocre");
    expect(tonAction("admin.droits_donnes")).toBe("primaire");
    expect(tonAction("admin.espace_ouvert")).toBe("neutre");
    expect(tonAction("connexion.succes")).toBe("neutre");
  });

  it("rend les détails en clair, sans identifiants techniques", () => {
    const d = JSON.stringify({ sessionId: "s1", seance: "2026-11-20 19:00", avant: "PRESENT", apres: "ABSENT", derniereMinute: true, avantCoursMin: 95 });
    expect(detailsLisibles(d)).toEqual(["séance du Vendredi 20 nov. à 19h00", "Présent → Absent", "1 h 35 avant le cours", "dernière minute"]);
    expect(detailsLisibles(JSON.stringify({ sessionId: "s1", avant: null, apres: "PRESENT", enMasse: true }), new Map([["s1", { date: "2026-11-20", heureDebut: "19:00" }]]))).toEqual([
      "séance du Vendredi 20 nov. à 19h00",
      "sans réponse → Présent",
      "correction en lot : oui",
    ]);
    expect(detailsLisibles(JSON.stringify({ resterConnecte: true }))).toEqual(["rester connecté : oui"]);
    expect(detailsLisibles(JSON.stringify({ date: "2026-11-27", theme: "", nature: "OPTION" }))).toEqual(["date : Vendredi 27 nov.", "nature : OPTION"]);
    expect(detailsLisibles("texte libre")).toEqual(["texte libre"]);
    expect(detailsLisibles(null)).toEqual([]);
  });
});
