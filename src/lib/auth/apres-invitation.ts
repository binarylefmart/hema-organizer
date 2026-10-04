import { cheminSuiteSur } from "@/lib/validation/auth";
import { CHEMIN_ACTIVATION_ADMIN } from "./acces-admin";

/**
 * Où atterrir après un accès par lien personnel : **la page demandée**, sauf quand ce lien-ci n'a
 * pas encore montré le parcours d'accueil — auquel cas il passe d'abord, en emportant la destination.
 *
 * Ce qui *est* une page demandée se décide un cran plus haut, chez l'appelant
 * (`destinationApresConnexion`) : un écran simplement rouvert n'en est pas une.
 *
 * Le déclencheur est l'**invitation**, pas la personne (`Invitation.parcoursVuLe`) : quelqu'un qui
 * revient ne se voit rien reproposer — lien ouvert, un appui, l'accueil — tandis qu'un **nouveau
 * lien** remet le parcours une fois, ce qui est exactement le moment où il redevient utile.
 *
 * **Le cas de l'administrateur.** Mot de passe et double authentification sont facultatifs pour les
 * membres et les instructeurs ; ils sont **obligatoires pour un ADMIN**, parce que l'espace admin ne
 * s'ouvre qu'avec les deux. Son lien le connecte comme tout le monde — c'est permis, sa session est
 * alors ordinaire —, mais tant que son réglage n'est pas terminé, c'est `/admin/activer` qui
 * l'attend au bout, et non la page qu'il demandait. Passé en `destination`, le réglage traverse
 * donc l'écran de bienvenue au lieu d'être écrasé par lui : on ne lui prend pas la question de
 * l'installation, qui parle de son téléphone et pas de ses droits.
 *
 * **Ici et non dans `src/actions/auth.ts`** : dans un fichier `"use server"`, chaque
 * `export async function` est une route appelable depuis l'extérieur. Exposer cette règle de
 * routage aux tests depuis là-bas revenait à livrer un point d'entrée RPC pour du code de test.
 * Une règle pure se range dans `src/lib/` — d'où l'absence de `"use server"` dans ce fichier,
 * qu'il ne faut pas y ajouter.
 */
export function apresInvitation(parcoursVuLe: Date | null, destination: string, reglageAdminDu = false): string {
  // Le réglage administrateur prime sur la page demandée : elle serait de toute façon refusée si
  // elle appartenait à l'espace admin, et un administrateur à moitié réglé n'en est pas un.
  const suite = reglageAdminDu ? CHEMIN_ACTIVATION_ADMIN : cheminSuiteSur(destination);
  if (parcoursVuLe) return suite;
  return suite === "/" ? "/bienvenue" : `/bienvenue?suite=${encodeURIComponent(suite)}`;
}
