"use client";

import { GestesProposes, type GestePret } from "@/components/ui/GestesProposes";
import { gestesTousProposes, type ChiffresTous, type GesteTous } from "./choix-geste";

/**
 * **Le volet « Pour tout le monde », sur le motif commun « Que veux-tu faire ? »** (`GestesProposes`) :
 * une question, la liste des seuls gestes qui toucheraient quelqu'un (avec leur nombre, compté par la
 * page avec les filtres du serveur), l'explication du geste choisi, et un seul bouton qui dit le verbe
 * et le nombre.
 *
 * **Pas de suppression ici, comme avant** : effacer des comptes et leur historique ne se fait qu'en les
 * désignant. Le bouton est rouge pour révoquer les liens ou réinitialiser les accès (`gesteRouge`). Et
 * **chaque geste garde sa confirmation** : ils portent sur tout l'annuaire.
 *
 * Les actions arrivent **déjà liées** par la page (période, adresse de retour) : ce composant ne
 * choisit ni la population ni la période, il ne fait que demander laquelle des actions lancer. La
 * composition elle-même (`gestesTousProposes`) est partagée avec le volet « + Ajouter » du téléphone.
 */
export function ChoixToutLeMonde({
  chiffres,
  actions,
  confirmations,
}: {
  chiffres: ChiffresTous;
  /** Les gestes permis à l'acteur, prêts à partir. Un geste sans action n'est pas proposé. */
  actions: Partial<Record<GesteTous, () => Promise<unknown>>>;
  /** La question posée avant chaque geste — celle que l'écran posait déjà. */
  confirmations: Partial<Record<GesteTous, string>>;
}) {
  const gestes: GestePret[] = gestesTousProposes(chiffres, actions, confirmations);
  return <GestesProposes id="geste-tous" gestes={gestes} />;
}
