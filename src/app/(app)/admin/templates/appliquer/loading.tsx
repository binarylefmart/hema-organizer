import { CarteSquelette, EcranSquelette, EnTeteSquelette } from "@/components/ui/Squelette";

/** Attente de « Appliquer un template » : l'en-tête, puis ses trois cartes (choix, dates, aperçu). */
export default function ChargementAppliquerTemplate() {
  return (
    <EcranSquelette libelle="Chargement des templates et des périodes">
      <EnTeteSquelette largeurTitre="w-64" />
      <CarteSquelette lignes={4} />
      <CarteSquelette lignes={5} />
    </EcranSquelette>
  );
}
