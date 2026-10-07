import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Le fichier d'état des portes du tableau de suivi vit dans un dossier privé.** La boucle
 * d'affichage **source** ce fichier (`. "$ETAT_PORTES"`) : posé à même `/tmp`, avec un `.tmp` au nom
 * prévisible à côté, un autre compte de la machine pouvait l'écrire avant nous et faire exécuter ce
 * qu'il voulait. On exécute ici les seules lignes concernées du script — le tableau entier lancerait
 * lint, typecheck et tests —, et on vérifie le dossier, ses droits et son nettoyage en quittant.
 */

const SCRIPT = fs.readFileSync(path.join(process.cwd(), "scripts/suivi.sh"), "utf8");
const ligne = (motif: RegExp) => SCRIPT.split("\n").find((l) => motif.test(l)) ?? "";

describe("scripts/suivi.sh — l'état des portes", () => {
  it("crée un dossier privé, y range l'état et son .tmp, et l'efface en quittant", () => {
    const creation = [ligne(/^DOSSIER_PORTES=/), ligne(/^ETAT_PORTES=/)];
    const quitter = ligne(/^quitter\(\)/);
    expect(creation.every(Boolean)).toBe(true);
    expect(quitter).not.toBe("");
    const sortie = execFileSync(
      "bash",
      [
        "-c",
        [
          ...creation,
          quitter,
          'printf "dossier=%s\\n" "$DOSSIER_PORTES"',
          'printf "etat=%s\\n" "$ETAT_PORTES"',
          'printf "droits=%s\\n" "$(stat -c %a "$DOSSIER_PORTES")"',
          "quitter",
        ].join("\n"),
      ],
      { encoding: "utf8" },
    );
    const valeurs = Object.fromEntries([...sortie.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
    expect(valeurs.droits).toBe("700");
    expect(path.dirname(valeurs.etat)).toBe(valeurs.dossier);
    expect(fs.existsSync(valeurs.dossier)).toBe(false);
  });

  it("écrit le .tmp à côté de l'état, donc dans le même dossier", () => {
    expect(SCRIPT).toContain('> "$ETAT_PORTES.tmp" && mv "$ETAT_PORTES.tmp" "$ETAT_PORTES"');
  });
});
