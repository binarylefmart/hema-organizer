/*
  « Parties et éléments » (Delta, 06/10/2026 : « pour la gestion planning, fais une gestion par
  partie, partie 1, 2, 3. Et dans chaque partie ajouter (via un menu déroulant) un échauffement, un
  cours, une option (et/ou atelier si proposé). Possible d'avoir plusieurs cours, options,
  échauffements, ateliers par partie. »)

  CE QUI CHANGE DANS LA TABLE. Chaque ligne `SessionPartie` devient un **élément** rangé dans une
  **partie** :
  - `bloc` (INTEGER, défaut 1) : le numéro de la partie, contigu à partir de 1 ;
  - `nature` (TEXT, défaut 'COURS') : ECHAUFFEMENT | COURS | OPTION | ATELIER ;
  - `estOption` disparaît : `nature` dit la même chose, et davantage.

  LA REPRISE DES LIGNES EXISTANTES (revue par Delta le 06/10 au soir : « par défaut une seule partie par
  séance, qui n'est pas notifiée partie 1, uniquement à partir de 2 »). **Tout va dans la partie 1** :
  - les cours restent des éléments COURS, les options des éléments OPTION, et une option qui porte un
    atelier devient un élément ATELIER ;
  - aucune ligne n'est ajoutée — ni partie, ni cours vide : une séance d'une seule partie est le cas
    ordinaire, et c'est l'encadrement qui ouvre une deuxième partie quand il en a besoin.
  Conséquence voulue : une séance existante se lit **exactement comme avant** — « Cours 1, Cours 2,
  Option 1 » —, puisque le préfixe « Partie 1 · » ne s'écrit qu'à partir de deux parties.

  ORDRE ET LIBELLÉ RECALCULÉS — la règle de `src/components/planning/rangement.ts`, recopiée en
  fenêtres SQLite : `ordre` = rang de lecture (bloc, nature dans l'ordre ECHAUFFEMENT, COURS, OPTION,
  ATELIER, ordre d'avant, id) à partir de 0 ; `libelle` = « Partie <bloc> · <Nature> », suivi du rang
  dans la nature **et la partie** seulement quand la partie en porte plusieurs (« Partie 2 · Option
  2 ») ; le préfixe « Partie <bloc> · » n'est écrit que si la séance compte **plusieurs parties**
  (`partiesNommees`) — après cette migration, aucune séance n'en a plus d'une. Le test `tests/unit/migration-parties-elements.test.ts` compare le résultat à
  `rangementsParties` lui-même, pour que le SQL et le code ne puissent pas diverger.

  LE PIÈGE DE MOTEUR, toujours le même : **SQLite met à jour ligne par ligne**, et une sous-requête
  corrélée (fenêtrage compris) relirait la table déjà entamée par le même `UPDATE`. Tous les rangs
  sont donc figés dans des tables temporaires (`CREATE TABLE … AS SELECT`) **avant** la première
  écriture.

  `updatedAt` des lignes existantes n'est volontairement pas touché : changer la forme du planning
  n'est pas une modification du programme par quelqu'un, et la bulle « Modifié par … le … » de chaque
  case lit ce champ — même règle que toutes les migrations de rangs d'avant.

  LA COLONNE `estOption` part par la reconstruction de table que Prisma écrit pour SQLite (il n'y a
  pas de `DROP COLUMN` sûr avec les index et clés étrangères de la table) ; la photo des natures et
  des parties est prise juste avant, depuis l'ancienne table.
*/

-- 1. La nature de chaque ligne existante, lue sur l'ancienne table intacte ; tout va en partie 1.
CREATE TEMP TABLE "elements_repris" AS
SELECT
    "id",
    CASE
        WHEN "estOption" = 0 THEN 'COURS'
        WHEN "atelierId" IS NOT NULL THEN 'ATELIER'
        ELSE 'OPTION'
    END AS "nature",
    1 AS "bloc"
FROM "SessionPartie";

