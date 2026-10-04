import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * Chiffrement symétrique (AES-256-GCM) des secrets stockés en base (ex. URL du webhook Discord).
 * Clé dérivée de SESSION_SECRET : un changement de secret rend les valeurs illisibles (à ressaisir).
 */
function cle(): Buffer {
  return createHash("sha256").update(`hema-settings:${env().SESSION_SECRET}`).digest();
}

export function chiffrer(texte: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cle(), iv);
  const data = Buffer.concat([cipher.update(texte, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${data.toString("base64url")}`;
}

/**
 * **Cette valeur a-t-elle la FORME d'un chiffré de ce module ?**
 *
 * `dechiffrer` rend `null` pour deux choses très différentes : une valeur qui n'a jamais été chiffrée
 * (réglage abîmé, migration manquée, saisie à la main) et un vrai chiffré qu'on ne peut plus lire
 * (la clé a changé). Les appelants doivent les traiter à l'opposé : le premier cas se remplace, le
 * second **se garde** — c'est une donnée qui existe, et l'écraser la détruit. Deux réglages ont été
 * perdus de cette façon (clés VAPID et table des salons Discord).
 *
 * On ne regarde que la forme : quatre morceaux, la bonne version, des tailles plausibles. Une valeur
 * de cette forme qui ne se déchiffre pas est un chiffré, pas un déchet.
 */
export function estChiffre(valeur: string | null | undefined): boolean {
  if (!valeur) return false;
  const [version, iv, tag, data] = valeur.split(".");
  return version === "v1" && !!iv && !!tag && !!data;
}

export function dechiffrer(valeur: string): string | null {
  const [version, iv, tag, data] = valeur.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", cle(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Masque une URL ou un secret pour l'affichage : **seul le début reste lisible**.
 *
 * La fin était montrée elle aussi, pour aider à reconnaître une valeur d'un coup d'œil. C'était le
 * mauvais bout : sur une URL de webhook Discord, les premiers caractères sont un préfixe constant
 * qui n'apprend rien (`https://discord.com/api/we…`), tandis que les derniers sont la fin du jeton
 * secret — affichée dans une page, elle se retrouve dans une capture d'écran ou un partage d'écran
 * sans que personne n'y pense. On garde donc le début, qui suffit à reconnaître la forme, et le
 * secret proprement dit est entièrement couvert.
 */
export function masquer(valeur: string, visible = 6): string {
  if (valeur.length <= visible) return "•".repeat(valeur.length);
  return `${valeur.slice(0, visible)}${"•".repeat(12)}`;
}
