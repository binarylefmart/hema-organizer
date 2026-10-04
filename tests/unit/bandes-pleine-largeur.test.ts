import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classeLargeurAdmin, estEcranLarge, palierLargeur } from "@/app/(app)/admin/largeurs";

/**
 * **Un tableau s'élargit, une carte non.** La règle de largeur du projet, et l'histoire de la
 * journée qu'il a fallu pour la formuler juste.
 *
 * Le, sur les captures d'un club de quatre-vingts, Delta demande d'« utiliser tout l'espace du
 * browser » : l'accueil, `/seances`, le planning et la fiche d'une séance débordent de la colonne
 * de lecture jusqu'à 90 rem. Le 30 au soir, captures en main, il tranche l'inverse pour les deux
 * premiers — « pour les tuiles pas besoin de faire la largeur complète si bien agencé », et sur la
 * carte d'un cours : « je n'aime pas la manière dont il est allongé en grand écran ».
 *
 * **Les deux demandes ne se contredisent pas, elles distinguent deux natures de contenu**, et c'est
 * la règle que ce fichier garde désormais :
 *
 *  1. un **tableau** s'élargit — le planning range des noms de personnes en colonnes, la fiche d'une
 *     séance range les cases de son programme ; les tronquer est une perte d'information ;
 *  2. une **carte** ne s'élargit pas — elle empile des phrases courtes, et l'étirer à 1 440 px
 *     n'ajoute aucune information : ça couche une date seule devant 900 px de blanc et pose les
 *     boutons de réponse au bout d'un geste de souris ;
 *  3. quand l'élargissement a lieu, il se pose sur une **page**, jamais sur un morceau de page — le
 *     défaut du 30 au matin, où `ListeSeances` débordait sous un titre et des filtres restés dans la
 *     colonne étroite, soit deux alignements sur le même écran ;
 *  4. un écran qui ne déborde pas occupe l'espace **autrement** : les tuiles de l'accueil se rangent
 *     deux par ligne, sans trou (`Indicateurs`) ;
 *  5. tout cela tient en **une seule mise en page** : aucun arbre jumeau masqué en CSS, le navigateur
 *     range, le serveur ne devine pas la largeur de l'écran.
 *
 * **Le piège que ce retour en arrière a révélé, et qui vaut pour tout le dépôt** : `lg:` mesure la
 * **fenêtre**, pas le conteneur. Une carte redevenue étroite dans une page large garde donc ses
 * découpes en colonnes, et les serre au lieu de les aérer — la carte d'un cours en a fait
 * l'expérience, ses trois boutons de réponse se retrouvant dans une demi-colonne de 22 rem sur un
 * écran de 1 440 px, plus étroits qu'ils ne l'ont jamais été sur téléphone. Une découpe en `lg:`
 * n'est donc légitime que dans un conteneur dont on sait qu'il suit la fenêtre.
 *
 * On lit la source : ces règles sont des classes CSS, elles ne se vérifient pas au rendu sans un
 * navigateur (le reste du dépôt fait pareil, voir `navigation-fluide.test.ts`).
 */

const RACINE = process.cwd();
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");
/** Le code seul : un commentaire a le droit de **citer** ce que le code n'a pas le droit d'employer. */
const sansCommentaires = (code: string) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const GRILLE_PLANNING = "src/components/planning/GrillePlanning.tsx";
const PLEINE_LARGEUR = "src/components/ui/pleine-largeur.ts";
const PAGE_PLANNING = "src/app/(app)/planning/page.tsx";
const INDICATEURS = "src/components/accueil/Indicateurs.tsx";
const FICHES = "src/components/accueil/FichesProchains.tsx";
const CARTE = "src/components/seances/CarteSeance.tsx";
const LISTE = "src/components/seances/ListeSeances.tsx";
const PAGE_ACCUEIL = "src/app/(app)/page.tsx";
const PAGE_SEANCES = "src/app/(app)/seances/page.tsx";
const PAGE_SEANCE = "src/app/(app)/seances/[id]/page.tsx";

/** Tous les fichiers touchés par la décision, du plus haut au plus bas. */
const ECRANS = [PAGE_ACCUEIL, PAGE_SEANCES, PAGE_SEANCE, PAGE_PLANNING, INDICATEURS, FICHES, CARTE, LISTE];

/**
 * **Les deux écrans qui débordent de la colonne de lecture : les deux qui rangent un tableau.**
 *
 * Le planning range une séance par ligne et des noms de personnes en colonnes ; la fiche d'une
 * séance range les cases de son programme, dont `CaseEditeur` tire quatre colonnes de champs. Dans
 * les deux cas, la largeur porte de l'information — la retirer retronque des noms, ce qui est
 * précisément le défaut que l'élargissement de la fiche est venu corriger.
 *
 * **Ce sont des pages, jamais des morceaux de page** : `/seances` l'avait appris le matin même, où
 * l'élargissement vivait dans `ListeSeances`, donc sous un titre et des filtres restés étroits ; le
 * planning à midi, pour la même raison.
 *
 * La liste est close, et **elle s'est raccourcie** : l'accueil et `/seances` en sont sortis le 30 au
 * soir (voir l'en-tête de ce fichier). Un troisième écran qui déborderait se déclarerait ici, et
 * devrait dire quel tableau il range.
 */
const ELARGIS = [PAGE_SEANCE, PAGE_PLANNING];

