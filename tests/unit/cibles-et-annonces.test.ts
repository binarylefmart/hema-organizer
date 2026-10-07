import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **La passe d'accessibilité, verrouillée là où elle se vérifie sans navigateur.**
 *
 * Ce fichier ne surveille pas une mise en page — elle bougera — mais les quelques décisions qui,
 * défaites sans y penser, ramèneraient exactement les défauts mesurés, avec à chaque fois **qui les
 * subissait** :
 *
 * 1. **La barre d'action des présences ne recouvre plus le menu du téléphone.** À `bottom-2` et à
 *    `z-index` égal avec la barre d'onglets, c'est la barre de sélection (peinte après) qui gagnait :
 *    tant qu'une personne était cochée, « Accueil / Séances / Profil » n'était plus tapable.
 * 2. **Les cases à cocher sont des cibles de 48 px.** Celle de l'annuaire faisait 20 × 44 px, à 12 px
 *    du lien qui ouvre la fiche : la rater ouvrait la fiche **et** perdait la sélection en cours.
 * 3. **Une région `aria-live` est montée avant son premier texte.** Créée avec son contenu, elle n'est
 *    pas annoncée : le compteur restait muet exactement à la première case cochée.
 * 4. **Les textes qui portent quelque chose ne descendent pas à 12 px** — l'avertissement de
 *    publication, les messages d'erreur, le jour/heure/lieu des cartes, les intitulés du panneau.
 * 5. **La couleur d'une personne ne teinte plus le texte d'une option** : calculée contre `--surface`,
 *    elle tombait à 3,80:1 (clair) et 3,91:1 (sombre) sur le fond de l'option active.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

const PRESENCES = "src/components/gestion/PresencesEquipe.tsx";
const ROLES = "src/app/(app)/admin/membres/SelectionRoles.tsx";
const NAVIGATION = "src/components/layout/Navigation.tsx";
const PARTIES = "src/components/planning/ListeParties.tsx";
const GRILLE = "src/components/planning/GrillePlanning.tsx";
const CASE = "src/components/planning/CaseEditeur.tsx";
const DEROULANTE = "src/components/ui/ListeDeroulante.tsx";
const BOUTON = "src/components/ui/Bouton.tsx";

/**
 * **Le fichier sans ses commentaires** : ce qui reste est ce que le navigateur reçoit.
 *
 * Nécessaire ici parce que chaque correctif **cite** dans son commentaire la classe qu'il remplace
 * (« `text-base` et non `text-xs`… ») : chercher la chaîne dans le source brut trouverait donc
 * l'explication du correctif et ferait échouer sa propre garde.
 */
const sansCommentaires = (fichier: string): string =>
  source(fichier)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

describe("la barre d'action collante ne recouvre pas la barre d'onglets du téléphone", () => {
  it("se pose au-dessus de la hauteur de la barre d'onglets, et redescend là où celle-ci n'existe plus", () => {
    const code = source(PRESENCES);
    expect(code).toContain("bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]");
    // Dès 768 px la barre d'onglets est cachée : la barre d'action reprend ses 8 px du bas.
    expect(code).toContain("ordi:bottom-2");
    // Et surtout : plus de `bottom-2` inconditionnel, qui était tout le défaut — le seul qui reste
    // est celui de `ordi:`, au-delà de la largeur où la barre d'onglets existe.
    expect(sansCommentaires(PRESENCES).match(/bottom-2/g) ?? []).toHaveLength(1);
  });

  it("décale d'exactement ce que mesure la barre d'onglets, zone sûre comprise", () => {
    // 5,5 rem couvre les 84 px de `NavBas` (min-h-14 + pt-2 + pb-5), et `env(safe-area-inset-bottom)`
    // suit la même variable qu'elle : si l'une change, l'autre doit changer.
    const nav = source(NAVIGATION);
    expect(nav).toContain("fixed inset-x-0 bottom-0 z-10");
    expect(nav).toContain("pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)]");
    expect(nav).toContain("ordi:hidden");
    expect(nav).toContain("min-h-14");
  });

  it("réserve à la liste la place que la barre lui prend, tant qu'une sélection est active", () => {
    // Sans quoi les dernières lignes cochées ne sortent de dessous la barre qu'au tout dernier
    // pixel de défilement de la page. La réserve suit **la même condition que la barre**
    // (`barreDeMasseVisible`) : réserver la place d'une barre absente creuserait un trou.
    // `masseVisible` = interrupteur « Sélection multiple » allumé **et** `barreDeMasseVisible`.
    expect(source(PRESENCES)).toContain("const masseVisible = interrupteur && barreDeMasseVisible(selection);");
    expect(source(PRESENCES)).toMatch(/masseVisible \? "pb-48 ordi:pb-0"/);
  });
});

