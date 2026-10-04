import { db } from "@/lib/db";
import { CHEMIN_API_ANNONCES } from "@/lib/constants";
import { masquer } from "@/lib/crypto";
import { baseUrl, env, isProduction } from "@/lib/env";
import { getDiscordWebhookUrl, isPublicApiEnabled } from "@/lib/settings";
import {
  CANAUX,
  LIBELLES_CANAUX,
  estCanalExposition,
  notificationActiveDans,
  getPreferencesNotifications,
  type Canal,
  type PreferencesNotifications,
  type TypeNotification,
} from "./preferences";
import { pushConfigure } from "./push";
import { salonsDiscord } from "./webhooks";
import { getTelegramReglage, masquerJeton } from "./telegram";
import { VARIABLE_API_WHATSAPP, whatsappConfigure } from "./whatsapp";

/**
 * **État des canaux d'envoi** — source unique de vérité, partagée par :
 *
 * - la grille du panneau « Notifications » (une case grisée quand le canal ne peut rien envoyer) ;
 * - les pages dédiées `/admin/notifications/{email,push,discord,telegram,whatsapp,api}` ;
 * - les envois eux-mêmes (`envoiPossible`), pour qu'un canal non branché ne parte jamais ;
 * - et l'**exposition** sur le site du club (`expositionPossible`), le seul canal qui n'envoie rien.
 *
 * Deux états distincts, volontairement :
 *
 * - `configure` — le canal est réglé comme il doit l'être en production (SMTP renseigné, webhook
 *   collé, service WhatsApp branché). C'est ce que racontent les pages dédiées.
 * - `operationnel` — un envoi peut **aboutir maintenant**. C'est ce qui grise les cases et ce que
 *   vérifient les envois. La nuance ne joue que pour l'email : hors production, sans SMTP, les
 *   emails sont écrits dans `previews/emails` (mode fichier) — le canal reste donc utilisable en
 *   développement. WhatsApp, lui, n'est jamais opérationnel tant que l'envoi automatique n'est pas
 *   écrit (`envoyerWhatsApp` lève), même si les variables sont renseignées.
 */
export type EtatCanal = {
  canal: Canal;
  libelle: string;
  /** Réglé comme en production (SMTP / webhook / service WhatsApp) */
  configure: boolean;
  /** Un envoi peut aboutir maintenant : c'est ce qui grise les cases et bloque les envois */
  operationnel: boolean;
  /** Une phrase d'état, affichable telle quelle */
  resume: string;
  /** Détail non secret (valeur masquée, origine du réglage) */
  detail?: string;
  /** Page de configuration dédiée du canal */
  lienConfig: string;
};

export type EtatsCanaux = Record<Canal, EtatCanal>;

export function lienConfigurationCanal(canal: Canal): string {
  return `/admin/notifications/${canal}`;
}

/**
 * Ce qu'on affiche dans l'infobulle d'une case grisée, et dans le message du serveur.
 *
 * **Le site du club a sa propre phrase** : « Site du club n'est pas configuré » ne voudrait rien dire
 * — il n'y a rien à y configurer, la route existe depuis toujours. Ce qui manque, c'est une décision
 * du bureau, et la phrase doit dire laquelle et où on la prend.
 */
export function raisonCanalIndisponible(etat: EtatCanal): string {
  if (estCanalExposition(etat.canal)) return "La publication des cours n'est pas ouverte (carte « Publication des cours sur le site du club »)";
  return `${etat.libelle} n'est pas configuré`;
}

async function etatEmail(): Promise<EtatCanal> {
  const e = env();
  const configure = e.SMTP_HOST.trim() !== "";
  return {
    canal: "email",
    libelle: LIBELLES_CANAUX.email,
    configure,
    // Hors production, le mode fichier (previews/emails) tient lieu de serveur d'envoi.
    operationnel: configure || !isProduction(),
    resume: configure
      ? `Serveur ${e.SMTP_HOST}:${e.SMTP_PORT}`
      : isProduction()
        ? "Aucun serveur SMTP : plus aucun email ne peut partir."
        : "Aucun serveur SMTP : en développement, les emails sont écrits dans previews/emails.",
    detail: configure ? `Expéditeur ${e.SMTP_FROM || "(repli sur le domaine)"}` : undefined,
    lienConfig: lienConfigurationCanal("email"),
  };
}

