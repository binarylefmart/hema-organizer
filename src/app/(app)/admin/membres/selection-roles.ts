/**
 * **Changer le rôle de plusieurs comptes d'un coup** — la partie qui ne touche ni à React ni à la
 * base, donc la seule qui se teste.
 *
 * Le geste est **le même que la correction des présences en masse** (`/admin/presences`,
 * `src/components/gestion/selection-presences.ts`), et c'est voulu : un bureau qui apprend à cocher
 * des lignes sur un écran doit retrouver exactement le même geste sur l'autre. Les mécaniques
 * d'ensemble — cocher, décocher, case maîtresse, libellé qui nomme ce sur quoi elle agit — sont
 * **importées de là-bas**, pas réécrites ici. Ne restent ici que les mots propres au rôle.
 *
 * Deux règles, reprises telles quelles :
 *
 * 1. **La sélection ne porte que sur ce qui est affiché** : le résultat de la recherche en cours et
 *    la page courante (l'annuaire coupe à cinquante comptes). Jamais les quatre-vingts en silence.
 * 2. **La confirmation dit ce qui sera écrit** : combien de comptes changent vraiment de rôle, et
 *    combien portaient déjà celui qu'on vise — les confondre gonflerait le chiffre censé faire
 *    hésiter.
 *
 * Ce module ne dépend de rien : il est lu par un composant client, et tout module touchant aux
 * réglages entraînerait `node:crypto` dans le paquet du navigateur.
 */

/** Une ligne de l'annuaire, vue par la sélection : son identité et le rôle qu'elle porte. */
export type LigneRole = { id: string; role: string };

/** Ce qu'un lot va faire, avant de le faire. */
export type ResumeRoles = {
  /** Combien de comptes sont sélectionnés. */
  total: number;
  /** Combien changeront réellement de rôle. */
  changent: number;
  /** Combien portent déjà le rôle visé : rien ne changera pour eux. */
  inchanges: number;
};

/**
 * Le décompte des deux populations d'un lot.
 *
 * Quelqu'un qui est **déjà** instructeur n'est pas « nommé » une seconde fois : le compter avec les
 * autres ferait annoncer « 7 comptes passés instructeur » là où deux l'étaient depuis l'an dernier,
 * et le journal, lui, n'en garderait que cinq. Deux chiffres qui ne s'accordent pas, c'est un doute
 * qu'on ne lève plus.
 */
export function resumeRoles(lignes: readonly LigneRole[], cible: string): ResumeRoles {
  const inchanges = lignes.filter((l) => l.role === cible).length;
  return { total: lignes.length, changent: lignes.length - inchanges, inchanges };
}

/**
 * **La question posée avant d'écrire.** Elle dit trois choses, dans cet ordre : combien de comptes,
 * ce qu'on va leur écrire, et **ce qui ne bougera pas**. La dernière phrase rappelle le journal :
 * ce n'est pas une politesse, c'est lui qui tranchera le désaccord de la semaine suivante, personne
 * par personne.
 */
export function texteConfirmationRoles(resume: ResumeRoles, libelleRole: string): string {
  const comptes = `${resume.total} compte${resume.total > 1 ? "s" : ""}`;
  const morceaux = [`Passer ${comptes} en « ${libelleRole} » ?`];
  if (resume.changent === 0) morceaux.push("Tous le sont déjà : rien ne changera.");
  else {
    if (resume.inchanges > 0) {
      const changent = resume.changent > 1 ? `${resume.changent} changeront de rôle` : "1 changera de rôle";
      const dejas = resume.inchanges > 1 ? `${resume.inchanges} le sont déjà` : "1 l'est déjà";
      morceaux.push(`${changent}, ${dejas}.`);
    }
    morceaux.push("Chaque changement est inscrit au journal, nom par nom.");
  }
  return morceaux.join(" ");
}

/**
 * Et la phrase qui dit, sous la case maîtresse, ce qui reste **en dehors** de la sélection.
 *
 * Elle diffère de son équivalent des présences (`texteRepliees`) sur un point : ici le reste n'est
 * pas replié dans la page, il est **sur la page suivante** — « Afficher les 30 autres comptes » est
 * une requête. Dire « repliées » ferait chercher un bouton qui déplierait sur place.
 */
