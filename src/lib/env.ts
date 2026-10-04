import { z } from "zod";
import { FORME_WEBHOOK_DISCORD, NOM_APP_LIVRE } from "./constants";

/**
 * Variables d'environnement validées au premier accès.
 * Les secrets restent côté serveur : ne jamais importer ce module depuis un composant client.
 */
const HOTE_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * **Les guillemets que Portainer garde.** Un fichier `.env` retire les guillemets qui entourent une
 * valeur ; la saisie « Environment variables » de Portainer, non — ils font partie de la valeur.
 * C'est une panne déjà vécue en production. La règle est donc appliquée à toute variable recopiée
 * depuis `.env.example`, et pas seulement à celle qui a coûté une soirée.
 */
function deguillemeter(valeur: string): string {
  const v = valeur.trim();
  if (v.length > 1 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1).trim();
  return v;
}

/**
 * **Le webhook de la stack, nettoyé puis vérifié.** Fonction pure, testable sans environnement.
 *
 * `DISCORD_WEBHOOK_URL` n'était pas validée du tout, alors que la même valeur saisie dans
 * l'application passe par `webhookDiscordSchema`. Une URL mal recopiée arrivait telle quelle dans
 * `fetch()`, et le `TypeError` de Node **reprend l'entrée fautive, jeton porteur compris** — inscrit
 * en clair dans `AuditLog.details`, affiché à l'écran, écrit dans le journal du conteneur (voir
 * `messageErreurDiscord`, qui bouche l'autre moitié du trou).
 *
 * Deux gestes, dans cet ordre : on retire les guillemets que Portainer garde (une valeur juste
 * entourée de guillemets doit marcher, pas mourir), puis on refuse ce qui n'a pas la forme d'un
 * webhook. **Refuser, ici, c'est oublier la variable** — pas arrêter l'application : le canal
 * Discord est facultatif et n'a jamais eu le droit de faire tomber le club (« le canal reste muet,
 * sans rien casser », docs/DEPLOIEMENT.md § 2). L'avertissement part au journal du conteneur, et
 * l'espace admin dira simplement qu'aucun salon n'est configuré.
 */
export function normaliserWebhookDiscord(brut: string, avertir: (message: string) => void = () => {}): string {
  const valeur = deguillemeter(brut);
  if (valeur === "") return "";
  if (FORME_WEBHOOK_DISCORD.test(valeur)) return valeur;
  avertir(
    "[env] DISCORD_WEBHOOK_URL n'a pas la forme d'un webhook Discord (https://discord.com/api/webhooks/<id>/<jeton>) : la variable est ignorée, le canal Discord reste muet. La valeur n'est pas recopiée ici — elle contient un jeton.",
  );
  return "";
}

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DOMAIN: z.string().min(1).default("localhost:3000"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET doit faire au moins 32 caractères"),
    DATABASE_URL: z.string().min(1),
    BACKUP_DIR: z.string().default("./backups"),
    /** Dossier des affiches déposées ; vide = à côté de la base SQLite (voir `dossierAffiches()`) */
    UPLOAD_DIR: z.string().optional(),
    TZ: z.string().default("Europe/Paris"),
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().default(""),
    SMTP_PASS: z.string().default(""),
    /** Expéditeur des emails ; vide = repli construit sur DOMAIN (voir `expediteur()`) */
    SMTP_FROM: z.string().default(""),
    /**
     * Salon Discord principal, **vérifié comme le champ de l'application**. Une valeur inutilisable
     * est ramenée à la chaîne vide (voir `normaliserWebhookDiscord`) : le canal reste muet et le dit
     * au journal, au lieu de porter un secret mal formé jusqu'à `fetch()`.
     */
    DISCORD_WEBHOOK_URL: z
      .string()
      .default("")
      .transform((v) => normaliserWebhookDiscord(v, (m) => console.warn(m))),
    /**
     * Canal Telegram : jeton du bot (@BotFather) et identifiant du salon. Les deux se règlent aussi
     * dans l'application, où ils sont rangés **chiffrés** en base — et la base gagne sur ces
     * variables (voir `getTelegramReglage`).
     */
    TELEGRAM_BOT_TOKEN: z.string().default(""),
    TELEGRAM_CHAT_ID: z.string().default(""),
    /**
     * Origine autorisée à lire l'API publique **depuis un navigateur** (le site du club).
     * Vide par défaut : un club qui n'a pas de site n'ouvre rien à personne, et le plugin
     * WordPress, qui appelle côté serveur, n'en a pas besoin.
     */
    PUBLIC_API_ORIGIN: z.string().default(""),
    ADMIN_EMAIL: z.string().default(""),
    ADMIN_PASSWORD: z.string().default(""),
    /** "1" : écrit les emails dans previews/emails/ au lieu de les envoyer — hors production uniquement */
    EMAIL_MODE_FICHIER: z.string().default(""),
    ADMIN_PRENOM: z.string().default(""),
    ADMIN_NOM: z.string().default(""),
    /**
     * **Le nom du club, au premier démarrage.** L'identité vit en base et se règle dans l'espace
     * admin (voir `src/lib/identite.ts`) ; ces deux variables ne servent qu'à nommer une instance
     * neuve, avant que quiconque ait ouvert cet écran — pratique pour déployer l'image et voir tout
     * de suite le bon nom sur l'écran de connexion. Un réglage fait dans l'application les emporte.
     */
    CLUB_NOM: z.string().default(""),
    CLUB_SIGLE: z.string().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== "production") return;
    // En production, le domaine public doit être renseigné : les liens des emails en dépendent.
    if (HOTE_LOCAL.test(v.DOMAIN.replace(/^https?:\/\//i, ""))) {
      ctx.addIssue({ code: "custom", path: ["DOMAIN"], message: "DOMAIN doit être le domaine public de l'application en production (valeur locale refusée)." });
    }
  });

