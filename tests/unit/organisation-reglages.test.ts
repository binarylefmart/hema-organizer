import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { can, exigeSessionForte } from "@/lib/permissions";

/**
 * Garde-fous du **rangement des écrans de réglage** :
 *
 *  1. il n'y a plus d'onglet « Réglages » dans la gestion, et plus de page `gestion/parametres` ;
 *  2. le réglage des notifications (heure du récap, grille notification × canal, pages de canal)
 *     vit dans l'espace admin — donc ADMIN + session forte, les actions suivent l'écran ;
 *  3. les thèmes du planning sont dans Ateliers, avec les propositions : même sujet (ce qu'on
 *     enseigne), et une permission ouverte aux instructeurs ;
 * 4. l'administration technique ne se rejoint **que** par « Mon profil » : ni la gestion, ni
 * l'en-tête, ni l'accueil n'y mènent (décision) ;
 *  5. l'aperçu de gestion n'existe plus : il faisait doublon avec la page d'accueil, devenue le
 *     compte rendu de l'association. `/gestion` redirige vers Séances.
 *
 * On lit les sources : ce qui doit tenir ici, c'est l'emplacement des écrans et la permission
 * exigée, pas le rendu.
 */

const RACINE = process.cwd();
const APP = path.join(RACINE, "src/app/(app)");
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");
const existe = (relatif: string) => fs.existsSync(path.join(RACINE, relatif));

const LAYOUT_GESTION = "src/app/(app)/gestion/layout.tsx";
const LAYOUT_ADMIN = "src/app/(app)/admin/layout.tsx";
const PAGE_NOTIFICATIONS = "src/app/(app)/admin/notifications/page.tsx";
const PAGE_ATELIERS = "src/app/(app)/gestion/ateliers/page.tsx";
const PAGE_THEMES = "src/app/(app)/admin/themes/page.tsx";
const PAGE_IDENTITE = "src/app/(app)/admin/identite/page.tsx";
const ACTIONS_IDENTITE = "src/actions/identite.ts";
const ACTIONS_ADMIN = "src/actions/admin.ts";
/*
 * Les six canaux ont chacun leur page sous `/admin/notifications/…` — c'est ce que promet
 * `lienCanal`, et un canal ajouté à `CANAUX` sans sa page ferait tomber le lien de la grille sur un
 * 404. « Site du club » (`api`) en a une même s'il n'a **rien à régler** : elle dit ce qui sort, ce
 * qui ne sort pas, et où se coche l'interrupteur.
 */
const CANAUX = ["discord", "email", "push", "telegram", "whatsapp", "api"] as const;

/** Tous les fichiers des écrans de l'espace connecté (pages, layouts, composants colocalisés). */
function fichiersEcrans(dossier: string): string[] {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) return fichiersEcrans(complet);
    return /\.tsx?$/.test(e.name) ? [complet] : [];
  });
}

describe("l'onglet Réglages a disparu", () => {
  it("la sous-navigation de gestion n'a plus de Réglages", () => {
    const code = lire(LAYOUT_GESTION);
    expect(code).not.toContain('label: "Réglages"');
    expect(code).not.toContain("/gestion/parametres");
    expect(code).not.toContain('label: "Administration"');
  });

  it("la page gestion/parametres n'existe plus (pas d'écran fantôme)", () => {
    expect(existe("src/app/(app)/gestion/parametres")).toBe(false);
  });

  it("aucun écran ne renvoie vers l'ancien emplacement", () => {
    // `src/lib/notifications/canaux.ts` garde pour l'instant l'ancien chemin dans
    // `lienConfigurationCanal` : plus aucun écran ne s'en sert (voir admin/notifications/liens.ts).
    const fautifs = fichiersEcrans(APP).filter((f) => fs.readFileSync(f, "utf8").includes("gestion/parametres"));
    expect(fautifs.map((f) => path.relative(RACINE, f))).toEqual([]);
  });
});

