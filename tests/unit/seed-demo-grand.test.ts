import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMPTES, demoLien } from "../../prisma/comptes";
import { MEMBRES_CLUB, SEANCES_CLUB } from "../../prisma/donnees-club";
import { baseDansLeDepot } from "../../prisma/garde-demonstration";
import {
  DOMAINE_GRAND,
  EFFECTIFS_PROFILS,
  estTailleGrand,
  fusionnerProgrammes,
  MEMBRES_GRAND,
  profilDe,
  PROGRAMME_GRAND,
  reponseGrand,
  seancesGrandClub,
  tailleDemandee,
  type ProgrammeSeance,
} from "../../prisma/donnees-club-grand";

/**
 * **Le jeu de démonstration « grand club » — et la promesse qu'il ne coûte rien au petit.**
 *
 * L'outil a été retaillé pour quatre-vingts personnes (listes repliées, recherche, tri, parties
 * libres) et rien de tout cela ne se voit à douze. Le grand jeu existe pour le montrer. Mais toute
 * la campagne e2e et toutes les captures reposent sur le jeu de douze : la règle qui compte ici est
 * qu'**il faut demander le grand jeu pour l'avoir**, et qu'il s'ajoute toujours *à la suite* des
 * douze, jamais devant — c'est ce qui garantit que les couleurs, les liens et les réponses du club
 * réel ne bougent pas d'un cran.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const fusion = fusionnerProgrammes;
const AUJOURDHUI = "2026-09-29";

describe("comment on demande la taille", () => {
  it("sans rien demander, c'est le jeu du club", () => {
    expect(tailleDemandee(undefined)).toBe("club");
    expect(tailleDemandee("")).toBe("club");
    expect(tailleDemandee("club")).toBe("club");
    expect(estTailleGrand(undefined)).toBe(false);
  });

  it("« grand » ouvre le grand jeu, quelle que soit la casse", () => {
    expect(estTailleGrand("grand")).toBe(true);
    expect(estTailleGrand("  GRAND ")).toBe(true);
  });

  /**
   * Une valeur inattendue **arrête** le seed au lieu de retomber en silence sur le petit jeu :
   * « SEED_DEMO_TAILLE=gros » qui produirait douze membres sans rien dire coûterait une heure à
   * comprendre, et la personne croirait avoir montré un gros club.
   */
  it("refuse une valeur inconnue au lieu de produire discrètement le petit jeu", () => {
    expect(() => tailleDemandee("gros")).toThrow(/SEED_DEMO_TAILLE/);
    expect(() => tailleDemandee("80")).toThrow(/gros|inattendue/i);
  });
});

describe("effectif et rôles", () => {
  const tous = [...MEMBRES_CLUB, ...MEMBRES_GRAND];
  const compte = (role: string) => tous.filter((m) => m.role === role).length;
  /**
   * **Le bureau se compte à part** : ce n'est plus un rôle mais un supplément (`estAdmin`), et les
   * personnes qui le portent ont par ailleurs un rôle de base — *membre* dans ce jeu d'essai, qui
   * ne prétend pas savoir qui enseigne. Compté sur `role === "ADMIN"`, ce test tombait à zéro sans
   * rien dire de faux : il ne vérifiait plus rien.
   */
  const duBureau = () => tous.filter((m) => m.estAdmin === true).length;

  it("environ quatre-vingts personnes, les douze du club en tête", () => {
    expect(MEMBRES_GRAND).toHaveLength(68);
    expect(tous).toHaveLength(80);
    expect(tous.slice(0, MEMBRES_CLUB.length)).toEqual(MEMBRES_CLUB);
  });

  it("un encadrement crédible : 3-4 au bureau, 6-8 instructeurs, le reste membres", () => {
    expect(duBureau()).toBeGreaterThanOrEqual(3);
    expect(duBureau()).toBeLessThanOrEqual(4);
    expect(compte("INSTRUCTEUR")).toBeGreaterThanOrEqual(6);
    expect(compte("INSTRUCTEUR")).toBeLessThanOrEqual(8);
    // Les deux rôles de base se partagent les quatre-vingts personnes, bureau compris : « ADMIN »
    // n'est plus une valeur de `role`, et aucune ligne du jeu d'essai ne doit la rapporter.
    expect(compte("MEMBRE")).toBe(80 - compte("INSTRUCTEUR"));
    expect(compte("ADMIN")).toBe(0);
  });

  it("des anciennetés variées, dont des arrivées de la rentrée en cours", () => {
    const anciennetes = new Set(MEMBRES_GRAND.map((m) => m.auClubMois));
    expect(anciennetes.size).toBeGreaterThanOrEqual(5);
    expect(anciennetes.has(0)).toBe(true);
    // Le club compte en saisons pleines : tout le monde prend une année à la rentrée.
    expect(MEMBRES_GRAND.every((m) => m.auClubMois % 12 === 0)).toBe(true);
  });
});

