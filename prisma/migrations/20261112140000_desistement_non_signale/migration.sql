-- Désistement non signalé : une personne restée « Présent » qui n'est pas venue, notée par le bureau.
CREATE TABLE "DesistementNonSignale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auteurId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DesistementNonSignale_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesistementNonSignale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesistementNonSignale_auteurId_fkey" FOREIGN KEY ("auteurId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DesistementNonSignale_sessionId_userId_key" ON "DesistementNonSignale"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "DesistementNonSignale_userId_idx" ON "DesistementNonSignale"("userId");