/**
 * Le canal Discord peut envoyer dès qu'**un** salon est branché : le salon principal, ou l'un des
 * salons dédiés à une notification. Sans cette seconde condition, un club qui n'aurait réglé que le
 * salon du récap verrait toutes ses cases grisées et rien ne partirait — alors qu'il a bel et bien
 * un salon.
 */
async function etatDiscord(): Promise<EtatCanal> {
  const [{ url, source }, dedies] = await Promise.all([getDiscordWebhookUrl(), salonsDiscord()]);
  const nombreDedies = Object.keys(dedies).length;
  const branche = url !== "" || nombreDedies > 0;
  const dedie = nombreDedies > 0 ? ` + ${nombreDedies} salon${nombreDedies > 1 ? "s" : ""} dédié${nombreDedies > 1 ? "s" : ""}` : "";
  return {
    canal: "discord",
    libelle: LIBELLES_CANAUX.discord,
    configure: branche,
    operationnel: branche,
    resume: branche ? "Salon branché" : "Aucun salon branché",
    detail: url
      ? `${masquer(url, 28)} (${source === "app" ? "collé dans l'application" : "variable d'environnement de la stack"})${dedie}`
      : nombreDedies > 0
        ? `Aucun salon principal,${dedie.replace(" +", "")} : les autres notifications ne partent pas.`
        : undefined,
    lienConfig: lienConfigurationCanal("discord"),
  };
}

/**
 * **Telegram** : un jeton de bot et un identifiant de salon, et le canal est prêt.
 *
 * Il n'y a rien de plus à vérifier ici : la validité réelle du jeton ne se connaît qu'en appelant
 * Telegram, ce que fait l'écran du canal (`verifierBot`) au moment où on l'enregistre. Répéter cet
 * appel à chaque affichage de la grille des notifications coûterait une requête réseau par page.
 */
async function etatTelegram(): Promise<EtatCanal> {
  const { token, chatId, source } = await getTelegramReglage();
  const branche = source !== "aucune";
  return {
    canal: "telegram",
    libelle: LIBELLES_CANAUX.telegram,
    configure: branche,
    operationnel: branche,
    resume: branche ? "Salon branché" : "Aucun bot ni salon réglé",
    detail: branche
      ? `Bot ${masquerJeton(token)} → salon ${chatId} (${source === "app" ? "réglé dans l'application" : "variables d'environnement de la stack"})`
      : undefined,
    lienConfig: lienConfigurationCanal("telegram"),
  };
}

async function etatWhatsApp(): Promise<EtatCanal> {
  const configure = whatsappConfigure();
  return {
    canal: "whatsapp",
    libelle: LIBELLES_CANAUX.whatsapp,
    configure,
    // L'envoi automatique n'existe pas encore : le canal reste éteint même si les variables sont là.
    operationnel: false,
    resume: configure
      ? `Service déclaré (${VARIABLE_API_WHATSAPP}) mais l'envoi automatique n'est pas encore écrit.`
      : "Aucun service d'envoi : il faut un numéro dédié et un conteneur WAHA/Baileys.",
    detail: "Le partage manuel en un geste depuis une séance reste disponible.",
    lienConfig: lienConfigurationCanal("whatsapp"),
  };
}

/**
 * Le push n'a **rien à configurer** : la paire de clés VAPID se crée toute seule au premier besoin
 * et vit chiffrée en base. Ce qui peut manquer, ce sont des appareils abonnés — et cela se règle
 * dans « Mon profil », appareil par appareil, pas ici. L'état le dit plutôt que de faire croire à
 * un réglage oublié côté serveur.
 */
