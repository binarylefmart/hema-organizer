import type { SVGProps } from "react";

/**
 * Jeu d'icônes monolignes (24×24, trait 2) — pas d'emoji dans l'interface.
 * Décoratives par défaut (aria-hidden) ; passer `titre` pour une icône porteuse de sens.
 */
const TRACES = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  croix: "M6 6l12 12M18 6L6 18",
  question: "M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1.9-1.1 1.8M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  calendrier: "M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  horloge: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  lieu: "M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10zM12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  livre: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13",
  personne: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  groupe: "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 4.5a4 4 0 0 1 0 7M22 21a7 7 0 0 0-5-6.7",
  outil: "M14.5 6.5a3.5 3.5 0 0 0 4.7 4.7L21 13l-8 8-2-2 6-6-1.8-1.8-6 6-2-2 8-8 1.8 1.8a3.5 3.5 0 0 0-4.5-4.5L14.5 6.5zM3 21l3-3",
  epee: "M20 4l-2.5 6L9 18.5M20 4l-6 2.5L5.5 15M6 12l6 6M7.5 16.5L4 20",
  boussole: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5 5-2z",
  // Bouclier : la silhouette d'écu, et deux planches verticales pour le bois d'un bouclier viking.
  // L'espace de celui qui encadre le cours (onglet « Espace instructeur »).
  // La rondache — disque + umbo central — a été essayée d'abord, puisque c'est le vrai bouclier
  // viking : à 20 px, la taille où l'icône vit dans la barre, elle se lit **bouée de sauvetage**
  // ou cible, jamais bouclier (six variantes rendues côte à côte à 96 et 20 px avant de trancher).
  // La silhouette d'écu, elle, se reconnaît à toutes les tailles ; les planches gardent le bois.
  bouclier: "M12 21.5c-4.5-1.8-7-5.6-7-10.2V5.6l7-2.6 7 2.6v5.7c0 4.6-2.5 8.4-7 10.2zM9 4.4v14.6M15 4.4v14.6",
  // Étendard : hampe et bannière à queue d'aronde — l'annonce qu'on hisse (onglet Événements).
  // Une silhouette pleine hauteur, qui ne peut se confondre ni avec le calendrier du planning,
  // ni avec l'épée des présences, ni avec l'outil de l'atelier.
  etendard: "M6 3v18M6 5h13l-2.5 3.5L19 12H6",
  // Lien vers l'extérieur : la flèche qui sort du cadre (publications, billetteries)
  lienExterne: "M14 4h6v6M20 4l-8 8M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5",
  // Partage : les trois nœuds reliés, le symbole que tout le monde reconnaît
  partage: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  // Copie : deux feuillets décalés
  copie: "M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  info: "M12 16v-4M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  alerte: "M12 9v4M12 17h.01M10.3 4.3L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z",
  sortie: "M15 17l5-5-5-5M20 12H9M13 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7",
  telecharger: "M12 3v12M7 10l5 5 5-5M4 21h16",
  fleche: "M5 12h14M13 6l6 6-6 6",
  chevronBas: "M6 9l6 6 6-6",
  // Le pendant du chevron bas : il n'apparaît que sur un bloc déjà déplié (« Replier »).
  chevronHaut: "M18 15l-6-6-6 6",
  interdit: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  // Sablier : la durée annoncée d'un événement (« 2 jours », « une demi-journée »). Volontairement
  // distinct de l'horloge, qui porte déjà l'horaire : une durée n'est pas une heure.
  sablier: "M7 3h10M7 21h10M17 3v3.4c0 1.6-5 3.8-5 5.6s5 4 5 5.6V21M7 3v3.4c0 1.6 5 3.8 5 5.6s-5 4-5 5.6V21",
  // Étiquette : le tarif. Un champ de prix vide se lit « Gratuit » — l'étiquette est donc toujours là.
  etiquette: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  // Roue crantée : **l'espace admin**, et lui seul. L'écu était déjà pris par l'espace instructeur,
  // et deux écus côte à côte dans la barre ne disaient plus lequel menait où. La roue dentée est le
  // signe que tout le monde lit « réglages », sans avoir rien à apprendre — c'est exactement ce
  // qu'est cet espace : les paramètres techniques, les comptes, les sessions, le journal.
  // Deux tracés dans un seul `d` (le contour denté, puis le moyeu) : le composant ne pose qu'un
  // `<path>`, et un gabarit à 24×24 trait 2 supporte très bien les deux.
  engrenage:
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
} as const;

export type NomIcone = keyof typeof TRACES;

type Props = SVGProps<SVGSVGElement> & { nom: NomIcone; taille?: number; titre?: string };

/**
 * `taille` est donnée en pixels par les appelants, et reste écrite telle quelle dans les attributs
 * `width`/`height` — c'est la taille intrinsèque du SVG, celle qui s'applique si la feuille de
 * style n'arrive pas. La taille **affichée**, elle, est posée en rem : une icône côtoie toujours du
 * texte, et une icône figée à 20 px à côté d'un texte grossi à 24 px se lit comme une coquille.
 * Un appelant peut toujours passer son propre `style` : il est fusionné en dernier.
 */
export function Icone({ nom, taille = 20, titre, className = "", style, ...props }: Props) {
  const cote = `${taille / 16}rem`;
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={titre ? undefined : true}
      role={titre ? "img" : undefined}
      className={`shrink-0 ${className}`}
      {...props}
      style={{ width: cote, height: cote, ...style }}
    >
      {titre && <title>{titre}</title>}
      <path d={TRACES[nom]} />
    </svg>
  );
}
