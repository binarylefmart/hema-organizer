import { Bloc, EcranSquelette, EnTeteSquelette } from "@/components/ui/Squelette";
import { PLEINE_LARGEUR } from "@/components/ui/pleine-largeur";

/**
 * Attente du fil d'événements : le titre, la bascule « À venir / Passé », puis trois cartes.
 *
 * La carte reprend le gabarit réel — bandeau d'affiche à fleur de bord, puis le bloc de texte avec
 * sa marge — pour que rien ne se déplace quand les annonces se posent. C'est pour ce bandeau
 * pleine largeur qu'elle n'emprunte pas `CarteSquelette`, dont la marge fait le tour du contenu.
 *
 * **Et la silhouette a la largeur de la page qu'elle annonce** : même `PLEINE_LARGEUR` et même
 * grille à deux colonnes que le fil, sans quoi les cartes sauteraient de 736 à 712 px à l'arrivée
 * des annonces — un squelette qui mentait sur la mise en page qu'il prépare.
 */
function CarteEvenementSquelette() {
  return (
    <section className="overflow-hidden rounded-2xl border border-bordure/60 bg-surface shadow-carte">
      <Bloc className="aspect-[16/9] w-full rounded-none" />
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <Bloc className="h-6 w-2/3" />
        <Bloc className="h-4 w-1/2" />
        <Bloc className="h-4 w-1/3" />
        <Bloc className="h-4 w-11/12" />
        <Bloc className="h-12 w-40 rounded-xl" />
      </div>
    </section>
  );
}

export default function ChargementEvenements() {
  return (
    /* La largeur se pose sur l'écran entier, titre et bascule compris : deux alignements sur le
       même écran, c'est le défaut que `PLEINE_LARGEUR` existe pour empêcher — un squelette n'y
       échappe pas. (`EcranSquelette` ne prend pas de `className` : d'où cette enveloppe.) */
    <div className={PLEINE_LARGEUR}>
      <EcranSquelette libelle="Chargement des événements">
        <EnTeteSquelette largeurTitre="w-48" actions={1} />
        <Bloc className="h-12 w-56 rounded-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 3 }, (_, i) => (
            <CarteEvenementSquelette key={i} />
          ))}
        </div>
      </EcranSquelette>
    </div>
  );
}
