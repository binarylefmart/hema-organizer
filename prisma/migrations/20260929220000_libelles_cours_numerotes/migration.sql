/*
  « Cours n°1, Cours n°2 » (29/09/2026).

  POURQUOI. Le modèle d'une séance neuve posait « 1ère partie » et « 2nde partie ». Sur les captures
  d'un club de quatre-vingts, ces deux mots ne tiennent plus : une séance y compte souvent trois ou
  quatre parties de cours (un groupe débutants, un créneau de sparring encadré), et « 3ème partie »
  se lit comme un tiers de cours plutôt que comme le troisième cours de la soirée. Le vocabulaire
  devient « Cours n°1 », « Cours n°2 », « Cours n°3 »… (`libellePartieModele`, src/lib/constants.ts).
  Les options ne changent pas : « 1ère option », « 2e option »… disaient déjà la bonne chose.

  CE QUE FAIT CETTE MIGRATION. Elle renomme **uniquement les valeurs exactes posées par le modèle**,
  et seulement sur une partie du cours (`estOption = false`). Deux garde-fous, pour deux raisons
  distinctes :

  - l'égalité **exacte** du libellé (jamais un `LIKE`) : « 1ère partie — échauffement », écrit par
    un club qui a renommé sa ligne à la main, est une donnée de ce club. `libelle` est une donnée
    écrite par l'équipe, pas une clé : une migration n'a pas à réécrire ce que quelqu'un a tapé ;
  - la nature de la partie : une option qu'un club aurait nommée « 1ère partie » n'est pas le
    « Cours n°1 » du modèle, et lui donner ce nom la ferait mentir sur ce qu'elle est.

  Une séance dont l'équipe a déjà renommé les deux premières lignes ressort donc intacte, et la
  migration est rejouable sans effet.

  `updatedAt` n'est volontairement pas touché : changer le vocabulaire de l'application n'est pas
  une modification du programme par quelqu'un, et le journal de la séance ne doit pas le raconter
  comme telle — même règle que la renumérotation des rangs, juste avant.
*/

UPDATE "SessionPartie" SET "libelle" = 'Cours n°1' WHERE "libelle" = '1ère partie' AND "estOption" = false;

UPDATE "SessionPartie" SET "libelle" = 'Cours n°2' WHERE "libelle" = '2nde partie' AND "estOption" = false;
