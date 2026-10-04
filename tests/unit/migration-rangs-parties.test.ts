import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { libellePartie, prochainLibellePartie } from "@/lib/constants";

/**
 * **Le SQL des migrations n'était couvert par aucun test** — et c'est par ce trou qu'est passée la
 * renumérotation fausse de `20260929200000_parties_libres_et_second_instructeur` : son dernier
 * `UPDATE` calculait le rang d'une ligne avec une sous-requête corrélée, donc **contre une table
 * déjà à moitié réécrite par le même `UPDATE`** (SQLite met à jour ligne par ligne). Résultat sur
 * une séance partiellement remplie : des rangs troués et dupliqués — `1, 1` là où il fallait `0, 1`.
 *
 * Ce fichier fait tourner **les vrais fichiers `migration.sql`** sur une base SQLite jetable, avec
 * des séances partiellement remplies fabriquées exprès (la base de démonstration n'en contient
 * aucune : ses séances ont leurs quatre cases, et c'est pourquoi la faute ne se voyait pas).
 *
 * Ce qu'il verrouille, une fois pour toutes :
 *
 * 1. **`ordre` est contigu à partir de 0, séance par séance**, après la migration et toutes celles
 *    qui la suivent. C'est l'invariant sur lequel tout le reste s'appuie — l'affichage du programme,
 *    « Opt 2 », l'API publique, les pages de partage.
 * 2. **Le libellé du modèle dit le rang que la partie occupe vraiment dans sa nature**
 *    (`libellePartie`, src/lib/constants.ts). C'est le second défaut de la nuit, et il ne se
 *    voyait pas non plus : `20260929220000_libelles_cours_numerotes` renommait **par valeur**
 *    (« 2nde partie » → « Cours n°2 ») juste après que `20260929210000_rangs_parties_contigus` ait
 *    **renuméroté les rangs**. Une séance qui n'avait que son ancien `MOITIE_2` ressortait donc avec
 *    `ordre = 0` et le libellé « Cours n°2 » : l'étiquette courte écrivait « 1ʳᵉ » juste à côté, et
 *    `prochainLibellePartie` proposait « Cours n°2 » une seconde fois.
 * 3. **Rejouer ces migrations n'écrit rien** : chaque `UPDATE` rejoué doit rendre zéro ligne
 *    touchée, et `updatedAt` ne bouge jamais — réparer un rang ou un libellé n'est pas une
 *    modification du programme par quelqu'un.
 * 4. **La colonne `description` naît vide partout** et **tous** les libellés passent à la forme
 *    calculée, sans exception : depuis que le nom d'une partie ne se saisit plus, il n'y a plus de
 *    libellé « du club » à ménager. C'est le renversement du point 2, et il se voit ici sur la séance
 *    `s-renomme`, dont les trois libellés écrits à la main **sont** réécrits.
 *
 * La liste des migrations rejouées est ouverte vers le haut : une migration future qui toucherait à
 * `SessionPartie` tombera sous les mêmes contrôles sans que personne n'ait à y penser.
 *
 * Pourquoi le client Prisma et pas `node:sqlite` : c'est **le même moteur SQLite que celui qui
 * appliquera ces fichiers en production** (`prisma migrate deploy`). Un test qui utiliserait un
 * autre moteur ne prouverait rien sur les fonctions de fenêtrage ni sur les tables temporaires.
 */

const RACINE = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(RACINE, "prisma/migrations");

/** La migration qui a fait passer les parties de « quatre codes figés » à des lignes ordonnées. */
const PREMIERE = "20260929200000_parties_libres_et_second_instructeur";

/** Le rattrapage des libellés du 29/09 : rejoué pour vérifier qu'un second passage n'écrit rien. */
const RATTRAPAGE = "20260929230000_libelles_par_rang_dans_la_nature";

/**
 * La migration du 30/09 : la colonne `description`, et les libellés passés à la forme calculée.
 * Rejouée elle aussi — mais **sans son `ALTER TABLE`**, qui ne peut pas s'appliquer deux fois (SQLite
 * refuse une colonne en double). Ce qu'on vérifie d'un second passage, ce sont les deux `UPDATE`.
 */
const CALCULES = "20260930120000_description_partie_et_libelles_calcules";