describe("des gens et des adresses inventés", () => {
  /**
   * `donnees-club.ts` déduit les adresses des noms **sur le domaine du club lui-même**. Ici c'est
   * l'inverse qu'il faut — un nom inventé posé sur un domaine qui existe ferait une adresse
   * plausible, donc une adresse qui peut tomber chez quelqu'un.
   * `.test` est réservé aux essais (RFC 2606) : il n'appartient à personne et rien n'y arrive.
   */
  it("toutes les adresses sont sur un domaine réservé aux essais", () => {
    expect(DOMAINE_GRAND.endsWith(".test")).toBe(true);
    expect(MEMBRES_GRAND.every((m) => m.email.endsWith(`@${DOMAINE_GRAND}`))).toBe(true);
  });

  it("aucune adresse ni aucun nom du jeu du club n'est repris", () => {
    const duClub = new Set(MEMBRES_CLUB.map((m) => m.email.toLowerCase()));
    expect(MEMBRES_GRAND.filter((m) => duClub.has(m.email.toLowerCase()))).toEqual([]);
    const nomsClub = new Set(MEMBRES_CLUB.map((m) => m.nom.toLowerCase()));
    expect(MEMBRES_GRAND.filter((m) => nomsClub.has(m.nom.toLowerCase()))).toEqual([]);
  });

  it("aucun doublon d'adresse, et un lien personnel distinct pour chacun", () => {
    const emails = [...MEMBRES_CLUB, ...MEMBRES_GRAND].map((m) => m.email.toLowerCase());
    expect(new Set(emails).size).toBe(emails.length);
    // Le jeton se construit à partir de l'adresse et se coupe à 48 caractères : deux adresses
    // proches donneraient deux comptes qui se connectent l'un chez l'autre.
    const jetons = emails.map(demoLien);
    expect(new Set(jetons).size).toBe(jetons.length);
  });
});

describe("les comptes d'essai sont les mêmes dans les deux tailles", () => {
  /**
   * Ce sont eux que les tests de bout en bout et les captures utilisent, par leur adresse et par
   * leur lien fixe. S'ils changeaient de place, de rôle ou de lien selon la taille demandée, le
   * grand jeu ne serait pas une option mais un autre produit.
   */
  it("chaque compte repère existe, au même rôle, dans le jeu du club comme dans le grand", () => {
    const petit = new Map(MEMBRES_CLUB.map((m) => [m.email, m]));
    const grand = new Map([...MEMBRES_CLUB, ...MEMBRES_GRAND].map((m) => [m.email, m]));
    for (const email of Object.values(COMPTES)) {
      if (email === COMPTES.admin) continue; // compte de service, hors liste des pratiquants
      expect(petit.get(email)).toBeDefined();
      expect(grand.get(email)).toEqual(petit.get(email));
      expect(demoLien(email)).toBe(demoLien(email));
    }
  });
});

