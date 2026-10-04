import type { ReactNode } from "react";

/**
 * Tableau responsive : sur PC, un vrai tableau (qui défile horizontalement dans son conteneur,
 * jamais la page) ; sur téléphone, chaque ligne devient une petite fiche où chaque valeur est
 * précédée de son intitulé (`label` de `Cellule`) — plus rien n'est coupé.
 */

/**
 * **À partir de quelle largeur la pile de fiches devient un vrai tableau**.
 *
 * Le palier était `md:` (768 px) pour tout le monde, et il le reste **par défaut** : cinq écrans
 * s'en servent (`/admin/audit`, `/admin/sessions`, `/admin/comptes`, `/admin/periodes`,
 * `/gestion/evenements`) et rien ne doit bouger d'un pixel chez eux.
 *
 * Ce que `lg` (1 024 px) ajoute, c'est le cas de l'annuaire — un tableau dans une **page qui
 * s'élargit à 1 024 px** (`PLEINE_LARGEUR`). Entre 768 et 1 023 px, la page est encore dans sa
 * colonne de lecture : y déplier cinq colonnes, dont deux portent des adresses email, revient à
 * serrer l'information dans 736 px alors que la pile de fiches la rend entière. Le tableau attend
 * donc **le pixel où la page s'élargit**, et les deux décisions ne peuvent plus diverger.
 *
 * **Deux jeux de classes écrits en entier, et c'est volontaire** : Tailwind lit les sources, et une
 * classe fabriquée au vol (le palier suivi de « :table ») n'existerait jamais dans le CSS engendré.
 */
export type PalierTableau = "md" | "lg";

/**
 * Les trois différences du palier `lg`, au-delà du simple décalage de seuil :
 *
 * - **pas de défilement intérieur** (`overflow-x-auto`). Il protège un tableau déplié dans un
 *   conteneur plus étroit que lui ; au palier `lg` ce conteneur est, par construction, une page
 *   large (976 px au minimum pour 90 rem de plafond). Et il **découperait** le volet « Gérer » de
 *   l'annuaire : `overflow-x: auto` emporte l'axe vertical avec lui, donc la bulle ancrée sous le
 *   bouton d'une ligne — le seul geste de la ligne — se retrouverait coupée au bord du cadre ;
 * - **pas de largeur minimale** : sans défilement intérieur, une largeur minimale ne pourrait que
 *   déborder la page, exactement ce que le dépôt refuse ;
 * - le reste est le même tableau, au pixel près, un seuil plus loin.
 */
const CLASSES: Record<
  PalierTableau,
  { cadre: string; table: string; entete: string; corps: string; ligne: string; cellule: string; intitule: string; valeur: string }
> = {
  md: {
    cadre: "md:overflow-x-auto",
    /* `md:min-w-[32.5rem]` — les mêmes 520 px qu'avant tant que le navigateur est réglé sur 16 px,
       mais **en rem** : qui grossit les caractères veut des colonnes plus larges, pas du texte
       serré dans une largeur figée. Le seuil `md:` reste : en dessous, chaque ligne devient une
       fiche `block w-full`, et aucune largeur minimale ne s'applique — un téléphone de 390 px ne
       doit jamais avoir à défiler horizontalement. */
    table: "md:table md:min-w-[32.5rem]",
    entete: "md:table-header-group",
    corps: "md:table-row-group",
    ligne: "md:table-row md:p-0",
    cellule: "md:table-cell md:py-2.5 md:align-middle",
    intitule: "md:hidden",
    valeur: "md:contents",
  },
  lg: {
    cadre: "",
    table: "lg:table",
    entete: "lg:table-header-group",
    corps: "lg:table-row-group",
    ligne: "lg:table-row lg:p-0",
    cellule: "lg:table-cell lg:py-2.5 lg:align-middle",
    intitule: "lg:hidden",
    valeur: "lg:contents",
  },
};

export function Tableau({
  entetes,
  children,
  vide,
  palier = "md",
}: {
  entetes: ReactNode[];
  children: ReactNode;
  vide?: ReactNode;
  /** Où la pile de fiches devient un vrai tableau. `md` (768 px) par défaut : voir {@link PalierTableau}. */
  palier?: PalierTableau;
}) {
  const c = CLASSES[palier];
  return (
    <div className={`rounded-xl border border-bordure/60 ${c.cadre}`}>
      <table className={`block w-full border-collapse text-left ${c.table}`}>
        <thead className={`hidden bg-surface-douce text-sm uppercase tracking-wide text-texte-secondaire ${c.entete}`}>
          <tr>
            {entetes.map((e, i) => (
              /* `scope="col"` : sans lui, un lecteur d'écran n'associe aucune cellule à sa colonne
                  — six écrans du dépôt en dépendent, et aucun ne l'avait. Au doigt, les intitulés
                  `sr-only` de chaque cellule compensent ; au-delà du palier ils sont masqués, et
                  l'en-tête est alors la **seule** association. Un attribut ici répare les six. */
              <th key={i} scope="col" className="px-3 py-2 font-semibold">
                {e}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={`block divide-y divide-bordure/60 ${c.corps}`}>{children}</tbody>
      </table>
      {vide}
    </div>
  );
}

/** Ligne du tableau : une fiche sur téléphone, une ligne sur PC. */
export function Ligne({ children, className = "", palier = "md" }: { children: ReactNode; className?: string; palier?: PalierTableau }) {
  return <tr className={`block px-1 py-2 ${CLASSES[palier].ligne} ${className}`}>{children}</tr>;
}

export function Cellule({
  children,
  className = "",
  title,
  label,
  palier = "md",
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  title?: string;
  label?: ReactNode;
  palier?: PalierTableau;
  /** Une cellule qui tient toute la ligne (un repère alphabétique, un pied de liste). */
  colSpan?: number;
}) {
  const c = CLASSES[palier];
  return (
    <td className={`flex items-baseline justify-between gap-3 px-3 py-1 ${c.cellule} ${className}`} title={title} colSpan={colSpan}>
      {label !== undefined && <span className={`shrink-0 text-sm font-semibold text-texte-secondaire ${c.intitule}`}>{label}</span>}
      <span className={`block min-w-0 ${c.valeur}`}>{children}</span>
    </td>
  );
}
