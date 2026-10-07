import { pairesEgales, type Paire } from "./file-envoi";

/**
 * **Le brouillon du planning, écrit d'ailleurs que par la case elle-même** — la partie sans React,
 * donc testable (`ContexteBrouillon` ne garde que l'état et la garde de fermeture).
 *
 * Jusqu'ici, une seule main écrivait dans le brouillon : la case (`CaseEditeur`), par son entonnoir
 * `sauver`. Elle tenait son propre état et **poussait** sa valeur vers le brouillon ; le brouillon ne
 * renvoyait jamais rien. La sélection multiple du planning (« Régler une partie » sur plusieurs
 * séances cochées) écrit maintenant **dans le même brouillon**, pour que la barre « Appliquer les
 * modifications » enregistre ces réglages exactement comme ceux faits à la main — mêmes verrous, même
 * tout-ou-rien, même journal (`enregistrerCases`). Deux conséquences, et ce module les tient :
 *
 * 1. **une écriture en masse ne laisse jamais une modification nulle** : une case que le réglage
 *    ramène à ce que le serveur porte déjà **sort** du brouillon au lieu d'y rester — même règle que
 *    la case (« une case revenue à ce que le serveur porte sort du brouillon »), sans quoi le compteur
 *    annoncerait des cases qui n'ont rien à écrire ;
 * 2. **la case doit montrer ce qu'on vient de lui imposer** : sans retour, la barre compterait six
 *    cases modifiées pendant que les six listes déroulantes afficheraient encore l'ancien instructeur
 *    — et le premier réglage fait ensuite à la main dans l'une d'elles **renverrait l'ancien** par-dessus,
 *    puisque la case pousse toujours son état entier. D'où les **imposées** : chaque écriture venue
 *    d'ailleurs y laisse sa valeur et un numéro de tour, et la case reprend la valeur dès que le numéro
 *    change ({@link paireImposee}).
 *
 * **Pourquoi un numéro de tour plutôt que de comparer la valeur du brouillon à celle de la case.** La
 * comparaison aurait l'air plus simple, mais elle confond deux départs : après « Appliquer », le
 * brouillon se vide, la valeur « attendue » redevient celle du serveur **d'avant** l'écriture (la page
 * n'est pas encore revenue), et la case repeindrait l'ancien contenu pendant la navigation. Une
 * imposition, elle, n'arrive que d'un geste d'écriture explicite : vider le brouillon n'en est pas un.
 */

/** Une valeur imposée à une case de l'extérieur, et le tour qui l'a posée. */
export type Imposee = { paire: Paire; tour: number };

export type EtatBrouillon = {
  modifiees: ReadonlyMap<string, Paire>;
  imposees: ReadonlyMap<string, Imposee>;
};

/** Une case à régler d'un coup : ce qu'on veut y voir, et ce que le serveur y porte. */
export type EcritureEnMasse = { partieId: string; paire: Paire; serveur: Paire };

/**
 * **Poser plusieurs cases d'un coup.** Chaque case reçoit sa valeur — ou **sort** du brouillon si
 * cette valeur est celle du serveur —, et chacune est marquée « imposée » au tour donné pour que son
 * éditeur la reprenne. Les états reçus ne sont jamais modifiés : ce sont des états React.
 */
export function poserEnMasse(etat: EtatBrouillon, ecritures: readonly EcritureEnMasse[], tour: number): EtatBrouillon & { posees: string[]; oubliees: string[] } {
  const modifiees = new Map(etat.modifiees);
  const imposees = new Map(etat.imposees);
  const posees: string[] = [];
  const oubliees: string[] = [];
  for (const e of ecritures) {
    if (pairesEgales(e.paire, e.serveur)) {
      modifiees.delete(e.partieId);
      oubliees.push(e.partieId);
    } else {
      modifiees.set(e.partieId, e.paire);
      posees.push(e.partieId);
    }
    imposees.set(e.partieId, { paire: e.paire, tour });
  }
  return { modifiees, imposees, posees, oubliees };
}

/**
 * **Ce que la case doit reprendre**, ou `null` : la valeur imposée si son tour n'a pas encore été vu
 * par la case. Une case qui n'a jamais rien reçu de l'extérieur n'a rien à reprendre.
 */
export function paireImposee(imposee: Imposee | null | undefined, tourVu: number): Paire | null {
  return imposee && imposee.tour !== tourVu ? imposee.paire : null;
}

/**
 * **Ce que « Appliquer » envoie** : les cases du brouillon dont la partie est encore à l'écran, et
 * les identifiants écartés à part.
 *
 * Un élément retiré pendant qu'il portait un réglage laissait son identifiant dans le brouillon, et
 * le serveur — tout-ou-rien — refusait alors le lot entier (« Cette partie n'existe plus ») : la seule
 * issue était « Annuler », qui jetait aussi tous les autres réglages. Le retrait oublie désormais la
 * case ; ce tri est le filet, et ce qu'il écarte se dit à l'écran.
 */
export function casesAEnvoyer<T>(
  modifiees: ReadonlyMap<string, T>,
  affichees: Iterable<string>,
): { cases: (T & { partieId: string })[]; ecartees: string[] } {
  const connues = new Set(affichees);
  const cases: (T & { partieId: string })[] = [];
  const ecartees: string[] = [];
  for (const [partieId, paire] of modifiees) {
    if (connues.has(partieId)) cases.push({ partieId, ...paire });
    else ecartees.push(partieId);
  }
  return { cases, ecartees };
}

/** La phrase qui dit ce que le tri a écarté (`casesAEnvoyer`). */
export function texteEcartees(n: number): string {
  return n > 1
    ? `${n} réglages portaient sur des éléments retirés entre-temps : ils ont été écartés.`
    : "1 réglage portait sur un élément retiré entre-temps : il a été écarté.";
}
