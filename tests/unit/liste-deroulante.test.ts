import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  filtrerEntrees,
  grouper,
  indexApresTouche,
  indexDeValeur,
  indexParFrappe,
  hauteurListeRem,
  listeCherchable,
  normaliserPourFrappe,
  PANNEAU_MAX_REM,
  SEUIL_RECHERCHE,
  type EntreeListe,
  entreesRecherchees,
  estEntreeVide,
  indexActifRecherche,
} from "@/components/ui/liste-deroulante";
import { LIGNES_VISIBLES } from "@/components/seances/listes";
import { LIBELLE_VIDE } from "@/lib/constants";

/**
 * **La liste déroulante du planning s'ouvre vers le bas, toujours.**
 *
 * Le, les `<select>` natifs des cases retournaient leur menu vers le haut en bas de page et le
 * sommet de la liste des thèmes sortait de l'écran : ses premières entrées étaient inatteignables.
 * Le sens d'ouverture d'un menu natif n'étant pilotable par aucune CSS, les deux listes sont
 * devenues un composant maîtrisé. Ce fichier verrouille ce qui fait tenir la correction : la
 * logique de navigation (testable telle quelle) et, pour le composant lui-même, les quelques
 * chaînes dont dépend le comportement — un panneau posé sous le déclencheur, plafonné et défilant,
 * avec les rôles ARIA d'une liste à choix unique.
 */

const lire = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const composant = lire("src/components/ui/ListeDeroulante.tsx");
const caseEditeur = lire("src/components/planning/CaseEditeur.tsx");
const tableau = lire("src/components/ui/Tableau.tsx");
const pastille = lire("src/components/ui/Pastille.tsx");
const icone = lire("src/components/ui/Icone.tsx");

/**
 * **Les attributs de la balise ouvrante `<nom …>`**, pour vérifier *qui* porte quoi.
 *
 * Chercher `aria-activedescendant` n'importe où dans le fichier ne prouve rien : l'attribut était
 * bien présent — deux fois — mais sur le champ de recherche et sur le `<ul>`, c'est-à-dire jamais sur
 * l'élément qui a le focus. Un test de présence globale laissait donc passer une liste muette pour la
 * synthèse vocale. On regarde maintenant la balise, une par une.
 *
 * L'arrêt se fait sur une ligne qui ne contient que `>` : dans une balise JSX, `=>` ne se trouve
 * jamais seul sur sa ligne, alors qu'il abonde dans les gestionnaires d'événements.
 */
/**
 * Le code **sans ses commentaires** : on compte des appels, pas les fois où le dépôt les raconte.
 * Le narratif de ce composant cite volontiers le code qu'il explique (« `setOuverte(false)` »), et un
 * décompte naïf y verrait trois appels là où il n'y en a qu'un.
 */
