import { niveauAffiche, nomElement, nomPartie, partiesNommees, type NatureElement, type Niveau } from "@/lib/constants";
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
 * **Depuis les parties et éléments**, une séance se lit **partie par partie** —
 * « Partie 1 », puis ce qu'elle porte : « Échauffement », « Cours 2 », « Atelier »… —, et ce module
 * porte aussi le repère de couleur d'un élément, qui ne dépend plus que de sa **nature**
 * (`couleurNature`). Le planning l'**importe d'ici** : une seule table pour les deux écrans.
 */

/** Ce qu'une case renseignée donne à lire, une fois nettoyée. */
export type LigneProgramme = {
  /** Identifiant de l'élément : c'est lui la clé de liste, les noms n'étant uniques que dans leur partie */
  id: string;
  /** Rang de l'élément dans sa séance, à partir de 0 — l'ordre de lecture, pas celui de la base */
  ordre: number;
  /** **Numéro de la partie** (« Partie 2 »), contigu à partir de 1 dans la séance entière */
  bloc: number;
  /** Ce qu'est l'élément dans sa partie : échauffement, cours, option ou atelier */
  nature: NatureElement;
  /**
   * Rang de l'élément **dans sa partie et sa nature**, à partir de 1, et le **nombre** d'éléments de
   * cette nature dans la partie. C'est ce que compte son nom (« Cours 2 »).
   *
   * **Recopiés de la ligne reçue, jamais recomptés ici** : la liste est déjà filtrée des éléments
   * muets, et la recompter donnerait « Cours » tout court au second cours d'une partie dont le
   * premier est resté vide — alors que le planning, lui, l'appelle « Cours 2 ».
   */
  rang: number;
  nombre: number;
  /** Nom court de l'élément dans sa partie (« Échauffement », « Cours 2 »), via `nomElement` */
  nom: string;
  /** Nom complet calculé (« Partie 1 · Cours »), tel que la base le garde */
  libelle: string;
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
   * Titre de l'atelier placé dans la case. **Il se lit comme un thème** (avenant, « ne
   * mets pas les ateliers en surlignage ») : c'est l'étiquette « Atelier » qui dit ce que c'est, pas
   * une mise en valeur à lui. Gardé à part du thème pour que l'écran le place en tête et qu'un
   * élément d'une autre nature (donnée ancienne) puisse encore le préfixer d'« Atelier : ».
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
 * **Ni le rang ni le nombre ne sont recalculés ici**, ils sont recopiés de la ligne reçue. La liste
 * qui arrive est déjà filtrée — `programmeDepuisParties` a écarté les éléments muets — et la compter
 * donnerait le rang dans ce qui reste, pas le rang dans la partie : une partie à deux cours dont seul
 * le second est rempli l'aurait appelé « Cours », quand le planning dit « Cours 2 ». Ces nombres ne
 * peuvent se compter qu'à l'endroit où la séance est encore entière, et c'est pour cela qu'ils
 * voyagent avec la ligne.
 */