/** L'horodatage d'insertion des lignes fabriquées : aucune migration ne doit le déplacer. */
const POSE_LE = "2026-09-29T00:00:00Z";

/**
 * Le schéma tel que la migration précédente (`20260929172747_niveau_case_planning`) le laissait,
 * réduit à ce que la migration lit et aux tables que ses clés étrangères désignent. On ne rejoue pas
 * les trente-cinq migrations d'avant : elles ne touchent pas à ce qui est jugé ici, et ce qui compte
 * est bien la table de départ, recopiée telle quelle depuis leur SQL.
 */
const AVANT = [
  `CREATE TABLE "Session" ("id" TEXT NOT NULL PRIMARY KEY)`,
  `CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY)`,
  `CREATE TABLE "Atelier" ("id" TEXT NOT NULL PRIMARY KEY)`,
  `CREATE TABLE "SessionPartie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "partie" TEXT NOT NULL,
    "instructeurId" TEXT,
    "theme" TEXT NOT NULL DEFAULT '',
    "niveau" TEXT NOT NULL DEFAULT 'INDIFFERENT',
    "atelierId" TEXT,
    "modifieParId" TEXT,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE UNIQUE INDEX "SessionPartie_sessionId_partie_key" ON "SessionPartie"("sessionId", "partie")`,
];

const CODES = ["MOITIE_1", "MOITIE_2", "OPTION_1", "OPTION_2"] as const;

/**
 * Les libellés d'une séance que l'équipe avait **écrits elle-même** : l'ancienne colonne `partie`
 * acceptait n'importe quel texte pour qui écrivait en base, et la migration des parties libres le
 * reprend tel quel (`ELSE "partie"`).
 *
 * **Jusqu' inclus, aucune migration n'y touchait** — `libelle` était une donnée saisie, et les
 * trois formes ci-dessous disaient chacune un piège de reconnaissance (la première commence par
 * l'ancien libellé du modèle, la deuxième ne ressemble à rien, la troisième commence par un libellé
 * du modèle d'alors). **Le renverse la règle** : le nom d'une partie ne se saisit plus, il se
 * calcule depuis le rang, et le code le réécrit à chaque écriture. Ces trois-là sont donc réécrites
 * comme les autres — la migration du jour n'a plus de garde-fou de forme, et c'est voulu (« on s'en
 * fiche, rien n'a été publié »). Elles restent ici pour le prouver.
 */
const ECRITS_A_LA_MAIN = ["1ère partie — échauffement", "Sparring libre", "Cours n°2 bis"] as const;

/**
 * **Les 64 séances possibles d'avant la migration** : tout sous-ensemble non vide des quatre cases,
 * dans tout ordre de création. Les deux dimensions comptent — l'ancien code créait la ligne à la
 * demande et la supprimait quand on vidait la case, donc une séance pouvait n'avoir que sa « 2nde
 * partie », ou que ses deux options, et la « 2e option » pouvait être née avant la « 1ère ». C'est
 * exactement ce que les deux défauts de la nuit cassaient.
 *
 * L'ordre de création se lit dans l'identifiant : un `cuid` commence par l'horodatage, donc l'ordre
 * alphabétique des identifiants est l'ordre de naissance — c'est sur lui que la migration départage
 * les ex æquo.
 */
function arrangements(): (typeof CODES)[number][][] {
  const sorties: (typeof CODES)[number][][] = [];
  const permutations = (reste: (typeof CODES)[number][], debut: (typeof CODES)[number][]) => {
    if (debut.length > 0) sorties.push(debut);
    for (let i = 0; i < reste.length; i++) permutations([...reste.slice(0, i), ...reste.slice(i + 1)], [...debut, reste[i]]);
  };
  permutations([...CODES], []);
  return sorties;
}

/**
 * Un fichier de migration découpé en instructions exécutables : Prisma les jouera en bloc, mais le
 * client n'en accepte qu'une à la fois. Les commentaires partent d'abord — ils contiennent des
 * points-virgules (du français, pas du SQL), qui découperaient au mauvais endroit.
 */
