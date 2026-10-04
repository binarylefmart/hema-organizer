"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { assertPermission, exigerReauth } from "@/lib/auth/current-user";
import { desactiverTotp } from "@/lib/auth/deux-fa";
import { revokeAllSessions } from "@/lib/auth/session";
import { getDiscordWebhookUrl, setDiscordWebhookUrl, setSetting, CLES } from "@/lib/settings";
import { estTypeDiscord, salonPour, setSalonDiscord } from "@/lib/notifications/webhooks";
import { setAlertesActivees, setRetentionAuditJours } from "@/lib/alertes";
import { COULEUR_BLEU, ERREUR_DISCORD_INCONNUE, posterDiscord } from "@/lib/notifications/discord";
import { CHAT_ID, JETON_BOT, envoyerTelegram, getTelegramReglage, salonsRecents, setTelegramReglage, verifierBot } from "@/lib/notifications/telegram";
import { canauxOperationnels, etatsCanaux, raisonCanalIndisponible } from "@/lib/notifications/canaux";
import { db } from "@/lib/db";
import { canEditUser, estCompteDeService } from "@/lib/permissions";
import { ERREUR_WHATSAPP_NON_CONFIGURE, envoyerWhatsApp } from "@/lib/notifications/whatsapp";
import {
  CANAUX,
  CANAUX_PAR_NOTIFICATION,
  DESCRIPTIONS,
  LIBELLES_CANAUX,
  TYPES_NOTIFICATION,
  CHAMP_ADRESSE_LISTE,
  CHAMP_QUOTA_JOUR,
  LIBELLES_MODE,
  MODES_ENVOI,
  adresseListeValide,
  champCanal,
  champCanalRendu,
  champMode,
  champNotification,
  estRoutable,
  figerCanauxIndisponibles,
  getPreferencesNotifications,
  setPreferencesNotifications,
  typesSansAdresseDeListe,
  type ModeEnvoi,
  type PreferencesNotifications,
} from "@/lib/notifications/preferences";
import { sendEmailNow } from "@/lib/email/mailer";
import { emailTest } from "@/lib/email/templates/ateliers";
import { caseCochee, champ, zodToFormState, type FormState } from "@/lib/form";
import { alertesSecuriteSchema, publicationCoursSchema, recapHourSchema, retentionAuditSchema, webhookDiscordSchema } from "@/lib/validation/gestion";
import { z } from "zod";
import { formatDateHeure } from "@/lib/dates";
import { identite } from "@/lib/identite";

/**
 * Heure d'envoi du récap (ADMIN, session forte).
 *
 * Le réglage a suivi l'écran : il vit dans l'espace admin (`/admin/notifications`), où tout exige
 * une connexion par mot de passe et code à usage unique. Les instructeurs ne le règlent plus.
 */
export async function definirHeureRecap(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  const parsed = recapHourSchema.safeParse({ recapHour: champ(fd, "recapHour") });
  if (!parsed.success) return zodToFormState(parsed.error);
  // `CLAUDE.md` : « toute écriture de cet écran exige `exigerReauth` ». Deux des onze ne le
  // faisaient pas — celle-ci et `enregistrerListeEmail` —, et le commentaire
  // d'`enregistrerNotifications` comptait « les huit autres écritures », c'est-à-dire exactement
  // celles qui l'avaient déjà.
  await exigerReauth(user, "/admin/notifications");
  await setSetting(CLES.recapHour, parsed.data.recapHour);
  await audit(user, "parametres.recap_hour", null, parsed.data);
  revalidatePath("/admin/notifications");
  return { succes: `Récap envoyé chaque jour à ${parsed.data.recapHour.replace(":", "h")}.` };
}

/**
 * Écran « Notifications » de l'espace admin (ADMIN, session forte) : interrupteur par canal et
 * matrice notification × canal. Les alertes de sécurité ne sont pas dans le formulaire (toujours
 * envoyées). Les noms de cases sont construits à partir des constantes : aucune clé ne vient du
 * client. Décider de ce qui part au nom du club est désormais une décision du bureau.
 *
 * **Elle redemande les deux preuves** (`exigerReauth`), comme **toutes** les autres écritures de
 * cet écran — elles l'ont toutes ; ce commentaire disait « les huit autres » et comptait, sans le
 * savoir, exactement celles qui l'avaient déjà — c'était la seule à ne pas le faire. Depuis la
 * colonne « Site du club », cette matrice ne décide plus seulement « à qui le club écrit » mais
 * aussi « ce que le club publie sur Internet, annonce par annonce » : ouvrir la porte
 * (`enregistrerPublicationCours`) demandait de reprouver son identité, décider de ce qui la
 * franchit non.
 */
