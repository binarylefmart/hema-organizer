import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { hashToken } from "./tokens";

/**
 * Codes de secours de la double authentification (administrateurs) : 8 codes à usage unique,
 * affichés une seule fois, stockés hachés (SHA-256). Format : XXXX-XXXX (lettres/chiffres sans ambiguïté).
 */
export const NB_CODES_SECOURS = 8;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans I, O, 0, 1

export function genererCodesSecours(n = NB_CODES_SECOURS): string[] {
  const codes: string[] = [];
  while (codes.length < n) {
    let c = "";
    for (let i = 0; i < 8; i++) c += ALPHABET[randomInt(ALPHABET.length)];
    const code = `${c.slice(0, 4)}-${c.slice(4)}`;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Normalise une saisie : majuscules, sans espaces ni tirets → "XXXXXXXX". */
export function normaliserCodeSecours(saisie: string): string {
  return saisie.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export function ressembleAUnCodeSecours(saisie: string): boolean {
  return /^[A-Z2-9]{8}$/.test(normaliserCodeSecours(saisie));
}

export function hacherCodeSecours(code: string): string {
  return hashToken(`secours:${normaliserCodeSecours(code)}`);
}
const hacher = hacherCodeSecours;

export async function enregistrerCodesSecours(userId: string, codes: string[]): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { codesSecours: JSON.stringify(codes.map(hacher)) } });
}

export async function nombreCodesRestants(userId: string): Promise<number> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { codesSecours: true } });
  return lireHashes(u?.codesSecours).length;
}

function lireHashes(brut: string | null | undefined): string[] {
  if (!brut) return [];
  try {
    const v = JSON.parse(brut);
    return Array.isArray(v) ? v.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Reprises de l'écriture conditionnelle. Un tour perdu veut dire qu'un autre code a été consommé
 * entre notre lecture et notre écriture : le tour suivant repart de la liste à jour, et si le nôtre
 * y est encore, il est toujours bon.
 */
const TENTATIVES_ECRITURE = 5;

/**
 * Consomme un code de secours s'il est valide. Retourne le nombre de codes restants, ou null si refusé.
 *
 * **« À usage unique » doit valoir aussi quand deux requêtes arrivent ensemble**. La version
 * d'avant lisait la liste, en retirait le code, puis réécrivait : deux envois simultanés du même
 * code lisaient tous deux une liste où il figurait encore, et tous deux ouvraient une session — un
 * code à usage unique servant deux fois, sur la porte qui remplace le second facteur.
 *
 * L'écriture est donc **conditionnelle** : elle ne s'applique que si la liste rangée en base est
 * encore celle que nous avons lue (`updateMany` avec la valeur attendue dans son `where`, une seule
 * requête, et SQLite sérialise les écritures). Le perdant relit : si son code a été consommé entre
 * temps, il ne le retrouve pas et se fait refuser — ce qui est exactement la règle.
 */
export async function consommerCodeSecours(userId: string, saisie: string): Promise<number | null> {
  if (!ressembleAUnCodeSecours(saisie)) return null;
  const h = hacher(saisie);
  for (let essai = 0; essai < TENTATIVES_ECRITURE; essai++) {
    const u = await db.user.findUnique({ where: { id: userId }, select: { codesSecours: true } });
    const attendu = u?.codesSecours ?? null;
    const hashes = lireHashes(attendu);
    if (!hashes.includes(h)) return null;
    const restants = hashes.filter((x) => x !== h);
    const { count } = await db.user.updateMany({
      where: { id: userId, codesSecours: attendu },
      data: { codesSecours: JSON.stringify(restants) },
    });
    if (count === 1) return restants.length;
  }
  // Une bataille d'écritures sur les codes d'un même compte n'est pas un usage normal : on refuse.
  return null;
}
