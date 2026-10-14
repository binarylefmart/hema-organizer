import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * **Code d'activation à usage unique** : la pièce que l'étape 2 du parcours `/admin/activer`
 * (activation de la double authentification) exige d'un membre du bureau **nominatif**.
 *
 * Pourquoi il existe. Le parcours de réglage s'ouvre à qui tient la session du compte, et cette
 * session s'obtient par le lien personnel ou par « mot de passe oublié » — deux portes qui passent
 * **par la boîte email**. Sans ce code, quiconque tenait la boîte ou le lien d'un membre du bureau
 * pas encore réglé (fraîchement nommé, ou dont la 2FA vient d'être réinitialisée) choisissait le mot
 * de passe, scannait le QR code avec **son** téléphone et ouvrait l'espace admin. Le code ferme cette
 * voie parce qu'il ne passe **jamais** par l'email : un autre membre du bureau le génère dans Comptes
 * admin et le remet de vive voix ou en main propre.
 *
 * Ce module est **pur** (rien que `node:crypto`) : le script serveur `npm run admin:reset-2fa`
 * l'importe sans tirer la base de l'application. La base et le cookie d'affichage vivent dans
 * `activation-bureau.ts`.
 *
 * Forme : six signes d'un alphabet de 31, **sans 0/O/1/I/L** (lisible à l'oral, rien à confondre),
 * affiché `K7P-42M`. 31⁶ ≈ 8,9 × 10⁸ valeurs ; chaque signe est tiré par `randomInt`, uniforme et
 * cryptographique (pas de `% 31` sur un octet, qui biaiserait les premiers signes).
 */
export const ALPHABET_CODE_ACTIVATION = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const LONGUEUR_CODE_ACTIVATION = 6;
/** Valable 48 heures : le temps de se croiser au club ou de s'appeler, pas davantage. */
export const DUREE_CODE_ACTIVATION_MS = 48 * 60 * 60 * 1000;

export function genererCodeActivation(): string {
  let code = "";
  for (let i = 0; i < LONGUEUR_CODE_ACTIVATION; i++) code += ALPHABET_CODE_ACTIVATION[randomInt(ALPHABET_CODE_ACTIVATION.length)];
  return code;
}

/** `K7P42M` → `K7P-42M` : deux groupes de trois, plus faciles à dicter et à recopier. */
export function formaterCodeActivation(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/**
 * **Saisie tolérante** : casse, espaces (insécables compris), tirets et points ignorés. Rend le code
 * canonique, ou `null` s'il n'a pas la forme d'un code — six signes de l'alphabet, ni plus ni moins.
 * Une entrée du réseau : son type ne se suppose pas.
 */
export function normaliserCodeActivation(saisie: unknown): string | null {
  if (typeof saisie !== "string" || saisie.length > 32) return null;
  const brut = saisie.toUpperCase().replace(/[\s  \-‐‑–—.]/g, "");
  if (brut.length !== LONGUEUR_CODE_ACTIVATION) return null;
  for (const signe of brut) if (!ALPHABET_CODE_ACTIVATION.includes(signe)) return null;
  return brut;
}

/**
 * **Empreinte gardée en base** : HMAC-SHA-256 avec `SESSION_SECRET`, **liée au compte**.
 *
 * Un SHA-256 nu suffirait contre l'essai en ligne (le limiteur s'en charge), mais pas contre une copie
 * de la base : 8,9 × 10⁸ valeurs se parcourent en une seconde. Avec la clé du serveur, la copie seule
 * ne rend pas le code. L'identifiant du compte entre dans l'empreinte : un code ne vaut que pour la
 * personne à qui il a été donné, jamais pour une autre ligne de la table.
 */
export function empreinteCodeActivation(userId: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`code-activation:${userId}:${code}`).digest("hex");
}

export type EtatCodeActivation = { codeActivationHash?: string | null; codeActivationExpireLe?: Date | null };

export type VerdictCodeActivation = { ok: true; empreinte: string } | { ok: false; raison: "absent" | "forme" | "faux" | "expire" };

/**
 * Le code saisi est-il **le** code en cours de ce compte, encore valable ? Pure : la consommation
 * (usage unique) se fait à part, par une écriture conditionnelle sur l'empreinte rendue ici.
 */
export function verifierCodeActivation(
  userId: string,
  etat: EtatCodeActivation | null | undefined,
  saisie: unknown,
  secret: string,
  maintenant = Date.now(),
): VerdictCodeActivation {
  if (!etat?.codeActivationHash || !etat.codeActivationExpireLe) return { ok: false, raison: "absent" };
  const code = normaliserCodeActivation(saisie);
  if (!code) return { ok: false, raison: "forme" };
  const attendue = Buffer.from(etat.codeActivationHash);
  const recue = Buffer.from(empreinteCodeActivation(userId, code, secret));
  if (attendue.length !== recue.length || !timingSafeEqual(attendue, recue)) return { ok: false, raison: "faux" };
  // L'échéance après la comparaison : on ne dit pas « expiré » à qui n'a pas le bon code.
  if (etat.codeActivationExpireLe.getTime() <= maintenant) return { ok: false, raison: "expire" };
  return { ok: true, empreinte: etat.codeActivationHash };
}

/** Un code est-il en cours, et jusqu'à quand ? (Pour l'affichage : « valable jusqu'au … » / « aucun code valable ».) */
export function codeActivationEnCours(etat: EtatCodeActivation | null | undefined, maintenant = Date.now()): Date | null {
  if (!etat?.codeActivationHash || !etat.codeActivationExpireLe) return null;
  return etat.codeActivationExpireLe.getTime() > maintenant ? etat.codeActivationExpireLe : null;
}

/**
 * **Qui doit présenter un code** : un membre du bureau **nominatif**. Le compte du portail en est
 * exempté — personne d'autre que lui ne touche à sa double authentification, et son repli est la
 * commande serveur `npm run admin:reset-2fa`.
 */
export function exigeCodeActivation(compte: { estAdmin?: boolean | null; service?: boolean | null } | null | undefined): boolean {
  return !!compte?.estAdmin && !compte.service;
}

/** Message unique d'un code absent, faux ou expiré : il dit le geste qui débloque, et qui le fait. */
export const MESSAGE_CODE_ACTIVATION =
  "Demande un code d'activation à un membre du bureau : il le génère dans Comptes admin.";
