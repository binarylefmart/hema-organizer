import { formatHeure, todayIso } from "@/lib/dates";
import { baseUrl } from "@/lib/env";
import { identite } from "@/lib/identite";
import { enqueueEmail } from "@/lib/email/mailer";
import { enqueueEmailListe, messageCollectif } from "@/lib/email/liste";
import { emailRecapVeille, emailRecapVeilleListe } from "@/lib/email/templates/recap";
import { envoiPossible } from "./canaux";
import { embedSeance, themeSeance } from "./contenu";
import { urlDesinscription } from "./desinscription";
import { clesDejaEnvoyees, journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import type { ChargePush } from "./push";
import { seancesAvecInvites, type MembreSeance, type SeanceAvecInvites } from "./invites";
import { dateRecap, empreinteCreneau, type SeanceCle } from "./planification";
import { publierSurSalon, publierSurTelegram } from "./salon";
import { adresseListePour, destinataireRetenu, envoiCollectifDans, getPreferencesNotifications, type PreferencesNotifications } from "./preferences";

/**
 * **Récap de la veille** (cahier des charges § Notifications) : chaque jour à l'heure réglée
 * (Gestion → Réglages, défaut 18:00 — `src/lib/taches.ts` déclenche), pour chaque séance du
 * lendemain non annulée :
 *
 * - un **email individuel** à chaque membre inscrit Présent ou Peut-être (un envoi par personne,
 *   jamais de destinataires visibles entre eux), avec le contenu commun, le rappel de sa propre
 *   réponse, les boutons « Je viens » / « Je ne viens plus » et le lien de désinscription en pied ;
 * - la **même chose sur le téléphone** (Web Push), aux mêmes personnes — mais chacune décide canal
 *   par canal : refuser le récap par email ne le refuse pas sur le téléphone, et réciproquement.
 *   Une personne sans adresse email peut donc n'être prévenue que par là ;
 * - un **message Discord** (embed aux couleurs de la charte) sur le salon dédié au récap, à défaut sur le
 *   salon principal du club. Il porte, en plus du contenu commun, la répartition des réponses,
 *   l'effectif attendu, le palier de remplissage et le programme — voir `contenu.ts`.
 *
 * Rien ne part sans l'accord des réglages (`notificationActive` puis `destinataireRetenu`, qui
 * respecte la case « Recevoir le rappel par email la veille » du profil), et rien ne part deux fois
 * (`NotificationLog.dedupKey`, voir `journal.ts`).
 *
 * **Deux façons de partir par email.** Si le club a réglé le récap sur « la liste »
 * (`modeEnvoiDans`, dans preferences.ts), l'email individuel cède la place à **un** message sur
 * l'adresse de distribution du club : voir {@link cleRecapListe} et `envoyerRecapListe` plus bas.
 * Le téléphone et les salons, eux, ne changent en rien.
 */
export const TYPE_RECAP = "RECAP";

/**
 * **Les clés portent le créneau, pas seulement la séance** (`empreinteCreneau`).
 *
 * Une séance déplacée — l'équipe corrige la date d'un cours plutôt que de l'annuler et d'en créer un
 * autre — garde son identifiant. Tant que la clé ne portait que lui, le récap déjà parti pour
 * l'ancienne date interdisait celui de la nouvelle : les membres avaient été convoqués le mauvais
 * jour, et ne l'étaient jamais du bon. Le cas normal, lui, ne bouge pas : même séance, même créneau,
 * même clé, aucun doublon.
 */
export function cleRecapEmail(s: SeanceCle, userId: string): string {
  return `recap_email_${s.id}_${empreinteCreneau(s.seance)}_${userId}`;
}

export function cleRecapDiscord(s: SeanceCle): string {
  return `recap_discord_${s.id}_${empreinteCreneau(s.seance)}`;
}

/**
 * **La clé d'un récap envoyé à la liste** : elle ne porte **aucun identifiant de personne**, parce
 * qu'il n'y a qu'un message — une ligne de journal pour la notification, pas quarante-deux.
 *
 * Elle vit dans un **espace de clés distinct** de `recap_email_…` (voir `journal.ts`), et c'est
 * délibéré : un club qui bascule « chacun le sien » → « la liste » entre deux passages a déjà
 * quarante-deux clés individuelles posées pour cette séance. Si le message collectif avait réutilisé
 * l'une d'elles, la bascule aurait été avalée en silence ; et dans l'autre sens, la présence de la
 * clé collective aurait fait taire les envois individuels. Deux espaces, deux vérités.
 */
export function cleRecapListe(s: SeanceCle): string {
  return `recap_liste_${s.id}_${empreinteCreneau(s.seance)}`;
}

/** Clé du récap sur le téléphone : distincte de celle de l'email, les deux canaux sont indépendants. */
export function cleRecapPush(s: SeanceCle, userId: string): string {
  return `recap_push_${s.id}_${empreinteCreneau(s.seance)}_${userId}`;
}

/**
 * Lien des boutons de réponse : il mène à **l'onglet Présences** (connexion requise), le seul écran
 * qui porte les trois boutons — l'accueil, lui, est un compte rendu en lecture seule. `/seances`
 * applique la réponse décrite par les paramètres, puis nettoie l'URL.
 */
export function urlReponse(sessionId: string, statut: "PRESENT" | "ABSENT"): string {
  return `${baseUrl()}/seances?seance=${sessionId}&reponse=${statut === "PRESENT" ? "present" : "absent"}`;
}

export type DestinataireRecap = MembreSeance & { statut: "PRESENT" | "PEUT_ETRE"; email: string };

/**
 * Destinataires du récap : **uniquement** les membres inscrits Présent ou Peut-être, compte actif,
 * **accès actif** (`accesActif`, src/lib/acces-actif.ts), case « rappel » cochée, canal et notification actifs, et **adresse email renseignée**
 * (fonction pure, testée unitairement). Une personne sans adresse est écartée en silence : elle reste
 * inscrite à la séance et comptée dans le taux, elle ne reçoit simplement pas le message.
 */
export function destinatairesRecap(prefs: PreferencesNotifications, membres: readonly MembreSeance[]): DestinataireRecap[] {
  return membres.filter(
    (m): m is DestinataireRecap => (m.statut === "PRESENT" || m.statut === "PEUT_ETRE") && m.accesActif && destinataireRetenu(prefs, "recap_veille", "email", m) && m.email !== null,
  );
}

/**
 * Destinataires du récap **sur le téléphone** : les mêmes inscrits Présent ou Peut-être, mais jugés
 * sur le canal `push` (fonction pure), avec la même exigence d'accès actif. Pas de condition d'adresse email : c'est justement l'intérêt
 * du canal — un appareil abonné suffit à être prévenu.
 */
export function destinatairesRecapPush(prefs: PreferencesNotifications, membres: readonly MembreSeance[]): MembreSeance[] {
  return membres.filter((m) => (m.statut === "PRESENT" || m.statut === "PEUT_ETRE") && m.accesActif && destinataireRetenu(prefs, "recap_veille", "push", m));
}

/**
 * La notification affichée sur l'appareil : titre court et sans emoji (le système en ajoute déjà
 * une icône), corps d'une ligne, et l'appui mène à l'onglet Présences — le seul écran qui porte les
 * trois boutons. Le `tag` regroupe le récap d'une séance : deux passages n'empilent pas deux bulles.
 */
export function chargeRecapPush(s: SeanceAvecInvites, statut: string | null): ChargePush {
  const theme = themeSeance(s.seance);
  const inscription = statut === "PRESENT" ? "Tu es inscrit(e) : Présent" : "Tu es inscrit(e) : Peut-être";
  return {
    titre: `Cours demain à ${formatHeure(s.seance.heureDebut)}`,
    corps: [s.seance.lieu, theme, inscription].filter(Boolean).join(" · "),
    url: "/seances",
    tag: `recap-${s.id}`,
  };
}

/** Clé de déduplication du récap sur Telegram : propre au canal (voir `publierSurTelegram`). */
function cleRecapTelegram(s: SeanceCle): string {
  return `recap_telegram_${s.id}_${empreinteCreneau(s.seance)}`;
}

/**
 * `emails` compte les **messages réellement expédiés**, pas les personnes servies : en mode liste,
 * un récap vaut 1, quel que soit le nombre d'abonnés. C'est la bonne unité — c'est celle du quota du
 * serveur SMTP, et c'est aussi la seule honnête : l'application ne sait pas qui lit la liste.
 */
export type BilanRecap = { seances: number; emails: number; discord: number; telegram: number };

/** Récap de la veille pour toutes les séances de demain. Retourne ce qui est réellement parti. */
export async function envoyerRecapVeille(now = new Date()): Promise<BilanRecap> {
  const [parEmail, parPush, parDiscord, parTelegram] = await Promise.all([
    envoiPossible("recap_veille", "email"),
    pushPossible("recap_veille"),
    envoiPossible("recap_veille", "discord"),
    envoiPossible("recap_veille", "telegram"),
  ]);
  const bilan: BilanRecap = { seances: 0, emails: 0, discord: 0, telegram: 0 };
  if (!parEmail && !parPush && !parDiscord && !parTelegram) return bilan;
  const seances = await seancesAvecInvites([dateRecap(todayIso(now))], now);
  bilan.seances = seances.length;
  if (seances.length === 0) return bilan;
  const prefs = await getPreferencesNotifications();
  for (const s of seances) {
    // « La liste » : **un** message au lieu de N. Le téléphone, lui, ne change pas (voir plus bas).
    if (parEmail) bilan.emails += envoiCollectifDans(prefs, "recap_veille") ? await envoyerRecapListe(s, prefs) : await envoyerRecapEmails(s, prefs, now);
    // Le push passe après l'email et ne peut pas l'empêcher : `notifierParPush` avale tout.
    if (parPush) await envoyerRecapPush(s, prefs);
    if (parDiscord && (await envoyerRecapDiscord(s, now))) bilan.discord++;
    if (parTelegram && (await envoyerRecapTelegram(s, now))) bilan.telegram++;
  }
  return bilan;
}

/** Un email par destinataire retenu, jamais deux fois le même (séance × membre). */
async function envoyerRecapEmails(s: SeanceAvecInvites, prefs: PreferencesNotifications, now: Date): Promise<number> {
  const destinataires = destinatairesRecap(prefs, s.membres);
  if (destinataires.length === 0) return 0;
  const deja = await clesDejaEnvoyees(destinataires.map((m) => cleRecapEmail(s, m.id)));
  let envoyes = 0;
  for (const m of destinataires) {
    const cle = cleRecapEmail(s, m.id);
    if (deja.has(cle)) continue;
    // La clé est posée AVANT l'envoi : deux exécutions simultanées ne peuvent pas doubler l'email.
    if (!(await journaliser({ type: TYPE_RECAP, canal: "EMAIL", sessionId: s.id, userId: m.id, dedupKey: cle, statut: "ENVOYE" }))) continue;
    const { sujet, contenu } = emailRecapVeille({
      prenom: m.prenom,
      seance: s.seance,
      chiffres: s.chiffres,
      statut: m.statut,
      urlPresent: urlReponse(s.id, "PRESENT"),
      urlAbsent: urlReponse(s.id, "ABSENT"),
      urlDesinscription: urlDesinscription(m.id, now),
    });
    enqueueEmail({ to: m.email, sujet, contenu, ref: cle }, (err) => {
      if (err) void marquerEchec(cle, err.message);
    });
    envoyes++;
  }
  return envoyes;
}

/**
 * **Le récap en un seul message**, sur l'adresse de liste du club. Retourne 1 s'il est parti.
 *
 * Trois différences avec l'envoi individuel, toutes assumées :
 *
 * 1. **les refus personnels ne s'appliquent plus** : l'application ne sait pas qui lit la liste,
 *    elle ne peut retrancher personne. C'est le serveur mail du club qui gère les départs — et
 *    l'écran de réglage le dit en toutes lettres. Le membre qui veut la paix garde, lui, le choix du
 *    canal téléphone, qui reste personnel ;
 * 2. **on envoie même si personne n'est « retenu »** : le message part parce qu'il y a cours demain,
 *    pas parce que telle personne a coché quelque chose ;
 * 3. **le gabarit change** (`emailRecapVeilleListe`) : ni prénom, ni « Tu es inscrit », ni boutons
 *    personnels, ni lien de désinscription — celui-ci porte un jeton nominatif.
 */
async function envoyerRecapListe(s: SeanceAvecInvites, prefs: PreferencesNotifications): Promise<number> {
  const adresse = adresseListePour(prefs, "recap_veille");
  if (adresse === null) return 0;
  const cle = cleRecapListe(s);
  const club = await identite();
  /*
   * **Le message d'abord, la clé ensuite.** `messageCollectif` relit le contenu et **lève** si un
   * lien personnel s'y est glissé — c'est tout son intérêt. Posée avant, la clé aurait survécu à
   * cette levée : au passage suivant, `journaliser` rendrait `false` (clé prise) et l'on repartirait
   * sans rien envoyer. La notification serait éteinte pour toujours, sans un mot.
   *
   * Dans cet ordre-là, l'échec est bruyant et rejouable : rien n'est écrit, et le passage suivant
   * refait exactement la même tentative.
   */
  const message = messageCollectif(emailRecapVeilleListe({ seance: s.seance, chiffres: s.chiffres, nomApp: club.nomCourt }));
  // La clé est posée AVANT l'envoi : deux exécutions simultanées ne doublent pas le message.
  // `userId: null` — la ligne dit « envoyé à la liste », pas « envoyé à quelqu'un ».
  if (!(await journaliser({ type: TYPE_RECAP, canal: "EMAIL", sessionId: s.id, userId: null, dedupKey: cle, statut: "ENVOYE" }))) return 0;
  enqueueEmailListe(adresse, message, cle, (err) => {
    if (err) void marquerEchec(cle, err.message);
  });
  return 1;
}

/** Une notification par destinataire retenu sur ce canal-là, jamais deux fois (séance × membre). */
async function envoyerRecapPush(s: SeanceAvecInvites, prefs: PreferencesNotifications): Promise<number> {
  return notifierParPush({
    type: TYPE_RECAP,
    sessionId: s.id,
    destinataires: destinatairesRecapPush(prefs, s.membres),
    cle: (m) => cleRecapPush(s, m.id),
    charge: (m) => chargeRecapPush(s, m.statut),
  });
}

/** Un message Discord par séance (embed du contenu commun), une seule fois — voir `salon.ts`. */
/**
 * Le même récap sur Telegram — même embed, autre transport, autre clé de déduplication.
 *
 * Le contenu n'est pas réécrit : `publierSurTelegram` transcrit l'embed. Si le club branche les deux
 * canaux, les deux messages disent exactement la même chose, et une correction du contenu commun se
 * voit sur les deux.
 */
async function envoyerRecapTelegram(s: SeanceAvecInvites, now: Date): Promise<boolean> {
  const club = await identite();
  return publierSurTelegram({
    type: TYPE_RECAP,
    notification: "recap_veille",
    dedupKey: cleRecapTelegram(s),
    sessionId: s.id,
    embed: embedSeance(s.seance, s.chiffres, club.nomClub, club.partEffectifMin, { programme: s.programme }),
    now,
  });
}

async function envoyerRecapDiscord(s: SeanceAvecInvites, now: Date): Promise<boolean> {
  // Le nom du club et sa part minimale d'effectif sont des données (`src/lib/identite.ts`) : elles se
  // lisent ici, où l'on est déjà asynchrone, et descendent en argument dans la mise en forme, qui
  // reste pure.
  const club = await identite();
  return publierSurSalon({
    type: TYPE_RECAP,
    notification: "recap_veille",
    dedupKey: cleRecapDiscord(s),
    sessionId: s.id,
    embed: embedSeance(s.seance, s.chiffres, club.nomClub, club.partEffectifMin, { programme: s.programme }),
    now,
  });
}
