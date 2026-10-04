import { db } from "@/lib/db";
import {
  DESCRIPTIONS,
  NOTIFICATIONS_TOUJOURS_ENVOYEES,
  TYPES_REFUSABLES,
  getPreferencesNotifications,
  notificationActiveDans,
  preferencesPersonnellesDe,
  type TypeNotification,
} from "@/lib/notifications/preferences";

/** Les deux canaux qu'une personne règle elle-même. */
export type CanalLigne = "email" | "push";

/**
 * Une ligne de la carte « Mes notifications » : tout y est déjà traduit et décidé côté serveur —
 * l'écran n'a plus qu'à la dessiner. Ces types vivaient dans le composant, d'où ce module les
 * importait : la préparation dépendait de l'affichage, et non l'inverse.
 */
export type LigneNotification = {
  /** Clé technique du type — sert d'identifiant, jamais affichée */
  type: string;
  /** Intitulé en français courant (`DESCRIPTIONS[type].titre`) */
  titre: string;
  /** Qui reçoit quoi et quand (`DESCRIPTIONS[type].quand`) */
  quand: string;
  /** Choix personnel enregistré, canal par canal */
  choix: Record<CanalLigne, boolean>;
  /** Ce que le club envoie encore, canal par canal : une case coupée par le bureau disparaît */
  club: Record<CanalLigne, boolean>;
};

/** Ce qui part toujours, sans réglage possible : on le dit, on ne le propose pas. */
export type LigneObligatoire = { titre: string; quand: string };

/**
 * **Ce que le membre voit dans « Mes notifications »**, préparé côté serveur.
 *
 * La liste des messages et leurs phrases viennent de `src/lib/notifications/preferences.ts`
 * (`TYPES_REFUSABLES`, `DESCRIPTIONS`) : rien n'est recopié ici, un type ajouté là-bas apparaît tout
 * seul à l'écran. Le composant client ne reçoit que des lignes déjà rédigées — il n'importe ni la
 * base, ni les réglages du club, et ne connaît aucun nom technique de type.
 *
 * **Deux écrans, une seule source.** Ces mêmes lignes servent au bureau, sur la fiche d'un membre,
 * quand quelqu'un demande à être réglé plutôt que de le faire lui-même : la fonction ne suppose pas
 * que `user` est la personne connectée, elle prépare les lignes de **n'importe quel** compte à
 * partir de son seul identifiant. Les deux écrans affichent donc la même chose, dans le même ordre,
 * avec les mêmes phrases — et écrivent au même endroit.
 */

/** « Ne recevoir que l'essentiel » : le récap de la veille, et lui seul. */
export const TYPES_ESSENTIELS: readonly TypeNotification[] = ["recap_veille"];

/**
 * Les phrases de `DESCRIPTIONS` sont écrites pour le panneau du bureau, où l'heure du récap se règle
 * juste au-dessus. Sur « Mon profil », ce renvoi n'a pas de destinataire : on le dit autrement.
 */
function phrasePourLeMembre(quand: string): string {
  return quand.replace("à l'heure réglée ci-dessus", "à l'heure réglée par le club");
}

/**
 * Une ligne par type : libellé, phrase « qui reçoit quoi et quand », choix personnel enregistré, et
 * ce que le club envoie encore.
 *
 * Le choix personnel est relu par la bibliothèque (`preferencesPersonnellesDe`), la même fonction que
 * les envois : ce que l'écran montre est exactement ce que le serveur appliquera — y compris la
 * **reprise de l'existant**, où l'ancienne case « rappel la veille » (`User.rappelEmail`) sert de
 * valeur par défaut aux deux lignes de rappel tant que rien n'a été réglé finement.
 */
export async function lignesNotificationsMembre(user: { id: string }): Promise<{
  lignes: LigneNotification[];
  obligatoires: readonly LigneObligatoire[];
}> {
  const [compte, club] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { rappelEmail: true, preferencesNotifications: true } }),
    getPreferencesNotifications(),
  ]);
  const choix = preferencesPersonnellesDe(compte ?? {});
  const lignes = TYPES_REFUSABLES.map<LigneNotification>((type) => ({
    type,
    titre: DESCRIPTIONS[type].titre,
    quand: phrasePourLeMembre(DESCRIPTIONS[type].quand),
    // Le choix personnel se règle **canal par canal** : « le rappel sur le téléphone, mais plus
    // par email » est un réglage courant dès qu'il y a deux canaux.
    choix: { email: choix[type].email, push: choix[type].push },
    // Ce que le club envoie encore, canal par canal : un message coupé par le bureau n'est pas un
    // choix personnel — sa case disparaît, et la ligne entière est grisée si les deux sont coupés.
    club: { email: notificationActiveDans(club, type, "email"), push: notificationActiveDans(club, type, "push") },
  }));
  return { lignes, obligatoires: NOTIFICATIONS_TOUJOURS_ENVOYEES };
}