export async function enregistrerNotifications(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/notifications");
  const avant = await getPreferencesNotifications();
  const apres: PreferencesNotifications = {
    // Tous les canaux à faux : la boucle ci-dessous coche ceux que le formulaire a envoyés.
    canaux: Object.fromEntries(CANAUX.map((canal) => [canal, false])) as PreferencesNotifications["canaux"],
    // Une ligne vide par type connu : la boucle ci-dessous les remplit toutes depuis le formulaire.
    // Construite à partir de la constante, pour n'avoir rien à retoucher ici quand un type s'ajoute.
    notifications: Object.fromEntries(TYPES_NOTIFICATION.map((type) => [type, {}])) as PreferencesNotifications["notifications"],
    // L'adresse de liste et le quota ne sont **pas** dans ce formulaire : ils se règlent sur la page
    // du canal Email. On reprend donc ce qui existe, sinon enregistrer la matrice les effacerait.
    adresseListe: avant.adresseListe,
    modes: { ...avant.modes },
    quotaJour: avant.quotaJour,
  };
  for (const canal of CANAUX) apres.canaux[canal] = caseCochee(fd, champCanal(canal));
  for (const type of TYPES_NOTIFICATION) {
    for (const canal of CANAUX_PAR_NOTIFICATION[type]) {
      apres.notifications[type][canal] = caseCochee(fd, champNotification(type, canal));
    }
    // « Chacun le sien » / « la liste » : seuls les types routables ont ce choix, et une valeur
    // inconnue (ou absente, si l'écran est d'une version antérieure) vaut « chacun le sien ».
    if (!estRoutable(type)) continue;
    const mode = champ(fd, champMode(type));
    apres.modes[type] = (MODES_ENVOI as readonly string[]).includes(mode) ? (mode as ModeEnvoi) : "individuel";
  }
  /*
   * **Refus, pas repli silencieux.** « La liste » sans adresse de liste est un réglage qui ne peut
   * pas s'appliquer : on le dit tout de suite, en nommant les notifications concernées. Le laisser
   * passer, c'est laisser le club croire qu'il a divisé ses envois par quarante — et ne s'en
   * apercevoir qu'au relevé de son SMTP.
   */
  const sansAdresse = typesSansAdresseDeListe(apres);
  if (sansAdresse.length > 0) {
    return {
      erreur: `Renseigne d'abord l'adresse de liste (page du canal Email) : ${sansAdresse.map((t) => DESCRIPTIONS[t].titre).join(", ")} ${sansAdresse.length > 1 ? "sont réglées" : "est réglée"} sur « ${LIBELLES_MODE.liste} ».`,
    };
  }
  /*
   * **Les cases d'un canal non opérationnel sont figées, pas éteintes.** Elles sont rendues
   * `disabled` par l'écran, donc absentes du `FormData` : elles n'expriment aucune décision, et on
   * reprend leur valeur d'avant — comme l'adresse de liste et le quota, absents du même formulaire.
   * Le client ne peut toujours rien **allumer** de ce côté (la valeur ne vient pas de lui), mais il
   * ne peut plus rien **effacer** : fermer la publication du site puis enregistrer la matrice vidait
   * les trois cases « Site du club » en silence, alors que l'écran du canal promet l'inverse.
   */
  const etats = await etatsCanaux();
  const operationnels = canauxOperationnels(etats);
  /*
   * **Le gel se décide sur ce que l'écran a rendu, pas sur l'état du moment**. Le formulaire porte
   * un témoin par canal réglable : sans lui, ouvrir la publication du site **entre** le rendu et
   * l'envoi faisait **effacer** les trois cases « Site du club » et l'interrupteur du canal, en
   * silence — un onglet laissé ouvert suffisait. Aucun témoin du tout = écran d'une version
   * antérieure : on retombe sur l'état du moment.
   */
  const temoins = CANAUX.filter((canal) => caseCochee(fd, champCanalRendu(canal)));
  const reglables = temoins.length > 0 ? Object.fromEntries(temoins.map((c) => [c, true])) : operationnels;
  const { prefs: retenues, figes } = figerCanauxIndisponibles(avant, apres, reglables);
  await setPreferencesNotifications(retenues);
  await audit(user, "notifications.reglees", null, { avant, apres: retenues, figes });
  revalidatePath("/admin/notifications");
  // La page du canal « Site du club » n'affiche que cette matrice : sans ça, elle continuerait
  // d'annoncer ce qui sortait avant l'enregistrement.
  revalidatePath("/admin/notifications/api");
  /*
   * **« Actifs » veut dire « quelque chose peut en partir »**, et non « l'interrupteur est coché » :
   * depuis que les canaux non opérationnels gardent leur réglage au lieu d'être éteints, un salon
   * débranché resterait coché en base — l'annoncer comme actif serait la même erreur que celle qu'on
   * vient de corriger à l'écran du canal. Ce qui les concerne se dit dans la phrase suivante.
   */
  const canauxActifs = CANAUX.filter((c) => retenues.canaux[c] && operationnels[c]);
  const surListe = TYPES_NOTIFICATION.filter((t) => retenues.modes[t] === "liste");
  const listes = surListe.length ? ` Sur la liste ${retenues.adresseListe} : ${surListe.map((t) => DESCRIPTIONS[t].titre).join(", ")}.` : "";
  /*
   * **La raison se lit là où elle est écrite** (`raisonCanalIndisponible`) : « canal non configuré »
   * écrit en dur ici ne voulait rien dire pour le site du club, qui n'a rien à configurer — ce qui
   * lui manque, c'est une décision du bureau, et la phrase doit dire laquelle.
   */
  const refus = figes.length
    ? ` ${figes.map((c) => `${LIBELLES_CANAUX[c]} : ${raisonCanalIndisponible(etats[c])} — ses cases sont conservées en l'état et reprendront effet.`).join(" ")}`
    : "";
  return {
    succes:
      (canauxActifs.length
        ? `Notifications enregistrées. Canaux actifs : ${canauxActifs.map((c) => LIBELLES_CANAUX[c]).join(", ")}.`
        : "Notifications enregistrées. Aucun canal actif : plus aucune notification ne partira (les alertes de sécurité, elles, continuent).") +
      listes +
      refus,
  };
}

