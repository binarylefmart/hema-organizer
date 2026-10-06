/*
  « Qui anime ? » et « Second animateur » sur une proposition d'atelier (Delta, 06/10/2026 au soir :
  « ajoute la possibilité d'avoir un second instructeur, et liste tous les users du club pour
  l'instructeur et le second, vu que c'est par les membres et instructeurs »).

  CE QUI CHANGE. `Atelier` gagne deux colonnes facultatives, chacune vers `User`, `ON DELETE SET NULL` :
  - `animateurId` : qui anime — n'importe quel compte actif du club, la personne qui propose par défaut ;
  - `animateurSecondId` : le second animateur, facultatif.
  Le planning les prend pour instructeur et second instructeur de la case où l'atelier est placé.

  LA REPRISE DES LIGNES EXISTANTES. Jusqu'ici, l'animateur d'un atelier *était* la personne qui
  l'avait proposé (le planning écrivait `instructeurId = proposeParId`) : on recopie donc
  `proposeParId` dans `animateurId`, et le second reste vide. Un atelier existant se lit exactement
  comme avant.

  `updatedAt` n'est volontairement pas touché : la ligne est recopiée telle quelle.

  Les clés étrangères imposent la reconstruction de table que Prisma écrit pour SQLite (pas
  d'`ALTER TABLE … ADD CONSTRAINT` en SQLite).
*/

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Atelier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposeParId" TEXT NOT NULL,
    "animateurId" TEXT,
    "animateurSecondId" TEXT,
    "sessionId" TEXT,
    "titre" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dureeMinutes" INTEGER,
    "materiel" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'PROPOSE',
    "commentaireInstructeur" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Atelier_proposeParId_fkey" FOREIGN KEY ("proposeParId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Atelier_animateurId_fkey" FOREIGN KEY ("animateurId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Atelier_animateurSecondId_fkey" FOREIGN KEY ("animateurSecondId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Atelier_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- L'animateur d'un atelier existant est la personne qui l'a proposé ; pas de second.
INSERT INTO "new_Atelier" ("commentaireInstructeur", "createdAt", "description", "dureeMinutes", "id", "materiel", "proposeParId", "animateurId", "animateurSecondId", "sessionId", "statut", "titre", "updatedAt")
SELECT "commentaireInstructeur", "createdAt", "description", "dureeMinutes", "id", "materiel", "proposeParId", "proposeParId", NULL, "sessionId", "statut", "titre", "updatedAt" FROM "Atelier";
DROP TABLE "Atelier";
ALTER TABLE "new_Atelier" RENAME TO "Atelier";
CREATE INDEX "Atelier_statut_idx" ON "Atelier"("statut");
CREATE INDEX "Atelier_sessionId_idx" ON "Atelier"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
