/**
 * **Relancer un rendu que React a laissé en plan.**
 *
 * Le symptôme, en production seulement et au hasard : après « Ajouter le membre » ou « Enregistrer »,
 * la requête de l'action répond en 200 ms, réponse complète, geste fait en base — et le bouton reste
 * sur « Ajout… », la liste ne bouge plus, jusqu'à ce qu'on recharge la page.
 *
 * La cause est dans le React que Next 15.5 embarque (`next/dist/compiled/react-dom`, une préversion
 * 19.2 d'août 2025, la même jusqu'à Next 15.5.27). La réponse d'une action qui invalide la page
 * (`revalidatePath`) porte l'arbre de la page, **livré en flux** : React commence à le rendre avant
 * la fin, tombe sur un morceau pas encore arrivé et suspend la transition. Quand ce morceau arrive
 * **pendant** un rendu, `pingSuspendedRoot` ne relance rien et ne note pas non plus le signal ; la
 * racine reste suspendue alors que tout est arrivé, et la transition ne se termine jamais. Mesuré en
 * image de production, et corrigé à la source : `scripts/corriger-react-embarque.mjs` réécrit cette
 * ligne comme React 19.3 au `postinstall`. Le développement n'est pas touché (autre chemin de code,
 * autre rythme), une réponse livrée d'un bloc non plus : c'est une course.
 *
 * **Ce fichier est la ceinture**, en plus de cette correction : **n'importe quelle mise à jour
 * d'état débloque la transition**. À chaque mise à jour, React efface la liste des voies suspendues
 * de la racine (`markRootUpdated` remet `suspendedLanes` à zéro) et retente donc la transition —
 * dont tous les morceaux sont arrivés entre-temps.
 *
 * D'où deux relances, qui ne changent rien quand tout va bien (une relance de trop coûte le rendu
 * d'un composant qui ne dessine rien) :
 * - `RelanceRendu`, monté à la racine, relance après **chaque réponse** reçue du serveur — c'est le
 *   moment exact où le signal a pu se perdre ;
 * - `useAttenteSurveillee`, dans les boutons communs, relance **tant qu'une attente dure**, et
 *   finit par dire que le serveur ne répond pas : une requête qui ne se termine jamais (réseau
 *   coupé, connexion pendante) bloque aussi la file des actions du routeur, et seul un rechargement
 *   la débloque.
 *
 * Ce fichier ne garde que la logique pure, testée sans navigateur.
 */

/** Délais (ms) des relances après une réponse : tout de suite, puis le temps que le flux soit lu. */
export const RELANCES_APRES_REPONSE_MS = [0, 60, 200, 600, 1500] as const;

/** Délais (ms) des relances pendant une attente qui dure, comptés depuis son début. */
export const RELANCES_PENDANT_ATTENTE_MS = [400, 1000, 2000, 3500, 5000, 7500, 10_000, 14_000, 18_000, 22_000] as const;

/**
 * Au-delà, on dit que le serveur ne répond pas. Assez long pour qu'un envoi en masse (des emails
 * partent un à un) ne déclenche pas le message à tort, assez court pour qu'on ne reste pas devant
 * un bouton figé sans savoir quoi faire.
 */
export const DELAI_SANS_REPONSE_MS = 25_000;

export const MESSAGE_SANS_REPONSE =
  "Le serveur n'a pas répondu. Ton geste est peut-être déjà enregistré : recharge la page pour vérifier avant de recommencer.";

type Minuteur = {
  poser: (fn: () => void, ms: number) => unknown;
  retirer: (jeton: unknown) => void;
};

const minuteurNavigateur: Minuteur = {
  poser: (fn, ms) => setTimeout(fn, ms),
  retirer: (jeton) => clearTimeout(jeton as ReturnType<typeof setTimeout>),
};

/** Pose `fn` à chacun des délais ; renvoie de quoi tout annuler. */
export function planifier(delais: readonly number[], fn: () => void, minuteur: Minuteur = minuteurNavigateur): () => void {
  const jetons = delais.map((ms) => minuteur.poser(fn, ms));
  return () => {
    for (const j of jetons) minuteur.retirer(j);
  };
}

/**
 * Une ressource dont la fin mérite une relance : une requête `fetch` vers l'application elle-même
 * (action serveur, rafraîchissement, navigation). Pas les fichiers statiques ni les images, qui ne
 * portent aucun arbre React.
 */
export function reponseQuiPorteUnRendu(entree: { name: string; initiatorType: string }, origine: string): boolean {
  if (entree.initiatorType !== "fetch") return false;
  let url: URL;
  try {
    url = new URL(entree.name, origine);
  } catch {
    return false;
  }
  if (url.origin !== origine) return false;
  return !url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/_next/image");
}
