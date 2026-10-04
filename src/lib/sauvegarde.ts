import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { env } from "./env";

/**
 * Sauvegarde quotidienne de la base SQLite vers BACKUP_DIR (volume /backups en production),
 * avec rétention de 30 jours.
 *
 * Technique : `VACUUM INTO '<fichier>'` — l'équivalent SQL de `sqlite3 .backup`. C'est une copie
 * cohérente réalisée par SQLite lui-même (transactionnelle, compactée), sans arrêter l'application
 * et sans dépendre du binaire `sqlite3` : rien à installer dans l'image.
 * Les fichiers annexes (-wal, -shm) n'ont pas à être copiés, VACUUM INTO produit une base complète.
 */

/** Nombre de jours de conservation des sauvegardes. */
export const RETENTION_JOURS = 30;

const PREFIXE = "hema-";
const SUFFIXE = ".db";
/** hema-2026-09-22.db */
const MOTIF = /^hema-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * **La copie d'avant réparation : une base complète qui ne mourait jamais**.
 *
 * `scripts/reparer-donnees.ts` copie la base **entière** avant d'écrire, sous
 * `avant-reparation-<horodatage>.db`, dans ce même dossier — et l'annonçait par une ligne de console :
 * « cette copie n'est jamais purgée : efface-la à la main quand tu es sûr du résultat ». Elle ne portait
 * pas le nom du jour, donc `MOTIF` ne la voyait pas, donc la purge ne la touchait pas. Pendant ce temps
 * l'écran *À propos* promettait « une sauvegarde est écrite chaque nuit et **conservée 30 jours** », et
 * la comptait dans son « N fichiers, X Mo » sans la distinguer.
 *
 * Ce qu'elle contient : noms, adresses, empreintes de mots de passe, secret TOTP chiffré, jetons hachés,
 * webhook et jeton de bot chiffrés, **tels qu'ils étaient ce jour-là**. Elle part chaque nuit vers le
 * partage de sauvegarde avec le reste du dossier, et elle survit à une suppression de compte comme à une
 * demande d'effacement. Le seul rappel était une ligne lue une fois, le jour où elle est écrite.
 *
 * Elle est donc purgée aussi, mais **plus tard** : une copie de secours doit survivre au temps qu'il faut
 * pour s'assurer que la réparation était bonne, ce qui se compte en semaines, pas en jours. Quatre-vingt-dix
 * jours, et l'écran le dit.
 */
const MOTIF_REPARATION = /^avant-reparation-[\d-]+\.db$/;
export const RETENTION_REPARATION_JOURS = 90;

/** Dossier de destination (BACKUP_DIR), en chemin absolu. */
export function dossierSauvegardes(): string {
  return path.resolve(env().BACKUP_DIR);
}

/** Nom du fichier du jour (une sauvegarde par jour, écrasée si relancée). */
export function nomSauvegarde(now: Date): string {
  const jour = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `${PREFIXE}${jour}${SUFFIXE}`;
}

/** Supprime les sauvegardes de plus de RETENTION_JOURS jours. Renvoie le nombre de fichiers supprimés. */
export async function purgerSauvegardes(now = new Date()): Promise<number> {
  const dossier = dossierSauvegardes();
  const jour = 24 * 60 * 60 * 1000;
  const limite = now.getTime() - RETENTION_JOURS * jour;
  const limiteReparation = now.getTime() - RETENTION_REPARATION_JOURS * jour;
  let supprimees = 0;
  let fichiers: string[];
  try {
    fichiers = await readdir(dossier);
  } catch {
    return 0;
  }
  for (const nom of fichiers) {
    const reparation = MOTIF_REPARATION.test(nom);
    if (!MOTIF.test(nom) && !reparation) continue;
    const complet = path.join(dossier, nom);
    try {
      const infos = await stat(complet);
      if (infos.mtimeMs < (reparation ? limiteReparation : limite)) {
        await rm(complet, { force: true });
        supprimees += 1;
        continue;
      }
      /*
       * **Les sauvegardes d' sont restées lisibles par tout le monde** (relecture de sécurité,
       * mesuré : `hema-2026-09-23.db` et `hema-2026-09-24.db` en `-rw-r--r--`). Le `chmod 0600` posé
       * ce jour-là ne vaut que pour les fichiers **à venir** : les copies antérieures n'ont jamais
       * été reprises, et une sauvegarde porte les noms, les adresses, les empreintes de mots de
       * passe et les secrets chiffrés du club — lisibles par tout compte local.
       *
       * Le balayage quotidien les remédie donc au passage, et seulement quand c'est nécessaire (un
       * `chmod` inutile par nuit et par fichier serait du bruit). Comme ailleurs dans ce fichier, un
       * échec ne fait pas perdre la sauvegarde : elle vaut mieux que son mode.
       */
      if ((infos.mode & 0o077) !== 0) {
        await chmod(complet, 0o600).catch((e) => {
          console.warn("[sauvegarde] impossible de restreindre les droits d'une sauvegarde ancienne", e);
        });
      }
    } catch {
      // fichier disparu entre-temps : rien à faire
    }
  }
  return supprimees;
}

