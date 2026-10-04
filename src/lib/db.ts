import { PrismaClient } from "@prisma/client";

/** Client Prisma unique (évite la multiplication des connexions en dev avec le HMR). */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * **La base passe en journal WAL au démarrage du serveur**, une fois pour toutes.
 *
 * SQLite n'accepte qu'un écrivain à la fois, et chaque requête authentifiée écrit désormais un peu
 * (session glissante, échéance de l'espace admin, journal d'audit, journal des notifications). En
 * mode `delete` — celui de SQLite par défaut —, une **lecture** en cours empêche aussi l'écrivain de
 * valider : Prisma ouvrant plusieurs connexions, les écritures s'attendaient les unes les autres
 * derrière les lectures jusqu'au délai d'attente (`busy_timeout`, 5 s), puis échouaient en
 * « database is locked » ou « Socket timeout ». Mesuré sur une copie de la base de démonstration,
 * 240 opérations simultanées (échéance d'élévation, audit, lecture lente, lot d'écritures) :
 * médiane 8,5 s, maximum 13 s et 5 à 6 échecs en `delete` ; médiane 2 s, maximum 3,7 s et zéro
 * échec en WAL. En WAL, lecteurs et écrivain ne se bloquent plus : seuls les écrivains se mettent
 * à la file.
 *
 * Le mode est **enregistré dans le fichier** : la commande est idempotente (une base déjà en WAL
 * répond « wal » sans rien changer) et vaut pour toutes les connexions, celles de `prisma migrate`,
 * du seed et de l'outil de réparation comprises. Les fichiers annexes `hema.db-wal` et `hema.db-shm`
 * vivent à côté de la base dans `/data` : la sauvegarde (`VACUUM INTO`) les intègre, et la
 * restauration les efface déjà (docs/DEPLOIEMENT.md § 10).
 *
 * Ne lève jamais : un échec laisse la base dans son mode précédent, qui fonctionne, plus lentement.
 * Retourne le mode obtenu (`null` si la lecture a échoué).
 */
export async function activerJournalWal(client: PrismaClient = db): Promise<string | null> {
  try {
    const lignes = await client.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode = WAL");
    const mode = lignes[0]?.journal_mode ?? null;
    if (mode !== "wal") console.warn(`[db] journal WAL refusé, la base reste en mode « ${mode} »`);
    return mode;
  } catch (e) {
    console.error("[db] impossible de passer la base en journal WAL", e);
    return null;
  }
}
