import { niveauAffiche, type Niveau } from "@/lib/constants";
import type { ProgrammeSeance } from "@/lib/planning";

/**
 * Les règles de lecture du programme d'un cours, sans React (voir `ProgrammeCours.tsx`).
 *
 * Elles vivent dans un `.ts` à part pour la même raison que `liste-deroulante.ts` : les tests
 * unitaires du projet ne peuvent pas importer de `.tsx` (`jsx: "preserve"`), or c'est exactement ce
 * qui mérite d'être verrouillé sans navigateur. Une case du planning arrive rarement complète : on
 * connaît souvent l'instructeur avant le thème, un atelier se place parfois dans une case dont le
 * thème est resté vide, et un thème saisi puis effacé laisse une chaîne d'espaces. Chacun de ces
 * trois cas se lisait comme un tiret ou un blanc dans la grille ; ici on décide une fois pour
 * toutes ce que chacun donne à lire, et le composant ne fait plus que le mettre en forme.
 *
 * **Depuis les parties libres par séance**, ce module porte aussi le repère de couleur d'une partie :
 * il ne peut plus venir d'une table figée à quatre entrées (`PARTIE_LABELS`), puisqu'une séance a
 * désormais autant de parties qu'on lui en ajoute. Le planning l'**importe d'ici** (`ListeParties`) —
 * la copie de `COULEUR_PARTIE` qui vivait dans les deux fichiers, et le test qui la surveillait, n'ont
 * plus lieu d'être. `rangsDansNature`, qui le nourrit, sert aussi à calculer le **nom** des parties
 * (`rangerParties`, src/lib/planning.ts) : une seule numérotation pour la teinte et pour le mot.
 */

/** Ce qu'une case renseignée donne à lire, une fois nettoyée. */
export type LigneProgramme = {
  /** Identifiant de la partie : c'est lui la clé de liste, les libellés n'étant plus uniques */
  id: string;
  /** Rang de la partie dans sa séance, à partir de 0 — l'ordre voulu, pas celui de la base */
  ordre: number;
  /**
   * Rang de la partie **parmi celles de même nature**, à partir de 1 : le 2e cours de la séance, la
   * 1ère option. C'est ce que compte son libellé (« Cours 2 », « Option 1 »), donc ce que doit compter
   * tout repère posé à côté de lui — la teinte comprise (voir `couleurPartie`).
   *
   * **Recopié de la partie, jamais recompté ici** : la liste reçue est déjà filtrée des parties
   * muettes, et la recompter donnerait le rang 1 au second cours (voir `lignesProgramme`).
   */
  rang: number;
  /** Nom de la partie (« Cours 1 », « Option 2 »…), **calculé** depuis le rang — publié tel quel */
  libelle: string;
  /** **Option** : une partie qui se tient pendant le cours, et qui accueille les ateliers */
  estOption: boolean;
  /** Thème de la case, vide quand elle n'en porte pas encore */
  theme: string;
  /**
   * **Ce qu'on fera dans cette partie**, en une phrase, ou `""` quand personne ne l'a écrit. Le seul
   * texte libre d'une partie depuis que son nom se calcule — et le seul champ du programme qui
   * raconte au lieu de désigner.
   */
  description: string;
  /**
   * Niveau annoncé, ou `null` quand il n'y a rien à dire — « indifférent » compris. La décision est
   * prise ici, une fois, pour que le composant n'ait qu'à poser la pastille quand elle existe.
   */
  niveau: Niveau | null;
  /**
   * Titre de l'atelier placé dans la case. Il s'annonce comme tel plutôt que de se fondre dans le
   * thème : c'est le retour visible du membre qui l'a proposé, et il tient à s'y reconnaître.
   */
  atelier: string | null;
  instructeur: string | null;
  /** Celui qui assiste, quand ils sont deux à encadrer la partie — toujours après le premier */
  instructeurSecond: string | null;
  /**
   * Quelqu'un encadre, mais ni thème ni atelier : on l'écrit (« Thème à venir ») au lieu de laisser
   * la ligne muette, sinon le nom seul donne l'impression d'un affichage tronqué.
   */
  enAttente: boolean;
};

const nettoyer = (valeur: string | null | undefined): string => (valeur ?? "").trim();

/**
 * Les lignes à afficher, dans l'ordre reçu — celui des parties, que l'appelant a déjà établi.
 *
 * Le filtre final double celui de `programmeDepuisParties` : une case dont le thème n'est qu'une
 * espace passe le sien, et occuperait ici une ligne entière pour ne rien dire.
 *
 * **Le rang n'est pas recalculé ici**, il est recopié de la ligne reçue (`c.rang`). La liste qui
 * arrive est déjà filtrée — `programmeDepuisParties` a écarté les parties muettes — et la compter
 * donnerait le rang dans ce qui reste, pas le rang dans la séance. Une séance neuve dont
 * l'encadrement ne remplit que « Cours n°2 » et « 2e option » aurait ainsi donné le rang 1 au second
 * cours, donc la teinte du premier. Ce rang-là ne peut se compter qu'à l'endroit où la séance est
 * encore entière, et c'est pour cela qu'il voyage avec la ligne.
 */