describe("les notifications sont dans l'espace admin", () => {
  it("l'espace admin a son onglet Notifications", () => {
    const code = lire(LAYOUT_ADMIN);
    expect(code).toContain('{ href: "/admin/notifications", label: "Notifications" }');
  });

  it("l'écran des notifications exige la permission technique et porte les deux réglages", () => {
    const code = lire(PAGE_NOTIFICATIONS);
    expect(code).toContain('requirePermission("settings.technical")');
    expect(code).toContain("definirHeureRecap");
    expect(code).toContain("enregistrerNotifications");
    // La carte des thèmes est partie dans Ateliers : elle n'a plus rien à faire ici
    expect(code).not.toContain("enregistrerThemes");
  });

  it.each(CANAUX)("la page du canal %s est sous /admin/notifications et réservée au bureau", (canal) => {
    const relatif = `src/app/(app)/admin/notifications/${canal}/page.tsx`;
    expect(existe(relatif)).toBe(true);
    expect(lire(relatif)).toContain('requirePermission("settings.technical")');
  });

  it("les liens de configuration de canal pointent dans l'espace admin", () => {
    expect(lire("src/app/(app)/admin/notifications/liens.ts")).toContain("`/admin/notifications/${canal}`");
    expect(lire("src/app/(app)/admin/notifications/EnTeteCanal.tsx")).toContain('href="/admin/notifications"');
    // L'écran technique est devenu « À propos » et ne règle plus rien de ce qui part : c'est
    // l'écran Notifications qui porte le salon Discord, le serveur d'envoi et l'API publique.
    expect(existe("src/app/(app)/admin/parametres")).toBe(false);
    expect(lire("src/app/(app)/admin/apropos/page.tsx")).toContain('href="/admin/notifications"');
    expect(lire("src/app/(app)/admin/apropos/page.tsx")).not.toContain("discordWebhookUrl");
  });

  it("les actions du réglage des notifications demandent la session forte d'un administrateur", () => {
    const code = lire(ACTIONS_ADMIN);
    // Plus aucune action de ce fichier ne se contente de `recap.hour` (permission d'équipe) :
    // l'écran est passé dans /admin, la permission a suivi.
    expect(code).not.toContain('assertPermission("recap.hour")');
    expect(code).not.toContain("/gestion/parametres");
    expect(code).toContain('exigerReauth(user, "/admin/notifications/discord")');
  });
});

describe("les thèmes du planning sont dans l'espace admin", () => {
  it("l'espace admin a son onglet « Thèmes et lieux », et l'écran porte les deux formulaires", () => {
    // L'onglet a pris les **lieux** : les deux salles du club vivaient dans le code, adresses
    // postales comprises, ce qui rendait l'outil ininstallable par un autre club.
    expect(lire(LAYOUT_ADMIN)).toContain('{ href: "/admin/themes", label: "Thèmes et lieux" }');
    const code = lire(PAGE_THEMES);
    expect(code).toContain("enregistrerThemes");
    expect(code).toContain("enregistrerLieux");
    expect(code).toContain('requirePermission("themes.manage")');
  });

  it("l'identité du club a son onglet et son écran, réservés au bureau", () => {
    expect(lire(LAYOUT_ADMIN)).toContain('{ href: "/admin/identite", label: "Club" }');
    const code = lire(PAGE_IDENTITE);
    // Les trois formulaires de l'écran depuis la coupure : ce que le club **est** (son nom, son
    // sigle), comment il **se montre** (thème, couleur), et sa part d'effectif.
    expect(code).toContain("enregistrerNomsClub");
    expect(code).toContain("enregistrerApparenceClub");
    expect(code).toContain("enregistrerPartEffectifClub");
    // L'action d'un bloc a disparu : il ne reste pas un second chemin d'écriture sans écran.
    expect(code).not.toContain("enregistrerIdentiteClub");
    expect(code).toContain('requirePermission("settings.technical")');
  });

  it("la page Ateliers ne les porte plus : elle ne garde que la file des propositions", () => {
    const code = lire(PAGE_ATELIERS);
    expect(code).not.toContain("enregistrerThemes");
    expect(code).not.toContain("Thèmes du planning");
    // Le motif tolère les blancs : Prettier a coupé cette balise en plusieurs lignes (le fichier a
    // grandi d'un import), et le test est tombé sur un retour à la ligne alors que rien du
    // comportement n'avait bougé. Troisième fois ce jour-là — on cherche la règle, pas
    // l'espacement.
    expect(code).toMatch(/<DecisionAtelier\s+atelierId/);
  });

  it("un instructeur garde la file, mais plus les thèmes", () => {
    const instructeur = { role: "INSTRUCTEUR", actif: true };
    expect(can(instructeur, "ateliers.moderate")).toBe(true);
    expect(can(instructeur, "themes.manage")).toBe(false);
    // …et l'onglet Ateliers figure bien dans sa sous-navigation, sinon l'écran serait inatteignable
    expect(lire(LAYOUT_GESTION)).toContain('{ href: "/gestion/ateliers", label: "Ateliers"');
  });

  it("l'action des thèmes est passée au bureau, donc derrière l'élévation", () => {
    expect(lire("src/actions/planning.ts")).toContain('assertPermission("themes.manage")');
    // ADMIN seul ⇒ `exigeSessionForte` la classe d'office parmi les gestes qui réclament
    // l'élévation. L'acteur est un **instructeur du bureau** : la ligne juste au-dessus a montré
    // que `themes.manage` est fermée à un instructeur, donc ce `true`-ci ne peut venir que de
    // `estAdmin`.
    expect(can({ role: "INSTRUCTEUR", estAdmin: true, actif: true }, "themes.manage")).toBe(true);
    expect(exigeSessionForte("themes.manage")).toBe(true);
  });
});

