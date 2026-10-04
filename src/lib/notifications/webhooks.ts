import { chiffrer, dechiffrer, estChiffre } from "@/lib/crypto";
import { CLES, getDiscordWebhookUrl, getSetting, setSetting } from "@/lib/settings";
import { COUPLES_EMIS, DESCRIPTIONS, TYPES_NOTIFICATION, estTypeNotification, type TypeNotification } from "./preferences";

/**
 * **Un salon Discord par notification** — le club veut pouvoir envoyer le récap des cours dans le
 * salon d'entraînement, les annulations dans le salon des annonces, les stages ailleurs encore.
 *
 * ## Une seule clé, pas une par notification
 *
 * Tout tient dans **un** réglage (`Setting.discordWebhooks`, chiffré d'un bloc) qui porte un objet
 * `{ <notification>: <url> }`. Trois raisons :
 *
 * 1. **une lecture, un déchiffrement** — l'écran d'administration affiche les quatre lignes et le
 *    cron du soir choisit son salon sans multiplier les allers-retours en base ;
 * 2. **rien à migrer quand un type de notification apparaît ou disparaît** : la table est un objet,
 *    pas un schéma. Les clés inconnues sont simplement ignorées à la lecture ;
 * 3. **un seul secret à protéger** : une clé chiffrée, jamais N réglages qu'on oublierait de
 *    chiffrer un jour.
 *
 * Le prix à payer est une écriture en lecture-modification-écriture (`setSalonDiscord`) — sans
 * conséquence ici : deux administrateurs ne règlent pas leurs salons à la même seconde.
 *
 * ## Facultatif, et repli sur le salon principal
 *
 * Une entrée vide n'est pas une panne : la notification part sur le **salon principal**
 * (`discordWebhookUrl`, ou `DISCORD_WEBHOOK_URL` de la stack). Un club à salon unique n'a donc rien
 * à régler ici, et il n'y a jamais quatre webhooks à tenir à jour pour obtenir le comportement
 * d'avant. **Aucune variable d'environnement nouvelle.**
 */

/** Les notifications qui peuvent avoir leur propre salon : celles qui partent sur Discord. */
export const TYPES_DISCORD: readonly TypeNotification[] = TYPES_NOTIFICATION.filter((t) => COUPLES_EMIS[t].includes("discord"));

/** Garde d'entrée : le nom d'une notification qui part sur Discord, et rien d'autre (jamais une clé du client). */
export function estTypeDiscord(valeur: unknown): valeur is TypeNotification {
  return estTypeNotification(valeur) && TYPES_DISCORD.includes(valeur);
}

export type SalonsDiscord = Partial<Record<TypeNotification, string>>;

/** D'où vient le salon qui reçoit une notification donnée. */
export type SourceSalon =
  /** Un webhook propre à cette notification a été collé dans l'application */
  | "dedie"
  /** Aucun : la notification part sur le salon principal du club */
  | "herite"
  /** Ni l'un ni l'autre : rien ne peut partir */
  | "aucune";

/** Table telle qu'elle est stockée, débarrassée de ce qui n'a plus cours (types inconnus, URLs vides). */
export function lireSalons(json: string | null): SalonsDiscord {
  if (!json) return {};
  let brut: unknown;
  try {
    brut = JSON.parse(json);
  } catch {
    // Valeur abîmée : on se comporte comme un réglage absent (tout retombe sur le salon principal),
    // jamais comme une panne — un salon mal rangé ne doit pas empêcher le récap de partir.
    return {};
  }
  if (typeof brut !== "object" || brut === null) return {};
  const salons: SalonsDiscord = {};
  for (const [cle, valeur] of Object.entries(brut as Record<string, unknown>)) {
    if (!estTypeDiscord(cle) || typeof valeur !== "string" || valeur.trim() === "") continue;
    salons[cle] = valeur.trim();
  }
  return salons;
}

/**
 * **Reprise de l'ancien réglage** (`discordWebhookEvenementsUrl`, introduit juste avant cette
 * table) : sa valeur devient l'entrée `evenement_nouveau`, sans intervention manuelle. Qui avait
 * branché un salon dédié aux stages ne doit pas voir ses annonces revenir dans le salon des cours
 * après la mise à jour.
 *
 * Elle ne se joue **qu'une fois** : elle n'est tentée que si la nouvelle clé n'existe pas encore, et
 * l'ancienne est effacée dans la foulée — un secret ne se garde pas en double, et une entrée
 * effacée plus tard par un administrateur ne doit pas ressusciter au prochain démarrage.
 */
