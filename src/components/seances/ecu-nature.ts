import type { NatureElement } from "@/lib/constants";

/**
 * **Le petit écu de chaque nature d'élément** : un écu à la couleur du texte de l'étiquette, et une
 * pièce de blason découpée dans la couleur du fond de l'étiquette — fasce ondée pour l'échauffement,
 * sautoir (deux lames croisées) pour le cours, chevron pour l'option, croix pour l'atelier.
 *
 * L'écu vit **dans** l'étiquette (`couleurNature`) et en prend les deux teintes, d'où la pièce en
 * couleur de fond : sur une étiquette pleine comme sur une étiquette au trait, il se lit comme un
 * blason évidé, et il suit les douze thèmes du club sans une couleur à lui. La forme distingue les
 * natures même sans les couleurs ; le mot reste à côté, l'écu ne le remplace jamais.
 *
 * Module sans React, pour que les tests puissent vérifier qu'aucune nature n'est oubliée.
 */

/** Silhouette de l'écu, dans un carré de 24 — la même que l'icône « bouclier », sans les planches */
export const TRACE_ECU = "M3.5 3h17v7.5c0 5.8-3.9 9.2-8.5 10.8-4.6-1.6-8.5-5-8.5-10.8z";

/** La pièce de chaque nature, découpée ensuite par la silhouette de l'écu */
export const PIECES_NATURE: Record<NatureElement, string> = {
  ECHAUFFEMENT: "M2 11c2-1.6 3.3-1.6 5 0s3.3 1.6 5 0 3.3-1.6 5 0 3.3 1.6 5 0v3.2c-2 1.6-3.3 1.6-5 0s-3.3-1.6-5 0-3.3 1.6-5 0-3.3-1.6-5 0z",
  COURS: "M2 1.5l3-1 18 18.5-3 3zM22 1.5l-3-1L1 19l3 3z",
  OPTION: "M12 7.5l11 11v4.5L12 12 1 23v-4.5z",
  ATELIER: "M10 0h4v24h-4zM0 9h24v4H0z",
};

/** La couleur de la pièce : celle du **fond** de l'étiquette de la nature (voir `couleurNature`) */
export const FOND_PIECE_NATURE: Record<NatureElement, string> = {
  ECHAUFFEMENT: "fill-marque",
  COURS: "fill-primaire",
  OPTION: "fill-primaire-doux",
  ATELIER: "fill-vert-doux",
};
