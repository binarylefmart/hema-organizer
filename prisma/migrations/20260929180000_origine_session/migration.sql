-- Par où une session est entrée : "lien" (lien personnel) ou "mot-de-passe".
-- Colonne facultative, sans valeur par défaut : les sessions déjà ouvertes restent valables et
-- gardent NULL (origine inconnue). Elles ne seront donc comptées dans aucun plafond d'appareils —
-- c'est voulu : mieux vaut ne pas révoquer un lien que de mettre quelqu'un dehors sur une supposition.
-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN "origine" TEXT;