-- 2. La table sans `estOption`, avec `bloc` et `nature` (reconstruction à la façon de Prisma).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SessionPartie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "bloc" INTEGER NOT NULL DEFAULT 1,
    "nature" TEXT NOT NULL DEFAULT 'COURS',
    "instructeurId" TEXT,
    "instructeurSecondId" TEXT,
    "theme" TEXT NOT NULL DEFAULT '',
    "niveau" TEXT NOT NULL DEFAULT 'INDIFFERENT',
    "atelierId" TEXT,
    "modifieParId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionPartie_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_instructeurId_fkey" FOREIGN KEY ("instructeurId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_instructeurSecondId_fkey" FOREIGN KEY ("instructeurSecondId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_atelierId_fkey" FOREIGN KEY ("atelierId") REFERENCES "Atelier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_modifieParId_fkey" FOREIGN KEY ("modifieParId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SessionPartie" ("id", "sessionId", "libelle", "description", "ordre", "bloc", "nature", "instructeurId", "instructeurSecondId", "theme", "niveau", "atelierId", "modifieParId", "updatedAt")
SELECT p."id", p."sessionId", p."libelle", p."description", p."ordre", e."bloc", e."nature", p."instructeurId", p."instructeurSecondId", p."theme", p."niveau", p."atelierId", p."modifieParId", p."updatedAt"
FROM "SessionPartie" p
JOIN "elements_repris" e ON e."id" = p."id";
DROP TABLE "SessionPartie";
ALTER TABLE "new_SessionPartie" RENAME TO "SessionPartie";
CREATE UNIQUE INDEX "SessionPartie_atelierId_key" ON "SessionPartie"("atelierId");
CREATE INDEX "SessionPartie_sessionId_ordre_idx" ON "SessionPartie"("sessionId", "ordre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

DROP TABLE "elements_repris";

-- 3. `ordre` et `libelle` selon la règle de `rangementsParties`, figés avant toute écriture.
CREATE TEMP TABLE "rangs_elements" AS
SELECT
    "id",
    "bloc",
    "nature",
    ROW_NUMBER() OVER (
        PARTITION BY "sessionId"
        ORDER BY "bloc",
                 CASE "nature" WHEN 'ECHAUFFEMENT' THEN 0 WHEN 'COURS' THEN 1 WHEN 'OPTION' THEN 2 ELSE 3 END,
                 "ordre",
                 "id"
    ) - 1 AS "ordre",
    ROW_NUMBER() OVER (PARTITION BY "sessionId", "bloc", "nature" ORDER BY "ordre", "id") AS "rang",
    COUNT(*) OVER (PARTITION BY "sessionId", "bloc", "nature") AS "nombre",
    MAX("bloc") OVER (PARTITION BY "sessionId") AS "nbParties"
FROM "SessionPartie";

CREATE TEMP TABLE "places_elements" AS
SELECT
    "id",
    "ordre",
    CASE WHEN "nbParties" > 1 THEN 'Partie ' || "bloc" || ' · ' ELSE '' END
        || CASE "nature" WHEN 'ECHAUFFEMENT' THEN 'Échauffement' WHEN 'COURS' THEN 'Cours' WHEN 'OPTION' THEN 'Option' ELSE 'Atelier' END
        || CASE WHEN "nombre" > 1 THEN ' ' || "rang" ELSE '' END AS "libelle"
FROM "rangs_elements";

UPDATE "SessionPartie"
SET "ordre" = (SELECT "ordre" FROM "places_elements" WHERE "places_elements"."id" = "SessionPartie"."id"),
    "libelle" = (SELECT "libelle" FROM "places_elements" WHERE "places_elements"."id" = "SessionPartie"."id")
WHERE EXISTS (
    SELECT 1 FROM "places_elements"
    WHERE "places_elements"."id" = "SessionPartie"."id"
      AND ("places_elements"."ordre" <> "SessionPartie"."ordre" OR "places_elements"."libelle" <> "SessionPartie"."libelle")
);

DROP TABLE "places_elements";
DROP TABLE "rangs_elements";