async function etatPush(): Promise<EtatCanal> {
  const pret = await pushConfigure();
  const appareils = pret ? await db.pushAbonnement.count() : 0;
  return {
    canal: "push",
    libelle: LIBELLES_CANAUX.push,
    configure: pret,
    operationnel: pret,
    resume: !pret
      ? "Les clés d'envoi n'ont pas pu être créées : regarde les journaux du serveur."
      : appareils === 0
        ? "Aucun appareil abonné pour l'instant : chacun active les notifications depuis « Mon profil »."
        : `${appareils} appareil${appareils > 1 ? "s" : ""} abonné${appareils > 1 ? "s" : ""}.`,
    detail: "Sur iPhone, il faut d'abord ajouter l'application à l'écran d'accueil (iOS 16.4 ou plus récent).",
    lienConfig: lienConfigurationCanal("push"),
  };
}

/**
 * **Site du club** — le canal qui n'envoie rien.
 *
 * Il n'a rien à brancher : la route `GET /api/public/annonces` existe, elle répond. Ce qui décide
 * qu'elle publie, c'est la **case « Publier les prochains cours »** de la carte *Publication des
 * cours sur le site du club* — la même que celle de l'API des prochains cours, et c'est voulu : une
 * seule porte pour « le club publie-t-il sur son site, oui ou non ? ».
 *
 * « Opérationnel » veut donc dire ici **la publication est ouverte**. Fermée, la colonne de la
 * matrice est grisée et dit pourquoi (`raisonCanalIndisponible`), exactement comme un webhook
 * Discord absent grise la sienne. `configure` vaut la même chose : pour ce canal, être configuré et
 * pouvoir publier sont une seule et même question.
 */
async function etatApi(): Promise<EtatCanal> {
  const ouverte = await isPublicApiEnabled();
  return {
    canal: "api",
    libelle: LIBELLES_CANAUX.api,
    configure: ouverte,
    operationnel: ouverte,
    resume: ouverte
      ? "Publication ouverte : le site du club peut lire les annonces cochées ci-dessous."
      : "Publication fermée : rien ne sort tant que « Publier les prochains cours » n'est pas cochée.",
    // **Rien ne part par ce canal.** La phrase le dit à l'écran, pour que personne ne cherche un
    // journal d'envoi ni un bouton de test qui n'existent pas.
    detail: `Rien n'est envoyé : c'est le site qui vient lire ${baseUrl()}${CHEMIN_API_ANNONCES}.`,
    lienConfig: lienConfigurationCanal("api"),
  };
}

/** État d'un canal (lecture seule, sans secret). */
export async function etatCanal(canal: Canal): Promise<EtatCanal> {
  if (canal === "email") return etatEmail();
  if (canal === "push") return etatPush();
  if (canal === "discord") return etatDiscord();
  if (canal === "telegram") return etatTelegram();
  if (canal === "api") return etatApi();
  return etatWhatsApp();
}

/** État de tous les canaux, en une fois (une seule lecture de la base par canal qui en a besoin). */
export async function etatsCanaux(): Promise<EtatsCanaux> {
  const [email, push, discord, telegram, whatsapp, api] = await Promise.all([
    etatEmail(),
    etatPush(),
    etatDiscord(),
    etatTelegram(),
    etatWhatsApp(),
    etatApi(),
  ]);
  return { email, push, discord, telegram, whatsapp, api };
}

/** Table `canal → peut envoyer maintenant`, telle que l'attendent les fonctions pures de preferences.ts. */
export function canauxOperationnels(etats: EtatsCanaux): Record<Canal, boolean> {
  const sortie = {} as Record<Canal, boolean>;
  for (const canal of CANAUX) sortie[canal] = etats[canal].operationnel;
  return sortie;
}

/** Un envoi peut-il aboutir sur ce canal ? (webhook collé, SMTP présent…) */
export async function canalOperationnel(canal: Canal): Promise<boolean> {
  return (await etatCanal(canal)).operationnel;
}