export type Env = z.infer<typeof schema>;

let cache: Env | null = null;

export function env(): Env {
  if (cache) return cache;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration invalide : ${details}`);
  }
  cache = parsed.data;
  return cache;
}

/**
 * URL publique de base, sans slash final.
 * `DOMAIN` peut porter son schéma (« http://192.168.1.20:3000 ») : c'est le seul moyen de servir
 * l'application en clair sur une adresse IP d'un réseau interne, sans certificat. Sinon, https,
 * sauf pour un hôte local où l'on sait qu'il n'y a pas de TLS.
 */
export function baseUrl(): string {
  const domain = env().DOMAIN.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(domain)) return domain;
  const proto = HOTE_LOCAL.test(domain) ? "http" : "https";
  return `${proto}://${domain}`;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

/** Une adresse email plausible : de quoi refuser un expéditeur que le serveur SMTP rejettera. */
const ADRESSE = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[A-Za-z]{2,}$/;

/**
 * **Expéditeur des emails, nettoyé.** Règle pure, testable sans environnement : `SMTP_FROM` si elle
 * est utilisable, sinon un repli construit sur le domaine public.
 *
 * **Pourquoi ce nettoyage** : le serveur SMTP répondait `501 5.1.7 Bad sender address syntax` et
 * plus aucun lien ne partait. La cause : les **guillemets** de `.env.example` recopiés tels quels
 * dans les variables de la stack Portainer — un fichier `.env` les retire, Portainer non.
 * L'expéditeur valait littéralement `"HEMA <contact@…>"`, guillemets compris, et le serveur refusait
 * l'enveloppe. Une paire de guillemets ne doit pas couper les emails de tout un club.
 *
 * Ce qui est corrigé : les espaces autour, les guillemets (ou apostrophes) qui entourent **toute**
 * la valeur, ceux qui entourent le seul nom d'affichage. Ce qui ne contient aucune adresse
 * reconnaissable retombe sur `no-reply@<domaine>` plutôt que de faire échouer l'envoi.
 */
export function normaliserExpediteur(smtpFrom: string, domain: string, smtpUser = "", nomApp: string = NOM_APP_LIVRE): string {
  /*
   * **Le repli tape d'abord dans la boîte authentifiée.** Beaucoup de serveurs n'acceptent d'envoyer
   * qu'au nom du compte qui vient de s'authentifier ; une adresse `no-reply@…` inventée sur le
   * domaine public serait refusée à son tour, et on remplacerait une erreur par une autre.
   */
  const identifiant = smtpUser.trim();
  const repli = ADRESSE.test(identifiant)
    ? `${nomApp} <${identifiant}>`
    : `${nomApp} <no-reply@${domain.replace(/:\d+$/, "")}>`;
  const valeur = deguillemeter(smtpFrom);
  if (!valeur) return repli;
  const chevrons = valeur.match(/^(.*)<([^<>]+)>$/);
  const adresse = (chevrons ? chevrons[2] : valeur).trim();
  if (!ADRESSE.test(adresse)) return repli;
  const nom = chevrons ? chevrons[1].trim().replace(/^["']|["']$/g, "").trim() : "";
  return nom ? `${nom} <${adresse}>` : adresse;
}

/**
 * Expéditeur effectif de cette instance (voir `normaliserExpediteur`).
 *
 * `nomApp` est le nom du club, que l'appelant a déjà lu (le facteur d'emails, lui, est asynchrone) :
 * il n'apparaît que dans le **repli**, quand `SMTP_FROM` n'est pas utilisable. Omis, c'est le nom
 * livré avec le code — cette fonction reste synchrone, et rien ici ne touche la base.
 */
export function expediteur(nomApp?: string): string {
  const e = env();
  return normaliserExpediteur(e.SMTP_FROM, e.DOMAIN, e.SMTP_USER, nomApp?.trim() || NOM_APP_LIVRE);
}

/** L'expéditeur configuré est-il utilisable tel quel ? (l'écran des paramètres techniques le dit) */
export function expediteurCorrige(): boolean {
  return env().SMTP_FROM.trim() !== "" && env().SMTP_FROM.trim() !== expediteur();
}

/**
 * Béquilles de développement : drapeaux d'environnement qui affaiblissent volontairement l'application
 * (limiteur de débit, tâches planifiées, emails écrits sur disque, plafond d'appareils par lien).
 * Elles sont **inconditionnellement neutralisées en production** : aucun `.env` ne peut les y réactiver.
 */
export const BEQUILLES_DEV = ["RATE_LIMIT_DISABLED", "CRON_DISABLED", "EMAIL_MODE_FICHIER", "LIEN_MAX_APPAREILS"] as const;
export type BequilleDev = (typeof BEQUILLES_DEV)[number];

/** Valeur d'une béquille hors production (`undefined` en production, ou si elle n'est pas définie). */
export function bequilleDev(nom: BequilleDev): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const valeur = process.env[nom];
  return valeur ? valeur : undefined;
}

/** La béquille est-elle activée ("1") ? Toujours `false` en production. */
export function bequilleDevActive(nom: BequilleDev): boolean {
  return bequilleDev(nom) === "1";
}
