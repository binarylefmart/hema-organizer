import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Garde-fous des écrans d'attente (`loading.tsx`) et de leurs briques (`ui/Squelette.tsx`).
 *
 * Deux règles à tenir :
 *  - un squelette ne montre **rien de faux** : que des blocs neutres, jamais un chiffre ni un
 *    libellé qui donnerait une information inventée le temps du chargement ;
 *  - la pulsation reste conditionnée à `motion-safe` : immobile pour qui a demandé moins d'animations.
 *
 * On analyse la source (compilateur TypeScript) plutôt que le rendu : la configuration du dépôt
 * garde `jsx: "preserve"`, donc les tests unitaires ne transforment pas le JSX.
 */

const APP = path.join(process.cwd(), "src/app/(app)");
const SQUELETTE = path.join(process.cwd(), "src/components/ui/Squelette.tsx");

function ecransDAttente(dossier: string): string[] {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) return ecransDAttente(complet);
    return e.name === "loading.tsx" ? [complet] : [];
  });
}

const analyser = (fichier: string) => ts.createSourceFile(fichier, fs.readFileSync(fichier, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Tout ce qu'un composant pose littéralement à l'écran : texte JSX brut et littéraux en enfants. */
function textesAffiches(source: ts.SourceFile): string[] {
  const trouves: string[] = [];
  const visiter = (n: ts.Node) => {
    if (ts.isJsxText(n) && n.text.trim() !== "") trouves.push(n.text.trim());
    // {"Séance"} ou {12} placé comme **enfant** d'un élément : du contenu. En position d'attribut
    // (`lignes={4}`, `colonnes={6}`), c'est un réglage de gabarit : rien ne s'affiche.
    if (ts.isJsxExpression(n) && n.expression && !ts.isJsxAttribute(n.parent) && (ts.isStringLiteral(n.expression) || ts.isNumericLiteral(n.expression)))
      trouves.push(n.expression.getText());
    ts.forEachChild(n, visiter);
  };
  ts.forEachChild(source, visiter);
  return trouves;
}

/** Les modules importés par un fichier. */
function imports(source: ts.SourceFile): string[] {
  return source.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
}

const ECRANS = ecransDAttente(APP);
const ROUTE = (fichier: string) => path.relative(APP, path.dirname(fichier)).replaceAll(path.sep, "/");

describe("écrans d'attente", () => {
  it("couvrent les routes lentes de l'espace connecté", () => {
    const routes = ECRANS.map(ROUTE);
    expect(routes).toEqual(
      expect.arrayContaining([
        "planning",
        "ateliers",
        // Les séances ont quitté /gestion pour l'onglet commun : c'est l'écran le plus consulté
        // de l'application, et le plus lourd — il porte donc son propre écran d'attente.
        "seances",
        "seances/[id]",
        // Pas de « gestion » : depuis que l'aperçu a rejoint l'accueil, /gestion n'est plus qu'une
        // redirection vers /admin/membres — elle ne touche pas la base, elle n'a rien à faire
        // attendre. Ce sont ses sous-routes qui portent les écrans d'attente. Le trimestre a
        // rejoint l'espace admin : ses écrans d'attente l'ont suivi.
        "admin/periodes",
        "admin/periodes/[id]",
        "admin/membres",
        "admin/membres/[id]",
        "gestion/ateliers",
        "gestion/tableau-de-bord",
        "admin/audit",
        "admin/sessions",
      ]),
    );
  });

  it.each(ECRANS.map((f) => [ROUTE(f), f]))("/%s n'affiche aucun contenu inventé", (_route, fichier) => {
    expect(textesAffiches(analyser(fichier))).toEqual([]);
  });

  it.each(ECRANS.map((f) => [ROUTE(f), f]))("/%s ne se construit qu'avec les briques partagées", (_route, fichier) => {
    /*
     * **Rien que des briques d'affichage** : un `loading.tsx` ne doit jamais toucher la base ni une
     * action — c'est la règle, et elle ne bouge pas.
     *
     * Ce qui a bougé, c'est la **liste** : elle était close sur `ui/Squelette`, et une silhouette
     * doit aussi pouvoir porter la **largeur** de la page qu'elle annonce (`ui/pleine-largeur`) et
     * sa mise en page (`ui/DeuxPiles`). Sans elles, le contenu des événements sautait de 736 à 1
     * 440 px en arrivant, et les cartes de 360 à 712 — un squelette qui mentait sur la mise en page
     * qu'il prépare. La règle s'écrit donc par ce qui est interdit (`@/lib`, `@/actions`, Prisma…)
     * plutôt que par un seul module autorisé.
     */
    const modules = imports(analyser(fichier));
    for (const m of modules) expect(m, `${fichier} importe ${m}`).toMatch(/^@\/components\/ui\//);
    expect(modules, fichier).toContain("@/components/ui/Squelette");
  });
});

describe("briques de squelette", () => {
  const source = analyser(SQUELETTE);
  const code = fs.readFileSync(SQUELETTE, "utf8");

  it("ne pose que les points de suspension de l'annonce de chargement", () => {
    // Le seul texte est le « … » qui suit le libellé lu par les lecteurs d'écran
    expect(textesAffiches(source)).toEqual(["…"]);
  });

  it("ne pulse qu'en motion-safe", () => {
    expect(code).toContain("motion-safe:animate-pulse");
    expect(code.replaceAll("motion-safe:animate-pulse", "")).not.toContain("animate-pulse");
  });

  it("annonce le chargement sans donner les blocs à lire", () => {
    expect(code).toContain('role="status"');
    expect(code).toContain('aria-busy="true"');
    expect(code).toContain('aria-hidden="true"');
    expect(code).toContain('className="sr-only"');
  });

  it("n'est qu'un composant serveur, sans dépendance", () => {
    expect(code).not.toContain('"use client"');
    expect(imports(source)).toEqual(["react"]);
  });
});
