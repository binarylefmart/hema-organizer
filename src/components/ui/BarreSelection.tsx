"use client";

import type { ReactNode } from "react";
import { Icone } from "./Icone";
import {
  compteSelection,
  libelleAffichees,
  suffixeSelection,
} from "./barre-selection";
import type { MotsLignes } from "./selection";

/**
 * **La barre de la sélection multiple, au téléphone** — la même sur les quatre écrans
 * de masse. Sur ordinateur, chaque écran garde sa barre d'avant : ce composant n'y est pas monté.
 *
 * Elle n'existe qu'avec une sélection (`barreDeMasseVisible`, la règle commune), et elle est **collée
 * en bas, au-dessus de la barre d'onglets** : même décalage que `BarreEdition`, zone système comprise
 * (`tests/unit/barres-collantes.test.ts` l'exige de toute barre du bas). **Même habit que la barre
 * d'édition** (fond clair, bord de la couleur principale, un seul bouton plein) : sombre, elle était la
 * seule barre noire de l'application et détonnait sous le planning. Sur une tablette, elle reste dans
 * la colonne du contenu (40 rem) au lieu de traverser l'écran.
 *
 * - **ligne 1** : le compte dans les mots de l'écran (« 3 séances »), le bouton qui coche ce qui est
 *   affiché — il nomme sa portée (« Les 5 affichées »), jamais « Tout » — et ✕, qui vide la sélection ;
 * - **ligne 2** : ce que l'écran y met (`children`) — un seul gros bouton qui ouvre le volet des
 *   gestes, ou, aux présences, les quatre réponses directement.
 *
 * `auDessus` la remonte d'un cran sur un écran qui a déjà sa barre du bas : le planning en mode
 * modification garde « Annuler · Appliquer » en dessous, sans quoi on ne pourrait plus appliquer
 * pendant qu'on coche. Elle se cale sur la hauteur **réelle** de cette barre, que celle-ci publie
 * (`VARIABLE_HAUTEUR_BARRE_EDITION`) : à hauteur fixe, l'aide « i » ouverte ou un message d'erreur
 * faisaient passer « Appliquer » sous la barre de sélection.
 */
