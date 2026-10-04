import { CarteSquelette, EcranSquelette, EnTeteSquelette } from "@/components/ui/Squelette";

/** Attente du formulaire de nouvelle séance (sinon cet écran hériterait du squelette de la liste). */
export default function ChargementNouvelleSeance() {
  return (
    <EcranSquelette libelle="Chargement du formulaire">
      <EnTeteSquelette largeurTitre="w-56" />
      <CarteSquelette titre={false} lignes={7} />
    </EcranSquelette>
  );
}
