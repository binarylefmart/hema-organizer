import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const lire = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const sansCommentaires = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "");

/**
 * **Les écrans du téléphone parlent la même langue.** Plusieurs chantiers les ont refaits chacun de
 * leur côté ; ce fichier garde ce qui les a réunis : une seule liste groupée, un seul volet du bas, un
 * seul gros bouton d'entrée, et les mêmes mots pour les mêmes gestes.
 */
describe("une seule liste groupée", () => {
  it("sert au menu admin, au profil, à la fiche d'un membre, aux périodes et aux canaux", () => {
    for (const f of [
      "src/app/(app)/admin/page.tsx",
      "src/app/(app)/profil/page.tsx",
      "src/app/(app)/admin/membres/[id]/page.tsx",
      "src/app/(app)/admin/periodes/page.tsx",
      "src/app/(app)/admin/notifications/page.tsx",
    ]) {
      expect(lire(f), f).toContain('from "@/components/ui/ListeGroupee"');
    }
  });

  it("donne sa ligne à la matrice des notifications, qui ne peut pas la prendre entière", () => {
    const ligne = sansCommentaires(lire("src/app/(app)/admin/notifications/LigneNotification.tsx"));
    expect(ligne).toContain("className={CLASSE_LIGNE}");
    expect(ligne).toContain('sens="deplier"');
  });

  it("tient ses lignes à 56 px, avec un chevron et un résumé", () => {
    const code = lire("src/components/ui/ListeGroupee.tsx");
    expect(code).toContain('"flex min-h-14 w-full items-center');
    expect(code).toContain('nom="chevronBas"');
    expect(code).toContain("aria-expanded={ouvert}");
  });
});

describe("un seul volet du bas", () => {
  it("porte « Programmer » et « Refuser… » des ateliers", () => {
    const decision = sansCommentaires(lire("src/app/(app)/gestion/ateliers/DecisionAtelier.tsx"));
    expect(decision).toContain("<VoletBas");
    // Le volet a son « Fermer » : plus de « ‹ Retour » maison pour en sortir.
    expect(decision).not.toContain("‹ Retour");
  });

  it("partage son gros bouton d'entrée entre les gestes et les rubriques", () => {
    expect(lire("src/app/(app)/admin/membres/RubriquesVolet.tsx")).toContain("<EntreeVolet");
    expect(lire("src/components/ui/GestesVolet.tsx")).toContain("export function EntreeVolet");
  });
});

describe("le lexique du téléphone", () => {
  it("revient d'un sous-écran par « ‹ Retour », toujours ce mot", () => {
    expect(lire("src/components/ui/GestesVolet.tsx")).not.toContain("libelleRetour");
    expect(lire("src/components/planning/SelectionPlanning.tsx")).not.toContain("Retour aux");
  });

  it("ferme un volet par « Fermer »", () => {
    expect(sansCommentaires(lire("src/components/ui/VoletBas.tsx"))).toMatch(/>\s*Fermer\s*</);
  });
});

describe("petits défauts", () => {
  it("« Renvoyer le lien » s'étire à côté de « ⋯ »", () => {
    expect(lire("src/components/ui/BoutonAction.tsx")).toContain('props.pleineLargeur ? "flex min-w-0 flex-1 flex-col gap-1"');
    const fiche = lire("src/app/(app)/admin/membres/[id]/page.tsx");
    expect(fiche).not.toMatch(/<BoutonAction[^>]*className="flex-1"/);
  });

  it("la barre de sélection porte le même habit que la barre d'édition", () => {
    const barre = lire("src/components/ui/BarreSelection.tsx");
    expect(barre).toContain("border-2 border-primaire/40 bg-surface/95");
    expect(barre).not.toContain("bg-encre ");
  });
});
