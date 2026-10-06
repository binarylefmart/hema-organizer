import { LienBouton } from "./Bouton";
import { Icone } from "./Icone";

/**
 * **Le bouton qui ouvre la modification, au même endroit sur tous les onglets** : la rangée qui suit
 * immédiatement le titre de la page, alignée à droite sur un écran large, pleine largeur sur un
 * téléphone. Planning, liste des séances et fiche d'une séance le posaient chacun ailleurs (sous les
 * filtres, dans la colonne de côté, dans l'en-tête à côté du partage) : on le cherchait à chaque écran.
 *
 * Plein, avec le même pictogramme : c'est la seule porte vers la saisie, elle se présente partout de
 * la même façon. Le bandeau du mode modification, quand il existe, prend la même place.
 */
export function EntreeModification({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <LienBouton href={href} className="w-full sm:w-auto">
        <Icone nom="livre" taille={20} />
        {children}
      </LienBouton>
    </div>
  );
}
