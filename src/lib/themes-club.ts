/**
 * **Les thèmes proposés tant que le bureau n'a pas enregistré sa propre liste.**
 *
 * Vide, comme les salles : un club qui installe l'outil n'a pas à hériter du programme d'un autre,
 * ni d'une liste « d'exemple ». Chaque case du planning garde « Autre… » pour saisir un thème, et la
 * liste se règle dans l'espace admin (*Thèmes et lieux*) ; voir `getThemes` (`src/lib/planning.ts`).
 */
export const THEMES_DU_CLUB: readonly string[] = [];