/**
 * **Les écrans de cartes, qui ne débordent pas — et le test qui les empêche de recommencer.**
 *
 * Sans cette liste, le retour en arrière ne serait qu'une absence de code : la prochaine relecture
 * des captures verrait une page « à aligner sur le planning » et remettrait la constante, sans rien
 * qui dise que ç'a déjà été essayé et refusé.
 *
 * **`/seances` y est resté seul**, et c'est Delta qui l'y maintient : « ça peut être côte à côte
 * pour maximiser l'espace — **sauf pour les séances bien sûr ». Une fiche de séance porte une liste
 * nominative, une jauge et trois réponses : à demi-largeur, une séance annulée de 90 px laisse un
 * demi-écran de blanc à côté d'une séance à sept parties. L'accueil, lui, a pris une troisième
 * forme — ni colonne de lecture ni tableau étiré, mais une **grille de tuiles** (voir le dernier
 * bloc de ce fichier).
 */
const ETROITS = [PAGE_SEANCES];

/** Le contenu de l'attribut `className` d'une balise, repéré par ce qu'elle contient d'unique. */
function classesDe(code: string, marqueur: RegExp): string {
  const balise = code.match(marqueur);
  expect(balise, `balise introuvable : ${marqueur}`).not.toBeNull();
  return balise![1];
}

describe("l'élargissement n'est écrit qu'une fois, et se pose sur des pages", () => {
  /*
   * **La règle n'est plus une chaîne de classes recopiée, c'est une constante**. Tant qu'elle se
   * recopiait, elle pouvait être juste à un endroit et fausse à deux autres sans que rien ne le
   * dise — c'est très exactement ce qui est arrivé : `/seances` réparé le matin, `/planning` laissé
   * de côté, et un message de commit qui donnait le planning pour modèle.
   */
  it("une seule définition, et c'est un fichier à elle", () => {
    expect(lire(PLEINE_LARGEUR)).toMatch(/export const PLEINE_LARGEUR = "lg:relative lg:left-1\/2 lg:w-\[[^\]]+\] lg:-translate-x-1\/2";/);
    // Personne ne réécrit les classes à la main, nulle part.
    for (const f of ECRANS.concat(GRILLE_PLANNING)) expect(lire(f), f).not.toContain("lg:left-1/2");
  });

  it.each(ELARGIS)("%s lit la constante au lieu de recopier ses classes", (fichier) => {
    const code = lire(fichier);
    expect(code).toContain('from "@/components/ui/pleine-largeur"');
    expect(code).toMatch(/\$\{PLEINE_LARGEUR\}/);
  });

  it.each(ELARGIS)("%s ne plafonne pas la largeur ailleurs qu'au plafond commun", (fichier) => {
    // Une bande qui s'étire sans plafond finit illisible ; deux plafonds différents sur le même
    // écran se lisent comme un défaut d'affichage. Le seul `100vw` est celui de la constante.
    expect(lire(fichier)).not.toContain("100vw");
  });

  it("l'élargissement est posé sur la page, pas sur la liste qu'elle contient", () => {
    /*
     * Scénario, onglet « Séances » : `ListeSeances` portait l'élargissement à lui seul. Le titre «
     * Séances », la bascule des trois vues et le volet des filtres restaient donc dans la colonne
     * de lecture pendant que les cartes juste dessous faisaient 90 rem — deux alignements sur la
     * même page, et les deux onglets principaux (Accueil et Séances) qui ne commençaient pas au
     * même endroit. Pire : un filtre sans résultat rend une `Alerte` à la place de la liste, donc
     * **sans** le conteneur élargi, et la largeur du contenu sautait d'un filtre à l'autre.
     * L'accueil fait la seule chose qui tienne : un élargissement, sur l'écran entier.
     */
    // Les deux listes qui l'ont porté à tort, et qui ne doivent plus le porter du tout.
    for (const f of [LISTE, GRILLE_PLANNING]) {
      expect(lire(f), f).not.toContain("100vw");
      // Le commentaire a le droit de **citer** la constante — c'est là qu'il explique où elle est
      // passée. Ce qui est interdit, c'est de l'importer et de s'en servir.
      expect(lire(f), f).not.toMatch(/^import[^;]*pleine-largeur/m);
      expect(lire(f), f).not.toMatch(/\$\{PLEINE_LARGEUR\}/);
    }
    // Une seule fois sur chaque page, écran d'attente compris : les squelettes sont déjà dedans.
    for (const f of ELARGIS) expect(lire(f).match(/\$\{PLEINE_LARGEUR\}/g) ?? [], f).toHaveLength(1);
  });

  it.each(ETROITS)("%s ne déborde pas : c'est un écran de cartes", (fichier) => {
    const code = lire(fichier);
    expect(code, fichier).not.toContain("pleine-largeur");
    expect(code, fichier).not.toMatch(/\$\{PLEINE_LARGEUR\}/);
  });

  it.each(ECRANS)("%s ne fige aucune largeur en pixels", (fichier) => {
    // « Dynamique » se perd au premier `w-[720px]` : c'est la fenêtre qui commande, toujours.
    expect(lire(fichier)).not.toMatch(/\b[wh]-\[\d+px\]/);
  });
});

