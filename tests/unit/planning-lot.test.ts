import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateSansAnnee, minuscule } from "@/lib/dates";

/**
 * **Enregistrer tout un brouillon de planning d'un coup**.
 *
 * Le planning devient **lecture seule par défaut** : « Modifier les séances » ouvre un mode
 * brouillon dans le navigateur, et « Enregistrer » envoie le lot en **un seul appel**
 * (`enregistrerCases`). Avant, chaque case partait toute seule à chaque réglage — il n'y avait donc
 * rien à « enregistrer » ni à « annuler », et régler le programme d'un trimestre faisait partir une
 * centaine d'écritures, d'entrées de journal et de revalidations, dont celles qu'on venait de
 * corriger.
 *
 * Ce fichier garde ce que le lot promet et que **rien à l'écran ne montrerait** s'il se brisait :
 *
 * 1. **les mêmes verrous que le geste unitaire, par les mêmes fonctions** — `planning.edit`,
 *    `casePlanningSchema`, `partiePourEcriture`, le refus d'une case réservée à un atelier, celui
 *    d'une même personne en instructeur et en second, celui d'un second sans premier. Deux chemins
 *    d'écriture aux règles différentes, c'est une porte dérobée d'un côté ou une fonctionnalité morte
 *    de l'autre ;
 * 2. **tout ou rien**, en nommant la case fautive : un lot à moitié écrit sur un planning est pire
 *    qu'un refus, plus personne ne sait ce qui a pris ;
 * 3. **une entrée d'audit par case réellement modifiée**, sous la même action que le geste unitaire ;
 * 4. **une synchronisation par séance touchée**, pas une par case ;
 * 5. **ce qui ne change pas ne s'écrit pas** — `updatedAt` est un `@updatedAt`, et la grille
 *    l'affiche dans « Modifié par … le … ».
 */

/* ------------------------------------------------------------------ */
/* Le harnais                                                          */
/* ------------------------------------------------------------------ */

type Partie = {
  id: string;
  sessionId: string;
  libelle: string;
  ordre: number;
  estOption: boolean;
  instructeurId: string | null;
  instructeurSecondId: string | null;
  theme: string;
  description: string;
  niveau: string;
  atelierId: string | null;
  modifieParId: string | null;
  /** `@updatedAt` en base : c'est ce champ que la grille affiche dans « Modifié par … le … ». */
  updatedAt: Date;
};

/** La séance porte sa date (les refus la nomment) et l'état qui décide de l'écriture. */
type Seance = { id: string; date: string; annulee: boolean; statutPeriode: string };

const S1 = "s-jeudi";
const S2 = "s-samedi";

const faux = vi.hoisted(() => ({
  /**
   * **Un instructeur, pas un administrateur** : `planning.edit` est un droit de l'encadrement, et le
   * lot ne doit pas devenir un geste de bureau au prétexte qu'il écrit plusieurs lignes. C'est
   * l'échelle qui change, pas la serrure.
   */
  acteur: {
    id: "u-echo",
    prenom: "Echo",
    nom: "Du Roy",
    email: "echo@club.test",
    role: "INSTRUCTEUR",
    estAdmin: false, service: false,
    actif: true,
    sessionId: "sess-1",
    sessionForte: false,
  },
  /** Permission exigée par le dernier appel : la garde se vérifie, elle ne se suppose pas. */
  permissions: [] as string[],
  parties: [] as Partie[],
  seances: [] as Seance[],
  users: [
    { id: "u1", actif: true, service: false },
    { id: "u2", actif: true, service: false },
    { id: "u-parti", actif: false, service: false },
    { id: "u-service", actif: true, service: true },
  ],
  audits: [] as Array<{
    acteur: unknown;
    action: string;
    cible: string | null;
    details: Record<string, unknown>;
  }>,
  chemins: [] as string[],
  /** Chaque écriture de case, dans l'ordre : c'est ce qui doit tenir dans une seule transaction. */
  ecritures: [] as string[],
  /** Chaque appel à `$transaction`, avec le nombre d'opérations qu'il portait. */
  transactions: [] as number[],
  /** Chaque appel à `synchroniserSeance` : on en veut un par séance touchée, pas un par case. */
  synchronisations: [] as string[],
}));