export function BarreSelection({
  nom,
  n,
  mots,
  affichees,
  toutesCochees,
  libelleCocherAffichees,
  onCocherAffichees,
  onDecocherAffichees,
  onVider,
  libelleVider = "Annuler la sélection",
  horsAffichage,
  enCours = false,
  auDessus = false,
  actions,
  children,
}: {
  /** Le nom du groupe pour le lecteur d'écran : celui de la barre de l'ordinateur. */
  nom: string;
  n: number;
  mots: MotsLignes;
  /** Combien de lignes cochables l'écran affiche : la portée du bouton « Les N affichées ». */
  affichees: number;
  /** Elles le sont toutes : le bouton n'a plus rien à prendre. */
  toutesCochees: boolean;
  /** Son nom complet, celui de la case maîtresse (« Sélectionner les 5 séances affichées »). */
  libelleCocherAffichees: string;
  onCocherAffichees: () => void;
  /**
   * Fourni, le bouton « Les N affichées » devient une **case « Tout sélectionner »** qui coche et
   * décoche les lignes affichées (Séances et Planning). Sans lui,
   * le bouton d'avant (annuaire, présences).
   */
  onDecocherAffichees?: () => void;
  /** Absent : pas de ✕ sur la ligne 1 (le planning porte le sien avec « Appliquer », ligne 2). */
  onVider?: () => void;
  /**
   * Le nom de ✕. Aux Séances et au Planning, la barre est **toute la commande du mode** au téléphone
   * (« Tout sélectionner », ✕ et « Appliquer » n'y sont qu'une fois) : ✕ y quitte la sélection, il ne
   * se contente pas de la vider.
   */
  libelleVider?: string;
  /** Une ligne 3, sous le gros bouton, calée à droite : ✕ et « Appliquer » du planning. */
  actions?: ReactNode;
  /** Ce que le lot emporte hors de l'écran (`texteHorsAffichage`), compté et dit. */
  horsAffichage?: string | null;
  enCours?: boolean;
  auDessus?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={nom}
      data-barre-basse="selection"
      className={`fixed inset-x-2 z-20 mx-auto flex max-w-[39rem] flex-col gap-2 rounded-2xl border-2 border-primaire/40 bg-surface/95 p-3 text-base text-texte shadow-carte backdrop-blur ${
        auDessus
          ? "bottom-[calc(env(safe-area-inset-bottom,0px)+6rem+var(--hauteur-barre-edition,4rem))]"
          : "bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 font-semibold">
          {compteSelection(n, mots)}
          {/* À l'oreille, « 3 séances » ne dit pas qu'elles sont cochées : la fin de phrase est lue, pas montrée. */}
          <span className="sr-only">{suffixeSelection(n, mots)}</span>
        </p>
        {affichees > 0 && onDecocherAffichees && (
          <label className="inline-flex min-h-12 shrink-0 cursor-pointer items-center gap-2 rounded-xl border-2 border-bordure bg-surface px-3 font-semibold text-texte">
            <input
              type="checkbox"
              aria-label={libelleCocherAffichees}
              checked={toutesCochees}
              disabled={enCours}
              onChange={() => (toutesCochees ? onDecocherAffichees() : onCocherAffichees())}
              className="size-6 accent-primaire"
            />
            Tout sélectionner
          </label>
        )}
        {affichees > 0 && !onDecocherAffichees && (
          <button
            type="button"
            aria-label={libelleCocherAffichees}
            disabled={toutesCochees || enCours}
            onClick={onCocherAffichees}
            className="inline-flex min-h-12 shrink-0 items-center rounded-xl border-2 border-bordure bg-surface px-3 font-semibold text-texte transition active:scale-[0.98] disabled:opacity-50"
          >
            {libelleAffichees(affichees, mots)}
          </button>
        )}
        {onVider && (
        <button
          type="button"
          aria-label={libelleVider}
          title={libelleVider}
          disabled={enCours}
          onClick={onVider}
          className="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-bordure bg-surface text-texte transition active:scale-[0.98] disabled:opacity-50"
        >
          <Icone nom="croix" taille={20} />
        </button>
        )}
      </div>
      {horsAffichage ? (
        <p className="text-base text-texte-secondaire">{horsAffichage}</p>
      ) : null}
      {children}
      {/* ✕ et « Appliquer » du planning : une ligne à eux, sous « Continuer », calés à droite et
          séparés d'un trait. */}
      {actions ? <div className="mt-1 flex justify-end border-t border-bordure/60 pt-3">{actions}</div> : null}
    </div>
  );
}

/**
 * **La réserve sous la liste** tant que la barre est là : posée après la dernière ligne, sans quoi les
 * dernières cartes cochées ne sortiraient jamais de dessous la barre.
 */
export function ReserveBarreSelection({
  auDessus = false,
  haute = false,
}: {
  auDessus?: boolean;
  /** La barre porte une ligne de plus (✕ et « Appliquer » du planning). */
  haute?: boolean;
}) {
  return <div aria-hidden className={auDessus ? "h-[calc(10rem+var(--hauteur-barre-edition,4rem))]" : haute ? "h-56" : "h-36"} />;
}

/**
 * **Le gros bouton de la ligne 2** : « Que faire sur ces 3 séances ? ». Clair sur la barre sombre —
 * les couleurs inversées de l'en-tête, lisibles sur chaque thème du club.
 */
export function BoutonQueFaire({
  libelle,
  onClick,
  disabled = false,
}: {
  libelle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primaire px-4 font-semibold text-primaire-texte shadow-carte transition active:scale-[0.98] disabled:opacity-60"
    >
      {libelle}
      <Icone nom="chevronHaut" taille={18} />
    </button>
  );
}
