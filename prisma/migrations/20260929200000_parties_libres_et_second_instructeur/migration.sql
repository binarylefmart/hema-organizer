/*
  « Parties libres par séance » (29/09/2026).

  Le nom de la partie était sa clé : quatre valeurs figées dans le code (MOITIE_1, MOITIE_2,
  OPTION_1, OPTION_2) et un index unique (sessionId, partie). Une séance ne pouvait donc avoir ni
  cinq parties, ni un intitulé à elle. Trois changements ici :

  1. `partie` (le code) devient `libelle` (texte libre) + `ordre` (le rang) + `estOption` (le
     drapeau) ; l'index unique (sessionId, partie) disparaît au profit d'un simple index de tri.
  2. `instructeurSecondId` : celui qui assiste, facultatif, un seul.
  3. **Aucune donnée n'est perdue, et aucune séance ne reste sans programme** : les cases
     existantes sont reprises telles quelles (le code devient son libellé français, l'ordre suit
     l'ordre historique, `estOption` se déduit du préfixe OPTION), puis toute séance qui n'avait
     aucune case reçoit les quatre parties du modèle. Sans ce second temps, une séance vide serait
     restée sans aucune ligne à remplir dans la nouvelle grille.
*/

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SessionPartie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "estOption" BOOLEAN NOT NULL DEFAULT false,
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

-- Reprise des cases existantes : le code devient le libellé que la grille affichait déjà, l'ordre
-- reprend l'ordre historique des quatre parties, et une partie inconnue (écrite par une autre
-- version) garde sa valeur telle quelle, rangée en queue.
INSERT INTO "new_SessionPartie" ("id", "sessionId", "libelle", "ordre", "estOption", "instructeurId", "instructeurSecondId", "theme", "niveau", "atelierId", "modifieParId", "updatedAt")
SELECT
    "id",
    "sessionId",
    CASE "partie"
        WHEN 'MOITIE_1' THEN '1ère partie'
        WHEN 'MOITIE_2' THEN '2nde partie'
        WHEN 'OPTION_1' THEN '1ère option'
        WHEN 'OPTION_2' THEN '2e option'
        ELSE "partie"
    END,
    CASE "partie"
        WHEN 'MOITIE_1' THEN 0
        WHEN 'MOITIE_2' THEN 1
        WHEN 'OPTION_1' THEN 2
        WHEN 'OPTION_2' THEN 3
        ELSE 4
    END,
    CASE WHEN "partie" LIKE 'OPTION%' THEN true ELSE false END,
    "instructeurId",
    NULL,
    "theme",
    "niveau",
    "atelierId",
    "modifieParId",
    "updatedAt"
FROM "SessionPartie";

DROP TABLE "SessionPartie";
ALTER TABLE "new_SessionPartie" RENAME TO "SessionPartie";
CREATE UNIQUE INDEX "SessionPartie_atelierId_key" ON "SessionPartie"("atelierId");
CREATE INDEX "SessionPartie_sessionId_ordre_idx" ON "SessionPartie"("sessionId", "ordre");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill : toute séance qui n'avait aucune case reçoit les quatre parties du modèle
-- (`PARTIES_MODELE`, src/lib/constants.ts), comme une séance créée à partir d'aujourd'hui.
-- L'identifiant est un aléa hexadécimal préfixé : les identifiants sont opaques, seul compte qu'ils
-- ne se rencontrent pas — SQLite ne sait pas fabriquer un cuid.
INSERT INTO "SessionPartie" ("id", "sessionId", "libelle", "ordre", "estOption", "theme", "niveau", "updatedAt")
SELECT
    'c' || lower(hex(randomblob(12))) || printf('%02d', m."ordre"),
    s."id",
    m."libelle",
    m."ordre",
    m."estOption",
    '',
    'INDIFFERENT',
    CURRENT_TIMESTAMP
FROM "Session" s
CROSS JOIN (
    SELECT '1ère partie' AS "libelle", 0 AS "ordre", false AS "estOption"
    UNION ALL SELECT '2nde partie', 1, false
    UNION ALL SELECT '1ère option', 2, true
    UNION ALL SELECT '2e option', 3, true
) m
WHERE NOT EXISTS (SELECT 1 FROM "SessionPartie" p WHERE p."sessionId" = s."id");

-- **L'ordre redevient contigu à partir de 0**, séance par séance. Une séance qui n'avait qu'une
-- 1ère partie et une option héritait des rangs 0 et 2 : le trou aurait survécu au premier
-- « descendre » et l'invariant tenu par le code (`renumeroter`) serait faux dès la reprise. À
-- rang égal — impossible ici, mais la requête doit rester déterministe — l'identifiant tranche.
UPDATE "SessionPartie" SET "ordre" = (
    SELECT COUNT(*) FROM "SessionPartie" p2
    WHERE p2."sessionId" = "SessionPartie"."sessionId"
      AND (p2."ordre" < "SessionPartie"."ordre" OR (p2."ordre" = "SessionPartie"."ordre" AND p2."id" < "SessionPartie"."id"))
);