/**
 * **L'adresse de liste du club et son quota d'envois** (ADMIN, session forte) — page du canal Email.
 *
 * Deux réglages qui n'ont l'air de rien et qui décident de tout :
 *
 * - **l'adresse de liste** : la seule adresse que les envois collectifs connaissent. Vérifiée comme
 *   une adresse, et comme **une seule** : une saisie « a@club.fr, b@club.fr » est refusée, elle
 *   reproduirait le problème qu'on vient de résoudre, en pire (tous les destinataires se verraient).
 * - **le quota d'envois par jour** du serveur SMTP, facultatif : il ne limite rien, il sert à
 *   comparer le volume prévu à ce que le serveur accepte, et à prévenir *avant* la coupure.
 *
 * **Effacer l'adresse pendant que des notifications sont réglées sur « la liste » est refusé** :
 * sinon, le club croirait envoyer un message et en enverrait quatre-vingts.
 */
export async function enregistrerListeEmail(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  const avant = await getPreferencesNotifications();
  const saisie = champ(fd, CHAMP_ADRESSE_LISTE).trim().toLowerCase();
  /*
   * **Un code récent, comme les dix autres écritures de cet écran**.
   *
   * Ce champ porte **la** destination des envois collectifs — récap de la veille, rappels sans réponse,
   * annonces d'événement, annulations de cours —, et ces messages nomment des membres (`adresseListePour`).
   * Basculer une notification *vers* le mode « liste » exigeait un code ; **déplacer la destination** n'en
   * exigeait aucun. Depuis un poste admin laissé ouvert, remplacer l'adresse par la sienne redirigeait
   * tout le courrier du club, sans redonner de code.
   */
  if (saisie !== "" && !adresseListeValide(saisie)) {
    return {
      erreur: "Vérifie les champs en rouge.",
      erreurs: { [CHAMP_ADRESSE_LISTE]: "Indique **une** adresse de distribution (pas plusieurs adresses séparées par des virgules)." },
    };
  }
  const quotaBrut = champ(fd, CHAMP_QUOTA_JOUR).trim();
  const quota = quotaBrut === "" ? null : Number(quotaBrut);
  if (quota !== null && (!Number.isFinite(quota) || quota < 1 || quota > 1_000_000)) {
    return { erreur: "Vérifie les champs en rouge.", erreurs: { [CHAMP_QUOTA_JOUR]: "Un nombre d'envois par jour, ou rien du tout." } };
  }
  const apres: PreferencesNotifications = { ...avant, adresseListe: saisie, quotaJour: quota };
  const orphelines = typesSansAdresseDeListe(apres);
  if (orphelines.length > 0) {
    return {
      erreur: `Impossible d'effacer l'adresse : ${orphelines.map((t) => DESCRIPTIONS[t].titre).join(", ")} ${orphelines.length > 1 ? "sont réglées" : "est réglée"} sur « ${LIBELLES_MODE.liste} ». Remets-${orphelines.length > 1 ? "les" : "la"} d'abord sur « ${LIBELLES_MODE.individuel} ».`,
      erreurs: { [CHAMP_ADRESSE_LISTE]: "Encore employée par une notification." },
    };
  }
  // Après tous les refus (adresse invalide, quota hors bornes, type encore réglé sur « liste ») et
  // avant l'écriture : voir le bloc en tête de la fonction.
  await exigerReauth(user, "/admin/notifications/email");
  await setPreferencesNotifications(apres);
  await audit(user, "notifications.liste_email", null, { avant: { adresseListe: avant.adresseListe, quotaJour: avant.quotaJour }, apres: { adresseListe: saisie, quotaJour: quota } });
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/notifications/email");
  return {
    succes: saisie
      ? `Adresse de liste enregistrée : ${saisie}.${quota ? ` Quota déclaré : ${quota} envois par jour.` : ""}`
      : "Aucune adresse de liste : chaque notification part à chacun, comme avant.",
  };
}

