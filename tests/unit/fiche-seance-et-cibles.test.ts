import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { devoilement, libelleAfficher, SEANCES_VISIBLES } from "@/components/seances/listes";
import { AFFICHE_TAILLE_MAX, AFFICHE_TAILLE_MAX_LIBELLE, AFFICHE_TAILLE_MAX_MO } from "@/lib/constants";

/**
 * **Cinq promesses d'écran, tenues là où elles se vérifient sans navigateur.**
 *
 * Chacune est la réparation d'un écran qui annonçait une chose et en faisait une autre :
 *
 * 1. **Un seul éditeur par champ sur un écran.** La fiche d'une séance en avait deux pour le thème et
 *    l'alternative, et celui du haut écrasait le travail fait en bas.
 * 2. **« Afficher les -2 cours suivants ».** La liste des séances tenait son propre repli, sans rien
 *    emprunter au patron partagé, et son état survivait au changement d'onglet.
 * 3. **Une région vivante est montée avant son premier texte.** La confirmation d'une réponse de
 *    présence était muette dès le second appui — la seule action d'un membre dans tout l'outil.
 * 4. **Un plafond annoncé et son plafond technique sont reliés par un test.** « 4 Mo » était écrit à
 *    la main dans les écrans de dépôt, à côté d'une constante qu'ils ne lisaient pas.
 * 5. **Cibles tactiles de 48 px.** La passe du jour avait laissé des 44 px, et un 36 px sur l'en-tête,
 *    donc sur toutes les pages et pour tout le monde.
 *
 * On lit la source : ce sont des classes CSS et des structures de JSX, elles ne se vérifient pas au
 * rendu sans navigateur (même méthode que `cibles-et-annonces.test.ts` et `bandes-pleine-largeur.test.ts`).
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

/**
 * **Le fichier sans ses commentaires** : ce qui reste est ce que le navigateur reçoit.
 *
 * Nécessaire parce que chaque correctif **cite** dans son commentaire ce qu'il remplace (« elle
 * s'était arrêtée à 44 », « `min-h-9` », « 4 Mo ») : chercher la chaîne dans le source brut trouverait
 * l'explication du correctif et ferait échouer sa propre garde.
 */
const sansCommentaires = (fichier: string): string =>
  source(fichier)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

const FORMULAIRE_SEANCE = "src/components/gestion/FormulaireSeance.tsx";
const FICHE = "src/app/(app)/seances/[id]/page.tsx";
const NOUVELLE = "src/app/(app)/seances/nouvelle/page.tsx";
const AUTOSAVE = "src/app/(app)/seances/[id]/ThemeAutosave.tsx";
const LISTE_SEANCES = "src/components/seances/ListeSeances.tsx";
const BOUTONS = "src/components/seances/BoutonsPresence.tsx";
const CHAMP_AFFICHE = "src/components/evenements/ChampAffiche.tsx";
const CONSTANTES = "src/lib/constants.ts";
const AFFICHES = "src/lib/affiches.ts";
const SELECTEUR_ROLE = "src/app/(app)/admin/membres/SelecteurRole.tsx";

/* ------------------------------------------------------------------ */
/* 1. Un seul éditeur du thème sur la fiche d'une séance               */
/* ------------------------------------------------------------------ */

/**
 * **Le défaut, joué de bout en bout.** Deux éditeurs du même champ sur le même écran : celui du bas
 * est un champ non contrôlé avec clé de remontage (il suit donc le serveur), celui du haut un état
 * semé au montage (il ne le suit pas). Le modèle est réduit à ça, parce que c'est ça qui perd la donnée.
 */
class Serveur {
  theme = "Messer";
  alternative = "";
  /** L'autosave du haut : elle envoie **ses deux valeurs**, celle qu'on n'a pas touchée comprise. */
  enregistrerTheme(v: { theme: string; alternative: string }) {
    this.theme = v.theme;
    this.alternative = v.alternative;
  }
  /** Le formulaire du bas : il poste tout son contenu, thème compris. */
  modifierSeance(v: { theme: string; alternative: string }) {
    this.theme = v.theme;
    this.alternative = v.alternative;
  }
}

