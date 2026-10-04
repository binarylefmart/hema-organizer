import { LienBouton } from "@/components/ui/Bouton";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { Volet } from "@/components/ui/Volet";
import { Champ } from "@/components/ui/Champ";
import { annulerSeance, retablirSeance } from "@/actions/seances";

/**
 * Les actions d'organisation d'une séance — modifier, annuler, rétablir — telles qu'elles
 * apparaissent **au pied de la carte**, dans l'onglet Séances.
 *
 * Elles ne sont rendues que pour l'encadrement (`sessions.manage`, vérifié par l'appelant) et les
 * actions serveur refont ce contrôle de leur côté : ce qui est caché ici n'est pas seulement
 * invisible, il est refusé. Un membre qui lit la page n'en reçoit même pas le balisage.
 *
 * Une séance **commencée** ne s'annule plus (c'est le sens de `passee`) : on ne prévient pas les
 * gens d'une annulation pendant qu'ils sont dans la salle. La correction d'après-coup se fait sur
 * les présences, pas sur la séance.
 *
 * **Neutres au pied de chaque carte** : un « Annuler » rouge et un « Rétablir » vert sur chaque
 * séance de la liste faisaient un mur de couleurs pour des gestes qui se défont l'un l'autre. Le
 * rouge reste au **dernier** bouton, dans le volet, après le motif : c'est lui qui fait partir
 * l'annonce à tout le club (emails, salons, site), et celle-là ne se rappelle pas.
 *
 * Le formulaire d'annulation passe par `Volet` : sur téléphone, le pied de carte est à gauche de
 * l'écran et une bulle ancrée à sa droite en sortait (voir `Volet`).
 */
export function ActionsEquipe({ id, annulee, passee }: { id: string; annulee: boolean; passee: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <LienBouton href={`/seances/${id}`} variante="secondaire" taille="petite" enCours>
        Modifier
      </LienBouton>
      {!passee &&
        (annulee ? (
          <BoutonAction action={retablirSeance.bind(null, id)} variante="secondaire" taille="petite" confirmation="Rétablir cette séance ?">
            Rétablir
          </BoutonAction>
        ) : (
          <Volet libelle="Annuler" libelleOuvert="Fermer" titre="Annuler la séance" variante="secondaire" groupe="annuler-seance">
            <FormulaireAction action={annulerSeance} bouton="Annuler la séance" variante="danger" enCours="Annulation…">
              <input type="hidden" name="sessionId" value={id} />
              <Champ
                label="Motif (envoyé aux membres)"
                name="motif"
                id={`motif-${id}`}
                required
                maxLength={200}
                placeholder="ex. Salle indisponible"
                aide="Ce motif est visible par tous, y compris sur le lien de partage : évite les noms."
              />
            </FormulaireAction>
          </Volet>
        ))}
    </div>
  );
}
