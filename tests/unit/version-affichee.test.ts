import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **La version affichée doit survivre au conteneur.**
 *
 * L'écran « À propos » est le seul qui réponde à « qu'est-ce que je fais tourner, au juste ? », et
 * il lisait `process.env.npm_package_version`. Cette variable n'est posée que par `npm run` : dans
 * l'image, le serveur démarre par `node server.js`, donc elle est vide et la ligne « Version »
 * affichait un tiret. Personne ne s'en apercevait tant que la stack épinglait un numéro de version ;
 * depuis qu'elle suit `latest`, cet écran est **tout ce qui reste** pour savoir ce qui tourne.
 *
 * Trois choses doivent rester d'accord, et elles vivent dans trois fichiers que rien d'autre ne
 * relie : le `Dockerfile` grave la version, le workflow la lui passe, et l'écran la lit.
 */
const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), "utf8");

describe("la version se grave dans l'image et s'affiche", () => {
  it("le Dockerfile reçoit la version et la pose en variable d'environnement", () => {
    const dockerfile = lire("Dockerfile");
    expect(dockerfile, "le Dockerfile n'accepte pas d'argument VERSION").toMatch(/^ARG VERSION=/m);
    expect(dockerfile, "APP_VERSION n'est pas posée depuis l'argument").toMatch(/APP_VERSION=\$\{VERSION\}/);
  });

  it("le workflow passe la version au build", () => {
    const workflow = lire(".github/workflows/release.yml");
    expect(workflow, "le build ne reçoit pas de build-args").toMatch(/build-args:/);
    expect(workflow, "VERSION n'est pas passée au build").toMatch(/VERSION=\$\{\{ steps\.version\.outputs\.version \}\}/);
  });

  it("l'écran À propos lit APP_VERSION avant npm_package_version", () => {
    const ecran = lire("src/app/(app)/admin/apropos/page.tsx");
    const ligne = ecran.split("\n").find((l) => l.includes('cle: "Version"'));
    expect(ligne, "la ligne « Version » a disparu de l'écran").toBeDefined();
    expect(ligne).toContain("process.env.APP_VERSION");
    // L'ordre, pas seulement la présence : lue en second, la variable gravée ne servirait à rien.
    const i = ligne!.indexOf("APP_VERSION");
    const j = ligne!.indexOf("npm_package_version");
    expect(i, "APP_VERSION doit être lue en premier").toBeGreaterThan(-1);
    if (j > -1) expect(i).toBeLessThan(j);
  });
});
