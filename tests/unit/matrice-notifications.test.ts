import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANAUX,
  CANAUX_PAR_NOTIFICATION,
  COUPLES_EMIS,
  RAISON_API_EXCLUE,
  RAISON_ROUTAGE_FIXE,
  TYPES_NOTIFICATION,
  TYPES_ROUTABLES,
  estRoutable,
  figerCanauxIndisponibles,
  preferencesDefaut,
  type Canal,
} from "@/lib/notifications/preferences";
import { raisonSansObjet } from "@/app/(app)/admin/notifications/raisons";

/**
 * **La matrice des notifications est un tableau**.
 *
 * C'étaient huit cartes de trois colonnes — 5 664 px de haut mesurés à 1 920 px, 4 632 px une fois
 * l'écran passé en pleine largeur avec son sommaire. Pour savoir ce qui part sur Telegram, il fallait
 * ouvrir les huit cartes et retrouver la case au même endroit dans chacune. Une ligne par
 * notification, une colonne par canal : 4 135 px, et la réponse se lit **en descendant une colonne**.
 *
 * Ce fichier garde ce qui, dans cette transformation, pouvait se perdre sans bruit. Trois familles :
 *
 * 1. **le contrat serveur** — noms de champs, `id` et classes `cellule-<canal>`. Le formulaire est lu
 *    par `enregistrerNotifications`, et la règle CSS `:has()` qui grise un canal décoché s'accroche à
 *    ces classes : un `id` renommé ne casse rien de visible, il **éteint silencieusement** le
 *    grisage, ou pire, fait arriver au serveur une case qu'il ne reconnaît plus ;
 * 2. **une case ou une raison, jamais les deux, jamais aucune** — les 54 cellules de la matrice, dont
 *    32 cases et 22 « sans objet » ; chacun de ces 22 porte une phrase, et c'est la seule chose qui
 *    distingue un réglage volontairement absent d'un oubli (« un réglage absent sans explication
 *    passe pour un oubli, et quelqu'un finit par l'ajouter ») ;
 * 3. **une seule mise en page** — le même arbre est une pile de fiches au doigt et un vrai tableau
 *    au-delà du palier, jamais deux arbres masqués l'un après l'autre (doctrine du dépôt, cf.
 *    `bandes-pleine-largeur.test.ts`).
 *
 * On lit la source : ce sont des classes CSS et des attributs, ils ne se vérifient pas au rendu sans
 * navigateur (même procédé que le reste du dépôt). La **mesure**, elle, s'est faite au navigateur.
 */

const RACINE = process.cwd();
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");

const DOSSIER = "src/app/(app)/admin/notifications";
const MATRICE = `${DOSSIER}/MatriceNotifications.tsx`;
const PAGE = `${DOSSIER}/page.tsx`;