/**
 * **Brancher (ou débrancher) le salon Discord** depuis Espace admin → Notifications → Canal Discord.
 *
 * Écrit exactement le même réglage que l'administration technique (`CLES.discordWebhookUrl`,
 * chiffré) : une seule valeur, jamais deux réglages concurrents.
 *
 * Droits : `settings.technical` (ADMIN, session forte + code 2FA récent). L'URL d'un webhook est un
 * secret porteur — qui la détient écrit dans le salon au nom du club — et les instructeurs se
 * connectent par lien personnel, sans second facteur.
 */
export async function enregistrerSalonDiscord(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/notifications/discord");
  const parsed = z.object({ discordWebhookUrl: webhookDiscordSchema.shape.discordWebhookUrl }).safeParse({
    discordWebhookUrl: champ(fd, "discordWebhookUrl"),
  });
  if (!parsed.success) return zodToFormState(parsed.error);
  // Le formulaire n'enregistre plus qu'une URL : débrancher se fait d'une croix (`retirerSalonDiscord`),
  // et un champ vide ne veut donc plus rien dire ici.
  if (!parsed.data.discordWebhookUrl) {
    return { erreur: "Colle l'URL du webhook, ou débranche le salon avec la croix.", erreurs: { discordWebhookUrl: "Champ vide." } };
  }
  await setDiscordWebhookUrl(parsed.data.discordWebhookUrl);
  await audit(user, "parametres.salon_discord", null, { efface: false });
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/notifications/discord");
  revalidatePath("/admin/apropos");
  return { succes: "Salon branché. Envoie un message de test pour vérifier." };
}

/**
 * **Le salon d'une notification** (ADMIN, session forte + code 2FA récent) — le club peut envoyer
 * chaque message dans le salon qui lui convient : le récap des cours dans le salon d'entraînement,
 * les annulations dans les annonces, les stages ailleurs encore.
 *
 * Chaque salon est **facultatif**, et c'est tout l'intérêt : vide, la notification part sur le salon
 * principal, exactement comme avant. Même traitement que le webhook principal : chiffré en base,
 * jamais réaffiché en clair, jamais écrit dans le journal d'audit (on n'y garde que la notification
 * concernée et « effacé : oui / non »).
 *
 * Le nom de la notification vient du formulaire : il est donc **vérifié** contre la liste des
 * notifications qui partent sur Discord (`estTypeDiscord`), jamais utilisé tel quel comme clé.
 */
export async function enregistrerSalonNotification(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/notifications/discord");
  const notification = champ(fd, "notification");
  if (!estTypeDiscord(notification)) return { erreur: "Notification inconnue." };
  // Même validation que le webhook principal : une URL de webhook Discord, ou rien.
  const parsed = z.object({ url: webhookDiscordSchema.shape.discordWebhookUrl }).safeParse({ url: champ(fd, "url") });
  if (!parsed.success) return zodToFormState(parsed.error);
  // Même règle que pour le salon principal : on enregistre une URL, on retire avec la croix.
  if (!parsed.data.url) {
    return { erreur: "Colle l'URL du webhook, ou retire le salon dédié avec la croix.", erreurs: { url: "Champ vide." } };
  }
  await setSalonDiscord(notification, parsed.data.url);
  await audit(user, "parametres.salon_notification", null, { notification, efface: false });
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/notifications/discord");
  revalidatePath("/admin/apropos");
  const titre = DESCRIPTIONS[notification].titre;
  return { succes: `Salon branché pour « ${titre} ». Envoie un message de test pour vérifier.` };
}

/**
 * **Débrancher le salon principal en un geste** — même raison que pour les lignes de notification :
 * une croix dit ce qu'elle fait, là où une case à cocher suivie d'un formulaire vide laisse
 * toujours un doute. La variable `DISCORD_WEBHOOK_URL` de la stack, si elle est renseignée, reprend
 * alors la main : débrancher ici efface la surcharge enregistrée dans l'application, rien d'autre.
 */
