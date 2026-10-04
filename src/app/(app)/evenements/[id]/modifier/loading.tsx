import { Bloc, CarteSquelette, EcranSquelette } from "@/components/ui/Squelette";
import { PLEINE_LARGEUR_2XL } from "@/components/ui/pleine-largeur";

/**
 * Attente du formulaire de correction : le titre, puis la carte de saisie et sa grille.
 *
 * Même silhouette que `/evenements/nouveau` — c'est le même formulaire — et elle existe pour la
 * même raison : sans elle, cette route héritait du squelette de la **fiche**, affiche et lignes de
 * faits comprises, pour une page qui n'est qu'un formulaire. La largeur, elle, était déjà la
 * bonne ; c'est la forme qui mentait.
 */

/** Un champ : son libellé, son contrôle, sa ligne d'aide. */
function ChampSquelette({ className = "" }: { className?: string }) {
  return (
    <span className={`flex flex-col gap-1.5 ${className}`}>
      <Bloc className="h-5 w-40 max-w-full" />
      <Bloc className="h-13 w-full rounded-xl" />
      <Bloc className="h-4 w-56 max-w-full" />
    </span>
  );
}

/** Un groupe qui se range en deux colonnes dès que **sa cellule** a 28 rem — d'où le `@container` ici. */
function GroupeSquelette({ champs = 2 }: { champs?: number }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
        {Array.from({ length: champs }, (_, i) => (
          <ChampSquelette key={i} />
        ))}
      </div>
    </div>
  );
}

export default function ChargementModifierEvenement() {
  return (
    <div className={PLEINE_LARGEUR_2XL}>
      <EcranSquelette libelle="Chargement du formulaire">
        <Bloc className="h-9 w-72 max-w-full" />
        <CarteSquelette titre={false} className="@container">
          <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @3xl:gap-x-6">
            {/* Le lien d'origine et son bouton « Récupérer les infos » */}
            <div className="flex flex-col gap-2">
              <ChampSquelette />
              <Bloc className="h-11 w-64 max-w-full rounded-xl" />
            </div>
            <ChampSquelette />
            <GroupeSquelette champs={4} />
            <GroupeSquelette />
            <GroupeSquelette />
            <ChampSquelette />
            <ChampSquelette />
            {/* La zone de dépôt de l'affiche : haute, elle remplit la ligne du lien d'inscription */}
            <Bloc className="h-80 w-full rounded-2xl" />
            {/* Les deux seuls blocs qui prennent la ligne entière : le texte courant et le dernier geste */}
            <ChampSquelette className="@3xl:col-span-2" />
            <Bloc className="h-12 w-full max-w-prose rounded-md @3xl:col-span-2" />
          </div>
          <Bloc className="mt-5 h-13 w-48 rounded-xl" />
        </CarteSquelette>
      </EcranSquelette>
    </div>
  );
}
