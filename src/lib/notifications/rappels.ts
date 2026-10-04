import { formatDateCourte, formatHeure, todayIso } from "@/lib/dates";
import { baseUrl } from "@/lib/env";
import { enqueueEmail } from "@/lib/email/mailer";
import { enqueueEmailListe, messageCollectif } from "@/lib/email/liste";
import { emailRappelListe, emailRappelSansReponse } from "@/lib/email/templates/recap";
import { urlDesinscription } from "./desinscription";
import { clesDejaEnvoyees, journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import type { ChargePush } from "./push";
import { seancesAvecInvites, type MembreSeance, type SeanceAvecInvites } from "./invites";
import { datesJalons, empreinteCreneau, jalonPour, type Jalon, type SeanceCle } from "./planification";
import { envoiPossible } from "./canaux";
import { adresseListePour, destinataireRetenu, envoiCollectifDans, getPreferencesNotifications, type PreferencesNotifications } from "./preferences";
import { identite } from "@/lib/identite";

/**
 * **Rappels aux personnes sans réponse** : une semaine (J-7) puis deux jours (J-2) avant chaque
 * séance, les invités de la période qui n'ont pas encore répondu reçoivent un email individuel avec
 * le contenu commun et un bouton pour répondre en un appui — et, sur leurs appareils, la même
 * question en une ligne.
 *
 * Une seule fois par séance, **par créneau, par jalon et par canal** : la `dedupKey` porte les quatre
 * (`rappel_j7_<sessionId>_<créneau>_<userId>` pour l'email, `rappel_push_j7_…` pour le téléphone),
 * donc un rejeu du cron ne renvoie rien, le rappel J-2 part bien même si le J-7 est déjà parti, un
 * canal n'éteint jamais l'autre, et un cours **déplacé** est réannoncé à sa nouvelle date. Les
 * réglages (canal, notification, choix personnel — canal par canal) sont consultés avant tout envoi.
 */
export const TYPE_RAPPEL = "RAPPEL";

/**
 * **La clé porte le créneau** (`empreinteCreneau`), et pas seulement la séance et le jalon.
 *
 * Un cours **déplacé** garde son identifiant : sans le créneau, le rappel déjà parti pour l'ancienne
 * date (« cours dans une semaine ») interdisait celui de la nouvelle, au même jalon. Le rejeu du cron
 * sur un cours inchangé, lui, retombe sur exactement la même clé et ne renvoie toujours rien.
 */
export function cleRappel(s: SeanceCle, userId: string, jalon: Jalon): string {
  return `rappel_j${jalon}_${s.id}_${empreinteCreneau(s.seance)}_${userId}`;
}

/**
 * **La clé d'un rappel envoyé à la liste** : le jalon et le créneau, mais **aucun identifiant de
 * personne** — un message, une ligne de journal. Espace de clés distinct de `rappel_j7_…` pour que
 * la bascule d'un mode à l'autre ne soit jamais avalée par la déduplication (voir `journal.ts`).
 */
export function cleRappelListe(s: SeanceCle, jalon: Jalon): string {
  return `rappel_liste_j${jalon}_${s.id}_${empreinteCreneau(s.seance)}`;
}

export function cleRappelPush(s: SeanceCle, userId: string, jalon: Jalon): string {
  return `rappel_push_j${jalon}_${s.id}_${empreinteCreneau(s.seance)}_${userId}`;
}

/** Un invité à qui un rappel peut vraiment partir : son adresse email est renseignée. */
export type DestinataireRappel = MembreSeance & { email: string };

/**
 * Destinataires d'un rappel : les invités **sans réponse**, compte actif, rappels non coupés et
 * **adresse email renseignée** (fonction pure). Une personne sans adresse est écartée en silence.
 */
export function destinatairesRappel(prefs: PreferencesNotifications, membres: readonly MembreSeance[]): DestinataireRappel[] {
  return membres.filter((m): m is DestinataireRappel => m.statut === null && destinataireRetenu(prefs, "rappel_sans_reponse", "email", m) && m.email !== null);
}

/**
 * Destinataires du rappel **sur le téléphone** : les mêmes invités sans réponse, jugés sur le canal
 * `push` (fonction pure). L'adresse email n'entre pas en jeu ici : un appareil abonné suffit.
 */
export function destinatairesRappelPush(prefs: PreferencesNotifications, membres: readonly MembreSeance[]): MembreSeance[] {
  return membres.filter((m) => m.statut === null && destinataireRetenu(prefs, "rappel_sans_reponse", "push", m));
}

/**
 * La notification affichée sur l'appareil : le titre dit l'échéance, le corps rappelle quand et où,
 * et l'appui ouvre l'onglet Présences pour répondre en un geste.
 */
export function chargeRappelPush(s: SeanceAvecInvites, jalon: Jalon): ChargePush {
  return {
    titre: jalon === 7 ? "Cours dans une semaine" : "Cours dans deux jours",
    corps: `${formatDateCourte(s.seance.date)} à ${formatHeure(s.seance.heureDebut)}, ${s.seance.lieu} — tu viens ?`,
    url: "/seances",
    tag: `rappel-${s.id}`,
  };
}

export type BilanRappels = { seances: number; emails: number };

/** Rappels du jour : séances à J-7 et à J-2. Retourne ce qui est réellement parti. */
export async function envoyerRappelsSansReponse(now = new Date()): Promise<BilanRappels> {
  const bilan: BilanRappels = { seances: 0, emails: 0 };
  /*
   * `envoiPossible` et non `notificationActive` : le premier vérifie **aussi** que le canal est
   * réellement branché. Sans ce contrôle, un serveur sans SMTP journalisait les rappels comme
   * partis alors que rien ne pouvait sortir — et l'idempotence les empêchait ensuite de repartir le
   * jour où l'envoi était réparé.
   */
  const [parEmail, parPush] = await Promise.all([envoiPossible("rappel_sans_reponse", "email"), pushPossible("rappel_sans_reponse")]);
  if (!parEmail && !parPush) return bilan;
  const aujourdHui = todayIso(now);
  const seances = await seancesAvecInvites(datesJalons(aujourdHui));
  bilan.seances = seances.length;
  if (seances.length === 0) return bilan;
  const prefs = await getPreferencesNotifications();
  for (const s of seances) {
    const jalon = jalonPour(s.seance.date, aujourdHui);
    if (jalon === null) continue; // ceinture et bretelles : la requête ne ramène que J-7 et J-2
    if (parEmail) {
      bilan.emails += envoiCollectifDans(prefs, "rappel_sans_reponse") ? await envoyerRappelListe(s, jalon, prefs) : await envoyerRappelsSeance(s, jalon, prefs, now);
    }
    // Le push ne peut ni retarder ni faire échouer les emails : `notifierParPush` avale tout.
    if (parPush) await envoyerRappelsPush(s, jalon, prefs);
  }
  return bilan;
}

/**
 * **Le rappel, en un seul message sur la liste — et il change de propos.**
 *
 * « Tu n'as pas encore répondu » ne veut rien dire adressé à tout le monde. Le message devient un
 * **compteur** : « 12 personnes n'ont pas encore répondu pour mardi », sans nommer personne (voir
 * `emailRappelListe`). Publier les noms des retardataires sur une adresse que tout le club lit
 * serait une mise au pilori ; ces noms restent dans l'application, pour ceux qui encadrent.
 *
 * **Personne ne manque à l'appel ⇒ rien ne part**, et la clé n'est pas consommée : un rappel qui
 * annonce « 0 réponse manquante » ne rappelle rien, et il aurait coûté un envoi pour le dire.
 *
 * Le compteur porte sur **tous** les invités actifs sans réponse, pas seulement sur ceux que
 * `destinataireRetenu` aurait gardés : c'est un chiffre sur l'état du cours, pas sur une liste de
 * destinataires. Quelqu'un qui a coupé ses rappels compte quand même comme une réponse manquante.
 */
async function envoyerRappelListe(s: SeanceAvecInvites, jalon: Jalon, prefs: PreferencesNotifications): Promise<number> {
  const adresse = adresseListePour(prefs, "rappel_sans_reponse");
  if (adresse === null) return 0;
  const sansReponse = s.membres.filter((m) => m.statut === null && m.actif !== false).length;
  if (sansReponse === 0) return 0;
  const cle = cleRappelListe(s, jalon);
  const club = await identite();
  // Le message d'abord, la clé ensuite : `messageCollectif` lève, et une clé posée avant la levée
  // éteindrait le rappel pour toujours (voir `envoyerRecapListe`, qui l'explique en détail).
  const message = messageCollectif(emailRappelListe({ seance: s.seance, chiffres: s.chiffres, jours: jalon, sansReponse, nomApp: club.nomCourt }));
  if (!(await journaliser({ type: TYPE_RAPPEL, canal: "EMAIL", sessionId: s.id, userId: null, dedupKey: cle, statut: "ENVOYE" }))) return 0;
  enqueueEmailListe(adresse, message, cle, (err) => {
    if (err) void marquerEchec(cle, err.message);
  });
  return 1;
}

/** Une notification par invité sans réponse retenu sur ce canal, une seule fois par jalon. */
async function envoyerRappelsPush(s: SeanceAvecInvites, jalon: Jalon, prefs: PreferencesNotifications): Promise<number> {
  return notifierParPush({
    type: TYPE_RAPPEL,
    sessionId: s.id,
    destinataires: destinatairesRappelPush(prefs, s.membres),
    cle: (m) => cleRappelPush(s, m.id, jalon),
    charge: () => chargeRappelPush(s, jalon),
  });
}

async function envoyerRappelsSeance(s: SeanceAvecInvites, jalon: Jalon, prefs: PreferencesNotifications, now: Date): Promise<number> {
  const destinataires = destinatairesRappel(prefs, s.membres);
  if (destinataires.length === 0) return 0;
  const deja = await clesDejaEnvoyees(destinataires.map((m) => cleRappel(s, m.id, jalon)));
  let envoyes = 0;
  for (const m of destinataires) {
    const cle = cleRappel(s, m.id, jalon);
    if (deja.has(cle)) continue;
    if (!(await journaliser({ type: TYPE_RAPPEL, canal: "EMAIL", sessionId: s.id, userId: m.id, dedupKey: cle, statut: "ENVOYE" }))) continue;
    const { sujet, contenu } = emailRappelSansReponse({
      prenom: m.prenom,
      seance: s.seance,
      chiffres: s.chiffres,
      jours: jalon,
      urlApp: `${baseUrl()}/seances`,
      urlDesinscription: urlDesinscription(m.id, now),
    });
    enqueueEmail({ to: m.email, sujet, contenu, ref: cle }, (err) => {
      if (err) void marquerEchec(cle, err.message);
    });
    envoyes++;
  }
  return envoyes;
}
