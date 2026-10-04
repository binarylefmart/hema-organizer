import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { libelleNiveau, niveauAffiche, NIVEAU_DEFAUT, NIVEAU_LABELS, NIVEAUX } from "@/lib/constants";
import { programmeDepuisParties } from "@/lib/planning";
import { casePlanningSchema } from "@/lib/validation/gestion";
import { lignesProgramme as lignesFiche } from "@/components/seances/programme-cours";
import { lignesProgramme as lignesSalon, programmeSeance } from "@/lib/notifications/contenu";
import { pairesEgales } from "@/components/planning/file-envoi";

/**
 * **Le niveau d'une case du planning** : un troisième réglage à côté de l'instructeur et du thème,
 * dont la valeur de départ — « Indifférent » — ne s'affiche **nulle part**.
 *
 * Les trois briques vérifiées ici sont celles qui peuvent se briser en silence : la valeur par
 * défaut (une case d'avant ce champ doit valoir « indifférent » sans qu'on ait rien réécrit en
 * base), la validation côté serveur (`enregistrerCase` est une route ouverte sur le réseau), et la
 * règle d'affichage — un niveau indifférent ne distingue rien, l'écrire alourdirait chaque case
 * d'une mention qui n'apprend rien.
 */

describe("vocabulaire des niveaux", () => {
  it("porte les quatre valeurs, « indifférent » en tête", () => {
    expect(NIVEAUX).toEqual(["INDIFFERENT", "DEBUTANT", "INTERMEDIAIRE", "AVANCE"]);
    expect(NIVEAU_DEFAUT).toBe("INDIFFERENT");
  });

  it("donne un libellé français à chacune", () => {
    expect(NIVEAUX.map((n) => NIVEAU_LABELS[n])).toEqual(["Indifférent", "Débutant", "Intermédiaire", "Avancé"]);
  });

  it("n'a rien à montrer d'un niveau indifférent, vide ou inconnu", () => {
    expect(niveauAffiche("INDIFFERENT")).toBeNull();
    expect(niveauAffiche("")).toBeNull();
    expect(niveauAffiche(null)).toBeNull();
    expect(niveauAffiche(undefined)).toBeNull();
    // Valeur écrite par une autre version : elle ne doit pas sortir telle quelle à l'écran
    expect(niveauAffiche("EXPERT")).toBeNull();
  });

  it("montre les trois autres", () => {
    expect(niveauAffiche("DEBUTANT")).toBe("DEBUTANT");
    expect(libelleNiveau("AVANCE")).toBe("Avancé");
    // Le journal d'audit veut un mot, même pour l'absence de niveau
    expect(libelleNiveau(null)).toBe("Indifférent");
  });
});

describe("colonnes de SessionPartie", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const modele = schema.slice(schema.indexOf("model SessionPartie"), schema.indexOf("model SessionInstructeur"));

  it("porte une valeur par défaut : les cases d'avant valent « indifférent » sans écriture de masse", () => {
    expect(modele).toMatch(/niveau\s+String\s+@default\("INDIFFERENT"\)/);
  });

  it("porte le libellé libre, le rang et le drapeau « option » à la place du code de partie", () => {
    expect(modele).toMatch(/libelle\s+String/);
    expect(modele).toMatch(/ordre\s+Int\s+@default\(0\)/);
    expect(modele).toMatch(/estOption\s+Boolean\s+@default\(false\)/);
    // Le nom de la partie n'est plus une clé : deux « Option » dans la même séance sont permises.
    expect(modele).not.toMatch(/@@unique\(\[sessionId, partie\]\)/);
  });

  it("porte un second instructeur, facultatif, détaché comme le premier quand le compte disparaît", () => {
    expect(modele).toMatch(/instructeurSecondId\s+String\?/);
    expect(modele).toMatch(/instructeurSecond\s+User\?\s+@relation\("PartieInstructeurSecond".*onDelete: SetNull/);
  });
});

describe("validation de la case (côté serveur)", () => {
  const base = { partieId: "c1", instructeurId: "", instructeurSecondId: "", theme: "Messer" };

  it("accepte les quatre niveaux", () => {
    for (const niveau of NIVEAUX) expect(casePlanningSchema.safeParse({ ...base, niveau }).success).toBe(true);
  });

  it("refuse tout le reste", () => {
    for (const niveau of ["EXPERT", "debutant", "<script>", 3]) expect(casePlanningSchema.safeParse({ ...base, niveau }).success).toBe(false);
  });

  it("retombe sur « indifférent » quand le champ n'est pas envoyé", () => {
    const parsed = casePlanningSchema.safeParse(base);
    expect(parsed.success && parsed.data.niveau).toBe("INDIFFERENT");
  });
});

describe("le niveau suit la case jusqu'aux écrans", () => {
  it("voyage avec le programme de la séance", () => {
    const prog = programmeDepuisParties([
      { id: "c1", ordre: 0, libelle: "Cours 1", estOption: false, theme: "Messer", niveau: "DEBUTANT", instructeurId: null, instructeur: null, atelier: null },
      { id: "c2", ordre: 1, libelle: "Cours 2", estOption: false, theme: "Lutte", instructeurId: null, instructeur: null, atelier: null },
    ]);
    expect(prog.map((c) => c.niveau)).toEqual(["DEBUTANT", "INDIFFERENT"]);
  });

  it("ne donne rien à lire sur la fiche quand il est indifférent", () => {
    const ligne = { estOption: false, instructeur: null, instructeurId: null, instructeurSecond: null, instructeurSecondId: null, description: "", atelier: null };
    const [avec, sans] = lignesFiche([
      { ...ligne, id: "c1", ordre: 0, rang: 1, libelle: "Cours 1", theme: "Messer", niveau: "AVANCE" },
      { ...ligne, id: "c2", ordre: 1, rang: 2, libelle: "Cours 2", theme: "Lutte", niveau: "INDIFFERENT" },
    ]);
    expect(avec.niveau).toBe("AVANCE");
    expect(sans.niveau).toBeNull();
  });

  it("se dit dans le programme du salon, et se tait quand il est indifférent", () => {
    const cases = programmeSeance([
      { libelle: "Cours 1", ordre: 0, theme: "Messer", niveau: "DEBUTANT", atelier: null },
      { libelle: "Cours 2", ordre: 1, theme: "Lutte", niveau: "INDIFFERENT", atelier: null },
      { libelle: "Option 1", ordre: 2, theme: "", niveau: "AVANCE", atelier: { titre: "Nœuds de corde" } },
    ]);
    expect(lignesSalon(cases)).toEqual([
      "• Cours 1 — Messer (Débutant)",
      "• Cours 2 — Lutte",
      "• Option 1 — Nœuds de corde (Avancé, atelier)",
    ]);
  });
});

describe("enregistrement depuis la case", () => {
  it("un changement de niveau seul est bien un changement à envoyer", () => {
    const base = { instructeurId: "u1", instructeurSecondId: "", theme: "Messer", description: "", niveau: NIVEAU_DEFAUT } as const;
    expect(pairesEgales(base, { ...base })).toBe(true);
    expect(pairesEgales(base, { ...base, niveau: "DEBUTANT" })).toBe(false);
  });
});
