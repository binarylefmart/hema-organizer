-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SessionPartie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "partie" TEXT NOT NULL,
    "instructeurId" TEXT,
    "theme" TEXT NOT NULL DEFAULT '',
    "niveau" TEXT NOT NULL DEFAULT 'INDIFFERENT',
    "atelierId" TEXT,
    "modifieParId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionPartie_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_instructeurId_fkey" FOREIGN KEY ("instructeurId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_atelierId_fkey" FOREIGN KEY ("atelierId") REFERENCES "Atelier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_modifieParId_fkey" FOREIGN KEY ("modifieParId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SessionPartie" ("atelierId", "id", "instructeurId", "modifieParId", "partie", "sessionId", "theme", "updatedAt") SELECT "atelierId", "id", "instructeurId", "modifieParId", "partie", "sessionId", "theme", "updatedAt" FROM "SessionPartie";
DROP TABLE "SessionPartie";
ALTER TABLE "new_SessionPartie" RENAME TO "SessionPartie";
CREATE UNIQUE INDEX "SessionPartie_atelierId_key" ON "SessionPartie"("atelierId");
CREATE UNIQUE INDEX "SessionPartie_sessionId_partie_key" ON "SessionPartie"("sessionId", "partie");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
