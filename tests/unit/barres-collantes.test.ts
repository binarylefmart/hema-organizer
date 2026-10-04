import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Une barre collée en bas se mesure à ce qui occupe déjà le bas de l'écran**.
 *
 * Sur téléphone, le bas de l'écran est pris : la barre d'onglets (`NavBas`, `fixed bottom-0 z-10`,
 * cachée dès 768 px) y tient « Accueil / Séances / Profil », et le système y pose sa propre zone
 * (`env(safe-area-inset-bottom)`, que `viewport-fit=cover` nous laisse lire). Une barre d'action posée
 * à `bottom-0` se retrouve donc **par-dessus la navigation** — à `z-index` égal, c'est le dernier peint
 * qui gagne — et son propre bas passe sous la zone système.
 *
 * **Le défaut est arrivé deux fois, à un mois d'intervalle de rien du tout** : le 30/09 sur la barre
 * de correction des présences (`PresencesEquipe`), où elle rendait les trois onglets intapables tant
 * qu'une sélection était active ; le 03/10 sur la barre du mode modification du planning, écrite la
 * veille sans hériter de la leçon — Delta l'a vue sur son téléphone (« la fenêtre modification c'est
 * tjs coupé »). Mesuré à 390 × 844 : barre jusqu'à 844 px, barre d'onglets de 759 à 844, donc
 * recouverte en entier ; après correction, barre jusqu'à 756 px et plus aucun chevauchement.
 *
 * Ce balayage empêche la troisième fois. Il ne juge pas la valeur du décalage — il exige que la
 * question ait été **posée**, c'est-à-dire que la classe nomme `env(safe-area-inset-bottom)`.
 */
const RACINE = path.join(process.cwd(), "src");

function fichiersTsx(dossier: string): string[] {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dossier, e.name);
    return e.isDirectory() ? fichiersTsx(p) : e.name.endsWith(".tsx") ? [p] : [];
  });
}

describe("toute barre collée en bas tient compte de ce qui occupe déjà le bas", () => {
  it("aucune `sticky bottom-…` n'ignore la barre d'onglets et la zone système", () => {
    const fautives: string[] = [];
    for (const fichier of fichiersTsx(RACINE)) {
      const source = fs.readFileSync(fichier, "utf8");
      // Chaque liste de classes qui pose un ancrage collant en bas, prise entre ses guillemets.
      for (const m of source.matchAll(/["`]([^"`\n]*\bsticky bottom-[^"`\n]*)["`]/g)) {
        const classes = m[1];
        if (!classes.includes("env(safe-area-inset-bottom")) {
          fautives.push(`${path.relative(process.cwd(), fichier)} → ${classes.slice(0, 80)}…`);
        }
      }
    }
    expect(fautives, "une barre collante en bas doit nommer `env(safe-area-inset-bottom)` dans son décalage").toEqual([]);
  });

  /** Contre-épreuve : le balayage trouve bien quelque chose, sinon il passerait sur un dépôt vide. */
  it("et il y a bien des barres collantes à surveiller", () => {
    const toutes = fichiersTsx(RACINE)
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n")
      .match(/\bsticky bottom-/g);
    expect(toutes?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
