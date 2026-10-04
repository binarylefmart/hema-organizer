import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Un bouton d'enregistrement dit ce qu'il enregistre** — la règle que « Club » suit déjà
 * (`organisation-reglages.test.ts`), étendue aux notifications et à « À propos » : plusieurs cartes
 * sur une page, chacune son formulaire, et un « Enregistrer » tout court ne dit pas lequel part.
 */

const DOSSIERS = ["src/app/(app)/admin/notifications", "src/app/(app)/admin/apropos", "src/app/(app)/admin/identite"];

function pages(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = path.join(dossier, nom);
    return statSync(chemin).isDirectory() ? pages(chemin) : chemin.endsWith(".tsx") ? [chemin] : [];
  });
}

describe("les boutons des réglages", () => {
  const fichiers = DOSSIERS.flatMap((d) => pages(path.join(process.cwd(), d)));

  it("aucun ne s'appelle « Enregistrer » tout court", () => {
    const fautifs = fichiers.filter((f) => /bouton="Enregistrer"/.test(readFileSync(f, "utf8")));
    expect(fautifs.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("un enregistrement est plein : le neutre est gardé aux vérifications (tests d'envoi, recherche)", () => {
    const neutres = fichiers.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/bouton="(Enregistrer[^"]*)"[^>]*variante="secondaire"/g)].map((m) => `${path.relative(process.cwd(), f)} : ${m[1]}`),
    );
    expect(neutres).toEqual([]);
  });
});