export async function retirerSalonDiscord(): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/notifications/discord");
  await setDiscordWebhookUrl(null);
  await audit(user, "parametres.salon_discord", null, { efface: true });
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/notifications/discord");
  revalidatePath("/admin/apropos");
  return { succes: "Salon principal débranché (la variable DISCORD_WEBHOOK_URL de la stack reprend la main si elle est renseignée)." };
}

/**
 * **Débrancher un salon en un geste.**
 *
 * Retirer une URL est un geste à part entière, et c'est une croix qui le porte. La case à cocher
 * d'avant obligeait à un détour — cocher, puis valider un formulaire au champ vide — et laissait
 * chaque fois se demander si ce champ vide allait effacer le salon ou ne rien faire. Une croix à
 * côté de la ligne ne pose pas la question.
 *
 * La confirmation est demandée côté bouton : débrancher est sans danger (les messages repartent
 * sur le salon principal), mais l'URL, elle, est perdue — il faudra la recoller.
 */
export async function retirerSalonNotification(notification: string): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/notifications/discord");
  if (!estTypeDiscord(notification)) return { erreur: "Notification inconnue." };
  await setSalonDiscord(notification, null);
  await audit(user, "parametres.salon_notification", null, { notification, efface: true });
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/notifications/discord");
  revalidatePath("/admin/apropos");
  return { succes: `Salon dédié retiré : « ${DESCRIPTIONS[notification].titre} » repart sur le salon principal.` };
}

/**
 * Message de test **sur le salon d'une notification donnée** : c'est justement de savoir *dans quel
 * salon* le message arrive qu'il s'agit, et un bouton par ligne est le seul moyen de vérifier
 * chaque salon séparément. Sans salon dédié, le message part sur le salon principal — et le retour
 * le dit, pour qu'on ne cherche pas au mauvais endroit.
 */
export async function testerSalonNotification(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  const notification = champ(fd, "notification");
  if (!estTypeDiscord(notification)) return { erreur: "Notification inconnue." };
  const titre = DESCRIPTIONS[notification].titre;
  const { url, source } = await salonPour(notification);
  if (!url) return { erreur: "Aucun salon Discord configuré (ni pour cette notification, ni pour le club)." };
  try {
    await posterDiscord(url, {
      title: `Message de test — ${titre}`,
      description: `Envoyé depuis les paramètres de ${(await identite()).nomCourt} par ${user.prenom} le ${formatDateHeure(new Date())}.`,
      color: COULEUR_BLEU,
    });
    await audit(user, "test.discord_notification", null, { notification, source, ok: true });
    return {
      succes:
        source === "dedie"
          ? `Message de test envoyé sur le salon de « ${titre} ».`
          : `Aucun salon dédié : le message de test est parti sur le salon principal, comme le fera « ${titre} ».`,
    };
  } catch (e) {
    // Même règle que `testerDiscord` plus bas : message reformulé par le transport (jamais l'URL du
    // webhook, voir `messageErreurDiscord`) et borné avant d'entrer dans le journal d'audit.
    const message = e instanceof Error ? e.message : ERREUR_DISCORD_INCONNUE;
    await audit(user, "test.discord_notification", null, { notification, source, ok: false, erreur: message.slice(0, 200) });
    return { erreur: `Échec : ${message}` };
  }
}

/**
 * **Publier les prochains cours sur le site du club** — une case, un formulaire, rien d'autre
 * dedans.
 *
 * Elle partageait son formulaire et son bouton « Enregistrer » avec les alertes de sécurité, sous
 * un titre — « Partage et alertes » — qui ne disait ni l'un ni l'autre. Deux décisions sans rapport
 * prises d'un seul geste, au milieu de l'écran des notifications : on pouvait ouvrir au public le
 * calendrier du club en croyant régler ses alertes. Le réglage est le même, la porte n'a pas bougé
 * (fermée tant que la case n'est pas cochée) ; ce qui change, c'est qu'on ne peut plus l'ouvrir
 * **par inadvertance**.
 */
export async function enregistrerPublicationCours(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/notifications");
  const parsed = publicationCoursSchema.safeParse({ publicApiEnabled: caseCochee(fd, "publicApiEnabled") });
  if (!parsed.success) return zodToFormState(parsed.error);
  await setSetting(CLES.publicApiEnabled, parsed.data.publicApiEnabled ? "1" : "0");
  await audit(user, "parametres.publication_cours", null, { publicApiEnabled: parsed.data.publicApiEnabled });
  revalidatePath("/admin/notifications");
  // La page du canal « Site du club » n'a pas d'autre sujet que cette case : elle doit être relue.
  revalidatePath("/admin/notifications/api");
  revalidatePath("/admin/apropos");
  return { succes: parsed.data.publicApiEnabled ? "Les prochains cours sont publiés." : "La publication est fermée." };
}

