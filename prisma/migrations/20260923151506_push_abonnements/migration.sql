-- CreateTable
CREATE TABLE "PushAbonnement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "appareil" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "derniereFois" DATETIME,
    CONSTRAINT "PushAbonnement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PushAbonnement_endpoint_key" ON "PushAbonnement"("endpoint");

-- CreateIndex
CREATE INDEX "PushAbonnement_userId_idx" ON "PushAbonnement"("userId");