/**
 * Suffixe du fichier de travail. Il ne correspond volontairement **pas** à `MOTIF` : la purge ne le
 * voit pas, donc elle ne peut pas emporter une sauvegarde en cours d'écriture.
 */
const SUFFIXE_PARTIEL = ".partiel";

/** hema-2026-09-22.db.partiel — un fichier de travail, du jour ou d'un autre. */
const MOTIF_PARTIEL = /^hema-\d{4}-\d{2}-\d{2}\.db\.partiel$/;

/**
 * Âge à partir duquel un `.partiel` est tenu pour **abandonné**.
 *
 * Un `VACUUM INTO` sur cette base se compte en millisecondes ; six heures sont hors de portée de
 * tout écrit en cours, et couvrent largement le cas d'une relance manuelle lancée pendant le
 * balayage de la nuit — on ne veut surtout pas arracher son fichier à un vacuum qui travaille.
 */
export const DELAI_PARTIEL_ORPHELIN_MS = 6 * 60 * 60 * 1000;

/**
 * **Balaie les fichiers de travail abandonnés.** Renvoie le nombre de fichiers effacés.
 *
 * Un processus tué entre le `VACUUM INTO` et le renommage laisse un `hema-<jour>.db.partiel` —
 * une copie complète de la base. Celui **du jour** est effacé au passage suivant (le vacuum refuse
 * d'écrire sur un fichier existant), mais celui d'**un autre jour** ne l'était jamais : `MOTIF` ne
 * reconnaît que `hema-<jour>.db`, et volontairement pas les `.partiel`, pour que la purge ne puisse
 * pas emporter une sauvegarde en cours d'écriture. Le résidu restait donc là, invisible et
 * immortel, à occuper le volume qu'on s'applique justement à ne pas saturer.
 *
 * D'où ce balayage, à part de `purgerSauvegardes` : ce n'est pas la rétention des 30 jours (rien à
 * conserver ici), et le nombre qu'il rend n'est pas un nombre de sauvegardes supprimées.
 */
export async function purgerPartielsOrphelins(now = new Date()): Promise<number> {
  const dossier = dossierSauvegardes();
  const limite = now.getTime() - DELAI_PARTIEL_ORPHELIN_MS;
  let fichiers: string[];
  try {
    fichiers = await readdir(dossier);
  } catch {
    return 0;
  }
  let effaces = 0;
  for (const nom of fichiers) {
    if (!MOTIF_PARTIEL.test(nom)) continue;
    const complet = path.join(dossier, nom);
    try {
      const infos = await stat(complet);
      if (infos.mtimeMs >= limite) continue;
      await rm(complet, { force: true });
      effaces += 1;
    } catch {
      // fichier disparu entre-temps : rien à faire
    }
  }
  return effaces;
}