/**
 * **Le formulaire d'identité du club, scindé en deux**.
 *
 * Le nom, le sigle, le thème et la couleur de marque étaient un seul `<form>` et une seule action.
 * L'écran se range en deux piles — à gauche ce que le club **est**, à droite comment il **se
 * montre** —, et deux colonnes ne peuvent pas se partager un `<form>` : la carte de gauche
 * s'intitulait donc « Nom » tout en portant le thème et la couleur.
 *
 * Ce que ces tests tiennent, et c'est le vrai risque d'une coupure de chemin d'écriture :
 *
 *  1. **les deux moitiés gardent exactement les verrous de l'action d'origine** — permission (donc
 *     élévation), validation Zod côté serveur, entrée d'audit, `revalidatePath`. Deux chemins aux
 *     règles différentes, ce serait une porte dérobée d'un côté ou une fonctionnalité morte de
 *     l'autre ;
 *  2. **une entrée d'audit par geste, et elle dit lequel** : la même entrée pour les deux aurait
 *     fait perdre au journal la seule chose qu'on lui demande — savoir qui a changé quoi ;
 *  3. **chaque moitié n'écrit que sa moitié** (`enregistrerIdentite` fusionne un patch partiel) ;
 *  4. **chaque bouton nomme ce qu'il enregistre** : trois formulaires sur un même écran, trois
 *     boutons « Enregistrer » indistincts ne diraient plus ce qu'on valide.
 *
 * Le balayage de `gardes-serveur.test.ts` tient déjà la garde par export ; ici on vérifie que les
 * **mêmes** verrous, et pas seulement *une* garde, ont été reportés sur les deux moitiés.
 */
