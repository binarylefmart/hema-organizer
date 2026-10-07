import { SEUIL_RECHERCHE, normaliserPourFrappe } from "@/components/ui/liste-deroulante";

/**
 * **Les mots et la mécanique de « Nommer un administrateur » à plusieurs**.
 *
 * Le bureau se renouvelle en bloc à l'assemblée : trois personnes à nommer, c'étaient trois
 * allers-retours dans la même liste déroulante, chacun suivi de son propre code à six chiffres.
 *
 * **Ce module ne contient ni React ni base** — comme `selection-roles.ts` de l'annuaire — pour que
 * les phrases que l'écran promet soient vérifiables sans monter un composant. Il est **local à cette
 * carte** : le module partagé (`src/components/ui/selection.ts`) est en cours de refonte, et une
 * mise en commun se fera ensuite, d'un seul geste, avec les deux autres écrans de masse.
 */

/** Une personne nommable : exactement ce que la carte affiche d'elle. */
export type Candidat = { id: string; prenom: string; nom: string; email: string | null };

/** « Prénom Nom », l'ordre dans lequel l'application écrit les noms partout ailleurs. */
export function nomComplet(c: Candidat): string {
  return `${c.prenom} ${c.nom}`;
}

/**
 * **Au-delà de vingt noms, une liste ne se parcourt plus : elle se cherche.** Le seuil est celui du
 * projet ({@link SEUIL_RECHERCHE}), pas un nombre de plus : un club de douze garde exactement l'écran
 * qu'il avait, sans champ ni compteur ; un club de quatre-vingts ne fait pas défiler l'annuaire au
 * doigt pour trouver le nouveau trésorier.
 */
export function cherchable(candidats: readonly Candidat[]): boolean {
  return candidats.length > SEUIL_RECHERCHE;
}

/**
 * Les candidats qui correspondent à ce qui est tapé : sans accents ni casse, n'importe où dans le
 * nom ou l'adresse, et les mots se croisent dans n'importe quel ordre — les trois choix de la
 * recherche des listes déroulantes (`filtrerEntrees`), pour qu'on ne cherche pas un nom de deux
 * façons différentes selon l'écran.
 */
export function filtrerCandidats(candidats: readonly Candidat[], recherche: string): Candidat[] {
  const mots = normaliserPourFrappe(recherche).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return [...candidats];
  return candidats.filter((c) => {
    const cible = normaliserPourFrappe(`${nomComplet(c)} ${c.email ?? ""}`);
    return mots.every((mot) => cible.includes(mot));
  });
}

/**
 * **Le lot part dans l'ordre de la liste, jamais dans celui des clics** (CLAUDE.md). C'est cet ordre
 * que la confirmation récite et que le journal gardera ; l'ordre des cases cochées ne se retrouve
 * nulle part à l'écran.
 */
export function coches(candidats: readonly Candidat[], selection: ReadonlySet<string>): Candidat[] {
  return candidats.filter((c) => selection.has(c.id));
}

/**
 * **Ce que la recherche cache est compté et dit.** Une case cochée puis masquée par une frappe part
 * quand même avec le lot : taire les deux personnes qui ne sont plus à l'écran ferait signer un lot
 * de trois en croyant n'en voir qu'un. La sélection survit à la frappe — l'effacer en silence serait
 * le pire des deux comportements possibles (c'est le correctif que l'annuaire a déjà reçu).
 */
export function texteHorsRecherche(nbCaches: number): string | null {
  if (nbCaches <= 0) return null;
  return nbCaches === 1
    ? "1 personne cochée n'apparaît pas dans les résultats affichés : elle part quand même avec le lot."
    : `${nbCaches} personnes cochées n'apparaissent pas dans les résultats affichés : elles partent quand même avec le lot.`;
}

/** Au-delà de cinq noms, une boîte de confirmation ne se lit plus : on dit le nombre. */
export const NOMS_MAX = 5;

/**
 * **Dix noms montrés d'emblée, puis « Afficher les N autres »** (demande du bureau : « en cas de gros
 * groupe »). Plus court que le repli des personnes de l'application (`LIGNES_VISIBLES`, 20) : cette
 * liste ne se parcourt pas, on y cherche deux ou trois noms — la recherche, toujours là, fait le
 * reste. Pendant une recherche, tous les résultats s'affichent.
 */
export const NOMINATION_VISIBLES = 10;

/**
 * **La confirmation annonce ce qui va se passer** : combien de personnes, lesquelles quand c'est
 * lisible, et **ce que le rôle emporte** — les pleins pouvoirs techniques, dont celui de nommer
 * d'autres administrateurs. Nommer trois administrateurs d'un clic sans récapitulatif serait
 * exactement le geste que le dossier interdit.
 *
 * **Elle ne s'affiche qu'à partir de deux personnes**, et c'est volontaire : nommer quelqu'un seul
 * reste le geste d'avant, au même nombre de clics qu'avec la liste déroulante (le frein de ce
 * geste-là, c'est le code à six chiffres d'`exigerReauth`, qui n'a pas bougé).
 */
export function texteConfirmation(lot: readonly Candidat[]): string {
  const noms = lot.map(nomComplet);
  const qui = noms.length <= NOMS_MAX ? ` — ${noms.join(", ")}` : " (les noms sont dans la liste cochée)";
  return (
    `Donner les droits d'administrateur à ${noms.length} personnes${qui} ?\n\n` +
    "Chacune pourra tout voir et tout modifier dans l'espace admin, y compris nommer d'autres administrateurs. " +
    "Mot de passe et double authentification leur seront demandés avant que l'administration s'ouvre."
  );
}

/**
 * **Le bouton nomme la portée de son geste**, sans jamais écrire « Tout » : à une personne il garde
 * son libellé d'origine, au-delà il dit combien il en emporte.
 */
export function libelleBouton(n: number): string {
  return n > 1 ? `Donner les droits admin à ${n} personnes` : "Donner les droits admin";
}

/** Tant que rien n'est coché, la carte dit quoi faire plutôt que de laisser un bouton muet. */
export const LIBELLE_SANS_SELECTION = "Coche la ou les personnes à nommer.";
