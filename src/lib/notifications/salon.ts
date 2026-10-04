import { canalOperationnel } from "./canaux";
import { posterDiscord, type DiscordEmbed } from "./discord";
import { clesDejaEnvoyees, journaliser, marquerEchec } from "./journal";
import type { TypeNotification } from "./preferences";
import { salonPour } from "./webhooks";
import { echapperTelegram, envoyerTelegram, texteTelegram } from "./telegram";

/**
 * **Publication sur le salon Discord**, avec la même mécanique pour tous les messages du club
 * (récap de la veille, annulation, alerte « peu de monde ») :
 *
 * 1. le canal doit pouvoir envoyer (webhook collé — `canaux.ts`) ;
 * 1 bis. **le salon est choisi par notification** (`salonPour`) : celui qui lui est dédié, sinon le
 *    salon principal du club. C'est ici, et nulle part ailleurs, qu'un message de séance apprend
 *    dans quel salon il part ;
 * 2. `NotificationLog.dedupKey` : la clé est posée **avant** l'envoi, donc deux exécutions
 *    simultanées ne peuvent pas doubler le message ;
 * 3. un échec (webhook invalide, salon supprimé, Discord en panne) est **journalisé et avalé** :
 *    la clé nominale est libérée pour le prochain passage, et l'action de l'utilisateur
 *    (annuler une séance, par exemple) réussit quoi qu'il arrive.
 *
 * Cette fonction ne lève jamais.
 */
export type PublicationSalon = {
  /** Type écrit dans NotificationLog (RECAP, ANNULATION, EFFECTIF…) */
  type: string;
  /**
   * La notification au sens des réglages (`recap_veille`, `seance_annulee`…) : c'est **elle** qui
   * désigne le salon. Distincte du `type` ci-dessus, qui n'est qu'une étiquette de journal.
   */
  notification: TypeNotification;
  dedupKey: string;
  embed: DiscordEmbed;
  sessionId?: string | null;
  content?: string;
  now?: Date;
};

export async function publierSurSalon({ type, notification, dedupKey, embed, sessionId = null, content, now = new Date() }: PublicationSalon): Promise<boolean> {
  try {
    if ((await clesDejaEnvoyees([dedupKey])).has(dedupKey)) return false;
    if (!(await canalOperationnel("discord"))) {
      console.info(`[notifications] ${type} Discord ignoré : aucun salon branché`);
      return false;
    }
    const { url } = await salonPour(notification);
    if (!url) return false;
    if (!(await journaliser({ type, canal: "DISCORD", sessionId, dedupKey, statut: "ENVOYE" }))) return false;
    try {
      await posterDiscord(url, embed, content);
      return true;
    } catch (e) {
      // La clé nominale devient une clé d'échec horodatée : le prochain passage réessaiera.
      await marquerEchec(dedupKey, e instanceof Error ? e.message : String(e), now);
      return false;
    }
  } catch (e) {
    // Panne de base, réglages illisibles… : on ne fait jamais tomber l'action en cours pour un message.
    console.error(`[notifications] ${type} Discord : échec non bloquant`, e);
    return false;
  }
}

/**
 * **Publication sur le salon Telegram**, le jumeau exact de `publierSurSalon` : mêmes trois gardes
 * (canal branché, clé de déduplication posée avant l'envoi, échec journalisé et avalé), même
 * promesse de ne jamais lever.
 *
 * **Le contenu n'est pas réécrit** : c'est le même embed que Discord, transcrit en HTML restreint par
 * `texteTelegram`. Un club qui branche les deux canaux reçoit deux fois le même message, dans les
 * mêmes mots — et surtout, une correction du contenu commun se voit sur les deux.
 *
 * **La clé de déduplication est propre au canal** (`…_telegram_<id>`, jamais la clé Discord) : les
 * deux canaux doivent pouvoir partir, échouer et réessayer indépendamment l'un de l'autre.
 *
 * Le champ `notification` de l'argument n'est pas lu ici, à la différence de Discord : il n'y a pas
 * de salon par notification côté Telegram — un seul groupe, celui du club. Comme pour Discord, c'est
 * **l'appelant** qui a déjà demandé `envoiPossible(<notification>, "telegram")` : la case de la
 * grille est vérifiée là-bas, une fois, avant la boucle sur les séances.
 */
export async function publierSurTelegram({ type, dedupKey, embed, sessionId = null, content, now = new Date() }: PublicationSalon): Promise<boolean> {
  try {
    if ((await clesDejaEnvoyees([dedupKey])).has(dedupKey)) return false;
    if (!(await canalOperationnel("telegram"))) {
      console.info(`[notifications] ${type} Telegram ignoré : aucun salon branché`);
      return false;
    }
    if (!(await journaliser({ type, canal: "TELEGRAM", sessionId, dedupKey, statut: "ENVOYE" }))) return false;
    try {
      /*
       * Le texte hors embed (`content`) précède le message, comme sur Discord : c'est là que passe
       * une mention ou une phrase d'accroche quand l'appelant en pose une.
       *
       * **Il s'échappe ici, au point de concaténation**. Le message part en `parse_mode: "HTML"` et
       * `texteTelegram` échappe scrupuleusement tout ce qu'il transcrit — `content`, lui, arrivait
       * brut dans la même chaîne. Aucun appelant n'en passe aujourd'hui, donc rien n'était
       * atteignable ; mais le commentaire ci-dessus invite à y mettre une phrase d'accroche, et le
       * premier `<` ou `&` qui s'y glisserait (un motif d'annulation, un nom de salle « Villebourg &
       * Vouvray ») ferait refuser **tout** le message par Telegram (`400`) : une notification
       * perdue, pour un caractère. L'échappement vit au point de sortie, pas dans la discipline des
       * six appelants.
       */
      await envoyerTelegram([content ? echapperTelegram(content) : "", texteTelegram(embed)].filter(Boolean).join("\n\n"));
      return true;
    } catch (e) {
      await marquerEchec(dedupKey, e instanceof Error ? e.message : String(e), now);
      return false;
    }
  } catch (e) {
    console.error(`[notifications] ${type} Telegram : échec non bloquant`, e);
    return false;
  }
}
