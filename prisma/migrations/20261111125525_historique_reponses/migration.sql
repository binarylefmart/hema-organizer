-- CreateTable
CREATE TABLE "AttendanceChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auteurId" TEXT,
    "avant" TEXT,
    "apres" TEXT,
    "desistement" BOOLEAN NOT NULL DEFAULT false,
    "tardif" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceChange_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttendanceChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttendanceChange_auteurId_fkey" FOREIGN KEY ("auteurId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AttendanceChange_sessionId_createdAt_idx" ON "AttendanceChange"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AttendanceChange_userId_desistement_idx" ON "AttendanceChange"("userId", "desistement");
