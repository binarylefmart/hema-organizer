-- CreateTable
CREATE TABLE "PeriodDateExclue" (
    "periodId" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("periodId", "cle"),
    CONSTRAINT "PeriodDateExclue_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
