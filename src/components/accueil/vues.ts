/**
 * **Les positions de la bascule de l'accueil, et la place dans le club qui les ouvre** — sans React,
 * pour que la règle se vérifie sans navigateur.
 *
 * Elle vivait en une ligne dans `VueAccueil.tsx`, et cette ligne portait un défaut que le modèle de
 * rôles a rendu visible.
 *
 * **Ce qui n'allait pas.** La position « Club » était gardée par `isStaff(user)`, c'est-à-dire la
 * **permission** `sessions.manage` — que `can()` accorde à tout administrateur. Un administrateur
 * dont le rôle de base est **membre** recevait donc la vue de l'encadrement : celle qui ouvre sur
 * « où ça se remplit et ce qu'il y a à préparer ». Or il n'encadre pas. Depuis que le bureau est un
 * **supplément** et non un rôle à part, la question « suis-je de l'encadrement ? » ne se lit plus
 * dans une permission : elle se lit dans le **rôle de base**.
 *
 * **La distinction qui tient tout, et qui explique pourquoi les autres usages de `isStaff` restent
 * justes** : cette bascule parle d'**identité** — quelle vue m'ouvre-t-on —, pas de **droit**. Les
 * autres appels de `isStaff` décident d'un périmètre de données (voir toutes les périodes, tous les
 * ateliers) ou de l'accès à l'espace instructeur, et là un administrateur a bien le droit, quel que
 * soit son rôle de base. On ne touche donc qu'ici.
 */
export type Vue = "club" | "personnel" | "admin";

/**
 * Les positions offertes, dans l'ordre où elles s'affichent — **la première étant celle sur
 * laquelle on ouvre**.
 *
 * - `encadre` : le **rôle de base** vaut INSTRUCTEUR — ou c'est le **compte global du déploiement**,
 *   qui a tous les rôles (voir `encadreLeClub`). Pas « a le droit d'organiser » ;
 * - `admin` : administrateur **connecté en tant qu'administrateur** (rôle *et* élévation, vérifiés
 *   côté serveur — voir `espaceAdminOuvert` dans `src/lib/accueil.ts`).
 *
 * Les quatre cas, et chacun se lit comme une phrase :
 *
 * | rôle de base | du bureau, élevé | positions |
 * |---|---|---|
 * | membre | non | « Personnel » — et **aucune bascule** : un bouton à une position ne commande rien |
 * | instructeur | non | « Club », « Personnel » |
 * | **membre** | **oui** | « Personnel », « Admin » — il pilote le club sans l'encadrer |
 * | instructeur | oui | « Club », « Personnel », « Admin » |
 *
 * Le troisième cas est celui qui manquait. Et il ouvre sur « Personnel », pas sur « Admin » : la vue
 * de pilotage se prend quand on vient piloter, elle ne s'impose pas à l'ouverture de l'application.
 */
export function vuesDisponibles({ encadre, admin }: { encadre: boolean; admin: boolean }): Vue[] {
  const vues: Vue[] = encadre ? ["club", "personnel"] : ["personnel"];
  return admin ? [...vues, "admin"] : vues;
}
