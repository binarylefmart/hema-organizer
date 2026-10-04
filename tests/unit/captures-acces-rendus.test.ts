import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_MOT_DE_PASSE } from "../../prisma/comptes";

/**
 * **Le mot de passe de démonstration était posé hors du bloc qui le reprend.**
 *
 * `scripts/preview-screenshots.ts` a besoin d'accès connus pour se connecter : il photographie les
 * accès réels du compte d'administration (`instantaneCompteAdministration`), installe ceux du dépôt
 * (`restaurerCompteAdministration` — mot de passe **publié ici**, secret TOTP fixe, codes de secours
 * fixes), puis les rend à la fin (`restaurerInstantane`).
 *
 * L'écriture avait lieu **avant** le `try` dont le `finally` rend les vrais accès, et quatre
 * requêtes plus un `fetch` la séparaient de ce bloc — dont celui qui vérifie que le serveur répond.
 * Le scénario n'est pas théorique, c'est le plus courant de tous : lancer les captures sans avoir
 * démarré `npm run dev`, lire « Serveur injoignable », et laisser derrière soi un compte
 * d'administration ouvert au mot de passe du dépôt, sur la base locale, sans que rien ne le dise.
 * Le lancement du navigateur, un disque plein ou une scène inconnue faisaient la même chose.
 * Corrigé : **la fenêtre pendant laquelle le mot de passe est modifié est entièrement couverte.**
 *
 * Ce test relit le fichier, comme le font ici les tests de règles de configuration : la campagne de
 * captures a besoin d'un navigateur, d'un serveur et d'une base de démonstration, elle ne se rejoue
 * pas dans une suite unitaire. Ce qui se vérifie sans elle, c'est **l'ordre du code** — et c'est
 * précisément ce qui était faux.
 */

const source = readFileSync(path.join(process.cwd(), "scripts/preview-screenshots.ts"), "utf8");

/**
 * **Les commentaires sont retirés avant de chercher.** Ce fichier raisonne sur l'ordre des
 * instructions, et le correctif est justement très commenté : une phrase qui nomme
 * `restaurerCompteAdministration()` au-dessus du `try` ferait croire à un appel placé trop tôt. Seuls
 * les blocs `/* … *\/` et les lignes entières de `//` partent — un `https://` au milieu d'une ligne
 * de code reste.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const main = code.slice(code.indexOf("async function main()"));

describe("les captures rendent toujours les accès du compte d'administration", () => {
  it("prend l'instantané, puis n'écrit rien avant d'entrer dans le bloc protégé", () => {
    const instantane = main.indexOf("instantaneCompteAdministration()");
    const bloc = main.indexOf("try {", instantane);
    expect(instantane).toBeGreaterThan(-1);
    expect(bloc).toBeGreaterThan(instantane);
    // Rien d'attendu entre les deux : un seul `await` glissé là, et c'est une opération qui peut
    // échouer avec le mot de passe de démonstration déjà en place — ou juste avant qu'il le soit.
    expect(main.slice(instantane + "instantaneCompteAdministration()".length, bloc)).not.toMatch(/await/);
  });

  it("pose les accès de démonstration à l'intérieur du bloc, et les rend dans son finally", () => {
    const bloc = main.indexOf("try {", main.indexOf("instantaneCompteAdministration()"));
    const ecriture = main.indexOf("restaurerCompteAdministration()");
    const rendu = main.indexOf("rendreAcces()");
    expect(ecriture).toBeGreaterThan(bloc);
    expect(rendu).toBeGreaterThan(ecriture);
    expect(main.slice(ecriture, rendu)).toContain("finally");
  });

  it("n'écrit ces accès nulle part ailleurs dans main()", () => {
    // Une seconde pose, hors du bloc, rouvrirait exactement le même trou.
    expect(main.match(/restaurerCompteAdministration\(\)/g)).toHaveLength(1);
  });

  /**
   * **Un `finally` ne survit pas à un Ctrl+C** : un signal non intercepté arrête Node sans dérouler
   * la pile. Or on interrompt une campagne de 350 captures tous les jours — c'est le second chemin
   * par lequel le mot de passe du dépôt restait en place.
   */
  it("rend aussi les accès sur Ctrl+C et sur un arrêt demandé", () => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const i = code.indexOf(signal);
      expect(i, `${signal} doit être écouté`).toBeGreaterThan(-1);
      expect(code.slice(i, i + 600)).toContain("rendreAcces");
    }
  });

  it("la remise en état n'écrit qu'une fois, même appelée par les deux chemins", () => {
    // Le `finally` et l'écoute du signal peuvent se déclencher tous les deux : sans ce verrou, la
    // seconde exécution écrirait par-dessus ce que la première vient de rendre.
    expect(code).toMatch(/if \(accesRendus \|\| !accesInitiaux\) return;/);
  });

  /** Rappel du garde-fou de `production.test.ts` : la valeur est importée, jamais recopiée. */
  it("ne recopie pas le mot de passe de démonstration", () => {
    expect(source).not.toContain(DEMO_MOT_DE_PASSE);
  });
});
