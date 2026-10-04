import type { ReactNode } from "react";
import { couleurPersonne } from "@/lib/couleurs";
import { niveauAffiche, NIVEAU_LABELS } from "@/lib/constants";
import { Icone } from "@/components/ui/Icone";

/**
 * Pastille de couleur d'une personne (identification rapide dans les listes et le planning).
 *
 * `taille` est donnée en pixels par les appelants, mais **posée en rem** : une pastille de 10 px
 * collée à un texte que le navigateur affiche en 20 px deviendrait un point invisible à côté du nom
 * qu'elle qualifie. En rem, elle grandit avec lui — et rend exactement les mêmes pixels qu'avant
 * tant que personne n'a touché à ses réglages.
 */
export function PastillePersonne({ id, couleur, taille = 10, className = "" }: { id: string; couleur?: number | null; taille?: number; className?: string }) {
  const cote = `${taille / 16}rem`;
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${className}`} style={{ width: cote, height: cote, backgroundColor: couleurPersonne(id, couleur) }} />;
}

/**
 * Pastille de statut : le mot qui qualifie une ligne (« ACTIVE », « désactivé », « lien jamais
 * ouvert »). Elle vivait dans `Carte.tsx`, où personne n'allait la chercher — un fichier
 * `Pastille.tsx` existait déjà, avec sa voisine de couleur.
 */
export function Pastille({ children, ton = "neutre" }: { children: ReactNode; ton?: "neutre" | "vert" | "rouge" | "ocre" | "primaire" }) {
  const tons = {
    neutre: "bg-surface-douce text-texte-secondaire",
    vert: "bg-vert-doux text-vert",
    rouge: "bg-rouge-doux text-rouge",
    ocre: "bg-ocre-doux text-ocre",
    primaire: "bg-primaire-doux text-primaire",
  };
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-semibold ${tons[ton]}`}>{children}</span>;
}

/**
 * **Niveau annoncé d'une case du planning** (« Débutant », « Intermédiaire », « Avancé »).
 *
 * Elle ne rend **rien du tout** quand le niveau est indifférent — le cas de l'immense majorité des
 * cours : une pastille « Indifférent » sur chaque ligne de chaque fiche n'apprendrait rien et
 * repousserait le thème, seule information que le lecteur est venu chercher. La règle est tenue au
 * même endroit pour tous les écrans (`niveauAffiche`), pour qu'aucun ne l'oublie dans son coin.
 *
 * Volontairement **sans couleur propre** : les trois niveaux ne se classent pas du meilleur au pire,
 * et la charte réserve ses couleurs à ce qui alerte (rouge), rassure (vert) ou met en avant (or). Un
 * gris de texte secondaire sur la surface douce, comme les libellés de partie des pages de partage.
 */
export function PastilleNiveau({ niveau, compact = false }: { niveau: string | null | undefined; compact?: boolean }) {
  const n = niveauAffiche(niveau);
  if (!n) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-douce font-semibold text-texte-secondaire ${
        compact ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-sm"
      }`}
    >
      {/* L'étiquette dit « ceci qualifie ce qui précède » ; le mot reste, l'icône ne le remplace jamais */}
      <Icone nom="etiquette" taille={compact ? 12 : 14} />
      Niveau {NIVEAU_LABELS[n].toLocaleLowerCase("fr")}
    </span>
  );
}
