-- CreateTable
CREATE TABLE "Evenement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nom" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dateDebut" TEXT NOT NULL,
    "heureDebut" TEXT,
    "dateFin" TEXT,
    "heureFin" TEXT,
    "lieu" TEXT NOT NULL DEFAULT '',
    "adresse" TEXT NOT NULL DEFAULT '',
    "lienInscription" TEXT NOT NULL DEFAULT '',
    "lienSource" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "publie" BOOLEAN NOT NULL DEFAULT true,
    "creeParId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Evenement_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Evenement_dateDebut_idx" ON "Evenement"("dateDebut");

