-- Tarif réduit pour les adhérents : une colonne texte de plus, à côté de `prix`.
--
-- Même forme que `prix`, mais la lecture du vide diffère et c'est délibéré : `prix` vide signifie
-- « gratuit » (l'écran l'écrit), `prixAdherent` vide signifie « pas de tarif adhérent pour cet
-- événement » (l'écran n'affiche rien). Voir PRIX_MAX dans src/lib/validation/evenements.ts.
--
-- Colonne à valeur par défaut : les annonces existantes restent valides sans reprise de données.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Evenement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nom" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dateDebut" TEXT NOT NULL,
    "heureDebut" TEXT,
    "dateFin" TEXT,
    "heureFin" TEXT,
    "lieu" TEXT NOT NULL DEFAULT '',
    "adresse" TEXT NOT NULL DEFAULT '',
    "organisateur" TEXT NOT NULL DEFAULT '',
    "prix" TEXT NOT NULL DEFAULT '',
    "prixAdherent" TEXT NOT NULL DEFAULT '',
    "dureeNombre" INTEGER,
    "dureeUnite" TEXT NOT NULL DEFAULT 'jour',
    "lienInscription" TEXT NOT NULL DEFAULT '',
    "lienSource" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "publie" BOOLEAN NOT NULL DEFAULT true,
    "publieAt" DATETIME,
    "creeParId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Evenement_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Evenement" ("adresse", "createdAt", "creeParId", "dateDebut", "dateFin", "description", "dureeNombre", "dureeUnite", "heureDebut", "heureFin", "id", "imageUrl", "lienInscription", "lienSource", "lieu", "nom", "organisateur", "prix", "publie", "publieAt", "updatedAt") SELECT "adresse", "createdAt", "creeParId", "dateDebut", "dateFin", "description", "dureeNombre", "dureeUnite", "heureDebut", "heureFin", "id", "imageUrl", "lienInscription", "lienSource", "lieu", "nom", "organisateur", "prix", "publie", "publieAt", "updatedAt" FROM "Evenement";
DROP TABLE "Evenement";
ALTER TABLE "new_Evenement" RENAME TO "Evenement";
CREATE INDEX "Evenement_dateDebut_idx" ON "Evenement"("dateDebut");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

