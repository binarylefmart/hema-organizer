import { Bloc, CarteSquelette, EcranSquelette, TableauSquelette } from "@/components/ui/Squelette";

/** Attente des sessions de connexion : le tableau à six colonnes, dans sa carte. */
export default function ChargementSessions() {
  return (
    <EcranSquelette libelle="Chargement des sessions de connexion">
      <div className="flex flex-col gap-2">
        <Bloc className="h-9 w-72 max-w-full" />
        <Bloc className="h-5 w-48" />
      </div>
      <CarteSquelette titre={false}>
        <TableauSquelette colonnes={6} lignes={8} />
      </CarteSquelette>
    </EcranSquelette>
  );
}