export function texteHorsPage(restants: number, selectionnes: number): string | null {
  // **Elle affirme « ils ne sont pas sélectionnés » : c'est donc à elle de vérifier que c'est
  // vrai**. Ce l'était par accident, tant que l'écran rabotait la sélection sur la page affichée à
  // chaque rendu ; depuis que la sélection survit au changement de page, la phrase deviendrait
  // fausse dès la première case cochée — et l'appelant était le seul à le savoir. Le nombre de
  // cochées entre donc dans la fonction : au-delà de zéro, elle se taise et laisse la place à
  // `texteHorsAffichage`, qui compte ce que le lot emporte hors de l'écran.
  if (restants <= 0 || selectionnes > 0) return null;
  if (restants === 1) return "1 autre compte n'est pas affiché : il n'est pas sélectionné.";
  return `${restants} autres comptes ne sont pas affichés : ils ne sont pas sélectionnés.`;
}

/**
 * Et la phrase qui dit pourquoi certaines lignes n'ont pas de case du tout. Une case absente sans
 * explication se lit comme un bogue ; une case présente qui échouerait à l'usage serait pire.
 *
 * **Elle ne parle plus des administrateurs**. Elle disait « N administrateurs n'ont pas de case :
 * leurs droits se règlent dans Comptes admin », et le motif en était précis — changer le rôle d'un
 * administrateur l'aurait **rétrogradé en silence**, les trois rôles étant alors exclusifs. Ce
 * risque a disparu avec le modèle : `role` est un rôle de base (membre ou instructeur) et le bureau
 * s'ajoute par-dessus (`estAdmin`), si bien que le lot de rôles ne retire plus rien à personne — il
 * n'écrit **que** `role`, jamais `estAdmin`. **Un administrateur a donc retrouvé sa case**, et avec
 * elle les cinq gestes de masse de l'annuaire, exactement comme son propre volet et sa propre fiche
 * les lui offrent déjà un par un. Voir `actions.ts`.
 *
 * Restent deux lignes sans case, et elles méritent chacune leur phrase :
 *
 * - **son propre compte** : on n'agit jamais sur soi-même en masse (se désactiver, c'est fermer la
 *   porte de l'intérieur ; changer son propre rôle est refusé partout dans le dépôt). C'est la seule
 *   ligne sans case que l'annuaire montre aujourd'hui, et elle n'était jamais expliquée — une case
 *   manquante sur sa propre ligne se lit d'autant plus comme un bogue qu'on la cherche pour soi ;
 * - **un compte du bureau que l'acteur ne peut pas modifier** : impossible aujourd'hui, l'annuaire
 *   étant réservé au bureau (`members.view`), mais la phrase existe pour le jour où la consultation
 *   se rouvrira à l'encadrement — `canEditUser` refusera alors ces lignes, et l'écran devra le dire
 *   plutôt que de laisser un trou dans la colonne des cases.
 *
 * Le compte du portail, lui, n'apparaît pas du tout dans l'annuaire : il n'y a rien à expliquer.
 */
export function texteSansCase(sansCase: { soiMeme: boolean; bureau: number }): string | null {
  const phrases: string[] = [];
  if (sansCase.bureau > 0) {
    const pluriel = sansCase.bureau > 1 ? "s" : "";
    const ont = sansCase.bureau > 1 ? "ont" : "a";
    phrases.push(
      `${sansCase.bureau} compte${pluriel} du bureau n'${ont} pas de case : seul un administrateur modifie un compte du bureau.`,
    );
  }
  // Volontairement en second : la ligne de l'acteur est une curiosité, celle qu'il ne peut pas
  // modifier est une limite de ses droits — et c'est elle qui explique un trou dans la liste.
  if (sansCase.soiMeme) phrases.push("Ton compte n'a pas de case : on n'agit pas sur son propre compte.");
  return phrases.length > 0 ? phrases.join(" ") : null;
}