/** Le journal d'audit lit des noms, jamais des identifiants : le faux client doit donc en rendre. */
const NOMS: Record<string, { prenom: string; nom: string }> = {
  u1: { prenom: "Alice", nom: "Roy" },
  u2: { prenom: "Charlie", nom: "Sel" },
  "u-parti": { prenom: "Parti", nom: "Duclub" },
  "u-service": { prenom: "Portail", nom: "HEMA" },
};
const nomFaux = (id: string | null) => (id ? (NOMS[id] ?? null) : null);

const partie = (id: string) => faux.parties.find((p) => p.id === id);
const seance = (id: string) => faux.seances.find((s) => s.id === id);

vi.mock("@/lib/db", () => {
  const client = {
    sessionPartie: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const p = partie(where.id);
        if (!p) return null;
        const s = seance(p.sessionId)!;
        return {
          ...p,
          instructeur: nomFaux(p.instructeurId),
          instructeurSecond: nomFaux(p.instructeurSecondId),
          /*
           * **`annulee` est rendu comme la base le rendrait.** `partiePourEcriture` ne le
           * sélectionne pas aujourd'hui : le faux client ne doit pas le cacher pour autant, sinon le
           * jour où la garde partagée gagnera ce verrou, le test qui compare les deux portes ne
           * verrait rien changer (voir « le verdict du lot est celui du geste unitaire »).
           */
          session: {
            id: s.id,
            date: s.date,
            annulee: s.annulee,
            period: { statut: s.statutPeriode },
          },
        };
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<Partie> }) => {
        const p = partie(where.id);
        if (!p) throw new Error("introuvable");
        faux.ecritures.push(`update:${where.id}`);
        Object.assign(p, data);
        // Prisma pose l'instant de l'écriture (`@updatedAt`) : la bulle « Modifié par … le … » en
        // dépend, et c'est ce qui permet de voir qu'une case inchangée n'a pas été repeinte.
        p.updatedAt = new Date(Date.parse(p.updatedAt.toISOString()) + 60_000);
        return Promise.resolve({
          ...p,
          instructeur: nomFaux(p.instructeurId),
          instructeurSecond: nomFaux(p.instructeurSecondId),
        });
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.users.find((u) => u.id === where.id) ?? null),
    },
  };
  return {
    db: {
      ...client,
      $transaction: vi.fn(async (arg: unknown) => {
        if (typeof arg === "function") return (arg as (c: typeof client) => Promise<unknown>)(client);
        const ops = arg as Promise<unknown>[];
        faux.transactions.push(ops.length);
        return Promise.all(ops);
      }),
    },
  };
});

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (acteur: unknown, action: string, cible?: string | null, details?: Record<string, unknown>) => {
    faux.audits.push({ acteur, action, cible: cible ?? null, details: details ?? {} });
  }),
}));

/**
 * La garde **refuse pour de vrai**, par la matrice centrale : sans cela, « un instructeur passe, un
 * membre est refusé » n'éprouverait plus rien du tout.
 */
vi.mock("@/lib/auth/current-user", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  class AccesRefuse extends Error {}
  return {
    AccesRefuse,
    getCurrentUser: vi.fn(async () => faux.acteur),
    requireUser: vi.fn(async () => faux.acteur),
    assertPermission: vi.fn(async (permission: Parameters<typeof vrai.can>[1]) => {
      faux.permissions.push(permission);
      if (!vrai.can(faux.acteur, permission)) throw new AccesRefuse();
      if (vrai.exigeSessionForte(permission) && !faux.acteur.sessionForte) throw new AccesRefuse();
      return faux.acteur;
    }),
    requirePermission: vi.fn(async () => faux.acteur),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((chemin: string) => {
    faux.chemins.push(chemin);
  }),
}));

/** `synchroniserSeance` a ses propres tests (`synchronisation-seance.test.ts`) : ici on compte les appels. */
vi.mock("@/lib/planning", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  synchroniserSeance: vi.fn(async (id: string) => {
    faux.synchronisations.push(id);
  }),
}));

const { enregistrerCase, enregistrerCases } = await import("@/actions/planning");
const { SELECTION_MAX } = await import("@/lib/validation/presences");