describe("l'identité du club : deux formulaires, deux actions", () => {
  const MOITIES = ["enregistrerNomsClub", "enregistrerApparenceClub"] as const;

  /** Le corps d'une fonction exportée, de sa signature à son accolade de fermeture en colonne 0. */
  function corpsDeLaFonction(source: string, nom: string): string {
    const debut = source.indexOf(`export async function ${nom}(`);
    expect(debut, `fonction ${nom} introuvable`).toBeGreaterThan(-1);
    const fin = source.indexOf("\n}\n", debut);
    return source.slice(debut, fin === -1 ? undefined : fin + 2);
  }

  it.each(MOITIES)("%s porte les quatre verrous de l'action d'origine", (nom) => {
    const corps = corpsDeLaFonction(lire(ACTIONS_IDENTITE), nom);
    expect(corps).toContain('assertPermission("settings.technical")');
    expect(corps).toContain("safeParse");
    expect(corps).toContain("zodToFormState");
    expect(corps).toMatch(/await audit\(user, "identite\./);
    expect(corps).toContain('revalidatePath("/", "layout")');
  });

  it("chaque moitié journalise son propre geste, et l'entrée indistincte a disparu", () => {
    const source = lire(ACTIONS_IDENTITE);
    const noms = MOITIES.map((m) => corpsDeLaFonction(source, m).match(/audit\(user, "([^"]+)"/)?.[1]);
    expect(noms).toEqual(["identite.noms_modifies", "identite.apparence_modifiee"]);
    expect(new Set(noms).size).toBe(noms.length);
    // `identite.modifiee` ne disait pas *quoi* : il n'a plus de sens avec deux gestes.
    expect(source).not.toContain('"identite.modifiee"');
  });

  it("n'écrit que sa moitié : rien ne s'efface l'un l'autre", () => {
    const source = lire(ACTIONS_IDENTITE);
    const noms = corpsDeLaFonction(source, "enregistrerNomsClub");
    expect(noms).toMatch(/enregistrerIdentite\(\{[^}]*\bclub:[^}]*\bsigle:[^}]*\}\)/);
    expect(noms).not.toMatch(/\btheme\b/);
    expect(noms).not.toMatch(/\bmarque\b/);
    const apparence = corpsDeLaFonction(source, "enregistrerApparenceClub");
    expect(apparence).toMatch(/enregistrerIdentite\(\{[^}]*\btheme:[^}]*\bmarque:[^}]*\}\)/);
    expect(apparence).not.toMatch(/\bclub:/);
    expect(apparence).not.toMatch(/\bsigle\b/);
  });

  it("la couleur reste commandée par sa case à cocher", () => {
    // Un `<input type="color">` ne sait pas dire « aucune couleur » : sans la case, on ne pourrait
    // plus revenir à la couleur du thème après l'avoir quittée. La coupure ne devait pas l'emporter.
    const apparence = corpsDeLaFonction(lire(ACTIONS_IDENTITE), "enregistrerApparenceClub");
    expect(apparence).toContain('caseCochee(fd, "marquePersonnalisee")');
  });

  it("chacun des trois formulaires de l'écran dit ce qu'il enregistre", () => {
    const code = lire(PAGE_IDENTITE);
    for (const bouton of ['bouton="Enregistrer le nom"', 'bouton="Enregistrer l\'apparence"', 'bouton="Enregistrer la part"']) {
      expect(code).toContain(bouton);
    }
    // Trois formulaires, trois boutons : aucun ne s'appelle « Enregistrer » tout court.
    expect(code).not.toContain('bouton="Enregistrer"');
    expect(code.match(/<FormulaireAction/g)).toHaveLength(3);
  });

  it("les cartes de l'écran ne mentent pas sur ce qu'elles portent", () => {
    const code = lire(PAGE_IDENTITE);
    // « Nom » portait aussi le thème et la couleur de marque : c'est ce titre-là qu'on a corrigé.
    expect(code).toContain('<Carte titre="Nom et sigle">');
    expect(code).toContain('<Carte titre="Apparence">');
    expect(code).not.toContain('<Carte titre="Nom">');
    // Le thème et les deux logos sont dans la même pile — celle de « comment le club se montre ».
    const apparence = code.indexOf('<Carte titre="Apparence">');
    const logo = code.indexOf('<Carte titre="Logo">');
    const effectif = code.indexOf('<Carte titre="Effectif">');
    expect(apparence).toBeGreaterThan(-1);
    expect(logo).toBeGreaterThan(apparence);
    // … et la part d'effectif est dans l'autre, sous l'identité : un seul flux sur un téléphone,
    // dans l'ordre de la source (nom et sigle, effectif, apparence, logos).
    expect(effectif).toBeLessThan(apparence);
  });

  /**
   * **Les découpes internes mesurent le CONTENEUR, pas la fenêtre.** Dans une pile de 708 px, un
   * `lg:grid-cols-2` aurait posé des champs de ~320 px sur un écran de 1 920 — plus étroits que sur
   * un téléphone. Et `grid-cols-1` n'est pas une redondance : sans lui, la piste implicite grossit
   * jusqu'au `max-content` de son contenu.
   */
  it("les deux grilles de l'écran sont des requêtes de conteneur, avec leur grid-cols-1", () => {
    const code = lire(PAGE_IDENTITE);
    expect(code.match(/className="@container"/g)).toHaveLength(2);
    expect(code.match(/grid grid-cols-1 gap-4 @2xl:grid-cols-2/g)).toHaveLength(2);
    // On lit les **classes**, pas la prose : le commentaire qui nomme le piège parle bien de
    // `lg:grid-cols-2`, et c'est son rôle. Le `@` du palier de conteneur est le seul préfixe
    // toléré dans un `className` : `@2xl:` oui, `2xl:` non.
    const classes = [...code.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
    expect(classes.filter((c) => /(?<![@\w-])(sm|md|lg|xl|2xl):grid-cols-/.test(c))).toEqual([]);
  });
});

