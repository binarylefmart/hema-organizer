import webpush from "web-push";
import { db } from "../db";
import { baseUrl } from "../env";
import { chiffrer, dechiffrer, estChiffre } from "../crypto";
import { CLES, getSetting, setSetting } from "../settings";

/**
 * **Notifications sur le téléphone** (Web Push).
 *
 * Le navigateur donne à l'application une adresse d'envoi (`endpoint`) et deux clés ; l'application
 * s'en sert pour déposer un message chiffré chez le service de push du navigateur (Firebase,
 * Mozilla, Apple), qui le remet à l'appareil, même application fermée. Le serveur du club ne parle
 * jamais au téléphone directement, et le service de push ne peut pas lire le message.
 *
 * **Les clés VAPID sont générées ici, à la première demande, et rangées chiffrées en base**
 * (`Setting`, comme le webhook Discord). C'est volontaire : aucune variable nouvelle à saisir dans
 * Portainer, rien à regénérer à la main, et la paire survit aux mises à jour de l'image puisqu'elle
 * vit dans le volume de données. Changer ces clés invaliderait tous les abonnements existants —
 * elles ne doivent donc être créées qu'une fois, ce que garantit le `Setting`.
 *
 * Deux limites à connaître, qui tiennent aux navigateurs et pas à ce code :
 * - **sur iPhone, l'application doit avoir été ajoutée à l'écran d'accueil** (iOS 16.4+) ; sans
 *   cela, `Notification` et `PushManager` n'existent même pas dans la page ;
 * - le service de push peut refuser un abonnement devenu caduc (404/410) : on l'efface alors, sans
 *   bruit. Un appareil réinstallé se réabonne tout seul à la prochaine visite.
 */

export type ChargePush = {
  /**
   * Titre affiché sur l'appareil. **Toujours renseigné, et c'est une règle, pas une commodité** : le
   * service worker (`public/sw.js`) est un fichier statique servi tel quel — il ne lit ni la base ni
   * les réglages, il ne peut donc pas connaître le nom du club. Son repli est volontairement neutre
   * (« Organizer ») ; le vrai nom n'arrive que par ici.
   */
  titre: string;
  corps: string;
  /** Où mène l'appui sur la notification (chemin absolu de l'application) */
  url: string;
  /** Regroupe les notifications d'un même sujet : la nouvelle remplace la précédente */
  tag?: string;
};

type ClesVapid = { publicKey: string; privateKey: string };

/** Adresse de contact exigée par le protocole : le service de push s'en sert pour joindre l'émetteur. */
function sujetVapid(): string {
  return baseUrl();
}

/**
 * La paire de clés du serveur, créée au premier besoin puis relue telle quelle.
 * Le stockage est chiffré : la clé privée signe les envois, elle n'a rien à faire en clair en base.
 */
export async function clesVapid(): Promise<ClesVapid> {
  const stocke = await getSetting(CLES.vapid);
  if (stocke) {
    const clair = dechiffrer(stocke);
    // `estChiffre` sépare « n'a jamais été un chiffré » (on remplace) de « chiffré illisible » (on garde).
    if (clair === null && estChiffre(stocke)) {
      /*
       * **Une paire illisible ne se remplace pas : on la garde et on le dit**.
       *
       * La clé de chiffrement est dérivée de `SESSION_SECRET` : s'il tourne, `dechiffrer` rend `null` et
       * l'ancien code tombait en sortie de bloc, engendrait une paire neuve et **écrasait l'unique copie**
       * de l'ancienne. Or la clé publique est celle avec laquelle **tous les téléphones du club se sont
       * abonnés** : une paire neuve les rend tous inertes, définitivement. Et rien ne le disait — un refus
       * de clé VAPID répond 403, or `envoyerPush` n'efface un abonnement que sur 404/410, donc les lignes
       * restaient en base et le canal « téléphone » continuait de s'afficher opérationnel.
       *
       * On lève plutôt que de rendre une paire : les appelants d'envoi journalisent déjà leurs échecs, et
       * l'écran du canal montrera une panne au lieu d'un succès silencieux. Remettre l'ancien
       * `SESSION_SECRET` rend la paire lisible et tout repart ; sinon il faut rechiffrer le réglage.
       */
      console.error("[push] paire de clés VAPID illisible — la clé de chiffrement du serveur a-t-elle changé ? Aucune paire neuve n'est engendrée : les abonnements existants en dépendent.");
      throw new Error("Clés VAPID illisibles : la clé de chiffrement du serveur a changé.");
    }
    try {
      const lues = JSON.parse(clair ?? "") as Partial<ClesVapid>;
      if (lues.publicKey && lues.privateKey) return { publicKey: lues.publicKey, privateKey: lues.privateKey };
    } catch {
      // Déchiffrée mais illisible comme JSON : là, la valeur est vraiment abîmée et aucun abonnement ne
      // peut en dépendre (elle n'a jamais pu servir). On en refait une paire.
    }
  }
  const neuves = webpush.generateVAPIDKeys();
  await setSetting(CLES.vapid, chiffrer(JSON.stringify(neuves)));
  return neuves;
}

/** La clé publique, seule valeur transmise au navigateur (elle ne permet que de s'abonner). */
export async function clePubliqueVapid(): Promise<string> {
  return (await clesVapid()).publicKey;
}

