import { LIGNES_VISIBLES } from "@/components/seances/listes";

/**
 * La logique de la liste déroulante maîtrisée, sans React ni DOM (voir `ListeDeroulante.tsx`).
 *
 * Elle vit dans un `.ts` à part pour une raison très concrète : les tests unitaires du projet ne
 * peuvent pas importer de `.tsx` (`jsx: "preserve"`), or c'est exactement ce qui mérite d'être
 * vérifié sans navigateur — la touche qui déplace l'option active, la liste à plat qu'on navigue
 * alors que l'écran, lui, montre des groupes, et la recherche par frappe sur une liste de vingt
 * thèmes. Le composant, lui, ne garde que le DOM et l'état.
 */

/** Une entrée de la liste. `valeur` est ce qui remonte au code appelant, jamais ce qui s'affiche. */
export type EntreeListe = {
  valeur: string;
  libelle: string;
  /**
   * Couleur d'identification d'une personne (`couleurPersonne`), portée par une **pastille** posée
   * devant le libellé — jamais par le texte lui-même.
   *
   * Ce sont les seules couleurs codées en clair de l'application, et elles sont calculées contre
   * `--surface` (cible 4,7:1). Or l'option **active** est sur `--primaire-doux` : le même texte y
   * tombait à 3,80:1 en thème clair et 3,91:1 en sombre, soit la moitié de la palette sous AA —
   * exactement sur la ligne qu'on est en train de choisir aux flèches. Sur une pastille, la couleur
   * n'a plus à tenir un contraste de texte (3:1 suffit à un élément graphique), et le nom garde
   * celui du texte courant sur les deux fonds. C'est ce que font déjà les listes nominatives du
   * projet (`PastillePersonne`).
   */
  couleur?: string;
  /** Intitulé du groupe auquel l'entrée appartient (« Programmer un atelier en attente »). */
  groupe?: string;
};

/** Un paquet d'entrées consécutives partageant le même intitulé de groupe (`null` = hors groupe). */
export type GroupeListe = { intitule: string | null; entrees: Array<{ entree: EntreeListe; index: number }> };

/**
 * Les entrées telles qu'on les **affiche** : en paquets précédés de leur intitulé.
 *
 * Chaque entrée garde son **index dans la liste à plat**, et c'est lui qui sert partout ailleurs
 * (option active, `aria-activedescendant`, choix). Un intitulé de groupe n'est pas une entrée : il
 * ne se sélectionne pas, il ne se survole pas, et les flèches passent par-dessus sans s'arrêter —
 * ce qu'on obtient gratuitement en ne le numérotant jamais.
 *
 * Les paquets suivent l'ordre d'arrivée : c'est l'appelant qui range ses entrées, pas nous.
 */
export function grouper(entrees: EntreeListe[]): GroupeListe[] {
  const groupes: GroupeListe[] = [];
  entrees.forEach((entree, index) => {
    const intitule = entree.groupe ?? null;
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.intitule === intitule) dernier.entrees.push({ entree, index });
    else groupes.push({ intitule, entrees: [{ entree, index }] });
  });
  return groupes;
}

/** Rang de la valeur courante, ou -1 si elle n'est pas (ou plus) dans la liste. */
export function indexDeValeur(entrees: EntreeListe[], valeur: string): number {
  return entrees.findIndex((e) => e.valeur === valeur);
}

/**
 * L'option active après une touche de navigation, ou `null` si la touche ne nous regarde pas
 * (le composant la laisse alors suivre son chemin : tabulation, frappe, raccourci du navigateur).
 *
 * **On ne boucle pas** de la dernière entrée à la première : sur la liste des thèmes, une vingtaine
 * d'entrées plus les ateliers, revenir brutalement en haut fait perdre l'endroit où l'on était.
 * Début et Fin y vont directement, et c'est plus sûr. `actuel = -1` (rien d'actif) : la flèche bas
 * prend la première entrée, la flèche haut la dernière.
 */