/**
 * Écrit la sauvegarde du jour et purge les anciennes.
 * Lève une erreur si la base ou le dossier de destination sont inaccessibles.
 *
 * **L'ordre des trois gestes est la seule chose qui compte ici**, et il vient d'une panne :
 *
 *  1. **Purger d'abord.** La purge passait après l'écriture. Sur un volume plein, le `VACUUM INTO`
 *     levait, et la purge des 30 jours — celle qui aurait justement libéré la place — n'était
 *     jamais atteinte : l'échec se rejouait à l'identique toutes les nuits, sans jamais pouvoir
 *     s'en sortir seul. Elle est donc appelée **avant** (pour faire de la place) et **après** (une
 *     sauvegarde neuve peut en faire sortir une du délai de rétention).
 *  2. **Écrire à côté.** On écrivait sur le nom définitif, après avoir effacé le fichier du jour
 *     (`VACUUM INTO` refuse d'écrire sur un fichier existant) : un échec laissait la journée sans
 *     aucune sauvegarde, l'ancienne détruite et la nouvelle jamais écrite.
 *  3. **Renommer une fois écrit.** Le renommage est atomique sur le même volume : il n'existe
 *     aucun instant où l'on n'a ni l'ancienne ni la nouvelle.
 */
export async function sauvegarderBase(now = new Date()): Promise<{ fichier: string; octets: number; supprimees: number }> {
  const dossier = dossierSauvegardes();
  await mkdir(dossier, { recursive: true });
  const fichier = path.join(dossier, nomSauvegarde(now));
  const partiel = `${fichier}${SUFFIXE_PARTIEL}`;
  // 1. De la place d'abord : c'est la seule chose qui puisse débloquer un volume saturé.
  const purgeesAvant = await purgerSauvegardes(now);
  // …et les fichiers de travail qu'une nuit interrompue a laissés **un autre jour** : ils portent le
  // nom de leur jour, donc plus personne ne les regardait, alors qu'ils pèsent une base entière.
  await purgerPartielsOrphelins(now);
  // Reste éventuel d'une nuit interrompue : VACUUM INTO refuse d'écrire sur un fichier existant.
  await rm(partiel, { force: true });
  // Le chemin ne peut pas être paramétré dans un VACUUM : on échappe les apostrophes à la main.
  // (La valeur vient de BACKUP_DIR, une variable d'environnement du serveur, jamais d'une saisie utilisateur.)
  try {
    await db.$executeRawUnsafe(`VACUUM INTO '${partiel.replace(/'/g, "''")}'`);
  } catch (e) {
    // Ne pas laisser un fichier à moitié écrit occuper le disque qu'on vient de dégager.
    await rm(partiel, { force: true });
    throw e;
  }
  const { size } = await stat(partiel);
  /*
   * **Le fichier naît en 0600, et c'est le code qui le dit**.
   *
   * Rien ne posait de mode : `VACUUM INTO` écrit donc selon l'`umask` du processus, soit 0644 en pratique
   * — vérifié sur les fichiers déjà produits. Sur le serveur tel qu'il est installé ce n'est pas une
   * faille : le dossier est en 0750, un compte local ne le traverse pas. Mais le mode voyage avec le
   * fichier : une copie qui **sort** du dossier emporte 0644 — le `scp` vers le poste de l'opérateur, la
   * synchronisation vers le partage de sauvegarde, un `docker cp`. Et une base de ce club n'est pas
   * chiffrée : elle porte les noms, les adresses, les empreintes de mots de passe et les secrets chiffrés.
   *
   * Le mode devient donc une propriété du **code** au lieu d'une propriété de la procédure
   * d'installation. Posé sur le fichier de travail, avant le renommage : il n'existe aucun instant où le
   * fichier définitif soit lisible par tout le monde. Un échec de `chmod` (système de fichiers qui ne les
   * gère pas) ne fait pas perdre la sauvegarde — elle vaut mieux que son mode.
   */
  await chmod(partiel, 0o600).catch((e) => {
    console.warn("[sauvegarde] impossible de restreindre les droits du fichier (il reste lisible selon l'umask)", e);
  });
  // 3. La sauvegarde du jour n'est remplacée qu'à cet instant, par une qui existe déjà.
  await rename(partiel, fichier);
  const supprimees = purgeesAvant + (await purgerSauvegardes(now));
  return { fichier, octets: size, supprimees };
}
