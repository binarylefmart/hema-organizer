import type { ReactNode } from "react";

/**
 * **Les trois calages horizontaux de la bulle**, écrits en toutes lettres.
 *
 * Tailwind ne voit que les classes littérales présentes dans le source : une classe assemblée à la
 * volée (`` `left-${x}` ``) ne serait jamais engendrée. D'où ces tables plutôt qu'un calcul.
 */
const CALAGE = {
  gauche: "left-0 right-auto translate-x-0",
  centre: "left-1/2 right-auto -translate-x-1/2",
  droite: "left-auto right-0 translate-x-0",
} as const;

/** Les mêmes, au-delà de `sm`, où les grilles de l'accueil changent de nombre de colonnes. */
const CALAGE_SM = {
  gauche: "sm:left-0 sm:right-auto sm:translate-x-0",
  centre: "sm:left-1/2 sm:right-auto sm:-translate-x-1/2",
  droite: "sm:left-auto sm:right-0 sm:translate-x-0",
} as const;

/** De quel côté la bulle s'accroche à ce qui la porte. */
export type CoteBulle = keyof typeof CALAGE;

/**
 * **Comment une bulle de grille évite de sortir de l'écran.**
 *
 * Une bulle de 16 rem centrée sur une case étroite déborde très largement celle qui la porte : au
 * milieu de la grille ça n'a aucune importance (elle empiète sur les cases voisines, qui sont dans
 * la carte), mais sur la **première** et la **dernière** colonne elle sortirait par le bord de
 * l'écran — donc hors du document, avec une barre de défilement horizontale sur toute la page.
 *
 * On ne la centre donc que sur les colonnes intérieures : la première colonne aligne le bord gauche
 * de la bulle sur celui de sa case, la dernière aligne le bord droit. Le pire débordement restant
 * vaut la marge de la carte, qui existe toujours.
 *
 * Une grille qui change de nombre de colonnes à `sm` appelle cette fonction **deux fois** (une par
 * palier) et passe les deux résultats à {@link Bulle} : le dixième écu d'une collection, par
 * exemple, est en dernière colonne à trois colonnes comme à cinq, mais le sixième change de bord
 * d'un palier à l'autre.
 */
export function coteEnGrille(index: number, colonnes: number): CoteBulle {
  const colonne = index % colonnes;
  if (colonne === 0) return "gauche";
  if (colonne === colonnes - 1) return "droite";
  return "centre";
}

type Props = {
  /** Calage horizontal en dessous de `sm` — « centre » tant que rien ne risque de déborder. */
  cote?: CoteBulle;
  /** Calage au-delà de `sm` ; à défaut, celui du dessous (grille qui ne change pas de colonnes). */
  coteSm?: CoteBulle;
  /** Ce que la bulle raconte : des `<span>` empilés, du plus important au plus accessoire. */
  children: ReactNode;
};

/**
 * **La bulle d'information au survol**, posée au-dessus de ce qui la porte.
 *
 * Elle remplace l'attribut `title` natif, qui mettait une seconde à paraître, ne se déclenchait
 * jamais au clavier et n'était rendu par aucun navigateur avec les couleurs du club. Trois partis
 * pris, valables partout où elle sert :
 * - **en CSS seul** (`group-hover`, `group-focus-within`, `group-active`) : aucun état, aucun
 *   `"use client"`, les écrans qui l'emploient restent des composants serveur et des pages qui ne
 *   font rien toutes seules ;
 * - **au survol et au focus clavier** : l'élément porteur est focalisable, de sorte que la
 *   tabulation ouvre exactement ce que la souris ouvre ;
 * - **elle n'est jamais la seule source**. Au doigt, le survol n'existe pas : `group-active` la
 *   montre **pendant l'appui**, ce qui la rend atteignable sans faire de l'écran un écran
 *   cliquable — un appui maintenu la découvre, un appui relâché ne déclenche rien. Ce qu'elle dit d'essentiel reste
 *   donc écrit en clair à côté, et son porteur reprend le reste dans son `aria-label`. La bulle
 *   elle-même est `aria-hidden` : elle ne redit à la voix que ce qui est déjà annoncé.
 *
 * **Emploi.** L'élément qui la porte est `group relative` ; la bulle se place en dernier dans son
 * contenu. Elle est `pointer-events-none` : la survoler ne la maintient pas ouverte, et surtout
 * elle n'intercepte jamais un clic destiné à ce qu'elle recouvre.
 *
 * La pointe est rendue à part, **toujours centrée** sur le porteur même quand la bulle est recalée
 * sur un bord (voir {@link coteEnGrille}) : c'est elle qui dit à qui la bulle appartient.
 */
export function Bulle({ cote = "centre", coteSm, children }: Props) {
  const calage = `${CALAGE[cote]} ${CALAGE_SM[coteSm ?? cote]}`;
  return (
    <>
      {/* Un carré tourné de 45°, dont seul le bec dépasse du bord inférieur de la bulle. Rendu
          avant elle, et sous elle, pour ne pas suivre son décalage. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden h-2 w-2 -translate-x-1/2 rotate-45 bg-encre group-hover:block group-focus-within:block group-active:block"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-full z-20 mb-2 hidden w-max max-w-64 flex-col gap-0.5 rounded-lg bg-encre px-2.5 py-1.5 text-left text-xs leading-snug text-encre-texte shadow-carte group-hover:flex group-focus-within:flex group-active:flex ${calage}`}
      >
        {children}
      </span>
    </>
  );
}
