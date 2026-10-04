import { db } from "@/lib/db";
import { envoiPossible } from "./canaux";
import type { TypeNotification } from "./preferences";
import { notifierPersonnes, type ChargePush } from "./push";

/**
 * Journal des notifications (table `NotificationLog`) et **idempotence**.
 *
 * Chaque envoi porte une `dedupKey` unique (colonne `@unique`) : tant qu'une ligne existe pour cette
 * clé, l'envoi n'est pas refait — même si le cron rejoue, si le serveur redémarre pendant la minute
 * d'envoi, ou si deux instances tournent en parallèle (la contrainte d'unicité tranche).
 *
 * Forme des clés (voir recap.ts / rappels.ts). `<créneau>` est l'empreinte du créneau de la séance
 * (`empreinteCreneau`, dans planification.ts) : `2026-10-08-1930`.
 * - `recap_discord_<sessionId>_<créneau>` — le message Discord de la veille ;
 * - `recap_email_<sessionId>_<créneau>_<userId>` — le récap individuel ;
 * - `recap_push_<sessionId>_<créneau>_<userId>` — le même récap sur le téléphone ;
 * - `rappel_j7_<sessionId>_<créneau>_<userId>` / `rappel_j2_…` — les rappels sans réponse.
 *
 * **Le créneau fait partie de la clé** au même titre que le canal : une séance *déplacée* garde son
 * identifiant, et une clé qui ne portait que lui empêchait à jamais l'annonce de la bonne date après
 * celle de la mauvaise. Corriger le thème ou le lieu, en revanche, ne renvoie rien.
 *
 * **Le canal fait partie de la clé** : un message parti par email et un message parti sur le
 * téléphone sont deux envois distincts, qui se décident, échouent et se rejouent séparément. Une
 * clé commune aurait fait taire l'un des deux au premier passage.
 *
 * Un échec est journalisé sous une clé distincte (suffixe `_echec_<horodatage>`) pour ne pas bloquer
 * la prochaine tentative.
 *
 * ────────────────────────── Les envois collectifs (« la liste ») ──────────────────────────
 *
 * Quand une notification est réglée sur « la liste » (voir `preferences.ts`), l'email part **une
 * fois**, sur l'adresse de distribution du club. Le journal doit dire cela, et rien de plus — donc :
 *
 * - **une** ligne pour la notification, pas une par personne : `recap_liste_<sessionId>_<créneau>`,
 *   `rappel_liste_j7_<sessionId>_<créneau>`, `annulation_liste_<sessionId>_<horodatage>`,
 *   `effectif_liste_<sessionId>`, `evenement_liste_<id>` ;
 * - **`userId: null`** : la ligne dit « envoyé à la liste », jamais « envoyé à Alix ». Écrire
 *   quarante-deux lignes, ou une ligne par personne présumée abonnée, ferait croire que chacun a été
 *   servi alors que l'application ne sait pas qui lit la liste — c'est le serveur mail du club qui
 *   la tient. Le seul fait constaté est : *un message a été remis au serveur d'envoi*. L'écran du
 *   canal Email affiche déjà « — » pour un envoi sans personne, il n'y a donc rien à inventer.
 *
 * **Pourquoi un espace de clés distinct, et non la clé individuelle sans son `userId`.** Un club qui
 * bascule d'un mode à l'autre entre deux passages a déjà des clés posées pour la même séance. Si les
 * deux modes avaient partagé le même espace, la bascule aurait été avalée en silence par la
 * déduplication : le message collectif n'aurait jamais remplacé les individuels déjà partis, et au
 * retour, la présence de la clé collective aurait fait taire les envois individuels. Deux espaces,
 * deux vérités — et le pire qui puisse arriver d'une bascule en plein milieu, c'est un message de
 * trop, jamais un cours annoncé à personne.
 *
 * Le reste ne bouge pas : la clé est posée **avant** l'envoi, un échec la libère (`marquerEchec`) et
 * le passage suivant réessaie. Le **push** garde sa journalisation par personne dans tous les
 * modes : il reste personnel, hors quota, et c'est ce qui permet à quelqu'un de rester joignable
 * individuellement même quand l'email passe par la liste.
 */
