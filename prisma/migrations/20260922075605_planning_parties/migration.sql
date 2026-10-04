-- CreateTable
CREATE TABLE "SessionPartie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "partie" TEXT NOT NULL,
    "instructeurId" TEXT,
    "theme" TEXT NOT NULL DEFAULT '',
    "atelierId" TEXT,
    "modifieParId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionPartie_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_instructeurId_fkey" FOREIGN KEY ("instructeurId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_atelierId_fkey" FOREIGN KEY ("atelierId") REFERENCES "Atelier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SessionPartie_modifieParId_fkey" FOREIGN KEY ("modifieParId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionPartie_atelierId_key" ON "SessionPartie"("atelierId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionPartie_sessionId_partie_key" ON "SessionPartie"("sessionId", "partie");
