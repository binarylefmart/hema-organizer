import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Sauvegarde quotidienne de la base** — et surtout : ce qui doit tenir le jour où le volume est
 * plein, parce que c'est exactement ce jour-là qu'on a besoin d'elle.
 *
 * Deux règles, toutes les deux nées d'un enchaînement qui se mordait la queue :
 *
 *  1. **La purge des anciennes passe avant l'écriture.** Elle passait après : sur un volume saturé,
 *     le `VACUUM INTO` levait, la purge des 30 jours — celle qui aurait justement libéré la place —
 *     n'était jamais atteinte, et l'échec se rejouait à l'identique toutes les nuits.
 *  2. **On écrit dans un fichier temporaire, renommé une fois écrit.** La sauvegarde du jour était
 *     effacée *avant* d'être refaite (`VACUUM INTO` refuse d'écrire sur un fichier existant) : un
 *     échec laissait la journée sans aucune sauvegarde. Le renommage est atomique, donc il n'existe
 *     jamais d'instant où l'on n'a ni l'ancienne ni la nouvelle.
 *
 * Ni disque ni base : `node:fs/promises` et `@/lib/db` sont simulés.
 */

const faux = vi.hoisted(() => ({
  /** Dossier des sauvegardes : nom de fichier → date de dernière modification */
  fichiers: new Map<string, Date>(),
  /** Effacements demandés au disque, dans l'ordre */
  effaces: [] as string[],
  /** Renommages demandés au disque : [source, destination] */
  renommages: [] as Array<[string, string]>,
  /** Requêtes SQL brutes reçues (les `VACUUM INTO`) */
  sql: [] as string[],
  /** Quand elle est posée, le `VACUUM INTO` lève cette erreur (volume plein) */
  erreurVacuum: null as Error | null,
  /** Modes demandés au disque : [fichier, mode] — le fichier doit naître en 0600. */
  modes: [] as Array<[string, number]>,
}));

const nomDe = (chemin: string) => chemin.split("/").pop()!;

vi.mock("node:fs/promises", () => {
  const api = {
    mkdir: vi.fn(async () => undefined),
    chmod: vi.fn(async (chemin: string, mode: number) => {
      faux.modes.push([nomDe(String(chemin)), mode]);
    }),
    readdir: vi.fn(async () => [...faux.fichiers.keys()]),
    stat: vi.fn(async (chemin: string) => {
      const mtime = faux.fichiers.get(nomDe(chemin));
      if (!mtime) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { mtime, mtimeMs: mtime.getTime(), size: 4096 };
    }),
    rm: vi.fn(async (chemin: string) => {
      const nom = nomDe(chemin);
      if (faux.fichiers.delete(nom)) faux.effaces.push(nom);
    }),
    rename: vi.fn(async (source: string, destination: string) => {
      const mtime = faux.fichiers.get(nomDe(source));
      if (!mtime) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      faux.fichiers.delete(nomDe(source));
      faux.fichiers.set(nomDe(destination), mtime);
      faux.renommages.push([nomDe(source), nomDe(destination)]);
    }),
  };
  return { ...api, default: api };
});

vi.mock("@/lib/db", () => ({
  db: {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      faux.sql.push(sql);
      if (faux.erreurVacuum) throw faux.erreurVacuum;
      // VACUUM INTO '<chemin>' : le fichier existe à partir de là, et pas avant
      const chemin = sql.match(/'(.*)'/)?.[1] ?? "";
      faux.fichiers.set(nomDe(chemin), new Date(MAINTENANT));
      return 0;
    }),
  },
}));

const { DELAI_PARTIEL_ORPHELIN_MS, RETENTION_JOURS, RETENTION_REPARATION_JOURS, nomSauvegarde, purgerPartielsOrphelins, purgerSauvegardes, sauvegarderBase } = await import("@/lib/sauvegarde");

const MAINTENANT = new Date("2026-09-23T03:00:00");
const ilYA = (jours: number) => new Date(MAINTENANT.getTime() - jours * 24 * 3600_000);
const DU_JOUR = nomSauvegarde(MAINTENANT);
const VIEILLE = "hema-2026-08-01.db";
const HIER = "hema-2026-09-22.db";

beforeEach(() => {
  faux.fichiers.clear();
  faux.effaces.length = 0;
  faux.renommages.length = 0;
  faux.sql.length = 0;
  faux.erreurVacuum = null;
  faux.modes.length = 0;
});