/**
 * **Les alertes de sécurité aux administrateurs** : lien ouvert un nombre anormal de fois, lien
 * saturé d'appareils, vague de jetons inconnus. Les couper, c'est accepter de ne pas être prévenu
 * d'un accès volé — d'où son propre formulaire, séparé de la publication des cours.
 */
export async function enregistrerAlertesSecurite(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/notifications");
  const parsed = alertesSecuriteSchema.safeParse({ alertesSecurite: caseCochee(fd, "alertesSecurite") });
  if (!parsed.success) return zodToFormState(parsed.error);
  await setAlertesActivees(parsed.data.alertesSecurite);
  await audit(user, "parametres.alertes_securite", null, { alertesSecurite: parsed.data.alertesSecurite });
  revalidatePath("/admin/notifications");
  return { succes: "Enregistré." };
}

/** La durée de conservation du journal d'audit : le seul réglage purement technique, écran *À propos*. */
export async function enregistrerRetentionAudit(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/apropos");
  const parsed = retentionAuditSchema.safeParse({ auditRetentionJours: champ(fd, "auditRetentionJours") });
  if (!parsed.success) return zodToFormState(parsed.error);
  await setRetentionAuditJours(parsed.data.auditRetentionJours);
  await audit(user, "parametres.retention_audit", null, { jours: parsed.data.auditRetentionJours });
  revalidatePath("/admin/apropos");
  return { succes: `Journal conservé ${parsed.data.auditRetentionJours} jours.` };
}

/**
 * Message de test sur le salon, appelé par `testerSalonDiscord`.
 *
 * **Volontairement non exportée** : dans un fichier `"use server"`, chaque export est une route
 * ouverte sur le réseau. Cette fonction n'a plus qu'un seul appelant depuis que l'écran
 * « Paramètres techniques » a disparu — la garder exportée laisserait une porte de plus pour rien.
 *
 * L'envoi ne révèle pas l'URL du webhook et ne change aucun réglage : c'est la vérification
 * naturelle après avoir branché le salon.
 */
async function testerDiscord(): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  const { url, source } = await getDiscordWebhookUrl();
  if (!url) return { erreur: "Aucun webhook Discord configuré (ni dans l'app, ni en variable d'environnement)." };
  try {
    await posterDiscord(url, {
      title: "Message de test",
      description: `Envoyé depuis les paramètres de ${(await identite()).nomCourt} par ${user.prenom} le ${formatDateHeure(new Date())}.`,
      color: COULEUR_BLEU,
    });
    await audit(user, "test.discord", null, { source, ok: true });
    return { succes: "Message de test envoyé sur Discord." };
  } catch (e) {
    /*
     * **L'erreur d'un appel Discord ne se recopie pas telle quelle**. Elle allait dans
     * `AuditLog.details` (365 jours, exporté en CSV) *et* à l'écran, par `String(e)` : une URL de
     * webhook mal recopiée dans Portainer faisait lever Node avec l'entrée fautive au complet,
     * **jeton porteur compris**. Le transport la reformule désormais (`messageErreurDiscord`, qui
     * ne dit jamais l'adresse appelée) ; on borne ici ce qui est journalisé, comme le fait déjà le
     * jumeau Telegram juste en dessous.
     */
    const message = e instanceof Error ? e.message : ERREUR_DISCORD_INCONNUE;
    await audit(user, "test.discord", null, { source, ok: false, erreur: message.slice(0, 200) });
    return { erreur: `Échec : ${message}` };
  }
}

/** Même variante, branchée sur un formulaire (`FormulaireAction`) pour afficher succès et échec. */
export async function testerSalonDiscord(): Promise<FormState> {
  return testerDiscord();
}

/**
 * Email de test, envoyé à soi-même, appelé par `testerEnvoiEmail`. **Non exportée** pour la même
 * raison que `testerDiscord` : un export de moins dans un fichier `"use server"`, c'est une route
 * de moins.
 *
 * L'adresse est facultative depuis que le club peut inscrire quelqu'un sans email : sans adresse,
 * il n'y a tout simplement rien à tester, et on le dit plutôt que d'échouer à l'envoi.
 */
