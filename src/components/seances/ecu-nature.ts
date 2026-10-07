import type { NatureElement } from "@/lib/constants";
import { PIECE_APLAT_TEINTE, PIECE_CONTOUR_TEINTE, type Teinte } from "./teintes";

/**
 * **Le petit écu de chaque nature d'élément** : un écu à la couleur du texte de l'étiquette, et une
 * pièce de blason découpée dans la couleur du fond de l'étiquette — fasce ondée pour l'échauffement,
 * sautoir (deux lames croisées) pour le cours, chevron pour l'option, croix pour l'atelier.
 *
 * L'écu vit **dans** l'étiquette (`couleurNature`) et en prend les deux couleurs, d'où la pièce en
 * couleur de fond : sur une étiquette pleine comme sur une étiquette au trait, il se lit comme un
 * blason évidé, sans une couleur à lui. Depuis que chaque cours et chaque option a **sa** teinte
 * (`teintes.ts`), la pièce suit le fond **réel** de l'étiquette (`piece`) : écu clair et pièce de la
 * teinte sur l'aplat d'un cours, écu de la teinte et pièce de la teinte douce sur le contour d'une
 * option. La forme distingue les natures même sans les couleurs ; le mot reste à côté, l'écu ne le
 * remplace jamais.
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

/**
 * La couleur de la pièce de l'échauffement et de l'atelier : celle du **fond** de leur étiquette, qui
 * ne dépend que de leur nature (voir `couleurNature`). Le cours et l'option, eux, prennent le fond de
 * leur teinte (`piece`) ; leur ligne ici n'est que le repli d'une teinte inconnue.
 */
export const FOND_PIECE_NATURE: Record<NatureElement, string> = {
  ECHAUFFEMENT: "fill-marque",
  COURS: PIECE_APLAT_TEINTE[1],
  OPTION: PIECE_CONTOUR_TEINTE[1],
  ATELIER: "fill-vert-doux",
};

/** La couleur de la pièce d'un élément : le fond de **son** étiquette, teinte comprise. */
export function piece(nature: NatureElement, teinte: Teinte | null): string {
  if (nature === "COURS") return PIECE_APLAT_TEINTE[teinte ?? 1];
  if (nature === "OPTION") return PIECE_CONTOUR_TEINTE[teinte ?? 1];
  return FOND_PIECE_NATURE[nature] ?? FOND_PIECE_NATURE.COURS;
}
