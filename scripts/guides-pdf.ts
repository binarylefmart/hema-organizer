/**
 * Les trois guides d'utilisation, du HTML au PDF.
 *
 * Prérequis : `npx playwright install chromium` (déjà fait pour les e2e et les captures).
 * Usage     : npm run guides:pdf [-- --only=membre,admin]
 *
 * Produit `docs/guides/HEMA-Organizer-guide-<rôle>.pdf` à partir de `docs/guides/guide-<rôle>.html`.
 *
 * **Pourquoi Chromium et non une bibliothèque PDF** : les guides sont d'abord des pages web (mêmes
 * couleurs, même police, mêmes captures que l'application), et c'est le moteur du navigateur qui sait
 * paginer un flux de texte et d'images. La mise en page d'impression vit donc dans `guide.css`
 * (`@page`, sauts de page, `break-inside`), pas ici : ce script ne fait qu'imprimer.
 */
import { chromium } from "@playwright/test";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RACINE = process.cwd();
const DOSSIER = path.join(RACINE, "docs", "guides");

const GUIDES = [
  { cle: "membre", fichier: "guide-membre.html", titre: "HEMA-Organizer-guide-membre.pdf" },
  { cle: "instructeur", fichier: "guide-instructeur.html", titre: "HEMA-Organizer-guide-instructeur.pdf" },
  { cle: "admin", fichier: "guide-admin.html", titre: "HEMA-Organizer-guide-administrateur.pdf" },
] as const;

const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length)?.split(",").filter(Boolean);

/**
 * Le pied de page : le titre du guide à gauche, le numéro de page à droite.
 *
 * Chromium rend ce fragment dans la marge basse, dans un document à part : il n'hérite ni de
 * `guide.css` ni de ses polices, d'où les styles en ligne, seul endroit du projet où ils sont de mise.
 */
function piedDePage(titre: string): string {
  return `<div style="width:100%;margin:0 12mm;font:8pt Georgia,serif;color:#5a5148;display:flex;justify-content:space-between;">
    <span>${titre}</span><span>page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

/** Les images d'une page, vues du HTML : sert à dire précisément laquelle manque. */
async function imagesManquantes(html: string, base: string): Promise<string[]> {
  const manquantes: string[] = [];
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    const src = m[1];
    if (/^(https?:|data:)/.test(src)) continue;
    const chemin = path.resolve(base, src);
    try {
      await access(chemin);
    } catch {
      manquantes.push(src);
    }
  }
  return manquantes;
}

async function imprimer(cle: string, fichier: string, sortie: string): Promise<void> {
  const source = path.join(DOSSIER, fichier);
  const html = await readFile(source, "utf8");
  const manquantes = await imagesManquantes(html, DOSSIER);
  if (manquantes.length) {
    console.warn(`  ⚠ ${manquantes.length} image(s) introuvable(s) : ${manquantes.slice(0, 5).join(", ")}${manquantes.length > 5 ? "…" : ""}`);
  }

  const navigateur = await chromium.launch();
  const page = await navigateur.newPage();
  const erreurs: string[] = [];
  page.on("pageerror", (e) => erreurs.push(String(e)));
  await page.goto(`file://${source}`, { waitUntil: "load" });
  // Les polices en @font-face et les JPEG : Chromium peut imprimer avant de les avoir décodés.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images)
        .filter((i) => !i.complete)
        .map(
          (i) =>
            new Promise<void>((ok) => {
              i.addEventListener("load", () => ok(), { once: true });
              i.addEventListener("error", () => ok(), { once: true });
            }),
        ),
    );
  });
  const titre = await page.title();
  await page.pdf({
    path: path.join(DOSSIER, sortie),
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: piedDePage(titre),
  });
  await navigateur.close();
  if (erreurs.length) console.warn(`  ⚠ ${erreurs.length} erreur(s) de page : ${erreurs[0]}`);
  console.info(`  ${sortie} (${cle})`);
}

async function main(): Promise<void> {
  await mkdir(DOSSIER, { recursive: true });
  const presents = await readdir(DOSSIER);
  for (const g of GUIDES) {
    if (ONLY && !ONLY.includes(g.cle)) continue;
    if (!presents.includes(g.fichier)) {
      console.warn(`  ⚠ ${g.fichier} n'existe pas encore : guide ignoré`);
      continue;
    }
    await imprimer(g.cle, g.fichier, g.titre);
  }
  // Un index à ouvrir dans un navigateur, pour relire les trois guides sans chercher les fichiers.
  const liens = GUIDES.filter((g) => presents.includes(g.fichier))
    .map((g) => `    <li><a href="${g.fichier}">Guide ${g.cle}</a> — <a href="${g.titre}">PDF</a></li>`)
    .join("\n");
  await writeFile(
    path.join(DOSSIER, "index.html"),
    `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>HEMA Organizer — les guides</title><link rel="stylesheet" href="guide.css"></head>
<body><div class="page-ecran">
  <h1>Les guides de HEMA Organizer</h1>
  <ul>
${liens}
  </ul>
</div></body>
</html>
`,
    "utf8",
  );
}

void main();
