import { Bloc, CarteSquelette, EcranSquelette, EnTeteSquelette } from "@/components/ui/Squelette";

/** Attente de « Proposer un atelier » : le formulaire, puis la liste de ses propres propositions. */
export default function ChargementAteliers() {
  return (
    <EcranSquelette libelle="Chargement des ateliers">
      <EnTeteSquelette largeurTitre="w-64" />
      <CarteSquelette lignes={6} />
      <Bloc className="mt-2 h-7 w-48" />
      <CarteSquelette titre={false} lignes={4} />
    </EcranSquelette>
  );
}
