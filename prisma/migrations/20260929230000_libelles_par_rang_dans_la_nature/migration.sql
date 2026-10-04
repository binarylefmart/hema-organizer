/*
  « Le libellé du modèle redit le rang que la partie occupe vraiment » (29/09/2026) — rattrapage de
  `20260929220000_libelles_cours_numerotes`.

  CE QUI S'EST PASSÉ. La migration de vocabulaire renommait **par valeur** : « 2nde partie » devient
  « Cours n°2 », point. Or la migration d'avant (`20260929210000_rangs_parties_contigus`) venait
  justement de **renuméroter les rangs**. Une séance qui n'avait que son ancien `MOITIE_2` — cas
  banal, l'ancien code créait la ligne à la demande et la supprimait quand on vidait la case — se
  retrouvait donc avec `ordre = 0`, donc premier cours de la soirée, et le libellé « Cours n°2 ».

  C'est exactement le mensonge que la nuit prétendait avoir tué, déplacé d'un cran : le libellé dit
  « Cours n°2 » pendant que le rang calculé dit 1, et l'étiquette courte écrit « 1ʳᵉ » juste à côté.
  Pire, `prochainLibellePartie` (src/lib/constants.ts) compte les parties de la nature et propose le
  suivant : sur cette séance, il proposerait « Cours n°2 » pour la deuxième partie — un doublon.
  Le même décalage existe côté options, hérité de `20260929200000` : une séance qui n'avait que son
  `OPTION_2` garde « 2e option » alors qu'elle est la première option de la séance.

  LE CORRECTIF : renommer **par rang dans la nature**, pas par valeur. Les deux séries se comptent
  séparément (`libellePartieModele`) — le troisième cours s'appelle « Cours n°3 » même s'il est la
  cinquième ligne de la séance —, d'où la partition par `estOption`.

  POURQUOI UNE TABLE TEMPORAIRE. Même raison qu'à la renumérotation, et c'est le piège qui a coûté la
  migration `200000` : **SQLite met à jour ligne par ligne**, et une sous-requête corrélée (fonction
  de fenêtrage comprise) relirait la table *déjà entamée* par le même `UPDATE`. On matérialise donc
  tous les rangs **avant** la première écriture ; `CREATE TABLE … AS SELECT` les fige, et l'ordre
  dans lequel SQLite parcourt ensuite les lignes n'a plus aucun effet. À rang égal — impossible
  depuis que `ordre` est unique par séance, mais la requête doit rester déterministe — l'identifiant
  tranche, c'est l'ordre de naissance (un `cuid` commence par son horodatage).

  LE GARDE-FOU EST CONSERVÉ : on ne réécrit **que** les libellés que le modèle sait produire, jamais
  ce qu'un club a tapé. Le test n'est pas un `LIKE` mais un aller-retour : on lit le nombre écrit
  dans le libellé et on vérifie que le libellé du modèle pour ce nombre **est** le libellé, au
  caractère près (« Cours n°2 bis », « Cours n°01 », « 1ère partie — échauffement », « 3e option de
  sabre » échouent tous à l'égalité, et « 1ère partie — échauffement » survit donc, comme avant).
  Le nombre lu ne sert qu'à reconnaître la forme : ce qui est écrit, c'est le rang réel.
  Un libellé identique au caractère près à une valeur du modèle est traité comme telle — rien ne les
  distingue en base, et c'est justement l'accord libellé ↔ rang qui est en jeu.

  Deux `UPDATE` plutôt qu'un : les deux natures n'écrivent pas la même chose (« Cours n°N » d'un
  côté, « 1ère option » / « Ne option » de l'autre, `libellePartieModele` recopiée telle quelle),
  et chacune a sa propre reconnaissance de forme.

  `updatedAt` n'est volontairement pas touché : réparer un libellé n'est pas une modification du
  programme par quelqu'un, et le journal de la séance ne doit pas le raconter comme telle — même
  règle que les deux migrations d'avant. Le `WHERE` compare au libellé voulu, donc la migration
  n'écrit sur aucune ligne déjà juste : rejouée, elle ne fait rien.
*/

CREATE TEMP TABLE "rangs_nature" AS
SELECT
    "id",
    "estOption",
    ROW_NUMBER() OVER (PARTITION BY "sessionId", "estOption" ORDER BY "ordre", "id") AS "rang"
FROM "SessionPartie";

-- Les parties du cours : « Cours n°<rang> ». `substr("libelle", 9)` saute les huit caractères de
-- « Cours n° » (le degré est un seul caractère, U+00B0, et `substr` compte des caractères).
UPDATE "SessionPartie"
SET "libelle" = 'Cours n°' || (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id")
WHERE "estOption" = false
  AND "libelle" <> 'Cours n°' || (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id")
  AND CAST(substr("libelle", 9) AS INTEGER) >= 1
  AND "libelle" = 'Cours n°' || CAST(substr("libelle", 9) AS INTEGER);

-- Les options : « 1ère option », puis « 2e option », « 3e option »… Le premier rang s'écrit à part,
-- et c'est pour ça que les libellés d'options ne sont pas de la forme « Option N ».
UPDATE "SessionPartie"
SET "libelle" = CASE
        WHEN (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id") = 1 THEN '1ère option'
        ELSE (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id") || 'e option'
    END
WHERE "estOption" = true
  AND "libelle" <> CASE
        WHEN (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id") = 1 THEN '1ère option'
        ELSE (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id") || 'e option'
    END
  AND ("libelle" = '1ère option'
       OR (CAST("libelle" AS INTEGER) >= 2 AND "libelle" = CAST("libelle" AS INTEGER) || 'e option'));

DROP TABLE "rangs_nature";
