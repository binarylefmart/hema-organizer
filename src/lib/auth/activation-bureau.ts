import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { chiffrer, dechiffrer } from "@/lib/crypto";
import { baseUrl, env } from "@/lib/env";
import { signPayload, verifySignedPayload } from "./tokens";
import {
  DUREE_CODE_ACTIVATION_MS,
  empreinteCodeActivation,
  genererCodeActivation,
  verifierCodeActivation,
  type VerdictCodeActivation,
} from "./code-activation";

/**
 * **Le code d'activation côté base et côté écran** (la forme du code est dans `code-activation.ts`).
 *
 * Naissance (`emettreCodeActivation`) : chaque fois qu'un membre du bureau doit (re)faire son
 * réglage **par le fait d'un autre administrateur** — nomination, réinitialisation de sa 2FA, remise
 * à zéro de son accès — et à la demande, depuis sa ligne dans Comptes admin. Un nouveau code
 * **remplace** le précédent (une seule colonne : l'ancien cesse d'exister au même instant).
 *
 * Usage unique (`consommerCodeActivation`) : écriture **conditionnelle** sur l'empreinte attendue,
 * comme `consommerCodeTotp` — deux requêtes qui arrivent ensemble avec le même code lisent la même
 * empreinte, une seule l'efface, l'autre est refusée.
 *
 * Le code en clair n'existe qu'à deux endroits, et brièvement : la mémoire de l'action qui l'émet, et
 * le cookie d'affichage **signé, chiffré, nommé à l'administrateur qui l'a généré** (15 minutes). Ni
 * la base, ni le journal d'audit, ni une URL, ni un email, ni une notification ne le portent.
 */

/** Émet un code neuf pour ce compte (l'ancien cesse de valoir) et le rend **en clair, une seule fois**. */
export async function emettreCodeActivation(userId: string, maintenant = Date.now()): Promise<{ code: string; expireLe: Date }> {
  const code = genererCodeActivation();
  const expireLe = new Date(maintenant + DUREE_CODE_ACTIVATION_MS);
  await db.user.update({
    where: { id: userId },
    data: { codeActivationHash: empreinteCodeActivation(userId, code, env().SESSION_SECRET), codeActivationExpireLe: expireLe },
  });
  return { code, expireLe };
}

/** Vérifie la saisie contre le code en cours du compte, **sans le consommer**. */
export async function controlerCodeActivation(userId: string, saisie: unknown, maintenant = Date.now()): Promise<VerdictCodeActivation> {
  const etat = await db.user.findUnique({ where: { id: userId }, select: { codeActivationHash: true, codeActivationExpireLe: true } });
  return verifierCodeActivation(userId, etat, saisie, env().SESSION_SECRET, maintenant);
}

/** Consomme le code : `false` si un autre appel l'a consommé (ou remplacé) entre-temps. */
export async function consommerCodeActivation(userId: string, empreinte: string): Promise<boolean> {
  try {
    await db.user.update({ where: { id: userId, codeActivationHash: empreinte }, data: { codeActivationHash: null, codeActivationExpireLe: null } });
    return true;
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "P2025") return false;
    throw e;
  }
}

/** Efface le code en cours (droits retirés : il n'a plus d'objet). */
export async function effacerCodeActivation(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { codeActivationHash: null, codeActivationExpireLe: null } });
}

/* ------------------------------------------------------------------------------------------------ */
/* Affichage unique à l'administrateur qui l'a généré                                               */
/* ------------------------------------------------------------------------------------------------ */

const COOKIE_CODES_ACTIVATION = "hema_codes_activation";
/**
 * Le temps de lire le code et de prévenir la personne. Passé ce délai le code ne se relit plus nulle
 * part : on en génère un nouveau, qui remplace l'ancien.
 */
export const DUREE_AFFICHAGE_CODE_ACTIVATION_MS = 15 * 60 * 1000;

export type CodeActivationAffiche = { userId: string; nom: string; code: string; expireLe: number };
type ChargeAffichage = { uid: string; exp: number; codes: string };

function lignesValides(v: unknown): CodeActivationAffiche[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (l): l is CodeActivationAffiche =>
      !!l && typeof l === "object" && typeof l.userId === "string" && typeof l.nom === "string" && typeof l.code === "string" && typeof l.expireLe === "number",
  );
}

/** Codes en attente d'affichage **pour cet administrateur** : un cookie au nom d'un autre est ignoré. */
export async function lireCodesActivationAffiches(acteurId: string): Promise<CodeActivationAffiche[]> {
  const brut = (await cookies()).get(COOKIE_CODES_ACTIVATION)?.value;
  if (!brut) return [];
  const p = verifySignedPayload<ChargeAffichage>(brut, env().SESSION_SECRET, "code-activation");
  if (!p || p.uid !== acteurId || typeof p.exp !== "number" || p.exp < Date.now()) return [];
  // `codes` part dans `dechiffrer`, qui découpe une chaîne : la forme se vérifie, elle ne se suppose pas.
  if (typeof p.codes !== "string" || !p.codes) return [];
  const json = dechiffrer(p.codes);
  if (!json) return [];
  try {
    return lignesValides(JSON.parse(json));
  } catch {
    return [];
  }
}

/**
 * Ajoute des codes à afficher à l'administrateur `acteurId`. Ceux qu'il a déjà en attente restent,
 * sauf celui d'une même personne, que le nouveau remplace (l'ancien code ne vaut plus rien).
 */
export async function afficherCodesActivation(acteurId: string, nouveaux: CodeActivationAffiche[]): Promise<void> {
  if (nouveaux.length === 0) return;
  const remplaces = new Set(nouveaux.map((l) => l.userId));
  const lignes = [...(await lireCodesActivationAffiches(acteurId)).filter((l) => !remplaces.has(l.userId)), ...nouveaux];
  const charge: ChargeAffichage = { uid: acteurId, exp: Date.now() + DUREE_AFFICHAGE_CODE_ACTIVATION_MS, codes: chiffrer(JSON.stringify(lignes)) };
  (await cookies()).set(COOKIE_CODES_ACTIVATION, signPayload(charge, env().SESSION_SECRET, "code-activation"), {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl().startsWith("https://"),
    path: "/",
    maxAge: DUREE_AFFICHAGE_CODE_ACTIVATION_MS / 1000,
  });
}

export async function fermerCodesActivationAffiches(): Promise<void> {
  (await cookies()).set(COOKIE_CODES_ACTIVATION, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/**
 * **Émettre, journaliser, afficher** : le geste commun des quatre portes (nomination, réinitialisation
 * de la 2FA d'un autre, remise à zéro de l'accès, bouton « Générer un code d'activation »). Aucune
 * garde ici — elles restent dans chaque action, avant l'appel. Le journal porte l'échéance, jamais le code.
 */
export async function remettreCodeActivation(
  acteur: { id: string; email: string | null },
  cible: { id: string; prenom: string; nom: string },
  origine: "nomination" | "reinitialisation_2fa" | "reinitialisation_acces" | "demande",
): Promise<CodeActivationAffiche> {
  const { code, expireLe } = await emettreCodeActivation(cible.id);
  await audit(acteur, "deux_fa.code_activation_genere", cible.id, { echeance: expireLe.toISOString(), origine });
  return { userId: cible.id, nom: `${cible.prenom} ${cible.nom}`.trim(), code, expireLe: expireLe.getTime() };
}