describe("les tuiles de l'accueil sont des bandes, et elles ne laissent pas de trou", () => {
  const code = lire(INDICATEURS);

  /**
   * **Une colonne au doigt, deux dès qu'il y a la place, et jamais de case vide**.
   *
   * Ce que ce test garde vraiment, c'est le **bouchage du trou en CSS**. Le premier reproche fait à
   * la grille d'avant le 29/09 était une propriété « large » posée à la main sur la tuile
   * surnuméraire : une décision d'affichage prise par l'appelant, donc oubliée un jour sur deux. La
   * variante `last-child:nth-child(odd)` la remplace sans que personne n'ait à compter les tuiles.
   */
  it("range les tuiles en deux colonnes, et la dernière reprend toute la ligne si elle est seule", () => {
    const classes = classesDe(code, /<ul className="([^"]*)">\{tuiles\}<\/ul>/);
    expect(classes).toContain("@xl:grid-cols-2");
    expect(classes).toContain("[&>li:last-child:nth-child(odd)]:@xl:col-span-2");
    // Jamais plus de deux : trois chiffres côte à côte imposent à tous les libellés la largeur de la
    // case la plus étroite, et c'est ce qui avait tué la grille d'origine.
    expect(classes).not.toMatch(/grid-cols-[3-9]/);
    // Et aucune tuile ne porte de propriété « large » : le trou se bouche tout seul.
    expect(code).not.toMatch(/\blarge\??:/);
  });

  it("une tuile tient ses deux bouts : le chiffre et son libellé à gauche, le détail à droite", () => {
    const classes = classesDe(code, /<li\n\s+tabIndex[\s\S]*?className="([^"]*)"/);
    expect(classes).toContain("justify-between");
    // `flex-col` empilerait de nouveau les trois lignes : ce serait la case carrée d'avant.
    expect(classes).not.toContain("flex-col");
  });

  it("n'a plus de tuile « large » : le trou se bouche en CSS, pas à la main", () => {
    expect(code).not.toMatch(/\blarge\??:/);
    // Un seul `col-span-2` dans tout le fichier, et c'est celui de la variante : aucune tuile ne le
    // porte pour elle-même.
    expect(code.match(/col-span-2/g) ?? []).toHaveLength(1);
    expect(code).toContain("[&>li:last-child:nth-child(odd)]:@xl:col-span-2");
  });

  /**
   * **Le palier d'une bande mesure la bande**.
   *
   * `sm:grid-cols-2` coupait la bande en deux dès que la **fenêtre** faisait 640 px — y compris dans
   * la colonne de droite de `DeuxColonnes`, large de 22 rem, où chaque tuile tombait à 170 px et
   * laissait son détail déborder de sa bordure. C'est la même faute que la carte de séance corrigée le
   * 30/09, au même endroit du raisonnement : une découpe en colonnes n'est légitime **que** dans un
   * conteneur dont on sait qu'il suit la fenêtre.
   *
   * Le test porte sur le fichier entier, et pas seulement sur le `ul` : une tuile ou une bulle qui
   * reprendrait un palier de fenêtre pour se découper retomberait dans le même défaut.
   */
  it("et ce palier est celui du conteneur, jamais celui de la fenêtre", () => {
    // **Sans les commentaires** : celui qui explique la correction cite `sm:grid-cols-2`, et un
    // commentaire a le droit de citer ce qu'on interdit (même procédé que `matrice-notifications`).
    const sansCommentaires = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("@container");
    // Aucun palier de **fenêtre** ne commande une découpe en colonnes dans ce fichier. La négation
    // écarte `@xl:` — sans elle, `\b` tombe juste après l'arrobase et le test refuserait la
    // correction qu'il est censé garder (vécu en l'écrivant).
    expect(sansCommentaires).not.toMatch(/(?<![@\w-])(sm|md|lg|xl|2xl):(grid-cols|col-span|flex-row)/);
  });
});

describe("les cours de l'accueil sont empilés, une fiche par ligne", () => {
  const code = lire(FICHES);

  it("la liste des prochains cours n'a plus de seconde colonne", () => {
    expect(classesDe(code, /<ul className="([^"]*)">\n\s+\{seances\.map/)).toContain("flex flex-col");
    expect(code).not.toMatch(/sm:grid-cols-\d/);
  });

  it("l'en-tête d'une fiche tient ses deux bouts, comme une tuile", () => {
    // Sinon une fiche de 1 200 px se lit comme une ligne vide avec une date perdue à gauche.
    expect(code).toContain("flex flex-wrap items-center justify-between");
  });
});

describe("une seule mise en page, quelle que soit la largeur", () => {
  it.each(ECRANS)("%s ne double pas son contenu en deux arbres masqués l'un après l'autre", (fichier) => {
    const code = lire(fichier);
    expect(code, fichier).not.toContain("hidden lg:block");
    expect(code, fichier).not.toContain("lg:hidden");
  });

  it("la carte d'une séance garde un seul jeu de boutons de réponse", () => {
    expect(lire(CARTE).match(/<BoutonsPresence/g) ?? []).toHaveLength(1);
  });

  /**
   * **Une carte ne se découpe pas en colonnes sur une mesure de fenêtre.** `lg:` regarde la
   * fenêtre, pas le conteneur : dans une page qui ne déborde plus, une carte de 44 rem se serait
   * coupée en deux demi-colonnes de 22 rem dès qu'un écran de bureau est en face — des boutons de
   * réponse plus étroits que sur un téléphone. C'est ce qui a vécu une journée,.
   */
  it("la carte d'une séance ne se coupe pas en colonnes selon la fenêtre", () => {
    const code = lire(CARTE);
    expect(code).not.toContain("lg:flex-row");
    expect(code).not.toContain("lg:grid-cols");
    expect(code).not.toContain("lg:flex-1");
  });
});

