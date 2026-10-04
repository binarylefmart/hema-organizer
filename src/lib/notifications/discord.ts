import { baseUrl } from "@/lib/env";
import { identite, type Identite } from "@/lib/identite";

/**
 * Envoi brut vers un webhook Discord (POST/PATCH/DELETE JSON), sans bibliothèque tierce.
 * Gère le rate limit (429 + retry_after) avec 3 tentatives.
 *
 * Deux verbes, parce qu'un salon doit pouvoir rester **à jour** et pas seulement recevoir :
 * - `posterDiscord` / `posterEtRetenirId` — écrire un message (le second garde son identifiant) ;
 * - `editerMessageDiscord` — corriger un message déjà posté, plutôt que d'en empiler un second.
 */
export type DiscordEmbed = {
  title?: string;
  description?: string;
  /** Rend le titre cliquable (la page de l'annonce dans l'application) */
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  /** Affiche (image) montrée en grand sous le texte — URL absolue, publiquement lisible */
  image?: { url: string };
  footer?: { text: string };
  timestamp?: string;
};

/**
 * Ce que le transport a besoin de savoir du club : **son nom** (l'auteur affiché du message) et
 * **son écu** (l'avatar). Un objet réduit plutôt que l'identité entière, pour que les fonctions
 * pures ci-dessous se testent avec deux champs et sans base.
 */
export type ClubDiscord = Pick<Identite, "nomClub" | "ecu">;

export const COULEUR_BLEU = 0x074d95;
export const COULEUR_ROUGE = 0xe50d30;
/** Or de la charte : rehaut d'alerte (effectif faible), jamais une annulation. */
export const COULEUR_OR = 0xfdc71f;

/** Attente demandée par Discord en cas de 429 : corps JSON (`retry_after`, en secondes) ou en-tête. */
export function attenteRetry(retryAfterJson: unknown, enteteRetryAfter: string | null): number {
  const depuisJson = typeof retryAfterJson === "number" && Number.isFinite(retryAfterJson) ? retryAfterJson : null;
  const depuisEntete = enteteRetryAfter !== null && enteteRetryAfter.trim() !== "" && Number.isFinite(Number(enteteRetryAfter)) ? Number(enteteRetryAfter) : null;
  const secondes = depuisJson ?? depuisEntete ?? 1;
  return Math.min(30_000, Math.max(0, Math.ceil(secondes * 1000)));
}

/**
 * L'avatar du webhook — **seulement si Discord peut l'accepter**.
 *
 * Discord valide `avatar_url` à la réception et **refuse tout le message (400)** si l'URL ne lui
 * convient pas : une adresse en clair, une IP de réseau local, un `localhost`. Or `DOMAIN` peut
 * légitimement valoir `http://192.168.1.20:3000` (l'application sait se servir en clair sur un
 * réseau interne, c'est documenté dans `src/lib/env.ts`) : dans ce cas, chaque envoi échouait,
 * sur **tous** les salons à la fois, avec un « réponse 400 » qui n'expliquait rien.
 *
 * Sans avatar, Discord affiche celui du webhook réglé dans le salon : on perd une image, on ne
 * perd aucun message. C'est le bon compromis.
 *
 * L'écu arrive en **chemin relatif** (`/logo-ecu.png`, ou l'image déposée dans l'espace admin) :
 * c'est ici qu'il devient une adresse absolue, la seule forme que Discord sait aller chercher.
 */
function avatarAcceptable(ecu: string): string | undefined {
  try {
    const url = new URL(`${baseUrl()}${ecu}`);
    if (url.protocol !== "https:") return undefined;
    // Une adresse privée n'est joignable ni par Discord ni par personne d'autre à l'extérieur
    const prive = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
    return prive ? undefined : url.toString();
  } catch {
    return undefined;
  }
}

