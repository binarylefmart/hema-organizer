/*
  « Pas de titre pour les cours et les options, et une description facultative » (Delta, 30/09/2026 :
  « pour les cours et options ne met pas de titre, juste cour 1 2 3 4 en fonction de ce qui est ajouté
  idem pr les options, la description du cour se fait par les infos sur le theme instructeur etc,
  ajoute un champ "description" qui peu etre ajouté ou non pour un cour par un instructeur pour
  decrire l'atelier. »)

  DEUX CHOSES, ET RIEN D'AUTRE.

  1. LA COLONNE `description`. Texte libre, facultatif, **vide partout** au départ : c'est
     l'encadrement qui la remplira partie par partie. `NOT NULL DEFAULT ''`, le patron de `theme` —
     une valeur par défaut plutôt qu'une colonne nullable, pour qu'aucun lecteur n'ait à traduire un
     `null` en « rien à dire » (l'oubli se paierait par un intitulé fantôme sur une fiche).

  2. LES LIBELLÉS PASSENT À LA NOUVELLE FORME, **par rang dans la nature** : « Cours 1 », « Cours 2 »…
     et « Option 1 », « Option 2 »… (`libellePartie`, src/lib/constants.ts). Disparaissent « Cours n°1 »
     et le cas particulier de la première option (« 1ère option »), qui obligeait à écrire deux formes
     pour une seule série.

  POURQUOI SANS AUCUN GARDE-FOU DE FORME, cette fois. Les deux migrations de vocabulaire d'avant
  (`20260929220000`, `20260929230000`) ne réécrivaient que les libellés que le modèle savait produire,
  pour ne pas toucher à ce qu'un club aurait tapé à la main. Ça n'a plus de sens : **le libellé n'est
  plus une donnée saisie**, c'est une valeur calculée depuis le rang, et le champ texte a disparu de
  l'écran. Il n'y a donc rien à ménager — un libellé « maison » deviendrait de toute façon faux au
  premier ajout de partie, puisque le code le réécrit désormais à chaque écriture (`rangerParties`,
  src/lib/planning.ts). Et rien n'a jamais été publié : l'application n'est déployée nulle part, la
  seule base existante est celle de démonstration. Un sauvetage de l'ancien libellé vers `description`
  aurait été du code mort qui protège un cas qui n'existe pas, et il ferait croire au prochain lecteur
  qu'un libellé manuscrit peut encore arriver.

  POURQUOI UNE TABLE TEMPORAIRE MALGRÉ TOUT. C'est un piège de moteur, pas une précaution sur les
  données : **SQLite met à jour ligne par ligne**, et une sous-requête corrélée (fonction de fenêtrage
  comprise) relirait la table *déjà entamée* par le même `UPDATE`. On matérialise donc tous les rangs
  **avant** la première écriture ; `CREATE TABLE … AS SELECT` les fige, et l'ordre dans lequel SQLite
  parcourt ensuite les lignes n'a plus aucun effet. C'est la faute qui a coûté la migration
  `20260929200000`. À rang égal — impossible depuis que `ordre` est contigu par séance, mais la
  requête doit rester déterministe — l'identifiant tranche, c'est l'ordre de naissance (un `cuid`
  commence par son horodatage).

  Deux `UPDATE` plutôt qu'un : les deux natures se numérotent chacune dans sa propre série, et
  n'écrivent pas le même mot.

  `updatedAt` n'est volontairement pas touché : changer le vocabulaire de l'application n'est pas une
  modification du programme par quelqu'un, et la bulle « Modifié par … le … » de chaque case lit ce
  champ — même règle que les trois migrations d'avant. Le `WHERE` compare au libellé voulu, donc
  aucune ligne déjà juste n'est réécrite : rejouée, la migration ne fait rien.
*/

ALTER TABLE "SessionPartie" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';

CREATE TEMP TABLE "rangs_nature" AS
SELECT
    "id",
    "estOption",
    ROW_NUMBER() OVER (PARTITION BY "sessionId", "estOption" ORDER BY "ordre", "id") AS "rang"
FROM "SessionPartie";

-- Les parties du cours : « Cours <rang> ».
UPDATE "SessionPartie"
SET "libelle" = 'Cours ' || (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id")
WHERE "estOption" = false
  AND "libelle" <> 'Cours ' || (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id");

-- Les options : « Option <rang> ». Une seule forme, le premier rang compris — c'est ce que
-- « 1ère option » coûtait, et la raison pour laquelle il disparaît.
UPDATE "SessionPartie"
SET "libelle" = 'Option ' || (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id")
WHERE "estOption" = true
  AND "libelle" <> 'Option ' || (SELECT "rang" FROM "rangs_nature" WHERE "rangs_nature"."id" = "SessionPartie"."id");

DROP TABLE "rangs_nature";
