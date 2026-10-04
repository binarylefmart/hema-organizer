import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { creerEvenement } from "@/actions/evenements";
import { Carte } from "@/components/ui/Carte";
import { LienBouton } from "@/components/ui/Bouton";
import { FormulaireEvenement } from "@/components/evenements/FormulaireEvenement";
import { PLEINE_LARGEUR_2XL } from "@/components/ui/pleine-largeur";

export const metadata: Metadata = { title: "Nouvel événement" };

/**
 * Annoncer un événement. Les stages, tournois et démonstrations sont la vie du club, et c'est
 * l'encadrement qui les connaît, les organise et sait quand ils tombent à l'eau : ouvrir une
 * annonce appartient donc aux instructeurs comme aux admins. Ce n'est pas un trimestre ni un compte
 * — une annonce n'ouvre aucun accès à personne et se retire d'un clic, et le journal garde qui a
 * publié quoi. `requirePermission` renvoie ailleurs quiconque n'a pas ce droit — la page ne se
 * contente pas d'être absente du menu.
 */
export default async function PageNouvelEvenement() {
  await requirePermission("evenements.creer_supprimer");
  return (
    /*
     * **Un formulaire ne s'élargit pas, il se partage**. `PLEINE_LARGEUR_2XL` plutôt que
     * `PLEINE_LARGEUR` : il faut la place de **deux colonnes de champs** (2 × ~690 px), et elle
     * n'existe qu'à partir de 1 536 px. La découpe en deux colonnes, elle, vit dans
     * `FormulaireEvenement` et mesure le **formulaire**, pas la fenêtre — sans quoi plus l'écran
     * serait grand, plus les champs seraient étroits.
     */
    <div className={`flex flex-col gap-5 ${PLEINE_LARGEUR_2XL}`}>
      <h1 className="text-3xl">Nouvel événement</h1>
      <Carte>
        <FormulaireEvenement
          action={creerEvenement}
          bouton="Publier l'événement"
          apres={
            <LienBouton href="/evenements" variante="secondaire" taille="petite" enCours>
              Annuler
            </LienBouton>
          }
        />
      </Carte>
    </div>
  );
}
