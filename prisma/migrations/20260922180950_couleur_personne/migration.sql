-- AlterTable
ALTER TABLE "User" ADD COLUMN "couleur" INTEGER;

-- Comptes déjà présents : un numéro de couleur distinct par personne, dans l'ordre de création
-- (24 = taille de la palette, voir NOMBRE_COULEURS dans src/lib/couleurs.ts).
UPDATE "User" SET "couleur" = (
  SELECT COUNT(*) FROM "User" AS u2
  WHERE u2."service" = 0
    AND (u2."createdAt" < "User"."createdAt" OR (u2."createdAt" = "User"."createdAt" AND u2."id" < "User"."id"))
) % 24
WHERE "service" = 0;
