"use client";

import {
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  ATTRIBUT_CASE,
  estUnAppui,
  SELECTEUR_INTERACTIF,
} from "./barre-selection";

/**
 * **Au téléphone, on coche en touchant la carte entière**, pas seulement sa case de 24 px.
 *
 * La zone enveloppe une liste dont chaque ligne porte **une** case marquée `data-case-selection`
 * (`ATTRIBUT_CASE`). Un appui sur une partie inerte d'une ligne — la date, le nom, un blanc — remonte
 * jusqu'au premier ancêtre qui contient **exactement une** de ces cases, et la coche comme si on
 * l'avait touchée : même `onChange`, mêmes verrous, même annonce. La case reste là, pour le clavier et
 * le lecteur d'écran ; c'est elle qui porte l'état.
 *
 * Ce qui n'est **pas** un appui sur la carte, et ne coche donc rien :
 *
 * - tout ce qui fait déjà quelque chose sous le doigt (liens, boutons, listes, champs —
 *   `SELECTEUR_INTERACTIF`) ;
 * - un glissé (défilement, ligne du planning tirée vers la gauche) : `estUnAppui` ;
 * - un clic dont la zone n'a pas vu le `pointerdown` (la poignée ⋮⋮ du planning l'arrête, et porte
 *   en plus `data-sans-cocher`) : `estUnAppui` sans départ répond non ;
 * - un appui entre deux lignes, dont l'ancêtre commun porte plusieurs cases.
 *
 * Éteinte (`actif` faux — ordinateur, ou interrupteur « Sélection multiple » éteint), la zone n'est
 * qu'une `div` : rien ne change.
 */
export function ZoneCochable({
  actif,
  className,
  children,
}: {
  actif: boolean;
  className?: string;
  children: ReactNode;
}) {
  const depart = useRef<{ x: number; y: number } | null>(null);

  const poser = (e: PointerEvent<HTMLDivElement>) => {
    depart.current = { x: e.clientX, y: e.clientY };
  };

  const toucher = (e: MouseEvent<HTMLDivElement>) => {
    if (!actif || e.defaultPrevented) return;
    const cible = e.target as Element;
    // Un départ ne sert qu'une fois : un clic dont la zone n'a pas vu le doigt se poser ne coche rien.
    const posee = depart.current;
    depart.current = null;
    if (!estUnAppui(posee, { x: e.clientX, y: e.clientY })) return;
    if (cible.closest(SELECTEUR_INTERACTIF)) return;
    for (
      let el: Element | null = cible;
      el && el !== e.currentTarget;
      el = el.parentElement
    ) {
      const cases = el.querySelectorAll<HTMLInputElement>(
        `input[${ATTRIBUT_CASE}]`,
      );
      if (cases.length > 1) return;
      if (cases.length === 1) {
        if (!cases[0].disabled) cases[0].click();
        return;
      }
    }
  };

  return (
    <div
      className={className}
      onPointerDown={actif ? poser : undefined}
      onClick={actif ? toucher : undefined}
    >
      {children}
    </div>
  );
}
