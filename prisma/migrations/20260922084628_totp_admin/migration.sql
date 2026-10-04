-- AlterTable
ALTER TABLE "User" ADD COLUMN "totpActiveAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
