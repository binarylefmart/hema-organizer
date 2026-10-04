/*
  « Les rangs des parties redeviennent contigus » (29/09/2026) — rattrapage de la migration
  précédente (`20260929200000_parties_libres_et_second_instructeur`).

  CE QUI S'EST PASSÉ. Cette migration finissait par renuméroter les parties avec un `UPDATE` dont
  le nouveau rang venait d'une sous-requête corrélée (« combien de lignes de la séance ont un ordre
  plus petit ? »). Or **SQLite met à jour ligne par ligne**, et la sous-requête relit la table *en
  cours de modification* : à partir de la deuxième ligne, elle compte des `ordre` que le même
  `UPDATE` vient de réécrire. Le rang calculé n'est donc pas le rang voulu.

  Ça ne se voyait pas sur une séance complète (les rangs 0,1,2,3 sont déjà les bons, l'`UPDATE`
  n'écrit rien de nouveau) — mais une séance **partiellement remplie**, précisément celle que la
  migration disait réparer, en sortait fausse. Exemple reproduit : une séance qui n'avait que ses
  deux ateliers (`OPTION_1`, `OPTION_2`), sans cours principal, la « 2e option » ayant été créée
  avant la « 1ère » — banal, puisque l'ancien code créait la ligne à la demande et la supprimait
  quand on vidait la case. Rangs obtenus : **1 et 1**. Aucun rang 0, deux rangs égaux. Sur les 64
  séances possibles d'avant la migration (tout sous-ensemble des quatre cases × tout ordre de
  création), 11 sortaient fausses.

  POURQUOI C'EST GRAVE. « `ordre` contigu à partir de 0 » est l'invariant sur lequel s'appuient
  l'affichage du programme, la numérotation des options, l'API publique et les pages de partage.
  Faux dès le premier démarrage sur la vraie base, il donnait deux parties « Opt 2 » et un ordre
  entre ex æquo décidé par la base, donc instable d'une lecture à l'autre.

  LE CORRECTIF. **On calcule tous les rangs avant d'écrire quoi que ce soit.** La table temporaire
  est figée par `CREATE TABLE … AS SELECT`, donc `ROW_NUMBER()` voit la table intacte ; l'`UPDATE`
  qui suit ne lit plus que cette photo, et l'ordre dans lequel SQLite parcourt les lignes n'a plus
  aucun effet. C'est la seule façon sûre de renuméroter en SQL : une fonction de fenêtrage écrite
  directement dans la sous-requête de l'`UPDATE` retomberait dans le même piège, puisqu'elle serait
  elle aussi réévaluée ligne par ligne sur la table déjà entamée.

  À rang égal, l'identifiant tranche — c'est l'ordre de naissance (un `cuid` commence par son
  horodatage). Sur une séance déjà abîmée par la migration précédente, l'ordre voulu à l'origine
  n'est plus récupérable (la colonne `partie`, qui le portait, n'existe plus) : ce qui est garanti
  ici, c'est un ordre **unique, contigu et stable**, que l'équipe range ensuite d'un « monter » ou
  d'un « descendre ». Sur une base saine, la requête ne change rien : elle est rejouable sans
  risque, et le `WHERE` final lui évite même d'écrire.

  `updatedAt` n'est volontairement pas touché : réparer un rang n'est pas une modification du
  programme par quelqu'un, et le journal de la séance ne doit pas le raconter comme telle.
*/

CREATE TEMP TABLE "rangs_parties" AS
SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "sessionId" ORDER BY "ordre", "id") - 1 AS "rang"
FROM "SessionPartie";

UPDATE "SessionPartie"
SET "ordre" = (SELECT "rang" FROM "rangs_parties" WHERE "rangs_parties"."id" = "SessionPartie"."id")
WHERE "ordre" <> (SELECT "rang" FROM "rangs_parties" WHERE "rangs_parties"."id" = "SessionPartie"."id");

DROP TABLE "rangs_parties";
