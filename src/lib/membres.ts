/**
 * Règles communes aux personnes du club, côté serveur comme côté interface.
 *
 * **L'adresse email est facultative** (`User.email` est nullable) : quelqu'un dont on n'a pas
 * l'adresse existe dans l'effectif, compte dans les taux et voit sa présence cochée par l'équipe.
 * Il ne reçoit simplement aucun message et n'a pas de lien personnel. Les envois de masse
 * l'écartent **en silence** ; un envoi à l'unité le dit, avec la phrase ci-dessous.
 */

/** Une personne a-t-elle une adresse où écrire ? (garde de type, sûre pour `null` et `""`) */
export function aUnEmail<T extends { email?: string | null }>(personne: T): personne is T & { email: string } {
  return typeof personne.email === "string" && personne.email.length > 0;
}

/**
 * L'adresse **masquée pour l'affichage** : `m…n@exemple.fr`.
 *
 * Elle sert là où une page confirme « c'est bien ton compte » sans connexion — la page du lien
 * personnel, ouverte sur un simple GET. L'adresse entière n'a rien à y faire : le lien est
 * préchargé par les messageries, il traîne dans un historique de navigateur, il se lit par-dessus
 * l'épaule. Le début et la fin du nom, plus le domaine, suffisent à se reconnaître ; c'est tout ce
 * qu'on montre. Le domaine reste lisible : c'est lui qui dit « oui, c'est ma boîte ».
 */
export function masquerEmail(email: string | null | undefined): string {
  if (!email) return "adresse non renseignée";
  const at = email.lastIndexOf("@");
  if (at <= 0) return "…";
  const local = email.slice(0, at);
  const domaine = email.slice(at);
  if (local.length <= 2) return `${local[0]}…${domaine}`;
  return `${local[0]}…${local[local.length - 1]}${domaine}`;
}

/** Message d'un envoi à l'unité impossible : « Bravo 02 n'a pas d'adresse email : … ». */
export function messageSansEmail(personne: { prenom: string; nom: string }): string {
  return `${personne.prenom} ${personne.nom} n'a pas d'adresse email : renseigne-la pour lui envoyer son lien.`;
}

/**
 * Période vers laquelle part le lien personnel depuis la liste des membres : la période active
 * (la plus récente si plusieurs). Sans période active, l'envoi n'aurait pas de destination : la
 * liste n'affiche alors aucun bouton.
 *
 * **Ici et non dans `src/actions/membres.ts`** : dans un fichier `"use server"`, chaque fonction
 * exportée est une route appelable depuis l'extérieur. Celle-ci ne lit rien et ne décide rien —
 * elle choisit dans la liste qu'on lui tend — mais c'était une porte ouverte pour rien. Une règle
 * pure se range dans `src/lib/`.
 */
export function periodeDuLien(periodes: readonly { id: string; nom: string; statut: string }[]): { id: string; nom: string } | null {
  const active = periodes.find((p) => p.statut === "ACTIVE");
  return active ? { id: active.id, nom: active.nom } : null;
}