/**
 * **Les bornes de Discord, et pourquoi les tenir ici.**
 *
 * Discord **refuse tout le message (400)** dès qu'un morceau dépasse : 256 caractères pour un
 * titre ou un nom de champ, 1024 pour la valeur d'un champ, 4096 pour la description, 25 champs,
 * 6000 caractères pour l'embed entier. Or `appelerDiscord` renonce immédiatement sur une 4xx — à
 * juste titre, un webhook supprimé ne réapparaîtra pas — et l'appelant journalise un échec.
 * Résultat : **le récap de la veille ne part jamais, en silence**.
 *
 * Ce n'était pas atteignable tant que le programme d'une séance tenait dans une liste figée de
 * parties ; il est désormais libre (les séances portent leurs propres parties, ajoutées à la
 * main). Vers huit parties au libellé bavard, le champ « 📖 Programme » passe les 1024 caractères
 * et le salon se tait. Une annonce d'événement, dont le texte est saisi librement, est logée à la
 * même enseigne.
 *
 * **La borne vit dans le transport**, pas dans la mise en forme (`contenu.ts`) : c'est une règle de
 * Discord, comme la limite de Telegram vit dans `tronquerTelegram` (src/lib/notifications/telegram.ts).
 * Tout ce qui part vers un webhook y passe, y compris ce qu'on écrira plus tard.
 */
export const LIMITES_DISCORD = {
  titre: 256,
  description: 4096,
  nomChamp: 256,
  valeurChamp: 1024,
  piedDePage: 2048,
  champs: 25,
  embed: 6000,
} as const;

/**
 * Coupe à `max` caractères en gardant une phrase lisible : on recule jusqu'au dernier saut de ligne
 * s'il n'est pas trop haut (sinon on coupe net), et l'on pose « … » pour que le lecteur sache qu'il
 * manque quelque chose. Même geste que `tronquerTelegram`.
 */
export function tronquerDiscord(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  const coupe = texte.slice(0, max - 1);
  const retour = coupe.lastIndexOf("\n");
  return `${(retour > max / 2 ? coupe.slice(0, retour) : coupe).trimEnd()}…`;
}

/** Longueur que Discord compte pour un embed (titre + description + champs + pied de page). */
function tailleEmbed(e: DiscordEmbed): number {
  const champs = (e.fields ?? []).reduce((n, c) => n + c.name.length + c.value.length, 0);
  return (e.title?.length ?? 0) + (e.description?.length ?? 0) + champs + (e.footer?.text.length ?? 0);
}

/**
 * L'embed ramené dans les bornes de Discord. Fonction pure, appliquée à **chaque** envoi et à
 * chaque édition : mieux vaut un programme coupé à « … » qu'un salon muet.
 *
 * Les champs en trop sont retirés **par la fin** : les premiers portent les réponses et l'effectif,
 * c'est-à-dire ce qu'on vient lire la veille d'un cours.
 */
export function embedBorne(embed: DiscordEmbed): DiscordEmbed {
  const borne: DiscordEmbed = {
    ...embed,
    ...(embed.title === undefined ? {} : { title: tronquerDiscord(embed.title, LIMITES_DISCORD.titre) }),
    ...(embed.description === undefined ? {} : { description: tronquerDiscord(embed.description, LIMITES_DISCORD.description) }),
    ...(embed.footer === undefined ? {} : { footer: { text: tronquerDiscord(embed.footer.text, LIMITES_DISCORD.piedDePage) } }),
    ...(embed.fields === undefined
      ? {}
      : {
          fields: embed.fields.slice(0, LIMITES_DISCORD.champs).map((c) => ({
            ...c,
            name: tronquerDiscord(c.name, LIMITES_DISCORD.nomChamp),
            value: tronquerDiscord(c.value, LIMITES_DISCORD.valeurChamp),
          })),
        }),
  };
  /*
   * Le plafond **global** se franchit sans qu'aucune pièce ne dépasse la sienne : vingt-cinq champs
   * de mille caractères sont chacun valides et font quatre fois le total admis. On sacrifie dans
   * l'ordre de ce qu'on perd le moins à perdre — d'abord les derniers champs (les premiers portent
   * les réponses et l'effectif, c'est-à-dire ce qu'on vient lire la veille d'un cours), puis la
   * description, qui est du texte suivi et supporte les points de suspension.
   */
  while (tailleEmbed(borne) > LIMITES_DISCORD.embed && (borne.fields?.length ?? 0) > 0) {
    borne.fields = borne.fields!.slice(0, -1);
  }
  if (tailleEmbed(borne) > LIMITES_DISCORD.embed && borne.description) {
    const place = LIMITES_DISCORD.embed - (tailleEmbed(borne) - borne.description.length);
    borne.description = place > 0 ? tronquerDiscord(borne.description, place) : "";
  }
  return borne;
}

