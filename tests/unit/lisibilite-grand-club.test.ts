import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIGNES_VISIBLES } from "@/components/seances/listes";
import { trierMembres } from "@/app/(app)/gestion/tableau-de-bord/tri";

/**
 * **Les deux écrans que les captures d'un club de quatre-vingts ont cassés** : le tableau de bord
 * (`/gestion/tableau-de-bord`) et l'annuaire (`/admin/membres`).
 *
 * Ce que ce fichier protège n'est pas une mise en page — elle bougera — mais les quelques décisions
 * qui, défaites sans y penser, ramèneraient exactement les écrans des captures :
 *
 * 1. **Un club de douze ne voit rien changer.** Repli, recherche et repères alphabétiques sont tous
 *    conditionnés au même seuil partagé (`LIGNES_VISIBLES`), jamais posés d'office.
 * 2. **Le tri se lit comme la ligne s'écrit.** L'annuaire affiche « Prénom Nom » : il se trie sur
 *    « Prénom Nom », comme les listes de séance, et non sur le nom de famille — sinon la colonne a
 *    l'air non triée et on ne peut plus sauter à une lettre.
 * 3. **Aucune légende ne nomme une couleur.** Le thème du club est un réglage depuis la v0.51.0 :
 *    « bleu clair » était déjà faux en parchemin, où la couleur primaire est terracotta.
 * 4. **Les cibles tactiles sont des cibles tactiles**, y compris celles du tri.
 * 5. **L'annuaire range un tableau, et l'état du lien y est une colonne** : une ligne par personne
 *    pour de bon, et la question « qui n'est jamais entré ? » se lit en balayant une colonne. À
 *    quatre-vingts comptes, la poser en ouvrant quatre-vingts volets n'est pas une réponse. Le détail
 *    de ce tableau vit dans `tests/unit/annuaire-tableau.test.ts` ; ici on garde ce que le **grand
 *    club** exige de lui.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

const TABLEAU_DE_BORD = "src/app/(app)/gestion/tableau-de-bord/page.tsx";
const TABLEAU_MEMBRES = "src/app/(app)/gestion/tableau-de-bord/TableauMembres.tsx";
const ADMIN_MEMBRES = "src/app/(app)/admin/membres/page.tsx";
const IMPORT_CSV = "src/app/(app)/admin/membres/ImportCsv.tsx";

const membre = (prenom: string, nom: string, pourcentage = 50, sansReponse = 0) => ({ prenom, nom, pourcentage, sansReponse });

describe("le tri alphabétique suit ce que la ligne affiche", () => {
  it("classe sur « Prénom Nom », et non sur le nom de famille", () => {
    // Affichés « Alix Zimmer » et « Zoé Aaron », les deux lignes se lisent A puis Z. Triées sur le
    // nom de famille, elles sortaient dans l'ordre inverse — et la colonne semblait non triée.
    const liste = [membre("Zoé", "Aaron"), membre("Alix", "Zimmer")];
    expect(trierMembres(liste, "nom").map((m) => m.prenom)).toEqual(["Alix", "Zoé"]);
  });

  it("range les accents à leur place, pas à la fin", () => {
    const liste = [membre("Emma", "B"), membre("Élodie", "C"), membre("Eliot", "D")];
    expect(trierMembres(liste, "nom").map((m) => m.prenom)).toEqual(["Eliot", "Élodie", "Emma"]);
  });

  it("départage deux homonymes de prénom par le nom de famille", () => {
    const liste = [membre("Foxtrot", "Zola"), membre("Foxtrot", "Abel")];
    expect(trierMembres(liste, "nom").map((m) => m.nom)).toEqual(["Abel", "Zola"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const liste = [membre("Zoé", "Aaron"), membre("Alix", "Zimmer")];
    trierMembres(liste, "nom");
    expect(liste.map((m) => m.prenom)).toEqual(["Zoé", "Alix"]);
  });
});

describe("tableau de bord — « Taux par membre » dans un club de quatre-vingts", () => {
  it("confie le tableau à un composant client, l'écran restant serveur", () => {
    const code = source(TABLEAU_DE_BORD);
    expect(code).not.toContain('"use client"');
    expect(code).toContain("TableauMembres");
    expect(source(TABLEAU_MEMBRES)).toContain('"use client"');
  });

  it("reprend la recherche de `PresencesEquipe` et le repli des listes, sans troisième patron", () => {
    const code = source(TABLEAU_MEMBRES);
    expect(code).toContain('type="search"');
    // Les mots du bouton et le seuil viennent du module partagé, jamais réécrits sur place
    expect(code).toMatch(/from "@\/components\/seances\/listes"/);
    expect(code).toContain("libelleAfficher");
    expect(code).toContain("LIBELLE_REPLIER");
    expect(code).not.toMatch(/Afficher les \$\{/);
  });

  it("ne montre ni recherche ni repli tant que le tableau tient (le club de douze)", () => {
    const code = source(TABLEAU_MEMBRES);
    // Une seule et même condition, celle du reste de l'application
    expect(code).toMatch(/length > LIGNES_VISIBLES/);
    // Le dévoilement lui-même vient du patron partagé : ses lignes étant des `<tr>`, le tableau ne
    // peut pas monter `ListeRepliee`, il en reprend donc le crochet plutôt qu'une seconde mécanique.
    expect(code).toContain("useDevoilement");
  });

  it("colle l'en-tête du tableau sous celui de l'application", () => {
    const code = source(TABLEAU_MEMBRES);
    expect(code).toMatch(/<thead[^>]*sticky/);
    // `top-20` = la hauteur de l'en-tête collant (`h-20`), comme le volet des événements
    expect(code).toMatch(/<thead[^>]*top-20/);
  });

  it("garde « 100 % / 12 » sur une seule ligne : sinon les lignes ondulent", () => {
    // La cellule du taux porte `whitespace-nowrap` : c'est elle qui coupait en deux.
    expect(source(TABLEAU_MEMBRES)).toMatch(/whitespace-nowrap[^]{0,300}\{m\.pourcentage\}/);
  });

  it("le tri est une rangée de puces tapables, et dit laquelle est active", () => {
    const code = source(TABLEAU_DE_BORD);
    expect(code).toContain('aria-current');
    // Même puce que le sélecteur de fenêtre de temps : ronde, bordée, ≥ 44 px
    expect(code).toMatch(/rounded-full/);
    expect(code).toMatch(/min-h-11|min-h-12/);
    expect(code).toContain("bg-primaire");
  });
});

describe("tableau de bord — la légende ne nomme plus de couleur", () => {
  it("ne dit ni « or » ni « bleu clair » : le thème du club est un réglage", () => {
    const code = source(TABLEAU_DE_BORD);
    expect(code).not.toMatch(/bleu clair/i);
    expect(code).not.toMatch(/Or\s*:\s*séances/i);
  });

  it("montre la couleur au lieu de la nommer, et le texte porte le sens", () => {
    const code = source(TABLEAU_DE_BORD);
    // Deux pastilles décoratives (donc `aria-hidden`) suivies de leur libellé
    expect(code).toMatch(/aria-hidden[^]{0,120}bg-jauge/);
    expect(code).toMatch(/aria-hidden[^]{0,120}bg-primaire/);
  });

  it("donne toute la largeur à la barre sur téléphone : 21 % et 28 % doivent se distinguer", () => {
    const code = source(TABLEAU_DE_BORD);
    // La grille à trois colonnes fixes n'existe plus qu'à partir de `md`
    expect(code).not.toMatch(/grid-cols-\[7\.5rem_1fr_4\.5rem\](?!.*md:)/);
    expect(code).toMatch(/md:grid-cols-\[/);
  });
});

describe("annuaire — quatre-vingts comptes, une ligne par personne", () => {
  it("trie comme la ligne s'écrit et comme les listes de séance : par prénom", () => {
    expect(source(ADMIN_MEMBRES)).toContain('orderBy: [{ prenom: "asc" }, { nom: "asc" }]');
  });

  it("pose des repères alphabétiques — mais seulement au-delà du seuil partagé", () => {
    const code = source(ADMIN_MEMBRES);
    expect(code).toContain("LIGNES_VISIBLES");
    expect(code).toMatch(/> LIGNES_VISIBLES/);
  });

  it("replie les gestes derrière un volet : on lit d'abord, on déplie ensuite", () => {
    const code = source(ADMIN_MEMBRES);
    expect(code).toContain("Volet");
    // Un seul volet par personne : les gestes n'occupent plus la ligne
    expect(code).not.toContain('groupe="email-membre"');
  });

  it("une ligne par personne — et c'est maintenant une vraie ligne de tableau", () => {
    const code = source(ADMIN_MEMBRES);
    // Le patron du dépôt, jamais une seconde mécanique : une pile de fiches sur téléphone, un vrai
    // tableau au-delà du palier, **le même arbre**. Voir `tests/unit/annuaire-tableau.test.ts`.
    expect(code).toContain('from "@/components/ui/Tableau"');
    expect(code).toMatch(/<Ligne palier=/);
  });

  it("garde le repère alphabétique sur toute la largeur de la ligne", () => {
    const code = source(ADMIN_MEMBRES);
    // C'est l'outil du club de quatre-vingts : une lettre rangée dans la colonne des cases à cocher
    // ne se verrait plus, et on ne pourrait plus sauter à « M ».
    expect(code).toMatch(/colSpan=\{5\}[\s\S]{0,400}\{lettre\}/);
  });

  it("montre l'état du lien sans qu'on ouvre une seule fiche", () => {
    const code = source(ADMIN_MEMBRES);
    // À quatre-vingts comptes, « qui n'a jamais ouvert son lien ? » ne peut pas se payer
    // quatre-vingts volets : c'est une colonne, nourrie par une règle testée à part.
    expect(code).toContain('"État du lien"');
    expect(code).toContain("etatDuLien(");
  });

  it("met la recherche au-dessus de tout le reste, sous le titre", () => {
    const code = source(ADMIN_MEMBRES);
    const recherche = code.indexOf('label="Rechercher"');
    // Les gestes « pour tout le monde » vivent dans un seul composant, le volet du même motif que la
    // barre de sélection : c'est sa place dans la page qui compte, pas un libellé de bouton.
    const masse = code.indexOf("<ChoixToutLeMonde");
    expect(recherche).toBeGreaterThan(0);
    expect(masse).toBeGreaterThan(recherche);
  });

  it("garde « Désactiver tous les comptes » hors du chemin quotidien", () => {
    const code = source(ADMIN_MEMBRES);
    const liste = code.indexOf("membres.map(");
    const masse = code.indexOf("<ChoixToutLeMonde");
    expect(masse).toBeGreaterThan(liste);
    // Aucun rouge écrit en dur : ce volet ne supprime rien, et seuls révoquer et réinitialiser y sont
    // rouges, par la règle commune (`definitif`, vérifié dans couleurs-gestes.test.ts).
    expect(source("src/app/(app)/admin/membres/ChoixToutLeMonde.tsx")).not.toMatch(/variante="danger"/);
  });
});

describe("annuaire — cocher plusieurs comptes et changer leur rôle une fois", () => {
  const SELECTION = "src/app/(app)/admin/membres/SelectionRoles.tsx";
  const SELECTION_ROLES = "src/app/(app)/admin/membres/selection-roles.ts";
  const SELECTION_GESTES = "src/app/(app)/admin/membres/selection-gestes.ts";
  const ACTIONS = "src/app/(app)/admin/membres/actions.ts";

  it("reprend la mécanique de `/admin/presences` au lieu d'en écrire une seconde", () => {
    const code = source(SELECTION);
    // Cocher, décocher, case maîtresse à trois états, libellé qui nomme sa portée : tout vient de là
    expect(code).toMatch(/from "@\/components\/gestion\/selection-presences"/);
    // `restreindre` n'en fait plus partie, et c'est le correctif : il rabotait la sélection sur la
    // seule page affichée, donc une recherche effaçait des cases sans un mot, là où l'écran des
    // présences les garde. La règle retenue est celle des présences — la sélection survit
    // (`memoriserLignes` se souvient des pages vues) et ce qui reste dehors est compté et dit.
    for (const outil of [
      "basculer",
      "ajouter",
      "retirer",
      "etatToutCocher",
      "libelleToutSelectionner",
      "memoriserLignes",
      "compterHorsAffichage",
      "texteHorsAffichage",
    ]) {
      expect(code, outil).toContain(outil);
    }
    // La case maîtresse sait dire « certaines, pas toutes »
    expect(code).toContain("indeterminate");
  });

  it("ne coche jamais que ce qui est affiché, et le dit", () => {
    const code = source(SELECTION);
    // Le libellé vient du module partagé : il nomme sa portée (« les 12 résultats »), jamais « Tout »
    expect(code).toMatch(/libelleToutSelectionner\(selectionnables\.length, \{ recherche, replie: restants > 0 \}\)/);
    expect(code).not.toContain('"Tout sélectionner"');
    // Et ce qui reste hors de la page est annoncé
    expect(source(SELECTION_ROLES)).toContain("n'est pas sélectionné");
  });

  /**
   * **Une action de masse se montre avant qu'on ait deviné son geste d'entrée — mais pas en occupant
   * l'écran.** Deux décisions successives de Delta, et ce test garde les deux.
   *
   * **** : la barre n'était rendue qu'avec une case cochée, et Delta ne l'a pas trouvée sur
   * l'écran voisin, qui faisait pareil : « il manque le bouton de selection de status pour tous
   * ceux selectionnés non ? comme une bulk action present peut etre abscent ». Des cases à cocher
   * ne disent rien de ce qu'elles permettent : une fonctionnalité qui n'apparaît qu'après le geste
   * censé la révéler n'existe pas pour qui ne l'a pas deviné. La barre fut donc **toujours
   * montée**, inerte.
   *
   * ****, capture en main : « dans membre n'affiche cette section que si des users sont
   * sélectionnés ». Sur 390 px, la barre inerte mange trois lignes de la liste qu'on vient lire,
   * pour des boutons qui ne peuvent rien écrire. Elle **n'existe donc qu'avec une sélection** — et
   * ce que la veille résolvait ne disparaît pas pour autant : la phrase qui nomme le geste d'entrée
   * descend **à côté des cases**, et s'efface dès qu'une ligne est cochée.
   *
   * Ce que ce test interdit : laisser les cases seules, sans un mot de ce qu'elles permettent, et
   * recopier ici la condition d'affichage au lieu de la prendre au module partagé — les deux écrans
   * de masse doivent apparaître **au même moment**.
   */
  it("la barre de l'annuaire n'existe qu'avec une sélection, et la phrase du geste d'entrée vit près des cases", () => {
    const code = source(SELECTION);
    // La condition vient du module partagé avec les présences, jamais d'un `selection.size` recopié.
    expect(code).toContain("barreDeMasseVisible(selection)");
    // La barre de l'ordinateur, et celle du téléphone (`BarreSelection`) : toutes deux sous `montrerBarre`.
    expect(code).toMatch(/\{montrerBarre && !telephone && \(\s*<div\s+role="group"/);
    expect(code).toMatch(/\{montrerBarre && telephone && \(\s*<BarreSelection/);
    // L'unique bouton est inerte tant qu'aucun geste n'est choisi, et pendant une écriture : sans
    // sélection, il n'y a plus de barre du tout. Le bouton est celui de la forme commune
    // (`ChoixGeste`), qui ajoute l'écriture en cours à l'inertie que l'écran lui passe.
    expect(code).toMatch(/const boutonInerte = geste === ""/);
    expect(code).toContain("inerte={boutonInerte}");
    expect(code).toContain("enCours={enCours}");
    expect(source("src/components/ui/ChoixGeste.tsx")).toContain("disabled={inerte || enCours}");
    // Et la phrase du geste d'entrée est rendue **quand la barre ne l'est pas**.
    expect(code).toMatch(/\{!montrerBarre && <p[\s\S]{0,200}INVITE_SELECTION/);
    expect(source(SELECTION_GESTES)).toContain('texteInviteMasse("agir sur plusieurs personnes à la fois")');
    expect(code).toMatch(/\{selection\.size\} compte/);
    // Les deux seuls rôles attribuables, et pas un de plus
    expect(code).toMatch(/"INSTRUCTEUR"[\s\S]{0,200}"MEMBRE"/);
    expect(code).not.toContain('valeur: "ADMIN"');
  });

  /**
   * **La liste déroulante du lot n'applique rien au `change`**. C'étaient deux boutons, donc un
   * clic par rôle ; mais un rôle simplement **effleuré** dans une liste écrirait sur douze
   * personnes, et cela ne se rattrape pas ligne par ligne. C'est la différence assumée avec la
   * liste déroulante d'**une** ligne (`SelecteurRole`), qui enregistre au choix : elle porte sur
   * une personne, nommée, sous les yeux.
   */
  it("le rôle en masse se choisit dans une liste déroulante qui n'écrit qu'au bouton", () => {
    const code = source(SELECTION);
    // La liste du dépôt, jamais un `<select>` nu (elle s'ouvre toujours vers le bas). Le mot est
    // permis dans un commentaire — c'est justement là qu'on explique pourquoi on ne l'emploie pas.
    expect(code).toContain("<ListeDeroulante");
    expect(code.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/<select[\s>]/);
    // Elle ouvre sur l'absence de choix…
    expect(code).toContain('{ valeur: "", libelle: "Choisir un rôle…" }');
    // … le choix n'est que retenu…
    expect(code).toContain("onChoisir={setRoleChoisi}");
    // … et c'est le bouton qui écrit : inerte sans rôle (ou si le rôle choisi ne change personne),
    // et la garde tient aussi côté fonction.
    expect(code).toMatch(/geste === "role" && \(resumeRole === null \|\| resumeRole\.changent === 0\)/);
    expect(code).toMatch(/roleChoisi === ""\) return/);
    // Le choix du rôle n'apparaît que si « Changer le rôle… » est demandé.
    expect(code).toMatch(/\{geste === "role" && \(/);
  });

  /**
   * **Une barre collante de 350 px sur un écran de 390 recouvre la liste qu'elle sert**.
   *
   * La barre de l'annuaire porte cinq rangées sur un téléphone — compteur, liste de rôle et son
   * bouton, trois gestes d'accès, renvoi de lien. En `sticky`, elle couvre la moitié haute de la
   * liste, et comme la bande couverte **suit le défilement**, une ligne passée dessous ne peut plus
   * être cochée du tout : le clic atterrit sur un bouton de la barre. La mesure qui l'a établi : la
   * case d'un compte amenée au centre d'un écran de 844 px (y = 410) avait un bouton de la barre à
   * son point de clic — trouvé par la campagne de captures, soixante secondes d'essais sur un clic
   * impossible.
   *
   * Ce que ce test interdit : le retour du `sticky` **sans palier**. Il est légitime dès 640 px, où la
   * barre tient sur trois colonnes (~150 px) et où rester atteignable sans remonter vaut mieux.
   */
  it("ne colle la barre qu'à partir de 640 px : sur un téléphone, elle reste dans le flux", () => {
    const code = source(SELECTION);
    expect(code).toContain("sm:sticky sm:top-20");
    // Pas de `sticky` inconditionnel sur la barre : c'est exactement le défaut mesuré.
    expect(code).not.toMatch(/className="sticky top-20/);
  });

  it("confirme en disant ce qui sera écrit", () => {
    expect(source(SELECTION)).toMatch(/window\.confirm/);
  });

  it("l'action serveur tient les gardes du geste unitaire", () => {
    const code = source(ACTIONS);
    expect(code).toContain('"use server"');
    expect(code).toContain('assertPermission("members.manage")');
    expect(code).toContain("estCompteDeService");
    expect(code).toContain("canEditUser");
    expect(code).toMatch(/acteur\.id === cible\.id/);
    /*
     * **La frontière du bureau se lit sur `estAdmin`, jamais sur le rôle**. Cette ligne exigeait
     * `role === "ADMIN"` dans la source : depuis la migration `role` ne porte plus cette valeur, la
     * comparaison ne lève **plus jamais** — et l'exiger encore était une invitation à réécrire une
     * garde morte. Elle ne tenait d'ailleurs déjà plus rien : l'expression n'apparaît dans ce
     * fichier que **dans un commentaire**, et un `toMatch` ne fait pas la différence. Ce qui tient
     * vraiment la frontière, c'est `canEditUser` (vérifié deux lignes plus haut) **et** le
     * `estAdmin: true` du `select` : sans lui, Prisma passerait `undefined`, donc « pas du
     * bureau », et la garde se tairait au lieu de refuser.
     */
    expect(code).toMatch(/select: \{[^}]*estAdmin: true/);
    expect(code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")).not.toMatch(/role\s*[=!]==\s*"ADMIN"/);
    // Une transaction, et une entrée d'audit par personne
    expect(code).toContain("db.$transaction");
    expect(code).toMatch(/for \(const cible of aEcrire\) await audit\(/);
  });
});

describe("annuaire — l'import CSV parle français", () => {
  it("ne laisse plus le navigateur écrire « Choose File / No file chosen »", () => {
    const code = source(IMPORT_CSV);
    // Le contrôle natif reste (c'est lui qui porte le fichier), mais il est masqué à l'œil
    expect(code).toMatch(/type="file"[^]{0,400}sr-only|sr-only[^]{0,400}type="file"/);
    expect(code).toContain("Choisir un fichier");
    expect(code).toContain("Aucun fichier choisi");
  });
});

describe("le seuil reste le seuil", () => {
  it("les deux écrans n'inventent aucun plafond à eux", () => {
    for (const f of [TABLEAU_MEMBRES, ADMIN_MEMBRES]) {
      expect(source(f), f).toContain("LIGNES_VISIBLES");
      expect(source(f), f).not.toMatch(/length > (1[0-9]|2[0-9])\b/);
    }
    expect(LIGNES_VISIBLES).toBe(20);
  });
});
