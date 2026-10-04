/*
  Warnings:

  - You are about to drop the column `objectifCours` on the `User` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBRE',
    "passwordHash" TEXT,
    "totpSecret" TEXT,
    "totpActiveAt" DATETIME,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("actif", "codesSecours", "couleur", "createdAt", "deuxFaProposeeLe", "doitChangerMotDePasse", "email", "evenementsVusAt", "id", "nom", "passwordHash", "preferencesNotifications", "prenom", "rappelEmail", "role", "service", "theme", "totpActiveAt", "totpSecret", "updatedAt") SELECT "actif", "codesSecours", "couleur", "createdAt", "deuxFaProposeeLe", "doitChangerMotDePasse", "email", "evenementsVusAt", "id", "nom", "passwordHash", "preferencesNotifications", "prenom", "rappelEmail", "role", "service", "theme", "totpActiveAt", "totpSecret", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