export function lignesProgramme(programme: ProgrammeSeance): LigneProgramme[] {
  return programme
    .map((c) => {
      const atelier = nettoyer(c.atelier?.titre) || null;
      /*
       * Placer un atelier recopie son titre dans le thème de la case (`programmerAtelierDansCase`).
       * Sans ce garde-fou, la ligne le disait deux fois de suite — « Échauffement à la corde »,
       * puis « Atelier : Échauffement à la corde » —, ce qui se lit comme deux activités
       * différentes. Le titre de l'atelier gagne : il porte la même information, et c'est lui qui
       * tient lieu de thème à l'élément.
       */
      const themeBrut = nettoyer(c.theme);
      const theme = atelier && themeBrut.toLowerCase() === atelier.toLowerCase() ? "" : themeBrut;
      const instructeur = nettoyer(c.instructeur) || null;
      return {
        id: c.id,
        ordre: c.ordre,
        bloc: c.bloc,
        nature: c.nature,
        rang: c.rang,
        nombre: c.nombre,
        nom: nomElement(c.nature, c.rang, c.nombre),
        libelle: nettoyer(c.libelle),
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
 * Une partie du programme telle qu'elle se lit : son nom, puis ses éléments dans l'ordre. `nom` vaut
 * `null` quand une seule partie a quelque chose à montrer : pas d'intitulé « Partie N » alors
 * (`partiesNommees`, avenant), le programme se lit comme avant les parties.
 */
export type PartieLue<T> = { bloc: number; nom: string | null; elements: T[] };
export type PartieProgramme = PartieLue<LigneProgramme>;

/**
 * **Des éléments groupés par partie** : « Partie 1 » et ses éléments, puis « Partie 2 »… La même
 * lecture pour la fiche d'une séance (`partiesProgramme`) et pour les pages de partage, qui la
 * reprennent sur leurs propres cases (`CasePartage`, sans aucun nom).
 *
 * Les éléments arrivent déjà dans l'ordre de lecture (partie, nature, ordre — `rangerParties`) et déjà
 * filtrés : une partie dont aucun élément ne parle **n'apparaît pas**, faute d'élément pour la
 * porter. Les numéros, eux, restent ceux de la séance — une séance dont les parties 1 et 3 sont
 * remplies affiche « Partie 1 » et « Partie 3 », comme le planning, et non « Partie 1 » et
 * « Partie 2 » : c'est le même cours, il doit porter le même nom sur les deux écrans.
 *
 * **Une seule partie affichée → aucun titre** (`nom: null`) : on compte les parties qui ont *ici* au
 * moins un élément, après le filtre des muets — pas les parties réelles de la séance. Une séance à
 * trois parties dont seule la troisième est remplie se lit donc « Cours », sans « Partie 3 » ;
 * dès que deux parties parlent, chacune reprend son numéro de séance.
 *
 * On regroupe par **numéro**, pas par voisinage : une liste qui arriverait mal triée ne couperait pas
 * une partie en deux titres identiques.
 */
export function grouperParPartie<T extends { bloc: number }>(elements: readonly T[]): PartieLue<T>[] {
  const parBloc = new Map<number, T[]>();
  for (const e of elements) {
    const liste = parBloc.get(e.bloc);
    if (liste) liste.push(e);
    else parBloc.set(e.bloc, [e]);
  }
  const nommees = partiesNommees(parBloc.size);
  return [...parBloc.entries()].sort(([a], [b]) => a - b).map(([bloc, liste]) => ({ bloc, nom: nommees ? nomPartie(bloc) : null, elements: liste }));
}

/** Le programme d'une fiche, groupé par partie (voir `grouperParPartie`). */
export function partiesProgramme(lignes: readonly LigneProgramme[]): PartieProgramme[] {
  return grouperParPartie(lignes);
}

/*
 * Les classes sont écrites **en entier**, jamais composées (`bg-partie-${n}`) : Tailwind lit les
 * sources pour savoir quelles classes engendrer, et une classe calculée à l'exécution n'existerait
 * dans aucune feuille de style — l'étiquette sortirait sans couleur.
 */
const COULEURS_NATURE: Record<NatureElement, string> = {
  ECHAUFFEMENT: "bg-partie-1 text-partie-texte",
  COURS: "bg-partie-3 text-partie-texte",
  OPTION: "border border-partie-5 bg-partie-5-doux/60 text-partie-5",
  ATELIER: "border border-partie-2 bg-partie-2-doux/60 text-partie-2",
};

/**
 * **Repère de couleur d'un élément : une teinte par nature**, et rien d'autre.
 *
 * Tant qu'une séance n'était qu'une suite de cours et d'options, la teinte comptait le rang dans la
 * série (« Cours 2 » ↔ couleur 2). Depuis que les éléments se rangent dans des parties numérotées,
 * c'est le **titre de partie** qui sépare les blocs, et la couleur n'a plus qu'une question à
 * trancher d'un coup d'œil : *qu'est-ce que c'est* — l'échauffement (ambre), le cours (bleu), une
 * option (violet), un atelier proposé par un membre (sa propre teinte — et c'est **le seul** repère
 * qui le distingue : son titre, lui, s'écrit comme n'importe quel thème). Deux cours d'une même partie ont donc la même teinte : c'est leur nom
 * (« Cours 1 », « Cours 2 ») qui les distingue, et il est écrit dessus.
 *
 * **La forme double la teinte** : ce qui se mène en parallèle (`enParallele` — option, atelier) est
 * en contour, plus discret ; l'échauffement et le cours, qui sont le cours lui-même, en aplat. Les
 * teintes sont les repères `--partie-n` de `globals.css` (une palette fixe, posée pour le clair et
 * pour le sombre), jamais une couleur en dur.
 */
export function couleurNature(nature: NatureElement): string {
  // Une nature inconnue (donnée ancienne, import) retombe sur le cours plutôt que sur une classe
  // vide : une étiquette sans couleur se lirait comme un défaut d'affichage.
  return COULEURS_NATURE[nature] ?? COULEURS_NATURE.COURS;
}
