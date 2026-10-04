/**
 * **L'élargissement au-delà de la colonne de lecture — une règle, une écriture, un endroit.**
 *
 * Décision de Delta, sur les captures d'un club de quatre-vingts : « en ligne chaque cours et
 * empilés les uns sur les autres, **utilisant bien la largeur**, que ce soit **uniforme sur
 * l'horizontalité** même si la tuile est plus longue en verticalité ». Uniforme sur
 * l'horizontalité : c'est la partie qu'on a mis deux jours à tenir vraiment.
 *
 * **Ce que ça fait.** En dessous de 1024 px — donc sur tout téléphone et toute tablette — rien : la
 * page reste dans sa colonne de lecture. Au-delà, elle prend la largeur de la fenêtre moins ses
 * marges, plafonnée à 90 rem, et se recentre. Une bande de 2 000 px ne se lit plus ; 90 rem est le
 * point où un nom de personne entier tient dans une case sans que l'œil ait à traverser l'écran.
 *
 * **Où ça se pose : sur une PAGE, jamais sur un morceau de page.** C'est toute l'histoire de cette
 * constante. L'élargissement a d'abord été écrit dans `GrillePlanning`, puis recopié dans
 * `ListeSeances` — à chaque fois sur la *liste*, donc **sous** le titre, les filtres et les boutons
 * de partage, qui restaient, eux, dans la colonne étroite. Deux alignements sur la même page, et
 * les trois onglets principaux qui ne commençaient pas au même endroit. Pire : un filtre sans
 * résultat remplace la liste par une alerte — donc par un autre conteneur —, et la largeur du
 * contenu sautait d'un filtre à l'autre.
 *
 * `/seances` a été réparé, `/planning` **le même jour à midi**, après que Delta a relevé que le
 * planning n'était toujours pas d'aplomb — alors que le message de commit du matin le donnait pour
 * modèle. D'où cette constante : tant que la règle était une chaîne de classes recopiée, elle
 * pouvait être juste à un endroit et fausse à deux autres sans que rien ne le dise. Maintenant, on
 * la lit.
 *
 * `tests/unit/bandes-pleine-largeur.test.ts` vérifie qu'elle n'est **définie qu'ici** et que les
 * trois pages qui débordent l'utilisent — aucune ne réécrit ses classes à la main.
 */
export const PLEINE_LARGEUR = "lg:relative lg:left-1/2 lg:w-[min(calc(100vw-3rem),90rem)] lg:-translate-x-1/2";

/**
 * **Le même élargissement, mais au palier de 1 536 px**.
 *
 * Un seul plafond dans tout le dépôt — 90 rem —, et c'est volontaire : deux largeurs maximales sur le
 * même écran se lisent comme un défaut d'affichage. Ce qui change ici, c'est **à partir de quand** la
 * page se partage, et ça dépend de ce qu'elle a à mettre côte à côte :
 *
 * - **1 024 px** ({@link PLEINE_LARGEUR}) suffit à un **tableau** : il n'a qu'à s'étaler, et chaque
 *   colonne gagnée est une colonne lisible de plus (le planning, la fiche d'une séance, les deux
 *   journaux de l'espace admin) ;
 * - **1 536 px** (ici) est le minimum pour **deux piles de réglages plus un sommaire** : 2 × 34 rem de
 *   cartes, 20 rem de sommaire et leurs écarts ne tiennent pas en dessous. Élargir plus tôt donnerait
 *   soit une carte étirée — refusée deux fois, le 30/09 et le 01/10 —, soit des colonnes de 27 rem,
 *   plus étroites que la colonne de lecture d'aujourd'hui.
 *
 * C'est le palier du sommaire (`SommaireCollant`), et ce n'est pas un hasard : les deux répondent à la
 * même question — « y a-t-il la place de mettre quelque chose à côté ? ».
 */
export const PLEINE_LARGEUR_2XL = "2xl:relative 2xl:left-1/2 2xl:w-[min(calc(100vw-3rem),90rem)] 2xl:-translate-x-1/2";

/*
 * **La grille de tuiles a existé deux heures, : ne la réécrivez pas.**
 *
 * Elle répondait à « adapte les tuiles au mieux dynamiquement à la longueur de la fenêtre » en
 * rangeant les blocs de l'accueil en `grid` — deux colonnes, un plafond à 120 rem, et une variante
 * pour la tuile surnuméraire. Delta, capture en main le même soir : « **ça fait des trous** ». Une
 * grille aligne ses blocs en **rangées** : deux voisins de hauteurs différentes — la vignette du
 * prochain cours fait 140 px, la frise de fréquentation 330 — laissent un trou de la hauteur de la
 * différence, et l'écran se lit comme un affichage cassé.
 *
 * Ce qui a pris sa place : `DeuxColonnes` (`src/components/ui/DeuxColonnes.tsx`), **deux
 * colonnes indépendantes** qui empilent chacune à leur rythme, et dont la largeur se pose sur la
 * page (`LARGEUR_PAGE`, même palier et même plafond que la constante ci-dessus). Les trois
 * constantes de la grille — `GRILLE_TUILES`, `TUILE_LARGE`, `PLEINE_LARGEUR_TUILES` — ont été
 * retirées avec elle : du code mort qui dit « voilà comment on élargit une page de tuiles » est une
 * invitation à recreuser le trou.
 *
 * La leçon technique de cet essai, elle, reste vraie et vit maintenant dans `CLAUDE.md` et dans
 * `tests/unit/bandes-pleine-largeur.test.ts` : **une requête de média mesure la fenêtre, jamais le
 * conteneur**. Un palier `lg:` n'est légitime que dans un conteneur dont on sait qu'il suit la
 * fenêtre — ce qui est le cas d'une page, et jamais celui d'une carte.
 */
