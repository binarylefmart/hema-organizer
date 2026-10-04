import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Jetons opaques : 32 octets aléatoires encodés en base64url dans les URL/cookies,
 * seul le SHA-256 est stocké en base.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Forme attendue d'un jeton opaque : de l'alphabet base64url, et **40 à 64 signes**.
 *
 * Le commentaire annonçait « 43 caractères », la longueur d'un jeton de 32 octets — ce que
 * `generateToken()` produit, mais pas ce que cette fonction accepte. L'écart n'est pas une erreur :
 * les liens du jeu de démonstration en font 48, et une fourchette laisse passer un jeton plus long
 * sans refuser personne le jour où la taille change. C'est la **borne basse** qui porte la
 * sécurité.
 */
export function isValidTokenFormat(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

/**
 * **Les sept usages d'un jeton signé, et pourquoi chacun porte son nom.**
 *
 * Un seul secret (`SESSION_SECRET`) signe tout ce que l'application frappe : liens d'email, cookies
 * de passage, jeton d'élévation. Une signature qui ne couvre **que** les champs rend ces jetons
 * **interchangeables** dès que deux d'entre eux ont la même forme — et certains dorment en clair
 * dans le pied d'un email, pour un an. Un jeton présenté à un lecteur qui n'est pas le sien y
 * passerait alors pour authentique, puisqu'il l'est : c'est le même secret qui l'a frappé.
 *
 * D'où l'**usage écrit dans la charge signée** : il entre dans le HMAC comme les autres champs, et
 * chaque lecteur exige le sien. Un jeton d'une autre famille n'est plus « périmé » ni « mal formé » :
 * il est **d'un autre usage**, et c'est ce que le code dit.
 *
 * Deux principes, tirés de ce défaut :
 * 1. **aucun jeton ne se signe sans usage** — la signature l'exige en argument, on ne peut pas
 *    l'oublier par distraction ;
 * 2. **aucun lecteur ne lit sans dire ce qu'il attend** — un `verifySignedPayload` sans usage ne
 *    compile pas.
 *
 * Format : `<charge base64url>.<signature base64url>`, la charge portant `u: <usage>`.
 */
export const USAGES_JETON = [
  /** Cookie d'attente entre le mot de passe et le code TOTP (`hema_2fa`) */
  "attente-2fa",
  /** Cookie qui montre une fois les codes de secours fraîchement engendrés */
  "codes-secours",
  /** Cookie du parcours d'activation d'un accès administrateur (secret TOTP provisoire) */
  "reglage-2fa",
  /** Cookie de passage qui porte le lien personnel jusqu'à l'écran de bienvenue */
  "lien-personnel",
  /** Cookie d'élévation de l'espace admin */
  "elevation",
  /** Lien de désinscription des rappels, en pied d'email */
  "desinscription",
  /** Lien « Annuler cette séance » envoyé aux instructeurs */
  "annulation-seance",
] as const;
export type UsageJeton = (typeof USAGES_JETON)[number];

export function signPayload(payload: Record<string, string | number>, secret: string, usage: UsageJeton): string {
  const data = Buffer.from(JSON.stringify({ ...payload, u: usage })).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySignedPayload<T extends Record<string, string | number>>(
  token: string,
  secret: string,
  usage: UsageJeton,
): T | null {
  /*
   * **Deux parties, exactement — un jeton n'a qu'une forme**. Le découpage ignorait tout ce qui
   * suivait la deuxième partie, si bien que `<charge>.<signature>.nimportequoi` se vérifiait
   * **exactement** comme `<charge>.<signature>` : accepté sur les sept usages, mesuré. Ça ne
   * donnait aucun droit de plus — le HMAC ne couvre que la charge, et l'usage doit toujours
   * correspondre —, mais un jeton cessait d'avoir une forme **canonique** : un journal, une clé de
   * cache ou une table de jeton à usage unique indexée sur la chaîne peut alors compter deux fois
   * le même jeton, ou en laisser passer une seconde variante.
   */
  const parties = token.split(".");
  if (parties.length !== 2) return null;
  const [data, sig] = parties;
  if (!data || !sig) return null;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const charge = JSON.parse(Buffer.from(data, "base64url").toString()) as T & { u?: string };
    // **L'usage se vérifie après la signature**, pas avant : ce qu'on lit d'une charge non vérifiée
    // ne vaut rien. Et un jeton frappé avant ce changement n'a pas de `u` : il est refusé partout,
    // ce qui est le bon comportement — les liens en circulation valent au plus un an, et le pire
    // qu'un refus coûte est un renvoi que l'écran propose déjà.
    if (charge.u !== usage) return null;
    return charge;
  } catch {
    return null;
  }
}