/**
 * L'administration technique ne se rejoint que par « Mon profil » (décision).
 *
 * Le raisonnement : elle tient à la **personne** — son mot de passe, sa double authentification, sa
 * session forte — et non à sa fonction d'encadrant. Un administrateur qui prépare un cours passe par
 * l'espace instructeur ; il ne longe pas la porte des réglages techniques à chaque fois.
 *
 * Restent volontairement autorisés : les liens **contextuels** vers un enregistrement précis (le fil
 * d'Ariane d'une fiche ouverte depuis les comptes admin, le renvoi du planning vers la ligne de
 * journal correspondante). Ce ne sont pas des entrées de navigation, et l'accès reste vérifié côté
 * serveur par `requirePermission("settings.technical")`.
 */
describe("l'administration ne s'ouvre que depuis le profil", () => {
  const ENTETE = "src/components/layout/Entete.tsx";
  const ACCUEIL = "src/app/(app)/page.tsx";
  const PROFIL = "src/app/(app)/profil/page.tsx";

  it("la sous-navigation de gestion n'offre aucune entrée vers l'administration", () => {
    expect(lire(LAYOUT_GESTION)).not.toContain('href: "/admin"');
  });

  it("l'onglet d'organisation s'appelle « Espace instructeur », pour les admins comme pour les autres", () => {
    const code = lire(ENTETE);
    expect(code).toContain('label: "Espace instructeur"');
    expect(code).not.toContain('"Espace admin"');
    // Cet onglet-là mène à l'organisation, et son écu ne doit pas servir d'entrée aux réglages
    expect(code).toContain('{ href: "/gestion", label: "Espace instructeur", icone: "bouclier" }');
  });

  /**
   * **L'en-tête porte bien une entrée vers l'administration**, mais elle n'existe que **pendant
   * l'élévation** : c'est son apparition, et non une couleur permanente, qui dit qu'on est connecté
   * en tant qu'administrateur. Elle a sa propre icône — la roue crantée — pour ne pas se confondre
   * avec l'écu de l'espace instructeur juste à côté, et se comporte comme les autres onglets (elle
   * ne s'allume que sur ses propres écrans).
   */
  it("l'entrée vers l'administration n'apparaît que pendant l'élévation, avec sa roue crantée", () => {
    const code = lire(ENTETE);
    expect(code).toContain('const admin: Onglet = { href: "/admin", label: "Admin", icone: "engrenage" };');
    expect(code).toContain("{user.sessionForte && <NavEntete onglets={[admin]} />}");
    // Le rôle seul ne suffit pas : c'est bien l'élévation qui commande
    expect(code).not.toMatch(/can\(user, "settings\.technical"\) &&\s*<NavEntete onglets=\{\[admin\]\}/);
  });

  it("l'accueil ne propose plus de raccourci vers l'administration", () => {
    const code = lire(ACCUEIL);
    expect(code).not.toContain('href="/admin"');
    expect(code).not.toContain("Espace admin");
  });

  it("le profil, lui, porte la seule porte — et la pastille d'activation", () => {
    const profil = lire(PROFIL);
    expect(profil).toContain('href="/admin"');
    expect(profil).toContain("CHEMIN_ACTIVATION_ADMIN");
    // La pastille « il reste une étape » a suivi la porte : elle est sur l'onglet Profil
    const entete = lire(ENTETE);
    const pastille = entete.indexOf("activationAFaire &&");
    const ongletProfil = entete.indexOf("onglets={[profil]}");
    expect(pastille).toBeGreaterThan(ongletProfil);
  });

  it("l'espace admin ne renvoie pas vers la gestion : on en sort par les onglets de l'en-tête", () => {
    expect(lire(LAYOUT_ADMIN)).not.toContain("← Gestion");
  });
});

