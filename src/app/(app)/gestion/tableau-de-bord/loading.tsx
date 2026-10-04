import { Bloc, CarteSquelette, EcranSquelette, EnTeteSquelette, SelecteurHorizonSquelette, SelecteurPeriodeSquelette, TableauSquelette } from "@/components/ui/Squelette";

/** Attente du tableau de bord : le taux par séance (une barre par ligne), puis le taux par membre. */
export default function ChargementTableauDeBord() {
  return (
    <EcranSquelette libelle="Chargement du tableau de bord">
      <EnTeteSquelette largeurTitre="w-56" actions={1} />
      <SelecteurPeriodeSquelette />
      <SelecteurHorizonSquelette />
      <CarteSquelette titre>
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2">
              <Bloc className="h-4 w-24" />
              <Bloc className="h-3 w-full rounded-full" />
              <Bloc className="h-4 w-12" />
            </div>
          ))}
        </div>
      </CarteSquelette>
      <CarteSquelette titre>
        <TableauSquelette colonnes={6} lignes={7} />
      </CarteSquelette>
    </EcranSquelette>
  );
}