function sansCommentaires(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function baliseOuvrante(code: string, nom: string): string {
  const balise = code.match(new RegExp(`<${nom}\\n([\\s\\S]*?)\\n\\s*>`));
  expect(balise, `balise <${nom}> introuvable`).not.toBeNull();
  return balise![1];
}

const themes: EntreeListe[] = [
  { valeur: "", libelle: "aucun thème" },
  { valeur: "Épée longue", libelle: "Épée longue" },
  { valeur: "Épée et bocle", libelle: "Épée et bocle" },
  { valeur: "Messer", libelle: "Messer" },
  { valeur: "Dague", libelle: "Dague" },
  { valeur: "atelier:a1", libelle: "Botte de Nevers — Chloé Durand", groupe: "Programmer un atelier validé" },
  { valeur: "atelier:a2", libelle: "Lutte — Charlie 03", groupe: "Programmer un atelier validé" },
];

describe("grouper", () => {
  it("sépare les entrées libres du groupe « Programmer un atelier validé »", () => {
    const groupes = grouper(themes);
    expect(groupes.map((g) => g.intitule)).toEqual([null, "Programmer un atelier validé"]);
    expect(groupes[1].entrees.map((e) => e.entree.valeur)).toEqual(["atelier:a1", "atelier:a2"]);
  });
  it("garde pour chaque entrée son rang dans la liste à plat (c'est lui qui sert à naviguer)", () => {
    const rangs = grouper(themes).flatMap((g) => g.entrees.map((e) => e.index));
    expect(rangs).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it("ne numérote pas les intitulés de groupe : les flèches ne peuvent pas s'y arrêter", () => {
    const entrees = grouper(themes).flatMap((g) => g.entrees);
    expect(entrees).toHaveLength(themes.length);
  });
  it("ne rend aucun groupe pour une liste vide", () => {
    expect(grouper([])).toEqual([]);
  });
});

describe("indexDeValeur", () => {
  it("retrouve la valeur courante", () => {
    expect(indexDeValeur(themes, "Messer")).toBe(3);
    expect(indexDeValeur(themes, "")).toBe(0);
  });
  it("rend -1 pour une valeur absente (thème libre, personne désactivée)", () => {
    expect(indexDeValeur(themes, "Botte secrète")).toBe(-1);
  });
});

describe("indexApresTouche", () => {
  it("descend et remonte d'une entrée", () => {
    expect(indexApresTouche("ArrowDown", 2, themes.length)).toBe(3);
    expect(indexApresTouche("ArrowUp", 2, themes.length)).toBe(1);
  });
  it("ne boucle pas aux extrémités : on ne perd jamais sa place dans une liste longue", () => {
    expect(indexApresTouche("ArrowDown", themes.length - 1, themes.length)).toBe(themes.length - 1);
    expect(indexApresTouche("ArrowUp", 0, themes.length)).toBe(0);
  });
  it("part de la première entrée (flèche bas) ou de la dernière (flèche haut) quand rien n'est actif", () => {
    expect(indexApresTouche("ArrowDown", -1, themes.length)).toBe(0);
    expect(indexApresTouche("ArrowUp", -1, themes.length)).toBe(themes.length - 1);
  });
  it("Début et Fin vont aux extrémités", () => {
    expect(indexApresTouche("Home", 4, themes.length)).toBe(0);
    expect(indexApresTouche("End", 1, themes.length)).toBe(themes.length - 1);
  });
  it("laisse passer les touches qui ne la regardent pas", () => {
    for (const touche of ["Tab", "Enter", "Escape", "a", " "]) expect(indexApresTouche(touche, 1, themes.length)).toBeNull();
  });
  it("ne rend rien sur une liste vide", () => {
    expect(indexApresTouche("ArrowDown", -1, 0)).toBeNull();
  });
});

describe("recherche par frappe", () => {
  it("ignore accents et casse : personne ne tape « Épée » avec l'accent", () => {
    expect(normaliserPourFrappe("Épée longue")).toBe("epee longue");
    expect(indexParFrappe(themes, "epe", -1)).toBe(1);
    expect(indexParFrappe(themes, "ÉPÉE", -1)).toBe(1);
  });
  it("affine sans sauter l'entrée déjà visée", () => {
    expect(indexParFrappe(themes, "epee ", 1)).toBe(1);
    expect(indexParFrappe(themes, "epee e", 1)).toBe(2);
  });
  it("martelée, la même lettre passe à l'entrée suivante qui commence par elle", () => {
    expect(indexParFrappe(themes, "e", -1)).toBe(1);
    expect(indexParFrappe(themes, "ee", 1)).toBe(2);
    expect(indexParFrappe(themes, "eee", 2)).toBe(1); // recherche circulaire
  });
  it("rend null quand rien ne commence par la frappe", () => {
    expect(indexParFrappe(themes, "zz", -1)).toBeNull();
    expect(indexParFrappe(themes, "", 0)).toBeNull();
    expect(indexParFrappe([], "a", -1)).toBeNull();
  });
});

describe("le panneau s'ouvre vers le bas", () => {
  it("est posé sous le déclencheur", () => {
    expect(composant).toContain("top-full");
    expect(composant).toContain("absolute");
  });
  it("n'a aucune classe qui le placerait au-dessus", () => {
    for (const interdite of ["bottom-full", "bottom-0", "-translate-y-full", "flex-col-reverse"]) expect(composant).not.toContain(interdite);
  });
  it("est plafonné en hauteur et défile, au lieu de grandir jusqu'à sortir de l'écran", () => {
    expect(composant).toMatch(/max-h-(7[2-9]|8\d)/); // 18 rem ou plus, jamais moins
    expect(composant).toContain("overflow-y-auto");
  });
  it("fait exister la place sous le déclencheur plutôt que de retourner la liste", () => {
    expect(composant).toContain('scrollIntoView({ block: "nearest" })');
    expect(composant).toContain("window.scrollBy");
    expect(composant).toContain("getBoundingClientRect");
  });
});

describe("accessibilité du composant", () => {
  it("le déclencheur est un bouton nommé par le libellé existant", () => {
    expect(composant).toContain('type="button"');
    expect(composant).toContain('aria-haspopup="listbox"');
    expect(composant).toContain("aria-expanded={ouverte}");
    expect(composant).toContain("aria-labelledby={`${libelleId} ${id}`}");
  });
  it("le panneau est un listbox nommé, dont chaque entrée est une option", () => {
    expect(composant).toContain('role="listbox"');
    expect(composant).toContain("aria-label={libelle}");
    expect(composant).toContain('role="option"');
    expect(composant).toContain("aria-selected={entree.valeur === valeur}");
    expect(composant).toContain("aria-activedescendant=");
  });
  it("un intitulé de groupe ne se sélectionne pas", () => {
    expect(composant).toContain('role="presentation"');
  });
  it("chaque entrée tient la cible tactile du projet (48 px)", () => {
    expect(composant).toContain("min-h-12");
  });
  it("répond aux touches attendues d'une liste déroulante", () => {
    for (const touche of ['"Escape"', '"Tab"', '"Enter"', '"ArrowDown"', '"ArrowUp"']) expect(composant).toContain(touche);
    expect(composant).toContain("declencheur.current?.focus()"); // Échap et le choix rendent le focus
  });
  it("se referme sur un clic en dehors", () => {
    expect(composant).toContain('document.addEventListener("pointerdown"');
    expect(composant).toContain("enveloppe.current?.contains");
  });
});

describe("thème de l'application", () => {
  it("n'utilise que les couleurs nommées du projet : les douze thèmes suivent sans retouche", () => {
    expect(composant).toContain("bg-surface");
    expect(composant).toContain("border-bordure");
    // Aucune couleur écrite en dur (la seule couleur libre est celle d'identification d'une personne, reçue en prop)
    expect(composant).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(composant).not.toMatch(/\b(rgb|hsl)a?\(/);
  });
});

describe("les cases du planning n'ont plus de liste native", () => {
  it("les deux `<select>` ont disparu, optgroup compris", () => {
    expect(caseEditeur).not.toContain("<select");
    expect(caseEditeur).not.toContain("<optgroup");
  });
  it("les quatre listes sont le composant maîtrisé (instructeur, second instructeur, thème, niveau)", () => {
    expect(caseEditeur.match(/<ListeDeroulante/g)).toHaveLength(4);
  });
  it("les libellés masqués nomment toujours les champs, sur le même moule", () => {
    // La forme exacte compte : c'est par elle que les tests de bout en bout retrouvent une case
    // (`tests/e2e/planning-options.spec.ts`), le libellé de la partie étant désormais écrit à la
    // main et donc le seul repère lisible. L'identifiant du champ, lui, est celui de la partie.
    for (const champ of ["instructeur", "instructeur-second", "theme", "niveau"]) {
      const attendu = '<label className="sr-only" id={`${partieId}-CHAMP-libelle`} htmlFor={`${partieId}-CHAMP`}>'.replaceAll("CHAMP", champ);
      expect(caseEditeur, champ).toContain(attendu);
    }
  });
  it("les intitulés suivent la même formule « Champ — libellé de la partie »", () => {
    for (const intitule of ["Instructeur", "Second instructeur", "Thème", "Niveau"]) {
      expect(caseEditeur, intitule).toContain(intitule + " — ${label}");
    }
    // La description n'est pas une liste déroulante (pas de propriété `libelle`) : son nom accessible
    // vient de son `<label>` masqué, avec la même formule.
    expect(caseEditeur).toMatch(/Description — \{label\}/);
  });
  it("l'enregistrement, le thème libre et le dépliage des listes sont inchangés", () => {
    // Les **cinq** champs partent ensemble à chaque geste : sans le second instructeur — ou sans la
    // description, arrivée — dans l'envoi, le changer ne partirait jamais (`pairesEgales`).
    expect(caseEditeur).toContain("sauver({ instructeurId: v, instructeurSecondId: second, theme, description, niveau })");
    expect(caseEditeur).toContain("sauver({ instructeurId, instructeurSecondId: v, theme, description, niveau })");
    expect(caseEditeur).toContain("onChoisir={choisirTheme}");
    for (const liste of ["personnes", "seconds", "themes", "niveaux"]) expect(caseEditeur).toContain(`deplier("${liste}")`);
    expect(caseEditeur).toContain("personnesRendues(");
    expect(caseEditeur).toContain("themesRendus(");
    expect(caseEditeur).toContain("Autre…");
    expect(caseEditeur).toContain('placeholder="Thème libre"');
  });
  it("rien n'est posté par le navigateur : aucun champ caché n'a été ajouté", () => {
    // Tout passe par `onChoisir` puis une action serveur — un `<input type="hidden">` ne servirait à rien.
    expect(caseEditeur).not.toContain('type="hidden"');
  });
});


/**
 * **Au-delà de vingt entrées, une liste ne se déverse plus : elle se cherche.**
 *
 * Demandé par Delta devant les captures d'un club de quatre-vingts : « réduis les filtres affichés
 * si trop long (pour les gros clubs), jamais plus de 20 par 20 ». Dans une case du planning, la
 * liste des instructeurs *est* l'annuaire du club : quatre-vingt-une entrées à faire défiler dans
 * un panneau de 18 rem, sans autre moyen de viser un nom que le doigt.
 *
 * Le projet a déjà deux patrons, et il ne doit pas y en avoir un troisième : le repli
 * (`ListeRepliee`) et la **recherche côté client** (`AjoutMembresPeriode`). Une liste déroulante est
 * un `listbox` : on n'y glisse pas un bouton « Afficher les 61 autres » sans en casser la structure,
 * et cacher la moitié d'une liste qu'on doit parcourir ne ferait que déplacer le problème d'un clic.
 * C'est donc le second patron qui s'applique — et le seuil est celui des listes repliées, pas un
 * nombre de plus.
 */
const club = (n: number): EntreeListe[] => Array.from({ length: n }, (_, i) => ({ valeur: `p${i}`, libelle: `Prénom${i} Nom${i}` }));

describe("le seuil de la recherche", () => {
  it("est celui des listes repliées : une seule constante pour toute l'application", () => {
    expect(SEUIL_RECHERCHE).toBe(LIGNES_VISIBLES);
    expect(SEUIL_RECHERCHE).toBe(20);
  });
  it("ne change rien tant que la liste tient : aucun champ de recherche pour un club de douze", () => {
    expect(listeCherchable(themes)).toBe(false);
    expect(listeCherchable(club(20))).toBe(false);
    expect(listeCherchable([])).toBe(false);
  });
  it("s'arme à la vingt-et-unième entrée, et vaut donc pour l'annuaire d'un club de quatre-vingts", () => {
    expect(listeCherchable(club(21))).toBe(true);
    expect(listeCherchable(club(81))).toBe(true);
  });
});

describe("filtrerEntrees", () => {
  const gens: EntreeListe[] = [
    { valeur: "", libelle: "aucun" },
    { valeur: "a", libelle: "Chloé Durand" },
    { valeur: "b", libelle: "Charlie 03" },
    { valeur: "c", libelle: "Élise Chapuis" },
    { valeur: "d", libelle: "Botte de Nevers — Chloé Durand", groupe: "Programmer un atelier en attente" },
  ];
  it("rend la liste entière tant que rien n'est cherché", () => {
    expect(filtrerEntrees(gens, "")).toEqual(gens);
    expect(filtrerEntrees(gens, "   ")).toEqual(gens);
  });
  it("cherche n'importe où dans le libellé : on tape un nom de famille, pas un prénom", () => {
    expect(filtrerEntrees(gens, "durand").map((e) => e.valeur)).toEqual(["a", "d"]);
  });
  it("ignore accents et casse, comme la frappe sur une liste native", () => {
    expect(filtrerEntrees(gens, "ELISE").map((e) => e.valeur)).toEqual(["c"]);
    expect(filtrerEntrees(gens, "03").map((e) => e.valeur)).toEqual(["b"]);
  });
  it("croise les mots, dans n'importe quel ordre : « du ch » trouve « Chloé Durand »", () => {
    expect(filtrerEntrees(gens, "du ch").map((e) => e.valeur)).toEqual(["a", "d"]);
  });
  it("cherche aussi dans l'intitulé du groupe : « atelier » ramène les ateliers à programmer", () => {
    expect(filtrerEntrees(gens, "atelier").map((e) => e.valeur)).toEqual(["d"]);
  });
  it("rend une liste vide quand rien ne correspond (l'écran le dira, il ne fera pas semblant)", () => {
    expect(filtrerEntrees(gens, "zzz")).toEqual([]);
  });
  it("ne modifie jamais la liste reçue : elle est partagée par toutes les cases du planning", () => {
    const copie = [...gens];
    filtrerEntrees(gens, "durand");
    expect(gens).toEqual(copie);
  });
});

describe("le champ de recherche du panneau", () => {
  it("n'existe qu'au-delà du seuil : le composant interroge la règle commune", () => {
    expect(composant).toContain("listeCherchable(entrees)");
    // Recalé : le composant n'appelle plus `filtrerEntrees` en direct mais `entreesRecherchees`,
    // qui l'enveloppe pour garder `----------` en tête des résultats. Ce que ce test protège est
    // intact — le filtrage reste dans le module commun, jamais réécrit ici.
    expect(composant).toContain("entreesRecherchees(");
    expect(composant).not.toContain("filtrerEntrees(");
  });
  it("est une vraie zone de saisie de liste déroulante (motif combobox)", () => {
    // Sur la balise, et non « quelque part dans le fichier » : le déclencheur porte lui aussi
    // `role="combobox"`, et une vérification globale ne dirait plus lequel.
    const champ = baliseOuvrante(composant, "input");
    expect(champ).toContain('role="combobox"');
    expect(champ).toContain('aria-autocomplete="list"');
  });
  it("dit quand plus rien ne correspond, au lieu de laisser un panneau vide", () => {
    expect(composant).toContain("Aucun résultat");
  });
  it("« Aucun résultat » compte les vrais résultats : `----------`, épinglée, n'en est pas un", () => {
    // Le message tenait à `visibles.length === 0` — faux dès que l'écriture du vide reste en tête :
    // le panneau n'aurait plus eu un mot pour dire que la recherche n'avait rien trouvé.
    expect(composant).toContain("const aucunResultat =");
    expect(composant).toContain("visibles.every(estEntreeVide)");
    expect(composant).not.toContain('visibles.length === 0 ? "Aucun résultat"');
  });
  it("ne happe pas le clavier du téléphone : le curseur n'y va que si la liste a été ouverte au clavier", () => {
    expect(composant).toContain("focusChamp");
  });
  it("repart propre à chaque fermeture : la recherche d'hier ne filtre pas l'ouverture d'aujourd'hui", () => {
    expect(composant).toMatch(/const fermer = useCallback\(\(\) => \{[\s\S]*?setRecherche\(""\)/);
  });
});

/**
 * **Une frappe abandonnée ne doit pas pouvoir enregistrer quelqu'un d'autre.**
 *
 * Scénario reproduit, case « Instructeur » d'une partie portant « Chloé Durand » : j'ouvre, je tape
 * `charlie`, je clique ailleurs, je rouvre. Le panneau se rouvrait **encore filtré sur charlie** —
 * parce que le gestionnaire « clic ailleurs » appelait `setOuverte(false)` au lieu de `fermer()`,
 * seul à remettre la recherche à zéro. `indexDeValeur` ne trouvait alors plus Chloé dans la liste
 * filtrée, l'option active retombait sur 0 (Charlie), et comme le focus est resté sur le déclencheur,
 * **Entrée choisissait Charlie**. Le planning enregistre à chaque choix : écriture fausse en base et
 * dans le journal d'audit, sans confirmation, et sur la personne d'à côté.
 *
 * Le test d'alors vérifiait que `fermer()` vide la recherche — ce qui était vrai — mais **pas que
 * tous les chemins de fermeture l'appellent**. C'est cela qui est tenu ici : `setOuverte(false)` n'a
 * le droit d'exister qu'une seule fois dans le fichier, dans `fermer`. Tout chemin qui referme la
 * liste passe donc par la remise à zéro, y compris ceux qu'on écrira demain.
 */
describe("aucun chemin de fermeture ne peut oublier de vider la recherche", () => {
  it("le clic ailleurs referme par `fermer()`, et non par un `setOuverte(false)` isolé", () => {
    const dehors = composant.match(/const dehors = \(e: PointerEvent\) => \{[\s\S]*?\n {4}\};/)?.[0];
    expect(dehors, "gestionnaire « clic ailleurs » introuvable").toBeDefined();
    expect(dehors).toContain("fermer()");
    expect(dehors).not.toContain("setOuverte(");
  });

  it("`setOuverte(false)` n'est écrit qu'une fois, dans `fermer`", () => {
    expect(sansCommentaires(composant).match(/setOuverte\(false\)/g) ?? []).toHaveLength(1);
    expect(composant).toMatch(/const fermer = useCallback\(\(\) => \{\s*setOuverte\(false\)/);
  });

  it("la fermeture est stable d'un rendu à l'autre : l'écouteur « clic ailleurs » la reçoit en dépendance", () => {
    // Sans `useCallback`, l'effet se réabonnerait à chaque mouvement de souris dans le panneau
    // (`onPointerMove` change l'option active, donc le rendu) — et sans la dépendance, il garderait
    // une version périmée de `fermer`. Les deux vont ensemble.
    expect(composant).toMatch(/document\.addEventListener\("pointerdown", dehors\);[\s\S]*?\}, \[ouverte, fermer\]\);/);
  });
});

/**
 * **L'option active doit être annoncée par l'élément qui a le focus, sinon elle n'est pas annoncée.**
 *
 * `aria-activedescendant` ne vaut que sur l'élément focalisé : posé sur un `<ul>` que personne ne
 * focalise, il est **inerte**. Or le focus ne quitte le déclencheur que sur les listes cherchables,
 * c'est-à-dire au-delà de vingt entrées. **Sous le seuil — donc pour les quatre listes de chaque case
 * du planning d'un club de douze — la synthèse vocale n'annonçait aucune option** pendant qu'on
 * naviguait aux flèches, et Entrée enregistrait une valeur qui n'avait jamais été dite. Le club qui a
 * commandé l'outil était le seul à ne pas en profiter.
 *
 * Le test d'alors cherchait la chaîne `aria-activedescendant` n'importe où dans le fichier : elle y
 * était deux fois, sans jamais être utile.
 */
describe("l'option active est annoncée là où se trouve le focus", () => {
  it("le déclencheur est le combobox et porte l'option active : le focus ne le quitte jamais", () => {
    const bouton = baliseOuvrante(composant, "button");
    expect(bouton).toContain('role="combobox"');
    expect(bouton).toContain("aria-activedescendant=");
    expect(bouton).toContain("aria-expanded={ouverte}");
  });

  it("le `<ul>` ne le porte plus : sur un élément jamais focalisé, l'attribut ne dit rien à personne", () => {
    expect(baliseOuvrante(composant, "ul")).not.toContain("aria-activedescendant");
  });

  it("chaque option porte l'identifiant que le déclencheur désigne", () => {
    // Un `aria-activedescendant` qui pointe dans le vide est aussi muet qu'un attribut absent.
    expect(composant).toContain("id={idOption(index)}");
    expect(composant).toContain("const idOption = (index: number) =>");
  });
});

/**
 * **La tabulation doit repartir de la case, pas du haut de la page.**
 *
 * Scénario : liste cherchable (club de quatre-vingts), ouverte au clavier, le curseur est donc dans
 * le champ de recherche. Tab referme le panneau — et referme l'`<input>` **qui a le focus**. Un
 * élément démonté ne transmet rien : le focus retombait sur `<body>` et la tabulation suivante
 * repartait du premier lien de la page, à des dizaines de cases du planning de la case qu'on venait
 * de régler. On rend donc le focus au déclencheur *avant* de fermer ; le `Tab` du navigateur, qui
 * n'est pas empêché, continue alors sa route depuis la case.
 */
describe("Tab depuis le champ de recherche rend le focus avant de fermer", () => {
  it("le déclencheur reprend le focus, et la tabulation n'est pas empêchée", () => {
    const clavierChamp = composant.match(/const auClavierRecherche = [\s\S]*?\n  \};/)?.[0];
    expect(clavierChamp, "gestionnaire clavier du champ introuvable").toBeDefined();
    const tab = clavierChamp!.match(/if \(e\.key === "Tab"\) \{[\s\S]*?\n    \}/)?.[0];
    expect(tab, "branche Tab introuvable").toBeDefined();
    expect(tab).toContain("declencheur.current?.focus()");
    // Rendre le focus **puis** fermer : l'ordre inverse démonte l'input avant de l'avoir quitté.
    expect(tab!.indexOf("declencheur.current?.focus()")).toBeLessThan(tab!.indexOf("fermer()"));
    expect(tab).not.toContain("preventDefault");
  });
});

/**
 * **La place dégagée avant l'ouverture doit être celle du panneau, pas celle du plafond.**
 *
 * Le calcul réservait 18 rem quoi qu'il arrive. La liste des niveaux d'une case en compte **quatre** :
 * on faisait donc monter la page de 288 px pour un panneau qui en occupe 150. Sur la dernière ligne
 * du planning, l'écran sautait et la case qu'on visait n'était plus sous le doigt — exactement le
 * genre de saut que ce composant existe pour supprimer.
 */
describe("la place réservée au panneau suit la longueur de la liste", () => {
  it("ne réserve que la hauteur des quatre entrées d'une liste de niveaux", () => {
    // Quatre cibles tactiles de 48 px (3 rem) plus les marges de la zone défilante.
    expect(hauteurListeRem(4)).toBeCloseTo(12.5);
    expect(hauteurListeRem(4)).toBeLessThan(PANNEAU_MAX_REM);
  });

  it("garde le plafond pour les listes qui l'atteignent : un annuaire ne pousse pas la page de 4 m", () => {
    expect(hauteurListeRem(6)).toBe(PANNEAU_MAX_REM);
    expect(hauteurListeRem(81)).toBe(PANNEAU_MAX_REM);
  });

  it("réserve toujours au moins une entrée, même pour une liste vide (le message « Aucun résultat »)", () => {
    expect(hauteurListeRem(0)).toBeGreaterThan(0);
  });

  it("est le même plafond que la classe du `<ul>` : deux valeurs finiraient par diverger", () => {
    // `max-h-72` vaut 18 rem. Si l'une des deux bougeait seule, la place dégagée mentirait.
    expect(PANNEAU_MAX_REM).toBe(18);
    expect(composant).toContain("max-h-72");
  });
});

describe("tailles dynamiques des composants partagés", () => {
  const partages = { "ListeDeroulante.tsx": composant, "Tableau.tsx": tableau, "Pastille.tsx": pastille, "Icone.tsx": icone };
  it("aucune largeur ni hauteur figée en pixels dans une classe Tailwind", () => {
    // `min-w-[520px]`, `w-[300px]`… : une valeur en pixels ne suit ni la taille de caractères
    // choisie dans le navigateur, ni la place réellement disponible.
    for (const [nom, code] of Object.entries(partages)) expect(code, nom).not.toMatch(/\b(min-|max-)?[wh]-\[[^\]]*px\]/);
  });
  it("aucune largeur imposée plus large qu'un téléphone de 390 px", () => {
    // Une `min-width` sans préfixe de rupture s'applique aussi au téléphone : elle y forcerait un
    // défilement horizontal de la page entière.
    for (const [nom, code] of Object.entries(partages)) {
      for (const m of code.matchAll(/(?<!:)\bmin-w-\[?([\d.]+)(rem|px)?/g)) {
        const valeur = Number(m[1]) * (m[2] === "px" ? 1 : m[2] === "rem" ? 16 : 4);
        expect(valeur, `${nom} — ${m[0]}`).toBeLessThanOrEqual(390);
      }
    }
  });
  it("la place à dégager sous le panneau se calcule en rem, pas en pixels figés", () => {
    // 18 rem valent 288 px tant que personne n'a grossi les caractères de son navigateur ; la
    // constante en pixels mentait dès qu'on y touchait, et le panneau repassait sous la fenêtre.
    expect(composant).not.toContain("const HAUTEUR_PANNEAU = 288");
    expect(composant).toContain("documentElement");
  });
  it("la pastille et l'icône suivent la taille de caractères du navigateur", () => {
    expect(pastille).toContain("rem");
    expect(icone).toContain("rem");
  });
});

/**
 * **`----------` doit rester atteignable pendant une recherche, sans jamais être ce qu'Entrée choisit.**
 *
 * Défaut constaté sur la case « Instructeur » d'un club de quatre-vingts. `----------`
 * (`LIBELLE_VIDE`) est l'unique écriture du vide, en tête de chaque liste. C'est une entrée comme
 * les autres, et son libellé ne correspond à aucune recherche : dès la première lettre tapée,
 * `filtrerEntrees` l'écarte. **Vider une case demandait donc d'effacer sa frappe d'abord** — un
 * geste que rien à l'écran n'indique, sur un panneau qui affiche « Aucun résultat » quand on
 * cherche « vide » ou « aucun ».
 *
 * Et le piège de la correction évidente : épingler `----------` en **tête des résultats** en faisant de
 * lui l'entrée active (c'est ce que faisait `chercher`, qui posait l'option active sur le premier
 * résultat). Taper `charlie` puis appuyer sur Entrée aurait alors **vidé la case** au lieu de choisir
 * Charlie — et le planning enregistre à chaque choix : une frappe naturelle aurait effacé une donnée.
 *
 * D'où la règle tenue ici : l'entrée de vidage est **épinglée dans les résultats** (donc parcourue par
 * les flèches, comptée par `aria-activedescendant`, cliquable à 48 px), mais **l'entrée active est
 * toujours le premier vrai résultat**.
 */
describe("l'écriture du vide pendant une recherche", () => {
  /**
   * **La personne qu'on cherche, et la frappe qui la vise — prise sur son libellé.**
   *
   * Les trois lettres étaient écrites à la main (« bru »), c'est-à-dire que le jeu d'essai portait
   * **deux écritures du même nom** : l'entrée et la frappe censée la trouver. Renommer la personne
   * n'en changeait qu'une — la frappe ne désignait plus personne, le filtre ne rendait rien, et les
   * tests de ce bloc tombaient alors que ni `filtrerEntrees` ni `entreesRecherchees` n'avaient bougé.
   * Dérivée du libellé, elle suit le nom. Ce qu'elle vérifie est intact : une recherche qui ramène
   * **un seul vrai résultat**, l'entrée de vidage mise à part.
   */
  const CHERCHEE: EntreeListe = { valeur: "charlie", libelle: "Charlie 03" };
  const FRAPPE = CHERCHEE.libelle.slice(0, 3).toLowerCase();
  const annuaire: EntreeListe[] = [
    { valeur: "", libelle: LIBELLE_VIDE },
    { valeur: "chloe", libelle: "Chloé Durand" },
    CHERCHEE,
    ...club(20),
  ];
  /** Ce que le composant calcule à chaque frappe : les entrées montrées, puis l'entrée active. */
  const frapper = (recherche: string, valeur = "chloe") => {
    const visibles = entreesRecherchees(annuaire, recherche);
    return { visibles, actif: indexActifRecherche(visibles, recherche, valeur) };
  };

  it("la liste est bien de celles qui reçoivent une recherche (sinon le défaut n'existe pas)", () => {
    expect(listeCherchable(annuaire)).toBe(true);
  });

  it("le filtre seul l'écarte dès la première lettre : c'est le défaut", () => {
    // `filtrerEntrees` reste ce qu'il est — une recherche sur les libellés. La correction vit au-dessus.
    expect(filtrerEntrees(annuaire, FRAPPE).some(estEntreeVide)).toBe(false);
  });

  it("reste en tête des entrées montrées : on vide une case sans effacer sa recherche", () => {
    const { visibles } = frapper(FRAPPE);
    expect(visibles.map((e) => e.valeur)).toEqual(["", CHERCHEE.valeur]);
    expect(visibles[0].libelle).toBe(LIBELLE_VIDE);
  });

  it("taper un nom puis Entrée choisit ce nom, jamais le vide (le piège)", () => {
    const { visibles, actif } = frapper(FRAPPE);
    // `choisir(actif)` lit `visibles[actif]` : c'est cette entrée-là que le planning enregistre.
    expect(visibles[actif].valeur).toBe(CHERCHEE.valeur);
    expect(estEntreeVide(visibles[actif])).toBe(false);
  });

  it("l'entrée de vidage est à un coup de flèche haut du premier résultat", () => {
    const { visibles, actif } = frapper(FRAPPE);
    const remonte = indexApresTouche("ArrowUp", actif, visibles.length);
    expect(remonte).not.toBeNull();
    expect(estEntreeVide(visibles[remonte!])).toBe(true);
  });

  it("quand rien ne correspond, elle reste seule et rien n'est actif : Entrée n'écrit pas", () => {
    const { visibles, actif } = frapper("zzz");
    expect(visibles.map((e) => e.valeur)).toEqual([""]);
    expect(actif).toBe(-1);
    expect(visibles[actif]).toBeUndefined();
  });

  it("champ vidé : on retrouve la liste entière et la valeur courante active, comme à l'ouverture", () => {
    const { visibles, actif } = frapper("");
    expect(visibles).toEqual(annuaire);
    expect(visibles[actif].valeur).toBe("chloe");
  });

  it("ne change rien à une liste sans écriture du vide (les niveaux, la liste des thèmes libres)", () => {
    const sansVide = club(21);
    expect(entreesRecherchees(sansVide, "Nom3")).toEqual(filtrerEntrees(sansVide, "Nom3"));
    expect(indexActifRecherche(entreesRecherchees(sansVide, "Nom3"), "Nom3", "p3")).toBe(0);
  });

  it("n'épingle pas un doublon quand la recherche la ramène d'elle-même", () => {
    const vide: EntreeListe[] = [{ valeur: "", libelle: "aucun thème" }, ...club(20)];
    expect(entreesRecherchees(vide, "aucun").filter(estEntreeVide)).toHaveLength(1);
  });

  it("la liste à plat que suivent les flèches reste celle qui est rendue", () => {
    // Un index qui pointe une entrée absente de l'arbre est un défaut d'accessibilité silencieux :
    // `aria-activedescendant` désignerait un `id` qui n'existe pas.
    const { visibles } = frapper("du");
    const rendues = grouper(visibles).flatMap((g) => g.entrees);
    expect(rendues.map((e) => e.index)).toEqual(visibles.map((_, i) => i));
    for (const { entree, index } of rendues) expect(visibles[index]).toBe(entree);
  });

  it("ne modifie jamais la liste reçue : elle est partagée par toutes les cases du planning", () => {
    const copie = [...annuaire];
    entreesRecherchees(annuaire, FRAPPE);
    expect(annuaire).toEqual(copie);
  });
});

describe("le composant s'en remet à ces deux règles, et ne repose plus l'option active sur le premier résultat", () => {
  it("les entrées montrées sont celles d'`entreesRecherchees`", () => {
    expect(composant).toContain("entreesRecherchees(entrees, recherche)");
  });
  it("l'entrée active est celle d'`indexActifRecherche`, à chaque frappe comme à la première lettre", () => {
    expect(composant.match(/indexActifRecherche\(/g) ?? []).toHaveLength(3);
  });
  it("plus aucune option active posée sur « le premier résultat » : c'est elle qui aurait vidé la case", () => {
    const code = sansCommentaires(composant);
    // Ni `setActif(0)`, ni le ternaire d'avant (`… .length > 0 ? 0 : -1`), ni un `ouvrir(0`.
    expect(code).not.toMatch(/setActif\(\s*0\s*\)/);
    expect(code).not.toMatch(/\?\s*0\s*:\s*-1/);
    expect(code).not.toMatch(/ouvrir\(\s*0\b/);
    // La frappe passe par la règle commune, et par elle seule.
    const chercher = code.match(/const chercher = \(texte: string\) => \{[\s\S]*?\n {2}\};/)?.[0];
    expect(chercher, "`chercher` introuvable").toBeDefined();
    expect(chercher).toContain("actifPourFrappe(texte)");
  });
});
