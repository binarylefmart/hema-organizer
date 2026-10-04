import { Bloc, CarteSquelette, EcranSquelette, EnTeteSquelette, SelecteurHorizonSquelette, SelecteurPeriodeSquelette } from "@/components/ui/Squelette";

/** Attente de l'onglet Séances : une carte par séance — date, programme, réponse et jauge. */
export default function ChargementSeances() {
  return (
    <EcranSquelette libelle="Chargement des séances">
      <EnTeteSquelette largeurTitre="w-40" actions={1} />
      <SelecteurPeriodeSquelette />
      <SelecteurHorizonSquelette />
      {Array.from({ length: 3 }, (_, i) => (
        <CarteSquelette key={i} titre={false}>
          <Bloc className="h-6 w-56" />
          <Bloc className="mt-2 h-4 w-44" />
          <Bloc className="mt-4 h-12 w-full rounded-xl" />
          <Bloc className="mt-3 h-8 w-40" />
          <Bloc className="mt-2 h-3 w-full rounded-full" />
        </CarteSquelette>
      ))}
    </EcranSquelette>
  );
}
