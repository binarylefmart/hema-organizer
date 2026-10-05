/**
 * **Les thèmes proposés tant que le bureau n'a pas enregistré sa propre liste.**
 *
 * Quelques disciplines courantes en AMHE, pour que le planning d'un club qui installe l'outil ne
 * s'ouvre pas sur une liste vide. Elles se remplacent dans l'espace admin (*Thèmes et lieux*) ; voir
 * `getThemes` (`src/lib/planning.ts`). Une liste enregistrée fait toujours foi.
 */
export const THEMES_DU_CLUB: readonly string[] = ["Dague", "Épée longue", "Lutte", "Rapière", "Sabre", "Sparring"];
