"use client";

import { useEffect } from "react";

/**
 * **Ouvrir l'écran sur la séance du jour, à défaut la prochaine** (demande de Delta, planning et
 * onglet Séances, aux deux formats).
 *
 * L'écran marque cette carte (`data-seance-cible`, choisie par `seanceCible` côté serveur) ; ce
 * composant, rendu **avec** la liste résolue — comme `AllerALAncre`, et pour la même raison : la liste
 * arrive dans un `<Suspense>` —, l'amène en haut de la fenêtre si elle n'y est pas déjà.
 *
 * **Une cible explicite passe toujours avant** : une ancre `#seance-…` (le bouton « Programme de la
 * séance ») est le travail d'`AllerALAncre`, et l'on ne bouge rien. Les autres cibles explicites (date
 * cherchée, séances choisies, position « Passé ») ne posent tout simplement pas de marque.
 *
 * On ne défile que si la carte n'est pas déjà dans la moitié haute de la fenêtre : sinon, le titre et
 * les filtres partiraient sous l'en-tête pour rien. Pas de défilement animé (voir `repere-visuel.ts`).
 */
export function AllerALaSeanceCible() {
  useEffect(() => {
    if (window.location.hash) return;
    const cible = document.querySelector<HTMLElement>("[data-seance-cible]");
    if (!cible) return;
    const image = requestAnimationFrame(() => {
      const haut = cible.getBoundingClientRect().top;
      if (haut >= 0 && haut < window.innerHeight / 2) return;
      cible.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(image);
  }, []);
  return null;
}