async function testerEmail(): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  if (!user.email) return { erreur: "Ton compte n'a pas d'adresse email : impossible d'envoyer un test." };
  const { sujet, contenu } = emailTest({ prenom: user.prenom, nomApp: (await identite()).nomCourt });
  try {
    const res = await sendEmailNow({ to: user.email, sujet, contenu, ref: "test_email" });
    await audit(user, "test.email", null, { ok: true, mode: res.mode });
    return { succes: res.mode === "smtp" ? `Email de test envoyé à ${user.email}.` : `SMTP non configuré : email écrit dans previews/emails (${res.chemin}).` };
  } catch (e) {
    // Borné comme ses voisins : c'était le seul `erreur` de ce fichier à entrer dans l'audit sans
    // coupe. Un refus SMTP porte le banner du serveur et souvent l'adresse visée, sur une ligne que
    // l'écran du journal affiche telle quelle.
    await audit(user, "test.email", null, { ok: false, erreur: String(e).slice(0, 200) });
    return { erreur: `Échec : ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Même variante, branchée sur un formulaire. */
export async function testerEnvoiEmail(): Promise<FormState> {
  return testerEmail();
}

/**
 * Test du canal WhatsApp. **Aucun appel réseau** : tant que le service d'envoi n'est pas branché,
 * `envoyerWhatsApp` lève son erreur explicite et on la rend telle quelle à l'écran.
 * Droits : `settings.technical`, comme le reste de l'écran Notifications.
 */
export async function testerWhatsApp(): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  try {
    await envoyerWhatsApp({ texte: `Message de test de ${(await identite()).nomCourt} (${user.prenom}).` });
    await audit(user, "test.whatsapp", null, { ok: true });
    return { succes: "Message de test envoyé sur WhatsApp." };
  } catch (e) {
    return { erreur: e instanceof Error ? e.message : ERREUR_WHATSAPP_NON_CONFIGURE };
  }
}

/**
 * Un administrateur réinitialise la double authentification d'un autre admin (téléphone perdu).
 *
 * **La cible est vérifiée, et ce n'était pas le cas.** `userId` arrive du formulaire, et dans un
 * fichier `"use server"` il arrive donc du réseau : rien n'empêchait d'effacer le second facteur
 * de **n'importe quel compte**, celui du portail compris. Ce n'était pas une élévation de
 * privilège — il faut déjà être administrateur élevé, avec un code récent — mais c'était un geste
 * bien plus large que son écran ne le laisse croire, et le compte de service pouvait y perdre son
 * second facteur sans que personne l'ait voulu.
 *
 * Les trois mêmes gardes que ses voisines `retirerDroitsAdmin` et `reinitialiserAccesMembre` :
 * la cible existe et est bien administratrice, ce n'est pas le compte de service, et la matrice
 * autorise l'acteur à la toucher.
 */
export async function reinitialiserDeuxFaCompte(userId: string): Promise<void> {
  const acteur = await assertPermission("admins.manage");
  const cible = await db.user.findUniqueOrThrow({
    where: { id: userId },
    // `estAdmin` compris : c'est lui qui dit « du bureau », pour la garde juste en dessous **et**
    // pour `canEditUser`, qui ne protège un compte du bureau que s'il le voit.
    select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true },
  });
  // Écrite `cible.role !== "ADMIN"`, cette garde refusait **tout le monde** : le rôle ne vaut plus
  // jamais « ADMIN », et le bouton de l'écran n'aurait plus fait que lever une erreur.
  if (!cible.estAdmin) throw new Error("Ce compte n'est pas administrateur.");
  // **Le compte permanent est hors de portée des autres administrateurs** : ni son mot de passe
  // (`reinitialiserAccesMembre`), ni son second facteur ici. Lui retirer sa 2FA ne le ferme pas
  // dehors — il la reconfigurerait à la connexion suivante —, mais ça ouvre une fenêtre où le
  // compte le plus fort de l'installation n'a plus qu'un seul facteur, décidée par quelqu'un
  // d'autre que lui. Son téléphone perdu se répare par sa propre boîte email, puis le parcours
  // `/admin/activer`. L'écran ne rend plus ce bouton sur sa ligne.
  if (estCompteDeService(cible)) throw new Error("La double authentification du compte d'administration ne se réinitialise que par lui-même.");
  if (!canEditUser(acteur, cible)) throw new Error("Action non autorisée.");
  await exigerReauth(acteur, "/admin/comptes");
  await desactiverTotp(userId);
  await revokeAllSessions(userId, acteur.id === userId);
  await audit(acteur, "deux_fa.reinitialisee", userId, { email: cible.email });
  revalidatePath("/admin/comptes");
}

/**
 * **Brancher le canal Telegram** (ADMIN, session forte + code 2FA récent) : le jeton du bot et
 * l'identifiant du salon, enregistrés **chiffrés** en base — comme l'URL d'un webhook Discord, et
 * pour la même raison : qui détient le jeton écrit au nom du club, et peut lire ce que le bot voit.
 *
 * Le jeton est **vérifié auprès de Telegram avant d'être enregistré** (`getMe`, aucun message
 * publié) : un jeton mal recopié, sinon, ne se découvre qu'au premier cours annulé — c'est-à-dire le
 * jour où le message comptait. Le nom du bot est renvoyé dans le message de succès, ce qui confirme
 * du même coup qu'on a collé le bon.
 */
export async function enregistrerTelegram(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/notifications/telegram");
  const token = champ(fd, "token").trim();
  const chatId = champ(fd, "chatId").trim();
  const erreurs: Record<string, string> = {};
  // Le jeton peut être conservé : on ne le réaffiche jamais, le champ est donc vide à l'écran même
  // quand un jeton est branché. Vide + un jeton déjà en base = « je ne change que le salon ».
  const dejaLa = await getTelegramReglage();
  const jeton = token || (dejaLa.source === "app" ? dejaLa.token : "");
  if (!jeton) erreurs.token = "Colle le jeton donné par @BotFather.";
  else if (!JETON_BOT.test(jeton)) erreurs.token = "Ce n'est pas la forme d'un jeton de bot (123456789:AA…).";
  if (!chatId) erreurs.chatId = "Indique le salon (identifiant numérique ou @nom_public).";
  else if (!CHAT_ID.test(chatId)) erreurs.chatId = "Un identifiant de salon est un nombre (souvent négatif) ou @nom_public.";
  if (Object.keys(erreurs).length > 0) return { erreur: "Vérifie les champs en rouge.", erreurs };

  const verdict = await verifierBot(jeton);
  if (!verdict.ok) return { erreur: `Telegram n'a pas reconnu ce bot : ${verdict.erreur}`, erreurs: { token: "Jeton refusé." } };
  await setTelegramReglage({ token: jeton, chatId });
  // Ni le jeton ni sa forme masquée dans le journal : seul le salon, qui n'est pas un secret.
  await audit(user, "parametres.telegram", null, { salon: chatId, bot: verdict.nom });
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/notifications/telegram");
  return { succes: `Bot ${verdict.nom} branché sur le salon ${chatId}. Envoie un message de test pour vérifier.` };
}

/** Débrancher le canal : les deux valeurs s'en vont ensemble (un jeton sans salon n'envoie rien). */
export async function retirerTelegram(): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  await exigerReauth(user, "/admin/notifications/telegram");
  await setTelegramReglage(null);
  await audit(user, "parametres.telegram_retire");
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/notifications/telegram");
  return { succes: "Canal Telegram débranché." };
}

