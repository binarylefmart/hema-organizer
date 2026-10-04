import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { etatDuLien, type LigneEtatLien } from "@/app/(app)/admin/membres/etat-lien";

/**
 * **L'annuaire est un tableau, et l'état du lien en est une colonne**.
 *
 * Mesuré avant d'y toucher, sur une fenêtre de 1 920 px et le club de démonstration : la page
 * faisait **2 565 px** de haut pour douze personnes, dont **1 056 px de liste** — chaque personne
 * occupait deux lignes (son nom avec ses pastilles, puis son adresse) et son bouton « Gérer » se
 * retrouvait seul à 1 000 px du nom qu'il concerne. Et surtout : savoir **qui n'avait jamais ouvert
 * son lien** demandait d'ouvrir les douze volets, un par un, parce que l'information vivait à trois
 * endroits (une pastille conditionnelle, une phrase dans le volet, et rien du tout pour qui n'a pas
 * d'adresse).
 *
 * Après : **719 px de liste**, 57 px par personne, et une colonne qu'on balaie. Ce que ce fichier
 * protège, ce n'est pas la mise en page — elle bougera — mais les quatre décisions qui, défaites
 * sans y penser, ramèneraient l'écran d'avant ou en casseraient un autre :
 *
 * 1. **un seul arbre, deux affichages** — le `Tableau` du dépôt, jamais une liste dupliquée puis
 *    masquée en CSS ;
 * 2. **le palier du vrai tableau suit la largeur de la page** (1 024 px), il ne la précède pas ;
 * 3. **le comportement par défaut de `Tableau` ne bouge pas d'un pixel** : cinq autres écrans en
 *    vivent, et aucun ne passe de palier ;
 * 4. **la colonne dit la même chose que le bouton de la même ligne** — d'où une règle pure, testée
 *    sur ses six états, plutôt qu'une suite de ternaires dans le JSX.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

/**
 * La source **sans ses commentaires**. Comme ailleurs dans le dépôt : un commentaire a le droit de
 * raconter ce qu'on a retiré (« plus de coupe par trois points »), ce qui est interdit c'est de s'en
 * servir. Un `toContain` ne fait pas la différence ; cette fonction, oui.
 */
