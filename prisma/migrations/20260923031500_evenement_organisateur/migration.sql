-- AlterTable
-- Ajout d'une seule colonne : SQLite l'accepte en place (NOT NULL avec valeur par défaut),
-- aucune table n'est recréée et aucune ligne existante n'est réécrite.
ALTER TABLE "Evenement" ADD COLUMN "organisateur" TEXT NOT NULL DEFAULT '';
