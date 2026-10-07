import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Sa propre fiche : ce que l'aide du rôle dit doit être ce que les boutons font.** Le serveur laisse
 * chacun régler son propre rôle de base (`modifierMembre` : il n'ouvre aucun droit), la fiche le
 * laisse régler (`roleVerrouille` ne compte pas `soiMeme`, et les deux boutons du téléphone s'y
 * montrent) — mais l'aide sous la liste annonçait « Tu ne peux pas changer ton propre rôle ». La règle
 * serveur fait foi ; c'est le texte qui s'aligne. Lu dans la source, comme le reste des écrans serveur.
 */

const FICHE = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/admin/membres/[id]/page.tsx"), "utf8");
const MEMBRES = fs.readFileSync(path.join(process.cwd(), "src/actions/membres.ts"), "utf8");

describe("le rôle sur sa propre fiche", () => {
  it("le serveur l'autorise toujours — la règle qui fait foi", () => {
    expect(MEMBRES).toMatch(/On règle son propre rôle de base, et c'est devenu juste/);
  });

  it("la fiche ne le verrouille pas", () => {
    const verrou = FICHE.match(/const roleVerrouille = ([^;]+);/)?.[1] ?? "";
    expect(verrou).not.toBe("");
    expect(verrou).not.toMatch(/soiMeme/);
  });

  it("l'aide ne promet plus un verrou que les boutons démentent", () => {
    expect(FICHE).not.toMatch(/Tu ne peux pas changer ton propre rôle/);
    // La branche « sa propre fiche » de l'aide dit que le rôle se règle.
    const aide = FICHE.match(/: soiMeme\s*\?\s*"([^"]+)"\s*:\s*"Membre ou instructeur/)?.[1] ?? "";
    expect(aide).toMatch(/se règle/);
  });

  it("aucun commentaire ne range plus sa propre fiche parmi les cas verrouillés", () => {
    expect(FICHE).not.toMatch(/ne change pas son propre rôle/);
  });
});
