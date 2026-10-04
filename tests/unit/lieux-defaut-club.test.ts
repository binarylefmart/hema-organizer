import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Le défaut des lieux : les salles du club tant que rien n'a été enregistré, jamais par-dessus.**
 *
 * `getLieux` propose `LIEUX_DU_CLUB` quand le réglage n'existe pas en base ; une liste enregistrée,
 * même vide, fait foi. Le test ne recopie aucune salle : il compare à la constante, ce qui le garde
 * vrai des deux côtés (ici les salles du club, dans le dépôt public une liste vide).
 */
const faux = vi.hoisted(() => ({ lieux: null as string | null }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings", () => ({
  CLES: { lieux: "lieux", themes: "themes" },
  getSetting: vi.fn(async (cle: string) => (cle === "lieux" ? faux.lieux : null)),
  setSetting: vi.fn(async () => {}),
}));

const { getLieux } = await import("@/lib/planning");
const { LIEUX_DU_CLUB } = await import("@/lib/lieux-club");
const { lieuConnu, nettoyerLieux } = await import("@/lib/lieux");

describe("getLieux — défaut du club", () => {
  beforeEach(() => {
    faux.lieux = null;
  });

  it("réglage jamais enregistré : les salles du club, noms et adresses intacts", async () => {
    const lieux = await getLieux();
    expect(lieux.map(({ lieu, adresse }) => ({ lieu, adresse }))).toEqual(LIEUX_DU_CLUB.map(({ lieu, adresse }) => ({ lieu, adresse })));
    // Les noms restent ceux des séances : le sélecteur doit les reconnaître, pas les ranger dans « Autre ».
    for (const salle of LIEUX_DU_CLUB) expect(lieuConnu(lieux, salle.lieu)?.adresse).toBe(salle.adresse);
  });

  it("une liste enregistrée VIDE fait foi : le défaut ne revient pas", async () => {
    faux.lieux = "[]";
    expect(await getLieux()).toEqual([]);
  });

  it("une liste enregistrée remplace le défaut, elle ne s'y ajoute pas", async () => {
    faux.lieux = JSON.stringify(nettoyerLieux("Gymnase du quartier | 2 place de la Mairie"));
    const lieux = await getLieux();
    expect(lieux).toHaveLength(1);
    expect(lieux[0]).toMatchObject({ lieu: "Gymnase du quartier", adresse: "2 place de la Mairie" });
  });

  it("chaque salle du défaut a son adresse et passe la règle de forme sans être retouchée", () => {
    for (const salle of LIEUX_DU_CLUB) {
      expect(salle.adresse.trim()).not.toBe("");
      expect(salle.lieu).not.toContain("|");
      expect(nettoyerLieux(`${salle.lieu} | ${salle.adresse}`)[0]).toMatchObject(salle);
    }
  });

  it("les salles du défaut sont, à la lettre, celles des créneaux du jeu du club", () => {
    // Le jeu de démonstration porte les créneaux réels (`CRENEAUX`) : un nom qui divergerait ici
    // laisserait les séances existantes hors de la liste déroulante.
    const seed = readFileSync(path.join(process.cwd(), "prisma/seed-demo.ts"), "utf8");
    for (const salle of LIEUX_DU_CLUB) expect(seed).toContain(`lieu: "${salle.lieu}", adresse: "${salle.adresse}"`);
  });
});