export function lignesProgramme(programme: ProgrammeSeance): LigneProgramme[] {
  return programme
    .map((c) => {
      const atelier = nettoyer(c.atelier?.titre) || null;
      /*
       * Placer un atelier recopie son titre dans le thème de la case (`programmerAtelierDansCase`).
       * Sans ce garde-fou, la ligne le disait deux fois de suite — « Échauffement à la corde »,
       * puis « Atelier : Échauffement à la corde » —, ce qui se lit comme deux activités
       * différentes. L'annonce « Atelier » gagne : elle porte la même information **et** dit de qui
       * vient la proposition.
       */
      const themeBrut = nettoyer(c.theme);
      const theme = atelier && themeBrut.toLowerCase() === atelier.toLowerCase() ? "" : themeBrut;
      const instructeur = nettoyer(c.instructeur) || null;
      return {
        id: c.id,
        ordre: c.ordre,
        rang: c.rang,
        libelle: nettoyer(c.libelle),
        estOption: c.estOption,
        theme,
        description: nettoyer(c.description),
        niveau: niveauAffiche(c.niveau),
        atelier,
        instructeur,
        // Un second sans premier ne veut rien dire : il assiste quelqu'un. Cet état ne peut plus
        // entrer en base — `enregistrerCase` le refuse, comme l'écran le faisait déjà. Ce qui reste
        // ici est une ceinture : une case qui n'aurait qu'un second (donnée ancienne, import)
        // n'affiche **personne**. On ne le remonte pas au rang de premier : il n'a pas décidé de
        // mener, et le programme écrirait son nom en tête sans que personne ne l'ait demandé.
        instructeurSecond: instructeur ? nettoyer(c.instructeurSecond) || null : null,
        enAttente: !theme && !atelier,
      };
    })
    // Une description seule suffit à faire parler la ligne : c'est ce qu'elle est là pour dire, et la
    // taire faute de thème serait perdre le seul renseignement disponible.
    .filter((l) => l.theme || l.description || l.atelier || l.instructeur);
}

/** Un champ libre de la séance (thème détaillé, alternative) : effacé ou laissé en blanc = rien à montrer. */
export function texteLibre(valeur: string | undefined): string | null {
  return nettoyer(valeur) || null;
}

/**
 * Vrai quand il n'y a rien à montrer du tout. C'est ce qui permet à l'appelant de poser
 * `ProgrammeCours` sans condition : la plupart des séances à venir n'ont encore aucune case
 * remplie, et c'est au composant de disparaître, pas à chaque écran de s'en souvenir.
 */
export function programmeMuet(lignes: LigneProgramme[], ...champsLibres: Array<string | null>): boolean {
  return lignes.length === 0 && champsLibres.every((c) => !c);
}

/**
 * Ce dont dépend le repère de couleur d'une partie : **son rang dans sa nature et cette nature**,
 * rien d'autre. Une case du planning (`CasePlanning`) comme une ligne de programme le portent :
 * `couleurPartie` se contente donc de cette forme, et sert les deux écrans sans conversion.
 *
 * **`ordre` n'y figure pas, et c'est le correctif.** La teinte se tirait de la place dans la séance
 * pendant que tout le reste — le libellé du modèle, le rang porté par la ligne — comptait dans la
 * nature : deux numérotations sur un seul objet.
 */
export type RangPartie = { rang: number; estOption: boolean };

/**
 * **Le rang de chaque partie dans sa propre série**, à partir de 1 : les cours d'un côté, ce qui se
 * est l'option de l'autre.
 *
 * C'est la numérotation que porte le libellé (`libellePartie`) — « Cours 1 », « Cours 2 », « Option
 * 1 » —, et c'est donc la seule dont puisse dépendre ce qui se pose à côté de lui. Compter les
 * parties de la séance donnait l'étiquette « Opt 3 » en face du libellé « 1ère option » : deux
 * mentions, deux nombres, un seul objet. L'étiquette a disparu depuis — une partie ne se nomme
 * qu'une fois, par son libellé — et ce rang sert au repère de couleur (`couleurPartie`) **et au
 * libellé lui-même**, qui s'en calcule.
 */
/* Appelée par `programmeDepuisParties` — donc sur la **séance entière**, avant que les parties
 * muettes ne soient écartées. C'est la seule place où le compte est juste : appliquée à la liste
 * déjà filtrée, la même fonction rend « 1 » pour « Cours n°2 » d'une séance dont le premier cours
 * est resté vide. Le rang voyage ensuite avec la ligne. */
