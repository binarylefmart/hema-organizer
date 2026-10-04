import { CarteSquelette, EcranSquelette, EnTeteSquelette, SelecteurHorizonSquelette, SelecteurPeriodeSquelette, TableauSquelette } from "@/components/ui/Squelette";

/** Attente du planning : même bascule que la page (grille large sur PC, fiches empilées en dessous de 1024 px). */
export default function ChargementPlanning() {
  return (
    <EcranSquelette libelle="Chargement du planning">
      <EnTeteSquelette largeurTitre="w-64" />
      <SelecteurPeriodeSquelette />
      <SelecteurHorizonSquelette />
      <div className="hidden lg:block">
        <TableauSquelette colonnes={5} lignes={8} />
      </div>
      <div className="flex flex-col gap-3 lg:hidden">
        {Array.from({ length: 3 }, (_, i) => (
          <CarteSquelette key={i} lignes={4} />
        ))}
      </div>
    </EcranSquelette>
  );
}
