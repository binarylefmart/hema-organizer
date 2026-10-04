import { Bloc, CarteSquelette, EcranSquelette, TableauSquelette } from "@/components/ui/Squelette";
import { DeuxPiles } from "@/components/ui/DeuxPiles";

/**
 * Attente d'une période : fil d'Ariane, nom en titre, puis la silhouette des deux piles.
 *
 * **La silhouette suit la coupure de la page** : à gauche le trimestre — informations et
 * instructeurs côte à côte dès que la pile a 56 rem, créneaux, séances —, à droite les membres
 * invités. Un squelette qui dessinerait encore une seule colonne ferait sauter tout l'écran au
 * moment où la vraie page arrive, et c'est le seul défaut qu'on puisse reprocher à un squelette.
 *
 * `@container` sur chaque pile, comme dans la page : c'est la pile (~710 px) que les paliers
 * intérieurs doivent mesurer, pas la fenêtre ni la page élargie.
 */
export default function ChargementPeriode() {
  return (
    <EcranSquelette libelle="Chargement de la période">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Bloc className="h-4 w-40" />
          <Bloc className="h-9 w-64 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Bloc className="h-12 w-40 rounded-xl" />
          <Bloc className="h-12 w-40 rounded-xl" />
        </div>
      </div>
      <DeuxPiles
        gauche={
          <div className="@container flex min-w-0 flex-col gap-5">
            <div className="grid gap-5 @4xl:grid-cols-2">
              <CarteSquelette lignes={6} />
              <CarteSquelette lignes={4} />
            </div>
            <CarteSquelette lignes={5} />
            <CarteSquelette titre>
              <TableauSquelette colonnes={4} lignes={5} />
            </CarteSquelette>
          </div>
        }
        droite={
          <div className="@container flex min-w-0 flex-col gap-5">
            <CarteSquelette lignes={12} />
          </div>
        }
      />
    </EcranSquelette>
  );
}