const nu = (f: string) =>
  source(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const ANNUAIRE = "src/app/(app)/admin/membres/page.tsx";
const TABLEAU = "src/components/ui/Tableau.tsx";

/** Une ligne « tout va bien » : compte actif, adresse connue, lien déjà ouvert et encore valable. */
const ligne = (p: Partial<LigneEtatLien> = {}): LigneEtatLien => ({
  actif: true,
  aUnEmail: true,
  aUnMotDePasse: false,
  dejaOuvert: true,
  lienEnCours: true,
  lienEnvoye: true,
  periodeDeLien: true,
  ...p,
});

describe("l'état du lien, en un mot et un ton", () => {
  it("dit « Jamais ouvert », et c'est le seul état qui porte une couleur", () => {
    const etat = etatDuLien(ligne({ dejaOuvert: false }));
    expect(etat.libelle).toBe("Jamais ouvert");
    // L'ocre est ce qu'on vient chercher en balayant la colonne : personne n'est jamais entré.
    expect(etat.ton).toBe("ocre");
    expect(etat.detail).toContain("jamais");
  });

  it("ne crie pas quand la personne a un mot de passe : son lien dormant n'est pas un problème", () => {
    // Exactement la condition de l'ancienne pastille (`!m.passwordHash && jamaisOuvert && m.actif`) :
    // avec un mot de passe, on entre par la page de connexion, le lien n'a jamais eu à servir.
    const etat = etatDuLien(ligne({ dejaOuvert: false, aUnMotDePasse: true }));
    expect(etat.libelle).toBe("Jamais ouvert");
    expect(etat.ton).toBe("neutre");
  });

  it("un compte désactivé parle de son accès coupé, et pas de son lien", () => {
    // La question du lien ne se pose plus : la désactivation l'a révoqué. Dire « jamais ouvert »
    // accuserait quelqu'un à qui on a fermé la porte.
    for (const autre of [{ dejaOuvert: false }, { aUnEmail: false }, { lienEnCours: false }]) {
      expect(etatDuLien(ligne({ actif: false, ...autre })).libelle).toBe("Sans accès");
    }
  });

  it("sans adresse, la colonne dit l'empêchement — pas un état d'attente", () => {
    const etat = etatDuLien(ligne({ aUnEmail: false, dejaOuvert: false }));
    expect(etat.libelle).toBe("Sans adresse");
    expect(etat.ton).toBe("neutre");
    // La même phrase que le reste de l'écran promet déjà : l'équipe coche sa présence à sa place.
    expect(etat.detail).toContain("coche sa présence à sa place");
  });

  it("distingue « lien en cours » de « aucun lien en cours »", () => {
    expect(etatDuLien(ligne()).libelle).toBe("Lien en cours");
    expect(etatDuLien(ligne({ lienEnCours: false })).libelle).toBe("Aucun lien en cours");
  });

  it("n'invente aucun manque quand aucune période n'envoie de lien", () => {
    // Sans période vers laquelle envoyer, `lienEnCours` vaut faux pour tout le monde : écrire
    // « Aucun lien en cours » sur douze lignes désignerait un problème qui n'existe pas.
    expect(etatDuLien(ligne({ periodeDeLien: false, lienEnCours: false })).libelle).toBe("Déjà ouvert");
    expect(etatDuLien(ligne({ periodeDeLien: false, lienEnCours: true })).libelle).toBe("Déjà ouvert");
  });

  it("porte toujours une phrase entière : le mot court ne dit pas tout", () => {
    for (const cas of [{}, { dejaOuvert: false }, { actif: false }, { aUnEmail: false }, { lienEnCours: false }, { periodeDeLien: false }]) {
      const etat = etatDuLien(ligne(cas));
      expect(etat.detail.length, JSON.stringify(cas)).toBeGreaterThan(30);
      expect(etat.detail.endsWith("."), etat.detail).toBe(true);
    }
  });
});

describe("l'annuaire range un tableau, sans second arbre", () => {
  it("prend le `Tableau` du dépôt et ses cinq colonnes", () => {
    const code = source(ANNUAIRE);
    expect(code).toContain('from "@/components/ui/Tableau"');
    // Les cinq colonnes, dans l'ordre : case, nom, email, état du lien, gestes.
    expect(code).toMatch(/entetes=\{\[[\s\S]{0,600}Sélection[\s\S]{0,400}"Nom",[\s\S]{0,200}"Email",[\s\S]{0,200}"État du lien",[\s\S]{0,400}Actions/);
  });

  it("ne duplique aucune liste : pas de second arbre caché en CSS", () => {
    const code = source(ANNUAIRE);
    // La pile de fiches **est** le tableau (`Tableau` s'en charge) : aucune liste `<ul>` de membres
    // ne subsiste à côté, et rien n'est masqué par paliers.
    expect(code).not.toMatch(/<ul[^>]*>[\s\S]{0,200}membres\.map/);
    expect(code).not.toMatch(/lg:hidden[\s\S]{0,80}membres\.map/);
    expect(code).not.toMatch(/hidden lg:block[\s\S]{0,80}membres\.map/);
    // Une seule boucle de lignes : deux, ce serait deux arbres.
    expect(code.match(/membres\.map\(\(m, rang\)/g) ?? []).toHaveLength(1);
  });

  it("déplie le tableau au pixel où la page s'élargit, et pas avant", () => {
    const code = source(ANNUAIRE);
    // `PLEINE_LARGEUR` élargit la page à partir de 1 024 px : le tableau attend le même seuil.
    expect(code).toMatch(/const PALIER_TABLEAU: PalierTableau = "lg"/);
    // Et le palier est passé au composant, pas réécrit en classes sur place.
    expect(code).toContain("palier={PALIER_TABLEAU}");
    // La page, elle, ne porte toujours aucune largeur : c'est la mise en page qui élargit.
    expect(code).not.toContain("PLEINE_LARGEUR");
  });

  it("garde une personne par fiche sur téléphone : trois lignes, et la case collée au nom", () => {
    const code = source(ANNUAIRE);
    // En mode fiche, `Tableau` empile ses cellules : cinq cellules feraient cinq lignes (mesuré :
    // +1 092 px sur la page de 390 px). La grille remet la case et le nom sur la même ligne, avec
    // « Gérer » au bout, puis l'adresse, puis l'état du lien.
    expect(code).toMatch(/grid grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
    expect(code).toContain('className="col-start-1 row-start-1"'); // la case
    expect(code).toMatch(/col-start-3 row-start-1/); // « Gérer », au bout de la première ligne
    expect(code).toMatch(/col-span-3 col-start-1 row-start-2/); // l'adresse, pleine largeur
    expect(code).toMatch(/col-span-3 col-start-1 row-start-3/); // l'état du lien, pleine largeur
  });

  it("ne tronque plus ni le nom ni l'adresse", () => {
    const code = source(ANNUAIRE);
    // Le nom et l'adresse ont chacun leur colonne : un nom coupé par trois points est une
    // information perdue, et une adresse tronquée ne se recopie pas.
    expect(nu(ANNUAIRE)).not.toContain("truncate");
    expect(code).toContain("break-all");
  });

  it("confie l'état du lien à la règle partagée, jamais à des ternaires dans le JSX", () => {
    const code = source(ANNUAIRE);
    expect(code).toContain('from "./etat-lien"');
    expect(code).toMatch(/etatDuLien\(\{[\s\S]{0,400}aUnMotDePasse: Boolean\(m\.passwordHash\)/);
    // Et l'information n'est plus répétée ailleurs : ni pastille à côté du nom, ni phrase du volet.
    expect(nu(ANNUAIRE)).not.toContain("lien jamais ouvert");
    expect(code).not.toMatch(/lienEnCours \? "lien en cours"/);
  });

  it("laisse le repère alphabétique et le pied de liste tenir toute la ligne", () => {
    const code = source(ANNUAIRE);
    // Ni l'un ni l'autre n'est une personne : une cellule, toutes les colonnes.
    expect(code.match(/colSpan=\{5\}/g) ?? []).toHaveLength(2);
    expect(code).toContain("LIGNES_VISIBLES");
  });
});

/**
 * **Le palier de `Tableau` est un ajout : qui ne l'a pas demandé n'a rien senti.**
 *
 * Il est né pour l'annuaire, qui se déplie au pixel où sa page s'élargit. Deux écrans l'ont demandé
 * depuis, chacun sur une mesure, et c'est la seule façon d'entrer dans cette liste :
 *
 * - **l'annuaire** : 2 565 px de haut en pile de fiches, 719 px en tableau ;
 * - **les comptes admin** : déplié à 768 px dans une colonne de 736, son tableau de six colonnes
 * donnait **103 px à l'email** et déchirait `contact@club.test` sur quatre lignes,
 * d'où des lignes de 149 px de haut ;
 * - **la liste des périodes** : elle se dépliait à 768 px, **dans une colonne de lecture de 736** —
 * mesuré à 900 px de fenêtre, la colonne « Période » tombait à **89 px** et « Rentrée 2026 » se
 * pliait sur deux lignes, pendant que 164 px de marge restaient vides à droite. Sa page ne
 * s'élargissant qu'à 1 024 px, le tableau l'attend désormais.
 *
 * **Ce qui n'entre pas dans la liste, et ce n'est pas un oubli** : le journal d'audit, les sessions et
 * les événements de l'espace instructeur gardent le défaut `md`. Leurs tableaux défilent dans leur
 * carte entre 768 et 1 023 px (`md:overflow-x-auto`), ce que le palier `lg` ne sait pas faire — il
 * n'a pas de défilement intérieur, et une largeur minimale y déborderait la page. Leur comportement
 * d'avant est donc le bon, et ce fichier garde qu'il n'a pas bougé.
 */
describe("le palier de `Tableau` est un ajout : qui ne l'a pas demandé n'a rien senti", () => {
  const AUTRES = [
    "src/app/(app)/admin/audit/page.tsx",
    "src/app/(app)/admin/sessions/page.tsx",
    "src/app/(app)/gestion/evenements/page.tsx",
  ];
  /** Les écrans qui ont demandé `lg`, et la page qui doit s'élargir au même pixel. */
  const DEMANDEURS = [
    "src/app/(app)/admin/membres/page.tsx",
    "src/app/(app)/admin/periodes/page.tsx",
    "src/app/(app)/admin/comptes/page.tsx",
  ];

  it("le défaut reste `md`, dans les trois composants", () => {
    const code = source(TABLEAU);
    expect(code.match(/palier = "md"/g) ?? [], "Tableau, Ligne et Cellule").toHaveLength(3);
  });

  it("et les classes du défaut sont exactement celles d'avant", () => {
    const code = source(TABLEAU);
    // Les huit chaînes du palier `md` : si l'une bouge, cinq écrans bougent avec elle.
    for (const classe of [
      "md:overflow-x-auto",
      "md:table md:min-w-[32.5rem]",
      "md:table-header-group",
      "md:table-row-group",
      "md:table-row md:p-0",
      "md:table-cell md:py-2.5 md:align-middle",
      "md:hidden",
      "md:contents",
    ]) {
      expect(code, classe).toContain(`"${classe}"`);
    }
    // Les classes sont écrites en entier, jamais composées : Tailwind lit la source, une classe
    // fabriquée (`${palier}:table`) n'existerait pas dans le CSS engendré.
    expect(nu(TABLEAU)).not.toMatch(/\$\{palier\}/);
  });

  it("les deux écrans qui l'ont demandé le passent au composant, pas en classes sur place", () => {
    for (const f of DEMANDEURS) {
      const code = source(f);
      expect(code, f).toMatch(/const PALIER_TABLEAU: PalierTableau = "lg"/);
      expect(code, f).toContain("palier={PALIER_TABLEAU}");
      // Et la page elle-même ne porte aucune largeur : c'est la mise en page qui élargit.
      expect(code, f).not.toContain("PLEINE_LARGEUR");
    }
  });

  it("aucun des autres écrans ne passe de palier", () => {
    for (const f of AUTRES) {
      const code = source(f);
      expect(code, f).toContain("Tableau");
      expect(nu(f), f).not.toContain("palier");
    }
  });

  it("le palier `lg` se passe du défilement intérieur, et c'est volontaire", () => {
    const code = source(TABLEAU);
    // `overflow-x: auto` emporte l'axe vertical : il découperait la bulle du volet « Gérer »,
    // ancrée sous le bouton d'une ligne — le seul geste de la ligne. Et il n'a rien à protéger, le
    // palier `lg` ne se déclenchant que dans une page large (976 px au minimum).
    expect(code).toMatch(/lg: \{\s*cadre: "",/);
    expect(code).not.toContain("lg:overflow-x-auto");
    expect(code).not.toContain("lg:min-w-");
  });
});

/**
 * **Ce que la colonne « État du lien » disait de faux, et que la relecture adverse a mesuré le jour
 * de sa naissance.** Deux défauts, et la même racine : la colonne a promu en **affirmation** des
 * données qui ne servaient jusque-là qu'à choisir le verbe d'un bouton.
 *
 * 1. **« Lien en cours » pour un lien échu.** L'agrégat des invitations de la page ne filtrait que la
 *    révocation, jamais `expiresAt` : un lien mort depuis cinq mois comptait comme valable. L'annuaire
 *    rangeait donc en gris, parmi les gens qui vont bien, quelqu'un que `checkInvitation` refuse — et
 *    la colonne existe précisément pour repérer qui n'arrive pas à entrer. Les liens vivant quatre
 *    mois, le cas tombe à chaque charnière de trimestre, sur plusieurs personnes à la fois.
 * 2. **« Jamais ouvert », en ocre, pour quelqu'un à qui on n'a jamais rien envoyé.** La phrase parlait
 *    de « son lien personnel » alors qu'il n'y en avait aucun, et surtout : le seul état coloré
 *    confondait deux situations qui demandent deux gestes **opposés** — appeler la personne, ou
 *    cliquer sur « Envoyer ».
 *
 * D'où la règle du ton, écrite dans l'en-tête du module : **l'ocre dit « cette personne ne peut pas
 * entrer aujourd'hui »**, et rien d'autre ne l'est. Ces tests la gardent dans ses trois formes.
 */
describe("l'état du lien ne dit que ce qui est vrai (relecture du 02/10)", () => {
  it("distingue « aucun lien envoyé » de « jamais ouvert »", () => {
    const jamaisEnvoye = etatDuLien(ligne({ dejaOuvert: false, lienEnCours: false, lienEnvoye: false }));
    expect(jamaisEnvoye.libelle).toBe("Aucun lien envoyé");
    expect(jamaisEnvoye.ton).toBe("ocre");
    expect(jamaisEnvoye.detail).toContain("Envoyer le lien");
    // Et la phrase ne parle pas d'un lien qui n'existe pas.
    expect(jamaisEnvoye.detail).not.toContain("n'a jamais été ouvert");

    const envoyeJamaisOuvert = etatDuLien(ligne({ dejaOuvert: false, lienEnCours: true, lienEnvoye: true }));
    expect(envoyeJamaisOuvert.libelle).toBe("Jamais ouvert");
    expect(envoyeJamaisOuvert.ton).toBe("ocre");
    expect(envoyeJamaisOuvert.detail).toContain("lui a été envoyé");
  });

  it("colore « aucun lien en cours » : un lien échu ou révoqué, c'est quelqu'un qui ne peut plus entrer", () => {
    const echu = etatDuLien(ligne({ dejaOuvert: true, lienEnCours: false, lienEnvoye: true }));
    expect(echu.libelle).toBe("Aucun lien en cours");
    expect(echu.ton).toBe("ocre");
    expect(echu.detail).toContain("plus valable");
  });

  /** Un mot de passe, et la personne entre : la colonne cesse d'alerter, dans les trois cas. */
  it.each([
    ["aucun lien envoyé", { dejaOuvert: false, lienEnCours: false, lienEnvoye: false }],
    ["jamais ouvert", { dejaOuvert: false, lienEnCours: true, lienEnvoye: true }],
    ["aucun lien en cours", { dejaOuvert: true, lienEnCours: false, lienEnvoye: true }],
  ])("redevient neutre avec un mot de passe : %s", (_cas, etat) => {
    const avec = etatDuLien(ligne({ ...(etat as Partial<LigneEtatLien>), aUnMotDePasse: true }));
    expect(avec.ton).toBe("neutre");
    expect(avec.detail).toContain("mot de passe");
  });

  it("n'invente pas un manque quand aucune période n'envoie de lien", () => {
    const sansPeriode = etatDuLien(ligne({ dejaOuvert: false, lienEnCours: false, lienEnvoye: false, periodeDeLien: false }));
    expect(sansPeriode.libelle).toBe("Jamais ouvert");
  });

  /**
   * **L'ocre a une règle, et elle se vérifie par balayage** : il ne dit rien d'autre que « cette
   * personne ne peut pas entrer aujourd'hui ». Un compte désactivé (décision du bureau) et un compte
   * sans adresse (empêchement, pas incident) restent donc neutres — c'est écrit dans le module.
   */
  it("ne colore que ce qui empêche d'entrer", () => {
    for (const neutre of [
      ligne({ actif: false }),
      ligne({ aUnEmail: false }),
      ligne(),
      ligne({ periodeDeLien: false }),
    ]) {
      expect(etatDuLien(neutre).ton, etatDuLien(neutre).libelle).toBe("neutre");
    }
  });

  /**
   * **La requête de la page filtre l'échéance** — c'est la correction du premier défaut, et elle vit
   * dans la page, pas dans le module pur : le test la lit donc à la source. Sans elle, le module
   * recevrait `lienEnCours: true` pour un lien mort et dirait la vérité sur une donnée fausse.
   */
  it("la page ne compte comme « en cours » qu'un lien ni révoqué ni échu", () => {
    const code = nu(ANNUAIRE);
    expect(code).toContain("revokedAt: null, expiresAt: { gt: maintenant }");
    // Et le troisième agrégat, celui qui distingue « aucun lien » de « jamais ouvert ».
    expect(code).toMatch(/liensDeLaPeriode/);
    expect(code).toMatch(/lienEnvoye: aRecuUnLien\.has\(m\.id\)/);
  });

  /**
   * **La case à cocher suit `reglable`**, qui refuse sa propre ligne — le lot porte aussi la
   * désactivation et la suppression. Le commentaire du dépôt l'annonçait depuis le 01/10 et le code
   * rendait la case (`roleReglable`) : inatteignable aujourd'hui, mais le jour où un second
   * administrateur se donne un mot de passe, sa ligne recevait une case que `lotCoche` filtre
   * ensuite, donc un lot **silencieusement raccourci**.
   */
  it("la case à cocher d'une ligne n'est pas celle du rôle", () => {
    expect(nu(ANNUAIRE)).toMatch(/\{reglable\(m\) && <CaseMembre/);
  });
});
