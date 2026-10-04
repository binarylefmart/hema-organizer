import { CarteSquelette, EcranSquelette, EnTeteSquelette, TableauSquelette } from "@/components/ui/Squelette";

/**
 * Attente de la liste des périodes : le tableau à six colonnes, dans sa carte.
 *
 * **Le palier suit celui du tableau** (`lg`, comme la page) : figée sur le défaut `md`, la silhouette
 * dessinait un tableau entre 768 et 1 023 px là où la page rend des fiches, et tout l'écran se
 * réorganisait à l'arrivée des données.
 */
export default function ChargementPeriodes() {
  return (
    <EcranSquelette libelle="Chargement des périodes">
      <EnTeteSquelette largeurTitre="w-44" actions={1} />
      <CarteSquelette titre={false}>
        <TableauSquelette colonnes={6} lignes={6} palier="lg" />
      </CarteSquelette>
    </EcranSquelette>
  );
}
