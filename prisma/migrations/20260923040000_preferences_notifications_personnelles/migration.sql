-- AlterTable
-- Choix personnels de notifications, par type (JSON, nullable).
-- Ajout d'une seule colonne facultative : SQLite l'accepte en place, aucune table n'est recréée,
-- aucune ligne existante n'est réécrite, et `rappelEmail` n'est pas touché — la colonne reste NULL
-- pour tout le monde, ce qui veut dire « rien de choisi finement » (l'application retombe alors sur
-- `rappelEmail` pour les rappels, et sur les valeurs par défaut pour le reste).
ALTER TABLE "User" ADD COLUMN "preferencesNotifications" TEXT;
