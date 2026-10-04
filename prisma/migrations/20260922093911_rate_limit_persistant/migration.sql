-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "hits" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