async function reprendreAncienSalonEvenements(): Promise<SalonsDiscord> {
  const ancien = await getSetting(CLES.discordWebhookEvenementsUrl);
  const url = ancien ? dechiffrer(ancien) : null;
  if (!url) return {};
  const repris: SalonsDiscord = { evenement_nouveau: url };
  await ecrireSalons(repris);
  await setSetting(CLES.discordWebhookEvenementsUrl, null);
  return repris;
}

/** La table des salons dédiés (reprise de l'ancien réglage comprise). */
export async function salonsDiscord(): Promise<SalonsDiscord> {
  const stocke = await getSetting(CLES.discordWebhooks);
  if (stocke === null) return reprendreAncienSalonEvenements();
  const clair = dechiffrer(stocke);
  if (clair === null && estChiffre(stocke)) {
    // Voir `exigerTableLisible` : en **lecture**, une table illisible se dégrade (on retombe sur le salon
    // du club, et les envois continuent de partir quelque part). C'est l'**écriture** qui est interdite.
    console.error("[discord] table des salons illisible — la clé de chiffrement du serveur a-t-elle changé ? Les salons dédiés sont ignorés jusqu'à nouvel ordre.");
  }
  return lireSalons(clair);
}

/**
 * **Une table illisible ne se réécrit pas par-dessus**.
 *
 * `lireSalons(null)` rend `{}`, et `setSalonDiscord` est un lire-modifier-écrire : le prochain salon réglé
 * par le bureau **effaçait tous les autres**, encore présents en base sous forme chiffrée. Le scénario est
 * celui d'une rotation de `SESSION_SECRET` : plus rien ne part sur Discord, le bureau rouvre l'écran et
 * recolle l'URL d'un salon — et les trois autres disparaissent pour de bon.
 *
 * Le refus est posé sur l'**écriture** seule, et c'est volontaire : une lecture qui lèverait ferait échouer
 * tous les envois Discord, alors que le repli sur le salon du club (dont l'URL peut venir de la variable
 * d'environnement, donc rester lisible) les laisse partir. On ne casse pas ce qui marche encore ; on
 * empêche ce qui détruit.
 */
async function exigerTableLisible(): Promise<void> {
  const stocke = await getSetting(CLES.discordWebhooks);
  if (stocke !== null && dechiffrer(stocke) === null && estChiffre(stocke)) {
    throw new Error("Les salons dédiés ne peuvent pas être modifiés : leur réglage est illisible (la clé de chiffrement du serveur a changé).");
  }
}

/** Écrit la table (chiffrée d'un bloc). Table vide = réglage effacé, pas un objet vide en base. */
async function ecrireSalons(salons: SalonsDiscord): Promise<void> {
  const propres = lireSalons(JSON.stringify(salons));
  await setSetting(CLES.discordWebhooks, Object.keys(propres).length === 0 ? null : chiffrer(JSON.stringify(propres)));
}

/** Branche (ou débranche, avec `null`) le salon d'une notification. */
export async function setSalonDiscord(type: TypeNotification, url: string | null): Promise<void> {
  await exigerTableLisible();
  const salons = await salonsDiscord();
  if (url && url.trim() !== "") salons[type] = url.trim();
  else delete salons[type];
  await ecrireSalons(salons);
}

/**
 * **Le point de passage unique avant tout envoi sur Discord** : pour une notification donnée, le
 * salon qui lui est dédié, sinon celui du club. Aucun appel ne garde le webhook principal en dur —
 * sans quoi brancher un salon ici ne changerait rien là-bas.
 */
export async function salonPour(type: TypeNotification): Promise<{ url: string; source: SourceSalon }> {
  const dedie = (await salonsDiscord())[type];
  if (dedie) return { url: dedie, source: "dedie" };
  const { url } = await getDiscordWebhookUrl();
  return url ? { url, source: "herite" } : { url: "", source: "aucune" };
}

export type LigneSalon = {
  type: TypeNotification;
  /** Libellé français de la notification (`DESCRIPTIONS`), pour l'écran d'administration */
  titre: string;
  quand: string;
  /** URL dédiée, vide si la notification suit le salon principal — **à masquer avant affichage** */
  url: string;
  source: SourceSalon;
};

/**
 * Les lignes de l'écran *Notifications → Canal Discord* : une par notification qui part sur Discord,
 * dans l'ordre des constantes. Une seule lecture de la table et une seule du salon principal.
 */
export async function salonsParNotification(): Promise<LigneSalon[]> {
  const [salons, principal] = await Promise.all([salonsDiscord(), getDiscordWebhookUrl()]);
  return TYPES_DISCORD.map((type) => {
    const dedie = salons[type] ?? "";
    return {
      type,
      titre: DESCRIPTIONS[type].titre,
      quand: DESCRIPTIONS[type].quand,
      url: dedie,
      source: dedie ? "dedie" : principal.url ? "herite" : "aucune",
    };
  });
}