/**
 * L'aperçu de gestion a disparu : ses chiffres — taux de la période, prochain cours et ses
 * compteurs, propositions d'ateliers en attente — sont désormais sur la page d'accueil, ouverte à
 * tous. Deux écrans pour les mêmes nombres, c'était un doublon.
 *
 * Ce qu'on fixe ici : plus aucune entrée « Aperçu » dans la sous-navigation (ni côté admin, ni côté
 * instructeur), et `/gestion` ne tombe ni sur un écran vide ni sur un 404 — elle **redirige** vers
 * `/gestion/seances`, parce que des liens existants y mènent encore (l'onglet « Espace instructeur »
 * de l'en-tête, le cookie de reprise après connexion).
 */
describe("la gestion s'ouvre sur les ateliers", () => {
  const PAGE_GESTION = "src/app/(app)/gestion/page.tsx";

  it("la sous-navigation de gestion n'a plus d'entrée « Aperçu »", () => {
    const nav = lire(LAYOUT_GESTION);
    expect(nav).not.toContain('label: "Aperçu"');
    // …dans aucune des deux listes : ni celle de l'admin, ni celle de l'instructeur
    expect(nav).not.toContain('{ href: "/gestion",');
  });

  it("les séances ont quitté la sous-navigation : elles sont dans l'onglet commun", () => {
    // Une seule liste des mêmes cours, ouverte à tout le club : l'espace de gestion n'en tient
    // plus une seconde. Les actions d'organisation vivent au pied des cartes de `/seances`.
    const nav = lire(LAYOUT_GESTION);
    expect(nav).not.toContain('href: "/gestion/seances"');
    /*
     * **Une seule liste d'onglets, la même pour tout le monde**. Elle en portait deux, l'une pour
     * le bureau et l'autre pour l'encadrement, et la seule différence était « Périodes » : le
     * trimestre est parti dans l'espace admin, la distinction n'a plus lieu d'être.
     */
    expect(nav).not.toContain('label: "Périodes"');
    // …ni « Membres » : l'annuaire a suivi le trimestre dans l'espace admin.
    expect(nav).not.toContain('label: "Membres"');
    expect(nav.slice(nav.indexOf("const sujets"))).toMatch(/^const sujets: Sujet\[\] = \[\n\s+\/\/[^\n]*\n\s+\{ href: "\/gestion\/ateliers", label: "Ateliers"/);
  });

  it("l'onglet principal s'appelle « Séances » et mène à l'écran commun", () => {
    const entete = lire("src/components/layout/Entete.tsx");
    expect(entete).toContain('{ href: "/seances", label: "Séances", icone: "epee" }');
    expect(entete).not.toContain('label: "Présences"');
  });

  it("/gestion existe encore, mais redirige vers les ateliers", () => {
    // Supprimer le fichier donnerait un 404 sur les liens qui pointent toujours vers /gestion
    expect(existe(PAGE_GESTION)).toBe(true);
    const code = lire(PAGE_GESTION);
    // Les membres sont partis dans l'espace admin : la section s'ouvre sur la porte qui reste, et
    // qui ne suppose aucune élévation.
    expect(code).toContain('redirect("/gestion/ateliers")');
    // La permission est vérifiée ici : on n'envoie pas un visiteur sans droits se faire refouler ailleurs
    expect(code).toContain('requirePermission("sessions.manage")');
  });

  it("la page redirigée ne porte plus l'aperçu : ni cartes, ni requêtes", () => {
    const code = lire(PAGE_GESTION);
    expect(code).not.toMatch(/\bdb\./);
    expect(code).not.toContain("statsPeriode");
    expect(code).not.toContain("SelecteurPeriode");
    // Son écran d'attente n'a plus d'objet : chaque sous-page de gestion a le sien
    expect(existe("src/app/(app)/gestion/loading.tsx")).toBe(false);
  });

  it("l'onglet « Espace instructeur » mène toujours à /gestion — d'où la redirection", () => {
    expect(lire("src/components/layout/Entete.tsx")).toContain('href: "/gestion", label: "Espace instructeur"');
  });
});
