import { describe, expect, it } from "vitest";
import {
  blasons,
  joursDeCoursDuClub,
  JOURS_DE_COURS_MAX,
  dateDAdhesion,
  debutDeSaison,
  dateDepuisDuree,
  dureeDepuisDate,
  formatDuree,
  moisDepuis,
  presencesDuMeilleurMois,
  prochainRang,
  rangs,
  HORIZONS,
  type Blason,
  type SituationBlasons,
} from "@/lib/blasons";

/** Les jours de la semaine au sens de `getUTCDay`, nommés une fois pour tout le fichier. */
const LUNDI = 1;
const MARDI = 2;
const JEUDI = 4;
const VENDREDI = 5;

/**
 * Les deux soirs de cours du club de référence : mardi et vendredi. C'est ce que rendrait
 * `joursDeCoursDuClub` pour le club qui s'entraîne ces deux soirs-là — les blasons de créneau ne sont
 * plus codés en dur, ils suivent cette liste.
 */
const deuxSoirs = (mardis = 0, vendredis = 0) => [
  { jour: MARDI, presences: mardis },
  { jour: VENDREDI, presences: vendredis },
];

/** Situation de quelqu'un dont on ne précise que ce qui compte pour le cas testé. */
function situation(partiel: Partial<SituationBlasons> = {}): SituationBlasons {
  return {
    presences: 0,
    seancesPassees: 0,
    reponses: 0,
    serie: 0,
    ateliersProposes: 0,
    presencesTotales: 0,
    ancienneteMois: 0,
    joursDeCours: deuxSoirs(),
    ...partiel,
  };
}

/** Le blason d'une clé donnée, la collection étant toujours complète. */
function blason(cle: string, partiel: Partial<SituationBlasons> = {}): Blason {
  const trouve = blasons(situation(partiel)).find((b) => b.cle === cle);
  if (!trouve) throw new Error(`blason inconnu : ${cle}`);
  return trouve;
}

/** Tout ce qui se gagne, gagné : la situation qui doit remplir la vitrine entière. */
const TOUT = situation({
  presences: 12,
  seancesPassees: 12,
  reponses: 12,
  serie: 12,
  ateliersProposes: 3,
  presencesTotales: 50,
  ancienneteMois: 12,
  joursDeCours: deuxSoirs(4, 4),
});

const COLLECTION = [
  "cinq-cours",
  "dix-cours",
  "jamais-muet",
  "sans-faute",
  "fidele",
  "cinq-daffilee",
  // Les blasons de créneau portent le **numéro** du jour : la clé ne dépend ni de l'orthographe ni des
  // soirs de cours du club pour lequel l'outil a été écrit.
  `jour-${MARDI}-du-mois`,
  `jour-${VENDREDI}-du-mois`,
  "cinquante-cours",
  "une-saison",
  "force-de-proposition",
  "maitre-de-traite",
];

/* Les trois blasons retirés : trop faciles, ils ne récompensaient plus personne. */
const RETIRES = ["premiere-sortie", "deux-daffilee", "trois-daffilee"];