describe("les droits du fichier", () => {
  /**
   * **Le mode est une propriété du code, pas de la procédure d'installation**. Rien n'en posait :
   * `VACUUM INTO` écrivait selon l'`umask`, soit 0644 en pratique. Sur le serveur tel qu'il est
   * installé, le dossier en 0750 suffisait — mais le mode **voyage avec le fichier** : un `scp`
   * vers le poste de l'opérateur, une synchronisation vers le partage de sauvegarde, un `docker
   * cp`, et une base non chiffrée (noms, adresses, empreintes de mots de passe) devient lisible par
   * tout compte de la machine d'arrivée.
   */
  it("naît en 0600, et avant d'être renommé", async () => {
    await sauvegarderBase(MAINTENANT);
    const attendu = nomSauvegarde(MAINTENANT);
    expect(faux.modes).toEqual([[`${attendu}.partiel`, 0o600]]);
    // Posé sur le fichier de travail : il n'existe aucun instant où le fichier définitif soit lisible
    // par tout le monde.
    expect(faux.renommages).toEqual([[`${attendu}.partiel`, attendu]]);
  });
});

describe("la copie prise avant une réparation", () => {
  const COPIE = "avant-reparation-2026-09-22-031500.db";

  /**
   * **Elle ne mourait jamais**. `scripts/reparer-donnees.ts` copie la base **entière** avant
   * d'écrire, dans ce même dossier, et l'annonçait par une ligne de console : « cette copie n'est
   * jamais purgée ». Elle ne porte pas le nom du jour, donc la purge ne la voyait pas — pendant que
   * l'écran *À propos* promettait « conservée 30 jours » et la comptait dans son poids total sans
   * la distinguer. Noms, adresses, empreintes de mots de passe et secrets chiffrés du jour de la
   * réparation, pour toujours, et partant chaque nuit vers le partage de sauvegarde avec le reste.
   *
   * Elle est purgée, mais **plus tard** : une copie de secours doit survivre au temps qu'il faut pour
   * s'assurer que la réparation était bonne, ce qui se compte en semaines.
   */
  it("survit à la rétention ordinaire, et s'en va au bout de la sienne", async () => {
    faux.fichiers.set(COPIE, ilYA(RETENTION_JOURS + 10));
    faux.fichiers.set(VIEILLE, ilYA(RETENTION_JOURS + 10));
    // La sauvegarde de nuit du même âge part ; la copie de réparation reste.
    expect(await purgerSauvegardes(MAINTENANT)).toBe(1);
    expect(faux.effaces).toEqual([VIEILLE]);

    faux.effaces.length = 0;
    faux.fichiers.set(COPIE, ilYA(RETENTION_REPARATION_JOURS + 1));
    expect(await purgerSauvegardes(MAINTENANT)).toBe(1);
    expect(faux.effaces).toEqual([COPIE]);
  });

  it("une copie plus jeune que sa rétention ne part pas", async () => {
    faux.fichiers.set(COPIE, ilYA(RETENTION_REPARATION_JOURS - 1));
    expect(await purgerSauvegardes(MAINTENANT)).toBe(0);
    expect(faux.effaces).toEqual([]);
  });

  it("sa rétention est plus longue que celle des sauvegardes de nuit", () => {
    expect(RETENTION_REPARATION_JOURS).toBeGreaterThan(RETENTION_JOURS);
  });
});

describe("rétention des sauvegardes", () => {
  it("efface celles de plus de 30 jours, garde les autres et ignore les intrus", async () => {
    faux.fichiers.set(VIEILLE, ilYA(RETENTION_JOURS + 5));
    faux.fichiers.set(HIER, ilYA(1));
    faux.fichiers.set("notes.txt", ilYA(400));
    expect(await purgerSauvegardes(MAINTENANT)).toBe(1);
    expect(faux.effaces).toEqual([VIEILLE]);
  });
});

