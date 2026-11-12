import { describe, expect, it } from "vitest";
import { extremesSeances, repartitionTaux, tauxParCreneau, topsPersonnes } from "@/lib/tableau-de-bord-graphiques";
import { creneauxDesSeances } from "@/lib/creneaux";

/** Les graphiques des onglets Séances et Personnes du tableau de bord : les calculs seuls. */
const c = (pourcentage: number) => ({ invites: 10, presents: pourcentage / 10, absents: 0, peutEtre: 0, enAttente: 0, pourcentage });
// 2026-11-17 et 2026-11-24 : mardis ; 2026-11-20 : vendredi.
const seances = [
  { id: "m1", date: "2026-11-17", heureDebut: "19:00", annulee: false, passee: true, compteurs: c(80) },
  { id: "v1", date: "2026-11-20", heureDebut: "19:00", annulee: false, passee: true, compteurs: c(30) },
  { id: "m2", date: "2026-11-24", heureDebut: "19:00", annulee: false, passee: true, compteurs: c(60) },
  { id: "v2", date: "2026-11-27", heureDebut: "19:00", annulee: false, passee: false, compteurs: c(90) },
  { id: "x", date: "2026-11-13", heureDebut: "19:00", annulee: true, passee: true, compteurs: c(0) },
];

describe("créneaux", () => {
  it("nomme le jour, et l'heure seulement quand un jour en a plusieurs", () => {
    const m = creneauxDesSeances([...seances, { id: "m3", date: "2026-11-17", heureDebut: "20:30" }]);
    expect(m.get("m1")?.libelle).toBe("Mardi · 19h00");
    expect(m.get("m3")?.libelle).toBe("Mardi · 20h30");
    expect(m.get("v1")?.libelle).toBe("Vendredi");
  });
});

describe("onglet Séances", () => {
  it("taux moyen par jour de cours, sur les séances passées et non annulées seulement", () => {
    expect(tauxParCreneau(seances)).toEqual([
      { cle: "2", libelle: "Mardi", cours: 2, taux: 70 },
      { cle: "5", libelle: "Vendredi", cours: 1, taux: 30 },
    ]);
  });
  it("les mieux et les moins remplis ignorent les cours à venir et annulés", () => {
    const { mieux, moins } = extremesSeances(seances, 2);
    expect(mieux.map((s) => s.id)).toEqual(["m1", "m2"]);
    expect(moins.map((s) => s.id)).toEqual(["v1", "m2"]);
  });
});

describe("onglet Personnes", () => {
  const m = (id: string, pourcentage: number, sansReponse = 0, seancesComptees = 10) => ({ id, prenom: id, nom: "", pourcentage, sansReponse, seances: seancesComptees });
  const membres = [m("Alix", 100), m("Charlie", 30, 2), m("Chloé", 75), m("Dan", 0, 0, 0), m("Eve", 10, 4)];
  it("répartit par tranche de taux, sans compter qui n'a encore eu aucun cours", () => {
    expect(repartitionTaux(membres).map((r) => r.n)).toEqual([2, 0, 1, 1]);
  });
  it("top, flop et sans réponse", () => {
    const t = topsPersonnes(membres, 2);
    expect(t.top.map((x) => x.id)).toEqual(["Alix", "Chloé"]);
    expect(t.flop.map((x) => x.id)).toEqual(["Eve", "Charlie"]);
    expect(t.sansReponse.map((x) => x.id)).toEqual(["Eve", "Charlie"]);
  });
});
