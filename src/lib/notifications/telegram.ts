import { chiffrer, dechiffrer, masquer } from "@/lib/crypto";
import { env } from "@/lib/env";
import { CLES, getSetting, setSetting } from "@/lib/settings";
import type { DiscordEmbed } from "./discord";

/**
 * **Canal Telegram** : les messages collectifs du club (récap de la veille, annulation, « peu de
 * monde », nouvel événement) dans un groupe ou un canal Telegram.
 *
 * **Pourquoi Telegram à côté de Discord.** Tous les clubs ne vivent pas sur Discord ; beaucoup
 * tiennent un groupe Telegram, que tout le monde a déjà sur son téléphone. Le canal est donc un
 * **deuxième débouché du même contenu**, pas une fonctionnalité à part : les messages sont mis en
 * forme une seule fois (`src/lib/notifications/contenu.ts`, sous forme d'embed) et ce module les
 * transcrit. Ce qui change entre les deux canaux, c'est le transport.
 *
 * **Deux valeurs suffisent** : le jeton du bot (`@BotFather`) et l'identifiant du salon (`chat_id`).
 * Elles se règlent dans l'espace admin — **rangées chiffrées** dans la table `Setting`, comme le
 * webhook Discord, ce qui les fait survivre aux mises à jour de l'image puisqu'elles vivent dans le
 * volume de données — et, à défaut, dans les variables `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`.
 *
 * **Ce module ne lève jamais pour une raison de configuration** : un canal non branché répond
 * « non configuré », il ne casse pas l'action de l'utilisateur qui vient d'annuler une séance.
 */

/** L'API des bots. Une constante, parce qu'un test doit pouvoir la reconnaître dans l'URL appelée. */
export const TELEGRAM_API = "https://api.telegram.org";

/**
 * Forme d'un jeton de bot : `<identifiant numérique>:<35 caractères>`.
 *
 * Vérifié avant l'enregistrement pour une raison précise : un jeton mal recopié (espace, guillemets
 * d'un copier-coller) produirait un 401 à chaque envoi, silencieusement, des semaines durant. Mieux
 * vaut refuser la saisie que découvrir la panne au premier cours annulé. Ce n'est pas une garantie
 * de validité — seul `verifierBot()` le dit — mais ça élimine les fautes de frappe.
 */
export const JETON_BOT = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

/**
 * Identifiant de salon : un nombre (un groupe commence par `-`, un canal privé par `-100`) ou un
 * nom public `@monsalon`.
 */