function instructions(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

function fichier(nom: string): string {
  return fs.readFileSync(path.join(MIGRATIONS, nom, "migration.sql"), "utf8");
}

let db: PrismaClient;
let dossier: string;

/**
 * **Les migrations à rejouer : celle qui a introduit `ordre`, et toutes celles qui la suivent — pour
 * autant qu'elles parlent de `SessionPartie`.**
 *
 * Le second filtre n'est pas une commodité. Ce test ne monte pas le schéma entier : il fabrique à
 * la main les deux seules tables qui l'intéressent (`AVANT`), parce que tout l'enjeu est de rejouer
 * la chaîne des rangs sur des données d'**avant**. Une migration portant sur une autre table échoue
 * donc ici sur un « no such table » qui ne dit rien de la chaîne des rangs — c'est arrivé avec
 * `AuthSession.persistant`, et ça se reproduira à chaque migration future, puisque `>= PREMIERE`
 * embarque par construction tout ce qui vient après.
 *
 * On ne fige pas une liste de noms : elle serait à tenir à jour, et une chaîne des rangs incomplète est
 * exactement ce que ce fichier existe pour attraper. Le filtre se lit dans le SQL — une migration qui
 * touche `SessionPartie` est rejouée, les autres sont hors sujet.
 */
const aRejouer = fs
  .readdirSync(MIGRATIONS)
  .filter((d) => d >= PREMIERE && fs.existsSync(path.join(MIGRATIONS, d, "migration.sql")))
  .filter((d) => fichier(d).includes("SessionPartie"))
  .sort();

beforeAll(async () => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "hema-migration-"));
  // `connection_limit=1` : les migrations s'appliquent sur **une seule** connexion, et une table
  // temporaire n'existe que pour la sienne. Le test doit travailler dans les mêmes conditions.
  db = new PrismaClient({ datasources: { db: { url: `file:${path.join(dossier, "t.db")}?connection_limit=1` } } });

  for (const sql of AVANT) await db.$executeRawUnsafe(sql);

  // Une séance par arrangement, plus une séance sans aucune case (elle doit recevoir le modèle).
  const cas = arrangements();
  for (let s = 0; s < cas.length; s++) await db.$executeRawUnsafe(`INSERT INTO "Session" ("id") VALUES ('s${String(s).padStart(2, "0")}')`);
  await db.$executeRawUnsafe(`INSERT INTO "Session" ("id") VALUES ('s-vide')`);
  await db.$executeRawUnsafe(`INSERT INTO "Session" ("id") VALUES ('s-renomme')`);
  for (const [i, libelle] of ECRITS_A_LA_MAIN.entries()) {
    await db.$executeRawUnsafe(
      `INSERT INTO "SessionPartie" ("id", "sessionId", "partie", "updatedAt") VALUES (?, 's-renomme', ?, '${POSE_LE}')`,
      `s-renomme-c${i}`,
      libelle,
    );
  }
  for (let s = 0; s < cas.length; s++) {
    const sessionId = `s${String(s).padStart(2, "0")}`;
    for (let i = 0; i < cas[s].length; i++) {
      await db.$executeRawUnsafe(
        `INSERT INTO "SessionPartie" ("id", "sessionId", "partie", "updatedAt") VALUES (?, ?, ?, '${POSE_LE}')`,
        `${sessionId}-c${i}`,
        sessionId,
        cas[s][i],
      );
    }
  }

  for (const nom of aRejouer) {
    for (const sql of instructions(fichier(nom))) await db.$executeRawUnsafe(sql);
  }
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dossier) fs.rmSync(dossier, { recursive: true, force: true });
});

type Ligne = { id: string; sessionId: string; libelle: string; description: string; ordre: number; estOption: boolean; updatedAt: Date };

async function toutes(): Promise<Ligne[]> {
  const lignes = await db.$queryRawUnsafe<Ligne[]>(
    `SELECT "id", "sessionId", "libelle", "description", "ordre", "estOption", "updatedAt" FROM "SessionPartie" ORDER BY "sessionId", "ordre", "id"`,
  );
  return lignes.map((l) => ({ ...l, ordre: Number(l.ordre), estOption: Boolean(l.estOption) }));
}

async function rangs(): Promise<Map<string, number[]>> {
  const par = new Map<string, number[]>();
  for (const l of await toutes()) par.set(l.sessionId, [...(par.get(l.sessionId) ?? []), l.ordre]);
  return par;
}