export function payloadDiscord(embed: DiscordEmbed, club: ClubDiscord, content?: string) {
  const avatar = avatarAcceptable(club.ecu);
  return {
    username: club.nomClub,
    ...(avatar ? { avatar_url: avatar } : {}),
    content,
    embeds: [embedBorne(embed)],
    allowed_mentions: { parse: [] as string[] },
  };
}

/**
 * Corps d'une **édition** : ni `username` ni `avatar_url` — Discord ne laisse pas changer l'auteur
 * d'un message déjà posté, et les envoyer ferait refuser la requête. `content: null` efface le
 * texte hors embed, pour qu'une édition reparte toujours d'un état connu.
 */
export function payloadEditionDiscord(embed: DiscordEmbed, content?: string) {
  return {
    content: content ?? null,
    // Bornes tenues ici aussi : une correction refusée laisserait le salon sur l'annonce d'avant,
    // sans que personne ne sache qu'elle est périmée (voir `embedBorne`).
    embeds: [embedBorne(embed)],
    allowed_mentions: { parse: [] as string[] },
  };
}

/**
 * `https://discord.com/api/webhooks/{id}/{token}` → `…/messages/{messageId}`, la route qui édite ou
 * efface un message déjà posté. Les paramètres éventuels (`?wait=true`) sont retirés : ils valent
 * pour la création, pas pour la suite.
 */
export function urlMessageWebhook(webhookUrl: string, messageId: string): string {
  const base = webhookUrl.split("?")[0].replace(/\/+$/, "");
  return `${base}/messages/${encodeURIComponent(messageId)}`;
}

/** `?wait=true` : sans lui, Discord répond 204 et on ne saurait jamais quel message on vient d'écrire. */
export function urlAvecAttente(webhookUrl: string): string {
  const [base, query] = webhookUrl.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("wait", "true");
  return `${base}?${params.toString()}`;
}

type IssueDiscord = { ok: true; corps: unknown } | { ok: false; status: number | null; erreur: Error; code?: number };

/** Longueur du corps de réponse recopié dans un message d'erreur — la même borne que Telegram. */
const DETAIL_MAX = 200;

/**
 * Le seul message d'un échec dont on ne sait rien. **Rien n'est recopié** : un objet levé qui n'est
 * pas une `Error` pourrait aussi bien porter l'URL du webhook, et on ne le saura pas en le lisant.
 */
export const ERREUR_DISCORD_INCONNUE = "Discord : échec inconnu (aucun détail recopié — il pourrait porter l'URL du webhook).";

/**
 * **Le message d'erreur d'un appel Discord, sans jamais l'URL du webhook.**
 *
 * Jumeau de `messageErreurTelegram` (src/lib/notifications/telegram.ts), et écrit pour la même
 * raison : ce message-là voyage loin. Il finit dans `NotificationLog.erreur` (affiché dans l'espace
 * admin, jamais purgé avant la v0.54), dans `AuditLog.details` (365 jours, exporté en CSV), à
 * l'écran de qui vient d'appuyer sur « Envoyer un message de test », et dans le journal du
 * conteneur, lisible dans Portainer.
 *
 * **Ce qui rendait l'asymétrie dangereuse** : l'erreur brute de `fetch` était recopiée telle quelle
 * (`e instanceof Error ? e : new Error(String(e))`). Or une URL de webhook mal recopiée dans
 * Portainer — le projet a déjà vécu exactement ça avec les guillemets conservés sur `SMTP_FROM`,
 * voir `normaliserExpediteur` — fait lever Node avec `TypeError: Failed to parse URL from
 * "https://discord.com/api/webhooks/123/SECRET"` : **l'entrée fautive au complet, jeton porteur
 * compris**. Le webhook Discord EST un secret : qui l'a peut écrire dans le salon du club.
 *
 * On ne garde donc de l'incident réseau que ce qui aide à le comprendre et ne peut rien révéler :
 * le **nom** de l'erreur et le **code** de sa cause (`ENOTFOUND`, `ECONNREFUSED`,
 * `UND_ERR_CONNECT_TIMEOUT`…). Jamais son message. Une réponse HTTP, elle, garde son statut et son
 * corps tronqué : Discord explique toujours un refus (« Invalid Form Body » et le champ fautif), et
 * ce corps ne contient pas l'adresse appelée.
 */
