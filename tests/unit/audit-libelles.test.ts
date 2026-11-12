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
    expect(tonAction("presence.desistement_derniere_minute")).toBe("ocre");
    expect(tonAction("notification.desistement_derniere_minute")).toBe("ocre");
    expect(tonAction("notification.desistement_echec")).toBe("rouge");
    expect(libelleAction("presence.desistement_derniere_minute")).toBe("désistement de dernière minute");
    expect(libelleAction("notification.desistement_derniere_minute")).toContain("désistement de dernière minute");
    expect(libelleAction("parametres.delai_derniere_minute")).toContain("désistements de dernière minute");
    expect(tonAction("admin.droits_donnes")).toBe("primaire");
    expect(tonAction("admin.espace_ouvert")).toBe("neutre");
    expect(tonAction("connexion.succes")).toBe("neutre");
  });

  it("rend les détails en clair, sans identifiants techniques", () => {
    const d = JSON.stringify({ sessionId: "s1", seance: "2026-11-20 19:00", avant: "PRESENT", apres: "ABSENT", derniereMinute: true, avantCoursMin: 95 });
    expect(detailsLisibles(d)).toEqual(["séance du Vendredi 20 nov. à 19h00", "Présent → Absent", "1 h 35 avant le cours", "désistement de dernière minute"]);
    // Un désistement signalé (hors dernière minute), une alerte envoyée, un délai changé.
    expect(detailsLisibles(JSON.stringify({ derniereMinute: false, signale: true }))).toEqual(["instructeurs prévenus"]);
    expect(detailsLisibles(JSON.stringify({ sessionId: "s1", nouvelleReponse: "PEUT_ETRE", emails: 2, telephones: 1, delaiMin: 240 }))).toEqual([
      "nouvelle réponse : Peut-être",
      "délai : 4 heures",
      "emails : 2",
      "téléphones : 1",
    ]);
    expect(detailsLisibles(JSON.stringify({ ancienDelaiMin: 120, delaiMin: 4320 }))).toEqual(["2 heures → 3 jours"]);
    expect(detailsLisibles(JSON.stringify({ ancienDelaiMin: 240, delaiMin: 240, ancienActif: true, actif: false }))).toEqual(["délai : 4 heures", "activé → désactivé"]);
    // Une autre action qui porte `actif` seul garde son rendu ordinaire.
    expect(detailsLisibles(JSON.stringify({ actif: true }))).toEqual(["actif : oui"]);
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