describe("le SQL de migration des parties", () => {
  it("laisse **toutes** les séances avec des rangs contigus à partir de 0, sans doublon", async () => {
    const par = await rangs();
    expect(par.size).toBe(66); // 64 arrangements + la séance vide (qui reçoit le modèle) + celle aux libellés écrits à la main
    const fautives = [...par.entries()].filter(([, ordres]) => ordres.join() !== ordres.map((_, i) => i).join());
    expect(fautives).toEqual([]);
  });

  it("répare le cas de la revue : l'ancien « OPTION_2 » créé avant « OPTION_1 », sans cours principal", async () => {
    const lignes = (await toutes()).filter((l) => l.sessionId === sessionDe(["OPTION_2", "OPTION_1"]));
    // Avant le rattrapage des rangs, cette séance sortait de la migration avec deux rangs 1 et aucun rang 0.
    expect(lignes.map((l) => l.ordre)).toEqual([0, 1]);
    expect(lignes.map((l) => l.libelle)).toEqual(["Option 1", "Option 2"]);
  });

  it("donne ses quatre parties du modèle à une séance qui n'en avait aucune", async () => {
    const lignes = (await toutes()).filter((l) => l.sessionId === "s-vide");
    // Le modèle est posé par la migration, puis renommé par celle du vocabulaire : ce qu'on lit ici
    // est ce qu'une base existante montrera après mise à jour.
    expect(lignes.map((l) => l.libelle)).toEqual(["Cours 1", "Cours 2", "Option 1", "Option 2"]);
    expect(lignes.map((l) => l.ordre)).toEqual([0, 1, 2, 3]);
  });

  it("réécrit **aussi** les libellés qu'un club avait écrits lui-même — plus rien à ménager", async () => {
    const lignes = (await toutes()).filter((l) => l.sessionId === "s-renomme");
    /*
     * Renversement (« on s'en fiche, rien n'a été publié »). Les trois migrations d'avant
     * laissaient ces libellés intacts parce que `libelle` était une donnée saisie ; il se
     * **calcule** désormais depuis le rang, le champ texte a disparu de l'écran, et un libellé «
     * maison » deviendrait faux au premier ajout de partie. Les trois lignes sont des cours au rang
     * 0, 1 et 2 : elles s'appellent donc « Cours 1 », « Cours 2 », « Cours 3 ».
     */
    expect(lignes.map((l) => l.libelle)).toEqual(["Cours 1", "Cours 2", "Cours 3"]);
    for (const ancien of ECRITS_A_LA_MAIN) expect(lignes.map((l) => l.libelle), ancien).not.toContain(ancien);
  });

  it("donne à chaque partie une `description` **vide** : rien n'y est repêché", async () => {
    // La colonne naît vide partout, et c'est tout ce que la migration en fait. Un sauvetage de
    // l'ancien libellé vers la description aurait été du code mort qui protège un cas inexistant — et
    // il ferait croire au prochain lecteur qu'un libellé manuscrit peut encore arriver.
    const remplies = (await toutes()).filter((l) => l.description !== "");
    expect(remplies).toEqual([]);
  });

  it("garde une seule ligne par case d'origine : la migration ne perd ni ne double rien", async () => {
    const [{ n }] = await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM "SessionPartie"`);
    const attendu = arrangements().reduce((t, a) => t + a.length, 0) + 4 + ECRITS_A_LA_MAIN.length; // + le modèle de la séance vide, + les lignes écrites à la main
    expect(Number(n)).toBe(attendu);
  });
});

describe("le libellé du modèle et le rang de la partie", () => {
  it("répare le cas de la revue : une séance qui n'avait que sa « 2nde partie » est le **Cours 1**", async () => {
    const lignes = (await toutes()).filter((l) => l.sessionId === sessionDe(["MOITIE_2"]));
    // Le défaut livré cette nuit : `20260929210000` ramène cette ligne au rang 0, puis
    // `20260929220000` la renomme **par valeur** en « Cours n°2 ». Le libellé disait donc « n°2 »
    // à côté d'une étiquette courte « 1ʳᵉ », et `prochainLibellePartie` aurait proposé « Cours n°2 »
    // pour la partie suivante — le même nom deux fois dans la même séance.
    expect(lignes.map((l) => l.ordre)).toEqual([0]);
    expect(lignes.map((l) => l.libelle)).toEqual(["Cours 1"]);
    // Et le symptôme signalé disparaît avec : ajouter une partie propose « Cours 2 », pas un doublon.
    const suivant = prochainLibellePartie(lignes, false);
    expect(suivant).toBe("Cours 2");
    expect(lignes.map((l) => l.libelle)).not.toContain(suivant);
  });

  it("répare le même décalage côté options : l'ancien « OPTION_2 » seul devient **Option 1**", async () => {
    const lignes = (await toutes()).filter((l) => l.sessionId === sessionDe(["OPTION_2"]));
    // Hérité de `20260929200000` : l'ancien `OPTION_2` prenait le rang 3, ramené à 0, sans que son
    // libellé suive. Les options n'ont jamais été renommées par valeur, donc rien ne le rattrapait.
    expect(lignes.map((l) => l.ordre)).toEqual([0]);
    expect(lignes.map((l) => l.libelle)).toEqual(["Option 1"]);
  });

  it("fait dire à **chaque** libellé du modèle le rang qu'occupe sa partie dans sa nature", async () => {
    // La numérotation se fait par nature : le troisième cours s'appelle « Cours 3 » même s'il est la
    // cinquième ligne de la séance, et c'est `libellePartie` qui en décide — on la relit ici plutôt
    // que de recopier la règle, pour que le SQL et le code ne puissent pas diverger.
    //
    // **Aucune séance n'est exclue de la boucle** : `s-renomme` en faisait exception tant que
    // `libelle` était une donnée du club. Ce n'en est plus une.
    const rangs = new Map<string, number>();
    const fautifs: Array<{ sessionId: string; libelle: string; attendu: string }> = [];
    for (const l of await toutes()) {
      const cle = `${l.sessionId}|${l.estOption}`;
      const rang = (rangs.get(cle) ?? 0) + 1;
      rangs.set(cle, rang);
      const attendu = libellePartie(rang, l.estOption);
      if (l.libelle !== attendu) fautifs.push({ sessionId: l.sessionId, libelle: l.libelle, attendu });
    }
    expect(fautifs).toEqual([]);
    expect(rangs.size).toBeGreaterThan(64); // toutes les séances ont bien été parcourues
  });

  it("n'a déplacé **aucun** `updatedAt` : réparer un libellé n'est pas une modification du programme", async () => {
    // Les quatre parties du modèle posées sur la séance vide ont, elles, la date du backfill.
    const posees = (await toutes()).filter((l) => l.sessionId !== "s-vide");
    const deplacees = posees.filter((l) => new Date(l.updatedAt).toISOString() !== new Date(POSE_LE).toISOString());
    expect(deplacees).toEqual([]);
  });

  it("rejouées, les deux migrations de libellés n'écrivent **aucune** ligne", async () => {
    const avant = await toutes();
    for (const nom of [RATTRAPAGE, CALCULES]) {
      // `$executeRawUnsafe` rend le nombre de lignes touchées : c'est la preuve directe qu'un second
      // passage ne fait rien, et pas seulement qu'il retombe sur le même résultat.
      const ecritures: number[] = [];
      for (const sql of instructions(fichier(nom))) {
        // L'`ALTER TABLE` de la migration du 30/09 ne se rejoue pas (SQLite refuse une colonne en
        // double) : ce n'est pas lui qu'on juge, ce sont les deux `UPDATE`.
        if (/^ALTER TABLE/i.test(sql)) continue;
        const touchees = await db.$executeRawUnsafe(sql);
        if (/^UPDATE/i.test(sql)) ecritures.push(touchees);
      }
      expect(ecritures.length, nom).toBe(2); // un `UPDATE` par nature : les cours, les options
      expect(ecritures, nom).toEqual([0, 0]);
    }
    expect(await toutes()).toEqual(avant);
  });
});

/** L'identifiant de la séance fabriquée pour un arrangement donné. */
function sessionDe(arrangement: string[]): string {
  const i = arrangements().findIndex((a) => a.join() === arrangement.join());
  if (i < 0) throw new Error(`arrangement inconnu : ${arrangement.join()}`);
  return `s${String(i).padStart(2, "0")}`;
}
