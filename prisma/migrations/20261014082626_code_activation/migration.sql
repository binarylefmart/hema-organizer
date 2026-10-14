-- AlterTable
ALTER TABLE "User" ADD COLUMN "codeActivationExpireLe" DATETIME;
ALTER TABLE "User" ADD COLUMN "codeActivationHash" TEXT;
