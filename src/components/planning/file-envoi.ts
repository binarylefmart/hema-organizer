import type { Niveau } from "@/lib/constants";

/**
 * L'ordonnancement des enregistrements d'une case du planning, sans React ni réseau
 * (voir `CaseEditeur.tsx`).
 *
 * Elle vit dans un `.ts` à part pour la même raison que `liste-deroulante.ts` : les tests unitaires
 * du projet ne peuvent pas importer de `.tsx`, or c'est exactement ce qui mérite d'être vérifié sans
 * navigateur — trois réglages plus rapides que le serveur, et le dernier qui doit malgré tout faire
 * foi. Le composant, lui, ne garde que l'état React et l'appel à la server action.
 *
 * **La règle : un seul envoi en vol par case, et une seule place d'attente.**
 *
 * Chaque envoi porte le **contenu complet** de la case (instructeur, second instructeur, thème, description, niveau) : quand deux réglages
 * se suivent plus vite que l'aller-retour, le plus ancien n'a plus rien à dire — il décrit un état
 * que la personne a déjà quitté. On ne l'envoie donc pas : la place d'attente ne garde que le
 * **dernier** état voulu, et les intermédiaires sont oubliés. Trois clics rapides tiennent ainsi en
 * deux requêtes au lieu de trois, la seconde partant avec l'état final, jamais avec un état périmé.
 *
 * **Et le contenu déjà en place ne repart pas.** Un envoi qui décrit exactement ce que le serveur a
 * déjà confirmé est un aller-retour pour rien : le serveur répond « Rien à changer », mais la case
 * s'annonce alors « enregistrée » alors que personne n'a rien enregistré. C'est précisément ce qui
 * masquait le défaut corrigé ici (voir `CaseEditeur.tsx`) : on ne part plus dans le vide.
 */

/**
 * Le contenu réglable d'une case : c'est lui qui voyage vers le serveur, et lui seul.
 *
 * Le nom « paire » lui est resté de l'époque où la case ne portait que l'instructeur et le thème ;
 * le niveau, le second instructeur, puis la description s'y ajoutent sans rien changer à la règle —
 * c'est **l'état entier** de la case qui part à chaque geste, jamais le seul champ touché.
 */
export type Paire = { instructeurId: string; instructeurSecondId: string; theme: string; description: string; niveau: Niveau };

/**
 * **Les cinq champs sont comparés, et il le faut.** L'égalité sert à ne pas renvoyer au serveur ce
 * qu'il a déjà : oublier le second instructeur ici reviendrait à juger « identique » une case dont
 * on vient justement de changer le second — l'envoi ne partirait jamais, et rien à l'écran ne le
 * dirait (la case s'annonçant au repos). C'est le défaut que le niveau avait déjà failli introduire,
 * et la description est le cinquième champ à ne pas oublier.
 */
export const pairesEgales = (a: Paire, b: Paire) =>
  a.instructeurId === b.instructeurId &&
  a.instructeurSecondId === b.instructeurSecondId &&
  a.theme === b.theme &&
  a.description === b.description &&
  a.niveau === b.niveau;

/**
 * Un envoi en partance. Deux natures, parce que deux actions serveur écrivent la même case :
 * le réglage courant (`case`) et la programmation d'un atelier validé (`atelier`), qui remplace le
 * contenu de la case et n'a donc rien à coalescer.
 */
export type Envoi = { type: "case"; paire: Paire } | { type: "atelier"; atelierId: string };

export type FileEnvoi = {
  /** Ce que le serveur a confirmé la dernière fois — le point de comparaison, jamais ce qu'on a envoyé. */
  applique: Paire;
  /** L'envoi dont on attend la réponse, s'il y en a un. */
  enVol: Envoi | null;
  /** Le seul envoi en attente : toujours le plus récent voulu, les précédents sont oubliés. */
  enAttente: Envoi | null;
};

export const fileInitiale = (applique: Paire): FileEnvoi => ({ applique, enVol: null, enAttente: null });

/** La case est-elle au repos — rien en vol, rien en attente ? C'est le seul moment où elle peut se dire enregistrée. */
export const auRepos = (f: FileEnvoi) => f.enVol === null && f.enAttente === null;

/**
 * Un réglage de plus. Rend la file mise à jour et, le cas échéant, l'envoi **à faire partir tout de
 * suite** : `null` signifie soit « il attendra son tour », soit « il n'y a rien à écrire ».
 */
export function poser(f: FileEnvoi, envoi: Envoi): { file: FileEnvoi; partir: Envoi | null } {
  // Rien à écrire : le serveur a déjà exactement ce couple, et aucune écriture n'est en cours pour l'en éloigner
  if (envoi.type === "case" && auRepos(f) && pairesEgales(envoi.paire, f.applique)) return { file: f, partir: null };
  if (f.enVol) return { file: { ...f, enAttente: envoi }, partir: null };
  return { file: { ...f, enVol: envoi }, partir: envoi };
}

/**
 * La réponse de l'envoi en vol est arrivée. Rend la file mise à jour et l'envoi suivant s'il y en a
 * un — ou `null` si la case est au repos (`auRepos`), c'est-à-dire si elle peut enfin se taire.
 *
 * Un échec ne fait pas avancer `applique` : le couple refusé reste donc différent de ce que le
 * serveur est censé avoir, et **le même réglage peut repartir** — sans quoi une reprise après
 * coupure serait écartée comme un envoi inutile.
 */
export function retour(f: FileEnvoi, succes: boolean): { file: FileEnvoi; partir: Envoi | null } {
  const applique = succes && f.enVol?.type === "case" ? f.enVol.paire : f.applique;
  const attendu = f.enAttente;
  // L'attente est devenue inutile : elle décrit ce que le serveur vient de confirmer
  const suivant = attendu && attendu.type === "case" && pairesEgales(attendu.paire, applique) ? null : attendu;
  return { file: { applique, enVol: suivant, enAttente: null }, partir: suivant };
}

/**
 * La case suit le serveur : il dit autre chose qu'elle (atelier programmé ailleurs, changement fait
 * par quelqu'un d'autre, enregistrement refusé). Le couple confirmé devient le sien.
 */
export const suivreServeur = (f: FileEnvoi, applique: Paire): FileEnvoi => ({ ...f, applique });
