import { CarteSquelette, EcranSquelette, EnTeteSquelette } from "@/components/ui/Squelette";

/** Attente des notifications (sinon cet écran hériterait du squelette de l'espace admin). */
export default function ChargementNotifications() {
  return (
    <EcranSquelette libelle="Chargement des notifications">
      <EnTeteSquelette largeurTitre="w-48" />
      <CarteSquelette lignes={3} />
      <CarteSquelette lignes={6} />
    </EcranSquelette>
  );
}