/**
 * Le canal est prêt dès que la paire de clés existe — et elle se crée toute seule. Contrairement au
 * SMTP ou au webhook Discord, il n'y a donc rien à configurer : ce qui manque, éventuellement, ce
 * sont des appareils abonnés, et cela se règle dans « Mon profil », pas dans l'administration.
 */
export async function pushConfigure(): Promise<boolean> {
  try {
    await clesVapid();
    return true;
  } catch (e) {
    console.error("[push] clés VAPID indisponibles", e);
    return false;
  }
}

/**
 * « Chrome sur Android », « Safari sur iPhone » — de quoi reconnaître son appareil dans la liste du
 * profil, et retirer le bon quand on en perd un. On ne garde que ces deux mots : l'en-tête complet
 * du navigateur est une empreinte, et il n'a rien à faire dans une liste affichée à l'écran.
 *
 * (Cette fonction vit ici, et non dans `src/actions/push.ts` : un fichier « use server » ne peut
 * exporter que des fonctions asynchrones — une fonction pure y casse le serveur entier au rendu.)
 */
export function nommerAppareil(ua: string): string {
  const navigateur = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const systeme = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return systeme ? `${navigateur} sur ${systeme}` : navigateur;
}

/** Les appareils d'une personne, prêts pour l'envoi. */
export async function abonnementsDe(userId: string) {
  return db.pushAbonnement.findMany({ where: { userId }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
}

type Abonnement = { id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Dépose une notification chez le service de push d'un appareil. Retourne `true` si elle est
 * partie. Un abonnement refusé définitivement (404 « inconnu », 410 « parti ») est **effacé** :
 * c'est la seule façon de nettoyer la liste, le navigateur ne prévient jamais.
 */
export async function envoyerPush(abonnement: Abonnement, charge: ChargePush): Promise<boolean> {
  try {
    const cles = await clesVapid();
    webpush.setVapidDetails(sujetVapid(), cles.publicKey, cles.privateKey);
    await webpush.sendNotification(
      { endpoint: abonnement.endpoint, keys: { p256dh: abonnement.p256dh, auth: abonnement.auth } },
      JSON.stringify(charge),
      { TTL: 12 * 60 * 60 },
    );
    await db.pushAbonnement.update({ where: { id: abonnement.id }, data: { derniereFois: new Date() } }).catch(() => null);
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) {
      await db.pushAbonnement.delete({ where: { id: abonnement.id } }).catch(() => null);
      return false;
    }
    console.error("[push] envoi impossible", code ?? e);
    return false;
  }
}

/**
 * Notifie **une liste de personnes** en une seule lecture de la table des appareils.
 *
 * C'est la forme à préférer dans les envois de masse : sur quarante invités dont cinq ont branché
 * leur téléphone, `notifierPersonne` appelé quarante fois coûterait quarante requêtes pour cinq
 * envois. Ici, une seule requête ramène les abonnements de tout le monde ; les personnes sans
 * appareil ne coûtent alors plus rien du tout.
 *
 * Retourne, par identifiant, le nombre d'appareils atteints (les absents valent 0).
 */
/**
 * **On rend le nombre d'appareils *inscrits* autant que le nombre d'appareils *atteints*.**
 *
 * Sans les deux, l'appelant ne peut pas distinguer les deux zéros — et il en a besoin : « cette
 * personne n'a branché aucun téléphone » n'appelle aucune reprise, « ses téléphones étaient là et
 * l'envoi a échoué » en appelle une. C'est ce qui manquait pour que le canal du téléphone tienne
 * l'invariant du dossier : **tout envoi libère sa clé en cas d'échec**. Voir `notifierParPush`.
 */
export async function notifierPersonnes(
  userIds: readonly string[],
  charge: (userId: string) => ChargePush,
): Promise<Map<string, { appareils: number; atteints: number }>> {
  const bilan = new Map<string, { appareils: number; atteints: number }>(userIds.map((id) => [id, { appareils: 0, atteints: 0 }]));
  if (userIds.length === 0) return bilan;
  const abonnements = await db.pushAbonnement.findMany({
    where: { userId: { in: [...new Set(userIds)] } },
    select: { id: true, endpoint: true, p256dh: true, auth: true, userId: true },
  });
  if (abonnements.length === 0) return bilan;
  for (const a of abonnements) {
    const ligne = bilan.get(a.userId) ?? { appareils: 0, atteints: 0 };
    ligne.appareils += 1;
    bilan.set(a.userId, ligne);
  }
  const resultats = await Promise.all(abonnements.map(async (a) => [a.userId, await envoyerPush(a, charge(a.userId))] as const));
  for (const [userId, envoye] of resultats) {
    if (!envoye) continue;
    const ligne = bilan.get(userId) ?? { appareils: 0, atteints: 0 };
    ligne.atteints += 1;
    bilan.set(userId, ligne);
  }
  return bilan;
}

/**
 * Notifie une personne sur **tous ses appareils**. Retourne le nombre d'appareils atteints (0 si
 * elle n'en a aucun : c'est le cas le plus courant, et ce n'est pas une erreur).
 */
export async function notifierPersonne(userId: string, charge: ChargePush): Promise<number> {
  const abonnements = await abonnementsDe(userId);
  if (abonnements.length === 0) return 0;
  const resultats = await Promise.all(abonnements.map((a) => envoyerPush(a, charge)));
  return resultats.filter(Boolean).length;
}