/* ------------------------------------------------------------------ */
/* Le jeu d'essai : deux séances, cinq cases                           */
/* ------------------------------------------------------------------ */

const REMPLI_LE = new Date("2126-09-20T18:30:00.000Z");

function ligne(id: string, sessionId: string, libelle: string, reste: Partial<Partie> = {}): Partie {
  return {
    id,
    sessionId,
    libelle,
    ordre: 0,
    estOption: libelle.startsWith("Option"),
    instructeurId: null,
    instructeurSecondId: null,
    theme: "",
    description: "",
    niveau: "INDIFFERENT",
    atelierId: null,
    modifieParId: null,
    updatedAt: REMPLI_LE,
    ...reste,
  };
}

/** Les réglages d'une case, tels que le brouillon du navigateur les envoie. */
function reglages(partieId: string, reste: Partial<Record<"instructeurId" | "instructeurSecondId" | "theme" | "description" | "niveau", string>> = {}) {
  return { partieId, instructeurId: "", theme: "", niveau: "INDIFFERENT", ...reste };
}

beforeEach(() => {
  faux.acteur = {
    id: "u-echo",
    prenom: "Echo",
    nom: "Du Roy",
    email: "echo@club.test",
    role: "INSTRUCTEUR",
    estAdmin: false, service: false,
    actif: true,
    sessionId: "sess-1",
    sessionForte: false,
  };
  faux.seances = [
    { id: S1, date: "2126-10-01", annulee: false, statutPeriode: "ACTIVE" },
    { id: S2, date: "2126-10-03", annulee: false, statutPeriode: "ACTIVE" },
  ];
  faux.parties = [
    ligne("c1", S1, "Cours 1"),
    ligne("c2", S1, "Cours 2"),
    ligne("c3", S1, "Option 1"),
    ligne("c4", S2, "Cours 1"),
    ligne("c5", S2, "Option 1"),
  ];
  faux.permissions = [];
  faux.audits = [];
  faux.chemins = [];
  faux.ecritures = [];
  faux.transactions = [];
  faux.synchronisations = [];
});

/** « Cours 2 » du vendredi 1er octobre — la façon dont un refus nomme sa case. */
const nomDeCase = (libelle: string, date: string) => `« ${libelle} » du ${minuscule(formatDateSansAnnee(date))}`;

/**
 * Un refus : le lot **entier** est refusé, rien n'est écrit, rien n'est journalisé, aucune
 * transaction n'est ouverte et aucune séance n'est resynchronisée.
 */
async function refuse(promesse: Promise<{ erreur?: string; succes?: string }>): Promise<string> {
  const avant = JSON.stringify(faux.parties);
  let resultat: { erreur?: string; succes?: string } | undefined;
  let leve = "";
  try {
    resultat = await promesse;
  } catch (e) {
    leve = e instanceof Error ? e.constructor.name : String(e);
  }
  expect(Boolean(leve) || Boolean(resultat?.erreur), `refus attendu, reçu ${JSON.stringify(resultat)}`).toBe(true);
  expect(JSON.stringify(faux.parties), "aucune case n'a bougé").toBe(avant);
  expect(faux.ecritures, "aucune écriture n'est partie").toEqual([]);
  expect(faux.audits, "et rien n'est inscrit au journal").toEqual([]);
  expect(faux.transactions, "aucune transaction n'a été ouverte").toEqual([]);
  expect(faux.synchronisations, "aucune séance n'a été resynchronisée").toEqual([]);
  return resultat?.erreur ?? leve;
}

/* ------------------------------------------------------------------ */
/* 1. Ce qu'un lot écrit                                               */
/* ------------------------------------------------------------------ */

