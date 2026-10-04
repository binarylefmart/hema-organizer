import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Rien de ce qu'une spec e2e atteint ne peut employer `import.meta`.**
 *
 * Le, la campagne e2e ne lançait **aucun** test, et personne ne s'en apercevait.
 *
 * `prisma/seed-demo.ts` gardait son lancement en ligne de commande par
 * `import.meta.url === pathToFileURL(process.argv[1]).href`. Sous `tsx`, qui sait charger de l'ES,
 * la forme marche. Mais le projet n'est **pas** un module ES (aucun `"type": "module"`), et
 * Playwright transpile les specs en **CommonJS**, où `import.meta` n'existe pas. La veille, une
 * passe de bugs avait fait importer `dateDemo` de ce fichier dans `filtre-date.spec.ts` et
 * `zy-retrait-membre.spec.ts` : les deux fichiers ont cessé d'être lisibles.
 *
 * **Et c'est là que ça devient grave : Playwright abandonne la campagne entière dès qu'il échoue à
 * collecter un seul fichier.** Pas « deux specs en échec » — zéro test exécuté, un `SyntaxError` au
 * milieu du journal, et un compte de tests qui tombe de 50 à 38 sans un mot. On pouvait annoncer
 * « 38/38 verts » en toute bonne foi pendant des jours.
 *
 * Deux autres fichiers du dépôt portaient déjà la règle en commentaire (`prisma/seed.ts`,
 * `scripts/reparer-donnees.ts`, qui reconnaissent leur point d'entrée au **nom du fichier**) ; un
 * commentaire ne garde rien. Ce test-ci part de chaque spec, suit les imports **relatifs et `@/`**
 * de proche en proche, et refuse `import.meta` partout sur ce chemin.
 *
 * On lit la source plutôt que d'importer : importer le module exécuterait son effet de bord — et
 * `prisma/seed-demo.ts` ouvre une vraie base.
 */

const RACINE = process.cwd();
const E2E = path.join(RACINE, "tests", "e2e");

/** Les extensions que `resolve` essaie, dans l'ordre, pour un chemin d'import sans extension. */
const EXTENSIONS = [".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

function resoudre(depuis: string, specificateur: string): string | null {
  const base = specificateur.startsWith("@/")
    ? path.join(RACINE, "src", specificateur.slice(2))
    : specificateur.startsWith(".")
      ? path.resolve(path.dirname(depuis), specificateur)
      : null;
  if (base === null) return null; // paquet npm ou module natif : pas notre affaire
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    const essai = base + ext;
    if (fs.existsSync(essai)) return essai;
  }
  return null;
}

/** Tous les `from "…"` d'un fichier, y compris les `import type` (Playwright les voit aussi). */
function imports(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * **On cherche du code, pas de la prose.** Première version de ce test : il s'est déclenché sur
 * `prisma/seed-demo.ts`, qui venait justement d'être corrigé — son commentaire *raconte* la panne et
 * nomme donc `import.meta`. Un garde-fou qui interdit de parler de ce qu'il interdit est un garde-fou
 * qu'on finit par désactiver. On retire donc les commentaires avant de chercher.
 *
 * Le découpage est volontairement grossier (il couperait aussi un `//` au milieu d'une chaîne, comme
 * dans une URL) : ça ne peut que raccourcir une ligne, jamais inventer un faux positif, et la seule
 * faille théorique — un `import.meta` écrit après un `https://` sur la même ligne — n'existe pas.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function atteignablesDepuisLesSpecs(): Map<string, string> {
  const vus = new Map<string, string>();
  const aVoir = fs
    .readdirSync(E2E)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(E2E, f));
  while (aVoir.length) {
    const fichier = aVoir.pop()!;
    if (vus.has(fichier)) continue;
    const source = fs.readFileSync(fichier, "utf8");
    vus.set(fichier, source);
    for (const specificateur of imports(source)) {
      const cible = resoudre(fichier, specificateur);
      if (cible && !vus.has(cible)) aVoir.push(cible);
    }
  }
  return vus;
}

describe("ce que les specs e2e atteignent se transpile en CommonJS", () => {
  const atteignables = atteignablesDepuisLesSpecs();

  it("part bien des specs et suit les imports au-delà du premier niveau", () => {
    const relatifs = [...atteignables.keys()].map((f) => path.relative(RACINE, f));
    // Le parcours doit dépasser `tests/e2e` : sinon la règle ne garderait que les specs elles-mêmes
    // et laisserait repasser exactement le défaut du 01/10 (qui vivait dans `prisma/`).
    expect(relatifs.some((f) => f.startsWith("tests/e2e/"))).toBe(true);
    expect(relatifs.some((f) => f.startsWith("prisma/"))).toBe(true);
    expect(relatifs.some((f) => f.startsWith("src/"))).toBe(true);
  });

  it("aucun n'emploie `import.meta`", () => {
    const fautifs = [...atteignables]
      .filter(([, source]) => /\bimport\s*\.\s*meta\b/.test(sansCommentaires(source)))
      .map(([fichier]) => path.relative(RACINE, fichier));
    expect(
      fautifs,
      "`import.meta` n'existe pas en CommonJS : Playwright n'arrivera pas à collecter la spec qui " +
        "mène à ces fichiers, et il abandonnera la campagne ENTIÈRE. Pour reconnaître un lancement " +
        "en ligne de commande, tester le nom du fichier d'entrée comme le fait `prisma/seed.ts`.",
    ).toEqual([]);
  });
});
