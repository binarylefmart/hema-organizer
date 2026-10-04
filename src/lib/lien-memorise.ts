/**
 * **Le lien personnel gardé sur l'appareil**, pour que se reconnecter ne coûte qu'un bouton.
 *
 * Depuis une session dure 12 h. C'est court, et c'est voulu : sur un téléphone perdu ou prêté, deux
 * mois d'accès ouvert n'étaient pas raisonnables. Mais douze heures ne serait qu'une punition s'il
 * fallait retourner chercher son email chaque matin — surtout dans l'application installée sur
 * iPhone, qui ne partage pas le stockage de Safari et n'a même pas de barre d'adresse où recoller
 * quoi que ce soit.
 *
 * D'où cette mémoire : le lien collé une fois reste sur **cet appareil-là**, et l'écran de
 * connexion le propose d'un seul geste.
 *
 * **Ce que ça vaut, dit franchement.** Un lien personnel est une clé : qui l'a, entre. Le garder
 * ici, c'est le poser dans le stockage du navigateur, là où il survit à la fermeture de
 * l'application. Trois choses rendent ce choix tenable :
 *  - il y est **déjà**, en pratique — dans la boîte mail ouverte sur le même téléphone ;
 *  - le stockage est **cloisonné par origine** : seule l'application peut le relire, aucun autre
 *     site ;
 *  - il ne s'affiche jamais en entier : l'écran en montre la fin, grisée, le temps de reconnaître
 *     « c'est bien le mien » — pas assez pour le recopier par-dessus l'épaule.
 *
 * Ce que ça ne protège pas : un téléphone déverrouillé entre les mains de quelqu'un d'autre. Mais
 * ce téléphone-là a aussi la boîte mail, où le même lien dort déjà.
 *
 * **Fermer l'application n'est pas s'en aller**, et c'est toute la distinction : quitter l'app,
 * éteindre son téléphone, revenir le lendemain — le lien est toujours là, un bouton suffit. C'est
 * ce qui rend une session de 12 h supportable. En revanche, appuyer sur « Se déconnecter » est un
 * geste délibéré : on quitte cet appareil, on n'y laisse pas sa clé, et la mémoire est effacée.
 *
 * Elle l'est aussi quand le lien ne vaut plus rien : un lien refusé est oublié à l'essai suivant,
 * et « Modifier » le remplace.
 */

/** Une seule clé, un seul appareil : on ne mémorise jamais deux liens à la fois. */
const CLE = "hema_lien_memorise";

/**
 * Toute lecture et toute écriture passe par un `try/catch` : en navigation privée, avec les
 * données de site bloquées, ou dans un aperçu, `localStorage` **lève** au lieu de rendre `null`.
 * L'écran doit continuer de fonctionner sans mémoire — il propose alors simplement de coller.
 */
export function lireLienMemorise(): string | null {
  try {
    const v = window.localStorage.getItem(CLE);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function memoriserLien(lien: string): void {
  try {
    window.localStorage.setItem(CLE, lien.trim());
  } catch {
    // Pas de mémoire disponible : on n'a rien à dire à la personne, son lien a quand même servi.
  }
}

export function oublierLienMemorise(): void {
  try {
    window.localStorage.removeItem(CLE);
  } catch {
    // Rien à faire : il n'y avait rien à oublier.
  }
}

/**
 * Ce qu'on affiche d'un lien mémorisé : sa fin, précédée de points de suspension.
 *
 * Assez pour reconnaître le sien d'un coup d'œil — c'est la seule question que se pose la personne
 * devant l'écran —, pas assez pour que quelqu'un le recopie en regardant par-dessus l'épaule. Le
 * début, lui, n'apprend rien : c'est l'adresse du site, la même pour tout le monde.
 */
export function apercuLien(lien: string, visible = 8): string {
  const nu = lien.trim();
  if (nu.length <= visible) return nu;
  return `…${nu.slice(-visible)}`;
}