export type EntreeJournal = {
  type: string;
  canal: "EMAIL" | "PUSH" | "DISCORD" | "TELEGRAM" | "WHATSAPP";
  sessionId?: string | null;
  userId?: string | null;
  dedupKey: string;
  statut: "ENVOYE" | "ECHEC" | "IGNORE";
  erreur?: string | null;
};

/** Sous-ensemble des clés déjà journalisées (une seule requête, même pour des dizaines de membres). */
export async function clesDejaEnvoyees(cles: readonly string[]): Promise<Set<string>> {
  if (cles.length === 0) return new Set();
  const lignes = await db.notificationLog.findMany({ where: { dedupKey: { in: [...cles] } }, select: { dedupKey: true } });
  return new Set(lignes.map((l) => l.dedupKey));
}

/**
 * Écrit une ligne de journal. Retourne `false` si la clé existait déjà (course entre deux
 * exécutions) : l'appelant sait alors que l'envoi a déjà été pris en charge ailleurs.
 * Une panne du journal ne doit jamais faire tomber l'application.
 */
export async function journaliser(entree: EntreeJournal): Promise<boolean> {
  try {
    await db.notificationLog.create({
      data: {
        type: entree.type,
        canal: entree.canal,
        sessionId: entree.sessionId ?? null,
        userId: entree.userId ?? null,
        dedupKey: entree.dedupKey,
        statut: entree.statut,
        erreur: entree.erreur ?? null,
      },
    });
    return true;
  } catch (e) {
    // Clé déjà prise (P2002) : un autre passage a déjà envoyé. Toute autre erreur est journalisée en console.
    if (!(e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002")) {
      console.error("[notifications] journalisation impossible", e);
    }
    return false;
  }
}

/**
 * **Rétention du journal des notifications — 90 jours**.
 *
 * Cette table dit **qui a reçu quel message et quand**, nommément (`userId`) : rappels, décisions
 * d'atelier, invitations, réinitialisations, alertes de bureau. Elle n'avait **aucune échéance**,
 * alors que le journal d'audit en a une depuis toujours (réglable, plancher 30 jours, défaut 365,
 * appliquée par `purgerAudit` depuis `entretienQuotidien`). L'enjeu est la **minimisation des
 * données**, pas le volume : rien n'exige de savoir en 2029 qui a reçu le rappel d'un cours de 2026.
 *
 * **Pourquoi 90 jours, et pas « quelques semaines ».** La fenêtre doit couvrir la plus longue clé de
 * déduplication réellement en service, sans quoi la purge ferait *repartir* un message. Les clés se
 * lisent en deux familles :
 *
 * - celles qui portent une **date** — récap (J-1), rappels sans réponse (J-7 et J-2), alerte
 *   « peu de monde » (J-3 au jour même), période suivante (J-7/J-2), période non activée (J-3/J-1),
 *   annulation et décision d'atelier (horodatées). La plus large vaut sept jours avant l'événement
 *   annoncé : 90 jours, c'est douze fois la marge ;
 * - celles qui ne portent **que l'identifiant d'un événement** (`evenement_email_<id>_<userId>`,
 *   `evenement_telegram_<id>`, `evenement_discord_<id>`) et qu'aucun horodatage ne borne. Ce sont
 *   elles qui commandent le choix.
 *
 * Ce que 90 jours coûte, exactement : une annonce d'événement **dépubliée puis republiée plus de
 * trois mois plus tard** repart par email et sur Telegram. C'est déjà le comportement du **salon
 * Discord**, où dépublier libère la clé (`oublierAnnonce`, notifications/evenements.ts) précisément
 * pour qu'un retour soit annoncé à neuf — « réécrire l'ancien, enfoui dans l'historique du salon, ne
 * préviendrait personne ». Le pire cas est donc un message de trop après un trimestre, jamais un
 * cours annoncé à personne. Le lien de désinscription, lui, vaut un an, mais ce n'est pas une clé de
 * déduplication : il est signé, pas journalisé.
 *
 * Ce n'est **pas un réglage de club** : c'est un plancher livré, comme `SEUIL_PLANCHER`. Un réglage
 * de plus sur un écran ne se justifie que si quelqu'un a une raison de le changer.
 */
export const RETENTION_NOTIFICATIONS_JOURS = 90;

/**
 * Efface les lignes de journal plus vieilles que la rétention, et rend leur nombre.
 *
 * **Le journal des notifications ne survit jamais au journal d'audit** : la fenêtre effective est la
 * plus courte des deux. Un club qui ramène la conservation de l'audit à son plancher (30 jours) parce
 * qu'il veut garder peu de traces ne doit pas se retrouver avec, à côté, trois mois de « qui a reçu
 * quoi » — ce serait le journal le plus bavard des deux qui survivrait au plus encadré.
 */
export async function purgerNotifications(now = new Date(), retentionAuditJours?: number): Promise<number> {
  const jours = Math.min(RETENTION_NOTIFICATIONS_JOURS, retentionAuditJours ?? RETENTION_NOTIFICATIONS_JOURS);
  const res = await db.notificationLog.deleteMany({ where: { date: { lt: new Date(now.getTime() - jours * 86_400_000) } } });
  return res.count;
}

/** Clé d'échec : distincte de la clé nominale pour que la prochaine exécution réessaie. */
export function cleEchec(cle: string, now = new Date()): string {
  return `${cle}_echec_${now.getTime()}`;
}

/**
 * Bascule une ligne déjà écrite en échec : la clé nominale est libérée (elle devient une clé
 * d'échec horodatée), donc la prochaine exécution réessaiera l'envoi.
 */
export async function marquerEchec(cle: string, erreur: string, now = new Date()): Promise<void> {
  try {
    await db.notificationLog.update({ where: { dedupKey: cle }, data: { dedupKey: cleEchec(cle, now), statut: "ECHEC", erreur: erreur.slice(0, 500) } });
  } catch (e) {
    console.error("[notifications] échec non journalisé", e);
  }
}

/* ──────────────────────── Le même message, sur le téléphone ────────────────────────
 *
 * Le push **double** l'email : mêmes types de message, mêmes personnes, même décision
 * (`envoiPossible` côté club, puis `destinataireRetenu` personne par personne — quelqu'un peut
 * très bien vouloir le récap sur son téléphone et pas dans sa boîte, ou l'inverse).
 *
 * Ce qui change tient en trois points, et c'est pour cela que la mécanique est ici, à côté du
 * journal, plutôt que recopiée dans chacun des cinq modules d'envoi :
 *
 * 1. **une clé de journal à lui** (`<type>_push_…`), pour que les deux canaux se rejouent
 *    séparément ;
 * 2. **une journalisation par personne**, même pour les messages qui n'écrivent qu'une ligne côté
 *    email (annulation, effectif faible) : c'est ce qui permet de reprendre proprement quand
 *    quelqu'un abonne un appareil entre deux tentatives ;
 * 3. **rien ne doit jamais remonter** : un canal illisible, une base fatiguée ou un service de push
 *    en panne ne peuvent pas empêcher l'email de partir ni faire échouer l'action en cours.
 *
 * C'est le **point de passage unique** du canal : les abonnements de toute la liste sont chargés en
 * une requête (`notifierPersonnes`), et rien d'autre dans l'application n'a à connaître la mécanique.
 */

/**
 * Le canal push est-il ouvert pour ce type de message ? Même décision que pour l'email
 * (`envoiPossible`), mais **jamais d'exception** : le push est un bonus, il ne fait pas tomber
 * l'envoi principal.
 */
export async function pushPossible(type: TypeNotification): Promise<boolean> {
  try {
    return await envoiPossible(type, "push");
  } catch (e) {
    console.error("[notifications] état du canal push illisible", e);
    return false;
  }
}

export type EnvoiPush<T> = {
  /** Type écrit dans `NotificationLog` — le même que pour l'email (RECAP, RAPPEL, ANNULATION…) */
  type: string;
  /** Personnes déjà filtrées par `destinataireRetenu(prefs, type, "push", personne)` */
  destinataires: readonly T[];
  /** Clé de journal de cette personne, distincte de celle de l'email */
  cle: (personne: T) => string;
  /** Ce que l'appareil affichera : titre court, corps court, et le lien de l'écran utile */
  charge: (personne: T) => ChargePush;
  sessionId?: string | null;
};

/**
 * Notifie une liste de personnes sur leurs appareils, une seule fois chacune. Retourne le nombre de
 * personnes pour qui l'envoi a été tenté.
 *
 * La clé est posée **avant** l'envoi, exactement comme pour l'email : deux exécutions simultanées ne
 * peuvent pas doubler la notification. Une personne sans appareil abonné est journalisée quand même
 * (elle n'est simplement atteinte sur aucun appareil, ce n'est pas une erreur) — sinon chaque
 * passage du cron repartirait à sa recherche jusqu'à la fin des temps.
 */
export async function notifierParPush<T extends { id: string }>({ type, destinataires, cle, charge, sessionId = null }: EnvoiPush<T>): Promise<number> {
  if (destinataires.length === 0) return 0;
  try {
    // Une seule requête pour toute la liste, comme côté email.
    const deja = await clesDejaEnvoyees(destinataires.map(cle));
    // Qui reste à prévenir, journal posé **avant** l'envoi (une clé prise = un envoi pris en charge).
    const aPrevenir: T[] = [];
    for (const personne of destinataires) {
      const k = cle(personne);
      if (deja.has(k)) continue;
      if (!(await journaliser({ type, canal: "PUSH", sessionId, userId: personne.id, dedupKey: k, statut: "ENVOYE" }))) continue;
      aPrevenir.push(personne);
    }
    if (aPrevenir.length === 0) return 0;
    // Une seule lecture de la table des appareils pour toute la liste : les personnes qui n'ont
    // branché aucun téléphone — la majorité, au début — ne coûtent alors plus une requête chacune.
    // `notifierPersonnes` ne lève pas : un abonnement périmé est effacé, une panne est écrite au
    // journal du serveur.
    const parPersonne = new Map(aPrevenir.map((p) => [p.id, p] as const));
    const bilan = await notifierPersonnes([...parPersonne.keys()], (userId) => charge(parPersonne.get(userId)!));
    /*
     * **La clé se libère quand l'envoi a échoué** — l'autre moitié de l'invariant du dossier, qui
     * manquait au seul canal du téléphone.
     *
     * Le résultat de `notifierPersonnes` était jeté. La clé, posée avant l'envoi, restait donc
     * `ENVOYE` quoi qu'il arrive : une panne du service de push (FCM répond 503 quatre minutes, ça
     * arrive) et les bulles ne partaient **jamais**, pour aucun des huit types qui passent par ici.
     * Les repassages de 18 h 15 à 19 h 30, prévus exactement pour ça, voyaient les clés et ne faisaient
     * rien. L'espace admin, lui, affichait « envoyé ».
     *
     * On distingue les deux zéros, et c'est pour ça que `notifierPersonnes` rend maintenant les deux
     * nombres : **aucun appareil inscrit** n'est pas un échec (il n'y avait rien à envoyer, et la clé
     * doit rester prise pour ne pas réessayer indéfiniment) ; **des appareils inscrits et aucun
     * atteint** en est un, et la reprise a un sens.
     */
    let perdus = 0;
    for (const personne of aPrevenir) {
      const b = bilan.get(personne.id);
      if (!b || b.appareils === 0 || b.atteints > 0) continue;
      await marquerEchec(cle(personne), "aucun appareil atteint", new Date());
      perdus += 1;
    }
    return aPrevenir.length - perdus;
  } catch (e) {
    console.error(`[notifications] ${type} push : échec non bloquant`, e);
    return 0;
  }
}