/**
 * **La troisième forme : deux colonnes, pour les écrans de cartes**.
 *
 * L'histoire a quatre temps, et ce bloc existe pour qu'aucun ne soit défait par erreur :
 *
 * - **29/09** — « utiliser tout l'espace du browser » : l'accueil déborde jusqu'à 90 rem ;
 * - **30/09** — captures en main, l'inverse : « pour les tuiles pas besoin de faire la largeur
 *   complète si bien agencé ». L'accueil revient dans la colonne de lecture ;
 * - **01/10, 18 h** — sur un écran de 3 440 px, cette colonne n'occupe plus que 22 % de la fenêtre.
 *   Première réponse : une **grille** de tuiles. Elle a tenu deux heures ;
 * - **01/10, 22 h** — « ça fait des trous, et pour séance et atelier c'est toujours pareil (comme
 *   tous les autres menus d'ailleurs), fais-moi une proposition ergonomique ». La grille alignait les
 *   blocs en **rangées** : la vignette fait 140 px, la frise qui la côtoie 330 — d'où un trou de la
 *   hauteur de la différence. **Deux colonnes indépendantes** n'ont pas ce défaut : chacune empile à
 *   son rythme, et la seule chose qui dépasse est la plus longue des deux.
 *
 * Ce que ce bloc tient :
 *
 * 1. les trois écrans de cartes lisent `DeuxColonnes` au lieu de recopier des classes — la leçon de
 *    `PLEINE_LARGEUR`, qui a été recopiée dans trois fichiers avant de devenir une constante ;
 * 2. **aucune grille n'y revient** : c'est elle qui creusait les trous ;
 * 3. le palier et le plafond sont **ceux du reste du dépôt** (1 280 px, 90 rem) : une page large ne
 *    s'étire pas, elle se partage, et deux largeurs maximales sur le même écran se lisent comme un
 *    défaut d'affichage ;
 * 4. **ce qui ne se met jamais en colonnes** reste dans la colonne principale : les fiches de cours
 *    (« sauf pour les séances bien sûr ») et les blasons, refusés en demi-largeur le 25/09.
 */
describe("les écrans de cartes se lisent en deux colonnes", () => {
  const COMPOSANT = "src/components/ui/DeuxColonnes.tsx";
  const CARTES = [PAGE_ACCUEIL, PAGE_SEANCES, "src/app/(app)/ateliers/page.tsx"] as const;

  it.each(CARTES)("%s lit le composant au lieu de recopier ses classes", (fichier) => {
    const code = lire(fichier);
    expect(code).toContain('from "@/components/ui/DeuxColonnes"');
    expect(code).toMatch(/<DeuxColonnes/);
    // Ni largeur, ni palier, ni grille écrits à la main : tout est dans le composant.
    expect(code).not.toContain("100vw");
    expect(code).not.toMatch(/\bgrid-cols-/);
    expect(code).not.toContain("xl:w-[");
  });

  it("une seule définition de la largeur et du palier, dans le composant", () => {
    const code = lire(COMPOSANT);
    // Le même palier que le reste du dépôt (1 280 px) et le même plafond (90 rem).
    expect(code).toContain("xl:w-[min(calc(100vw-3rem),90rem)]");
    expect(code).toContain("xl:flex-row");
    // Pas de grille : c'est elle qui alignait les rangées et creusait les trous.
    expect(code).not.toMatch(/\bgrid\b/);
  });

  /**
   * **L'ordre du DOM suit l'écran étroit**, et seul l'affichage large le réarrange : ce que lit un
   * lecteur d'écran et ce que voit l'œil sur un téléphone ne doivent pas diverger. Les filtres d'une
   * liste se lisent avant elle (`ordre="avant"`), un compteur après (`"apres"`, le défaut).
   */
  it("réarrange les colonnes par l'affichage, jamais par l'ordre de la source", () => {
    const code = lire(COMPOSANT);
    expect(code).toContain('xl:order-1');
    expect(code).toContain('xl:order-2');
    // Et la page des séances met bien ses filtres avant la liste sur un téléphone.
    expect(lire(PAGE_SEANCES)).toMatch(/ordre="avant"/);
  });

  it("garde dans la colonne principale ce qui ne se met jamais en colonnes", () => {
    const accueil = lire(PAGE_ACCUEIL);
    // Les fiches de cours et les blasons sont dans `principal`, jamais dans `cote`.
    const principal = accueil.slice(accueil.indexOf("principal={"), accueil.indexOf("cote={"));
    expect(principal).toContain("FichesProchains");
    expect(principal).toContain("BlocProgression");
    const cote = accueil.slice(accueil.indexOf("cote={"));
    expect(cote).not.toContain("FichesProchains");
    expect(cote).not.toContain("BlocProgression");
  });
});

/**
 * **Le quatrième usage de la largeur : un sommaire dans la marge, pour les pages qui sont longues
 * sans être larges**.
 *
 * « Mon profil » et les notifications du club ne sont ni des tableaux (rien à ranger en colonnes) ni
 * des écrans de cartes (aucun bloc à mettre dans une seconde colonne) : ce sont des **piles de
 * réglages** de deux à trois écrans de haut. Leur donner la largeur étirerait les cartes — refusé le
 * 30/09 (« je n'aime pas la manière dont il est allongé en grand écran ») puis le 01/10. La leur
 * refuser laissait 22 % de la fenêtre occupée sur un écran de 3 440 px.
 *
 * Ce que la place gagnée sert à faire, c'est **savoir où l'on est** : le sommaire des sections, qui
 * reste à l'œil pendant qu'on défile. Quatre promesses, et ce bloc les garde :
 *
 * 1. **il ne ment pas** : chaque entrée vise une ancre qui existe, et porte le titre **exact** de sa
 *    section. Un sommaire qui rebaptise ce qu'il annonce fait chercher deux fois ;
 * 2. **rien ne se décale pour lui** : il est posé en absolu dans la **marge**, et la colonne de
 *    lecture reste là où elle est sur toutes les autres pages. La première version élargissait la
 *    page et y recentrait la paire : à 3 440 px, le titre « Notifications » s'est retrouvé 190 px à
 *    gauche de sa propre barre d'onglets, celle-ci vivant dans la mise en page de l'espace admin —
 *    deux alignements sur le même écran, pour la troisième fois en trois jours ;
 * 3. **il ne colle qu'au-delà du palier** : une barre collante sur 390 px recouvre ce qu'elle sert,
 *    défaut mesuré le 01/10 sur l'annuaire (350 px de barre sur un écran de 390) ;
 * 4. **les réglages gardent leur largeur de lecture** : jamais la carte qui s'allonge.
 */
