/**
 * **Montrer du doigt la séance qu'on vient de retrouver.**
 *
 * Le bouton « Programme de la séance » d'une tuile amène sur une séance au milieu d'un trimestre
 * (`AllerALAncre`) : la carte visée doit se poser **en haut**, sous l'en-tête collant, et se laisser
 * reconnaître un instant.
 *
 * **Un module pour un seul appelant, et c'est assumé.** Il a été extrait parce que la bascule
 * Cours/Option avait le même besoin — montrer une ligne que le rangement venait de déplacer — puis
 * la bascule a été retirée le soir même (« enlève le slider et mets 2 boutons »). Ce qui reste
 * justifie le module à lui seul : la mécanique est **éprouvée**
 * (`tests/unit/repere-visuel.test.ts`, six cas, horloge et élément de pacotille), ce que le code
 * inline de l'ancre n'avait jamais été.
 *
 * **Pas de défilement animé**, décidé et gardé ici : `behavior: "smooth"` sur une grille de
 * planning fait glisser l'écran pendant qu'on vise la case suivante, et le mouvement n'est pas
 * réglable par `prefers-reduced-motion` quand il est demandé en JavaScript.
 */

/** Le temps que le trait reste visible. Assez pour que l'œil le trouve, trop court pour qu'il reste. */
export const DUREE_REPERE_MS = 2500;

/** Le trait lui-même : un anneau à la couleur de la marque, détaché du fond. */
export const CLASSES_REPERE = ["ring-2", "ring-marque", "ring-offset-2", "ring-offset-fond"] as const;

/**
 * Amène `cible` à l'écran (sauf si `defilerVers` est `null`), l'entoure du trait, et l'efface après
 * {@link DUREE_REPERE_MS}. Rend la fonction d'annulation à poser dans le ménage d'un effet.
 *
 * **Le défilement attend la frame suivante** : une image d'affiche, une police qui finit de charger,
 * une liste que le serveur vient de réordonner — la position juste n'est connue qu'après le prochain
 * calcul de mise en page. Sans ce report, on défile vers l'endroit où la ligne **était**.
 */
export function poserRepere(cible: HTMLElement, defilerVers: ScrollLogicalPosition | null = "start"): () => void {
  const image = requestAnimationFrame(() => {
    if (defilerVers) cible.scrollIntoView({ block: defilerVers });
    cible.classList.add(...CLASSES_REPERE);
  });
  const effacer = window.setTimeout(() => cible.classList.remove(...CLASSES_REPERE), DUREE_REPERE_MS);
  return () => {
    cancelAnimationFrame(image);
    window.clearTimeout(effacer);
    // Le trait part avec l'effet qui l'a posé : laissé derrière, il désignerait une ligne que plus
    // rien ne distingue — et la prochaine pose n'aurait plus rien à montrer.
    cible.classList.remove(...CLASSES_REPERE);
  };
}
