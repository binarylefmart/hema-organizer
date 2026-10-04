-- AlterTable
-- Pastille « du nouveau » : dernière ouverture du panneau des événements, par personne.
-- Colonne nullable ajoutée en place, aucune ligne existante n'est réécrite.
ALTER TABLE "User" ADD COLUMN "evenementsVusAt" DATETIME;

-- AlterTable
-- Publication effective d'une annonce (brouillon -> publié, ou création déjà publiée) :
-- `updatedAt` bougeait à la moindre correction et ne pouvait pas dire « c'est nouveau ».
-- Les annonces antérieures gardent NULL : la lecture retombe alors sur `createdAt`.
ALTER TABLE "Evenement" ADD COLUMN "publieAt" DATETIME;
