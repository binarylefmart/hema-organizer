import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CLASSES_REPERE } from "@/components/planning/repere-visuel";

/**
 * Garde-fous de la **navigation perçue** : ce qui fait qu'un écran répond tout de suite.
 *
 * Quatre règles, faciles à défaire sans s'en rendre compte :
 *  1. un `layout.tsx` ne lit jamais la base sur le chemin bloquant — il est rendu *autour* du
 *     `loading.tsx` de ses pages, donc tout ce qu'il attend retarde l'écran d'attente lui-même ;
 *  2. les écrans les plus lourds n'attendent pas leurs données : ils les remettent à des îlots
 *     `<Suspense>` dont les squelettes viennent des briques partagées ;
 *  3. le planning ne rend qu'**une** mise en page — le nombre de colonnes de cartes appartient au
 *     CSS, pas au serveur, qui ne connaît pas la largeur de l'écran ;
 *  4. le témoin « c'est parti » des liens est un petit composant client posé *dans* le lien, jamais
 *     un écran serveur entier basculé côté navigateur.
 *
 * On analyse la source (compilateur TypeScript), comme pour les écrans d'attente : la configuration
 * du dépôt garde `jsx: "preserve"`, les tests unitaires ne transforment donc pas le JSX.
 */

const RACINE = process.cwd();
const fichier = (relatif: string) => path.join(RACINE, relatif);

const LAYOUT_GESTION = "src/app/(app)/gestion/layout.tsx";
const PAGE_PLANNING = "src/app/(app)/planning/page.tsx";
const PAGE_TABLEAU_DE_BORD = "src/app/(app)/gestion/tableau-de-bord/page.tsx";
const PAGE_SEANCES = "src/app/(app)/seances/page.tsx";
const GRILLE = "src/components/planning/GrillePlanning.tsx";
const PARTIES = "src/components/planning/ListeParties.tsx";
const CASE = "src/components/planning/CaseEditeur.tsx";
const TEMOIN = "src/components/layout/EnCours.tsx";
const ANCRE = "src/components/planning/AllerALAncre.tsx";
const REPERE = "src/components/planning/repere-visuel.ts";

const lire = (relatif: string) => fs.readFileSync(fichier(relatif), "utf8");
const analyser = (relatif: string) => ts.createSourceFile(relatif, lire(relatif), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Le composant exporté par défaut (le layout ou la page elle-même), tel qu'il est écrit. */
function exportParDefaut(relatif: string): string {
  const source = analyser(relatif);
  for (const s of source.statements) {
    if (ts.isFunctionDeclaration(s) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return s.getText();
  }
  throw new Error(`${relatif} n'exporte pas de composant par défaut`);
}

/** Noms des balises JSX ouvrantes d'un fichier (`<Suspense …>`, `<GrillePlanning …>`…). */
function balises(relatif: string): string[] {
  const trouvees: string[] = [];
  const visiter = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) trouvees.push(n.tagName.getText());
    ts.forEachChild(n, visiter);
  };
  ts.forEachChild(analyser(relatif), visiter);
  return trouvees;
}

/** Les modules importés par un fichier. */
function imports(relatif: string): string[] {
  return analyser(relatif)
    .statements.filter(ts.isImportDeclaration)
    .map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
}

const ECRANS_DECOUPES = [
  { nom: "planning", chemin: PAGE_PLANNING, lourd: /await\s+chargerPlanning/ },
  { nom: "tableau de bord", chemin: PAGE_TABLEAU_DE_BORD, lourd: /await\s+statsPeriode/ },
  { nom: "séances", chemin: PAGE_SEANCES, lourd: /await\s+chargerSeances/ },
];

describe("le layout de gestion ne bloque pas ses pages", () => {
  it("ne lit pas la base dans le composant de layout lui-même", () => {
    // Le comptage de la pastille « Ateliers » doit vivre ailleurs : ici, il retarderait
    // l'écran d'attente de *toutes* les pages de /gestion, à chaque entrée dans la section.
    expect(exportParDefaut(LAYOUT_GESTION)).not.toMatch(/\bdb\./);
  });

  it("garde le comptage de la pastille, mais derrière un <Suspense>", () => {
    const code = lire(LAYOUT_GESTION);
    expect(code).toContain("db.atelier.count");
    expect(balises(LAYOUT_GESTION)).toContain("Suspense");
  });
});

