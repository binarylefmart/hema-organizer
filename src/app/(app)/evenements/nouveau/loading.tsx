import { Bloc, CarteSquelette, EcranSquelette } from "@/components/ui/Squelette";
import { PLEINE_LARGEUR_2XL } from "@/components/ui/pleine-largeur";

/**
 * Attente du formulaire d'annonce : le titre, puis la carte de saisie et sa grille.
 *
 * **Pourquoi cet écran existe** : sans lui, `/evenements/nouveau` héritait du squelette du **fil**
 * — trois cartes d'annonce pour un formulaire, et surtout, depuis que le fil s'élargit dès 1 024 px
 * alors que le formulaire attend 1 536, une silhouette de 1 232 px suivie d'un formulaire de 736.
 * Le squelette doit annoncer la page qui vient, largeur comprise.
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

/**
 * Un groupe de champs qui se range en deux colonnes **dès que sa cellule** a 28 rem — et c'est bien
 * la cellule qu'on mesure, pas le formulaire : d'où le `@container` ici, et pas plus haut.
 */
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

export default function ChargementNouvelEvenement() {
  return (
    <div className={PLEINE_LARGEUR_2XL}>
      <EcranSquelette libelle="Chargement du formulaire">
        <Bloc className="h-9 w-64 max-w-full" />
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