export function messageErreurDiscord(statut: number | null, detail: unknown): string {
  if (statut === null) {
    const nom = detail instanceof Error && detail.name ? detail.name : "Error";
    const cause = (detail as { cause?: { code?: unknown } } | null)?.cause;
    const code = typeof cause?.code === "string" ? ` ${cause.code}` : "";
    return `Discord : appel impossible (${nom}${code}) — réseau, DNS, délai dépassé, ou URL de webhook invalide. L'adresse appelée n'est pas recopiée ici.`;
  }
  const texte = typeof detail === "string" ? detail.trim() : "";
  return `Discord : réponse ${statut}${texte ? ` — ${texte.slice(0, DETAIL_MAX)}` : ""}`;
}

/**
 * **Salon de type forum** : Discord refuse un message qui n'ouvre pas un fil (code 220001).
 *
 * Un forum n'est pas une suite de messages, c'est une liste de **discussions**. Un webhook qui y
 * poste doit donc dire soit dans quel fil écrire (`thread_id`), soit quel fil ouvrir
 * (`thread_name`). Sans l'un des deux, 400 — et le club n'a aucun moyen de le deviner en collant
 * son URL, puisque rien dans l'adresse d'un webhook ne dit le type du salon.
 */
const CODE_FORUM_SANS_FIL = 220001;

/** Longueur maximale d'un nom de fil côté Discord. */
const NOM_FIL_MAX = 100;

/**
 * Le nom du fil à ouvrir sur un salon forum : le titre du message, et à défaut le nom du club.
 * C'est ce qui s'affichera comme intitulé de la discussion — « 🗡️ Cours de demain », « ❌ Cours
 * annulé » —, exactement ce qu'on veut lire dans la liste d'un forum.
 */
export function nomDuFil(embed: DiscordEmbed, nomClub: string): string {
  const brut = (embed.title ?? "").trim() || nomClub;
  return brut.slice(0, NOM_FIL_MAX);
}

/**
 * L'appel lui-même, avec la seule chose qui mérite d'être partagée entre les quatre opérations :
 * la limite de débit (429 + `retry_after`), le renoncement immédiat sur une erreur 4xx (un webhook
 * supprimé ne réapparaîtra pas) et le réessai avec attente sur une 5xx.
 *
 * Ne lève jamais : le statut est rendu à l'appelant, qui seul sait si un 404 est un échec (édition
 * d'un message qu'on croyait là) ou un non-événement (suppression d'un message déjà effacé).
 */
