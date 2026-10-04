import { Bloc, CarteSquelette, EcranSquelette, EnTeteSquelette, ListeSquelette } from "@/components/ui/Squelette";

/** Attente de la liste des membres : la barre de recherche, puis une ligne par personne. */
export default function ChargementMembres() {
  return (
    <EcranSquelette libelle="Chargement des membres">
      <EnTeteSquelette largeurTitre="w-40" actions={1} />
      <CarteSquelette titre={false}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Bloc className="h-4 w-28" />
            <Bloc className="h-13 w-full rounded-xl" />
          </div>
          <Bloc className="h-13 w-28 rounded-xl" />
        </div>
        <div className="mt-4">
          <ListeSquelette lignes={8} avatar />
        </div>
      </CarteSquelette>
      <div className="grid gap-5 lg:grid-cols-2">
        <CarteSquelette lignes={6} />
        <CarteSquelette lignes={4} />
      </div>
    </EcranSquelette>
  );
}