/** Le widget du haut : `useState({theme, alternative})`, semé une fois — ou suivant le serveur. */
class WidgetAutosave {
  valeurs: { theme: string; alternative: string };
  private miroir: { theme: string; alternative: string } | null;
  constructor(
    private serveur: Serveur,
    suitLeServeur: boolean,
  ) {
    this.valeurs = { theme: serveur.theme, alternative: serveur.alternative };
    this.miroir = suitLeServeur ? { ...this.valeurs } : null;
  }
  /** Un rendu serveur arrive (l'action a invalidé le chemin de la page). */
  rendre() {
    if (!this.miroir) return; // état semé une fois pour toutes
    if (this.miroir.theme !== this.serveur.theme || this.miroir.alternative !== this.serveur.alternative) {
      this.miroir = { theme: this.serveur.theme, alternative: this.serveur.alternative };
      this.valeurs = { ...this.miroir };
    }
  }
  /** On tape dans l'un des deux champs : l'autosave part avec les deux. */
  saisir(champ: "theme" | "alternative", valeur: string) {
    this.valeurs = { ...this.valeurs, [champ]: valeur };
    this.serveur.enregistrerTheme(this.valeurs);
  }
}

/**
 * Le formulaire du bas. Ses champs visibles portent une clé de remontage, donc ils repartent de la
 * valeur du serveur à chaque rendu ; ses champs **cachés** (`value=`, pilotés) font la même chose,
 * sans laisser croire qu'on peut y saisir quelque chose.
 */
class FormulaireDuBas {
  constructor(
    private serveur: Serveur,
    /** Le thème est-il encore **saisissable** ici ? C'est toute la différence. */
    private editeLeTheme: boolean,
  ) {}
  private valeurs() {
    return { theme: this.serveur.theme, alternative: this.serveur.alternative };
  }
  saisirTheme(valeur: string) {
    if (!this.editeLeTheme) throw new Error("ce formulaire n'édite plus le thème");
    this.serveur.modifierSeance({ ...this.valeurs(), theme: valeur });
  }
  /** « Enregistrer » : le formulaire poste ce qu'il porte, y compris ses champs cachés. */
  enregistrer() {
    this.serveur.modifierSeance(this.valeurs());
  }
}

describe("la fiche d'une séance n'édite pas le thème à deux endroits", () => {
  it("à deux éditeurs, celui du haut écrase ce que le bas vient d'enregistrer", () => {
    const serveur = new Serveur();
    const haut = new WidgetAutosave(serveur, false);
    const bas = new FormulaireDuBas(serveur, true);

    // On règle le thème en bas, et le champ du bas se remonte correctement.
    bas.saisirTheme("Dague");
    haut.rendre();
    expect(serveur.theme).toBe("Dague");
    // …mais le widget du haut affiche encore « Messer » : son état a été semé au montage.
    expect(haut.valeurs.theme).toBe("Messer");

    // On touche alors l'alternative en haut : l'autosave renvoie son thème périmé avec elle.
    haut.saisir("alternative", "Dague si effectif réduit");
    expect(serveur.theme, "« Dague » vient d'être écrasé sous un « Enregistré automatiquement »").toBe("Messer");
  });

  it("à un seul éditeur, le formulaire du bas ne peut plus rien écraser", () => {
    const serveur = new Serveur();
    const haut = new WidgetAutosave(serveur, true);
    // Le formulaire du bas n'édite plus le thème : il le **poste** tel que le serveur le dit.
    const bas = new FormulaireDuBas(serveur, false);

    haut.saisir("theme", "Dague");
    expect(serveur.theme).toBe("Dague");
    // On enregistre ensuite la date ou le lieu : le thème posté est celui du serveur, pas celui du montage.
    bas.enregistrer();
    expect(serveur.theme).toBe("Dague");
    // Et le miroir garde le widget d'accord avec le serveur, quoi qu'il arrive entre-temps.
    haut.rendre();
    expect(haut.valeurs.theme).toBe("Dague");
  });
});