describe("sauvegarde du jour", () => {
  it("purge les anciennes AVANT d'écrire, pour libérer la place dont le vacuum a besoin", async () => {
    faux.fichiers.set(VIEILLE, ilYA(RETENTION_JOURS + 5));
    await sauvegarderBase(MAINTENANT);
    // L'ordre est tout l'intérêt : la vieille disparaît avant que le VACUUM ne demande des octets
    expect(faux.effaces[0]).toBe(VIEILLE);
    expect(faux.sql).toHaveLength(1);
  });

  it("écrit à côté, puis renomme : la sauvegarde d'hier n'est jamais détruite d'avance", async () => {
    faux.fichiers.set(HIER, ilYA(1));
    const r = await sauvegarderBase(MAINTENANT);
    // Le VACUUM n'écrit pas sur le nom définitif, mais sur un fichier de travail…
    const cible = faux.sql[0].match(/'(.*)'/)![1];
    expect(nomDe(cible)).not.toBe(DU_JOUR);
    // …renommé ensuite sur le nom du jour
    expect(faux.renommages).toEqual([[nomDe(cible), DU_JOUR]]);
    expect(faux.fichiers.has(DU_JOUR)).toBe(true);
    expect(faux.fichiers.has(HIER)).toBe(true);
    expect(r).toMatchObject({ octets: 4096, supprimees: 0 });
    expect(nomDe(r.fichier)).toBe(DU_JOUR);
  });

  it("disque plein : la purge a quand même eu lieu, et la sauvegarde d'hier est intacte", async () => {
    faux.fichiers.set(VIEILLE, ilYA(RETENTION_JOURS + 5));
    faux.fichiers.set(HIER, ilYA(1));
    faux.erreurVacuum = Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });

    await expect(sauvegarderBase(MAINTENANT)).rejects.toThrow(/full/);

    // La place a été libérée : la nuit suivante a une chance d'aboutir au lieu de rejouer l'échec
    expect(faux.effaces).toContain(VIEILLE);
    // Et rien de récent n'a été sacrifié pour un fichier qui n'a jamais été écrit
    expect(faux.fichiers.has(HIER)).toBe(true);
    expect(faux.renommages).toEqual([]);
  });

  it("remplace la sauvegarde du jour quand on la relance, sans laisser de fichier de travail", async () => {
    faux.fichiers.set(DU_JOUR, ilYA(0));
    await sauvegarderBase(MAINTENANT);
    expect(faux.fichiers.has(DU_JOUR)).toBe(true);
    // Un seul fichier dans le dossier : pas de résidu « .partiel » qui s'accumulerait chaque nuit
    expect([...faux.fichiers.keys()]).toEqual([DU_JOUR]);
  });
});

/**
 * **Les fichiers de travail abandonnés.** Un processus tué entre le `VACUUM INTO` et le renommage
 * laisse un `hema-<jour>.db.partiel`. Celui du jour est effacé au passage suivant (le vacuum refuse
 * d'écrire sur un fichier existant), mais **celui d'un autre jour ne l'était jamais** : le motif de
 * la purge ne voit que `hema-<jour>.db`, exprès — pour ne pas emporter une sauvegarde en cours
 * d'écriture. Résultat : une copie complète de la base, invisible et immortelle, sur le volume même
 * qu'il s'agit de ne pas saturer.
 */
describe("fichiers de travail abandonnés", () => {
  const PARTIEL_HIER = "hema-2026-09-22.db.partiel";
  const PARTIEL_VIEUX = "hema-2026-08-01.db.partiel";

  it("balaie les .partiel d'un autre jour, et laisse les sauvegardes tranquilles", async () => {
    faux.fichiers.set(PARTIEL_HIER, ilYA(1));
    faux.fichiers.set(PARTIEL_VIEUX, ilYA(53));
    faux.fichiers.set(HIER, ilYA(1));
    faux.fichiers.set("notes.txt", ilYA(400));
    expect(await purgerPartielsOrphelins(MAINTENANT)).toBe(2);
    expect(faux.effaces.sort()).toEqual([PARTIEL_VIEUX, PARTIEL_HIER].sort());
    expect(faux.fichiers.has(HIER)).toBe(true);
    expect(faux.fichiers.has("notes.txt")).toBe(true);
  });

  it("ne touche pas à un .partiel tout frais : il peut être en cours d'écriture", async () => {
    // Un `VACUUM INTO` en cours ailleurs (relance manuelle pendant le balayage de la nuit) ne doit
    // pas se voir arracher son fichier sous les doigts.
    faux.fichiers.set(PARTIEL_HIER, new Date(MAINTENANT.getTime() - DELAI_PARTIEL_ORPHELIN_MS / 2));
    expect(await purgerPartielsOrphelins(MAINTENANT)).toBe(0);
    expect(faux.effaces).toEqual([]);
  });

  it("la sauvegarde de la nuit balaie les .partiel oubliés avant d'écrire", async () => {
    faux.fichiers.set(PARTIEL_VIEUX, ilYA(53));
    await sauvegarderBase(MAINTENANT);
    // Avant le vacuum : c'est de la place rendue au volume, là où elle sert.
    expect(faux.effaces[0]).toBe(PARTIEL_VIEUX);
    expect([...faux.fichiers.keys()]).toEqual([DU_JOUR]);
  });
});
