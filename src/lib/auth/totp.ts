import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NOM_APP_LIVRE } from "@/lib/constants";

/**
 * Double authentification par code à usage unique (TOTP, RFC 6238) pour les administrateurs :
 * compatible avec toute application d'authentification (Aegis, FreeOTP, Google/Microsoft Authenticator…).
 * Codes à 6 chiffres, pas de 30 s, tolérance d'un pas avant/après. Aucune dépendance.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PAS_SECONDES = 30;
export const TOTP_CHIFFRES = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let valeur = 0;
  let sortie = "";
  for (const octet of buf) {
    valeur = (valeur << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      sortie += ALPHABET[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += ALPHABET[(valeur << (5 - bits)) & 31];
  return sortie;
}

export function base32Decode(texte: string): Buffer {
  const propre = texte.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const octets: number[] = [];
  let bits = 0;
  let valeur = 0;
  for (const c of propre) {
    valeur = (valeur << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

/** Nouveau secret (20 octets = 160 bits, recommandation RFC 4226), en base32 pour l'application. */
export function genererSecretTotp(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, compteur: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(compteur));
  const h = createHmac("sha1", secret).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 10 ** TOTP_CHIFFRES).padStart(TOTP_CHIFFRES, "0");
}

/** Code attendu à un instant donné (décalé de `delta` pas). */
export function codeTotp(secretBase32: string, at = Date.now(), delta = 0): string {
  const compteur = Math.floor(at / 1000 / TOTP_PAS_SECONDES) + delta;
  return hotp(base32Decode(secretBase32), compteur);
}

/**
 * **Quel pas de temps** le code saisi présente-t-il (espaces tolérés, tolérance d'un pas de chaque
 * côté) ? `null` s'il n'en présente aucun.
 *
 * Le pas, et pas seulement « oui / non » : c'est lui que l'on retient pour refuser un **rejeu**. Un
 * booléen ne dit pas *quel* code vient de servir, donc ne permet pas de le marquer comme consommé —
 * voir `consommerCodeTotp` (src/lib/auth/deux-fa.ts), le seul lecteur que les portes
 * d'authentification ont le droit d'appeler.
 */
export function pasDuCodeTotp(secretBase32: string, saisie: string, at = Date.now()): number | null {
  const code = saisie.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const a = Buffer.from(code);
  const courant = Math.floor(at / 1000 / TOTP_PAS_SECONDES);
  for (const delta of [0, -1, 1]) {
    const b = Buffer.from(codeTotp(secretBase32, at, delta));
    if (a.length === b.length && timingSafeEqual(a, b)) return courant + delta;
  }
  return null;
}

/**
 * Vérifie un code saisi (espaces tolérés), avec une tolérance d'un pas de chaque côté.
 *
 * **Fonction pure : elle ne sait rien du compte, donc rien des codes déjà consommés.** Une porte
 * d'authentification ne l'appelle jamais directement — elle appellerait un code à usage unique sans
 * en marquer l'usage. Elle passe par `consommerCodeTotp`.
 */
export function verifierCodeTotp(secretBase32: string, saisie: string, at = Date.now()): boolean {
  return pasDuCodeTotp(secretBase32, saisie, at) !== null;
}

/**
 * URL à encoder dans le QR code (format otpauth://, lu par toutes les applications).
 * L'adresse email est **facultative** en base : sans elle, l'étiquette affichée dans l'application
 * d'authentification retombe sur le nom de l'application plutôt que d'écrire « null » (le secret,
 * lui, est le même). En pratique un compte sans adresse ne règle jamais de double
 * authentification : `peutReglerSonAcces` le lui refuse.
 *
 * `nomApp` est le nom du club, que l'appelant a déjà lu : c'est ce que l'application
 * d'authentification affichera au-dessus du code. Cette fonction reste pure et synchrone — elle ne
 * lit rien —, d'où le paramètre plutôt qu'un appel à l'identité.
 */
export function urlOtpauth(secretBase32: string, email: string | null, nomApp: string = NOM_APP_LIVRE): string {
  const nom = nomApp.trim() || NOM_APP_LIVRE;
  const emetteur = encodeURIComponent(nom);
  const etiquette = encodeURIComponent(email || nom);
  return `otpauth://totp/${emetteur}:${etiquette}?secret=${secretBase32}&issuer=${emetteur}&algorithm=SHA1&digits=${TOTP_CHIFFRES}&period=${TOTP_PAS_SECONDES}`;
}

/** Secret présenté par groupes de 4 pour la saisie manuelle. */
export function formaterSecret(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, "$1 ").trim();
}
