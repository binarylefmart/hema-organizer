-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBRE',
    "estAdmin" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "totpSecret" TEXT,
    "totpActiveAt" DATETIME,
    "totpDernierPas" INTEGER,
    "codesSecours" TEXT,
    "doitChangerMotDePasse" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "service" BOOLEAN NOT NULL DEFAULT false,
    "couleur" INTEGER,
    "rappelEmail" BOOLEAN NOT NULL DEFAULT true,
    "preferencesNotifications" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'parchemin',
    "deuxFaProposeeLe" DATETIME,
    "evenementsVusAt" DATETIME,
    "auClubDepuis" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("actif", "auClubDepuis", "codesSecours", "couleur", "createdAt", "deuxFaProposeeLe", "doitChangerMotDePasse", "email", "evenementsVusAt", "id", "nom", "passwordHash", "preferencesNotifications", "prenom", "rappelEmail", "role", "service", "theme", "totpActiveAt", "totpDernierPas", "totpSecret", "updatedAt") SELECT "actif", "auClubDepuis", "codesSecours", "couleur", "createdAt", "deuxFaProposeeLe", "doitChangerMotDePasse", "email", "evenementsVusAt", "id", "nom", "passwordHash", "preferencesNotifications", "prenom", "rappelEmail", "role", "service", "theme", "totpActiveAt", "totpDernierPas", "totpSecret", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- **Les administrateurs existants gardent tous leurs droits, et retrouvent un rôle de base.**
--
-- `role = 'ADMIN'` était exclusif : la personne n'avait pas de rôle de base, et le club ne pouvait
-- pas dire qu'un membre du bureau enseigne. On déplace donc l'information dans `estAdmin` et on
-- repose le rôle de base à **MEMBRE**, qui est la valeur neutre : aucun droit n'est perdu (un
-- administrateur a tous ceux de la matrice), et le bureau peut maintenant marquer INSTRUCTEUR ceux
-- qui animent — c'est précisément ce que ce changement rend possible.
--
-- Pourquoi MEMBRE et non INSTRUCTEUR : la base ne sait pas qui enseigne. Poser INSTRUCTEUR à tout le
-- bureau ferait apparaître des noms dans les listes d'instructeurs du planning, où ils n'étaient pas
-- (ces listes ne retenaient déjà que `role = 'INSTRUCTEUR'`, jamais les administrateurs).
UPDATE "User" SET "estAdmin" = true, "role" = 'MEMBRE' WHERE "role" = 'ADMIN';
