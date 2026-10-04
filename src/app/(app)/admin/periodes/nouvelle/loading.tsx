import { CarteSquelette, EcranSquelette, EnTeteSquelette } from "@/components/ui/Squelette";

/** Attente du formulaire de nouvelle période (sinon cet écran hériterait du squelette du tableau). */
export default function ChargementNouvellePeriode() {
  return (
    <EcranSquelette libelle="Chargement du formulaire">
      <EnTeteSquelette largeurTitre="w-56" />
      <CarteSquelette titre={false} lignes={7} />
    </EcranSquelette>
  );
}