describe("les pages longues portent un sommaire, jamais une seconde colonne de contenu", () => {
  const SOMMAIRE = "src/components/ui/SommaireCollant.tsx";
  const PAGE_PROFIL = "src/app/(app)/profil/page.tsx";
  const PAGE_NOTIFICATIONS = "src/app/(app)/admin/notifications/page.tsx";
  const LONGUES = [PAGE_PROFIL, PAGE_NOTIFICATIONS] as const;

  /**
   * Où une section de la page peut vivre : « Mon profil » en a deux qui sont des composants à part
   * (les notifications d'un appareil, et celles du compte). Une ancre déclarée dans la page doit se
   * retrouver dans **l'une** de ces sources — c'est tout l'intérêt du test, l'`id` et le sommaire ne
   * vivant pas dans le même fichier.
   */
  const SOURCES: Record<string, string[]> = {
    [PAGE_PROFIL]: [PAGE_PROFIL, "src/app/(app)/profil/ActiverPush.tsx", "src/app/(app)/profil/CarteNotifications.tsx"],
    [PAGE_NOTIFICATIONS]: [PAGE_NOTIFICATIONS],
  };

  const entrees = (page: string) =>
    [...lire(page).matchAll(/\{ ancre: "([^"]+)", titre: "([^"]+)" \}/g)].map((m) => ({ ancre: m[1], titre: m[2] }));

  it.each(LONGUES)("%s : chaque entrée vise une ancre qui existe, sous le titre exact de sa section", (page) => {
    // `&apos;` est l'apostrophe que JSX impose dans du texte ; le sommaire, lui, est une chaîne.
    const sources = SOURCES[page].map(lire).join("\n").replace(/&apos;/g, "'");
    const liste = entrees(page);
    expect(liste.length, "le sommaire de cette page n'est pas vide").toBeGreaterThan(3);
    for (const { ancre, titre } of liste) {
      expect(sources, `l'ancre #${ancre} n'existe nulle part`).toContain(`id="${ancre}"`);
      expect(sources, `aucune section ne s'intitule « ${titre} »`).toContain(titre);
    }
  });

  it.each(LONGUES)("%s lit le composant au lieu de recopier des classes", (page) => {
    const code = lire(page);
    expect(code).toContain('from "@/components/ui/SommaireCollant"');
    // La balise, et la liste des sections — les autres propriétés (placement, en-tête) sont libres.
    expect(code).toMatch(/<PageAvecSommaire[\s\S]{0,200}sections=\{sections\}/);
    // Ni largeur, ni palier, ni position : la page ne sait pas où vit son sommaire.
    expect(code).not.toContain("100vw");
    expect(code).not.toContain("max-w-3xl");
    expect(code).not.toContain("absolute");
    expect(code).not.toContain("LARGEUR_PAGE");
  });

  it("ne montre le sommaire qu'une fois la place venue, et il n'y a rien à décaler", () => {
    const code = lire(SOMMAIRE);
    /*
     * **La marge a vécu une demi-journée, et son code est parti avec elle**. Elle supposait qu'il y
     * ait une marge : les deux seuls écrans à sommaire étant devenus larges, un bloc posé en
     * `left-full` dépassait **du document** — 2 024 px pour une fenêtre de 1 920, donc une barre de
     * défilement horizontale sur tout l'écran. La garder « au cas où » aurait été une seconde mise
     * en page qu'aucun écran n'exerce, donc du code mort — et le dépôt vient d'en retirer trois
     * constantes pour cette raison exacte, le même jour.
     */
    expect(sansCommentaires(code), "le commentaire a le droit de raconter la marge, pas le code").not.toContain("left-full");
    expect(sansCommentaires(code)).not.toContain("placement");
    /*
     * **Ce qui colle est l'enfant direct de la boîte haute, sans enveloppe** — le défaut, trouvé
     * une heure après avoir été introduit : une colonne `flex` posée entre les deux devenait le
     * bloc conteneur du `sticky`, et sa hauteur épousait son contenu (676 px dans un `aside` de 2
     * 444). Le sommaire suivait alors le défilement comme n'importe quel bloc.
     *
     * Le test porte donc sur la **forme** qui tient la promesse : les deux placements sont eux-mêmes des
     * colonnes (`flex-col`), et aucune hauteur en pourcentage ne vient compenser une enveloppe — un
     * pourcentage contre un parent `auto` ne résout rien, et sa présence signalerait le retour de
     * l'enveloppe.
     */
    expect(code).not.toMatch(/className="[^"]*\bh-full\b/);
    expect(code).not.toMatch(/className="flex w-80 flex-col/);
    for (const classes of [...code.matchAll(/className="([^"]*2xl:(?:flex|block)[^"]*)"/g)].map((m) => m[1])) {
      expect(classes, "le conteneur du sommaire est lui-même une colonne").toContain("flex-col");
    }
    // Une colonne de 20 rem, qui n'apparaît qu'à 1 536 px — le palier de `PLEINE_LARGEUR_2XL`.
    expect(code).toContain("hidden w-80 shrink-0 flex-col gap-6 2xl:order-2 2xl:flex");
    // La page, elle, n'a aucune largeur à elle : c'est celle de toutes les autres. (Le commentaire
    // du fichier a le droit de citer `max-w-3xl` — c'est la colonne qu'il promet de ne pas bouger.)
    expect(code).not.toMatch(/className="[^"]*max-w-/);
    expect(code).not.toContain("100vw");
  });

  it("le sommaire est une navigation, et c'est ce qui l'autorise à disparaître", () => {
    const code = lire(SOMMAIRE);
    // Un `<nav>` nommé, et des liens d'ancre : rien qui ne soit un raccourci vers la page elle-même.
    expect(code).toMatch(/<nav aria-label="/);
    expect(code).toMatch(/href=\{`#\$\{section\.ancre\}`\}/);
    // Aucune mécanique de défilement : pas de composant client, donc rien à synchroniser.
    expect(code).not.toContain("use client");
    expect(code).not.toContain("IntersectionObserver");
  });

  it("colle sans jamais coller sur un téléphone", () => {
    const code = lire(SOMMAIRE);
    expect(code).toContain("sticky top-20");
    /*
     * Le `sticky` est **à l'intérieur** du bloc qui n'existe qu'à partir de `2xl` : il n'a donc pas
     * besoin de son propre palier, et en porter un serait trompeur. Ce qui est interdit, c'est un
     * `sticky` ailleurs — sur un téléphone, une barre collante recouvre ce qu'elle sert.
     */
    // Une seule **classe** `sticky` dans le fichier — les commentaires ont le droit d'en parler —, et
    // elle vaut pour les deux placements : le sommaire est le même objet, posé à deux endroits.
    expect([...code.matchAll(/className="([^"]*)"/g)].filter((m) => m[1].includes("sticky"))).toHaveLength(1);
    // Et le sommaire n'est rendu que dans des conteneurs ouverts à partir de 1 536 px — les deux
    // placements, et rien d'autre : c'est ce qui l'autorise à ne pas exister sur un téléphone.
    // À droite, et l'ordre de la source reste celui de la lecture : le sommaire annonce la page.
    expect(code).toContain("2xl:order-1");
    expect(code.indexOf("<aside")).toBeLessThan(code.indexOf("{children}"));
  });
});

/**
 * **La grille de tuiles ne revient pas**.
 *
 * Elle a été la première réponse à « adapte les tuiles au mieux dynamiquement à la longueur de la
 * fenêtre », et elle a creusé les trous que Delta a vus le même soir. Ses trois constantes ont été
 * retirées avec elle : du code mort qui dit « voilà comment on élargit une page de tuiles » est une
 * invitation à recreuser le trou — et un `2xl:col-span-full` oublié dans une colonne `flex` ne fait
 * rien du tout, ce qui est pire qu'une erreur visible.
 */
describe("la grille de tuiles ne revient pas", () => {
  const MORTES = ["GRILLE_TUILES", "TUILE_LARGE", "PLEINE_LARGEUR_TUILES"];

  it.each(MORTES)("%s n'est plus exportée", (nom) => {
    expect(lire(PLEINE_LARGEUR)).not.toMatch(new RegExp(`export const ${nom}\\b`));
  });

  it("et personne ne l'importe", () => {
    const fichiers = [...ECRANS, "src/components/accueil/VueAccueil.tsx", "src/components/ui/Alerte.tsx"];
    for (const f of fichiers) {
      const code = lire(f);
      for (const nom of MORTES) {
        // Le commentaire a le droit de **raconter** l'essai ; ce qui est interdit, c'est de s'en servir.
        expect(code, `${f} importe ${nom}`).not.toMatch(new RegExp(`import[^;]*\\b${nom}\\b`));
        expect(code, `${f} se sert de ${nom}`).not.toMatch(new RegExp(`\\$\\{${nom}\\}`));
      }
    }
  });
});

/**
 * **Dans l'espace admin, c'est la mise en page qui élargit — jamais une page**.
 *
 * Deux journaux y rangent un tableau de six colonnes que la colonne de lecture tronque, et le chiffre
 * a été mesuré plutôt que supposé, sur une fenêtre de 1 920 px où 1 150 px de marge restaient vides :
 * le journal d'audit demande 1 081 px et n'en reçoit que 692 — **389 px cachés derrière un défilement
 * horizontal**, dans sa propre carte —, les sessions de connexion 168 px. Lire « qui a fait quoi, et
 * depuis quelle adresse » demandait donc de défiler de côté, ligne par ligne. C'est le cas d'école de
 * la doctrine du dépôt : un tableau s'élargit.
 *
 * **Pourquoi la mise en page et pas la page** : le bandeau d'élévation et la barre d'onglets vivent
 * dans `admin/layout.tsx`, donc dans la colonne de lecture. Une page qui s'élargirait seule les
 * laisserait étroits au-dessus d'elle — deux alignements sur le même écran, défaut vécu trois fois en
 * trois jours, dont une mesure de 190 px le matin même sur `/admin/notifications`. Une page
 * d'administration ne porte donc aucune largeur : elle est dans `ECRANS_LARGES`, ou elle est dans la
 * colonne de lecture.
 */
describe("l'espace admin élargit par sa mise en page, jamais par ses pages", () => {
  const LAYOUT = "src/app/(app)/admin/layout.tsx";
  const LARGEUR = "src/app/(app)/admin/LargeurEspaceAdmin.tsx";
  const REGLE = "src/app/(app)/admin/largeurs.ts";
  const RACINE_ADMIN = "src/app/(app)/admin";

  /** Tous les `page.tsx` de l'espace admin, fiches et sous-écrans compris. */
  function pagesAdmin(dossier = RACINE_ADMIN): string[] {
    return fs.readdirSync(path.join(RACINE, dossier), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? pagesAdmin(`${dossier}/${e.name}`) : e.name === "page.tsx" ? [`${dossier}/${e.name}`] : [],
    );
  }

  /** La route d'un fichier de page, les segments dynamiques remplis d'un identifiant plausible. */
  const routeDe = (fichier: string) =>
    fichier.replace("src/app/(app)", "").replace("/page.tsx", "").replace(/\[[^\]]+\]/g, "cmuqzumur000dqo1mfzecn69p");

  /**
   * **La largeur se décide à chaque navigation, et c'est un composant client qui la lit**. Elle
   * était lue dans le layout — composant serveur **partagé** —, qu'App Router ne re-rend pas d'une
   * page sœur à l'autre : la largeur restait figée sur celle de la page chargée en dur, et la barre
   * d'onglets est le chemin normal pour circuler ici. Un onglet cliqué donnait donc **736 px au
   * journal d'audit** (au lieu de 1 440, avec son tableau qui redéfilait et 1 150 px de marge vide)
   * et **1 440 px à un formulaire** — le contraire de ce que la règle décide. Le nœud porteur a été
   * marqué : il survit à trois clics, il n'est jamais recréé.
   *
   * **Et depuis que les fiches s'élargissent, la décision est une fonction, plus une liste**. La
   * fiche d'une période mesurait 4 646 px de haut : aucune liste de chemins exacts ne peut nommer
   * un identifiant. Une fonction, elle, ne traverse pas la frontière serveur/client — d'où un
   * module pur que le composant client importe lui-même.
   *
   * Ce que ce test garde : la **règle** vit dans son module, avec ses raisons ; la **lecture** est
   * dans le composant client ; et aucune page ne porte de largeur à elle.
   */
  it("la largeur est lue à chaque navigation, et la règle vit dans son module", () => {
    const layout = lire(LAYOUT);
    const enveloppe = lire(LARGEUR);
    const regle = lire(REGLE);
    // Le layout enveloppe, il ne mesure plus et ne décide plus : ni classe, ni liste.
    expect(layout).toContain("<LargeurEspaceAdmin>");
    expect(sansCommentaires(layout)).not.toContain("PLEINE_LARGEUR");
    expect(sansCommentaires(layout)).not.toContain("ECRANS_LARGES");
    // L'enveloppe lit le chemin **courant**, celui que Next réévalue à chaque navigation.
    expect(enveloppe).toContain('"use client"');
    expect(enveloppe).toContain("usePathname()");
    expect(enveloppe.match(/\$\{classeLargeurAdmin\(chemin\)\}/g) ?? []).toHaveLength(1);
    // `usePathname()` rend le chemin sans la requête : plus rien à découper, donc plus rien à oublier.
    expect(enveloppe).not.toContain('split("?")');
    /*
     * Et **rien d'autre** dans ce composant client : le bandeau d'élévation et les onglets lisent la
     * session, qui n'a pas à voyager vers le navigateur pour décider d'une classe CSS.
     */
    expect(enveloppe).not.toContain("sessionForte");
    expect(enveloppe).not.toContain("SousNav");
    /*
     * Le module de la règle est **pur** : pas de React, pas de Prisma, rien qui empêche un test de
     * lui poser directement la question. C'est tout l'intérêt de l'avoir sorti du layout.
     */
    expect(regle).not.toContain('"use client"');
    expect(regle).not.toContain("react");
    expect(regle).not.toContain("@/lib/db");
  });

  it("aucune page d'administration ne porte de largeur à elle", () => {
    const pages = pagesAdmin();
    expect(pages.length, "l'espace admin a des pages").toBeGreaterThan(8);
    for (const f of pages) {
      const code = lire(f);
      expect(code, f).not.toContain("PLEINE_LARGEUR");
      expect(code, f).not.toContain("100vw");
      expect(code, f).not.toContain("lg:left-1/2");
    }
  });

  /**
   * **Chaque écran large porte sa raison écrite, à côté de son nom.** Un ajout dans cette règle se
   * justifie par une mesure — ce qui était tronqué, ou les écrans de défilement économisés —, et la
   * raison vit **au-dessus de la ligne** qui déclare la route. Sans ça, la règle redevient une liste
   * de noms dont personne ne sait pourquoi ils sont là, et le prochain lecteur en ajoute un « par
   * cohérence ».
   */
  it("chaque route déclarée large porte sa raison dans le module", () => {
    const lignes = lire(REGLE).split("\n");
    const declarees = lignes
      .map((l, i) => ({ l: l.trim(), i }))
      .filter(({ l }) => /^"\/admin\/[a-z-]+",$/.test(l));
    expect(declarees.length, "des routes déclarées").toBeGreaterThan(5);
    for (const { l, i } of declarees) {
      /*
       * On remonte par-dessus les routes voisines : deux écrans de même nature partagent leur
       * raison (« Journaux : des colonnes de texte long » couvre l'audit et les sessions), et
       * exiger une phrase par ligne pousserait à recopier la même en deux fois.
       */
      let haut = i - 1;
      while (haut >= 0 && /^"\/admin\/[a-z-]+",$/.test(lignes[haut].trim())) haut -= 1;
      const dessus = lignes[haut]?.trim() ?? "";
      expect(/^(\/\/|\*|\/\*)/.test(dessus), `${l} porte une raison au-dessus de son groupe`).toBe(true);
      const route = l.slice(1, -2);
      expect(fs.existsSync(path.join(RACINE, `src/app/(app)${route}`, "page.tsx")), `${route} existe`).toBe(true);
    }
  });

  /**
   * **Ce qui reste étroit, et pourquoi.** Un **formulaire** ne s'élargit pas : des champs de 1 400 px
   * sont plus durs à parcourir, pas plus faciles — c'est la règle qui a fait retirer `/admin/club` de
   * la première liste du 29/09. La fiche d'un membre et les pages de canal sont dans le même cas.
   * (Ce que le 02/10 a changé, c'est le sort des écrans qui ne sont *pas* des formulaires mais des
   * **suites de cartes** : ceux-là s'élargissent et se rangent en deux piles.)
   */
  it("les formulaires et les fiches de saisie restent dans la colonne de lecture", () => {
    for (const route of [
      "/admin/periodes/nouvelle",
      "/admin/membres/cmuqzumur000dqo1mfzecn69p",
      "/admin/notifications/discord",
      "/admin/notifications/telegram",
      "/admin/activer",
    ]) {
      expect(estEcranLarge(route), `${route} reste étroit`).toBe(false);
    }
  });

  /**
   * **Deux paliers, et le bon pour chacun**. Un tableau profite de la place dès 1 024 px : ses
   * colonnes cessent de plier. Une suite de cartes ne se partage qu'à 1 536 px, celui de
   * `DeuxPiles` — et entre les deux, une page large d'une seule pile donne exactement ce que la
   * doctrine refuse : les zones de texte de « Thèmes et lieux » mesuraient **1 190 px** à 1 280.
   */
  it("élargit à 1 024 px ce qui sait en faire quelque chose, à 1 536 px le reste", () => {
    // Des colonnes à déplier, ou des cartes qui se découpent en interne : la place sert dès 1 024.
    for (const route of [
      "/admin/audit",
      "/admin/sessions",
      "/admin/notifications",
      "/admin/membres",
      "/admin/presences",
      "/admin/periodes",
      "/admin/periodes/cmuqzumur000dqo1mfzecn69p",
      // Club : ses champs courts se rangent en deux colonnes dès 1 280 px (2 152 → 1 851).
      "/admin/identite",
    ]) {
      expect(palierLargeur(route), route).toBe("large");
      expect(classeLargeurAdmin(route), route).toContain("lg:");
    }
    // Des zones de texte et des listes d'étiquettes : rien à en faire avant de tenir deux piles.
    for (const route of ["/admin/themes", "/admin/apropos"]) {
      expect(palierLargeur(route), route).toBe("large2xl");
      expect(classeLargeurAdmin(route), route).toContain("2xl:");
    }
    // Et la colonne de lecture ne pose aucune classe : pas de `max-w` concurrent à celui de la page.
    expect(classeLargeurAdmin("/admin/periodes/nouvelle")).toBe("");
  });

  it("et la règle ne répond large que pour des adresses de l'espace admin", () => {
    for (const route of ["/profil", "/seances", "/planning", "/evenements", "/gestion/ateliers", "/"]) {
      expect(estEcranLarge(route), route).toBe(false);
    }
    // Une fiche de période est large, sa création non : c'est la seule exception qui se croise.
    expect(estEcranLarge("/admin/periodes/cmuqzumur000dqo1mfzecn69p")).toBe(true);
    expect(estEcranLarge("/admin/periodes/nouvelle")).toBe(false);
  });

  /** Toutes les routes de l'espace admin, et le verdict de la règle sur chacune. */
  it("rend un verdict pour chaque page de l'espace admin, sans en oublier", () => {
    const routes = pagesAdmin().map(routeDe);
    expect(routes).toContain("/admin/apropos");
    expect(routes).toContain("/admin/periodes/cmuqzumur000dqo1mfzecn69p");
    for (const route of routes) expect(typeof estEcranLarge(route), route).toBe("boolean");
  });
});