/**
 * **Relève les salons où le bot a vu passer un message** (`getUpdates`).
 *
 * C'est le seul vrai obstacle à la mise en route : trouver l'identifiant d'un groupe suppose
 * d'ouvrir une URL d'API dans son navigateur et d'y lire du JSON. On ne demande pas ça au bureau
 * d'un club — l'écran le fait. Le jeton peut venir du champ (avant tout enregistrement) ou du
 * réglage déjà en place.
 */
export async function chercherSalonsTelegram(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  // Chaque appui déclenche une requête sortante avec le jeton du club : on la borne, comme tout ce
  // qui part d'un formulaire vers un service tiers.
  if (!(await checkRateLimit("activation_user", user.id))) return { erreur: "Trop de recherches d'affilée. Réessaie dans un quart d'heure." };
  const saisi = champ(fd, "token").trim();
  const reglage = await getTelegramReglage();
  const jeton = saisi || reglage.token;
  if (!jeton || !JETON_BOT.test(jeton)) return { erreur: "Colle d'abord le jeton du bot.", erreurs: { token: "Jeton manquant." } };
  const salons = await salonsRecents(jeton);
  await audit(user, "parametres.telegram_recherche", null, { trouves: salons.length });
  if (salons.length === 0) {
    return {
      erreur:
        "Aucun salon trouvé. Ajoute le bot au groupe, écris-y n'importe quel message, puis recommence — Telegram ne garde ces messages que 24 h.",
    };
  }
  // Le résultat passe par le message de succès : pas d'état à tenir entre deux requêtes pour une
  // liste qu'on lit une fois et qu'on recopie dans le champ d'à côté.
  return { succes: `Salons trouvés : ${salons.map((s) => `${s.nom} (${s.id})`).join(" · ")}` };
}

/** Message de test sur le salon Telegram : la vérification à faire juste après avoir branché. */
export async function testerTelegram(): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  const reglage = await getTelegramReglage();
  if (reglage.source === "aucune") return { erreur: "Aucun bot ni salon réglé : branche le canal d'abord." };
  try {
    const club = await identite();
    await envoyerTelegram(
      `<b>Message de test — ${club.nomCourt}</b>\n\nEnvoyé depuis les réglages par ${user.prenom} le ${formatDateHeure(new Date())}.`,
      reglage,
    );
    await audit(user, "test.telegram", null, { ok: true });
    return { succes: "Message de test envoyé sur le salon Telegram." };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await audit(user, "test.telegram", null, { ok: false, erreur: message.slice(0, 200) });
    return { erreur: message };
  }
}
