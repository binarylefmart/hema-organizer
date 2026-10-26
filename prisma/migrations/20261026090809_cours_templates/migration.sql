-- CreateTable
CREATE TABLE "CoursTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nom" TEXT NOT NULL,
    "heureDebut" TEXT NOT NULL,
    "heureFin" TEXT NOT NULL,
    "lieu" TEXT NOT NULL,
    "adresse" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CoursTemplateElement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "bloc" INTEGER NOT NULL DEFAULT 1,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "nature" TEXT NOT NULL DEFAULT 'COURS',
    "theme" TEXT NOT NULL DEFAULT '',
    "niveau" TEXT NOT NULL DEFAULT 'INDIFFERENT',
    "description" TEXT NOT NULL DEFAULT '',
    "instructeurId" TEXT,
    "instructeurSecondId" TEXT,
    CONSTRAINT "CoursTemplateElement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CoursTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CoursTemplateElement_instructeurId_fkey" FOREIGN KEY ("instructeurId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CoursTemplateElement_instructeurSecondId_fkey" FOREIGN KEY ("instructeurSecondId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CoursTemplateElement_templateId_ordre_idx" ON "CoursTemplateElement"("templateId", "ordre");
