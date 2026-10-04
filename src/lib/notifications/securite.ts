import { notifierParPush } from "./journal";
import type { ChargePush } from "./push";

/**
 * **Les messages de sécurité sur le téléphone** — le doublon des emails d'alerte, rien de plus.
 *
 * **La règle qui gouverne tout ce qui est écrit ici** : une notification s'affiche sur un téléphone
 * posé sur une table, écran verrouillé, sous les yeux de qui passe. Elle dit donc **qu'il s'est
 * passé quelque chose et où regarder** — jamais qui, jamais depuis où. Aucun nom de membre, aucune
 * adresse IP, aucun nom d'appareil, aucun jeton : le détail est à un appui dans l'application,
 * derrière la session. C'est la raison d'être de ce module — l'email peut raconter, la notification
 * ne fait que prévenir, et les deux textes ne doivent pas être écrits au même endroit sans y penser.
 *
 * **Ces messages restent hors de la matrice réglable** (`preferences.ts`) et **toujours envoyés** :
 * on ajoute ici un canal, pas un interrupteur. On n'appelle donc **jamais** `pushPossible()` ni
 * `destinataireRetenu()` depuis ce module — ce serait rendre refusable ce qui ne l'est pas. Le seul
 * interrupteur qui existe reste `alertesSecurite` (paramètres techniques), et il gouverne les deux
 * canaux ensemble, en amont, dans `src/lib/alertes.ts`.
 *
 * **Deux messages de sécurité n'ont volontairement pas de version téléphone, et ne doivent pas en
 * recevoir un jour « par symétrie »** :
 * - le **lien d'accès personnel** (invitation, renouvellement, remplacement) : il *est* un secret de
 *   connexion, et un secret n'a rien à faire sur un écran verrouillé — l'email reste le seul canal ;
 * - le **mot de passe oublié** : qui le demande est par définition dehors, et n'a donc aucun
 *   appareil abonné qui l'attende. Une notification n'irait nulle part.
 *
 * Tout le reste est l'infrastructure push habituelle : `notifierParPush` pose la clé de journal
 * **avant** l'envoi (idempotence), efface les abonnements périmés, et n'échoue jamais — ni l'email,
 * ni l'action en cours ne peuvent être retardés ou mis en échec par ce qui se passe ici.
 */

/** Types écrits dans `NotificationLog` — les mêmes que côté email. */
export const TYPE_ALERTE = "ALERTE";
export const TYPE_NOUVEL_APPAREIL = "NOUVEL_APPAREIL";

/**
 * Aucun `tag` sur ces charges, contrairement au récap ou à l'alerte d'effectif : deux incidents
 * distincts ne doivent pas s'effacer l'un l'autre sur l'écran. Un avis de sécurité qui disparaît
 * parce qu'un second est arrivé est précisément celui qu'on ne lira jamais.
 */
export function chargeAlerteSecuritePush(corps: string): ChargePush {
  return { titre: "Alerte de sécurité", corps, url: "/admin/audit" };
}

/** Le texte de l'appareil pour la personne concernée : ce qui est arrivé, et où le vérifier. */
export function chargeNouvelAppareilPush(): ChargePush {
  return {
    titre: "Nouvelle connexion à ton compte",
    corps: "Un nouvel appareil vient d'ouvrir ta session. Si ce n'est pas toi, préviens le bureau.",
    url: "/profil",
  };
}

/**
 * La même alerte que l'email, sur les téléphones des administrateurs. Les destinataires sont
 * **ceux de l'email** (comptes ADMIN actifs), passés par l'appelant pour qu'une seule requête serve
 * aux deux canaux ; un administrateur sans adresse email est ici un destinataire comme un autre,
 * puisque le téléphone, lui, n'a pas besoin d'adresse.
 *
 * La clé de journal est **distincte de celle de l'email** et posée par personne : les deux canaux se
 * décident, échouent et se rejouent séparément, et quelqu'un qui branche un appareil entre deux
 * incidents est prévenu du suivant.
 */
export async function alerterAdminsParPush(admins: readonly { id: string }[], dedupKey: string, corps: string): Promise<number> {
  return notifierParPush({
    type: TYPE_ALERTE,
    destinataires: admins,
    cle: (a) => `${dedupKey}_push_${a.id}`,
    charge: () => chargeAlerteSecuritePush(corps),
  });
}

/**
 * « Une session vient de s'ouvrir sur un appareil de plus », sur les **autres** appareils de la
 * personne. Il n'y a rien à exclure pour cela : l'appareil qui vient d'ouvrir le lien n'est pas
 * encore abonné (l'abonnement se demande depuis « Mon profil », après coup), donc la notification
 * part mécaniquement vers ceux d'avant. Et si la personne l'avait déjà abonné — application
 * réinstallée, lien rouvert —, se voir confirmer sa propre connexion ne fait aucun mal.
 */
export async function prevenirNouvelAppareilParPush(userId: string, dedupKey: string): Promise<number> {
  return notifierParPush({
    type: TYPE_NOUVEL_APPAREIL,
    destinataires: [{ id: userId }],
    cle: () => dedupKey,
    charge: () => chargeNouvelAppareilPush(),
  });
}