/**
 * **Les fiches de l'espace admin mesurent leur conteneur, pas la fenêtre**.
 *
 * C'est le piège que `CLAUDE.md` nomme en toutes lettres, dans sa forme la plus nette : **plus
 * l'écran était grand, plus les champs étaient étroits.** La fiche d'un membre est un **formulaire**,
 * donc elle reste dans la colonne de lecture (736 px) quand l'annuaire d'où l'on vient fait 1 440 —
 * un formulaire large n'est pas plus facile à remplir. Mais ses découpes internes regardaient la
 * **fenêtre** : sur un écran de 1 920 px, `lg:grid-cols-2` posait deux cartes de 358 px côte à côte
 * dans 736, et `sm:grid-cols-2` y recoupait les champs — « Prénom » et « Nom » à **150 px sur un
 * écran de 1 920 contre 324 px sur un téléphone de 390**. L'`<input>` email tronquait sa propre
 * valeur (52 px cachés) pendant que 1 150 px de marge restaient vides.
 *
 * Mesuré après correction, aux cinq largeurs : prénom 324 px à 390, puis **339 px partout ailleurs**,
 * email 694 px sans rien de caché, aucun débordement de page. La progression est redevenue monotone.
 *
 * Ce que ce test interdit : le retour d'une découpe de **grille** sur une mesure de fenêtre dans ces
 * deux fiches et leurs composants. Les paliers de conteneur (`@md`, `@4xl`…) sont les bienvenus.
 */