export function rangsDansNature(parties: ReadonlyArray<{ estOption: boolean }>): number[] {
  let cours = 0;
  let options = 0;
  return parties.map((p) => (p.estOption ? ++options : ++cours));
}

/**
 * Repère de couleur d'une partie — les mêmes classes qu'avant la refonte, dérivées cette fois du
 * rang et de la nature au lieu d'une table à quatre entrées : les deux moitiés du cours sont pleines
 * (c'est le cours lui-même), l'option est en contour, plus discret. Les rangs
 * alternent ocre et vert, si bien qu'une séance à quatre parties garde exactement l'aspect connu
 * (Cours 1 ↔ ocre plein, Cours 2 ↔ vert plein, Option 1 ↔ ocre contour, Option 2 ↔ vert contour).
 *
 * **Le nombre compté est celui du libellé** (`rang`, dans la nature), et non la place dans la
 * séance (`ordre`) : c'est le correctif. La teinte se tirait de `ordre` pendant que le libellé et
 * le rang de la ligne comptaient par nature, et la propriété annoncée juste en dessous tombait dès
 * que les deux séries s'entremêlaient — un clic sur « Option » pour « Cours 1 » donnait la même
 * teinte à « Option 1 » et à « Option 2 », qui se suivent à l'écran.
 *
 * **Une couleur par rang, et six avant que la série ne recommence**. Les deux teintes d'avant
 * alternaient : « Cours 3 » reprenait donc exactement le repère de « Cours 1 », et sur une séance à
 * cinq parties deux lignes voisines pouvaient porter la même couleur — ce que ce repère existe pour
 * éviter.
 *
 * **Le rang et la nature, rien d'autre** : « Cours 2 » et « Option 2 » partagent la **teinte** du rang
 * 2 et se distinguent par la **forme** (le cours en aplat, l'option en contour, plus discrète). C'est
 * ce que la demande décrit — « cours/option 2 couleur 2 » —, et c'est ce que l'écran montrait déjà des
 * deux premiers rangs.
 *
 * Les couleurs vivent dans `globals.css` (`--partie-1` … `--partie-6`) et **ne viennent pas du
 * thème** : ambre, vert, bleu, rouge, violet, sarcelle, posées une fois pour le mode clair et une fois
 * pour le sombre. Un premier essai les avait **dérivées** du thème et n'avait donné que deux familles
 * en deux luminosités — un thème ne garantit que deux couleurs lisibles comme *texte* (le contour
 * d'une option écrit de la couleur de sa teinte), et leurs mélanges retombent tous dans l'olive.
 * Delta, devant le résultat : « tu n'as mis que des nuances, je veux de vraies autres couleurs rouge
 * bleu etc ». Une palette de **repères** ne dit pas la marque du club, elle **distingue** des lignes
 * voisines : c'est exactement pour cela qu'elle reste la même d'un thème à l'autre. **Au-delà de six,
 * la série recommence** : une couleur sépare deux voisines d'un coup d'œil, elle ne nomme pas la
 * partie — c'est le libellé qui le fait, et il est écrit juste à côté.
 */
export function couleurPartie(l: RangPartie): string {
  /*
   * Les classes sont écrites **en entier**, jamais composées (`bg-partie-${n}`) : Tailwind lit les
   * sources pour savoir quelles classes engendrer, et une classe calculée à l'exécution n'existerait
   * dans aucune feuille de style — l'étiquette sortirait sans couleur.
   */
  const APLATS = [
    "bg-partie-1 text-partie-texte",
    "bg-partie-2 text-partie-texte",
    "bg-partie-3 text-partie-texte",
    "bg-partie-4 text-partie-texte",
    "bg-partie-5 text-partie-texte",
    "bg-partie-6 text-partie-texte",
  ];
  const CONTOURS = [
    "border border-partie-1 bg-partie-1-doux/60 text-partie-1",
    "border border-partie-2 bg-partie-2-doux/60 text-partie-2",
    "border border-partie-3 bg-partie-3-doux/60 text-partie-3",
    "border border-partie-4 bg-partie-4-doux/60 text-partie-4",
    "border border-partie-5 bg-partie-5-doux/60 text-partie-5",
    "border border-partie-6 bg-partie-6-doux/60 text-partie-6",
  ];
  // La numérotation part de 1 (voir `rangsDansNature`), et un rang douteux retombe sur la première
  // teinte plutôt que sur une classe vide : une étiquette sans couleur se lirait comme un défaut.
  const i = Number.isFinite(l.rang) && l.rang >= 1 ? (Math.trunc(l.rang) - 1) % APLATS.length : 0;
  return l.estOption ? CONTOURS[i] : APLATS[i];
}