describe("les réponses ajoutées ne touchent pas à celles du club", () => {
  const seances = seancesGrandClub(SEANCES_CLUB, AUJOURDHUI);

  it("les séances, leurs dates et leurs horaires sont ceux du club", () => {
    expect(seances.map((s) => [s.date, s.heureDebut])).toEqual(SEANCES_CLUB.map((s) => [s.date, s.heureDebut]));
  });

  it("les réponses du club restent en tête, dans le même ordre", () => {
    for (const [i, s] of seances.entries()) {
      expect(s.reponses.slice(0, SEANCES_CLUB[i].reponses.length)).toEqual(SEANCES_CLUB[i].reponses);
    }
  });

  it("le jeu d'origine n'est pas modifié au passage", () => {
    const empreinte = JSON.stringify(SEANCES_CLUB);
    seancesGrandClub(SEANCES_CLUB, AUJOURDHUI);
    expect(JSON.stringify(SEANCES_CLUB)).toBe(empreinte);
  });

  it("deux exécutions donnent exactement les mêmes réponses", () => {
    expect(JSON.stringify(seancesGrandClub(SEANCES_CLUB, AUJOURDHUI))).toBe(JSON.stringify(seances));
    expect(reponseGrand(MEMBRES_GRAND[7].email, "2026-09-15", AUJOURDHUI)).toBe(reponseGrand(MEMBRES_GRAND[7].email, "2026-09-15", AUJOURDHUI));
  });
});

describe("une répartition des présences réaliste", () => {
  const seances = seancesGrandClub(SEANCES_CLUB, AUJOURDHUI);
  const effectif = MEMBRES_CLUB.length + MEMBRES_GRAND.length;
  const passees = seances.filter((s) => s.date < AUJOURDHUI);
  const aVenir = seances.filter((s) => s.date >= AUJOURDHUI);
  const sansReponse = (s: (typeof seances)[number]) => effectif - s.reponses.length;

  /**
   * **C'est le cas qui rend les écrans illisibles, donc celui qu'il faut pouvoir montrer** :
   * soixante lignes « sans réponse » à faire tenir sous un bouton. Un jeu où tout le monde aurait
   * répondu ne prouverait rien du repli ni de la recherche.
   */
  it("sur les séances à venir, plus de la moitié du club n'a pas répondu", () => {
    expect(aVenir.length).toBeGreaterThan(0);
    for (const s of aVenir) expect(sansReponse(s)).toBeGreaterThan(effectif / 2);
  });

  it("sur les séances passées, au contraire, l'essentiel du club a répondu", () => {
    for (const s of passees) expect(sansReponse(s)).toBeLessThan(effectif / 3);
  });

  it("quatre profils : un noyau assidu, une moitié d'irréguliers, des discrets, des jamais venus", () => {
    expect(EFFECTIFS_PROFILS.irregulier).toBeGreaterThanOrEqual(MEMBRES_GRAND.length / 2);
    const compte = (p: string) => MEMBRES_GRAND.filter((m) => profilDe(m.email) === p).length;
    expect(compte("noyau") + compte("irregulier") + compte("discret") + compte("jamais")).toBe(MEMBRES_GRAND.length);
    expect(compte("jamais")).toBeGreaterThan(0);
    // Les douze du jeu du club ne relèvent d'aucun profil : leurs réponses sont des données, pas un tirage.
    expect(profilDe(COMPTES.membre)).toBeNull();
  });

  it("les « jamais venus » ne sont présents nulle part, le noyau l'est presque partout", () => {
    const presences = (email: string) => seances.filter((s) => s.reponses.some(([e, st]) => e === email && st === "PRESENT")).length;
    for (const m of MEMBRES_GRAND.filter((m) => profilDe(m.email) === "jamais")) expect(presences(m.email)).toBe(0);
    const noyau = MEMBRES_GRAND.filter((m) => profilDe(m.email) === "noyau");
    const moyenne = noyau.reduce((n, m) => n + presences(m.email), 0) / noyau.length;
    expect(moyenne).toBeGreaterThan(seances.length * 0.6);
  });

  it("les trois statuts sont représentés (il faut voir le « peut-être » aussi)", () => {
    const statuts = new Set(seances.flatMap((s) => s.reponses.map(([, st]) => st)));
    expect([...statuts].sort()).toEqual(["ABSENT", "PEUT_ETRE", "PRESENT"]);
  });
});