describe("les fiches de l'espace admin ne se découpent pas sur la fenêtre", () => {
  /** Les deux dossiers de fiche, et tout ce qu'ils rendent. */
  const FICHES = ["src/app/(app)/admin/membres/[id]", "src/app/(app)/admin/periodes/[id]"];
  /** Une découpe de grille sur une mesure de fenêtre — le `(?<![@\w-])` laisse passer `@md:`. */
  const DECOUPE_FENETRE = /(?<![@\w-])(sm|md|lg|xl|2xl):grid-cols-\d/;

  const fichiers = FICHES.flatMap((dossier) =>
    fs
      .readdirSync(path.join(RACINE, dossier))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `${dossier}/${f}`),
  );

  it.each(fichiers)("%s ne découpe aucune grille sur la largeur de la fenêtre", (fichier) => {
    const code = sansCommentaires(lire(fichier));
    for (const [, classes] of code.matchAll(/className="([^"]*)"/g)) {
      expect(DECOUPE_FENETRE.test(classes), `${fichier} : « ${classes} »`).toBe(false);
    }
    for (const [, classes] of code.matchAll(/className=\{`([^`]*)`\}/g)) {
      expect(DECOUPE_FENETRE.test(classes), `${fichier} : « ${classes} »`).toBe(false);
    }
  });

  it("et chaque fiche déclare bien un conteneur à mesurer", () => {
    for (const dossier of FICHES) {
      for (const f of ["page.tsx", "loading.tsx"]) {
        expect(lire(`${dossier}/${f}`), `${dossier}/${f}`).toContain("@container");
      }
    }
  });
});
