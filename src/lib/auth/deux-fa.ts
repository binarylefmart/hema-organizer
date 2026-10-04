import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { DEUX_FA_COOKIE, DUREE_DEUX_FA_MS } from "@/lib/constants";
import { chiffrer, dechiffrer } from "@/lib/crypto";
import { baseUrl, env } from "@/lib/env";
import { DUREE_ACTIVATION_MS } from "./acces-admin";
import { signPayload, verifySignedPayload } from "./tokens";
import { genererSecretTotp, pasDuCodeTotp, verifierCodeTotp } from "./totp";

/**
 * Connexion administrateur en deux temps : après le mot de passe, un cookie signé (10 min) porte
 * l'identité en attente ; la session n'est créée qu'une fois le code TOTP vérifié.
 * Si l'admin n'a pas encore configuré la double authentification, le même cookie porte
 * le secret provisoire (chiffré) le temps de scanner le QR code.
 */
export type Attente2fa = { uid: string; exp: number; remember: 0 | 1; suite: string; secret: string };

export async function ouvrirAttente2fa(args: { userId: string; remember: boolean; suite: string; secretProvisoire?: string }): Promise<void> {
  const payload: Attente2fa = {
    uid: args.userId,
    exp: Date.now() + DUREE_DEUX_FA_MS,
    remember: args.remember ? 1 : 0,
    suite: args.suite,
    secret: args.secretProvisoire ? chiffrer(args.secretProvisoire) : "",
  };
  const jar = await cookies();
  jar.set(DEUX_FA_COOKIE, signPayload(payload, env().SESSION_SECRET, "attente-2fa"), {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl().startsWith("https://"),
    path: "/",
    maxAge: DUREE_DEUX_FA_MS / 1000,
  });
}