describe("l'écran le dit comme le modèle : un seul éditeur, et l'autre poste", () => {
  it("le formulaire ne montre le thème qu'à la création", () => {
    const code = source(FORMULAIRE_SEANCE);
    // Le fichier porte deux branches « création » : la période (qui se lit en texte après coup) et
    // celle-ci, la dernière. C'est elle qui porte le champ.
    const creation = code.lastIndexOf("{creation ? (");
    const sinon = code.indexOf(") : (", creation);
    expect(creation).toBeGreaterThan(0);
    expect(sinon).toBeGreaterThan(creation);
    const position = code.indexOf('name="theme" id="seance-theme"');
    expect(position).toBeGreaterThan(creation);
    expect(position).toBeLessThan(sinon);
    // Un seul champ de saisie dans tout le fichier : deux en seraient deux éditeurs.
    expect((code.match(/<Champ label=[^>]*name="theme"/g) ?? []).length).toBe(1);
  });

  it("l'alternative ne se saisit plus nulle part : les options et cours du planning la remplacent", () => {
    for (const fichier of [FORMULAIRE_SEANCE, AUTOSAVE]) {
      expect(source(fichier), fichier).not.toMatch(/name="alternative"/);
    }
  });

  it("en modification, le thème est posté par un champ piloté — jamais par `defaultValue`", () => {
    const code = source(FORMULAIRE_SEANCE);
    expect(code).toContain('<input type="hidden" name="theme" value={valeurs.theme} />');
    // `defaultValue` sur un champ caché serait le défaut d'origine déguisé : figé au montage, il
    // reposterait la valeur du chargement de la page par-dessus celle que l'autosave vient d'écrire.
    expect(code).not.toMatch(/type="hidden"[^>]*defaultValue/);
    // Et le formulaire dit où ce champ se règle : un formulaire muet sur ce qu'il ne montre plus se
    // lit comme une régression.
    expect(code).toMatch(/se règle plus haut, dans « Programme »/);
  });

  it("la fiche monte l'autosave une fois, et son formulaire est celui de la modification", () => {
    const code = source(FICHE);
    expect(code.match(/<ThemeAutosave/g) ?? []).toHaveLength(1);
    // `creation` n'est pas passé : c'est la branche des champs cachés qui est rendue.
    expect(code.slice(code.indexOf("<FormulaireSeance"))).not.toContain("creation");
    // Et l'écran de création, lui, le passe : c'est là que les deux champs se saisissent.
    expect(source(NOUVELLE)).toContain("creation");
    // Le widget d'autosave n'existe pas à la création — la séance n'a pas encore d'identifiant.
    expect(source(NOUVELLE)).not.toContain("ThemeAutosave");
  });

  it("l'autosave est le seul à porter un champ de saisie pour ces deux noms", () => {
    // Deux `name="theme"` saisissables sur le même écran, c'est le défaut lui-même. Ici : un champ
    // dans l'autosave, un champ caché dans le formulaire.
    const champsSaisissables = (f: string) => (sansCommentaires(f).match(/<Champ [^>]*name="theme"/g) ?? []).length;
    expect(champsSaisissables(AUTOSAVE)).toBe(1);
    expect(champsSaisissables(FICHE)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Le repli de la liste des séances, par le patron commun           */
/* ------------------------------------------------------------------ */

describe("la liste des séances ne peut plus annoncer un nombre négatif", () => {
  /**
   * Le scénario exact : onglet « Passé » (23 cours) tout déplié, puis « À venir » (3 cours). Les
   * trois onglets sont la **même route** — rien ne remonte le composant, l'état du dévoilement
   * survit. C'est `devoilement` qui borne, et c'est pour ça qu'il faut passer par lui.
   */
  it("changer d'onglet ne produit ni bouton menteur ni nombre négatif", () => {
    // « Passé », tout déplié : on a demandé les 23 cours.
    const deplie = devoilement({ total: 23, demandees: 25, tranche: SEANCES_VISIBLES, debut: SEANCES_VISIBLES });
    expect(deplie.affichees).toBe(23);
    expect(deplie.restantes).toBe(0);

    // Puis « À venir », 3 cours, avec le même état retenu.
    const apres = devoilement({ total: 3, demandees: 25, tranche: SEANCES_VISIBLES, debut: SEANCES_VISIBLES });
    expect(apres.affichees).toBe(3);
    expect(apres.restantes).toBe(0);
    expect(apres.prochaine).toBe(0);
    // Rien à replier : les trois cartes tiennent sous le plafond.
    expect(apres.auDebut).toBe(true);
    // L'ancien calcul, celui du composant : `cartes.length - visibles`.
    expect(3 - SEANCES_VISIBLES).toBeLessThan(0);
    expect(libelleAfficher(apres.prochaine, "cours suivants")).not.toContain("-");
  });

  it("et dans l'autre sens, le bouton reparaît au lieu de tout dérouler d'un coup", () => {
    // « À venir » (3 cours, rien déplié) puis « Passé » (23) : on revoit cinq cartes et un bouton.
    const etat = devoilement({ total: 23, demandees: SEANCES_VISIBLES, tranche: SEANCES_VISIBLES, debut: SEANCES_VISIBLES });
    expect(etat.affichees).toBe(SEANCES_VISIBLES);
    expect(etat.restantes).toBe(18);
    // Le bouton annonce la tranche qu'il va montrer, jamais le reste entier.
    expect(etat.prochaine).toBe(SEANCES_VISIBLES);
    expect(libelleAfficher(etat.prochaine, "cours suivants")).toBe("Afficher les 5 cours suivants");
  });

  it("le composant n'a plus d'état à lui : il lit le patron partagé", () => {
    const code = source(LISTE_SEANCES);
    // Plus aucun `useState` : c'est `useDevoilement` qui tient le seul état, borné par le total.
    expect(sansCommentaires(LISTE_SEANCES)).not.toContain("useState");
    expect(code).toMatch(/import \{ couper, libelleAfficher, libelleCompteur, LIBELLE_REPLIER, SEANCES_VISIBLES \} from "\.\/listes"/);
    expect(code).toMatch(/import \{ useDevoilement \} from "\.\/ListeRepliee"/);
    // Les quatre pièces du patron sont réellement utilisées, pas seulement importées.
    const sans = sansCommentaires(LISTE_SEANCES);
    expect(sans).toContain("couper(cartes, visibles)");
    expect(sans).toContain("useDevoilement(cartes.length");
    expect(sans).toContain('libelleAfficher(prochaine, "cours suivants")');
    expect(sans).toContain("{LIBELLE_REPLIER}");
    // Et le compte à la main a disparu : c'était lui qui écrivait « -2 ».
    expect(sans).not.toContain("cartes.length - visibles");
  });

  it("aucun bouton tant que la liste tient, et le compteur est monté avec les boutons", () => {
    const sans = sansCommentaires(LISTE_SEANCES);
    // Le bloc entier dépend de ce qui est caché, jamais d'un appui déjà fait : une région `aria-live`
    // ajoutée en même temps que son texte n'est pas annoncée.
    expect(sans).toContain("{cachees.length > 0 && (");
    expect(sans).toMatch(/<p aria-live="polite"[^>]*>\s*\{libelleCompteur\(affichees, cartes\.length, "cours"\)\}/);
    // « Replier » n'apparaît qu'une fois quelque chose de dévoilé.
    expect(sans).toContain("{!auDebut && (");
  });
});

/* ------------------------------------------------------------------ */
/* 3. La confirmation d'une réponse de présence                        */
/* ------------------------------------------------------------------ */

describe("la confirmation d'une réponse est annoncée à chaque appui", () => {
  it("la région vivante est montée en permanence, pas créée avec son texte", () => {
    const sans = sansCommentaires(BOUTONS);
    // Le paragraphe est une instruction du rendu, jamais l'enfant d'un `&&`.
    expect(sans).toMatch(/^\s*<p className="min-h-6 text-texte-secondaire" aria-live="polite">$/m);
    expect(sans).not.toMatch(/&&\s*\(\s*<p[^>]*aria-live/);
    // La condition qui la créait — le défaut exact, relevé.
    expect(sans).not.toContain("{(message || verrouille || !optimiste) && (");
  });

  it("la place du message est tenue même vide : les trois boutons ne changent plus de taille", () => {
    const sans = sansCommentaires(BOUTONS);
    // `h-full` sur la grille fait épouser aux boutons la hauteur de leur colonne : un paragraphe qui
    // apparaît et disparaît leur faisait perdre puis reprendre une trentaine de pixels à chaque appui.
    expect(sans).toContain('className="grid h-full grid-cols-3 gap-2"');
    expect(sans).toContain('className="min-h-6 text-texte-secondaire"');
    // Le dernier cas rendu à l'intérieur du paragraphe, et non autour de lui.
    expect(sans).toMatch(/: !optimiste \? \(/);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Le plafond des images : une valeur, un endroit, une phrase       */
/* ------------------------------------------------------------------ */

describe("le plafond annoncé à l'écran est celui que le serveur applique", () => {
  it("la valeur et le libellé se déduisent du même nombre de mégaoctets", () => {
    expect(AFFICHE_TAILLE_MAX).toBe(AFFICHE_TAILLE_MAX_MO * 1024 * 1024);
    expect(AFFICHE_TAILLE_MAX_LIBELLE).toBe(`${AFFICHE_TAILLE_MAX_MO} Mo`);
    // La valeur du jour, pour que la relire soit un geste et non une enquête.
    expect(AFFICHE_TAILLE_MAX_MO).toBe(4);
  });

  it("elle vit dans le module qui ne dépend de rien, et `affiches.ts` la relaie", () => {
    // **Piège du build** : un composant client qui importe un module menant à `settings.ts` entraîne
    // `node:crypto` dans le paquet du navigateur et casse `npm run build`, que ni `tsc` ni `vitest`
    // ne voient. `constants.ts` n'importe rien — c'est ce qui le rend lisible des deux côtés.
    const constantes = source(CONSTANTES);
    expect(constantes).toMatch(/export const AFFICHE_TAILLE_MAX_MO = \d+;/);
    expect(constantes).toMatch(/export const AFFICHE_TAILLE_MAX = AFFICHE_TAILLE_MAX_MO \* 1024 \* 1024;/);
    expect(constantes).not.toMatch(/^import /m);
    // Le serveur continue de la lire depuis `affiches.ts`, où vit le reste du dépôt d'images.
    expect(source(AFFICHES)).toMatch(/export \{ AFFICHE_TAILLE_MAX, AFFICHE_TAILLE_MAX_LIBELLE \} from "\.\/constants";/);
  });

  it("l'écran de dépôt d'une affiche ne recopie plus le plafond, ni en octets ni en mots", () => {
    const sans = sansCommentaires(CHAMP_AFFICHE);
    // Ni le nombre d'octets…
    expect(sans).not.toMatch(/1024 \* 1024/);
    // …ni la phrase : « 4 Mo » écrit à la main était la façon la plus simple de mentir à l'écran.
    expect(sans).not.toMatch(/\d+\s*Mo/);
    // Les deux usages : le refus décidé côté navigateur, et la promesse écrite dans la zone de dépôt.
    expect(sans).toContain("fichier.size > AFFICHE_TAILLE_MAX");
    expect(sans).toContain("L'affiche dépasse ${AFFICHE_TAILLE_MAX_LIBELLE}");
    expect(sans).toContain("{AFFICHE_TAILLE_MAX_LIBELLE} maximum)");
    expect(source(CHAMP_AFFICHE)).toMatch(/from "@\/lib\/constants"/);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Cibles tactiles : 48 px, y compris sur l'en-tête                 */
/* ------------------------------------------------------------------ */

/**
 * Les écrans de la passe du soir. `min-h-11` vaut 44 px, `min-h-9` en vaut 36 : le cahier des charges
 * ne connaît qu'un seul chiffre (48 px, soit `min-h-12`), et une cible qui grandit ne se vise jamais
 * plus mal.
 */
const A_QUARANTE_HUIT = [
  "src/app/(app)/seances/page.tsx",
  FICHE,
  "src/components/seances/CarteSeance.tsx",
  "src/components/seances/ListeParticipants.tsx",
  "src/components/accueil/VueAccueil.tsx",
  "src/components/evenements/PanneauEvenements.tsx",
  "src/components/evenements/CarteEvenement.tsx",
  "src/components/evenements/DescriptionEvenement.tsx",
  CHAMP_AFFICHE,
  SELECTEUR_ROLE,
];

describe("la passe des 48 px est finie dans ces écrans", () => {
  it.each(A_QUARANTE_HUIT)("%s ne garde aucune cible de 44 ni de 36 px", (fichier) => {
    const sans = sansCommentaires(fichier);
    expect(sans, fichier).not.toContain("min-h-11");
    expect(sans, fichier).not.toContain("min-h-10");
    expect(sans, fichier).not.toContain("min-h-9");
  });

  it("la bascule « À venir / Passés » de l'en-tête, la plus petite de l'application, fait 48 px", () => {
    // Elle est sur **toutes** les pages et pour tout le monde : c'était la cible la plus visitée et la
    // plus petite à la fois.
    const code = source("src/components/evenements/PanneauEvenements.tsx");
    expect(code).toMatch(/className=\{`flex min-h-12 items-center rounded-full px-3 \$\{q === quand/);
    // Et le bouton qui ouvre le volet reste un carré, pas un rectangle de 48 × 44.
    expect(code).toContain("relative flex min-h-12 w-12 items-center justify-center rounded-full");
  });

  it("la liste déroulante du rôle est de la taille de la case cochée sur la même ligne", () => {
    const code = source(SELECTEUR_ROLE);
    expect(code).toContain("min-h-12 rounded-xl border-2");
    // 15 px sous un plancher de 16 : le texte d'un contrôle n'est pas un texte secondaire.
    expect(sansCommentaires(SELECTEUR_ROLE)).not.toContain("text-[0.9375rem]");
    expect(code).toContain("text-base font-semibold text-texte");
  });
});

/* ------------------------------------------------------------------ */
/* 6. Le seul message du sélecteur de rôle                             */
/* ------------------------------------------------------------------ */

describe("le refus du serveur sur un changement de rôle est dit à voix haute", () => {
  it("la région est montée en permanence, en 16 px, et se vide au lieu de disparaître", () => {
    const code = source(SELECTEUR_ROLE);
    expect(code).toContain('<span className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">');
    expect(code).toMatch(/\{erreur \?\? ""\}/);
    // L'ancien rendu : le paragraphe naissait avec son texte, donc n'était jamais annoncé — et il
    // était écrit en 12 px, alors que c'est la seule chose qui dise que le rôle **n'a pas** changé.
    expect(code).not.toMatch(/\{erreur && </);
    expect(sansCommentaires(SELECTEUR_ROLE)).not.toContain("text-xs");
  });
});
