import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Les longues listes d'administration (journal d'audit, sessions de connexion) se lisent page par page :
 * sans pagination, le jeu de démonstration donnait une page de plusieurs dizaines de milliers de pixels
 * sur téléphone. Ces deux écrans sont des composants serveur (requête Prisma incluse) : on vérifie ici
 * leur source, pour garantir qu'ils paginent de la même façon et avec les mêmes mots.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const AUDIT = "src/app/(app)/admin/audit/page.tsx";
const SESSIONS = "src/app/(app)/admin/sessions/page.tsx";

const tailleDePage = (f: string) => Number(/const PAR_PAGE = (\d+);/.exec(source(f))?.[1]);

describe("pagination des listes d'administration", () => {
  it("découpe les deux listes avec la même taille de page", () => {
    expect(tailleDePage(AUDIT)).toBeGreaterThan(0);
    expect(tailleDePage(SESSIONS)).toBe(tailleDePage(AUDIT));
  });

  it("ne charge plus qu'une page de sessions à la fois (plus de take: 200)", () => {
    const code = source(SESSIONS);
    expect(code).not.toMatch(/take:\s*200/);
    expect(code).toMatch(/skip:\s*\(p - 1\) \* PAR_PAGE/);
    expect(code).toMatch(/take:\s*PAR_PAGE/);
    expect(code).toMatch(/db\.authSession\.count\(\{ where \}\)/);
  });

  it("reprend mot pour mot les boutons du journal d'audit", () => {
    for (const fichier of [AUDIT, SESSIONS]) {
      const code = source(fichier);
      expect(code).toContain("← Plus récent");
      expect(code).toContain("Plus ancien →");
      expect(code).toMatch(/Page \{p\} \/ \{pages\}/);
      expect(code).toMatch(/page=\$\{p - 1\}/);
      expect(code).toMatch(/page=\$\{p \+ 1\}/);
    }
  });

  it("garde le total, le surlignage de la session courante et les deux révocations", () => {
    const code = source(SESSIONS);
    expect(code).toMatch(/\{total\} session/); // le compteur reste celui de toutes les sessions actives
    expect(code).toMatch(/s\.id === moi\.sessionId \? "bg-primaire-doux\/40"/);
    expect(code).toContain("(cette session)");
    expect(code).toContain("revoquerSession.bind(null, s.id)");
    expect(code).toContain("revoquerSessionsUtilisateur.bind(null, s.user.id)");
  });
});