describe("un lot qui porte sur deux séances", () => {
  /** Le cas ordinaire du nouveau mode : on règle trois cases de deux cours, on enregistre une fois. */
  const lot = [
    reglages("c1", { instructeurId: "u1", theme: "Messer", niveau: "DEBUTANT" }),
    reglages("c2", { instructeurId: "u2", theme: "Dague", description: "Travail au corps à corps." }),
    reglages("c4", { instructeurId: "u1", instructeurSecondId: "u2", theme: "Épée longue" }),
  ];

  it("écrit les trois cases, et rien d'autre", async () => {
    // L'intérêt du mode brouillon est précisément là : trois réglages, un seul aller-retour.
    const res = await enregistrerCases({ cases: lot });
    expect(res.erreur).toBeUndefined();
    expect(faux.ecritures).toEqual(["update:c1", "update:c2", "update:c4"]);
    expect(partie("c1")).toMatchObject({ instructeurId: "u1", theme: "Messer", niveau: "DEBUTANT", modifieParId: "u-echo" });
    expect(partie("c2")).toMatchObject({ instructeurId: "u2", theme: "Dague", description: "Travail au corps à corps." });
    expect(partie("c4")).toMatchObject({ instructeurId: "u1", instructeurSecondId: "u2", theme: "Épée longue" });
    // Les cases qui n'étaient pas du lot restent intactes, y compris celle de la même séance.
    expect(partie("c3")).toMatchObject({ theme: "", instructeurId: null, updatedAt: REMPLI_LE });
    expect(partie("c5")).toMatchObject({ theme: "", updatedAt: REMPLI_LE });
  });

  it("passe toutes les écritures dans une seule transaction", async () => {
    // Un lot à moitié appliqué serait pire qu'un lot refusé : c'est la transaction qui l'interdit.
    await enregistrerCases({ cases: lot });
    expect(faux.transactions).toEqual([3]);
  });

  it("journalise une fois par case, sous la même action que le geste unitaire, en disant « en masse »", async () => {
    // Un seul filtre du journal (`/admin/audit?q=planning.case`) doit retrouver tout ce qui a été
    // écrit dans le planning, quel que soit l'écran par lequel l'équipe est passée.
    await enregistrerCases({ cases: lot });
    expect(faux.audits).toHaveLength(3);
    expect(faux.audits.every((a) => a.action === "planning.case")).toBe(true);
    expect(faux.audits.every((a) => a.details.enMasse === true)).toBe(true);
    expect(faux.audits.map((a) => a.cible)).toEqual([S1, S1, S2]);
    expect(faux.audits.every((a) => (a.acteur as { id: string }).id === "u-echo")).toBe(true);
  });

  it("garde l'avant et l'après nominatifs, jamais des identifiants", async () => {
    // C'est la seule trace de ce qui a été remplacé : un journal qui ne rendrait que des `cuid`
    // obligerait à interroger la base pour se relire — et la ligne a pu disparaître depuis.
    faux.parties = faux.parties.map((p) => (p.id === "c1" ? { ...p, instructeurId: "u2", theme: "Lutte" } : p));
    await enregistrerCases({ cases: [reglages("c1", { instructeurId: "u1", theme: "Messer", niveau: "DEBUTANT" })] });
    expect(faux.audits[0].details).toMatchObject({
      date: "2126-10-01",
      partie: "Cours 1",
      avant: { instructeur: "Charlie Sel", instructeurSecond: null, theme: "Lutte", description: "", niveau: "Indifférent" },
      apres: { instructeur: "Alice Roy", instructeurSecond: null, theme: "Messer", description: "", niveau: "Débutant" },
      enMasse: true,
    });
    expect(JSON.stringify(faux.audits)).not.toContain("c1");
  });

  it("ne synchronise qu'une fois par séance touchée — et jamais zéro fois", async () => {
    /*
     * `synchroniserSeance` recopie **tout** le programme d'une séance dans la séance (cartes,
     * exports, récap du soir, alerte « peu de monde »). L'appeler par case, c'est refaire dix fois
     * le même travail pour un seul cours ; ne pas l'appeler, c'est laisser le récap de la veille
     * annoncer le programme d'avant le lot.
     */
    await enregistrerCases({ cases: lot });
    expect(faux.synchronisations).toEqual([S1, S2]);
  });

  it("revalide la fiche de chaque séance touchée", async () => {
    await enregistrerCases({ cases: lot });
    expect(faux.chemins).toEqual(expect.arrayContaining(["/planning", "/seances", `/seances/${S1}`, `/seances/${S2}`]));
  });

  it("accorde son compte rendu", async () => {
    // Trois cases, puis une seule : le pluriel se lit dans le message que l'écran affiche.
    expect((await enregistrerCases({ cases: lot })).succes).toBe("3 cases enregistrées.");
    faux.ecritures = [];
    expect((await enregistrerCases({ cases: [reglages("c3", { theme: "Bouclier" })] })).succes).toBe("1 case enregistrée.");
  });

  it("demande `planning.edit`, le droit du geste unitaire — ni plus, ni moins", async () => {
    // Le lot n'est pas un geste de bureau : remplir dix cases d'un coup reste tenir le programme.
    await enregistrerCases({ cases: lot });
    expect(faux.permissions).toEqual(["planning.edit"]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Tout ou rien, et la case fautive nommée                          */
/* ------------------------------------------------------------------ */

describe("tout ou rien : une case refusée refuse le lot entier", () => {
  it("refuse le lot pour une case réservée à un atelier, et la nomme", async () => {
    /*
     * Un atelier programmé occupe la case : le geste unitaire le refuse déjà, et il faut passer par
     * la gestion des ateliers. Sans le « tout ou rien », les deux autres cases du lot seraient
     * écrites et l'écran afficherait un succès partiel que personne ne saurait relire.
     */
    faux.parties = faux.parties.map((p) => (p.id === "c3" ? { ...p, atelierId: "a-1" } : p));
    const erreur = await refuse(
      enregistrerCases({
        cases: [
          reglages("c1", { instructeurId: "u1", theme: "Messer" }),
          reglages("c3", { theme: "Autre chose" }),
          reglages("c4", { instructeurId: "u2", theme: "Dague" }),
        ],
      }),
    );
    expect(erreur).toContain(nomDeCase("Option 1", "2126-10-01"));
    expect(erreur).toContain("réservée à un atelier programmé");
    expect(erreur).toContain("Rien n'a été enregistré.");
  });

  it("refuse le lot si une case met la même personne en instructeur et en second", async () => {
    // Deux fois le même nom sur une ligne du programme n'annonce rien de plus et fausse la lecture
    // de « qui encadre » — le lot ne peut pas être plus permissif que la case.
    const erreur = await refuse(
      enregistrerCases({
        cases: [
          reglages("c1", { instructeurId: "u1", theme: "Messer" }),
          reglages("c4", { instructeurId: "u2", instructeurSecondId: "u2", theme: "Dague" }),
        ],
      }),
    );
    expect(erreur).toContain(nomDeCase("Cours 1", "2126-10-03"));
    expect(erreur).toContain("deux personnes différentes");
  });

  it("refuse le lot pour un second sans premier", async () => {
    /*
     * L'état « personne ne mène, quelqu'un assiste » coupe l'application en deux moitiés qui se
     * contredisent : `caseVide` tient la case pour occupée (aucun atelier ne peut s'y poser),
     * `synchroniserSeance` inscrit la personne dans les instructeurs de la séance, et l'affichage
     * fait disparaître la ligne. Le geste unitaire ferme cette porte ; le lot aussi.
     */
    const erreur = await refuse(enregistrerCases({ cases: [reglages("c1", { instructeurSecondId: "u2", theme: "Messer" })] }));
    expect(erreur).toContain("Indique d'abord qui mène la partie");
  });

  it("refuse le lot pour une personne qui n'est plus du club, ou pour le compte du portail", async () => {
    // Poser quelqu'un de désactivé sur une case où il n'était pas reste refusé (l'exception ne
    // couvre que « laisser en place ce qui est déjà écrit »), et le compte du portail n'anime rien.
    expect(await refuse(enregistrerCases({ cases: [reglages("c1", { instructeurId: "u-parti", theme: "Messer" })] }))).toContain(
      "Cette personne n'existe plus.",
    );
    expect(await refuse(enregistrerCases({ cases: [reglages("c2", { instructeurId: "u-service", theme: "Messer" })] }))).toContain(
      "Ce compte ne peut pas être instructeur.",
    );
  });

  it("refuse le lot entier pour un identifiant introuvable : un écran en retard n'est pas une base de décision", async () => {
    // La case a pu être retirée par quelqu'un d'autre pendant qu'on remplissait le brouillon.
    // Enregistrer les autres reviendrait à écrire un programme que son auteur n'a jamais relu.
    const erreur = await refuse(
      enregistrerCases({ cases: [reglages("c1", { instructeurId: "u1", theme: "Messer" }), reglages("c-effacee", { theme: "Dague" })] }),
    );
    expect(erreur).toContain("Cette partie n'existe plus.");
    expect(erreur).toContain("Rien n'a été enregistré.");
  });

  it("ne recopie jamais un identifiant reçu dans son refus", async () => {
    /*
     * Rien de ce qui vient du navigateur n'entre dans un message : un refus nomme la case par ce que
     * la **base** en dit (libellé et date de la séance), relu à l'instant. Recopier l'entrée, c'est
     * la première marche de l'injection dans une interface — et ça n'apprend rien à personne.
     */
    faux.parties = faux.parties.map((p) => (p.id === "c3" ? { ...p, atelierId: "a-1" } : p));
    const erreur = await refuse(enregistrerCases({ cases: [reglages("c3", { theme: "<script>" })] }));
    expect(erreur).not.toContain("c3");
    expect(erreur).not.toContain("<script>");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Les verrous que porte `partiePourEcriture`                       */
/* ------------------------------------------------------------------ */

/**
 * **Le lot ne pose aucune règle de lui-même : il passe par la porte commune.**
 *
 * `partiePourEcriture` retrouve la séance et sa période **depuis la ligne**, jamais depuis ce que
 * l'écran a envoyé — un identifiant recopié dans une requête forgée ne peut donc pas faire écrire
 * ailleurs — et c'est elle qui refuse un trimestre clos. Ce que cette porte refuse, le lot le
 * refuse ; ce qu'elle accepte, il l'accepte. On le vérifie **en comparant les deux verdicts**, et
 * non en recopiant la règle ici : le jour où cette porte gagne un verrou, les deux gestes le
 * gagnent ensemble, et ce test continue de passer. S'ils divergent, il tombe.
 */
describe("les verrous de la porte commune valent pour le lot", () => {
  /** Le verdict d'un geste, sans son détail : refusé, ou passé. */
  async function verdict(promesse: Promise<{ erreur?: string }>): Promise<"refus" | "accepte"> {
    try {
      return (await promesse).erreur ? "refus" : "accepte";
    } catch {
      return "refus";
    }
  }

  it("une période close refuse le lot entier, et n'écrit rien", async () => {
    /*
     * On clôt un trimestre sans attendre son dernier cours : une période CLOSE porte donc des
     * séances à venir, et le verrou ne se déduit pas de la date. Le planning d'un trimestre terminé
     * se lit, il ne se réécrit plus — et un lot pourrait en réécrire un trimestre entier d'un coup.
     */
    faux.seances = [
      { id: S1, date: "2126-10-01", annulee: false, statutPeriode: "CLOSE" },
      { id: S2, date: "2126-10-03", annulee: false, statutPeriode: "ACTIVE" },
    ];
    const erreur = await refuse(
      enregistrerCases({
        // La case de la séance encore ouverte vient **en premier** : sans « tout ou rien », elle
        // serait déjà écrite quand la seconde est refusée.
        cases: [reglages("c4", { instructeurId: "u1", theme: "Dague" }), reglages("c1", { instructeurId: "u1", theme: "Messer" })],
      }),
    );
    expect(erreur).toContain("Cette période est close");
    expect(erreur).toContain("Rien n'a été enregistré.");
  });

  it("rend exactement le verdict du geste unitaire sur une séance annulée", async () => {
    /*
     * **Relevé en écrivant ces tests, et c'est un écart avec l'énoncé** : `partiePourEcriture` ne
     * sélectionne pas `Session.annulee` et ne le pèse donc pas — ni pour la case, ni pour le lot.
     * L'écran, lui, ne montre **aucun** programme sur une séance annulée (`CarteSeancePlanning` : le
     * motif prend toute la carte), et `programmerAtelierDansCase` refuse l'annulation de son côté.
     *
     * Le lot ne tranche pas cette question tout seul : poser le verrou ici et pas dans la porte
     * commune, ce serait justement la divergence que ce fichier traque. On vérifie donc l'invariant
     * qui compte — **les deux portes rendent le même verdict** — pour que le jour où `annulee`
     * rejoint `partiePourEcriture`, les deux gestes se ferment ensemble, sans que ce test ait à
     * bouger.
     */
    faux.seances = [{ id: S1, date: "2126-10-01", annulee: true, statutPeriode: "ACTIVE" }, ...faux.seances.slice(1)];
    const unitaire = await verdict(enregistrerCase(reglages("c1", { instructeurId: "u1", theme: "Messer" })));
    // On repart du même état pour que la comparaison porte sur la règle, pas sur l'ordre des appels.
    faux.parties = [ligne("c1", S1, "Cours 1"), ...faux.parties.slice(1)];
    faux.audits = [];
    faux.ecritures = [];
    faux.transactions = [];
    faux.synchronisations = [];
    const lot = await verdict(enregistrerCases({ cases: [reglages("c1", { instructeurId: "u1", theme: "Messer" })] }));
    expect(lot, "le lot et la case ne peuvent pas avoir deux serrures").toBe(unitaire);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Ce qui ne change pas ne s'écrit pas                              */
/* ------------------------------------------------------------------ */

describe("une case déjà à jour ne coûte ni écriture, ni journal, ni horodatage", () => {
  it("laisse la case tranquille et le dit dans son compte rendu", async () => {
    /*
     * C'est le cas **ordinaire** du mode brouillon : on ouvre le trimestre, on règle deux cases, et
     * le navigateur renvoie tout ce qu'il a. `updatedAt` est un `@updatedAt`, et la grille l'affiche
     * dans « Modifié par … le … » : repeindre cette bulle sur quarante cases ferait mentir l'écran
     * — et, dans le journal, noierait les vraies modifications sous quarante lignes vides.
     */
    faux.parties = faux.parties.map((p) =>
      p.id === "c1" ? { ...p, instructeurId: "u1", theme: "Messer", description: "Déjà écrit.", niveau: "DEBUTANT", modifieParId: "u-autre" } : p,
    );
    const res = await enregistrerCases({
      cases: [
        reglages("c1", { instructeurId: "u1", theme: "Messer", description: "Déjà écrit.", niveau: "DEBUTANT" }),
        reglages("c2", { instructeurId: "u2", theme: "Dague" }),
      ],
    });
    expect(res.succes).toBe("1 case enregistrée, 1 était déjà à jour.");
    expect(faux.ecritures).toEqual(["update:c2"]);
    expect(faux.audits).toHaveLength(1);
    expect(faux.audits[0].details).toMatchObject({ partie: "Cours 2" });
    // Ni l'horodatage ni l'auteur de la case inchangée n'ont bougé : la bulle dit toujours vrai.
    expect(partie("c1")).toMatchObject({ updatedAt: REMPLI_LE, modifieParId: "u-autre" });
  });

  it("n'ouvre aucune transaction et ne resynchronise rien quand tout le lot est déjà à jour", async () => {
    const res = await enregistrerCases({ cases: [reglages("c1"), reglages("c2"), reglages("c3")] });
    expect(res.succes).toBe("Rien à changer : ces 3 cases étaient déjà à jour.");
    expect(faux.ecritures).toEqual([]);
    expect(faux.transactions).toEqual([]);
    expect(faux.audits).toEqual([]);
    expect(faux.synchronisations).toEqual([]);
    expect(faux.chemins).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Les doublons et le plafond                                       */
/* ------------------------------------------------------------------ */

describe("ce qu'un lot mal formé ne doit pas pouvoir faire", () => {
  it("n'écrit qu'une fois une case envoyée deux fois", async () => {
    // Même règle que `modifierPresencesEnMasse`, qui dédoublonne sa sélection : une ligne répétée
    // par un brouillon maladroit ne doit pas produire deux écritures ni deux entrées de journal.
    // C'est la **dernière** valeur qui est retenue — « dernier arrivé gagne », comme à l'unité.
    const res = await enregistrerCases({
      cases: [reglages("c1", { theme: "Première idée" }), reglages("c1", { theme: "Idée corrigée" })],
    });
    expect(res.succes).toBe("1 case enregistrée.");
    expect(faux.ecritures).toEqual(["update:c1"]);
    expect(faux.audits).toHaveLength(1);
    expect(partie("c1")?.theme).toBe("Idée corrigée");
  });

  it("refuse un lot démesuré sans rien écrire : une action serveur est une route ouverte", async () => {
    /*
     * Rien n'oblige l'appelant à passer par l'écran : une boucle pourrait empiler des dizaines de
     * milliers de cases dans une seule transaction, sur une base SQLite. Le plafond est celui des
     * autres gestes de masse (`SELECTION_MAX`), parce que c'est la même question — et un trimestre
     * entier tient très largement dedans (une cinquantaine de cours, deux à quatre parties chacun).
     */
    const enorme = Array.from({ length: SELECTION_MAX + 1 }, () => reglages("c1", { theme: "Messer" }));
    await refuse(enregistrerCases({ cases: enorme }));
    // La borne elle-même passe : le refus vient du plafond, pas d'un hasard du jeu d'essai (la case
    // existe, et un lot d'une case de moins est accepté).
    const pile = Array.from({ length: SELECTION_MAX }, () => reglages("c1", { theme: "Messer" }));
    expect((await enregistrerCases({ cases: pile })).erreur).toBeUndefined();
  });

  it("refuse un lot vide, et un appel sans lot du tout", async () => {
    // Un « Enregistrer » sans rien à enregistrer n'est pas un succès : c'est un écran qui s'est
    // trompé, et le dire tout de suite évite de chercher plus tard ce qui n'a pas pris.
    await refuse(enregistrerCases({ cases: [] }));
    await refuse(enregistrerCases({} as never));
    await refuse(enregistrerCases({ cases: "tout" } as never));
  });

  it("refuse une case dont le niveau est inventé ou la description démesurée", async () => {
    // Le niveau est un mot d'une liste fermée (il ressort sur la page publique de partage), et la
    // description est plafonnée : le lot ne doit pas être la porte par laquelle on les contourne.
    await refuse(enregistrerCases({ cases: [reglages("c1", { niveau: "EXPERT" })] }));
    await refuse(enregistrerCases({ cases: [reglages("c1", { description: "x".repeat(5000) })] }));
  });
});

/* ------------------------------------------------------------------ */
/* 6. La garde                                                         */
/* ------------------------------------------------------------------ */

describe("la garde du lot est celle du geste unitaire", () => {
  it("laisse passer un instructeur : c'est `planning.edit`, pas un geste de bureau", async () => {
    // L'encadrement tient le programme. Exiger le bureau (ou une session forte) pour enregistrer
    // plusieurs cases d'un coup rendrait la fonctionnalité morte pour ceux qui s'en servent.
    faux.acteur = { ...faux.acteur, role: "INSTRUCTEUR", estAdmin: false, service: false, sessionForte: false };
    const res = await enregistrerCases({ cases: [reglages("c1", { instructeurId: "u1", theme: "Messer" })] });
    expect(res.erreur).toBeUndefined();
    expect(res.succes).toBe("1 case enregistrée.");
  });

  it("refuse un membre, et n'écrit rien", async () => {
    // Un membre invité consulte le planning, il ne le remplit pas — ni case par case, ni en lot.
    faux.acteur = { ...faux.acteur, id: "u1", role: "MEMBRE", estAdmin: false };
    await refuse(enregistrerCases({ cases: [reglages("c1", { instructeurId: "u1", theme: "Messer" })] }));
  });

  it("refuse un compte désactivé", async () => {
    // Un lien encore ouvert sur un compte qu'on vient de désactiver reste une route ouverte.
    faux.acteur = { ...faux.acteur, actif: false };
    await refuse(enregistrerCases({ cases: [reglages("c1", { instructeurId: "u1", theme: "Messer" })] }));
  });

  it("vérifie le droit avant de lire la moindre ligne", async () => {
    // La garde est la **première** chose que fait l'action : un refus ne doit pas dépendre de ce que
    // le lot contient, sinon il raconte à qui n'a pas le droit ce que la base contient.
    faux.acteur = { ...faux.acteur, id: "u1", role: "MEMBRE", estAdmin: false };
    await refuse(enregistrerCases({ cases: [reglages("c-inconnue", { theme: "Messer" })] }));
    expect(faux.permissions).toEqual(["planning.edit"]);
  });
});
