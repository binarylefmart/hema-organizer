import { Bloc, CarteSquelette, EcranSquelette } from "@/components/ui/Squelette";

/** Attente d'une séance : fil d'Ariane, date en titre, puis les deux colonnes de cartes. */
export default function ChargementSeance() {
  return (
    <EcranSquelette libelle="Chargement de la séance">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Bloc className="h-4 w-48" />
          <Bloc className="h-9 w-72 max-w-full" />
          <Bloc className="h-5 w-56" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Bloc className="h-12 w-32 rounded-xl" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <CarteSquelette lignes={5} />
        <CarteSquelette lignes={6} />
        <CarteSquelette lignes={3} />
        <CarteSquelette lignes={2} />
      </div>
      <CarteSquelette lignes={5} />
    </EcranSquelette>
  );
}
