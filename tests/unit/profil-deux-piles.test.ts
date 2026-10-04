import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lignesEtatCompte, PASTILLE_LIEN, precisionLien, TITRE_APPAREILS_NOTIFIES } from "@/app/(app)/profil/etat-compte";
import type { EtatLienPersonnel } from "@/lib/invitations";

/**
 * **« Mon profil » en deux piles, et l'état du compte dans la colonne du sommaire**.
 *
 * La page faisait **3 377 px de haut** mesurés à 1 920 px — sept cartes de réglages en une seule
 * colonne de 736 px — avec la moitié droite de la fenêtre vide. Elle se partage désormais en deux
 * **piles indépendantes** à partir de 1 536 px (2 580 px de haut, mesurés au même endroit), et la
 * colonne du sommaire porte en plus un **état du compte**.
 *
 * Ce fichier garde les quatre promesses de cette demande, et c'est le genre de promesses qu'une
 * relecture humaine ne revoit jamais deux fois :
 *
 * 1. **sous 1 536 px, l'écran est celui d'hier** : une seule pile, dans le **même ordre**. C'est ce
 *    qui a dicté le découpage — voir le test « une coupure, jamais un tri » plus bas ;
 * 2. **deux piles, jamais une grille** : une grille aligne ses blocs en rangées et laisse un trou
 *    de la hauteur de la différence entre deux voisins ;
 * 3. **la largeur est posée sur la page**, jamais sur un morceau de page — sinon le titre et les
 *    alertes restent étroits au-dessus d'un contenu large (défaut vécu trois fois en trois jours) ;
 * 4. **l'état du compte ne dit rien que la page ne dise**, il le dit d'un coup d'œil — donc il a le
 *    droit de disparaître avec le sommaire en dessous du palier, et **aucune ancre** ne le vise.
 *
 * Les deux premiers tests lisent la **source** : ce sont des classes CSS et un ordre de rendu, qui ne
 * se vérifient pas sans navigateur (même parti que `bandes-pleine-largeur.test.ts` et
 * `navigation-fluide.test.ts`). Le reste éprouve `etat-compte.ts`, qui est un module pur.
 */

const RACINE = process.cwd();
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");

const PAGE = "src/app/(app)/profil/page.tsx";
const PILES = "src/components/ui/DeuxPiles.tsx";
const CARTE_ETAT = "src/app/(app)/profil/CarteEtatCompte.tsx";

