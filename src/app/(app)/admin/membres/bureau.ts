/**
 * **Le bureau, en supplément du rôle de base** — la partie qui ne touche ni à React ni à la base,
 * donc la seule qui se teste.
 *
 * **Pourquoi un second menu déroulant et non une troisième entrée dans celui du rôle.** Les trois
 * rôles étaient exclusifs : nommer quelqu'un au bureau lui **retirait** son rôle d'instructeur, et
 * une seule liste déroulante suffisait à les ranger. Depuis que `User.estAdmin` est un supplément
 * (voir `src/lib/permissions.ts`), « administrateur » n'est plus une **valeur** du rôle mais une
 * seconde question, à laquelle on répond oui ou non : une liste à part est la forme de cette seconde
 * question, et c'est elle qui permet enfin de dire « instructeur **et** du bureau ».
 *
 * **Les deux entrées, et rien de plus** : `----------` (l'écriture du vide de tout le dépôt,
 * {@link LIBELLE_VIDE}) et `admin`. Pas de « Retirer les droits » ni de « Nommer » : ce sont des
 * **verbes**, et une liste déroulante n'énumère pas des gestes, elle montre un **état** — celui
 * qu'on lit, celui qu'on choisit. Le geste, lui, est le bouton d'à côté.
 *
 * Ce module ne dépend de rien d'exécutable : il est lu par un composant client, et tout module
 * touchant aux réglages entraînerait `node:crypto` dans le paquet du navigateur (échec de
 * `npm run build` que ni `tsc` ni les tests ne voient). `EntreeListe` s'importe donc en `import
 * type`, et depuis le `.ts` de la liste déroulante — un test unitaire ne peut pas lire un `.tsx`.
 */

import { LIBELLE_VIDE } from "@/lib/constants";
import type { EntreeListe } from "@/components/ui/liste-deroulante";

/**
 * **La valeur qui dit « du bureau »**, telle qu'elle voyage dans la liste déroulante.
 *
 * C'est le nom de la **ligne de la matrice** de permissions (`ROLES`, `src/lib/constants.ts`), pas
 * une valeur de la colonne `role` : `role` ne vaut plus jamais `"ADMIN"` depuis la migration
 * `role_de_base_et_admin_en_supplement`, et ce que l'écran enregistre ici est le booléen `estAdmin`.
 * On garde malgré tout ce mot comme valeur d'entrée, parce qu'il est **le** nom de ce jeu de droits
 * dans tout le dépôt — du journal d'audit à l'onglet « Comptes admin ».
 */
export const VALEUR_BUREAU = "ADMIN";

/**
 * **Le mot du bureau à l'écran : « admin »** — celui de la demande (« au choix `----------` ou
 * `admin` ») et celui de l'onglet qui porte déjà ce geste, « Comptes admin ».
 *
 * Il est écrit **ici et une seule fois** : la liste déroulante et la pastille de la liste des
 * membres le lisent tous les deux, et deux mots pour une même chose sur un même écran feraient
 * douter qu'ils parlent du même droit. `ROLE_LABELS.ADMIN` (« Administrateur ») reste le mot du
 * **journal d'audit** et des écrans qui nomment un rôle au long.
 */
export const LIBELLE_BUREAU = "admin";

/**
 * Les deux entrées de la liste, l'écriture du vide **en tête** — c'est la place qu'elle a dans
 * toutes les listes déroulantes du dépôt : le vide est le choix de départ, pas une entrée de plus
 * glissée au milieu.
 */
export const ENTREES_BUREAU: EntreeListe[] = [
  { valeur: "", libelle: LIBELLE_VIDE },
  { valeur: VALEUR_BUREAU, libelle: LIBELLE_BUREAU },
];

/** L'état du serveur traduit en valeur de liste : `estAdmin` d'un côté, `ADMIN` ou rien de l'autre. */
export function valeurBureau(estAdmin: boolean): string {
  return estAdmin ? VALEUR_BUREAU : "";
}

/**
 * **La question posée avant d'écrire — et elle se pose, parce que ce geste donne ou retire tous les
 * droits du club.**
 *
 * La liste déroulante du rôle **en masse** n'applique rien au `change` (« un rôle effleuré écrirait
 * sur douze personnes ») ; celle-ci ne porte que sur **une** personne, nommée, sous les yeux — et
 * elle ne s'applique pas au `change` non plus, pour une autre raison : le geste ouvre les comptes,
 * les accès, la technique et le journal, ou les referme. C'est le seul réglage de l'annuaire dont la
 * confirmation ne soit pas une politesse.
 *
 * Elle dit, dans cet ordre : ce qu'on va faire et à qui, **ce que la personne gagne ou perd
 * vraiment**, ce qui ne change pas — un compte n'est ni créé ni effacé par ce geste —, et que le
 * journal en gardera la trace à son nom. Cette dernière phrase n'est pas un ornement : c'est elle
 * qui tranchera le désaccord d'après.
 */
export function texteConfirmationBureau(nom: string, versBureau: boolean): string {
  if (versBureau) {
    return [
      `Nommer ${nom} administrateur ?`,
      "Tous les droits du club s'ouvrent : les comptes, les accès, les trimestres, la technique et le journal d'audit.",
      "Son rôle de base ne change pas — un instructeur reste instructeur, le bureau s'ajoute par-dessus.",
      "Mot de passe et double authentification lui seront demandés avant que l'administration s'ouvre.",
      "Le changement est inscrit au journal, à son nom.",
    ].join("\n");
  }
  return [
    `Retirer les droits d'administrateur de ${nom} ?`,
    "L'administration se referme pour elle dès la page suivante, et son élévation en cours tombe.",
    "Le compte reste, avec son rôle de base, ses présences et tout son historique : ce n'est pas une suppression.",
    "Le changement est inscrit au journal, à son nom.",
  ].join("\n");
}