describe("îlots <Suspense> des écrans lents", () => {
  it.each(ECRANS_DECOUPES.map((e) => [e.nom, e] as const))("%s : la page n'attend pas ses données lourdes", (_nom, ecran) => {
    expect(exportParDefaut(ecran.chemin)).not.toMatch(ecran.lourd);
  });

  it.each(ECRANS_DECOUPES.map((e) => [e.nom, e] as const))("%s : la page pose au moins deux îlots", (_nom, ecran) => {
    expect(balises(ecran.chemin).filter((b) => b === "Suspense").length).toBeGreaterThanOrEqual(2);
  });

  it.each(ECRANS_DECOUPES.map((e) => [e.nom, e] as const))("%s : les squelettes d'attente viennent des briques partagées", (_nom, ecran) => {
    // Aucun gabarit réinventé sur place : ce sont les mêmes blocs que les `loading.tsx`
    expect(imports(ecran.chemin)).toContain("@/components/ui/Squelette");
  });

  it.each(ECRANS_DECOUPES.map((e) => [e.nom, e] as const))("%s : reste un écran serveur", (_nom, ecran) => {
    expect(lire(ecran.chemin)).not.toContain('"use client"');
  });
});

describe("le planning ne rend qu'une mise en page", () => {
  it("n'affiche qu'un seul composant de planning", () => {
    const planning = balises(PAGE_PLANNING).filter((b) => b.includes("Grille") || b.includes("Liste"));
    expect(planning).toEqual(["GrillePlanning"]);
  });

  it("ne garde aucune paire d'arbres jumeaux masqués l'un après l'autre", () => {
    // « hidden lg:block » + « lg:hidden » sur deux arbres = deux fois le même contenu dans la page.
    // La règle vaut pour la page **et** pour les trois fichiers qui composent une carte de séance :
    // c'est là que l'ancien tableau répétait l'intitulé de chaque partie.
    for (const chemin of [PAGE_PLANNING, GRILLE, PARTIES, CASE]) {
      expect(lire(chemin), chemin).not.toContain("hidden lg:block");
      expect(lire(chemin), chemin).not.toContain("lg:hidden");
    }
  });

  it("pose les séances les unes sous les autres, une par ligne pleine largeur", () => {
    const code = lire(GRILLE);
    // Choix de Delta après les captures d'un club de quatre-vingts : en deux ou trois colonnes,
    // une séance annulée de 190 px laissait plus de mille pixels de blanc sous elle à côté d'une
    // séance à sept parties, et la largeur d'une colonne tronquait tous les noms de personnes.
    expect(code).toContain("grid grid-cols-1");
    expect(code).not.toContain("lg:grid-cols-2");
    expect(code).not.toContain("xl:grid-cols-3");
  });

  it("n'est plus un tableau : une séance est une carte, pas une ligne à colonnes fixes", () => {
    // Le tableau imposait à toutes les séances les mêmes quatre parties (une colonne vaut pour
    // toute la grille). Il ne doit en rester ni la balise, ni les classes qui la simulaient.
    const code = lire(GRILLE);
    for (const trace of ["<table", "<tbody", "<colgroup", "colSpan", "lg:table-row", "lg:table-cell"]) expect(code, trace).not.toContain(trace);
    expect(balises(GRILLE)).toContain("article");
  });

  it("n'expose plus de mise en page mobile séparée", () => {
    expect(lire(GRILLE)).not.toContain("ListePlanningMobile");
  });

  it("garde une seule case éditable par partie affichée", () => {
    // `CaseEditeur` n'est monté qu'à un seul endroit — la liste des parties d'une séance —, et cette
    // liste sert aussi bien la carte du planning que l'écran d'une séance. Une seconde occurrence
    // signalerait le retour d'un arbre en double.
    expect(balises(PARTIES).filter((b) => b === "CaseEditeur")).toHaveLength(1);
    expect(balises(GRILLE).filter((b) => b === "CaseEditeur")).toHaveLength(0);
  });

  it("l'ancre d'une séance reste posée sur sa carte", () => {
    // C'est la cible du bouton « Programme de la séance » des tuiles (`CarteSeance`) : la déplacer
    // ou la perdre laisse arriver en haut du planning sans rien dire.
    expect(lire(GRILLE)).toContain("id={`seance-${c.id}`}");
  });
});

