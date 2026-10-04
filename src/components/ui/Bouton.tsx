import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { EnCours } from "@/components/layout/EnCours";

export type Variante = "primaire" | "secondaire" | "danger" | "succes" | "discret";
export type Taille = "petite" | "normale" | "grande";

const VARIANTES: Record<Variante, string> = {
  primaire: "bg-primaire text-primaire-texte hover:brightness-110 border-transparent shadow-bouton",
  secondaire: "bg-surface text-texte border-bordure/70 hover:bg-surface-douce shadow-carte",
  danger: "bg-rouge text-primaire-texte hover:brightness-110 border-transparent shadow-bouton",
  succes: "bg-vert text-primaire-texte hover:brightness-110 border-transparent shadow-bouton",
  discret: "bg-transparent text-lien border-transparent hover:bg-surface-douce",
};

const TAILLES: Record<Taille, string> = {
  /*
   * **« petite » fait 48 px comme les deux autres**. Elle en faisait 44, alors que le JSDoc du
   * composant juste en dessous promettait 48 et que le cahier des charges ne connaît qu'un seul
   * chiffre. Ce n'était pas un détail : « petite » est la taille de **toutes** les actions
   * secondaires de l'application — annuler une sélection, déplier une liste, ajouter une partie —,
   * c'est-à-dire des boutons qu'on appuie plusieurs fois de suite, souvent debout dans une salle,
   * et le public visé compte des gens qui visent mal. Deux écrans avaient déjà corrigé le tir à la
   * main (`min-h-12` posé par-dessus dans `ListeRepliee` et `TableauMembres`) : la règle appartient
   * au bouton, pas à ses appelants.
   *
   * Ce qui distingue encore « petite » : ses marges et son texte, pas sa cible.
   */
  petite: "min-h-12 px-4 text-[0.9375rem]",
  normale: "min-h-12 px-5 text-[1.0625rem]",
  grande: "min-h-14 px-6 text-lg",
};

export const boutonClasses = (variante: Variante = "primaire", taille: Taille = "normale", pleineLargeur = false) =>
  [
    "inline-flex items-center justify-center gap-2 rounded-xl border-2 font-semibold",
    "transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed",
    VARIANTES[variante],
    TAILLES[taille],
    pleineLargeur ? "w-full" : "",
  ].join(" ");

type BoutonProps = ComponentProps<"button"> & {
  variante?: Variante;
  taille?: Taille;
  pleineLargeur?: boolean;
  children: ReactNode;
};

/** Bouton accessible : cible tactile ≥ 48 px, focus visible, libellé + icône. */
export function Bouton({ variante = "primaire", taille = "normale", pleineLargeur, className = "", ...props }: BoutonProps) {
  return <button {...props} className={`${boutonClasses(variante, taille, pleineLargeur)} ${className}`} />;
}

type LienBoutonProps = ComponentProps<typeof Link> & {
  variante?: Variante;
  taille?: Taille;
  pleineLargeur?: boolean;
  /** Affiche un témoin d'attente tant que l'écran demandé n'est pas là (`useLinkStatus`). */
  enCours?: boolean;
  children: ReactNode;
};

/**
 * Lien présenté comme un bouton. `enCours` y ajoute le témoin de navigation : à réserver aux liens
 * qui ouvrent un écran serveur (une séance, le planning…), là où l'attente se voit — un lien de
 * téléchargement ou une ancre n'ont rien à signaler.
 */
export function LienBouton({ variante = "primaire", taille = "normale", pleineLargeur, enCours = false, className = "", children, ...props }: LienBoutonProps) {
  return (
    <Link {...props} className={`${boutonClasses(variante, taille, pleineLargeur)} no-underline ${className}`}>
      {children}
      {enCours && <EnCours />}
    </Link>
  );
}
