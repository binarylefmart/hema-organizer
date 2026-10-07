import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NIVEAU_DEFAUT, NIVEAUX } from "@/lib/constants";
import { BOUTONS_NIVEAU, niveauChoisi } from "@/components/planning/niveau-boutons";

/**
 * **Le niveau d'une case en quatre boutons, sur téléphone** — et la liste déroulante gardée sur
 * ordinateur, avec le même chemin d'écriture pour les deux.
 */

const lire = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("les quatre boutons du niveau", () => {
  it("couvrent les quatre niveaux, dans l'ordre de la liste", () => {
    expect(BOUTONS_NIVEAU.map((b) => b.niveau)).toEqual([...NIVEAUX]);
  });
  it("se lisent court et s'entendent en entier", () => {
    expect(BOUTONS_NIVEAU.map((b) => b.court)).toEqual(["Tous", "Débutant", "Interm.", "Avancé"]);
    expect(BOUTONS_NIVEAU.map((b) => b.nom)).toEqual(["Tous niveaux", "Débutant", "Intermédiaire", "Avancé"]);
  });
  it("une valeur inconnue retombe sur le défaut, comme dans la liste", () => {
    expect(niveauChoisi("AVANCE")).toBe("AVANCE");
    expect(niveauChoisi("EXPERT")).toBe(NIVEAU_DEFAUT);
    expect(niveauChoisi("")).toBe(NIVEAU_DEFAUT);
  });
});

describe("la case du planning", () => {
  const caseEditeur = lire("src/components/planning/CaseEditeur.tsx");
  it("bascule sur la largeur du téléphone, la liste restant au-delà", () => {
    expect(caseEditeur).toContain("useEcranTelephone()");
    expect(caseEditeur).toMatch(/\{telephone \? \(/);
  });
  it("les boutons disent lequel est choisi et tiennent 48 px", () => {
    expect(caseEditeur).toContain("aria-pressed={actif}");
    expect(caseEditeur).toContain("aria-label={b.nom}");
    expect(caseEditeur).toMatch(/className=\{`min-h-12 /);
  });
  it("le tap et la liste écrivent par le même chemin (brouillon, `sauver`)", () => {
    expect(caseEditeur).toContain("onClick={() => choisirNiveau(b.niveau)}");
    expect(caseEditeur).toContain("onChoisir={choisirNiveau}");
  });
});

describe("le bandeau « Mode modification » des séances", () => {
  const page = lire("src/app/(app)/seances/page.tsx");
  it("garde sa sortie et l'ajout, sans phrase d'explication", () => {
    expect(page).toContain('aria-label="Mode modification"');
    expect(page).toContain("Terminer les modifications");
    expect(page).toContain("Nouvelle séance");
    expect(page).not.toContain("les gestes de chaque séance sont au pied de sa carte");
  });
});