/**
 * **Point de passage unique avant tout envoi** : les réglages du panneau ET l'état réel du canal.
 * Un canal non branché ne part jamais — et ne fait jamais échouer l'action en cours.
 *
 * Elle répond à « **est-ce que ça part ?** », jamais à « à qui ? ». Sur le canal email, le second
 * point se tranche ailleurs, et volontairement : `modeEnvoiDans` (preferences.ts) dit si le message
 * part à chacun ou en un seul exemplaire sur l'adresse de liste du club. Les deux questions sont
 * indépendantes — couper une notification et changer sa façon de partir ne se décident pas au même
 * endroit, et n'ont pas les mêmes conséquences.
 */
export async function envoiPossible(type: TypeNotification, canal: Canal): Promise<boolean> {
  /*
   * **Rien ne s'envoie sur un canal d'exposition.** La question « est-ce que ça part ? » n'a pas de
   * sens pour le site du club : il ne part rien, quelqu'un vient lire. Répondre `true` ici serait
   * l'invitation à écrire une boucle d'envoi « vers le site », qui n'aurait aucune destination — et
   * répondre `true` sans rien envoyer ferait croire à un envoi. On répond donc `false`, et la
   * question de l'exposition se pose ailleurs, sous son propre nom : {@link expositionPossible}.
   */
  if (estCanalExposition(canal)) return false;
  const prefs = await getPreferencesNotifications();
  if (!notificationActiveDans(prefs, type, canal)) return false;
  return canalOperationnel(canal);
}

/**
 * **Les deux portes du site du club, lues une seule fois.**
 *
 * `getSetting` n'est pas mémoïsé (contrairement à `identite`) : demander `expositionPossible` type
 * par type relisait les préférences **et** l'interrupteur à chaque appel — quatre à sept lectures
 * pour une réponse qui ne change pas d'un type à l'autre. On lit les deux portes une fois, et on les
 * passe.
 */
export type PortesExposition = { prefs: PreferencesNotifications; etat: EtatCanal };

/** Les deux portes du canal « Site du club » : les préférences du club, et l'état de la publication. */
export async function portesExposition(): Promise<PortesExposition> {
  const [prefs, etat] = await Promise.all([getPreferencesNotifications(), etatApi()]);
  return { prefs, etat };
}

/**
 * **Point de passage unique avant de publier une annonce sur le site du club** — le pendant de
 * `envoiPossible` pour le seul canal qui n'envoie rien.
 *
 * Les **deux portes**, dans cet ordre :
 *
 * 1. la **case de la notification** est cochée dans la colonne « Site du club » — et l'interrupteur
 *    du canal est coché, ce que `notificationActiveDans` exige aussi : c'est **lui** qui coupe les six
 *    colonnes d'un coup, et il se décoche sur l'écran des notifications comme les cinq autres ;
 * 2. la **publication est ouverte** (`isPublicApiEnabled`, via `etatApi().operationnel`) : fermée,
 *    elle coupe tout d'un coup, sans rien changer aux cases de la matrice.
 *
 * **Tout écran qui annonce ce qui sort passe par ici**, jamais par `prefs.notifications[type].api`
 * lu en direct : la page du canal l'a fait et affichait « 1 annonce republiée » quand la route
 * rendait `annonces: []` — l'interrupteur du canal étant décoché. La seule page dont l'objet est de
 * dire ce qui sort disait le contraire de la vérité.
 *
 * Elle ne dit rien de *qui* lit — il n'y a personne à retenir, et rien de ce qui sort ne nomme
 * quiconque (liste blanche de `src/lib/api-publique.ts`).
 */
export async function expositionPossible(type: TypeNotification, portes?: PortesExposition): Promise<boolean> {
  const { prefs, etat } = portes ?? (await portesExposition());
  if (!notificationActiveDans(prefs, type, "api")) return false;
  return etat.operationnel;
}