describe("la page se partage en deux piles, et seulement au-delà du palier", () => {
  it("pose la largeur sur la page, avec la constante du dépôt et à aucun autre endroit", () => {
    const page = lire(PAGE);
    expect(page).toContain('import { PLEINE_LARGEUR_2XL } from "@/components/ui/pleine-largeur"');
    expect(page).toContain("<div className={PLEINE_LARGEUR_2XL}>");
    // Ni largeur, ni palier, ni plafond recopiés : c'est tout l'objet de la constante.
    expect(page).not.toContain("100vw");
    expect(page).not.toContain("max-w-");
    expect(page).not.toContain("90rem");
    // Et la largeur n'est posée qu'une fois : sur la racine, pas sur les piles ni sur une carte.
    expect([...page.matchAll(/className=\{PLEINE_LARGEUR_2XL\}/g)]).toHaveLength(1);
    // (Le commentaire des piles a le droit de nommer la constante — c'est la **classe** qui ne doit
    // pas y être : une largeur posée sur un morceau de page est le défaut qu'elle existe pour éviter.)
    expect(lire(PILES)).not.toMatch(/className=\{?\s*PLEINE_LARGEUR/);
  });

  it("empile deux colonnes indépendantes, et jamais une grille", () => {
    const code = lire(PILES);
    // Deux colonnes `flex` de même rang, qui n'existent qu'à partir de 1 536 px.
    expect(code).toContain("flex flex-col gap-6 2xl:flex-row");
    expect([...code.matchAll(/className="flex min-w-0 flex-1 flex-col gap-6"/g)]).toHaveLength(2);
    // Le défaut refusé : une grille aligne en rangées, donc elle fait des trous.
    expect(code).not.toMatch(/\bgrid\b/);
    expect(code).not.toContain("grid-cols");
    // Un seul palier dans le fichier, celui du dépôt : ni `lg:`, ni `xl:` (celui de `DeuxColonnes`).
    expect(code).not.toMatch(/\blg:/);
    expect(code).not.toMatch(/(?<!2)xl:/);
  });

  it("garde une seule mise en page : aucun arbre jumeau masqué en CSS", () => {
    const page = lire(PAGE);
    // Les cartes sont écrites **une fois**. Un second arbre caché en `2xl:hidden` serait la façon
    // facile de reproduire l'ordre du téléphone, et la façon sûre de faire diverger les deux écrans
    // (sans parler de deux formulaires de même nom dans la page).
    for (const carte of ["<CarteNotifications", "<ActiverPush", "<TesterNotifications", "<CarteSecurite", "<BoutonDeconnexion"]) {
      expect([...page.matchAll(new RegExp(carte, "g")), carte].length - 1, `${carte} est rendue deux fois`).toBe(1);
    }
    expect(page).not.toContain("2xl:hidden");
  });

  it("une coupure, jamais un tri : l'ordre d'une seule pile est celui d'hier", () => {
    /*
     * **Le cœur de la demande, et ce qui a décidé du découpage.** En dessous de 1 536 px les deux
     * piles s'empilent **dans l'ordre du DOM** : la pile de gauche entière, puis celle de droite. Pour
     * que l'écran d'un téléphone reste celui d'hier, le découpage ne peut donc être qu'une **coupure**
     * de la liste d'hier — tout autre partage demanderait un `order` CSS, qui donnerait au lecteur
     * d'écran un autre ordre que celui de l'œil (ce que `DeuxColonnes` s'interdit déjà).
     *
     * C'est pourquoi « Mes informations » est en tête de la pile de **gauche** et non de celle de
     * droite comme proposé : l'y mettre l'aurait fait descendre en quatrième position sur un
     * téléphone.
     */
    const page = lire(PAGE);
    // Le corps de la page seul : les fonctions de carte, écrites plus bas dans le fichier, portent
    // elles aussi des ancres (« lien », « securite ») et brouilleraient l'ordre lu ici.
    const corps = page.slice(page.indexOf("return ("), page.indexOf("</PageAvecSommaire>"));
    const ordreAttendu = ["acces-admin", "informations", "appareil", "mes-notifications", "apparence", "lien", "securite"];
    /** Ce qui, dans le corps de la page, **rend** la section de cette ancre. */
    const RENDU: Record<string, string> = {
      "acces-admin": '<Carte id="acces-admin"',
      informations: '<Carte id="informations"',
      appareil: "<ActiverPush",
      "mes-notifications": "<CarteNotifications",
      apparence: '<Carte id="apparence"',
      lien: "<CarteLien",
      securite: "<CarteSecurite",
    };
    // 1. Les sections se suivent dans la page comme dans le sommaire (qui est, lui, apparié aux
    //    titres section par section par `bandes-pleine-largeur.test.ts`).
    const rendus = ordreAttendu.map((ancre) => corps.indexOf(RENDU[ancre]));
    expect(rendus.every((i) => i > 0), "une section n'est pas rendue dans le corps de la page").toBe(true);
    expect([...rendus].sort((a, b) => a - b)).toEqual(rendus);
    // 2. Le sommaire annonce exactement cet ordre.
    const sommaire = [...page.matchAll(/\{ ancre: "([^"]+)", titre: "[^"]+" \}/g)].map((m) => m[1]);
    expect(sommaire).toEqual(ordreAttendu);
    // 3. La coupure tombe entre « Tester mes notifications » et « Apparence ».
    expect(corps.indexOf("<TesterNotifications")).toBeLessThan(corps.indexOf("droite={"));
    expect(corps.indexOf('<Carte id="apparence"')).toBeGreaterThan(corps.indexOf("droite={"));
  });

  it("laisse « Accès administrateur » au-dessus des deux piles, sur toute la largeur", () => {
    /*
     * Décision : depuis que l'administration ne s'ouvre plus que d'ici, cette carte est une
     * **porte**, pas un réglage. La chercher dans une colonne serait la cacher — et le titre comme
     * les alertes restent au-dessus pour la même raison : ils parlent de la page entière.
     */
    const page = lire(PAGE);
    const piles = page.indexOf("<DeuxPiles");
    expect(page.indexOf('<Carte id="acces-admin"')).toBeLessThan(piles);
    expect(page.indexOf("<h1")).toBeLessThan(piles);
    expect(page.indexOf('{codes === "epuises" &&')).toBeLessThan(piles);
  });

  it("met l'état du compte au-dessus du sommaire, sans en faire une section de la page", () => {
    const page = lire(PAGE);
    expect(page).toContain('placement="colonne"');
    expect(page).toMatch(/enTete=\{\s*<CarteEtatCompte/);
    // Pas d'ancre : une cible qui n'existe qu'au-delà de 1 536 px serait un lien mort en dessous.
    expect(lire(CARTE_ETAT)).not.toMatch(/\bid=/);
    // Et pas un réglage de plus : aucun bouton, aucun formulaire dans cette carte.
    expect(lire(CARTE_ETAT)).not.toMatch(/<Bouton|<form|<Link/);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* « État de mon compte » : ce qui s'affiche, et surtout ce qui ne s'affiche pas                      */
/* ------------------------------------------------------------------------------------------------ */

const LIEN_ACTIF: EtatLienPersonnel = {
  etat: "actif",
  periodId: "p1",
  periodeNom: "T4 2026",
  expiresAt: new Date("2027-01-30T06:29:00.000Z"),
  ouvert: true,
};

const BASE = {
  lien: LIEN_ACTIF,
  aDejaUnMotDePasse: true,
  deuxFa: false,
  admin: false,
  totpActiveAt: null,
  codesRestants: 0,
  codesTotal: 8,
  appareils: 0,
};

const intitules = (e: Parameters<typeof lignesEtatCompte>[0]) => lignesEtatCompte(e).map((l) => l.intitule);

describe("l'état du compte dit l'état, et un champ vide ne s'affiche pas du tout", () => {
  it("donne chaque valeur avec son intitulé, et rien d'anonyme", () => {
    // Règle de lecture du dépôt : deux pastilles empilées nues ne se distinguent pas.
    for (const ligne of lignesEtatCompte(BASE)) {
      expect(ligne.intitule.length).toBeGreaterThan(0);
      expect(ligne.valeur.length).toBeGreaterThan(0);
    }
  });

  it("n'annonce aucun lien au compte de service, qui n'en a pas", () => {
    // Le compte du portail entre par mot de passe + 2FA : une ligne « Pas de lien personnel » dans un
    // état de compte décrirait quelque chose qui n'existe pas.
    expect(intitules({ ...BASE, lien: { etat: "compte-de-service" } })).not.toContain("Lien d'accès");
    expect(intitules(BASE)).toContain("Lien d'accès");
  });

  it("ne parle de codes de secours qu'à qui a une double authentification", () => {
    // Sans 2FA, « 0 sur 8 restants » se lirait comme un incident : il n'y a rien à secourir.
    expect(intitules({ ...BASE, deuxFa: false })).not.toContain("Codes de secours");
    expect(intitules({ ...BASE, deuxFa: true, codesRestants: 4 })).toContain("Codes de secours");
    // À zéro code restant, et alors seulement, la pastille passe au rouge.
    const [codes] = lignesEtatCompte({ ...BASE, deuxFa: true, codesRestants: 0 }).filter((l) => l.intitule === "Codes de secours");
    expect(codes.ton).toBe("rouge");
  });

  it("compte les appareils branchés, zéro compris — un zéro n'est pas un champ vide", () => {
    // C'est l'état qu'on vient vérifier quand on ne reçoit rien sur son téléphone.
    const aucun = lignesEtatCompte({ ...BASE, appareils: 0 }).find((l) => l.intitule === TITRE_APPAREILS_NOTIFIES);
    expect(aucun).toMatchObject({ valeur: "aucun", ton: "neutre" });
    expect(lignesEtatCompte({ ...BASE, appareils: 1 }).find((l) => l.intitule === TITRE_APPAREILS_NOTIFIES)?.valeur).toBe("1 appareil");
    expect(lignesEtatCompte({ ...BASE, appareils: 3 }).find((l) => l.intitule === TITRE_APPAREILS_NOTIFIES)?.valeur).toBe("3 appareils");
  });

  it("reproche la double authentification à un administrateur, jamais à un membre", () => {
    // Pour un ADMIN elle est obligatoire (sans elle, pas de session forte) ; pour tous les autres
    // c'est un supplément qu'on choisit, et une pastille d'alerte reprocherait un réglage facultatif.
    const membre = lignesEtatCompte({ ...BASE, admin: false }).find((l) => l.intitule === "Double authentification");
    expect(membre).toMatchObject({ valeur: "non activée", ton: "neutre" });
    const bureau = lignesEtatCompte({ ...BASE, admin: true }).find((l) => l.intitule === "Double authentification");
    expect(bureau).toMatchObject({ valeur: "à activer", ton: "ocre" });
  });

  it("ne date la double authentification que lorsqu'elle est active", () => {
    // `totpActiveAt` peut survivre à une réinitialisation : « non activée — depuis le … » serait faux.
    const quand = new Date("2026-09-01T10:00:00.000Z");
    expect(lignesEtatCompte({ ...BASE, deuxFa: false, totpActiveAt: quand }).find((l) => l.intitule === "Double authentification")?.precision).toBe("");
    expect(lignesEtatCompte({ ...BASE, deuxFa: true, totpActiveAt: quand }).find((l) => l.intitule === "Double authentification")?.precision).toContain("depuis le");
  });

  it("dit du lien exactement ce que la carte « Mon lien d'accès » en dit", () => {
    /*
     * Les deux sont visibles **en même temps** sur un écran large : deux mots pour un même fait se
     * liraient comme deux informations contradictoires. Ils sortent donc de la même table.
     */
    const ligne = lignesEtatCompte(BASE).find((l) => l.intitule === "Lien d'accès");
    expect(ligne?.valeur).toBe(PASTILLE_LIEN.actif.texte);
    expect(ligne?.ton).toBe(PASTILLE_LIEN.actif.ton);
    expect(ligne?.precision).toBe(precisionLien(LIEN_ACTIF));
    expect(ligne?.precision).toContain("valable jusqu'au");
    // Un lien jamais ouvert le dit ; les états qui n'ont rien à préciser ne précisent rien.
    expect(precisionLien({ ...LIEN_ACTIF, ouvert: false })).toContain("jamais ouvert");
    expect(precisionLien({ etat: "aucun", periodId: "p1", periodeNom: "T4 2026" })).toBe("");
    expect(precisionLien({ etat: "compte-de-service" })).toBe("");
  });

  it("couvre les sept états de lien, sans en inventer un huitième", () => {
    // La table est exhaustive par construction (`Record<EtatLienPersonnel["etat"], …>`) ; ce test
    // garde le fait qu'un état sans mot ne passe pas en silence.
    for (const [etat, { texte }] of Object.entries(PASTILLE_LIEN)) {
      expect(texte.length, `l'état ${etat} n'a pas de mot`).toBeGreaterThan(0);
    }
  });
});

/**
 * **Une carte en demi-colonne mesure son CONTENEUR, pas la fenêtre**.
 *
 * C'est le piège que `CLAUDE.md` nomme en toutes lettres — « `lg:` mesure la FENÊTRE, pas le
 * conteneur » —, et les deux piles l'ont réveillé en version douce le jour même : la carte
 * « Apparence » est passée de 736 à **536 px** de large, mais son `sm:flex-row` interne, qui regarde
 * la fenêtre, continuait de poser la liste déroulante et l'aperçu **côte à côte** sur un écran de
 * 1 920 px. La légende du thème — « Papier ancien et rouille — la palette d'origine de l'outil » — se
 * coupait alors en **sept lignes de trois mots**. Rien n'était cassé ; c'était juste le seul endroit
 * de l'écran qui *avait l'air* serré, et c'est exactement la forme que prend ce défaut.
 *
 * La parade est une **requête de conteneur** (`@container` et le palier `@2xl`, soit 42 rem de
 * conteneur) : elle mesure la boîte, donc elle vaut dans une demi-colonne comme dans la colonne de
 * lecture. Vérifié des deux côtés : à 1 440 px la carte est **inchangée** (736 × 295 px, en rangée),
 * à 1 920 px elle s'empile et la légende tient sur une ligne, et sur 390 px rien ne bouge.
 *
 * Ce que ce test interdit : le retour d'une découpe interne sur une mesure de **fenêtre** dans l'une
 * des cartes du profil. Elles vivent toutes, désormais, dans une colonne qui ne suit plus la fenêtre.
 */
describe("les cartes du profil ne se découpent pas sur une mesure de fenêtre", () => {
  /**
   * Les découpes qui changent la forme d'une carte — et qui, sur une mesure de **fenêtre**, mentent
   * dès que la carte n'occupe plus la page. Le `(?<![@\w-])` exclut `@2xl:` : le croisillon, c'est
   * justement la mesure du **conteneur**, donc la parade et non le défaut.
   */
  const DECOUPES = /(?<![@\w-])(sm|md|lg|xl|2xl):(flex-row|grid-cols-\d|w-\d|w-\[)/;

  /**
   * **`DeuxPiles` est l'exception, et c'est la seule.** C'est lui qui *est* la découpe de la page :
   * son conteneur est la racine de `/profil`, dont la largeur suit la fenêtre (`PLEINE_LARGEUR_2XL`).
   * Une requête de média y est donc légitime — c'est la formulation exacte de `CLAUDE.md` : « une
   * découpe en `lg:` n'est légitime que dans un conteneur dont on sait qu'il suit la fenêtre ».
   */
  const EXCEPTIONS = ["DeuxPiles.tsx"];

  const cartes = () =>
    fs
      .readdirSync(path.join(RACINE, "src/app/(app)/profil"))
      .filter((f) => f.endsWith(".tsx") && !EXCEPTIONS.includes(f));

  it.each(cartes())("%s ne découpe rien sur la largeur de la fenêtre", (fichier) => {
    const code = lire(`src/app/(app)/profil/${fichier}`);
    // On ne lit que les `className` : un commentaire a le droit de raconter le défaut.
    for (const [, classes] of code.matchAll(/className="([^"]*)"/g)) {
      expect(DECOUPES.test(classes), `${fichier} : « ${classes} »`).toBe(false);
    }
    // Les gabarits en chaîne (`className={\`…\`}`) comptent pareil.
    for (const [, classes] of code.matchAll(/className=\{`([^`]*)`\}/g)) {
      expect(DECOUPES.test(classes), `${fichier} : « ${classes} »`).toBe(false);
    }
  });

  it("l'aperçu du thème se range d'après son conteneur", () => {
    const code = lire("src/app/(app)/profil/SelecteurTheme.tsx");
    expect(code).toContain("@container");
    expect(code).toContain("@2xl:flex-row");
    // Et la page, elle, garde le droit de mesurer la fenêtre : c'est elle qui la suit, par la
    // constante du dépôt et par la seule découpe légitime, celle des deux piles.
    expect(lire(PAGE)).toContain("PLEINE_LARGEUR_2XL");
    expect(lire(PILES)).toContain("2xl:flex-row");
  });
});

/**
 * **Ce que la relecture adverse a trouvé dans la carte d'état, le jour de sa naissance.** Trois
 * défauts, une seule racine : une carte qui résume ce que les cartes de réglage disent plus bas
 * **ne peut pas** employer d'autres mots qu'elles, ni d'autres couleurs — sur un grand écran, les
 * deux sont dans le même coup d'œil.
 */
describe("la carte d'état ne contredit pas les cartes de réglage (relecture du 02/10)", () => {
  it("nomme les appareils comme la carte qu'elle résume, et pas comme ceux d'un lien", () => {
    // « Appareils branchés » était le seul libellé non partagé — et « appareil » veut dire autre
    // chose deux lignes plus haut : le plafond de trois du lien personnel, et son alerte.
    expect(TITRE_APPAREILS_NOTIFIES).toBe("Appareils qui reçoivent les notifications");
    const source = fs.readFileSync(path.join(RACINE, "src/app/(app)/profil/ActiverPush.tsx"), "utf8");
    expect(source, "la carte lit le même libellé").toContain("TITRE_APPAREILS_NOTIFIES");
    expect(source).not.toContain("Appareils qui reçoivent les notifications</h3>");
  });

  it("peint les deux moitiés de l'obligation d'un administrateur de la même couleur", () => {
    const admin = lignesEtatCompte({ ...BASE, admin: true, aDejaUnMotDePasse: false, deuxFa: false });
    const motDePasse = admin.find((l) => l.intitule === "Mot de passe");
    const deuxFa = admin.find((l) => l.intitule === "Double authentification");
    expect(motDePasse?.ton, "le mot de passe d'un administrateur est obligatoire, lui aussi").toBe("ocre");
    expect(motDePasse?.valeur).toBe("à définir");
    expect(deuxFa?.ton).toBe("ocre");
    // Et pour un membre, les deux restent neutres : ce sont des filets, pas des obligations.
    const membre = lignesEtatCompte({ ...BASE, admin: false, aDejaUnMotDePasse: false, deuxFa: false });
    expect(membre.find((l) => l.intitule === "Mot de passe")?.ton).toBe("neutre");
    expect(membre.find((l) => l.intitule === "Double authentification")?.ton).toBe("neutre");
  });

  /**
   * **Le résumé de la colonne ne porte pas de titre de section.** Il se lit avant la page dans le
   * DOM — c'est lui qui l'annonce —, donc un `<h2>` y passait devant le seul `<h1>` de l'écran : qui
   * navigue par titres rencontrait une section avant le titre de la page.
   */
  it("ne pose aucun titre de section dans la colonne du sommaire", () => {
    // Sans les commentaires : le fichier a le droit de **raconter** le défaut du `<h2>`.
    const carte = lire(CARTE_ETAT)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(carte).not.toContain("<Carte");
    expect(carte).not.toMatch(/<h[1-6]/);
    expect(carte).toContain("uppercase tracking-wide");
  });

  /**
   * **L'action qui écrit un mot de passe invalide le chemin de sa page.** Sans ça — mesuré —
   * l'écran affichait « Mot de passe défini » et, deux fois, « non défini » ; et le bloc de la
   * double authentification restait sur « elle s'ajoute à un mot de passe », donc la 2FA était
   * **injoignable** sans un rechargement que rien ne suggérait.
   */
  it("définir un mot de passe, ou retirer sa 2FA, rafraîchit la page", () => {
    const actions = lire("src/actions/profil.ts");
    for (const nom of ["changerMotDePasse", "reinitialiserMaDeuxFa"]) {
      const corps = actions.slice(actions.indexOf(`export async function ${nom}`));
      const fin = corps.indexOf("\nexport ");
      expect(corps.slice(0, fin === -1 ? undefined : fin), nom).toContain('revalidatePath("/profil")');
    }
  });

  /** « Ton lien personnel suffit pour entrer » ne se dit pas à qui n'a pas d'adresse email. */
  it("ne promet pas un lien à un compte sans adresse", () => {
    expect(lire(PAGE)).toMatch(/p\.aUnEmail\s*\n?\s*\?/);
  });
});
