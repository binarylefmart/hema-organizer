/**
 * Canal WhatsApp — **préparé, pas encore branché**.
 *
 * Le club n'a pas de numéro dédié : aucun envoi automatique n'est possible aujourd'hui, et aucune
 * dépendance npm ni appel à une API externe n'est ajouté ici. Deux choses seulement :
 *
 * 1. `lienPartageWhatsApp()` — le **partage manuel en un geste** qui existe déjà dans le cahier des
 *    charges (`wa.me`) : l'équipe ouvre WhatsApp avec le texte pré-rempli et choisit le groupe.
 * 2. `envoyerWhatsApp()` — le **point d'extension** de l'envoi automatique. Il lève tant que le canal
 *    n'est pas configuré, pour qu'aucun appel ne passe en silence.
 *
 * ## Le jour où un numéro est disponible
 * Brancher un service d'envoi (un conteneur **WAHA** ou **Baileys** est envisagé, sur le réseau Docker
 * de la stack, jamais exposé publiquement) et renseigner :
 *
 * - `WHATSAPP_API_URL`   — URL de l'API d'envoi du conteneur, ex. `http://waha:3000/api/sendText`
 * - `WHATSAPP_API_TOKEN` — jeton d'authentification de cette API (facultatif selon le service)
 * - `WHATSAPP_DESTINATAIRE` — identifiant du groupe ou du numéro qui reçoit (ex. `1203…@g.us`)
 *
 * Ces variables sont volontairement lues directement dans `process.env` (et non dans `src/lib/env.ts`)
 * tant que le canal n'est pas décidé : rien à changer au schéma de configuration existant.
 * Il restera à : les déclarer dans `.env.example` et la stack Portainer, écrire le `fetch` dans
 * `envoyerWhatsApp` (POST JSON + 3 tentatives, sur le modèle de `posterDiscord`), et appeler
 * `notificationActive(type, "whatsapp")` avant chaque envoi.
 */

export const VARIABLE_API_WHATSAPP = "WHATSAPP_API_URL";
export const ERREUR_WHATSAPP_NON_CONFIGURE =
  "Canal WhatsApp non configuré : aucun service d'envoi n'est branché (variable WHATSAPP_API_URL absente). Utilise le partage manuel en attendant.";

/** Le canal est-il configuré ? Tant que c'est faux, l'interface explique qu'il faut d'abord brancher un service. */
export function whatsappConfigure(): boolean {
  return typeof process.env[VARIABLE_API_WHATSAPP] === "string" && process.env[VARIABLE_API_WHATSAPP]!.trim() !== "";
}

/** Lien de partage manuel : ouvre WhatsApp avec le message pré-rempli, l'utilisateur choisit le destinataire. */
export function lienPartageWhatsApp(texte: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texte)}`;
}

export type MessageWhatsApp = { texte: string; destinataire?: string };

/**
 * Envoi automatique sur WhatsApp. **Point d'extension** : lève tant que le canal n'est pas branché.
 * Aucun appelant ne doit court-circuiter `notificationActive(type, "whatsapp")` avant d'arriver ici.
 */
export async function envoyerWhatsApp(message: MessageWhatsApp): Promise<void> {
  if (!whatsappConfigure()) throw new Error(ERREUR_WHATSAPP_NON_CONFIGURE);
  // TODO (étape « WhatsApp ») : POST JSON vers WHATSAPP_API_URL (WAHA / Baileys), 3 tentatives avec
  // backoff comme posterDiscord, puis journalisation dans NotificationLog (canal "WHATSAPP").
  throw new Error(
    `Envoi WhatsApp : service configuré mais envoi pas encore implémenté (message de ${message.texte.length} caractères non envoyé) — voir src/lib/notifications/whatsapp.ts.`,
  );
}