export function indexApresTouche(touche: string, actuel: number, total: number): number | null {
  if (total <= 0) return null;
  const borner = (i: number) => Math.max(0, Math.min(total - 1, i));
  switch (touche) {
    case "ArrowDown":
      return actuel < 0 ? 0 : borner(actuel + 1);
    case "ArrowUp":
      return actuel < 0 ? total - 1 : borner(actuel - 1);
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}

/**
 * Comparaison « à la française » pour la recherche au clavier : sans accents ni casse, parce que
 * personne ne tape « Épée » avec l'accent pour aller vite dans une liste.
 */
export function normaliserPourFrappe(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * L'entrée visée par ce qui vient d'être tapé, ou `null` si rien ne commence par là.
 *
 * Deux comportements, ceux d'une liste native, parce que les deux servent : on **continue** un mot
 * (« ép », « épé »…) et la recherche repart de l'entrée courante — sans quoi affiner la frappe
 * ferait sauter l'entrée qu'on vise déjà ; on **martèle** la même lettre et chaque appui passe à la
 * suivante qui commence par elle. La recherche est circulaire : elle finit par revenir au début.
 */
export function indexParFrappe(entrees: EntreeListe[], frappe: string, depuis: number): number | null {
  const tampon = normaliserPourFrappe(frappe);
  if (!tampon || entrees.length === 0) return null;
  const memeLettre = [...tampon].every((c) => c === tampon[0]);
  const prefixe = memeLettre ? tampon[0] : tampon;
  // Une seule lettre (ou la même martelée) = « l'entrée suivante » ; un mot qu'on affine = « à partir d'ici ».
  const depart = memeLettre ? depuis + 1 : Math.max(depuis, 0);
  for (let i = 0; i < entrees.length; i++) {
    const index = (((depart + i) % entrees.length) + entrees.length) % entrees.length;
    if (normaliserPourFrappe(entrees[index].libelle).startsWith(prefixe)) return index;
  }
  return null;
}

/**
 * **Au-delà de vingt entrées, une liste ne se déverse plus : elle se cherche.**
 *
 * Demandé par Delta devant les captures d'un club de quatre-vingts : « réduis les filtres affichés
 * si trop long (pour les gros clubs), jamais plus de 20 par 20 ». Dans une case du planning, la
 * liste des instructeurs *est* l'annuaire du club — quatre-vingt-une entrées à faire défiler dans
 * un panneau de 18 rem, sans autre moyen de viser un nom que le doigt.
 *
 * **Le seuil est celui des listes repliées**, {@link LIGNES_VISIBLES}, et non un nombre de plus :
 * « pas plus de vingt » est une seule règle, elle n'a qu'une seule valeur. En dessous, rien ne
 * change — pas de champ, pas de compteur, exactement l'écran qu'avait le club de douze.
 *
 * **Pourquoi la recherche et non le repli.** Le projet a deux patrons et ne doit pas en avoir un
 * troisième : `ListeRepliee` (« Afficher les N autres ») et la recherche côté client
 * d'`AjoutMembresPeriode`. Un panneau de liste déroulante est un `listbox` : y glisser un bouton
 * casserait sa structure, et le lecteur d'écran annoncerait une option qui n'en est pas une.
 * Surtout, on ne *parcourt* pas cette liste-là, on y **cherche un nom** — et cacher la moitié d'une
 * liste où l'on cherche ne fait que déplacer le problème d'un clic.
 */
export const SEUIL_RECHERCHE = LIGNES_VISIBLES;

/**
 * **La zone défilante du panneau, plafonnée à 18 rem** — d'accord avec le `max-h-72` du `<ul>`.
 *
 * Elle sert à dégager la place sous le déclencheur *avant* d'ouvrir : le calcul se fait quand le
 * panneau n'existe pas encore, il ne peut donc pas être mesuré.
 */
export const PANNEAU_MAX_REM = 18;

/** Une entrée mesure 48 px de haut (`min-h-12`), la cible tactile du projet. */
const ENTREE_REM = 3;

/** Les marges intérieures de la zone défilante (`py-1`, haut et bas). */
const LISTE_MARGE_REM = 0.5;

/**
 * **La place que le panneau va réellement prendre, en rem** — jamais le plafond par défaut.
 *
 * Le calcul réservait 18 rem quoi qu'il arrive. Sur la liste des niveaux, qui compte **quatre**
 * entrées, cela veut dire faire monter la page de 288 px pour un panneau qui en occupe 150 : on règle
 * une case du bas de la grille, l'écran saute, et la case qu'on visait n'est plus sous le doigt. Le
 * plafond reste, mais il ne s'applique qu'aux listes qui l'atteignent — et, au passage, une liste de
 * quatre entrées ne fait plus défiler une page qui n'en avait pas besoin.
 *
 * On compte sur le **nombre d'entrées de la liste, pas des entrées filtrées** : à l'ouverture, la
 * recherche est vide (`fermer` la remet à zéro), et la place ne doit surtout pas se recalculer à
 * chaque lettre tapée — la page se mettrait à sauter sous les doigts pendant qu'on cherche un nom.
 */
export function hauteurListeRem(nbEntrees: number): number {
  return Math.min(PANNEAU_MAX_REM, Math.max(1, nbEntrees) * ENTREE_REM + LISTE_MARGE_REM);
}

/** La liste dépasse-t-elle le seuil ? C'est la seule condition d'apparition du champ de recherche. */
export function listeCherchable(entrees: readonly EntreeListe[]): boolean {
  return entrees.length > SEUIL_RECHERCHE;
}

/**
 * Les entrées qui correspondent à ce qui est tapé dans le champ de recherche.
 *
 * Trois choix, et la raison de chacun :
 *
 * - **on cherche n'importe où dans le libellé**, pas seulement au début : la frappe d'une liste
 *   native (`indexParFrappe`) vise un préfixe, or on retient un nom de famille bien plus souvent
 *   que le prénom qui le précède — « durand » doit trouver « Chloé Durand » ;
 * - **les mots se croisent, dans n'importe quel ordre** : « du ch » trouve la même personne, ce qui
 *   évite d'avoir à se rappeler dans quel sens l'application écrit les noms ;
 * - **l'intitulé du groupe compte** : taper « atelier » ramène les ateliers à programmer, qui ne
 *   sont désignés que par ce titre de section.
 *
 * Sans accents ni casse (`normaliserPourFrappe`) : personne ne tape « Épée » avec l'accent pour
 * aller vite. La liste reçue n'est jamais modifiée — c'est la même pour toutes les cases du planning.
 */
export function filtrerEntrees(entrees: EntreeListe[], recherche: string): EntreeListe[] {
  const mots = normaliserPourFrappe(recherche).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return entrees;
  return entrees.filter((e) => {
    const cible = normaliserPourFrappe(`${e.libelle} ${e.groupe ?? ""}`);
    return mots.every((mot) => cible.includes(mot));
  });
}

/**
 * **L'entrée qui vide la case** — `----------` (`LIBELLE_VIDE`), en tête de chaque liste du planning.
 *
 * On la reconnaît à sa **valeur vide**, jamais à son libellé : `----------` est une écriture
 * d'affichage et non une donnée (règle du CLAUDE.md), et la liste des niveaux l'affiche justement
 * pour une valeur bien réelle — `INDIFFERENT`, le niveau par défaut, qui n'est pas un vidage. Une
 * liste qui n'a pas d'entrée à valeur vide (les niveaux, une liste de thèmes sans entrée neutre) n'a
 * donc rien à épingler, et tout ce qui suit la laisse intacte.
 */
export function estEntreeVide(entree: EntreeListe): boolean {
  return entree.valeur === "";
}

/**
 * **Les entrées montrées pendant une recherche : les résultats, l'écriture du vide toujours en tête.**
 *
 * Défaut constaté sur un club de quatre-vingts. `----------` est une entrée comme les autres et son
 * libellé ne correspond à aucune recherche : dès la première lettre, `filtrerEntrees` l'écartait.
 * **Vider une case demandait donc d'effacer sa frappe d'abord**, un geste que rien à l'écran
 * n'indique — et taper « vide » ou « aucun » pour le trouver ramène « Aucun résultat ».
 *
 * Elle est donc **épinglée dans les résultats**, à la place qu'elle occupe déjà sans recherche : elle
 * reste une `option` de la `listbox`, comptée par la liste à plat, parcourue par les flèches,
 * désignée par `aria-activedescendant` et cliquable sur ses 48 px. Ce qu'il fallait éviter est
 * ailleurs : qu'elle devienne l'entrée **active** — voir {@link indexActifRecherche}.
 *
 * **Pourquoi pas une action distincte en pied (ou en tête) de panneau, hors de la `listbox` ?**
 * C'était l'autre forme possible, et elle a été écartée : dans ce composant, **le focus ne va jamais
 * dans le panneau**. Il reste sur le déclencheur, ou sur le champ de recherche, et `Tab` referme la
 * liste pour rendre la tabulation à la grille du planning. Un `<button>` posé dans le panneau
 * n'aurait donc été atteignable **qu'à la souris ou au doigt** : on aurait remplacé un geste
 * invisible par un geste impossible au clavier, c'est-à-dire déplacé le défaut au lieu de le
 * corriger. S'y ajoutent deux inconvénients : deux façons de vider la même case (l'entrée sous le
 * seuil, le bouton au-dessus) à maintenir en parallèle, et une commande qui **change de place selon
 * qu'on a tapé ou non** — alors que toute la valeur de `----------` est d'être au même endroit dans
 * les quatre listes.
 *
 * La liste reçue n'est jamais modifiée : c'est la même pour toutes les cases du planning.
 */
export function entreesRecherchees(entrees: EntreeListe[], recherche: string): EntreeListe[] {
  const resultats = filtrerEntrees(entrees, recherche);
  const vide = entrees.find(estEntreeVide);
  // Pas d'entrée de vidage, ou déjà parmi les résultats (« aucun thème » trouvé par « aucun ») :
  // rien à épingler, et surtout pas un doublon. Recherche vide : `filtrerEntrees` rend la liste
  // entière, l'entrée de vidage y est déjà en tête — sous le seuil comme au-dessus, rien ne change.
  if (!vide || resultats.some(estEntreeVide)) return resultats;
  return [vide, ...resultats];
}

/**
 * **L'entrée active pendant une recherche — jamais l'écriture du vide.**
 *
 * C'est le piège de la correction évidente, et il vaut une perte de donnée. `chercher` posait
 * l'option active sur le **premier** résultat ; une entrée de vidage épinglée en tête serait donc
 * devenue l'entrée active, et **taper `charlie` puis appuyer sur Entrée aurait vidé la case** au lieu
 * de choisir Charlie. Le planning enregistre à chaque choix : une frappe parfaitement naturelle aurait
 * effacé un réglage, sans confirmation, et l'aurait écrit au journal d'audit.
 *
 * Trois cas, et un seul principe — l'entrée active est toujours celle qu'on est en train de viser :
 *
 * - **une recherche en cours** : le premier résultat **qui n'est pas** l'entrée de vidage ;
 * - **le champ vidé** : la valeur courante, exactement comme à l'ouverture du panneau — effacer sa
 *   frappe remet l'écran dans l'état où on l'a trouvé, plutôt que de désigner la première ligne ;
 * - **plus aucun vrai résultat** : `-1`, rien n'est actif. Entrée n'écrit alors rien du tout, et
 *   `----------` reste là, à un clic ou à une flèche haut, pour qui voulait justement vider.
 */
export function indexActifRecherche(visibles: EntreeListe[], recherche: string, valeur: string): number {
  if (visibles.length === 0) return -1;
  if (!normaliserPourFrappe(recherche)) return Math.max(indexDeValeur(visibles, valeur), 0);
  return visibles.findIndex((e) => !estEntreeVide(e));
}