describe("cocher une ligne est une cible de 48 px", () => {
  it("annuaire : la case d'une ligne est un carré de 48 px, la case elle-même fait 24 px", () => {
    // C'était `inline-flex min-h-11 shrink-0` autour d'un `size-5` : 20 × 44 px.
    expect(source(ROLES)).toContain("inline-flex min-h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center");
    expect(sansCommentaires(ROLES)).not.toContain("size-5");
    expect(sansCommentaires(ROLES)).not.toContain("min-h-11");
  });

  it("présences : la case maîtresse, les cases de ligne et la liste déroulante de réponse aussi", () => {
    const code = sansCommentaires(PRESENCES);
    expect(code).not.toContain("min-h-11");
    expect(code.match(/size-6 shrink-0 accent-primaire/g) ?? []).toHaveLength(2);
  });

  it("« petite » n'est plus un bouton de 44 px : la règle appartient au bouton, pas à ses appelants", () => {
    expect(source(BOUTON)).toMatch(/petite: "min-h-12 /);
    expect(sansCommentaires(BOUTON)).not.toContain("min-h-11");
  });

  it("le champ de recherche du panneau d'une liste déroulante suit ses propres entrées", () => {
    expect(sansCommentaires(DEROULANTE)).not.toContain("min-h-11");
  });
});

describe("ce que la sélection annonce est dit, y compris la première fois", () => {
  /*
   * Les deux barres d'action n'existent qu'avec une sélection : une région `aria-live` posée sur
   * leur compteur naîtrait **avec** sa première phrase, et ne serait donc pas annoncée. D'où une
   * région permanente, posée hors de la barre et vide quand rien n'est coché — exactement ce que
   * fait déjà le message de résultat des deux mêmes fichiers.
   */
  for (const [nom, fichier] of [
    ["présences", PRESENCES],
    ["rôles", ROLES],
  ] as const) {
    it(`${nom} : la région vivante du compteur est rendue en permanence, et vide quand rien n'est coché`, () => {
      const code = source(fichier);
      // Le motif ne s'accroche pas à la mise en forme : Prettier a coupé cette déclaration en
      // quatre lignes (l'ajout d'un `try/catch` a allongé le fichier), et le test a échoué sur un
      // retour à la ligne alors que rien du comportement n'avait bougé. On cherche la règle — le
      // compteur ne se calcule qu'avec une sélection —, pas l'espacement.
      expect(code).toMatch(/const compteurAnnonce =\s*\n?\s*selection\.size > 0/);
      // La région dit le compteur, et la phrase qui compte ce que le lot emporte hors de
      // l'affichage : c'est le même besoin — ce qu'un lecteur d'écran ne peut pas deviner.
      expect(code).toMatch(/<p className="sr-only" aria-live="polite">\n\s*\{\[?compteurAnnonce/);
      // La phrase visible ne la redit pas : deux régions vivantes pour un même compteur parlent deux fois.
      expect(code).not.toMatch(/className="font-semibold" aria-live/);
    });
  }

  it("la barre de masse de l'annuaire se nomme, comme sa jumelle des présences", () => {
    const code = source(ROLES);
    expect(code).toContain('role="group"');
    /*
     * **Le nom parle des quatre gestes, pas du seul rôle** : la barre porte désormais « Instructeur
     * / Membre » **et** « Désactiver / Réactiver / Supprimer ». Un nom qui n'annonce qu'un rôle
     * ferait chercher ailleurs les trois autres.
     */
    expect(code).toContain('aria-label="Agir sur plusieurs comptes à la fois"');
    /*
     * **Les deux noms disent ce que la barre fait, pas ce qu'elle regarde.** Ils ont été réécrits,
     * quand les barres étaient montées sans sélection ; ils restent justes maintenant qu'elles
     * n'apparaissent qu'avec elle — le compteur, lui, est déjà écrit en clair dans la barre.
     */
    expect(source(PRESENCES)).toContain('aria-label="Modifier la réponse de plusieurs personnes à la fois"');
  });

  /**
   * **Une action de masse se montre avant qu'on ait deviné son geste d'entrée — mais pas en occupant
   * l'écran.** Deux décisions successives de Delta, et ce test garde les deux.
   *
   * **** : la barre n'était rendue qu'avec une sélection, au motif qu'un petit club n'en a pas
   * l'usage. Delta, regardant cet écran : « il manque le bouton de sélection de statut pour tous
   * ceux sélectionnés, non ? comme une bulk action présent / peut-être / absent ». Les cases à
   * cocher ne disent rien de ce qu'elles permettent : une fonctionnalité qui n'apparaît qu'après le
   * geste qu'elle est censée révéler n'existe pas pour qui ne l'a pas deviné. La barre fut donc
   * **toujours montée**, sobre et inerte.
   *
   * ****, capture en main : « pour presence (admin) pareil, rends cette tuile visible uniquement si
   * quelqu'un est coché ». Sur 390 px, la tuile inerte prend ~200 px — trois lignes de la liste
   * qu'on vient lire — pour quatre boutons qui ne peuvent rien écrire.
   *
   * Ce que ce test garde, et c'est la seule lecture qui concilie les deux : la barre **n'existe
   * qu'avec une sélection**, par la fonction partagée avec l'annuaire (les deux écrans doivent
   * apparaître au même moment), **et la phrase qui nomme le geste d'entrée n'a pas disparu** — elle
   * vit à côté des cases. Ce qu'il interdit, c'est de laisser les cases seules, sans un mot.
   */
  it("la barre des présences n'existe qu'avec une sélection, et la phrase du geste d'entrée vit près des cases", () => {
    const code = source(PRESENCES);
    // La condition d'existence est celle du module partagé, jamais un `selection.size > 0` recopié ici.
    // Elle passe aussi par l'interrupteur « Sélection multiple » (`masseVisible`) : éteint, ni case ni barre.
    expect(code).toContain("const masseVisible = interrupteur && barreDeMasseVisible(selection);");
    // La barre de l'ordinateur, et celle du téléphone (`BarreSelection`) : toutes deux sous `masseVisible`.
    expect(code).toMatch(/\{masseVisible && !telephone \? \(\s*<div\s+role="group"/);
    expect(code).toMatch(/\{masseVisible && telephone \? \(\s*<BarreSelection/);
    expect(sansCommentaires(PRESENCES)).not.toMatch(/\{selection\.size > 0 \? \(\s*<div\s+role="group"/);
    // Les quatre réponses ne sont plus inertes que le temps d'une écriture : sans sélection, elles
    // ne sont plus là du tout.
    expect(code).toContain("disabled={lotEnVol}");
    expect(sansCommentaires(PRESENCES)).not.toContain("!enLot");
    // Et la phrase qui nomme le geste d'entrée est rendue **quand la barre ne l'est pas**.
    expect(code).toContain("INVITE_SELECTION");
    expect(code).toMatch(/\{!masseVisible \? \(/);
  });

  it("le compteur « 20 sur 80 » des présences est monté avec ses boutons, pas avec son texte", () => {
    const code = source(PRESENCES);
    // Le bloc entier est conditionné à la longueur de la liste, jamais à un appui déjà fait.
    expect(code).toMatch(/\{trouves\.length > LIGNES_VISIBLES \? \(/);
    expect(code).toContain("libelleCompteur(affichees, trouves.length)");
    // Il vit au bas de la **liste**, pas dans la barre d'action collante.
    expect(code.indexOf("libelleCompteur(")).toBeLessThan(code.indexOf("sticky bottom-"));
  });

  it("les erreurs de l'ajout d'une partie sont annoncées, comme celle d'une ligne", () => {
    const code = source(PARTIES);
    /*
     * **Trois** messages d'erreur dans le fichier, donc trois régions vivantes : celui de la ligne
     * d'un élément, celui du menu « Ajouter dans la partie N… » et celui du bouton « Ajouter une
     * partie » (parties et éléments).
     */
    expect(code.match(/font-semibold text-rouge empty:hidden" aria-live="polite"/g) ?? []).toHaveLength(3);
    // L'ancien rendu conditionnel, qui créait le paragraphe en même temps que son texte.
    expect(code).not.toMatch(/\{erreur && <p/);
  });

  it("le taux d'une carte du planning ne s'annonce plus « 13 barre oblique 18 »", () => {
    const code = source(GRILLE);
    expect(code).toMatch(/<span role="img" aria-label=\{etiquette\}/);
    expect(code).toMatch(/présent\$\{.*\} sur \$\{c\.compteurs\.invites\} invité/);
  });
});

describe("le focus ne tombe pas dans le vide quand une barre ou un formulaire disparaît", () => {
  it("les deux barres de sélection rendent le focus à la case maîtresse avant de se démonter", () => {
    for (const fichier of [PRESENCES, ROLES]) {
      const code = source(fichier);
      const focus = code.indexOf("caseMaitresse.current?.focus()");
      expect(focus, fichier).toBeGreaterThan(0);
      // Avant le vidage de la sélection, qui est ce qui démonte la barre.
      expect(code.indexOf("setSelection(new Set())", focus), fichier).toBeGreaterThan(focus);
    }
  });

  /**
   * **L'ajout d'une partie n'a plus rien à démonter, donc plus rien à rendre.**
   *
   * Il y avait ici une ancre de focus (`boutonAjout`) et l'effet qui la réalisait : fermer le
   * formulaire d'ajout démontait l'élément focalisé, et le focus retombait sur `<body>` — donc la
   * tabulation suivante repartait du premier lien de la page. Le formulaire a disparu avec le champ
   * du nom qu'il était seul à porter : les deux boutons d'ajout **restent en place** après le clic,
   * le focus ne bouge donc pas, et l'ancre serait du code mort.
   *
   * On garde le contrôle, à l'envers : ni ancre, ni effet, ni formulaire à refermer.
   */
  it("le menu et le bouton d'ajout restent en place : aucun focus à rendre", () => {
    const code = source(PARTIES);
    expect(code).not.toMatch(/boutonAjout/);
    expect(code).not.toMatch(/rendreLeFocus/);
    // Un choix ou un clic déclenche l'action, il n'ouvre rien — donc rien ne se démonte sous le
    // doigt. La nature et la partie voyagent avec l'appel.
    expect(code).toMatch(/onClick=\{\(\) => start\(\(\) => ajouterPartie\(\{ sessionId, bloc, nature: "COURS" \}\)\)\}/);
    expect(code).toContain("start(() => ajouterPartie({ sessionId, bloc, ...ajout }))");
  });
});

describe("plus de 12 px sur les textes qui portent quelque chose", () => {
  it("l'avertissement de publication et les erreurs d'une partie sont en 16 px", () => {
    for (const fichier of [PARTIES, GRILLE, DEROULANTE]) {
      expect(sansCommentaires(fichier), fichier).not.toContain("text-xs");
    }
    // La case du planning garde son `text-xs` pour la variante resserrée des fiches d'accueil ; son
    // message d'erreur, lui, en sort.
    expect(source(CASE)).toMatch(/text-base font-semibold text-rouge/);
  });
});

describe("la couleur d'une personne ne porte plus de texte dans une liste déroulante", () => {
  it("elle est passée sur une pastille, et le nom garde la couleur du texte courant", () => {
    const code = source(DEROULANTE);
    expect(code).toContain('style={{ backgroundColor: entree.couleur }}');
    // L'ancien rendu : `style={entree.couleur ? { color: entree.couleur } : undefined}`
    expect(code).not.toMatch(/\{ color: entree\.couleur \}/);
  });

  it("les intitulés de groupe sont des `group` de la listbox, et non des enfants sans rôle", () => {
    expect(source(DEROULANTE)).toMatch(/role="group" aria-label=\{groupe\.intitule\}/);
    expect(sansCommentaires(DEROULANTE)).not.toContain('<li role="presentation"');
  });
});
