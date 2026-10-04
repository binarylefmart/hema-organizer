import { Bloc, CarteSquelette, EcranSquelette } from "@/components/ui/Squelette";

/** Attente d'une fiche membre : fil d'Ariane, nom en titre, puis identité, périodes et compte. */
export default function ChargementMembre() {
  return (
    <EcranSquelette libelle="Chargement de la fiche">
      <div className="flex flex-col gap-2">
        <Bloc className="h-4 w-44" />
        <Bloc className="h-9 w-72 max-w-full" />
        <Bloc className="h-5 w-64 max-w-full" />
      </div>
      <div className="@container grid gap-5 @4xl:grid-cols-2">
        <CarteSquelette lignes={6} />
        <CarteSquelette lignes={4} />
      </div>
      <CarteSquelette lignes={3} />
    </EcranSquelette>
  );
}
