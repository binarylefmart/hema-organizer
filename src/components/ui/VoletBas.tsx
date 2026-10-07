"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { boutonClasses } from "./Bouton";
import { indexFocusSuivant } from "./barre-selection";

/** Ce qui prend le focus au clavier dans le volet : le piège ne tourne que sur eux. */
const FOCALISABLES =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * **Le volet qui monte du bas de l'écran** (« bottom sheet ») : là où la sélection multiple du
 * téléphone range ses gestes (`BarreSelection` → « Que faire sur ces 3 séances ? »).
 *
 * Il ne s'appelle pas `Volet` parce que ce nom est pris : `Volet.tsx` est le petit formulaire qui
 * s'ouvre depuis un bouton (un `<details>`), panneau du bas sur téléphone et bulle sur ordinateur. Ici
 * c'est une **vraie fenêtre modale**, pilotée par l'écran :
 *
 * - un **voile** assombrit la page et la ferme d'un appui ; Échap et « Fermer » la ferment aussi ;
 * - une **poignée** (décorative) et un **titre** — le bouton qui l'a ouverte est caché derrière ;
 * - `role="dialog"` et `aria-modal` : le lecteur d'écran sait que le reste de la page est hors jeu ;
 * - **le focus y est piégé** (Tab tourne sur ses contrôles) et **rendu au bouton d'origine** à la
 *   fermeture — sans cela, il retomberait sur `<body>`, à cinquante lignes de la sélection en cours ;
 * - la page derrière **ne défile plus** tant qu'il est ouvert : un doigt qui glisse sur le volet ne
 *   doit pas faire filer la liste qu'on vient de cocher.
 *
 * Il est rendu dans `<body>` (portail) : posé dans une carte ou un `<details>`, une boîte ancêtre
 * pourrait le couper ou le passer sous la barre d'onglets.
 */
export function VoletBas({
  ouvert,
  titre,
  onFermer,
  children,
}: {
  ouvert: boolean;
  titre: string;
  onFermer: () => void;
  children: ReactNode;
}) {
  const idTitre = useId();
  const panneau = useRef<HTMLDivElement>(null);
  /** Le contrôle qui avait le focus à l'ouverture : il le retrouve à la fermeture. */
  const origine = useRef<HTMLElement | null>(null);
  // La fonction change à chaque rendu de l'appelant : on lit la dernière sans relancer les effets.
  const fermer = useRef(onFermer);
  useEffect(() => {
    fermer.current = onFermer;
  }, [onFermer]);

  useEffect(() => {
    if (!ouvert) return;
    origine.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panneau.current?.focus();
    const debordement = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const auClavier = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        fermer.current();
        return;
      }
      if (e.key !== "Tab" || !panneau.current) return;
      const controles = [
        ...panneau.current.querySelectorAll<HTMLElement>(FOCALISABLES),
      ];
      if (controles.length === 0) {
        e.preventDefault();
        return;
      }
      const courant = controles.indexOf(document.activeElement as HTMLElement);
      // Le navigateur sait aller au suivant à l'intérieur : on ne reprend la main qu'aux deux bouts.
      const suivant = indexFocusSuivant(courant, controles.length, e.shiftKey);
      const auBout =
        courant < 0 ||
        (e.shiftKey ? courant === 0 : courant === controles.length - 1);
      if (auBout) {
        e.preventDefault();
        controles[suivant]?.focus();
      }
    };
    document.addEventListener("keydown", auClavier);
    return () => {
      document.removeEventListener("keydown", auClavier);
      document.body.style.overflow = debordement;
      // Le bouton d'origine peut avoir disparu (la sélection s'est vidée avec le geste) : on ne rend
      // le focus qu'à un élément encore dans la page.
      if (origine.current?.isConnected) origine.current.focus();
    };
  }, [ouvert]);

  if (!ouvert || typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Le voile : il n'est pas une cible du clavier (Échap et « Fermer » le sont), seulement du doigt. */}
      <div
        aria-hidden
        className="fixed inset-0 z-40 bg-encre/50"
        onClick={() => fermer.current()}
      />
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] max-w-[40rem] flex-col rounded-t-2xl border-t border-bordure bg-surface text-base text-texte shadow-carte outline-none"
      >
        <div className="flex flex-col gap-2 px-4 pt-2">
          {/* La poignée : elle dit « ceci monte du bas, et redescend » — décorative, on ne la tire pas. */}
          <span
            aria-hidden
            className="mx-auto block h-1.5 w-12 rounded-full bg-bordure"
          />
          <div className="flex items-center justify-between gap-3">
            <h2 id={idTitre} className="text-lg font-bold">
              {titre}
            </h2>
            <button
              type="button"
              onClick={() => fermer.current()}
              className={boutonClasses("secondaire", "petite")}
            >
              Fermer
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-3">
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
