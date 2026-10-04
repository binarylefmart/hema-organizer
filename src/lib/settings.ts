import { db } from "./db";
import { env } from "./env";
import { chiffrer, dechiffrer } from "./crypto";

/**
 * Paramètres modifiables dans l'app (table Setting, clé/valeur).
 * - recapHour : heure d'envoi du récap de la veille ("HH:MM", défaut 18:00)
 * - discordWebhookUrl : surcharge chiffrée de DISCORD_WEBHOOK_URL (le salon principal)
 * - discordWebhooks : un salon **par notification**, chiffré, facultatif (voir
 *   src/lib/notifications/webhooks.ts — vide, chaque notification retombe sur le salon principal)
 * - discordWebhookEvenementsUrl : **ancienne** clé du salon des événements, reprise automatiquement
 *   dans `discordWebhooks` puis effacée (voir `reprendreAncienSalonEvenements`)
 * - publicApiEnabled : "1" | "0"
 * - vapid : paire de clés du Web Push, chiffrée (créée au premier besoin, jamais changée ensuite)
 * - themes : liste JSON des thèmes proposés dans le planning
 * - alertesSecurite : "1" | "0" (emails d'alerte aux admins)
 * - auditRetentionJours : rétention du journal d'audit (défaut 365)
 * - notifications : JSON des réglages du panneau Notifications — canaux, matrice notification × canal,
 *   **adresse de liste de distribution**, mode d'envoi par notification (« chacun le sien » / « la
 *   liste ») et quota d'envois par jour déclaré. Une seule clé, donc aucune migration Prisma : le
 *   réglage de la liste se range ici, pas dans une colonne. Lu et écrit uniquement par
 *   src/lib/notifications/preferences.ts
 * - telegram : jeton du bot et identifiant de salon Telegram, chiffrés (voir
 *   src/lib/notifications/telegram.ts) ; à défaut, TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
 * - lieux : JSON des lieux habituels des cours (liste déroulante du formulaire de séance),
 *   lu et écrit uniquement par src/lib/lieux.ts
 * - identite : JSON du nom du club, de son sigle, de son thème, de sa couleur de marque et des
 *   logos déposés, lu et écrit uniquement par src/lib/identite.ts
 */
export const CLES = {
  recapHour: "recapHour",
  discordWebhookUrl: "discordWebhookUrl",
  discordWebhooks: "discordWebhooks",
  /** Héritée : lue une dernière fois pour la reprise, jamais réécrite. */
  discordWebhookEvenementsUrl: "discordWebhookEvenementsUrl",
  publicApiEnabled: "publicApiEnabled",
  vapid: "vapid",
  themes: "themes",
  alertesSecurite: "alertesSecurite",
  auditRetentionJours: "auditRetentionJours",
  notifications: "notifications",
  identite: "identite",
  lieux: "lieux",
  telegram: "telegram",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const s = await db.setting.findUnique({ where: { key }, select: { value: true } });
  return s?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.setting.deleteMany({ where: { key } });
    return;
  }
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Heure d'envoi du récap de la veille, faute de réglage en base. */
export const HEURE_RECAP_DEFAUT = "18:00";

export async function getRecapHour(): Promise<string> {
  return (await getSetting(CLES.recapHour)) ?? HEURE_RECAP_DEFAUT;
}

/**
 * Heure d'envoi du récap de la veille ("HH:MM", Europe/Paris). Lue à chaque passage du cron
 * (src/lib/taches.ts) : un changement du réglage s'applique sans redémarrer le serveur.
 */
export async function heureRecap(): Promise<string> {
  return getRecapHour();
}

/** URL effective du webhook : surcharge en base (chiffrée) sinon variable d'environnement. */
export async function getDiscordWebhookUrl(): Promise<{ url: string; source: "app" | "env" | "aucune" }> {
  const stocke = await getSetting(CLES.discordWebhookUrl);
  if (stocke) {
    const url = dechiffrer(stocke);
    if (url) return { url, source: "app" };
  }
  const fromEnv = env().DISCORD_WEBHOOK_URL;
  return fromEnv ? { url: fromEnv, source: "env" } : { url: "", source: "aucune" };
}

export async function setDiscordWebhookUrl(url: string | null): Promise<void> {
  await setSetting(CLES.discordWebhookUrl, url ? chiffrer(url) : null);
}

/**
 * **L'API publique est fermée tant que le club ne l'ouvre pas**.
 *
 * Elle était ouverte par défaut, et c'était le mauvais sens pour un outil que d'autres clubs
 * installent : celui qui déploie l'image et n'ouvre jamais l'écran *Notifications* publiait sur
 * Internet ses vingt prochains cours, le nom de la salle **avec son adresse postale**, les thèmes,
 * les motifs d'annulation et les taux — sans l'avoir décidé. Le CORS n'y changeait rien : il ne
 * gêne qu'un navigateur, jamais un `curl`.
 *
 * Le réglage est donc **opt-in** : la valeur absente vaut « fermée », et seul un « 1 » explicite
 * ouvre la porte. Le club qui veut alimenter son site coche la case une fois ; les autres
 * n'exposent rien.
 */
export async function isPublicApiEnabled(): Promise<boolean> {
  return (await getSetting(CLES.publicApiEnabled)) === "1";
}
