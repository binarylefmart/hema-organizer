import { Bloc, CarteSquelette, EcranSquelette, TableauSquelette } from "@/components/ui/Squelette";

/** Attente du journal d'audit : la barre de filtres, les raccourcis, puis le tableau. */
export default function ChargementAudit() {
  return (
    <EcranSquelette libelle="Chargement du journal d'audit">
      <div className="flex flex-col gap-2">
        <Bloc className="h-9 w-64 max-w-full" />
        <Bloc className="h-5 w-56" />
      </div>
      <CarteSquelette titre={false}>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <Bloc className="h-12 min-w-56 flex-1 rounded-xl" />
          <Bloc className="h-12 w-32 rounded-xl" />
          <Bloc className="h-12 w-32 rounded-xl" />
          <Bloc className="h-12 w-28 rounded-xl" />
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {["w-24", "w-32", "w-28", "w-24"].map((l, i) => (
            <Bloc key={i} className={`h-12 rounded-full ${l}`} />
          ))}
        </div>
        <TableauSquelette colonnes={6} lignes={10} />
      </CarteSquelette>
    </EcranSquelette>
  );
}