/**
 * **On arrive au DÉBUT de la tuile visée, pas en son milieu** (Delta, après la v0.53.0 : « ça
 * m'envoie à la bonne date mais au milieu de la tuile, je veux que ça m'amène au début de la tuile
 * correspondante (au niveau de cours 1) »).
 *
 * Le défilement centrait la carte (`block: "center"`). Une tuile de planning est **plus haute
 * qu'une fenêtre** — une partie occupe à elle seule ~320 px sur un écran de 1 280 px, et le modèle
 * d'une séance neuve en compte quatre —, si bien que la centrer revient à la couper en deux : on
 * atterrissait vers « Cours 3 ». Deux choses tiennent la correction, et aucune ne se voit à l'œil
 * d'un relecteur : l'alignement sur le **bord haut**, et la marge de défilement qui, elle, ne sert
 * **que** pour un alignement de bord (en centrage, `scroll-mt` était inerte, alors même que la
 * grille le documente comme ce qui passe sous l'en-tête collant).
 *
 * Rien de tout cela ne se teste au rendu : la suite unitaire tourne en `environment: "node"`, sans
 * DOM ni mise en page. On lit donc la source, comme le fait déjà `liste-deroulante.test.ts` pour le
 * sens d'ouverture d'un menu.
 */
describe("défilement vers la séance visée", () => {
  it("aligne le haut de la carte, et ne la centre jamais", () => {
    // Le `scrollIntoView` lui-même vit dans `repere-visuel.ts` (la bascule Cours/Option montre ses
    // lignes avec la même mécanique) ; ce qui se décide **ici**, c'est l'alignement demandé — et il
    // reste le bord haut.
    const code = lire(ANCRE);
    expect(code).toContain('poserRepere(cible, "start")');
    expect(code).not.toContain('block: "center"');
    expect(lire(REPERE)).toContain("cible.scrollIntoView({ block: defilerVers })");
  });

  it("laisse la marge qui passe sous l'en-tête collant", () => {
    // Sans elle, la date de la séance arrive **sous** la barre du haut et on croit de nouveau être
    // tombé au mauvais endroit : c'est le défaut jumeau de celui qu'on vient de corriger.
    expect(lire(GRILLE)).toMatch(/scroll-mt-\d+/);
  });

  it("garde le repère visuel, posé puis retiré", () => {
    // Le trait et sa durée sont partagés avec la bascule Cours/Option : ce qui se duplique, ce sont
    // les mots, jamais la mécanique. On vérifie donc le module, et que l'ancre l'appelle.
    expect(lire(ANCRE)).toContain("poserRepere(");
    const code = lire(REPERE);
    expect(code).toContain("classList.add(...CLASSES_REPERE)");
    expect(code).toContain("classList.remove(...CLASSES_REPERE)");
    expect(code).toContain("DUREE_REPERE_MS");
    expect(CLASSES_REPERE).toContain("ring-2");
  });

  it("n'impose aucun défilement animé", () => {
    // `prefers-reduced-motion` n'a rien à redire tant qu'on laisse le navigateur décider.
    expect(lire(ANCRE)).not.toContain('behavior: "smooth"');
    // Le mot a le droit d'être **écrit** dans le module : c'est là qu'on explique pourquoi on ne
    // s'en sert pas. Ce qui est interdit, c'est de le passer à l'appel.
    expect(lire(REPERE)).not.toMatch(/scrollIntoView\([^)]*behavior/);
  });
});

describe("témoin d'attente des liens", () => {
  it("s'appuie sur useLinkStatus, dans un composant client minuscule", () => {
    const code = lire(TEMOIN);
    expect(code).toContain('"use client"');
    expect(code).toContain("useLinkStatus");
    expect(imports(TEMOIN)).toEqual(["next/link"]);
  });

  it("ne s'anime qu'en motion-safe", () => {
    const code = lire(TEMOIN);
    expect(code).toContain("motion-safe:animate-spin");
    expect(code.replaceAll("motion-safe:animate-spin", "")).not.toContain("animate-spin");
  });

  it("est posé dans les liens du corps des écrans lents", () => {
    for (const ecran of ECRANS_DECOUPES) {
      // Deux façons de le poser, également valables : la balise `<EnCours />` dans un `<Link>`
      // écrit à la main, ou l'attribut `enCours` d'un `LienBouton` — qui rend exactement ce même
      // composant (voir `src/components/ui/Bouton.tsx`). Ce qui compte est qu'un clic sur un lien
      // de l'écran montre tout de suite qu'il se passe quelque chose, pas la forme du code.
      const code = lire(ecran.chemin);
      const baliseDirecte = imports(ecran.chemin).includes("@/components/layout/EnCours") && balises(ecran.chemin).includes("EnCours");
      expect(baliseDirecte || /\benCours\b/.test(code), ecran.nom).toBe(true);
    }
  });

  it("est proposé par LienBouton sans y être imposé", () => {
    // Un lien de téléchargement n'a pas d'écran à attendre : le témoin reste facultatif
    const code = lire("src/components/ui/Bouton.tsx");
    expect(code).toContain("enCours = false");
    expect(code).toContain("{enCours && <EnCours />}");
  });
});
