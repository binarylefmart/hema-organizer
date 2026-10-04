"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { boutonClasses, type Taille, type Variante } from "@/components/ui/Bouton";

/**
 * **Un petit formulaire qui s'ouvre depuis un bouton, sans jamais sortir de l'écran.**
 *
 * Il remplace le motif qui traînait copié-collé à deux endroits (annuler une séance, donner son
 * adresse à un membre) : un `<details>` dont le panneau était posé en `absolute right-0`. Ce
 * `right-0` désigne le bord droit **du conteneur des boutons**, pas celui de l'écran — et sur un
 * téléphone ce conteneur passe à la ligne, se retrouve à gauche et fait large de 200 px. Le
 * panneau, lui, en fait 288 : il débordait de 60 px **hors de l'écran, à gauche**, le libellé «
 * Motif » et la moitié du bouton « Annuler la séance » coupés net, sans même une barre de
 * défilement pour aller les chercher.
 *
 * D'où deux formes pour un seul composant, celles que l'application emploie déjà pour le volet des
 * événements :
 *
 * - **sur téléphone, un panneau posé en bas de l'écran** (`fixed inset-x-0 bottom-0`), large comme
 *   la fenêtre et jamais plus : il n'a plus de conteneur à déborder. Il porte son propre titre —
 *   le bouton qui l'a ouvert peut être caché derrière lui — et se ferme d'un appui à côté, par le
 *   bouton « Fermer », ou par Échap ;
 * - **à partir de `sm`, la bulle ancrée sous le bouton**, comme avant. Là, la place existe : le
 *   conteneur est à sa droite naturelle et le panneau tient dans la page.
 *
 * Le `<details>` natif est gardé exprès : il s'ouvre au clavier, il s'ouvre sans JavaScript, et
 * l'attribut `name` (`groupe`) suffit à ce que deux volets d'une même liste ne restent pas ouverts
 * ensemble. Le script n'ajoute que ce que le HTML ne sait pas faire : fermer de l'intérieur, et
 * faire monter la page quand la bulle d'ordinateur dépasse le bas de la fenêtre — même règle que
 * la liste déroulante du planning, « on fait exister la place plutôt que retourner le panneau ».
 */

/** Un peu d'air sous la bulle, pour qu'elle ne colle pas au bord de la fenêtre. */
const MARGE_BAS = 16;

/** Le seuil `sm` de Tailwind : en dessous, le panneau est posé en bas de l'écran. */
const SEUIL_SM = "(min-width: 40rem)";

type Props = {
  /** Libellé du bouton qui ouvre le volet. */
  libelle: ReactNode;
  /** Libellé du même bouton une fois ouvert (« Fermer ») ; sans lui, le libellé ne change pas. */
  libelleOuvert?: ReactNode;
  /** Titre du panneau, affiché sur téléphone : le bouton d'origine est alors hors de vue. */
  titre: string;
  variante?: Variante;
  taille?: Taille;
  /** Largeur de la bulle sur grand écran (classe Tailwind `sm:w-…`). */
  largeur?: string;
  /** Volets d'une même liste : un seul reste ouvert à la fois (attribut `name` du `<details>`). */
  groupe?: string;
  children: ReactNode;
};

export function Volet({ libelle, libelleOuvert, titre, variante = "secondaire", taille = "petite", largeur = "sm:w-72", groupe, children }: Props) {
  const volet = useRef<HTMLDetailsElement>(null);

  const fermer = () => {
    const d = volet.current;
    if (!d) return;
    d.open = false;
    // Le focus revient là où il était parti : sans cela, il repart au début de la page.
    d.querySelector("summary")?.focus();
  };

  /**
   * Sur grand écran, la bulle est posée sous le bouton et peut dépasser le bas de la fenêtre — le
   * bouton d'envoi se retrouve alors hors de vue, et rien ne dit qu'il faut défiler. On fait donc
   * monter la page du manque exact. Sur téléphone il n'y a rien à faire : le panneau est en bas de
   * l'écran, il y est par construction.
   */
  const placer = () => {
    const d = volet.current;
    if (!d?.open || !window.matchMedia(SEUIL_SM).matches) return;
    const panneau = d.querySelector<HTMLElement>("[data-panneau]");
    if (!panneau) return;
    const manque = panneau.getBoundingClientRect().bottom + MARGE_BAS - window.innerHeight;
    if (manque > 0) window.scrollBy({ top: manque, behavior: "smooth" });
  };

  /** Échap ferme, comme partout ailleurs. L'écouteur n'existe que le temps de l'ouverture. */
  useEffect(() => {
    const d = volet.current;
    if (!d) return;
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === "Escape" && d.open) fermer();
    };
    document.addEventListener("keydown", auClavier);
    return () => document.removeEventListener("keydown", auClavier);
  }, []);

  return (
    <details ref={volet} name={groupe} onToggle={placer} className="group sm:relative">
      <summary
        className={`${boutonClasses(variante, taille)} cursor-pointer list-none group-open:opacity-80 [&::-webkit-details-marker]:hidden`}
      >
        {libelleOuvert ? (
          <>
            <span className="group-open:hidden">{libelle}</span>
            <span className="hidden group-open:inline">{libelleOuvert}</span>
          </>
        ) : (
          libelle
        )}
      </summary>
      {/* Le rideau : il assombrit la page derrière le panneau du téléphone et rend le geste « appuyer
          à côté pour fermer ». Sur grand écran il n'existe pas — une bulle ne prend pas l'écran. */}
      <button type="button" aria-label="Fermer" tabIndex={-1} onClick={fermer} className="fixed inset-0 z-30 cursor-default bg-encre/40 sm:hidden" />
      <div
        data-panneau
        className={`fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-bordure bg-surface p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] text-left shadow-carte sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:z-10 sm:mt-1 sm:max-h-none sm:overflow-visible sm:rounded-xl sm:border sm:p-3 sm:pb-3 ${largeur}`}
      >
        {/* En-tête du seul panneau de téléphone : il dit de quoi il s'agit (le bouton d'origine est
            derrière le rideau) et porte la sortie. Sur grand écran, la bulle touche son bouton, qui
            reste visible et porte lui-même « Fermer » : cet en-tête n'aurait rien à apprendre. */}
        <div className="mb-3 flex items-center justify-between gap-3 sm:hidden">
          <h3 className="text-lg font-bold">{titre}</h3>
          <button type="button" onClick={fermer} className={boutonClasses("secondaire", "petite")}>
            Fermer
          </button>
        </div>
        {children}
      </div>
    </details>
  );
}