export async function lireAttente2fa(): Promise<(Attente2fa & { secretProvisoire: string | null }) | null> {
  const jar = await cookies();
  const brut = jar.get(DEUX_FA_COOKIE)?.value;
  if (!brut) return null;
  const p = verifySignedPayload<Attente2fa>(brut, env().SESSION_SECRET, "attente-2fa");
  /*
   * **La forme se vérifie en entier, pas seulement les deux champs qui décident.**
   *
   * `verifySignedPayload` garantit désormais qu'un jeton d'un autre usage est refusé, mais il ne dit
   * rien de la *forme* de la charge : `signPayload` accepte n'importe quel objet de chaînes et de
   * nombres, et le type `Attente2fa` n'existe qu'à la compilation. Ici `secret` part directement dans
   * `dechiffrer`, qui commence par un `.split(".")` : une charge où il vaudrait un nombre lèverait un
   * `TypeError` **dans l'action de connexion**, c'est-à-dire une page d'erreur au lieu d'un refus.
   */
  if (!p || typeof p.uid !== "string" || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  if (typeof p.secret !== "string" || typeof p.suite !== "string" || (p.remember !== 0 && p.remember !== 1)) return null;
  return { ...p, secretProvisoire: p.secret ? dechiffrer(p.secret) : null };
}

export async function fermerAttente2fa(): Promise<void> {
  const jar = await cookies();
  jar.set(DEUX_FA_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/** Secret TOTP actif d'un compte (déchiffré), ou null si la double authentification n'est pas configurée. */
/**
 * **« Pas de secret » et « secret illisible » ne sont pas la même chose**.
 *
 * `secretTotpActif` rendait `null` pour les deux, et `dechiffrer` rend `null` pour tout échec — clé
 * absente comme mauvaise clé. Or la clé de chiffrement est dérivée de `SESSION_SECRET`
 * (`src/lib/crypto.ts`). Le jour où l'exploitant fait tourner ce secret — ce que `docs/SECURITE.md`
 * recommande lui-même —, **tous** les secrets TOTP deviennent illisibles, et voici ce qui se passait :
 *
 *  1. la connexion lisait `null`, en concluait « cette personne n'a pas de 2FA » et engendrait un
 *     **secret provisoire neuf** ;
 *  2. l'écran affichait un QR code sous le titre « Première connexion : protège ton accès » ;
 *  3. la vérification du code **écrasait** `totpSecret` et **remplaçait** les codes de secours ;
 *  4. au même instant les codes de secours cessaient d'être acceptés (`secretActif` valant `null`),
 *     donc la seule porte restante était le QR code neuf.
 *
 * Autrement dit : **le premier à arriver avec le mot de passe d'un administrateur inscrivait son
 * propre téléphone** sur ce compte, puis ouvrait l'espace admin. Rien ne cassait et rien ne
 * prévenait — les sessions, elles, survivent à la rotation (leur jeton est haché en SHA-256 pur), et
 * `/api/health` répondait 200.
 *
 * Aggravant : la colonne `totpSecret` étant non nulle, `deuxFaActive` répondait « 2FA en place », donc
 * l'écran ne proposait même pas le bouton « Plus tard » — il *exigeait* la réinscription.
 *
 * D'où trois états, et non deux. **Cette fonction remplace `secretTotpActif`, qui n'existe plus** : un
 * appelant qui n'aurait pas prévu le cas « illisible » ne compile pas, au lieu de le confondre
 * silencieusement avec « absent ». Même raison que l'usage obligatoire de `verifySignedPayload`.
 *
 * Le bon comportement dans ce cas est de **refuser** : un second facteur qu'on ne peut pas lire ne
 * s'échange pas contre un nouveau sur présentation du mot de passe. La sortie passe par un
 * administrateur (`npm run admin:reset-2fa`, ou la remise à zéro depuis l'espace admin), qui vide la
 * colonne — et le compte repasse alors par un vrai « absent ».
 */
export type EtatSecretTotp = { etat: "absent" } | { etat: "illisible" } | { etat: "actif"; secret: string };

/** Message unique du cas « illisible », lu par les écrans qui doivent le dire. */
export const MESSAGE_SECRET_2FA_ILLISIBLE =
  "La double authentification de ce compte ne peut pas être lue (la clé de chiffrement du serveur a changé). Par sécurité, elle n'est pas remplacée automatiquement : un administrateur doit la remettre à zéro.";

export async function etatSecretTotp(userId: string): Promise<EtatSecretTotp> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true } });
  if (!u?.totpSecret) return { etat: "absent" };
  const secret = dechiffrer(u.totpSecret);
  if (secret === null) {
    // Sans cette trace, l'incident est parfaitement muet : c'est tout le problème qu'on corrige.
    console.error(`[2fa] secret TOTP illisible pour ${userId} — la clé de chiffrement a-t-elle changé ?`);
    return { etat: "illisible" };
  }
  return { etat: "actif", secret };
}

/**
 * **Un code à six chiffres ne sert qu'une fois**.
 *
 * `verifierCodeTotp` ne regarde que l'horloge : le même code restait juste pendant toute sa fenêtre
 * de 30 s **et la tolérance d'un pas de chaque côté**, soit 30 à 90 s. Un code lu par-dessus
 * l'épaule, resté sur une capture d'écran ou dans le journal d'un proxy s'employait donc une
 * seconde fois, sur la porte même qui tient lieu de second facteur. Ce qu'on retient est le **pas
 * de temps** consommé (`User.totpDernierPas`) : tout pas inférieur ou égal est refusé.
 *
 * Trois propriétés à ne pas défaire :
 * - **un compte qui n'a jamais consommé de code (`null`) fonctionne** : c'est l'état de tous les
 *   comptes d'avant la colonne, et la migration n'enferme personne dehors ;
 * - **l'écriture est conditionnelle** (`where` portant la valeur attendue, comme
 *   `consommerCodeSecours`) : deux requêtes qui arrivent ensemble avec le même code lisent toutes
 *   deux la même borne, une seule écrit, l'autre est refusée. Sans cela « une seule fois » ne
 *   voudrait rien dire précisément dans le cas qui intéresse un attaquant ;
 * - **la borne monte, elle ne redescend jamais** — et comme un pas est une date, une borne héritée
 *   d'un ancien secret ne refuse que des codes déjà périmés (voir `desactiverTotp`).
 */