async function appelerDiscord(url: string, methode: "POST" | "PATCH" | "DELETE", charge?: unknown, tentatives = 3): Promise<IssueDiscord> {
  let derniere: Error | null = null;
  let statut: number | null = null;
  for (let i = 0; i < tentatives; i++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: methode,
        ...(charge === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(charge) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      // Réseau coupé, DNS, délai dépassé : aucun statut, et insister ici ferait attendre l'action
      // de l'utilisateur pour rien. L'appelant journalise l'échec et rejouera au prochain passage.
      // **L'erreur est reformulée, jamais recopiée** : celle de Node porte l'URL appelée, donc le
      // jeton du webhook (voir `messageErreurDiscord`). Aucun `console.error` ici pour la même
      // raison — le journal du conteneur se lit dans Portainer.
      return { ok: false, status: null, erreur: new Error(messageErreurDiscord(null, e)) };
    }
    // 204 (suppression, POST sans `wait`) : pas de corps, et ce n'est pas une erreur.
    if (res.ok) return { ok: true, corps: await res.json().catch(() => null) };
    statut = res.status;
    if (res.status === 429) {
      // Limite de débit : Discord dit combien de temps attendre (corps JSON, ou en-tête Retry-After).
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await new Promise((r) => setTimeout(r, attenteRetry(body.retry_after, res.headers.get("retry-after"))));
      derniere = new Error("Discord : limite de débit atteinte (429)");
      continue;
    }
    // Discord explique toujours un refus (« Invalid Form Body » et le champ fautif) : sans ce
    // détail, un 400 laisse chercher à l'aveugle — c'est exactement ce qui est arrivé avec
    // `avatar_url`. Le corps est tronqué et ne contient aucun secret (l'URL du webhook n'y est pas).
    const detail = await res.text().catch(() => "");
    derniere = new Error(messageErreurDiscord(res.status, detail));
    if (res.status >= 400 && res.status < 500) {
      // Le code métier de Discord, quand il y en a un : c'est lui qui distingue « ce salon est un
      // forum » d'un vrai refus. Lu ici, une fois, plutôt que deviné du texte par l'appelant.
      const code = (() => {
        try {
          const j = JSON.parse(detail) as { code?: unknown };
          return typeof j.code === "number" ? j.code : undefined;
        } catch {
          return undefined;
        }
      })();
      return { ok: false, status: res.status, erreur: derniere, code };
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  return { ok: false, status: statut, erreur: derniere ?? new Error(ERREUR_DISCORD_INCONNUE) };
}

/**
 * Envoi d'un message, **salons forum compris**.
 *
 * Le premier essai est le message ordinaire. Si Discord répond « ce salon est un forum, il faut un
 * fil » (code 220001), on rejoue **une fois** en ouvrant un fil nommé d'après le titre du message.
 * On ne devine pas le type du salon à l'avance : rien dans l'URL d'un webhook ne le dit, et
 * envoyer `thread_name` à tout le monde ferait échouer les salons ordinaires. On réagit donc à ce
 * que Discord répond — c'est lui qui sait.
 *
 * Résultat pour le club : on colle l'URL d'un webhook, forum ou pas, et ça marche.
 */
async function posterAvecFilSiForum(url: string, embed: DiscordEmbed, content: string | undefined, tentatives: number): Promise<IssueDiscord> {
  // L'identité est lue **ici**, au plus près de l'envoi : le nom et l'écu du club vivent en base et
  // peuvent changer entre deux messages (lecture mise en cache pour la durée d'une requête).
  const club = await identite();
  const issue = await appelerDiscord(url, "POST", payloadDiscord(embed, club, content), tentatives);
  if (issue.ok || issue.code !== CODE_FORUM_SANS_FIL) return issue;
  return appelerDiscord(url, "POST", { ...payloadDiscord(embed, club, content), thread_name: nomDuFil(embed, club.nomClub) }, tentatives);
}

export async function posterDiscord(webhookUrl: string, embed: DiscordEmbed, content?: string, tentatives = 3): Promise<void> {
  const issue = await posterAvecFilSiForum(webhookUrl, embed, content, tentatives);
  if (!issue.ok) throw issue.erreur;
}

/**
 * Le même envoi, mais en gardant l'**identifiant du message** créé : c'est ce qui permettra, plus
 * tard, de corriger l'annonce au lieu d'en poster une seconde.
 *
 * Renvoie `null` si Discord accepte le message sans rendre son identifiant (cas théorique avec
 * `?wait=true`) : le message **est parti**, on a seulement perdu sa trace. L'appelant le traite
 * comme un envoi réussi et non comme une panne — cette annonce-là ne pourra simplement plus être
 * corrigée, ce qui vaut mieux que d'en reposter une seconde à la première modification.
 */
export async function posterEtRetenirId(webhookUrl: string, embed: DiscordEmbed, content?: string): Promise<string | null> {
  const issue = await posterAvecFilSiForum(urlAvecAttente(webhookUrl), embed, content, 3);
  if (!issue.ok) throw issue.erreur;
  const corps = issue.corps as { id?: unknown } | null;
  return typeof corps?.id === "string" ? corps.id : null;
}

/**
 * `introuvable` = 404 : quelqu'un a effacé le message à la main sur le salon. Ce n'est pas une
 * panne, c'est un état — l'appelant repose alors une annonce neuve.
 */
export type IssueEdition = "edite" | "introuvable";

export async function editerMessageDiscord(webhookUrl: string, messageId: string, embed: DiscordEmbed, content?: string): Promise<IssueEdition> {
  const issue = await appelerDiscord(urlMessageWebhook(webhookUrl, messageId), "PATCH", payloadEditionDiscord(embed, content));
  if (issue.ok) return "edite";
  if (issue.status === 404) return "introuvable";
  throw issue.erreur;
}
