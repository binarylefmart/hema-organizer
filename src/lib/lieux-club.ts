/**
 * **Les salles proposées tant que le bureau n'a pas enregistré sa propre liste.**
 *
 * Vide : un club qui installe l'outil n'a pas encore dit où il s'entraîne. Les lieux habituels se
 * règlent dans l'espace admin (*Thèmes et lieux*) ; voir `src/lib/lieux.ts` et `getLieux`
 * (`src/lib/planning.ts`). Une liste enregistrée, même vide, fait toujours foi.
 */
export const LIEUX_DU_CLUB: readonly { lieu: string; adresse: string }[] = [];
