import { db } from "./db";
import { env } from "./env";
import { chiffrer, dechiffrer } from "./crypto";
import { delaiDesistementSchema, jalonsRappelSchema } from "./validation/gestion";
import { DELAI_DESISTEMENT_DERNIERE_MINUTE_MIN, DELAI_DESISTEMENT_TARDIF_MIN } from "./constants";

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
 * - themes : liste JSON des thèmes proposés aux **cours et options** du planning (« Thèmes de cours
 *   et options » ; la clé garde son nom d'avant la coupure, et les valeurs du club avec elle)
 * - themesEchauffement : liste JSON des thèmes proposés aux **échauffements** (« Thèmes
 *   d'échauffement ») — défaut `THEMES_ECHAUFFEMENT_DU_CLUB` tant que rien n'est enregistré
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
  themesEchauffement: "themesEchauffement",
  alertesSecurite: "alertesSecurite",
  auditRetentionJours: "auditRetentionJours",
  notifications: "notifications",
  identite: "identite",
  lieux: "lieux",
  telegram: "telegram",
  rappelsJalons: "rappels.jalons",
  desistementDelai: "desistement.delaiMinutes",
  desistementDerniereMinute: "desistement.derniereMinuteMinutes",
  desistementActif: "desistement.actif",
  desistementDerniereMinuteActif: "desistement.derniereMinuteActif",
  choixCours: "presences.choixCours",
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

/** Les délais des rappels tant que le club n'a rien réglé : une semaine, puis deux jours avant. */
export const JALONS_RAPPEL_DEFAUT = "7,2";

/**
 * **Lit `rappels.jalons`** (« 7,2 », « 3,1 », « » pour aucun rappel). Une valeur illisible — écrite
 * à la main en base, ou par une version future — retombe sur le défaut plutôt que de couper les
 * rappels en silence.
 */
export function lireJalonsRappel(valeur: string | null): number[] {
  const brut = valeur ?? JALONS_RAPPEL_DEFAUT;
  const lu = jalonsRappelSchema.safeParse(brut.trim() === "" ? [] : brut.split(",").map((x) => Number(x.trim())));
  return lu.success ? lu.data : lireJalonsRappel(JALONS_RAPPEL_DEFAUT);
}

export async function getJalonsRappel(): Promise<number[]> {
  return lireJalonsRappel(await getSetting(CLES.rappelsJalons));
}

export async function setJalonsRappel(jalons: readonly number[]): Promise<void> {
  await setSetting(CLES.rappelsJalons, jalons.join(","));
}

/**
 * **Lit un délai de désistement** (`desistement.delaiMinutes`, `desistement.derniereMinuteMinutes`) :
 * des minutes, en heures entières dans les bornes. Une valeur illisible ou hors bornes retombe sur
 * `defaut` (deux jours pour le désistement, quatre heures pour la dernière minute).
 */
export function lireDelaiDesistement(valeur: string | null, defaut = DELAI_DESISTEMENT_TARDIF_MIN): number {
  if (valeur === null || !/^\d+$/.test(valeur.trim())) return defaut;
  const minutes = Number(valeur.trim());
  if (minutes % 60 !== 0) return defaut;
  const lu = delaiDesistementSchema.safeParse(minutes / 60);
  return lu.success ? lu.data : defaut;
}

/**
 * Le délai réglé par le club. **Ne lève jamais** : il est lu sur le chemin de la réponse d'un membre
 * (alerte et historique), et une lecture qui échoue vaut le défaut, jamais une réponse refusée.
 */
export async function getDelaiDesistementMin(): Promise<number> {
  try {
    return lireDelaiDesistement(await getSetting(CLES.desistementDelai));
  } catch {
    return DELAI_DESISTEMENT_TARDIF_MIN;
  }
}

export async function setDelaiDesistementMin(minutes: number): Promise<void> {
  await setSetting(CLES.desistementDelai, String(minutes));
}

/** Le délai « dernière minute » réglé par le club ({@link DELAI_DESISTEMENT_DERNIERE_MINUTE_MIN} à défaut). Ne lève jamais. */
export async function getDelaiDerniereMinuteMin(): Promise<number> {
  try {
    return lireDelaiDesistement(await getSetting(CLES.desistementDerniereMinute), DELAI_DESISTEMENT_DERNIERE_MINUTE_MIN);
  } catch {
    return DELAI_DESISTEMENT_DERNIERE_MINUTE_MIN;
  }
}

export async function setDelaiDerniereMinuteMin(minutes: number): Promise<void> {
  await setSetting(CLES.desistementDerniereMinute, String(minutes));
}

/**
 * **Chaque alerte s'active à part** (Delta : « une coche pour activer l'une et l'autre en
 * fonction de ce qui est voulu par l'admin »). Allumées tant que rien n'est enregistré : seul `"0"` éteint.
 */
export function lireActivation(valeur: string | null): boolean {
  return valeur?.trim() !== "0";
}

async function lireActivationSure(cle: string): Promise<boolean> {
  try {
    return lireActivation(await getSetting(cle));
  } catch {
    return true;
  }
}

export async function setActivationDesistement(quoi: "desistement" | "derniere_minute", actif: boolean): Promise<void> {
  await setSetting(quoi === "derniere_minute" ? CLES.desistementDerniereMinuteActif : CLES.desistementActif, actif ? "1" : "0");
}

export async function getActivationDesistement(quoi: "desistement" | "derniere_minute"): Promise<boolean> {
  return lireActivationSure(quoi === "derniere_minute" ? CLES.desistementDerniereMinuteActif : CLES.desistementActif);
}

/** Les deux délais et leurs interrupteurs, lus ensemble (alerte, historique, écrans). Ne lève jamais. */
export async function getDelaisDesistement(): Promise<{ delaiMin: number; derniereMinuteMin: number; actif: boolean; derniereMinuteActif: boolean }> {
  const [delaiMin, derniereMinuteMin, actif, derniereMinuteActif] = await Promise.all([
    getDelaiDesistementMin(),
    getDelaiDerniereMinuteMin(),
    getActivationDesistement("desistement"),
    getActivationDesistement("derniere_minute"),
  ]);
  return { delaiMin, derniereMinuteMin, actif, derniereMinuteActif };
}

/**
 * **Le choix des cours par présence** est-il ouvert aux membres ? Réglage du club, **fermé** tant
 * qu'il n'a jamais été enregistré : une mise à jour ne change pas ce que les membres voient sans que
 * le bureau l'ait décidé.
 */
export async function getChoixCoursActif(): Promise<boolean> {
  return (await getSetting(CLES.choixCours)) === "1";
}

export async function setChoixCoursActif(actif: boolean): Promise<void> {
  await setSetting(CLES.choixCours, actif ? "1" : "0");
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
