/**
 * **Prévenir avant de fermer l'onglet sur un réglage du planning qui n'est pas encore écrit.**
 *
 * La file d'envoi (`file-envoi.ts`) a supprimé le défaut principal — un réglage intermédiaire qui
 * partait pour rien pendant que le dernier attendait —, mais il reste une fenêtre irréductible :
 * entre le moment où l'on choisit un thème et celui où le serveur l'a écrit, il s'écoule un
 * aller-retour. Fermer l'onglet, recharger, ou quitter le site pendant ce temps-là perd le réglage,
 * et rien ne le dit : la personne repart en croyant avoir programmé son cours.
 *
 * Le navigateur sait poser cette question tout seul (`beforeunload`), à une condition : ne la poser
 * **que** lorsqu'il y a vraiment quelque chose à perdre. Une garde branchée en permanence fait
 * apparaître une boîte de dialogue à chaque fermeture, on apprend à cliquer « Quitter » sans lire,
 * et l'avertissement ne vaut plus rien le jour où il compte. D'où ce registre : les cases s'y
 * inscrivent tant qu'un réglage leur reste sur les bras, et la garde ne retient la fermeture que si
 * le registre n'est pas vide.
 *
 * **Ce que la garde ne couvre pas, et c'est voulu :** la navigation à l'intérieur de l'application
 * (le routeur de Next ne déclenche pas `beforeunload`). Changer de page ne coupe pas les envois en
 * cours — la transition React les laisse finir —, il n'y a donc rien à y retenir.
 *
 * Le texte de la question appartient au navigateur : aucun message personnalisé n'est affiché depuis
 * des années, tous rendent une formule générique. On ne cherche donc pas à en écrire un.
 */

/**
 * Les cases dont un réglage n'est pas encore acquis par le serveur, **par identifiant de partie**.
 *
 * L'identifiant, et non plus « séance + rang » : depuis que les parties sont libres, deux séances
 * n'ont plus les mêmes, et c'est la partie elle-même qui est réglée. Il désigne toujours **la case**
 * et non son rendu — la même partie montrée deux fois (planning et écran de séance) ne doit pas s'y
 * compter deux fois, sans quoi un démontage relâcherait la garde pendant que l'autre attend encore.
 */
const enAttente = new Set<string>();

/**
 * Déclare l'état d'une case : `true` tant qu'il lui reste un envoi en vol ou en attente, `false`
 * dès qu'elle est au repos (`auRepos`). Appelée à chaque mouvement de la file, y compris au
 * démontage de la case — une case qui disparaît de l'écran n'a plus rien à faire perdre.
 */
export function marquerEnAttente(cle: string, pasEncoreEcrit: boolean): void {
  if (pasEncoreEcrit) enAttente.add(cle);
  else enAttente.delete(cle);
}

/** Y a-t-il quelque chose à perdre en fermant maintenant ? */
export function doitPrevenir(): boolean {
  return enAttente.size > 0;
}

/** Combien de cases attendent encore leur écriture (diagnostic et tests). */
export function reglagesEnAttente(): number {
  return enAttente.size;
}

/** Repart d'un registre vide — pour les tests, et pour un planning qu'on quitte entièrement. */
export function oublierTout(): void {
  enAttente.clear();
}

/** Combien de cases ont demandé la garde : elle n'est branchée qu'une fois, pour toute la grille. */
let abonnes = 0;

const garde = (e: BeforeUnloadEvent): void => {
  if (!doitPrevenir()) return;
  e.preventDefault();
  // Les navigateurs anciens n'ouvrent la question que si `returnValue` est non vide ; la chaîne
  // elle-même n'est plus affichée nulle part.
  e.returnValue = "";
};

/**
 * Branche l'avertissement du navigateur tant qu'au moins une case du planning est à l'écran, et rend
 * de quoi le débrancher. Un seul écouteur pour toute la grille, quel que soit le nombre de cases —
 * une trentaine d'écouteurs identiques sur un trimestre complet ne rendrait pas la question plus
 * vraie. Sans `window` (rendu serveur, tests), la fonction ne fait rien et le dit en rendant une
 * fermeture vide.
 */
export function brancherGardeFermeture(): () => void {
  if (typeof window === "undefined") return () => {};
  if (abonnes === 0) window.addEventListener("beforeunload", garde);
  abonnes += 1;
  let relache = false;
  return () => {
    // React monte et démonte deux fois en mode strict : sans ce garde-fou, le compteur tomberait
    // sous zéro et l'écouteur partirait alors qu'il reste des cases à l'écran.
    if (relache) return;
    relache = true;
    abonnes -= 1;
    if (abonnes === 0) window.removeEventListener("beforeunload", garde);
  };
}
