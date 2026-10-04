import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Le millésime des guides et celui du paquet sont le même nombre**.
 *
 * Les trois guides portent leur version **en dur**, deux fois chacun : sur la couverture et en pied de
 * dernière page. C'est voulu — un guide s'ouvre dans un navigateur et doit montrer exactement ce que
 * sort le PDF, sans rien aller chercher. Mais ça fait **sept écritures du même nombre** avec
 * `package.json`, et une valeur écrite sept fois diverge : Delta l'a vu avant moi (« pk 0.59.0 ? tu
 * as bien fait des modifs depuis non ? »), alors que je venais de réimprimer les PDF en croyant que
 * le tampon suivait la version du paquet.
 *
 * Ce test ne retire pas la duplication, il la **rend impossible à oublier** : il échoue à la première
 * publication où l'un des sept n'a pas suivi, c'est-à-dire avant que le club reçoive un guide qui se
 * présente sous un numéro qui n'existe pas.
 */
const RACINE = process.cwd();
const version = JSON.parse(fs.readFileSync(path.join(RACINE, "package.json"), "utf8")).version as string;
const GUIDES = ["guide-membre.html", "guide-instructeur.html", "guide-admin.html"];

describe("le millésime des guides suit celui du paquet", () => {
  it("la version du paquet se lit, et elle a la forme attendue", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(GUIDES)("%s porte la version du paquet, et aucune autre", (fichier) => {
    const texte = fs.readFileSync(path.join(RACINE, "docs/guides", fichier), "utf8");
    // Toutes les mentions de version du document, quelle que soit la casse de « version ».
    const mentions = [...texte.matchAll(/ersion\s+(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    // Deux par guide : la couverture et le pied de dernière page. Zéro voudrait dire que le tampon a
    // disparu — ce qui passerait inaperçu, le PDF sortant quand même.
    expect(mentions.length, `${fichier} ne porte aucun millésime`).toBeGreaterThanOrEqual(2);
    expect(new Set(mentions), `${fichier} porte plusieurs millésimes`).toEqual(new Set([version]));
  });
});