export const CHAT_ID = /^(-?\d{4,}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

export type ReglageTelegram = {
  token: string;
  chatId: string;
  /** D'où vient le réglage : l'application (base, chiffré), l'environnement, ou nulle part. */
  source: "app" | "env" | "aucune";
};

const VIDE: ReglageTelegram = { token: "", chatId: "", source: "aucune" };

/**
 * Le réglage effectif : **la base d'abord** (écran d'administration), l'environnement ensuite.
 *
 * Même ordre que le webhook Discord, et pour la même raison : on doit pouvoir rebrancher un canal
 * depuis l'application, sans toucher à la stack ni redémarrer le conteneur.
 */
export async function getTelegramReglage(): Promise<ReglageTelegram> {
  const stocke = await getSetting(CLES.telegram);
  if (stocke) {
    const clair = dechiffrer(stocke);
    if (clair) {
      try {
        const valeur = JSON.parse(clair) as { token?: unknown; chatId?: unknown };
        const token = typeof valeur.token === "string" ? valeur.token.trim() : "";
        const chatId = typeof valeur.chatId === "string" ? valeur.chatId.trim() : "";
        if (token && chatId) return { token, chatId, source: "app" };
      } catch {
        // Réglage abîmé : on retombe sur l'environnement plutôt que de couper le canal sans rien dire.
      }
    }
  }
  const e = env();
  const token = e.TELEGRAM_BOT_TOKEN.trim();
  const chatId = e.TELEGRAM_CHAT_ID.trim();
  return token && chatId ? { token, chatId, source: "env" } : VIDE;
}

/**
 * Enregistre (ou efface) le réglage. Les deux valeurs vont **ensemble** : un jeton sans salon
 * n'envoie rien, et garder la moitié d'un réglage ne ferait qu'entretenir une illusion de canal
 * branché dans l'écran d'administration.
 */
export async function setTelegramReglage(valeur: { token: string; chatId: string } | null): Promise<void> {
  if (!valeur || !valeur.token.trim() || !valeur.chatId.trim()) {
    await setSetting(CLES.telegram, null);
    return;
  }
  await setSetting(CLES.telegram, chiffrer(JSON.stringify({ token: valeur.token.trim(), chatId: valeur.chatId.trim() })));
}

export async function telegramConfigure(): Promise<boolean> {
  return (await getTelegramReglage()).source !== "aucune";
}

/**
 * **L'identifiant du bot, et rien de son jeton** (`123456789:••••••••••••`).
 *
 * Un jeton Telegram s'écrit `<identifiant numérique>:<35 caractères secrets>`. Cette fonction en
 * montrait les **quatre derniers**, pour aider à reconnaître le bon jeton d'un coup d'œil — c'est
 * exactement l'anti-motif que `masquer()` a corrigé dans `src/lib/crypto.ts`, avec dix lignes
 * d'explication : la fin d'un secret est le mauvais bout, parce qu'elle part dans une capture d'écran
 * ou un partage d'écran sans que personne n'y pense. Ici la valeur s'affiche dans l'espace admin
 * (`canaux.ts`), donc précisément là où l'on fait des captures pour demander de l'aide.
 *
 * Quatre caractères sur trente-cinq ne cassaient rien. Ce qui ne tenait pas, c'est d'avoir deux
 * règles opposées pour la même chose dans le même dépôt : la prochaine valeur masquée aurait suivi
 * celle des deux qu'on aurait lue en premier. L'identifiant, lui, **n'est pas un secret** (il est
 * public, tout le monde peut écrire au bot) et suffit à reconnaître de quel bot il s'agit.
 */
export function masquerJeton(token: string): string {
  const t = token.trim();
  if (!t) return "";
  const [identifiant, ...reste] = t.split(":");
  // Un jeton sans `:` n'a pas d'identifiant public à montrer : on ne montre rien.
  return reste.length === 0 ? masquer(t, 0) : `${identifiant}:${masquer(reste.join(":"), 0)}`;
}

/* ------------------------------------------------------------------ */
/* Mise en forme                                                       */
/* ------------------------------------------------------------------ */

/** Les trois caractères que Telegram interprète en mode HTML. */
export function echapperTelegram(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * **L'embed devient un message Telegram**, en HTML restreint (`<b>`, `<i>`, `<a>`).
 *
 * C'est le cœur du choix d'architecture : le contenu n'est écrit qu'une fois, sous la forme d'embed
 * (`embedSeance`, `embedAnnulation`…), et chaque transport le rend à sa façon. Telegram n'a pas de
 * champs ni de couleur : le titre devient une ligne en gras, chaque champ une ligne
 * « <b>nom</b> — valeur », le pied une ligne en italique. Rien n'est perdu de ce qui se lit.
 *
 * Fonction **pure**, donc vérifiable sans réseau : c'est elle qui porte tout le risque de forme
 * (échappement compris), et l'appel réseau n'en porte aucun.
 */
export function texteTelegram(embed: DiscordEmbed): string {
  const lignes: string[] = [];
  if (embed.title) {
    const titre = `<b>${echapperTelegram(embed.title)}</b>`;
    // Un titre cliquable, quand l'embed en portait un : c'est le lien vers la page de l'annonce.
    lignes.push(embed.url ? `<a href="${echapperTelegram(embed.url)}">${titre}</a>` : titre);
  }
  if (embed.description) lignes.push(echapperTelegram(embed.description));
  for (const champ of embed.fields ?? []) {
    const valeur = echapperTelegram(champ.value).trim();
    lignes.push(valeur ? `<b>${echapperTelegram(champ.name)}</b> — ${valeur}` : `<b>${echapperTelegram(champ.name)}</b>`);
  }
  if (embed.footer?.text) lignes.push(`<i>${echapperTelegram(embed.footer.text)}</i>`);
  // Une ligne vide entre les blocs : sur Telegram, un pavé de six lignes collées ne se lit pas.
  return lignes.join("\n\n");
}

/** Plafond d'un message Telegram (4096 caractères). Au-delà, l'API refuse tout le message. */
export const MESSAGE_MAX = 4096;

/** Tronque proprement, sur une fin de ligne quand c'est possible, en le disant. */
export function tronquerTelegram(texte: string): string {
  if (texte.length <= MESSAGE_MAX) return texte;
  const coupe = texte.slice(0, MESSAGE_MAX - 1);
  const retour = coupe.lastIndexOf("\n");
  return `${(retour > MESSAGE_MAX / 2 ? coupe.slice(0, retour) : coupe).trimEnd()}…`;
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/**
 * Attente demandée par Telegram en cas de 429 : `parameters.retry_after`, en secondes.
 * Plafonnée à 30 s — au-delà, l'envoi sera rejoué au prochain passage plutôt que de retenir la file.
 */
export function attenteRetryTelegram(corps: unknown): number {
  const params = (corps as { parameters?: { retry_after?: unknown } } | null)?.parameters;
  const secondes = typeof params?.retry_after === "number" && Number.isFinite(params.retry_after) ? params.retry_after : 1;
  return Math.min(30_000, Math.max(0, Math.ceil(secondes * 1000)));
}

/** Message d'erreur lisible à partir de la réponse de l'API (`description`), sans jamais le jeton. */
export function messageErreurTelegram(statut: number, corps: unknown): string {
  const description = (corps as { description?: unknown } | null)?.description;
  const detail = typeof description === "string" && description.trim() ? ` — ${description.trim().slice(0, 200)}` : "";
  if (statut === 401) return `Telegram : jeton refusé (401)${detail}`;
  if (statut === 403) return `Telegram : le bot n'a pas accès à ce salon (403)${detail}. Ajoute-le au groupe.`;
  if (statut === 400) return `Telegram : demande refusée (400)${detail}`;
  return `Telegram : réponse ${statut}${detail}`;
}

type Issue = { ok: true; corps: unknown } | { ok: false; erreur: Error };

/**
 * Un appel à l'API du bot, avec ce qui mérite d'être partagé : la limite de débit (429 +
 * `retry_after`), le renoncement immédiat sur une 4xx (un jeton refusé ne s'arrangera pas en
 * réessayant) et le réessai avec attente sur une 5xx. Même doctrine que `appelerDiscord`.
 *
 * Ne lève pas : l'issue est rendue à l'appelant.
 */
async function appelerTelegram(token: string, methode: string, charge: unknown, tentatives = 3): Promise<Issue> {
  let derniere: Error | null = null;
  for (let i = 0; i < tentatives; i++) {
    let res: Response;
    try {
      res = await fetch(`${TELEGRAM_API}/bot${token}/${methode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(charge),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      return { ok: false, erreur: e instanceof Error ? e : new Error(String(e)) };
    }
    const corps = await res.json().catch(() => null);
    if (res.ok) return { ok: true, corps };
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, attenteRetryTelegram(corps)));
      derniere = new Error("Telegram : limite de débit atteinte (429)");
      continue;
    }
    derniere = new Error(messageErreurTelegram(res.status, corps));
    if (res.status >= 400 && res.status < 500) return { ok: false, erreur: derniere };
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  return { ok: false, erreur: derniere ?? new Error("Telegram : échec inconnu") };
}

/**
 * Publie un message dans le salon réglé. Lève en cas d'échec — c'est l'appelant
 * (`publierSurTelegram`, src/lib/notifications/salon.ts) qui journalise et avale.
 *
 * `disable_web_page_preview` : les messages portent un lien vers l'application, et la vignette que
 * Telegram en tirerait doublerait le message d'une carte inutile sur un écran de téléphone.
 */
export async function envoyerTelegram(texte: string, reglage?: ReglageTelegram): Promise<void> {
  const r = reglage ?? (await getTelegramReglage());
  if (r.source === "aucune") throw new Error("Telegram : aucun jeton ni salon réglé.");
  const issue = await appelerTelegram(r.token, "sendMessage", {
    chat_id: r.chatId,
    text: tronquerTelegram(texte),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (!issue.ok) throw issue.erreur;
}

/**
 * Vérifie un jeton **sans rien publier** (`getMe`) : c'est ce que l'écran d'administration appelle
 * quand on enregistre, pour dire tout de suite « bot reconnu : @mon_bot » au lieu de laisser
 * découvrir un jeton fautif au premier cours annulé.
 */
export async function verifierBot(token: string): Promise<{ ok: true; nom: string } | { ok: false; erreur: string }> {
  const issue = await appelerTelegram(token, "getMe", {}, 1);
  if (!issue.ok) return { ok: false, erreur: issue.erreur.message };
  const resultat = (issue.corps as { result?: { username?: unknown; first_name?: unknown } } | null)?.result;
  const nom = typeof resultat?.username === "string" ? `@${resultat.username}` : typeof resultat?.first_name === "string" ? resultat.first_name : "bot";
  return { ok: true, nom };
}

export type SalonRecent = { id: string; nom: string };

/**
 * Les salons où le bot a vu passer un message récemment (`getUpdates`).
 *
 * **Pourquoi cet appel existe.** Trouver un `chat_id` est le seul vrai obstacle à la mise en route :
 * la marche à suivre habituelle consiste à ouvrir soi-même une URL d'API dans son navigateur et à
 * lire du JSON — ce qu'on ne peut pas demander au bureau d'un club. L'écran fait donc le relevé :
 * on ajoute le bot au groupe, on y écrit « bonjour », on appuie sur « Chercher mes salons », et on
 * choisit dans une liste.
 *
 * Telegram ne garde ces événements que 24 h, et un salon dont personne n'a parlé depuis n'apparaît
 * pas : la saisie à la main reste donc possible à côté.
 */
export async function salonsRecents(token: string): Promise<SalonRecent[]> {
  const issue = await appelerTelegram(token, "getUpdates", { limit: 100, allowed_updates: ["message", "channel_post"] }, 1);
  if (!issue.ok) return [];
  const resultats = (issue.corps as { result?: unknown } | null)?.result;
  if (!Array.isArray(resultats)) return [];
  const vus = new Map<string, string>();
  for (const brut of resultats) {
    const chat = ((brut as { message?: { chat?: unknown }; channel_post?: { chat?: unknown } }).message?.chat ??
      (brut as { channel_post?: { chat?: unknown } }).channel_post?.chat) as
      | { id?: unknown; title?: unknown; username?: unknown; first_name?: unknown }
      | undefined;
    if (typeof chat?.id !== "number") continue;
    const nom =
      typeof chat.title === "string"
        ? chat.title
        : typeof chat.username === "string"
          ? `@${chat.username}`
          : typeof chat.first_name === "string"
            ? chat.first_name
            : "sans nom";
    vus.set(String(chat.id), nom);
  }
  return [...vus].map(([id, nom]) => ({ id, nom }));
}