export async function consommerCodeTotp(userId: string, secretBase32: string, saisie: string, at = Date.now()): Promise<boolean> {
  const pas = pasDuCodeTotp(secretBase32, saisie, at);
  if (pas === null) return false;
  const u = await db.user.findUnique({ where: { id: userId }, select: { totpDernierPas: true } });
  const dernier = u?.totpDernierPas ?? null;
  if (dernier !== null && pas <= dernier) return false;
  try {
    // `where` avec la valeur attendue : si un autre appel a consommé un pas entre notre lecture et
    // notre écriture, aucune ligne ne correspond et Prisma lève (P2025) — donc on refuse.
    await db.user.update({ where: { id: userId, totpDernierPas: dernier }, data: { totpDernierPas: pas } });
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "P2025") return false;
    throw e;
  }
  return true;
}

export async function activerTotp(userId: string, secretBase32: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { totpSecret: chiffrer(secretBase32), totpActiveAt: new Date() } });
}

export async function desactiverTotp(userId: string): Promise<void> {
  // `totpDernierPas` n'est **pas** remis à zéro : ce n'est pas une donnée du secret, c'est une date
  // (un pas de temps). La garder ne refuse que des codes déjà périmés — l'effacer rouvrirait la
  // fenêtre du dernier code consommé pour qui reconfigure sa 2FA dans la minute qui suit.
  await db.user.update({ where: { id: userId }, data: { totpSecret: null, totpActiveAt: null, codesSecours: null } });
}

/** Codes de secours fraîchement générés, à afficher une seule fois : cookie signé et chiffré. */
const CODES_COOKIE = "hema_codes";
/**
 * **Noter huit codes n'est pas taper un code à six chiffres**.
 *
 * Cette échéance valait `DUREE_DEUX_FA_MS`, les dix minutes du *défi* de connexion — le temps de
 * lire un code sur son téléphone et de le recopier. Or l'écran qu'elle gouverne demande l'inverse :
 * recopier huit codes dans un gestionnaire de mots de passe, ou aller chercher une imprimante. Passé
 * le délai, les codes sont **engendrés, hachés en base et définitivement invisibles** : rechargée,
 * l'étape 3 du parcours `/admin/activer` s'annonce « terminée » et affirme que les codes de secours
 * sont en place, alors que leur titulaire ne les a jamais notés — et ce sont sa seule issue s'il perd
 * son téléphone. Une même constante servait donc deux besoins opposés ; l'affichage prend désormais le
 * temps du parcours de réglage — la même valeur, au même endroit, pour ne pas en faire deux qui dérivent.
 */
export const DUREE_AFFICHAGE_CODES_MS = DUREE_ACTIVATION_MS;
type AffichageCodes = { uid: string; exp: number; codes: string; suite: string };

export async function ouvrirAffichageCodes(userId: string, codes: string[], suite: string): Promise<void> {
  const payload: AffichageCodes = { uid: userId, exp: Date.now() + DUREE_AFFICHAGE_CODES_MS, codes: chiffrer(JSON.stringify(codes)), suite };
  const jar = await cookies();
  jar.set(CODES_COOKIE, signPayload(payload, env().SESSION_SECRET, "codes-secours"), {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl().startsWith("https://"),
    path: "/",
    maxAge: DUREE_AFFICHAGE_CODES_MS / 1000,
  });
}

export async function lireAffichageCodes(userId: string): Promise<{ codes: string[]; suite: string } | null> {
  const jar = await cookies();
  const brut = jar.get(CODES_COOKIE)?.value;
  if (!brut) return null;
  const p = verifySignedPayload<AffichageCodes>(brut, env().SESSION_SECRET, "codes-secours");
  if (!p || p.uid !== userId || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  if (typeof p.codes !== "string" || typeof p.suite !== "string") return null;
  const json = dechiffrer(p.codes);
  if (!json) return null;
  try {
    const codes = JSON.parse(json);
    return Array.isArray(codes) ? { codes: codes.filter((c): c is string => typeof c === "string"), suite: p.suite } : null;
  } catch {
    return null;
  }
}

export async function fermerAffichageCodes(): Promise<void> {
  const jar = await cookies();
  jar.set(CODES_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export { genererSecretTotp, verifierCodeTotp };
