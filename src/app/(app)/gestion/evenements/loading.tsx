import { EcranSquelette, EnTeteSquelette, Bloc, TableauSquelette } from "@/components/ui/Squelette";

/** Attente de la liste de gestion des événements : le titre, la bascule, puis le tableau. */
export default function ChargementGestionEvenements() {
  return (
    <EcranSquelette libelle="Chargement des événements">
      <EnTeteSquelette largeurTitre="w-48" actions={1} />
      <Bloc className="h-12 w-56 rounded-full" />
      <TableauSquelette colonnes={4} lignes={6} />
    </EcranSquelette>
  );
}
