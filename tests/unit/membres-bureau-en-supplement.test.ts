import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIBELLE_BUREAU } from "@/app/(app)/admin/membres/bureau";

/**
 * **« Admin » est un supplément, et l'annuaire n'a aucun chemin vers le bureau.**
 *
 * Nommer ou retirer un administrateur se fait dans « Comptes admin » et nulle part ailleurs : ni la
 * liste de l'annuaire ni la fiche d'un membre ne portent ce geste. Elles montrent l'état (la pastille
 * « admin ») et la fiche dit où le geste vit. Ce fichier tient :
 *
 * - qu'aucun fichier de `/admin/membres` n'appelle les actions de nomination ou de retrait, ni
 *   n'importe un sélecteur de bureau ;
 * - qu'aucune action de ce dossier n'écrit `estAdmin` ;
 * - que les verrous des actions de « Comptes admin » sont ceux annoncés ;
 * - et qu'aucune garde `role === "ADMIN"` ne subsiste dans le dossier.
 */

const DOSSIER = "src/app/(app)/admin/membres";
const lire = (relatif: string) => readFileSync(path.join(process.cwd(), relatif), "utf8");

const fichiers = (dossier: string): string[] =>
  readdirSync(path.join(process.cwd(), dossier), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fichiers(`${dossier}/${e.name}`) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [`${dossier}/${e.name}`] : [],
  );

/**
 * Le code seul : les commentaires racontent l'histoire du dossier et ont le droit de citer un nom
 * d'action ou une valeur. Commentaires de bloc (JSDoc et `{/* … *\/}` du JSX) et de ligne retirés.
 */
const codeSansCommentaires = (f: string) =>
  lire(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");

/* ------------------------------------------------------------------ */
/* 1. Aucun chemin vers le bureau depuis l'annuaire                    */
/* ------------------------------------------------------------------ */

describe("l'annuaire n'a aucun chemin vers le bureau", () => {
  const ACTIONS_DU_BUREAU = ["nommerAdministrateur", "nommerAdministrateurs", "retirerDroitsAdmin"];

  it("aucun fichier de `/admin/membres` n'appelle la nomination ni le retrait des droits", () => {
    const fautifs = fichiers(DOSSIER).flatMap((f) => {
      const code = codeSansCommentaires(f);
      return ACTIONS_DU_BUREAU.filter((a) => new RegExp(`\\b${a}\\b`).test(code)).map((a) => `${f} : ${a}`);
    });
    expect(fautifs).toEqual([]);
  });

  it("aucun fichier de `/admin/membres` n'importe un sélecteur de bureau", () => {
    const fautifs = fichiers(DOSSIER).filter((f) => {
      const code = codeSansCommentaires(f);
      return /Selecteur\w*Bureau|SelectionNomination/.test(code) || /from\s+"[^"]*admin\/comptes[^"]*"/.test(code);
    });
    expect(fautifs).toEqual([]);
    expect(fichiers(DOSSIER).some((f) => /SelecteurBureau/.test(f)), "le composant a été retiré").toBe(false);
  });

  it("les actions du bureau ne sont appelées que depuis « Comptes admin »", () => {
    // Le contrepoint : le geste existe toujours, à sa page.
    const comptes = fichiers("src/app/(app)/admin/comptes").map(codeSansCommentaires).join("\n");
    expect(comptes).toMatch(/\bnommerAdministrateurs\b/);
    expect(comptes).toMatch(/\bretirerDroitsAdmin\b/);
  });

  it("la fiche montre l'état, sans rubrique ni réglage des droits d'administrateur", () => {
    const fiche = lire(`${DOSSIER}/[id]/page.tsx`);
    expect(fiche).toMatch(/LIBELLE_BUREAU/);
    expect(fiche).not.toMatch(/Droits d'administrateur/);
    expect(fiche).not.toMatch(/peutNommerAdmin/);
    expect(LIBELLE_BUREAU).toBe("admin");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Les verrous : aucune écriture de `estAdmin` dans le dossier      */
/* ------------------------------------------------------------------ */

/**
 * `CLAUDE.md` : « deux chemins d'écriture aux règles différentes, c'est une porte dérobée d'un côté ou
 * une fonctionnalité morte de l'autre. »
 */
describe("les verrous du geste, et d'où ils viennent", () => {
  it("aucune action du dossier n'écrit `estAdmin`", () => {
    // Les gestes de masse de l'annuaire ne touchent que `role`, `actif`, ou effacent la ligne.
    // C'est à cette condition qu'un administrateur a retrouvé sa case à cocher.
    const code = lire(`${DOSSIER}/actions.ts`);
    expect(code).not.toMatch(/data: \{[^}]*estAdmin/);
  });

  it("les verrous des actions unitaires du bureau sont bien ceux annoncés", () => {
    const code = lire("src/actions/membres.ts");
    for (const action of ["nommerAdministrateur", "retirerDroitsAdmin"]) {
      const debut = code.indexOf(`export async function ${action}(`);
      expect(debut, action).toBeGreaterThan(0);
      // Le corps de la fonction : jusqu'à la prochaine déclaration exportée.
      const suite = code.indexOf("\nexport ", debut + 1);
      const corps = code.slice(debut, suite === -1 ? undefined : suite);
      expect(corps, `${action} : la permission du bureau`).toMatch(/assertPermission\("admins\.manage"\)/);
      expect(corps, `${action} : un code 2FA récent`).toMatch(/exigerReauth/);
      expect(corps, `${action} : la frontière du bureau`).toMatch(/canEditUser/);
      expect(corps, `${action} : une entrée d'audit nominative`).toMatch(/audit\(acteur, "admin\.droits_/);
    }
    // Le compte du portail et « personne ne se retire son propre bureau » : le retrait porte les deux.
    const retrait = code.slice(code.indexOf("export async function retirerDroitsAdmin("));
    expect(retrait).toMatch(/estCompteDeService/);
    expect(retrait).toMatch(/acteur\.id === userId/);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Plus aucune garde muette dans ce dossier                         */
/* ------------------------------------------------------------------ */

/**
 * **Une garde `role === "ADMIN"` ne lève plus jamais** : `role` ne porte plus cette valeur depuis la
 * migration `role_de_base_et_admin_en_supplement`. Elle ne refuse donc plus rien — ou refuse tout —
 * **sans rien dire**. Ce qui veut savoir si quelqu'un est du bureau lit `estAdmin`.
 */
describe("l'annuaire ne compare plus un rôle à « ADMIN »", () => {
  it("aucun fichier du dossier ne teste `role === \"ADMIN\"` ni n'écrit l'entrée de liste correspondante", () => {
    const fautifs = fichiers(DOSSIER).filter((f) => {
      const code = codeSansCommentaires(f);
      return /role\s*[=!]==\s*"ADMIN"|"ADMIN"\s*[=!]==\s*\w*role/.test(code) || /<option value="ADMIN">/.test(code);
    });
    expect(fautifs).toEqual([]);
  });

  it("et plus aucune valeur « ADMIN » dans le code du dossier", () => {
    // Le sélecteur du bureau parti, la valeur n'a plus de raison d'y voyager.
    const fautifs = fichiers(DOSSIER).filter((f) => /"ADMIN"/.test(codeSansCommentaires(f)));
    expect(fautifs).toEqual([]);
  });
});