/**
 * Le programme du club vit dans `seed-demo.ts`, qui ouvre une connexion Prisma dès son import : on
 * le **lit** plutôt que de l'importer. C'est la seule façon de vérifier ici la règle qui compte —
 * les cases du grand jeu s'ajoutent à celles du club, elles ne leur prennent pas leur place.
 */
function programmeDuClub(): Array<{ date: string; rangs: number[] }> {
  const seed = source("prisma/seed-demo.ts");
  const bloc = seed.slice(seed.indexOf("const PROGRAMME:"), seed.indexOf("/** Ateliers"));
  /*
   * **On découpe aux dates, sans supposer qu'une séance tient sur une ligne.** L'expression d'avant
   * exigeait `{ date: "…", parties: [ … ] },` d'un seul tenant : deux séances passées sur plusieurs
   * lignes sont sorties du compte en silence, et ce contrôle ne vérifiait plus que huit dates sur
   * dix. Le plancher juste en dessous est là pour ça — il a fait son travail, et le lecteur ne doit
   * pas avoir à reformater le seed pour être compris.
   */
  const morceaux = bloc.split(/date: "/).slice(1);
  return morceaux.map((m) => ({
    date: m.slice(0, 10),
    rangs: [...m.matchAll(/rang: (\d+)/g)].map((x) => Number(x[1])),
  }));
}

describe("le planning à son point de rupture", () => {
  const base = programmeDuClub();

  it("au moins trois séances portent plus de quatre parties", () => {
    const grosses = PROGRAMME_GRAND.filter((p) => Math.max(...p.parties.map((x) => x.rang)) + 1 > 4);
    expect(grosses.length).toBeGreaterThanOrEqual(3);
  });

  it("des niveaux variés, pas seulement « indifférent »", () => {
    const niveaux = new Set(PROGRAMME_GRAND.flatMap((p) => p.parties.map((x) => x.niveau ?? "INDIFFERENT")));
    expect(niveaux.has("DEBUTANT")).toBe(true);
    expect(niveaux.has("INTERMEDIAIRE")).toBe(true);
    expect(niveaux.has("AVANCE")).toBe(true);
  });

  it("chaque case est animée par quelqu'un du jeu de démonstration", () => {
    const connus = new Set([...MEMBRES_CLUB, ...MEMBRES_GRAND].map((m) => m.email));
    for (const p of PROGRAMME_GRAND) for (const c of p.parties) expect(connus.has(c.email)).toBe(true);
  });

  it("deux cases ne se disputent jamais la même place une fois les programmes fusionnés", () => {
    // Si la lecture du programme du club échouait, ce contrôle ne vérifierait plus rien.
    expect(base.length).toBeGreaterThanOrEqual(10);
    for (const p of PROGRAMME_GRAND) {
      const rangs = [...(base.find((x) => x.date === p.date)?.rangs ?? []), ...p.parties.map((x) => x.rang)];
      expect(new Set(rangs).size).toBe(rangs.length);
    }
  });

  it("la fusion ajoute, elle ne remplace pas", () => {
    const club: ProgrammeSeance[] = base.map((p) => ({ date: p.date, parties: p.rangs.map((rang) => ({ rang, email: COMPTES.instructeur, theme: "Cours du club" })) }));
    const fusionne = fusion(club, PROGRAMME_GRAND);
    for (const p of club) {
      const apres = fusionne.find((x) => x.date === p.date)!;
      expect(apres.parties.slice(0, p.parties.length)).toEqual(p.parties);
    }
    // Une date que seul l'un des deux connaît reste présente.
    expect(fusion([{ date: "2026-12-01", parties: [] }], PROGRAMME_GRAND).map((p) => p.date)).toContain("2026-12-01");
    expect(fusionne.map((p) => p.date)).toEqual(expect.arrayContaining(PROGRAMME_GRAND.map((p) => p.date)));
  });
});

describe("le garde-fou et le script npm", () => {
  /**
   * **Le garde-fou ne reconnaît plus une base de démonstration à ses comptes**. Ce test exigeait
   * l'inverse : que les quatre-vingts comptes du grand jeu figurent parmi les « comptes connus »,
   * faute de quoi le reseed se refusait et la suite e2e s'arrêtait. Le contrôle lui-même était la
   * faute, et il ne pouvait pas marcher : **le jeu de démonstration est tiré du vrai annuaire du
   * club**, donc sur la base du club aucun compte n'est « inconnu », la liste d'étrangers est vide,
   * et le garde-fou laissait passer un `db.period.deleteMany({})`. Un indice qui se trompe dans les
   * deux sens ne protège rien : il a été retiré, et la preuve est désormais le chemin du fichier de
   * base.
   */
  it("le garde-fou ne décide plus d'après la liste des comptes", () => {
    const garde = source("prisma/garde-demonstration.ts");
    expect(garde).not.toMatch(/MEMBRES_GRAND|MEMBRES_CLUB|etrangers/);
    expect(garde).toMatch(/baseDansLeDepot/);
  });

  /** La preuve sur laquelle il repose, éprouvée sur de vraies valeurs. */
  it("ne reconnaît que le fichier de base du dépôt", () => {
    const racine = "/home/essai/depot";
    // Ce que porte le `.env` de développement : relatif au dossier `prisma/`, donc dans le dépôt.
    expect(baseDansLeDepot("file:../data/hema.db", racine)).toBe(true);
    expect(baseDansLeDepot("file:../data/hema.db?connection_limit=1", racine)).toBe(true);
    // Ce que porte la stack du club : le volume du conteneur.
    expect(baseDansLeDepot("file:/data/hema.db", racine)).toBe(false);
    // Et tout le reste : remontée hors du dépôt, autre protocole, rien du tout.
    for (const url of ["file:../../ailleurs/hema.db", "postgresql://hote/base", "", "file:", "/data/hema.db"]) {
      expect(baseDansLeDepot(url, racine), url).toBe(false);
    }
  });

  it("le script par défaut ne demande aucune taille, le script dédié demande « grand »", () => {
    const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:seed:demo"]).not.toMatch(/SEED_DEMO_TAILLE/);
    expect(pkg.scripts["db:seed:demo:grand"]).toMatch(/SEED_DEMO_TAILLE=grand/);
    expect(pkg.scripts["db:seed:demo:grand"]).toMatch(/prisma\/seed-demo\.ts/);
  });

  /**
   * Le seed ne travaille que sur `MEMBRES`, `SEANCES` et `PROGRAMME_COMPLET`, qui **sont** les
   * constantes d'origine en taille « club » : c'est ce qui rend le jeu par défaut inchangé par
   * construction plutôt que par vérification. Un `MEMBRES_GRAND` qui reviendrait ailleurs dans le
   * fichier serait un second chemin, invisible à la relecture.
   */
  it("le seed n'emploie le grand jeu que derrière la bascule de taille", () => {
    const seed = source("prisma/seed-demo.ts");
    const corps = seed.slice(seed.indexOf("async function main"));
    const lignes = corps.split("\n").filter((l) => /MEMBRES_GRAND|PROGRAMME_GRAND|seancesGrandClub/.test(l) && !/^\s*[/*]/.test(l));
    expect(lignes.length).toBeGreaterThanOrEqual(3);
    // `grand` en minuscules : la bascule de taille, et rien d'autre.
    for (const l of lignes) expect(l).toMatch(/\bgrand\b/);
  });
});
