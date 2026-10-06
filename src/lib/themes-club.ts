/**
 * **Les thèmes du club, tant que le bureau n'a pas enregistré sa propre liste.**
 *
 * Les thèmes proposés dans les cases du planning sont un réglage (*Thèmes et lieux*, `/admin/themes`).
 * Quand ce réglage n'a **jamais été enregistré**, `getThemes` (`src/lib/planning.ts`) propose cette
 * liste ; dès que le bureau enregistre quoi que ce soit, c'est son réglage qui fait foi.
 *
 * C'est le programme de ce club-ci (Antrim Bata, Hache de pas, Viking…), pas une liste d'AMHE
 * neutre : elle vivait dans `src/lib/constants.ts` et partait telle quelle dans le dépôt public.
 * Même traitement que les salles (`lieux-club.ts`) : **ce fichier ne part pas dans le dépôt public**,
 * `scripts/fabriquer-public.ts` en écrit une version à liste vide (voir `FICHIERS_NEUTRALISES`) : aucune donnée d'exemple.
 */
export const THEMES_DU_CLUB: readonly string[] = [
  "Antrim Bata",
  "Bauernwehr",
  "Couteau",
  "Dague",
  "Dussack",
  "Épée et bocle",
  "Épée longue",
  "Hache de pas",
  "Lance",
  "Lutte",
  "Messer",
  "Montante",
  "Rapière",
  "Sidesword",
  "Sparring",
  "Viking",
];

/**
 * **Les thèmes d'échauffement proposés tant que le bureau n'a pas enregistré sa propre liste**
 * (Delta : « récupère la liste des thèmes que j'ai et pousse les deux dans le public et le
 * privé »). Même règle que `THEMES_DU_CLUB` : une liste enregistrée, même vide, fait toujours foi
 * (`getThemesEchauffement`, src/lib/planning.ts).
 */
export const THEMES_ECHAUFFEMENT_DU_CLUB: readonly string[] = [
  "Échauffement général",
  "Cardio et mobilité",
  "Jeu de jambes et déplacements",
  "Coupes et gardes à vide",
  "Jeux d'opposition",
  "Jeux de touche",
  "Lutte et chutes",
];
