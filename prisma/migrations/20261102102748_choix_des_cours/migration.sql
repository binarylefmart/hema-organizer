-- CreateTable
CREATE TABLE "AttendanceChoix" (
    "userId" TEXT NOT NULL,
    "partieId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "partieId"),
    CONSTRAINT "AttendanceChoix_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttendanceChoix_partieId_fkey" FOREIGN KEY ("partieId") REFERENCES "SessionPartie" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AttendanceChoix_partieId_idx" ON "AttendanceChoix"("partieId");