/** Le code sans ses commentaires : un commentaire a le droit de **citer** ce qu'on interdit. */
const sansCommentaires = (relatif: string) =>
  lire(relatif)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("le contrat serveur ne bouge pas d'un caractère", () => {
  const code = sansCommentaires(MATRICE);

  it("chaque case garde son nom de champ, son id, et la classe dont dépend le grisage", () => {
    expect(code).toContain("name={champNotification(type, canal)}");
    expect(code).toContain("id={`${type}-${canal}`}");
    expect(code).toContain("name={champMode(type)}");
    expect(code).toContain("id={`mode-${type}`}");
    // La classe est sur la cellule de la case **et** sur l'en-tête de sa colonne : un canal décoché
    // grise la colonne entière. Nulle part ailleurs (voir le bloc suivant pour « sans objet »).
    expect(code.match(/cellule-\$\{canal\}/g) ?? []).toHaveLength(2);
    expect(code).toContain("cellule-email");
  });

  it("la règle CSS qui grise un canal décoché vise toujours ces mêmes classes, depuis la page", () => {
    // Les deux morceaux ne vivent pas dans le même fichier : la règle est écrite dans la page, avec
    // les cases des canaux (`#canal-<canal>`), et elle s'applique aux cellules du tableau.
    const page = sansCommentaires(PAGE);
    /*
     * **Et la règle ne vise que les colonnes d'un canal CONFIGURÉ qu'on a décoché** — le
     * `:not(.canal-non-configure)` est la correction (relecture adverse) : un canal non configuré
     * est rendu décoché, donc la règle s'appliquait aussi à lui, `pointer-events: none` comprise.
     * Les quatorze cellules d'un canal non branché perdaient ainsi l'infobulle qui dit **pourquoi**
     * la case est morte et le lien « Configurer » qui est le **remède** — un lien inerte sous une
     * case muette. Première tentative : rendre le lien cliquable en gardant l'opacité sur la
     * cellule ; mais l'opacité composite tout le sous-arbre et ne se rattrape pas depuis un enfant,
     * d'où un lien vivant peint comme un mort (contraste 2,12 : 1, mesuré, pour un texte de 14 px).
     * Un canal non configuré n'est donc plus atténué du tout : il se distingue par « non
     * configuré » dans son en-tête, ses cases `disabled` et son lien à pleine lisibilité.
     */
    expect(page).toContain(
      "`.reglages-notifications:has(#canal-${canal}:not(:checked)) .cellule-${canal}:not(.canal-non-configure)`",
    );
    // Une seule règle, et donc un seul endroit où l'opacité et l'inertie se décident ensemble.
    expect(page.match(/reglages-notifications:has/g) ?? []).toHaveLength(1);
    expect(page).toContain("id={`canal-${canal}`}");
  });

  it("la valeur du serveur repart du serveur après un enregistrement", () => {
    /*
     * La case n'emploie pas la brique `Case` (son `label` est une chaîne, or l'étiquette a trois
     * morceaux qui ne se traitent pas pareil au-delà du palier) : elle doit donc porter elle-même ce
     * que `Case` apportait — la clé de remontage, **sur le contrôle**, calculée depuis la valeur du
     * serveur. Sans elle, un second « Enregistrer » renvoie la valeur du chargement de la page.
     */
    expect(code).toContain("key={cleValeurServeur({ defaultChecked: coche })}");
    // Le mode d'envoi passe par `ChampListe` : non piloté, il suit la valeur du serveur par son
    // miroir (`vuDuServeur`), qui joue pour une liste le rôle de la clé de remontage.
    expect(code).toContain("valeur={prefs.modes[type]}");
  });

  it("la matrice n'est écrite qu'une fois, et elle est partie de la page", () => {
    expect(code.match(/<table/g) ?? []).toHaveLength(1);
    expect(code.match(/champNotification\(/g) ?? []).toHaveLength(1);
    expect(code.match(/<CaseCouple/g) ?? []).toHaveLength(1);
    expect(code.match(/<ChampListe/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/<select[\s>]/);
    // La page ne garde aucun morceau de matrice : deux endroits qui écrivent les mêmes champs, c'est
    // un jour sur deux où l'un des deux est oublié.
    const page = sansCommentaires(PAGE);
    expect(page).not.toContain("champNotification");
    expect(page).not.toContain("champMode");
    expect(page).toContain("<MatriceNotifications prefs={prefs} etats={etats} volume={volume} />");
  });
});

describe("une case ou une raison, jamais les deux, jamais aucune", () => {
  const couples = TYPES_NOTIFICATION.flatMap((type) => CANAUX.map((canal) => ({ type, canal })));
  const avecCase = couples.filter(({ type, canal }) => CANAUX_PAR_NOTIFICATION[type].includes(canal));
  const sansObjet = couples.filter(({ type, canal }) => !CANAUX_PAR_NOTIFICATION[type].includes(canal));

  it("les 54 cellules se partagent en 32 cases et 22 « sans objet »", () => {
    expect(couples).toHaveLength(54);
    expect(avecCase).toHaveLength(32);
    expect(sansObjet).toHaveLength(22);
  });

  it.each(sansObjet.map(({ type, canal }) => [type, canal] as const))("%s × %s dit pourquoi, en une phrase entière", (type, canal) => {
    const raison = raisonSansObjet(type, canal);
    expect(raison.length, raison).toBeGreaterThan(60);
    expect(raison.endsWith("."), raison).toBe(true);
  });

  it("aucune absence de « Site du club » ne retombe sur la phrase de repli", () => {
    /*
     * Le repli de `raisonSansObjet` (« Cette notification ne se republie pas… ») existe pour une
     * notification ajoutée demain sans sa phrase : il dit la règle sans inventer de motif. Mais
     * aujourd'hui, **les cinq exclusions ont chacune la leur** — c'est tout l'objet de
     * `RAISON_API_EXCLUE`, et une phrase générique affichée à la place passerait inaperçue.
     */
    for (const { type } of sansObjet.filter((c) => c.canal === "api")) {
      expect(RAISON_API_EXCLUE[type], `${type} n'a pas sa raison propre`).toBeTruthy();
      expect(raisonSansObjet(type, "api")).toBe(RAISON_API_EXCLUE[type]);
    }
  });

  it("et aucune notification qui A sa case « Site du club » ne porte de raison d'exclusion", () => {
    // Une raison écrite à côté d'une case cochable se lirait comme un refus du serveur.
    for (const { type } of avecCase.filter((c) => c.canal === "api")) {
      expect(RAISON_API_EXCLUE[type], `${type} a une case ET une raison`).toBeUndefined();
    }
  });

  it("les canaux de salon partagent la règle commune, qui nomme les deux cas", () => {
    const raison = raisonSansObjet("atelier_statut", "discord");
    expect(raison).toContain("nomme quelqu'un");
    expect(raison).toContain("bureau");
  });

  it("chaque notification non routable dit pourquoi son email ne part jamais sur la liste", () => {
    // L'écran affiche cette phrase telle quelle : une absente afficherait « undefined » sous la ligne.
    for (const type of TYPES_NOTIFICATION.filter((t) => !estRoutable(t))) {
      expect(RAISON_ROUTAGE_FIXE[type], `${type} n'a pas de raison de routage fixe`).toBeTruthy();
    }
    expect(TYPES_ROUTABLES.every((t) => RAISON_ROUTAGE_FIXE[t] === undefined)).toBe(true);
  });
});

describe("une seule mise en page, quelle que soit la largeur", () => {
  const code = sansCommentaires(MATRICE);

  it("le même arbre est une pile de fiches au doigt et un vrai tableau au-delà du palier", () => {
    // Le patron de `src/components/ui/Tableau.tsx`, au palier de la page (`lg`) et non au sien.
    expect(code).toContain('className="block w-full border-collapse break-words text-left lg:table lg:table-fixed"');
    expect(code).toContain('<thead className="hidden lg:table-header-group">');
    expect(code).toContain('<tr className="block lg:table-row">');
    expect(code).toContain("block lg:table-cell");
    expect(code).toContain("lg:table-row-group");
  });

  it("aucun arbre jumeau masqué en CSS", () => {
    // `hidden lg:table-header-group` est l'en-tête de colonnes, qui n'existe pas sous forme de
    // fiche : ce n'est pas un doublon de contenu, c'est le `thead` de `Tableau`.
    expect(code).not.toContain("lg:hidden");
    expect(code).not.toContain("hidden lg:block");
    expect(code).not.toContain("hidden lg:inline");
  });

  it("un seul palier dans tout le fichier, celui de la page", () => {
    /*
     * `lg:` mesure la **fenêtre**, jamais le conteneur : le palier n'est légitime ici que parce que
     * c'est celui de `PLEINE_LARGEUR`, donc celui où cette page devient large. Un second palier
     * dans le même tableau afficherait des colonnes dans une page encore étroite, ou l'inverse.
     */
    const autres = [...code.matchAll(/\b(sm|md|xl|2xl):/g)].map((m) => m[0]);
    expect(autres, "un seul palier : lg").toEqual([]);
    // Et aucune largeur de page : c'est la mise en page de l'espace admin qui élargit (ECRANS_LARGES).
    expect(code).not.toContain("100vw");
    expect(code).not.toContain("PLEINE_LARGEUR");
  });

  it("le choix « Envoi par email » reste sous la ligne, sur toute la largeur", () => {
    // Essayé en septième colonne : la liste déroulante et sa phrase chiffrée y écrasaient les six
    // colonnes de canaux. La cellule s'étend donc sur la ligne entière, dans le même `tbody`.
    expect(code).toContain("colSpan={CANAUX.length + 1}");
  });
});

describe("accessibilité : la matrice s'annonce comme un tableau", () => {
  const code = sansCommentaires(MATRICE);

  it("un en-tête par colonne, le libellé de la notification en en-tête de ligne, un résumé pour le tableau", () => {
    expect(code.match(/scope="col"/g) ?? []).toHaveLength(2); // la colonne des notifications, et les six canaux (une boucle)
    expect(code.match(/scope="row"/g) ?? []).toHaveLength(1);
    expect(code).toContain('<caption className="sr-only">');
  });

  it("chaque case garde un nom accessible : le libellé se déplace, il ne disparaît pas", () => {
    /*
     * Au-delà du palier, l'en-tête de colonne porte le nom du canal : le libellé visible de la case
     * devient donc `lg:sr-only` — **déplacé, pas supprimé**. `lg:hidden` l'aurait sorti de l'arbre
     * d'accessibilité, et la case se serait annoncée « case à cocher », sans rien d'autre.
     */
    expect(code).toContain('<span className="lg:sr-only">{LIBELLES_CANAUX[canal]}</span>');
    expect(code).toContain("htmlFor={`${type}-${canal}`}");
    // Le renvoi de configuration garde son libellé entier pour qui l'entend lire.
    expect(code).toContain('Configurer <span className="lg:sr-only">{LIBELLES_CANAUX[canal]}</span>');
  });

  it("l'infobulle d'un canal non configuré est portée par l'étiquette, pas par un contrôle désactivé", () => {
    // Un `<input disabled>` n'affiche pas toujours son `title` ; son étiquette, qui occupe la
    // cellule, l'affiche toujours. La phrase du canal ne change pas ; une seconde la suit, pour la
    // case grisée d'un couple que le code n'émet pas encore.
    expect(code).toContain("title={indisponible ? raisonCanalIndisponible(etat) : emis ? undefined : RAISON_NON_EMIS}");
    expect(code).toContain("disabled={figee}");
  });

  it("les cibles tactiles restent celles du dépôt", () => {
    // 48 px pour la case (`min-h-12`), 44 px pour le renvoi (`min-h-11`) : au doigt seulement, la
    // cellule n'ayant plus qu'une case à centrer au-delà du palier.
    expect(code).toContain("flex min-h-12 cursor-pointer");
    expect(code).toContain("inline-flex min-h-11 items-center");
  });
});

describe("la page garde ce qui n'est pas la matrice", () => {
  const page = sansCommentaires(PAGE);

  it("l'ancre du sommaire, les canaux et le bloc « toujours envoyées » n'ont pas bougé", () => {
    expect(page).toContain('<Carte id="canaux" titre="Canaux et notifications">');
    expect(page).toContain("NOTIFICATIONS_TOUJOURS_ENVOYEES.map");
    expect(page).toContain("toujours envoyées");
    // La phrase qui promet qu'un canal non configuré n'est ni coché ni vidé (cf. canal-site-du-club).
    expect(page).toMatch(/ni être coché ni être vidé ici/);
  });

  it("le sommaire devient une colonne, puisque la page est large et n'a plus de marge", () => {
    /*
     * Mesuré avant la correction, à 1 920 px : `scrollWidth` 2 024 px. Le sommaire était posé en
     * absolu dans la marge (`left-full`), or cet écran est entré dans `ECRANS_LARGES` — il n'a plus
     * de marge, et la navigation dépassait du document, avec une barre de défilement horizontale sur
     * toute la page pour la porter.
     */
    /*
     * **Et le placement « marge » a été retiré le même jour** : plus aucun écran ne l'employait — les
     * deux seules pages à sommaire sont larges —, et un second jeu de classes qu'aucun écran n'exerce
     * est du code mort. `PageAvecSommaire` n'a donc plus qu'une géométrie, et plus de propriété à
     * passer.
     */
    expect(page).toMatch(/<PageAvecSommaire sections=\{sections\}>/);
    expect(page).not.toContain("placement");
    expect(page).toContain("sections={sections}");
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * La forme de la cellule remplace les deux mots qui s'y écrivaient
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

describe("deux formes de cellule, aucun vocabulaire à apprendre", () => {
  const code = sansCommentaires(MATRICE);

  /**
   * . Les deux mots demandaient d'apprendre un vocabulaire avant de lire une grille de 54
   * cellules ; la forme de la cellule porte la même information.
   */
  it("ni « prévu » ni « sans objet » ne s'écrivent plus dans la matrice", () => {
    expect(code).not.toContain("prévu");
    expect(code).not.toContain("sans objet");
  });

  it("la cellule d'un couple qui n'existe pas est vide, et absente de la fiche au doigt", () => {
    // `hidden lg:table-cell` : au-delà du palier c'est une colonne de tableau, le vide y est
    // l'information ; sous le palier, une cellule vide ne laisserait qu'un blanc à lire.
    expect(code).toContain('className="hidden lg:table-cell lg:px-2 lg:py-3 lg:text-center lg:align-middle"');
    // La raison reste, en infobulle : elle explique, elle n'est plus à décoder.
    expect(code).toContain("title={raisonSansObjet(type, canal)}");
  });

  it("la case d'un couple que le code n'émet pas est grisée, canal branché ou non", () => {
    expect(code).toContain("const emis = COUPLES_EMIS[type].includes(canal);");
    expect(code).toContain("const figee = indisponible || !emis;");
    expect(code).toContain("disabled={figee}");
  });

  it("et le serveur fige ces couples, dans les deux sens", () => {
    /*
     * Une case grisée est **absente** du formulaire, donc lue « décochée ». Sans ce verrou, brancher
     * un jour le service WhatsApp sans écrire l'envoi correspondant effacerait ses cases au premier
     * enregistrement ; et une case grisée cochée de force par un client bricolé n'allume rien.
     *
     * Le couple d'essai se **déduit** de `COUPLES_EMIS` au lieu d'être nommé : le jour où WhatsApp
     * reçoit son envoi, ce test suit tout seul au lieu de garder une règle périmée.
     */
    const nonEmis = TYPES_NOTIFICATION.flatMap((type) =>
      CANAUX.filter((canal) => CANAUX_PAR_NOTIFICATION[type].includes(canal) && !COUPLES_EMIS[type].includes(canal)).map((canal) => ({ type, canal })),
    );
    expect(nonEmis.length, "plus aucun couple non émis : ce test n'a plus d'objet").toBeGreaterThan(0);
    const tousOperationnels = Object.fromEntries(CANAUX.map((c) => [c, true])) as Record<Canal, boolean>;

    for (const { type, canal } of nonEmis) {
      const avant = preferencesDefaut();
      avant.notifications[type][canal] = true;
      const apres = preferencesDefaut(); // le formulaire revient sans la case grisée
      const { prefs } = figerCanauxIndisponibles(avant, apres, tousOperationnels);
      expect(prefs.notifications[type][canal], `${type} × ${canal} effacé par l'enregistrement`).toBe(true);

      const force = preferencesDefaut();
      force.notifications[type][canal] = true;
      const { prefs: apresForcage } = figerCanauxIndisponibles(preferencesDefaut(), force, tousOperationnels);
      expect(apresForcage.notifications[type][canal], `${type} × ${canal} allumé par un client bricolé`).toBe(false);
    }
  });
});
