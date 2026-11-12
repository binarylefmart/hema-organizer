-- Désistement de dernière minute : seconde fenêtre, plus courte, qui prend le pas sur le désistement.
-- Les lignes antérieures restent à false (rien avant cette version).
ALTER TABLE "AttendanceChange" ADD COLUMN "derniereMinute" BOOLEAN NOT NULL DEFAULT false;
