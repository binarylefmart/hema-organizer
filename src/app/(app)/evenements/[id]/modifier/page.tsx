import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { evenementParId } from "@/lib/evenements";
import { modifierEvenement } from "@/actions/evenements";
import { LienBouton } from "@/components/ui/Bouton";
import { Alerte } from "@/components/ui/Alerte";
import { Carte } from "@/components/ui/Carte";
import { FormulaireEvenement } from "@/components/evenements/FormulaireEvenement";
import { PLEINE_LARGEUR_2XL } from "@/components/ui/pleine-largeur";

export const metadata: Metadata = { title: "Modifier l'événement" };

type Props = { params: Promise<{ id: string }> };

/**
 * Modifier une annonce — horaire déplacé, lieu confirmé, lien d'inscription enfin ouvert :
 * l'encadrement tient les annonces à jour (`evenements.edit`), là où les ouvrir et les effacer
 * reste au bureau. La permission est exigée **avant** la lecture de l'événement, pour qu'un membre
 * ne puisse pas même vérifier l'existence d'un brouillon.
 */
export default async function PageModifierEvenement({ params }: Props) {
  const user = await requirePermission("evenements.edit");
  const { id } = await params;
  const e = await evenementParId(id, user);
  if (!e) notFound();
  return (
    /*
     * **Un formulaire ne s'élargit pas, il se partage**. `PLEINE_LARGEUR_2XL` plutôt que
     * `PLEINE_LARGEUR` : il faut la place de **deux colonnes de champs** (2 × ~690 px), et elle
     * n'existe qu'à partir de 1 536 px. La découpe en deux colonnes, elle, vit dans
     * `FormulaireEvenement` et mesure le **formulaire**, pas la fenêtre — sans quoi plus l'écran
     * serait grand, plus les champs seraient étroits.
     */
    <div className={`flex flex-col gap-5 ${PLEINE_LARGEUR_2XL}`}>
      <h1 className="text-3xl">Modifier l&apos;événement</h1>
      {!e.publie && (
        <Alerte type="attention" titre="Brouillon">
          Cette annonce n&apos;est visible que de l&apos;équipe. Coche « Publié » en bas du formulaire pour l&apos;ouvrir à tout le club.
        </Alerte>
      )}
      <Carte>
        <FormulaireEvenement
          action={modifierEvenement.bind(null, e.id)}
          valeurs={e}
          bouton="Enregistrer"
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
