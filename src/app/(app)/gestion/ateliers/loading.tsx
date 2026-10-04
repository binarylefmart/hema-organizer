import { Bloc, CarteSquelette, EcranSquelette, EnTeteSquelette } from "@/components/ui/Squelette";

/** Attente des ateliers : les puces de filtre, une carte par proposition, puis les thèmes du planning. */
export default function ChargementAteliersGestion() {
  return (
    <EcranSquelette libelle="Chargement des ateliers">
      <EnTeteSquelette largeurTitre="w-36" />
      <div className="flex flex-wrap gap-2">
        {["w-32", "w-28", "w-24", "w-28"].map((l, i) => (
          <Bloc key={i} className={`h-12 rounded-full ${l}`} />
        ))}
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <CarteSquelette key={i} titre={false}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-2">
              <Bloc className="h-6 w-56 max-w-full" />
              <Bloc className="h-4 w-64 max-w-full" />
            </div>
            <Bloc className="h-6 w-24 rounded-md" />
          </div>
          <Bloc className="mt-3 h-4 w-full" />
          <Bloc className="mt-2 h-4 w-5/6" />
        </CarteSquelette>
      ))}
      <CarteSquelette lignes={4} />
    </EcranSquelette>
  );
}
