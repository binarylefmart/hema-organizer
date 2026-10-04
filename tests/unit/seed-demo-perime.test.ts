import { describe, expect, it } from "vitest";
import { ANCRAGE_DEMO, dateDemo, decalageDemo } from "../../prisma/seed-demo";
import { SEANCES_CLUB } from "../../prisma/donnees-club";
import { isoWeekday, joursAvant, todayIso } from "../../src/lib/dates";

/**
 * **Le jeu de démonstration se périmait au jour de sa dernière séance, et rien ne le disait.**
 *
 * `donnees-club.ts` porte le calendrier du trimestre : seize séances sur septembre et octobre 2026.
 * Elles étaient installées telles quelles par `npm run db:seed:demo`, qui décide pourtant trois
 * choses en comparant ces dates à **aujourd'hui** : les séances à venir (`date >= aujourdHui`),
 * celle qu'on annule pour montrer le cas (`aVenir[1]`) et celle qui porte l'atelier retenu
 * (`aVenir.find(date > aujourdHui)`). D'où deux paliers, et ils ont été vérifiés :
 *
 *  - **le jour de la dernière séance**, il ne reste qu'une séance à venir : plus de séance annulée, et
 *    plus de séance pour l'atelier — qui reste alors `PLANIFIE` **sans `sessionId`**, un état que
 *    l'application elle-même ne sait pas produire ;
 *  - **le lendemain**, il n'y a plus aucune séance à venir. L'accueil, le planning, « Prochains
 *    cours », l'API publique et les pages de partage rendent des listes vides — et les captures qui
 *    illustrent les guides montrent des écrans creux, sans que le seed n'annonce quoi que ce soit :
 *    il dit « 16 séances » comme les autres jours.
 *
 * Ce fichier tient la promesse du correctif : le jeu se replace dans la semaine en cours
 * (`ANCRAGE_DEMO`), **par semaines entières** — les créneaux se retrouvent par jour de semaine, un
 * décalage de trois jours mettrait tout le trimestre sur la mauvaise salle — et **sans rien changer
 * la semaine de l'ancrage**, où il doit produire les dates d'avant, à l'octet près.
 */

/** Ce que `main()` déduit des dates, rejoué ici sans base : c'est là que le jeu se vidait. */
function jeu(aujourdHui: string) {
  const seances = SEANCES_CLUB.map((s) => ({ ...s, date: dateDemo(s.date, aujourdHui) }));
  const aVenir = seances.filter((s) => s.date >= aujourdHui);
  const annulee = aVenir[1];
  return { seances, aVenir, annulee, prochaine: aVenir.find((s) => s.date > aujourdHui && s.date !== annulee?.date) };
}

/** Quelques dates de tournée : l'ancrage, sa semaine, les paliers connus, et loin devant. */
const JOURS = [
  ANCRAGE_DEMO,
  "2026-10-06", // dernier jour du décalage nul
  "2026-10-07", // premier recalage
  "2026-10-30", // ancien palier : plus de séance annulée
  "2026-10-31", // ancien palier : plus aucune séance à venir
  "2026-12-25",
  "2027-09-30",
  "2031-02-14",
];

describe("le jeu de démonstration ne se périme plus", () => {
  for (const jour of JOURS) {
    it(`garde des séances à venir, une annulée et un cours pour l'atelier — le ${jour}`, () => {
      const { aVenir, annulee, prochaine } = jeu(jour);
      // Sept séances à venir le jour de l'ancrage : c'est ce que le jeu montrait, et ce qu'il doit
      // continuer de montrer. Le seuil est bas exprès — ce qui compte est qu'il ne tombe jamais à un.
      expect(aVenir.length).toBeGreaterThanOrEqual(3);
      expect(annulee, "la séance annulée du jeu (aVenir[1])").toBeDefined();
      expect(prochaine, "la séance qui porte l'atelier retenu").toBeDefined();
      expect(prochaine?.date).not.toBe(annulee?.date);
    });

    it(`garde aussi des séances déjà données — le ${jour}`, () => {
      const { seances } = jeu(jour);
      // Sans passé, « Mes présences », les taux et le tableau de bord sont vides eux aussi : un jeu
      // de démonstration entièrement à venir est aussi creux qu'un jeu entièrement passé.
      expect(seances.filter((s) => s.date < jour).length).toBeGreaterThanOrEqual(3);
    });

    it(`ne déplace aucune séance d'un jour de semaine à l'autre — le ${jour}`, () => {
      // Le seed retrouve le créneau (horaire, salle, adresse) avec `isoWeekday` : un décalage qui ne
      // serait pas un multiple de 7 poserait les séances d'un créneau sur l'autre, sans rien casser
      // de visible — juste une fausse adresse sur toutes les cartes.
      expect(decalageDemo(jour) % 7).toBe(0);
      for (const [i, s] of jeu(jour).seances.entries()) expect(isoWeekday(s.date)).toBe(isoWeekday(SEANCES_CLUB[i].date));
    });
  }

  it("ne change rien la semaine de l'ancrage : ce sont les dates du jeu du club", () => {
    for (const jour of [ANCRAGE_DEMO, "2026-10-01", "2026-10-06"]) {
      expect(decalageDemo(jour)).toBe(0);
      expect(jeu(jour).seances.map((s) => s.date)).toEqual(SEANCES_CLUB.map((s) => s.date));
    }
  });

  it("ne recule jamais, même sur une horloge en retard", () => {
    for (const jour of ["2026-09-01", "2025-01-01"]) expect(decalageDemo(jour)).toBe(0);
  });

  /**
   * **Reproductible** : les captures d'aperçu servent de référence visuelle. Le décalage ne dépend que
   * de la semaine en cours — deux exécutions du même jour, et même de la même semaine, posent les
   * mêmes dates.
   */
  it("donne le même jeu tous les jours d'une même semaine", () => {
    const semaine = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"];
    const attendu = jeu(semaine[0]).seances.map((s) => s.date);
    for (const jour of semaine) expect(jeu(jour).seances.map((s) => s.date)).toEqual(attendu);
    // Et il avance d'exactement une semaine quand la semaine change.
    expect(joursAvant(attendu[0], jeu("2026-10-14").seances[0].date)).toBe(7);
  });

  /**
   * La période enveloppe ses séances. Son `dateDebut` **est** la première d'entre elles ; c'est sa fin
   * qui pouvait rester en arrière, et une période finie avant son dernier cours verrouille l'écriture
   * sur des séances à venir (`ecritureFermee`).
   */
  it("la période recalée finit après sa dernière séance", () => {
    for (const jour of JOURS) {
      const { seances } = jeu(jour);
      expect(seances[seances.length - 1].date <= dateDemo("2026-10-31", jour)).toBe(true);
    }
  });

  /** Le jeu doit tenir **aujourd'hui** aussi, et ce cas-là n'est pas simulé. */
  it("tient à la date du jour", () => {
    const { aVenir, annulee, prochaine } = jeu(todayIso());
    expect(aVenir.length).toBeGreaterThanOrEqual(3);
    expect(annulee).toBeDefined();
    expect(prochaine).toBeDefined();
  });
});