describe("la collection de blasons", () => {
  it("rend toujours les douze blasons, dans le même ordre, quelle que soit l'entrée", () => {
    const entrees: SituationBlasons[] = [
      situation(),
      TOUT,
      situation({ presences: 1, seancesPassees: 12, reponses: 4, serie: 1 }),
    ];
    for (const entree of entrees) {
      expect(blasons(entree).map((b) => b.cle)).toEqual(COLLECTION);
    }
  });

  it("n'a aucune clé en double", () => {
    const cles = blasons(situation()).map((b) => b.cle);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it("ne rend plus les trois blasons retirés", () => {
    const cles = blasons(TOUT).map((b) => b.cle);
    for (const cle of RETIRES) expect(cles).not.toContain(cle);
  });

  it("range exactement quatre blasons dans chacun des trois horizons", () => {
    const collection = blasons(situation());
    expect(HORIZONS.map((h) => h.cle)).toEqual(["trimestre", "assiduite", "saison"]);
    for (const horizon of HORIZONS) {
      expect(collection.filter((b) => b.horizon === horizon.cle)).toHaveLength(4);
    }
  });

  it("suit l'ordre des horizons : le trimestre, puis l'assiduité, puis la saison", () => {
    // Les blasons ne sont pas seulement quatre par groupe : ils arrivent groupés, dans l'ordre de
    // HORIZONS. C'est ce qui permet à la vitrine de les découper sans jamais les retrier.
    const attendu = HORIZONS.flatMap((h) => Array<string>(4).fill(h.cle));
    expect(blasons(TOUT).map((b) => b.horizon)).toEqual(attendu);
  });

  it("donne un titre et une phrase à chacun des trois horizons", () => {
    for (const horizon of HORIZONS) {
      expect(horizon.titre.trim().length).toBeGreaterThan(0);
      expect(horizon.quoi.trim().length).toBeGreaterThan(0);
    }
  });

  it("donne à chaque blason un nom et une description qui se suffit à elle-même", () => {
    // La description est le texte de la bulle au survol : c'est souvent la seule explication d'un
    // nom emprunté à l'escrime (« La quinte », « Le héraut »), elle ne peut donc pas être vide.
    for (const b of blasons(situation({ presences: 4, seancesPassees: 6, reponses: 6, serie: 2 }))) {
      expect(b.nom.trim().length).toBeGreaterThan(0);
      expect(b.quoi.trim().length).toBeGreaterThan(0);
      // Une phrase, pas deux mots repris du nom.
      expect(b.quoi.trim().length).toBeGreaterThan(15);
    }
  });

  it("n'emploie aucun vocabulaire de manque, ni dans les noms ni dans les descriptions", () => {
    const interdits = [
      "il te manque",
      "manque",
      "raté",
      "rate",
      "seulement",
      "plus que",
      "échec",
      "echec",
      "perdu",
    ];
    // Le trimestre vide est le cas le plus exposé (aucun blason gagné), mais la collection est de
    // taille fixe : les mêmes textes sont rendus quelle que soit la situation, on les balaie toutes.
    const entrees = [
      situation(),
      situation({ presences: 3, seancesPassees: 9, reponses: 5, serie: 2 }),
      TOUT,
    ];
    for (const entree of entrees) {
      for (const b of blasons(entree)) {
        const texte = `${b.nom} ${b.quoi}`.toLowerCase();
        for (const mot of interdits) expect(texte).not.toContain(mot);
      }
      // Les titres des horizons s'affichent au même endroit : même règle d'écriture.
      for (const h of HORIZONS) {
        const texte = `${h.titre} ${h.quoi}`.toLowerCase();
        for (const mot of interdits) expect(texte).not.toContain(mot);
      }
    }
  });

  it("nomme les douze blasons dans le vocabulaire de la salle d'armes", () => {
    expect(blasons(situation()).map((b) => b.nom)).toEqual([
      "La quinte",
      "Le tapis usé",
      "Le héraut",
      "La garde de fer",
      "Le pilier de salle",
      "L'enchaînement",
      "Le fer du mardi",
      "Le fer du vendredi",
      "Le plancher poli",
      "La saison entière",
      "Le porteur de traité",
      "Le maître d'armes de papier",
    ]);
  });
});

describe("l'unité de la progression", () => {
  it("n'est donnée que là où ce ne sont pas des cours", () => {
    // Sans elle, « 6 sur 12 » d'un blason d'ancienneté se lirait comme six cours.
    expect(blason("une-saison").unite).toBe("mois");
    expect(blason(`jour-${MARDI}-du-mois`).unite).toBe("mardis");
    expect(blason(`jour-${VENDREDI}-du-mois`).unite).toBe("vendredis");
  });

  it("est absente partout ailleurs : la vitrine écrit alors « 3 sur 5 » tout court", () => {
    const avecUnite = ["une-saison", `jour-${MARDI}-du-mois`, `jour-${VENDREDI}-du-mois`];
    for (const b of blasons(TOUT)) {
      if (avecUnite.includes(b.cle)) continue;
      expect(b.unite).toBeUndefined();
    }
  });
});

describe("chaque blason à son seuil exact", () => {
  it("« La quinte » et « Le tapis usé » se gagnent pile au but", () => {
    expect(blason("cinq-cours", { presences: 4 }).gagne).toBe(false);
    expect(blason("cinq-cours", { presences: 5 }).gagne).toBe(true);
    expect(blason("dix-cours", { presences: 9 }).gagne).toBe(false);
    expect(blason("dix-cours", { presences: 10 }).gagne).toBe(true);
  });

  it("« L'enchaînement » se gagne à la cinquième présence consécutive", () => {
    // 9 présences mais jamais plus de 4 de suite : c'est la série qui compte, pas le total.
    expect(blason("cinq-daffilee", { presences: 9, serie: 4 }).gagne).toBe(false);
    expect(blason("cinq-daffilee", { presences: 5, serie: 5 }).gagne).toBe(true);
  });

  it("les blasons de créneau demandent quatre cours du même jour", () => {
    expect(blason(`jour-${MARDI}-du-mois`, { joursDeCours: deuxSoirs(3, 0) }).gagne).toBe(false);
    expect(blason(`jour-${MARDI}-du-mois`, { joursDeCours: deuxSoirs(4, 0) }).gagne).toBe(true);
    expect(blason(`jour-${VENDREDI}-du-mois`, { joursDeCours: deuxSoirs(0, 3) }).gagne).toBe(false);
    expect(blason(`jour-${VENDREDI}-du-mois`, { joursDeCours: deuxSoirs(0, 4) }).gagne).toBe(true);
  });

  it("ne confond pas les deux soirs de cours", () => {
    const mardisSeuls = situation({ joursDeCours: deuxSoirs(5, 0) });
    expect(blason(`jour-${MARDI}-du-mois`, mardisSeuls).gagne).toBe(true);
    expect(blason(`jour-${VENDREDI}-du-mois`, mardisSeuls).gagne).toBe(false);
  });

  it("« Le plancher poli » se gagne au cinquantième cours depuis l'arrivée", () => {
    expect(blason("cinquante-cours", { presencesTotales: 49 }).gagne).toBe(false);
    expect(blason("cinquante-cours", { presencesTotales: 50 }).gagne).toBe(true);
    // Il ne se lit pas sur le trimestre : douze présences ce trimestre ne le décernent pas.
    expect(blason("cinquante-cours", { presences: 12, seancesPassees: 12 }).gagne).toBe(false);
  });

  it("« La saison entière » se gagne au douzième mois d'ancienneté", () => {
    expect(blason("une-saison", { ancienneteMois: 11 }).gagne).toBe(false);
    expect(blason("une-saison", { ancienneteMois: 12 }).gagne).toBe(true);
  });

  it("« Le porteur de traité » se gagne au premier atelier proposé, « Le maître d'armes de papier » au troisième", () => {
    expect(blason("force-de-proposition").gagne).toBe(false);
    expect(blason("force-de-proposition", { ateliersProposes: 1 }).gagne).toBe(true);
    expect(blason("maitre-de-traite", { ateliersProposes: 2 }).gagne).toBe(false);
    expect(blason("maitre-de-traite", { ateliersProposes: 3 }).gagne).toBe(true);
  });
});

describe("« Le héraut » — le blason du geste qui ne dépend que de soi", () => {
  it("n'est pas en jeu avant 3 cours passés, même avec 100 % de réponses", () => {
    expect(blason("jamais-muet", { seancesPassees: 1, reponses: 1 }).gagne).toBe(false);
    expect(blason("jamais-muet", { seancesPassees: 2, reponses: 2 }).gagne).toBe(false);
  });

  it("se gagne dès le troisième cours quand on s'est prononcé sur tous", () => {
    const b = blason("jamais-muet", { seancesPassees: 3, reponses: 3 });
    expect(b.gagne).toBe(true);
    expect(b.progres).toEqual({ fait: 3, but: 3 });
  });

  it("compte toutes les réponses, Absent et Peut-être compris : on récompense le geste, pas la présence", () => {
    // Présent à aucun cours, mais a répondu aux six : le blason est gagné.
    const b = blason("jamais-muet", { seancesPassees: 6, reponses: 6, presences: 0 });
    expect(b.gagne).toBe(true);
  });

  it("n'est pas gagné tant qu'il reste un cours sans réponse", () => {
    const b = blason("jamais-muet", { seancesPassees: 6, reponses: 5 });
    expect(b.gagne).toBe(false);
    expect(b.progres).toEqual({ fait: 5, but: 6 });
  });
});

describe("« Le pilier de salle » — deux cours sur trois", () => {
  it("se gagne à deux tiers pile", () => {
    expect(blason("fidele", { seancesPassees: 3, presences: 2 }).progres).toEqual({ fait: 2, but: 2 });
    expect(blason("fidele", { seancesPassees: 3, presences: 2 }).gagne).toBe(true);
    expect(blason("fidele", { seancesPassees: 6, presences: 4 }).gagne).toBe(true);
  });

  it("arrondit le but vers l'exigeant plutôt que vers le cadeau", () => {
    // 5 cours passés : deux tiers font 3,33 → 4.
    expect(blason("fidele", { seancesPassees: 5, presences: 3 }).progres.but).toBe(4);
    expect(blason("fidele", { seancesPassees: 5, presences: 3 }).gagne).toBe(false);
    expect(blason("fidele", { seancesPassees: 5, presences: 4 }).gagne).toBe(true);
  });

  it("n'est pas en jeu avant 3 cours passés", () => {
    expect(blason("fidele", { seancesPassees: 2, presences: 2 }).gagne).toBe(false);
  });
});

describe("« La garde de fer » — tous les cours du trimestre", () => {
  it("exige 4 cours passés : un sans-faute sur trois cours n'en est pas encore un", () => {
    expect(blason("sans-faute", { seancesPassees: 3, presences: 3 }).gagne).toBe(false);
    expect(blason("sans-faute", { seancesPassees: 4, presences: 4 }).gagne).toBe(true);
  });

  it("n'est pas gagné dès qu'un cours manque à l'appel", () => {
    const b = blason("sans-faute", { seancesPassees: 8, presences: 7 });
    expect(b.gagne).toBe(false);
    expect(b.progres).toEqual({ fait: 7, but: 8 });
  });
});

describe("la progression affichée", () => {
  it("plafonne « fait » au but : jamais « 7 sur 5 »", () => {
    expect(blason("cinq-cours", { presences: 7 }).progres).toEqual({ fait: 5, but: 5 });
    expect(blason("cinq-daffilee", { serie: 9 }).progres).toEqual({ fait: 5, but: 5 });
    expect(blason("force-de-proposition", { ateliersProposes: 4 }).progres).toEqual({ fait: 1, but: 1 });
    expect(blason("maitre-de-traite", { ateliersProposes: 9 }).progres).toEqual({ fait: 3, but: 3 });
    expect(blason(`jour-${MARDI}-du-mois`, { joursDeCours: deuxSoirs(5, 0) }).progres).toEqual({ fait: 4, but: 4 });
    expect(blason("une-saison", { ancienneteMois: 96 }).progres).toEqual({ fait: 12, but: 12 });
    expect(blason("cinquante-cours", { presencesTotales: 300 }).progres).toEqual({ fait: 50, but: 50 });
  });

  it("ne descend jamais un but à zéro, même sur un trimestre sans cours passé", () => {
    for (const b of blasons(situation())) {
      expect(b.progres.but).toBeGreaterThanOrEqual(1);
    }
  });

  it("reste honnête pour un blason pas encore en jeu : la progression est comptée quand même", () => {
    const b = blason("jamais-muet", { seancesPassees: 2, reponses: 2 });
    expect(b.gagne).toBe(false);
    expect(b.progres).toEqual({ fait: 2, but: 2 });
  });
});

describe("le trimestre vide et les entrées aberrantes", () => {
  it("ne gagne aucun blason et n'écrit aucun NaN quand rien n'a encore eu lieu", () => {
    for (const b of blasons(situation())) {
      expect(b.gagne).toBe(false);
      expect(Number.isInteger(b.progres.fait)).toBe(true);
      expect(Number.isInteger(b.progres.but)).toBe(true);
      expect(b.progres.fait).toBeGreaterThanOrEqual(0);
    }
  });

  it("ramène les valeurs négatives ou non numériques à zéro plutôt que de les propager", () => {
    const absurde = blasons({
      presences: -5,
      seancesPassees: Number.NaN,
      reponses: -1,
      serie: -3,
      ateliersProposes: Number.NaN,
      presencesTotales: -50,
      ancienneteMois: Number.NaN,
      joursDeCours: [
        { jour: MARDI, presences: -4 },
        { jour: VENDREDI, presences: Number.NaN },
      ],
    });
    expect(absurde.map((b) => b.cle)).toEqual(COLLECTION);
    for (const b of absurde) {
      expect(b.gagne).toBe(false);
      expect(b.progres.fait).toBe(0);
      expect(b.progres.but).toBeGreaterThanOrEqual(1);
    }
  });

  it("traite un compteur absent comme un zéro : une colonne vide ne casse pas la vitrine", () => {
    // Les compteurs arrivent d'agrégats SQL ; un champ resté `undefined` ne doit écrire ni « NaN
    // sur 4 » ni décerner quoi que ce soit. Le cast dit ce que le type interdit mais que la base
    // peut servir.
    const trous = blasons({
      presences: undefined,
      seancesPassees: undefined,
      reponses: undefined,
      serie: undefined,
      ateliersProposes: undefined,
      presencesTotales: undefined,
      ancienneteMois: undefined,
      joursDeCours: undefined,
    } as unknown as SituationBlasons);
    // Sans jours de cours, les deux blasons de créneau n'existent pas : le reste de la vitrine tient.
    expect(trous.map((b) => b.cle)).toEqual(COLLECTION.filter((cle) => !cle.startsWith("jour-")));
    for (const b of trous) {
      expect(b.gagne).toBe(false);
      expect(b.progres.fait).toBe(0);
      expect(b.progres.but).toBeGreaterThanOrEqual(1);
    }
  });

  it("gagne tout ce qui est réellement atteint sur un trimestre complet", () => {
    expect(blasons(TOUT).filter((b) => !b.gagne)).toEqual([]);
  });
});

describe("un blason gagné ne se reprend jamais", () => {
  it("reste gagné quand les compteurs continuent de monter", () => {
    const gagnesA = (n: number) =>
      blasons(
        situation({
          presences: n,
          seancesPassees: n,
          reponses: n,
          serie: n,
          ateliersProposes: n,
          presencesTotales: n,
          ancienneteMois: n,
          joursDeCours: deuxSoirs(n, n),
        }),
      )
        .filter((b) => b.gagne)
        .map((b) => b.cle);

    for (let n = 1; n < 60; n += 1) {
      const avant = gagnesA(n);
      const apres = gagnesA(n + 1);
      for (const cle of avant) expect(apres).toContain(cle);
    }
  });
});

/**
 * **`presencesDuMeilleurMois` — le meilleur mois d'un jour de la semaine.**
 *
 * La matière de « Le fer du mardi » et « Le fer du vendredi » : le **maximum** parmi les mois
 * civils traversés, jamais le total. Tout se lit en UTC, les séances étant rangées à minuit UTC.
 */
describe("le meilleur mois d'un jour de la semaine", () => {
  const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("rend zéro sur une liste vide", () => {
    expect(presencesDuMeilleurMois([], MARDI)).toBe(0);
  });

  it("ignore les dates qui tombent un autre jour de la semaine", () => {
    // Quatre vendredis de septembre 2025 : rien pour le mardi.
    const vendredis = ["2025-09-05", "2025-09-12", "2025-09-19", "2025-09-26"].map(le);
    expect(presencesDuMeilleurMois(vendredis, MARDI)).toBe(0);
    expect(presencesDuMeilleurMois(vendredis, VENDREDI)).toBe(4);
  });

  it("rend le maximum d'un mois civil, et non le total de tous les mois", () => {
    // 3 mardis en septembre, 4 en octobre : le blason se gagne sur octobre, et la fonction rend 4
    // (le total ferait 7, et décernerait le blason à qui n'a jamais fait un mois entier).
    const dates = ["2025-09-02", "2025-09-09", "2025-09-16", "2025-10-07", "2025-10-14", "2025-10-21", "2025-10-28"].map(le);
    expect(presencesDuMeilleurMois(dates, MARDI)).toBe(4);
  });

  it("ne mélange pas deux mois voisins", () => {
    // Deux mardis en septembre, deux en octobre : jamais quatre.
    const dates = ["2025-09-23", "2025-09-30", "2025-10-07", "2025-10-14"].map(le);
    expect(presencesDuMeilleurMois(dates, MARDI)).toBe(2);
  });

  it("ne mélange pas le même mois de deux années différentes", () => {
    // Septembre 2025 (2 mardis) et septembre 2026 (3 mardis) : le meilleur mois en vaut 3, pas 5.
    const dates = ["2025-09-02", "2025-09-09", "2026-09-01", "2026-09-08", "2026-09-15"].map(le);
    expect(presencesDuMeilleurMois(dates, MARDI)).toBe(3);
  });

  it("compte les cinq mardis d'un mois qui en porte cinq", () => {
    const dates = ["2025-09-02", "2025-09-09", "2025-09-16", "2025-09-23", "2025-09-30"].map(le);
    expect(presencesDuMeilleurMois(dates, MARDI)).toBe(5);
  });

  it("ignore les dates illisibles sans tomber ni contaminer le compte", () => {
    const dates = [
      le("2025-09-02"),
      new Date("pas une date"),
      le("2025-09-09"),
      null as unknown as Date,
      undefined as unknown as Date,
      "2025-09-16" as unknown as Date,
    ];
    expect(presencesDuMeilleurMois(dates, MARDI)).toBe(2);
  });

  it("lit le jour de la semaine en UTC, jamais dans le fuseau de la machine", () => {
    // Deux mardis UTC encadrant la journée : l'un serait un mercredi à l'est de Greenwich, l'autre
    // un lundi à l'ouest. Les deux comptent — sinon le fuseau du serveur déciderait d'un blason.
    const dates = [new Date("2025-09-02T01:00:00.000Z"), new Date("2025-09-02T23:00:00.000Z")];
    expect(presencesDuMeilleurMois(dates, MARDI)).toBe(2);
    // Le mercredi 3 septembre à 00h30 UTC n'est pas un mardi, quelle que soit l'heure locale.
    expect(presencesDuMeilleurMois([new Date("2025-09-03T00:30:00.000Z")], MARDI)).toBe(0);
  });

  it("alimente le blason du mardi tel quel", () => {
    const mardis = ["2025-11-04", "2025-09-02", "2025-09-09", "2025-09-16", "2025-09-23"].map(le);
    const fait = presencesDuMeilleurMois(mardis, MARDI);
    expect(blason(`jour-${MARDI}-du-mois`, { joursDeCours: [{ jour: MARDI, presences: fait }] }).gagne).toBe(true);
  });
});

/**
 * **`joursDeCoursDuClub` — les vrais soirs de cours du club, déduits de ses séances.**
 *
 * « Le fer du mardi » et « Le fer du vendredi » étaient les deux soirs du club pour lequel l'outil a
 * été écrit, **codés en dur** : chez un club qui s'entraîne le lundi et le jeudi, c'étaient deux
 * blasons inatteignables. Ils suivent désormais le calendrier réel, et un créneau n'est retenu que si
 * le blason y est **atteignable** — quatre cours de ce jour-là dans un même mois civil.
 */
describe("les jours de cours du club", () => {
  const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  /** Les `n` premiers cours hebdomadaires à partir d'une date, ce qui donne un mois plein dès quatre. */
  const hebdo = (depart: string, n: number) =>
    Array.from({ length: n }, (_, i) => new Date(le(depart).getTime() + i * 7 * 24 * 3600 * 1000));

  it("retient les deux jours les plus fréquents, dans l'ordre de la semaine", () => {
    // Un club du mardi et du vendredi : septembre 2025 en porte cinq de chaque.
    const dates = [...hebdo("2025-09-02", 5), ...hebdo("2025-09-05", 5)];
    expect(joursDeCoursDuClub(dates)).toEqual([MARDI, VENDREDI]);
  });

  it("suit le calendrier d'un club qui s'entraîne d'autres soirs", () => {
    // Lundi et jeudi : c'est exactement le club que les deux blasons codés en dur laissaient dehors.
    const dates = [...hebdo("2025-09-01", 5), ...hebdo("2025-09-04", 4)];
    expect(joursDeCoursDuClub(dates)).toEqual([LUNDI, JEUDI]);
  });

  it("n'en retient qu'un pour un club qui n'a qu'un seul soir de cours", () => {
    expect(joursDeCoursDuClub(hebdo("2025-09-03", 8))).toEqual([3]);
  });

  it("n'en retient aucun tant qu'aucun créneau n'a tenu un mois plein", () => {
    // Trois mardis en tout : le blason demande quatre cours du même jour dans le même mois, il est
    // inatteignable — et un blason impossible vaut moins que pas de blason du tout.
    expect(joursDeCoursDuClub(hebdo("2025-09-02", 3))).toEqual([]);
    // Deux mardis en septembre, deux en octobre : aucun mois plein non plus.
    expect(joursDeCoursDuClub(["2025-09-23", "2025-09-30", "2025-10-07", "2025-10-14"].map(le))).toEqual([]);
    // Un club sans aucune séance.
    expect(joursDeCoursDuClub([])).toEqual([]);
  });

  it("ne rend jamais plus de deux jours, même à un club qui s'entraîne tous les soirs", () => {
    const tousLesSoirs = [1, 2, 3, 4, 5].flatMap((decalage) => hebdo(`2025-09-0${decalage}`, 4));
    const jours = joursDeCoursDuClub(tousLesSoirs);
    expect(jours).toHaveLength(JOURS_DE_COURS_MAX);
    // Ex æquo : on départage par l'ordre de la semaine, lundi d'abord — le résultat ne dépend donc
    // pas de l'ordre dans lequel la base a rendu ses lignes.
    expect(jours).toEqual([LUNDI, MARDI]);
  });

  it("ignore les dates illisibles sans tomber", () => {
    const dates = [...hebdo("2025-09-02", 4), new Date("pas une date"), null as unknown as Date];
    expect(joursDeCoursDuClub(dates)).toEqual([MARDI]);
  });

  it("donne à la vitrine autant de blasons de créneau que le club a de soirs", () => {
    const unSeulSoir = blasons(situation({ joursDeCours: [{ jour: JEUDI, presences: 4 }] }));
    const creneaux = unSeulSoir.filter((b) => b.cle.startsWith("jour-"));
    expect(creneaux.map((b) => b.nom)).toEqual(["Le fer du jeudi"]);
    expect(creneaux[0].unite).toBe("jeudis");
    expect(creneaux[0].gagne).toBe(true);
    // Le reste de la collection est intact : onze blasons au lieu de douze, pas un trou.
    expect(unSeulSoir).toHaveLength(COLLECTION.length - 1);

    // Aucun soir de cours : aucun blason de créneau, et surtout aucun blason impossible.
    const aucun = blasons(situation({ joursDeCours: [] }));
    expect(aucun.filter((b) => b.cle.startsWith("jour-"))).toEqual([]);
    expect(aucun).toHaveLength(COLLECTION.length - 2);
  });

  it("libelle chaque jour de la semaine sans jamais écrire un numéro", () => {
    const noms = [0, 1, 2, 3, 4, 5, 6].map(
      (jour) => blasons(situation({ joursDeCours: [{ jour, presences: 0 }] })).find((b) => b.cle === `jour-${jour}-du-mois`)?.nom,
    );
    expect(noms).toEqual([
      "Le fer du dimanche",
      "Le fer du lundi",
      "Le fer du mardi",
      "Le fer du mercredi",
      "Le fer du jeudi",
      "Le fer du vendredi",
      "Le fer du samedi",
    ]);
  });

  it("écarte un jour qui n'est pas un jour de la semaine plutôt que d'inventer un nom", () => {
    const b = blasons(situation({ joursDeCours: [{ jour: 7, presences: 4 }, { jour: -1, presences: 4 }] }));
    expect(b.filter((x) => x.cle.startsWith("jour-"))).toEqual([]);
  });
});

/**
 * **Les rangs, sur l'ancienneté au club** et non plus sur les présences du trimestre.
 *
 * L'échelle se compte désormais en **mois d'ancienneté** — 0, 6, 12, 24, 48 —, et l'ordre demandé
 * par Delta place **Compagnon avant Bretteur**. Ce qui ne bouge pas, et qui est éprouvé ici comme
 * avant : il y a **toujours exactement un rang courant**, « Recrue » comprise à zéro mois.
 */
describe("les rangs de la salle d'armes", () => {
  it("rend les cinq rangs dans l'ordre, avec leurs seuils en mois — Compagnon avant Bretteur", () => {
    expect(rangs(0).map((r) => [r.nom, r.seuil])).toEqual([
      ["Recrue", 0],
      ["Élève", 6],
      ["Compagnon", 12],
      ["Bretteur", 24],
      ["Maître d'armes", 48],
    ]);
  });

  it("désigne toujours un rang courant et un seul, Recrue comprise à zéro mois d'ancienneté", () => {
    for (const mois of [0, 1, 5, 6, 11, 12, 23, 24, 47, 48, 120]) {
      expect(rangs(mois).filter((r) => r.actuel)).toHaveLength(1);
    }
    expect(rangs(0).find((r) => r.actuel)?.nom).toBe("Recrue");
    expect(rangs(5).find((r) => r.actuel)?.nom).toBe("Recrue");
    expect(rangs(120).find((r) => r.actuel)?.nom).toBe("Maître d'armes");
  });

  it("change de rang pile au seuil, jamais le mois d'avant", () => {
    expect(rangs(5).find((r) => r.actuel)?.nom).toBe("Recrue");
    expect(rangs(6).find((r) => r.actuel)?.nom).toBe("Élève");
    expect(rangs(11).find((r) => r.actuel)?.nom).toBe("Élève");
    expect(rangs(12).find((r) => r.actuel)?.nom).toBe("Compagnon");
    expect(rangs(23).find((r) => r.actuel)?.nom).toBe("Compagnon");
    expect(rangs(24).find((r) => r.actuel)?.nom).toBe("Bretteur");
    expect(rangs(47).find((r) => r.actuel)?.nom).toBe("Bretteur");
    expect(rangs(48).find((r) => r.actuel)?.nom).toBe("Maître d'armes");
  });

  it("marque comme atteints tous les rangs franchis, et eux seuls", () => {
    expect(rangs(24).map((r) => r.atteint)).toEqual([true, true, true, true, false]);
    expect(rangs(23).map((r) => r.atteint)).toEqual([true, true, true, false, false]);
    expect(rangs(0).map((r) => r.atteint)).toEqual([true, false, false, false, false]);
  });

  it("annonce le prochain rang et ce qu'il reste à attendre, en mois", () => {
    expect(prochainRang(0)).toEqual({ nom: "Élève", reste: 6 });
    expect(prochainRang(2)).toEqual({ nom: "Élève", reste: 4 });
    expect(prochainRang(6)).toEqual({ nom: "Compagnon", reste: 6 });
    expect(prochainRang(10)).toEqual({ nom: "Compagnon", reste: 2 });
    expect(prochainRang(12)).toEqual({ nom: "Bretteur", reste: 12 });
    expect(prochainRang(24)).toEqual({ nom: "Maître d'armes", reste: 24 });
    expect(prochainRang(46)).toEqual({ nom: "Maître d'armes", reste: 2 });
  });

  it("ne promet plus rien une fois le sommet atteint", () => {
    expect(prochainRang(48)).toBeNull();
    expect(prochainRang(240)).toBeNull();
  });

  it("traite une entrée aberrante comme zéro mois d'ancienneté", () => {
    expect(rangs(-4).find((r) => r.actuel)?.nom).toBe("Recrue");
    expect(prochainRang(Number.NaN)).toEqual({ nom: "Élève", reste: 6 });
  });

  /**
   * La propriété qui a motivé le changement : un rang ne redescend jamais. Adossé aux présences du
   * trimestre, il retombait à « Recrue » tous les quatre mois ; adossé à l'ancienneté, il ne peut
   * que monter, puisque l'ancienneté ne fait que croître.
   */
  it("ne redescend jamais à mesure que l'ancienneté monte", () => {
    let precedent = -1;
    for (let mois = 0; mois <= 120; mois += 1) {
      const rang = rangs(mois).findIndex((r) => r.actuel);
      expect(rang).toBeGreaterThanOrEqual(precedent);
      precedent = rang;
    }
  });
});

/**
 * **`moisDepuis` — l'ancienneté en mois révolus.**
 *
 * Tout se lit en UTC : les dates des cas sont donc écrites en UTC, pour que le test dise la même
 * chose sur la machine de développement que sur le serveur.
 */
describe("l'ancienneté en mois révolus", () => {
  const le = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("ne compte un mois qu'une fois la date anniversaire atteinte", () => {
    expect(moisDepuis(le("2026-01-10"), le("2026-01-10"))).toBe(0);
    expect(moisDepuis(le("2026-01-10"), le("2026-02-09"))).toBe(0);
    expect(moisDepuis(le("2026-01-10"), le("2026-02-10"))).toBe(1);
    expect(moisDepuis(le("2026-01-10"), le("2026-03-09"))).toBe(1);
    expect(moisDepuis(le("2026-01-10"), le("2026-03-10"))).toBe(2);
  });

  it("borne le jour anniversaire au dernier jour du mois d'arrivée", () => {
    // Le cas donné par Delta : six mois révolus le 31 juillet, pas avant.
    expect(moisDepuis(le("2026-01-31"), le("2026-07-30"))).toBe(5);
    expect(moisDepuis(le("2026-01-31"), le("2026-07-31"))).toBe(6);
    // Février n'a pas de 31 : l'anniversaire mensuel tombe le dernier jour du mois.
    expect(moisDepuis(le("2026-01-31"), le("2026-02-27"))).toBe(0);
    expect(moisDepuis(le("2026-01-31"), le("2026-02-28"))).toBe(1);
    expect(moisDepuis(le("2026-03-31"), le("2026-04-30"))).toBe(1);
  });

  it("traverse les changements d'année sans se tromper de compte", () => {
    expect(moisDepuis(le("2024-11-15"), le("2025-01-14"))).toBe(1);
    expect(moisDepuis(le("2024-11-15"), le("2025-01-15"))).toBe(2);
    expect(moisDepuis(le("2023-09-01"), le("2026-09-01"))).toBe(36);
    expect(moisDepuis(le("2022-09-25"), le("2026-09-25"))).toBe(48);
  });

  it("gère le 29 février : l'anniversaire mensuel tombe au dernier jour des mois plus courts", () => {
    expect(moisDepuis(le("2024-02-29"), le("2024-03-28"))).toBe(0);
    expect(moisDepuis(le("2024-02-29"), le("2024-03-29"))).toBe(1);
    // Une année non bissextile : le 28 février fait bien l'année révolue.
    expect(moisDepuis(le("2024-02-29"), le("2025-02-27"))).toBe(11);
    expect(moisDepuis(le("2024-02-29"), le("2025-02-28"))).toBe(12);
    // Et le 29 février suivant tombe quatre ans plus tard, sans un mois de trop.
    expect(moisDepuis(le("2024-02-29"), le("2028-02-29"))).toBe(48);
  });

  it("rend zéro pour une date future ou illisible, jamais un compte négatif ni un NaN", () => {
    expect(moisDepuis(le("2027-01-01"), le("2026-09-25"))).toBe(0);
    expect(moisDepuis(le("2026-10-25"), le("2026-09-25"))).toBe(0);
    expect(moisDepuis(new Date("pas une date"), le("2026-09-25"))).toBe(0);
    expect(moisDepuis(le("2020-01-01"), new Date("pas une date"))).toBe(0);
  });

  it("tient compte de l'heure de la journée quand les deux dates tombent le même jour", () => {
    const cree = new Date("2026-01-10T18:00:00Z");
    expect(moisDepuis(cree, new Date("2026-02-10T09:00:00Z"))).toBe(0);
    expect(moisDepuis(cree, new Date("2026-02-10T18:00:00Z"))).toBe(1);
  });

  /** Le point qui donne son sens au changement : l'ancienneté ne redescend jamais. */
  it("ne fait que croître au fil du temps", () => {
    const cree = le("2024-05-17");
    let precedent = 0;
    for (let jour = 0; jour < 800; jour += 1) {
      const maintenant = new Date(cree.getTime() + jour * 86_400_000);
      const mois = moisDepuis(cree, maintenant);
      expect(mois).toBeGreaterThanOrEqual(precedent);
      precedent = mois;
    }
  });
});

/**
 * **La règle de repli de l'ancienneté** — écrite une seule fois, ici éprouvée.
 *
 * Le club existait bien avant l'application : `createdAt` ne date que le **compte**, et s'y adosser
 * faisait de tout le monde une « Recrue », y compris de gens qui tirent depuis huit ans. Le bureau
 * saisit donc une date d'adhésion dans la fiche du membre — et quand il ne la connaît pas, on
 * retombe sur la création du compte plutôt que de laisser un rang sans entrée.
 */
describe("depuis quand on est du club", () => {
  const le = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const creation = le("2026-01-22");

  it("compte depuis la date d'adhésion dès qu'elle est renseignée", () => {
    const adhesion = le("2018-09-01");
    expect(dateDAdhesion({ auClubDepuis: adhesion, createdAt: creation })).toEqual(adhesion);
    expect(moisDepuis(dateDAdhesion({ auClubDepuis: adhesion, createdAt: creation }), le("2026-09-25"))).toBe(96);
  });

  it("retombe sur la création du compte quand personne ne connaît la date d'adhésion", () => {
    // …et la ramène, elle aussi, à la rentrée de sa saison : les deux chemins doivent donner des
    // anciennetés comparables, sans quoi le repli vaudrait un rang de moins qu'une saisie.
    expect(dateDAdhesion({ auClubDepuis: null, createdAt: creation })).toEqual(le("2025-09-01"));
    expect(dateDAdhesion({ createdAt: creation })).toEqual(le("2025-09-01"));
    // Une valeur illisible compte comme absente : jamais de NaN dans la vitrine de quelqu'un.
    expect(dateDAdhesion({ auClubDepuis: new Date("pas une date"), createdAt: creation })).toEqual(le("2025-09-01"));
    expect(moisDepuis(dateDAdhesion({ auClubDepuis: null, createdAt: creation }), le("2026-09-25"))).toBe(12);
  });

  it("prend la date d'adhésion même plus récente que le compte : c'est une saisie, pas une estimation", () => {
    expect(dateDAdhesion({ auClubDepuis: le("2026-09-01"), createdAt: creation })).toEqual(le("2026-09-01"));
  });

  it("donne la même ancienneté à deux personnes de la même saison, saisie ou repli", () => {
    const saisie = dateDAdhesion({ auClubDepuis: le("2024-09-01"), createdAt: le("2026-03-02") });
    const repli = dateDAdhesion({ auClubDepuis: null, createdAt: le("2025-01-14") });
    expect(moisDepuis(saisie, le("2026-09-25"))).toBe(24);
    expect(moisDepuis(repli, le("2026-09-25"))).toBe(24);
  });
});

/**
 * **La saison du club :**.
 *
 * Tout le club prend une année d'ancienneté le même jour, à la rentrée : personne ne change de rang
 * un mardi de février, et « depuis 2 ans » veut dire « depuis deux rentrées ».
 */
describe("la rentrée qui ouvre une saison", () => {
  const le = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("ramène une date au 1er septembre précédent ou égal", () => {
    expect(debutDeSaison(le("2025-01-14"))).toEqual(le("2024-09-01"));
    expect(debutDeSaison(le("2025-09-03"))).toEqual(le("2025-09-01"));
    expect(debutDeSaison(le("2025-08-31"))).toEqual(le("2024-09-01"));
    // Le 1er septembre lui-même ne bouge pas : la fonction se rejoue sans rien déplacer.
    expect(debutDeSaison(le("2025-09-01"))).toEqual(le("2025-09-01"));
    expect(debutDeSaison(debutDeSaison(le("2026-02-02")))).toEqual(le("2025-09-01"));
  });

  it("lit et écrit en UTC, et ne renvoie jamais dans le futur", () => {
    // Une heure tardive un 31 août reste la saison précédente : la bascule ne dépend pas du fuseau.
    expect(debutDeSaison(new Date("2025-08-31T23:30:00Z"))).toEqual(le("2024-09-01"));
    for (const iso of ["2026-09-01", "2026-09-25", "2027-01-01"]) {
      expect(debutDeSaison(new Date(`${iso}T12:00:00Z`)).getTime()).toBeLessThanOrEqual(Date.parse(`${iso}T12:00:00Z`));
    }
  });
});

/**
 * **La durée saisie par le bureau ↔ la date rangée en base.**
 *
 * Delta ne saisit pas une date mais une durée (« depuis deux ans »), parce que c'est ce que le club
 * sait vraiment. Ce qu'on range reste une date, pour que l'ancienneté grandisse toute seule — d'où
 * ces deux conversions, et surtout l'aller-retour : ce qu'on tape doit se relire tel quel.
 */
describe("la durée « Au club depuis »", () => {
  const maintenant = new Date("2026-09-25T12:00:00Z");

  it("recule de la durée saisie, puis se pose sur la rentrée de cette saison-là", () => {
    // « 2 ans » saisis : deux rentrées en arrière,.
    expect(dateDepuisDuree(2, 0, maintenant)?.toISOString()).toBe("2024-09-01T00:00:00.000Z");
    // 30 mois en arrière, c'est mars 2024 : la saison ouverte.
    expect(dateDepuisDuree(2, 6, maintenant)?.toISOString()).toBe("2023-09-01T00:00:00.000Z");
    // Un mois en arrière, c'est août : la saison d'avant la rentrée en cours.
    expect(dateDepuisDuree(0, 1, maintenant)?.toISOString()).toBe("2025-09-01T00:00:00.000Z");
    expect(dateDepuisDuree(8, 0, maintenant)?.toISOString()).toBe("2018-09-01T00:00:00.000Z");
    // Saisie faite en cours de saison : un mois, c'est encore la saison 2025.
    expect(dateDepuisDuree(0, 1, new Date("2026-03-31T12:00:00Z"))?.toISOString()).toBe("2025-09-01T00:00:00.000Z");
  });

  it("rend null pour zéro, pour du vide et pour une saisie absurde : « je ne sais pas »", () => {
    expect(dateDepuisDuree(0, 0, maintenant)).toBeNull();
    expect(dateDepuisDuree(-3, -2, maintenant)).toBeNull();
    expect(dateDepuisDuree(Number.NaN, Number.NaN, maintenant)).toBeNull();
    expect(dureeDepuisDate(null, maintenant)).toBeNull();
    expect(dureeDepuisDate(new Date("pas une date"), maintenant)).toBeNull();
  });

  it("ne rend jamais une date future : une durée est un recul dans le temps", () => {
    for (const [annees, mois] of [[0, 1], [1, 0], [40, 11], [-5, 3]] as const) {
      const date = dateDepuisDuree(annees, mois, maintenant);
      if (date) expect(date.getTime()).toBeLessThanOrEqual(maintenant.getTime());
    }
  });

  /**
   * **L'aller-retour rend la saison, pas les deux nombres tapés** — c'est l'arrondi à la rentrée,
   * et il est voulu. Ce qui doit tenir, et que ce test vérifie : rouvrir la fiche puis enregistrer
   * sans rien changer **ne déplace pas la saison d'adhésion**. Sans cette garantie, chaque passage
   * sur une fiche aurait rajeuni ou vieilli quelqu'un d'une rentrée.
   */
  it("retrouve la même saison après un aller-retour, même si les deux nombres changent", () => {
    for (const annees of [0, 1, 2, 7, 40]) {
      for (const mois of [0, 1, 6, 11]) {
        const date = dateDepuisDuree(annees, mois, maintenant);
        if (annees === 0 && mois === 0) {
          expect(date).toBeNull();
          continue;
        }
        const relu = dureeDepuisDate(date, maintenant);
        expect(dateDepuisDuree(relu!.annees, relu!.mois, maintenant)).toEqual(date);
      }
    }
  });

  it("se relit en années pleines tant que la rentrée en cours n'est pas dépassée", () => {
    // Saisi le 25 septembre, un mois d'ancienneté remonte à août, donc à la saison précédente :
    // la personne est réputée arrivée à la rentrée d'avant, et se relit « 1 an ».
    expect(dureeDepuisDate(dateDepuisDuree(0, 1, maintenant), maintenant)).toEqual({ annees: 1, mois: 0 });
    expect(dureeDepuisDate(dateDepuisDuree(2, 6, maintenant), maintenant)).toEqual({ annees: 3, mois: 0 });
    // En cours de saison, l'ancienneté d'une rentrée se lit en années **et** en mois écoulés.
    const fevrier = new Date("2026-02-15T12:00:00Z");
    expect(dureeDepuisDate(dateDepuisDuree(1, 0, fevrier), fevrier)).toEqual({ annees: 1, mois: 5 });
  });

  it("garde l'aller-retour un 31 août, la veille d'une rentrée", () => {
    const veilleDeRentree = new Date("2026-08-31T09:00:00Z");
    const date = dateDepuisDuree(3, 5, veilleDeRentree);
    expect(date?.toISOString()).toBe("2022-09-01T00:00:00.000Z");
    const relu = dureeDepuisDate(date, veilleDeRentree);
    expect(dateDepuisDuree(relu!.annees, relu!.mois, veilleDeRentree)).toEqual(date);
  });
});

/** **Un seul formateur de durée** dans l'application : celui-ci (il vivait dans `Blasons.tsx`). */
describe("la durée en toutes lettres", () => {
  it("écrit les mois seuls en dessous d'un an, les années au-delà", () => {
    expect(formatDuree(0)).toBe("0 mois");
    expect(formatDuree(4)).toBe("4 mois");
    expect(formatDuree(11)).toBe("11 mois");
    expect(formatDuree(12)).toBe("1 an");
    expect(formatDuree(14)).toBe("1 an et 2 mois");
    expect(formatDuree(24)).toBe("2 ans");
    expect(formatDuree(48)).toBe("4 ans");
    expect(formatDuree(53)).toBe("4 ans et 5 mois");
  });

  it("ne rend jamais un nombre négatif ni un NaN", () => {
    expect(formatDuree(-3)).toBe("0 mois");
    expect(formatDuree(Number.NaN)).toBe("0 mois");
  });
});
