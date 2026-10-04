import { Bloc, EcranSquelette, LignesTexte } from "@/components/ui/Squelette";
import { PLEINE_LARGEUR_2XL } from "@/components/ui/pleine-largeur";

/**
 * Attente de la page d'un événement : l'affiche, le titre, les lignes « quand / où / qui »,
 * le texte et les boutons — le gabarit réel, pour que rien ne se déplace à l'arrivée.
 *
 * **Même largeur et mêmes paliers de conteneur que la fiche** : `PLEINE_LARGEUR_2XL` sur la
 * colonne, `@container` sur la carte, et l'affiche qui passe à gauche dans 22 rem à partir de
 * `@3xl`. Sans la colonne de 22 rem, le bandeau en 16/9 d'une carte de 1 440 px ferait **810 px de
 * haut** : un pavé gris qui repousse tout le reste sous l'écran, puis disparaît.
 *
 * La silhouette dessine la fiche **avec** affiche : c'est la seule qui ait une hauteur à réserver.
 * Sans affiche, la fiche rend une rangée d'écu de 96 px en pleine largeur (`BandeauEvenement`), et
 * aucun squelette ne peut annoncer les deux à la fois.
 */
export default function ChargementEvenement() {
  return (
    <div className={PLEINE_LARGEUR_2XL}>
      <EcranSquelette libelle="Chargement de l'événement">
        <Bloc className="h-12 w-52 rounded-xl" />
        <section className="@container overflow-hidden rounded-2xl border border-bordure/60 bg-surface shadow-carte">
          <div className="flex flex-col @3xl:flex-row">
            <div className="@3xl:w-88 @3xl:shrink-0 @3xl:self-start">
              <Bloc className="aspect-[16/9] w-full rounded-none" />
            </div>
            <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6 @3xl:flex-1">
              <Bloc className="h-9 w-3/4" />
              <div className="grid gap-2 @3xl:grid-cols-2">
                <Bloc className="h-5 w-64 max-w-full" />
                <Bloc className="h-5 w-56 max-w-full" />
                <Bloc className="h-5 w-48 max-w-full" />
              </div>
              <LignesTexte nombre={3} className="max-w-prose" />
              <Bloc className="h-12 w-40 rounded-xl" />
            </div>
          </div>
        </section>
      </EcranSquelette>
    </div>
  );
}
