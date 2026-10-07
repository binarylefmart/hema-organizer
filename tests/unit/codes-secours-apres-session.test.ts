import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **À la connexion, les codes de secours se posent après la fin de l'ancienne session.**
 *
 * `destroySession` efface les cookies de passage, dont celui qui porte les codes fraîchement
 * engendrés (un appareil partagé ne doit pas les garder). Lors d'une première activation de la double
 * authentification à la connexion, les codes étaient déposés **avant** cet appel : ils partaient
 * avec lui, l'écran des codes ne trouvait rien, et les huit codes — gardés seulement hachés — étaient
 * perdus sans que personne les ait vus.
 */
describe("première activation 2FA à la connexion", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/actions/auth.ts"), "utf8");
  const debut = source.indexOf('"deux_fa.activee");');
  const fin = source.indexOf("await createSession(", debut);
  const corps = source.slice(debut, fin);

  it("dépose les codes après destroySession, et avant la nouvelle session", () => {
    const destruction = corps.indexOf("await destroySession()");
    const depot = corps.indexOf("ouvrirAffichageCodes(");
    expect(destruction).toBeGreaterThan(-1);
    expect(depot).toBeGreaterThan(destruction);
  });

  it("n'appelle plus ouvrirAffichageCodes avant la fin de la session", () => {
    const avant = source.slice(source.lastIndexOf("if (!secretActif) {", debut), debut);
    expect(avant).not.toContain("ouvrirAffichageCodes(");
  });
});
