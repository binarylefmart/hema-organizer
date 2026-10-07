import { beforeEach, describe, expect, it, vi } from "vitest";
import { libelleElement, type NatureElement } from "@/lib/constants";
import { placesDansPartie, rangementsParties, sequenceRangee } from "@/components/planning/rangement";

/**
 * **Les éléments d'une séance, rangés en parties** : on ajoute un échauffement, un
 * cours, une option ou un atelier dans une partie, on en retire, on les change de partie, on change
 * leur nature, et chacun peut porter un second instructeur — celui qui assiste.
 *
 * Ce fichier verrouille ce que ces cinq actions promettent et que rien à l'écran ne montrerait si
 * elles se brisaient :
 *
 * - **vider une case ne retire plus jamais la ligne** (l'ancien code la supprimait, et le programme
 *   perdait une partie sans que personne ne l'ait demandé) ;
 * - **`bloc` reste contigu à partir de 1 et `ordre` à partir de 0** après chaque écriture — retirer
 *   le dernier élément d'une partie la fait disparaître, et les suivantes se renumérotent ;
 * - **le `libelle` redit toujours la partie et le rang dans la nature** (« Partie 2 · Cours 2 ») : il
 *   ne se saisit plus, il se calcule, et `rangerParties` le remet d'accord à chaque écriture. Une
 *   colonne dérivée qui ne suit pas est pire qu'une colonne absente — l'API publique et les emails la
 *   lisent ;
 * - **retirer un élément qui porte un atelier rend l'atelier à la file d'attente** ;
 * - et les cinq passent par `planning.edit` : ce sont des routes ouvertes sur le réseau.
 */

type Partie = {
  id: string;
  sessionId: string;
  libelle: string;
  ordre: number;
  bloc: number;
  nature: NatureElement;
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

const faux = vi.hoisted(() => ({
  /*
   * **Un instructeur du bureau** : `role` ne vaut plus « ADMIN », et c'est le cas que l'ancien
   * modèle rendait impossible — celui qui remplit vraiment la grille *et* siège au bureau.
   * `planning.edit` reste un droit de l'encadrement : le supplément n'ajoute rien ici, il décrit.
   */
  acteur: { id: "u-admin", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true },
  /** Permission exigée par la dernière action appelée : la garde se vérifie, elle ne se suppose pas. */
  permissions: [] as string[],
  parties: [] as Partie[],
  statutPeriode: "ACTIVE",
  /** La séance est-elle annulée ? Une séance annulée verrouille son programme (`partiePourEcriture`). */
  annulee: false,
  /**
   * **Ce qu'un autre écrivain fait juste avant que notre transaction ne prenne la main** — un retrait
   * au même instant, typiquement. Un geste qui a lu la séance **hors** de la transaction ne le voit
   * pas, et écrit sur une lecture périmée.
   */
  avantTransaction: null as (() => void) | null,
  users: [{ id: "u1", actif: true, service: false }, { id: "u2", actif: true, service: false }, { id: "u-service", actif: true, service: true }],
  audits: [] as Array<{ action: string; cible: string | null; details: unknown }>,
  ateliers: [] as Array<{ id: string; titre: string; statut: string; sessionId: string | null; commentaireInstructeur: string | null; proposePar: { id: string; prenom: string; nom: string; email: string } }>,
  compteur: 0,
  /**
   * L'horloge des écritures : chaque `update` sans `updatedAt` explicite la fait avancer, comme le
   * `@updatedAt` de Prisma. C'est ce qui permet de distinguer une ligne **modifiée** d'une ligne
   * seulement **rangée** — la distinction que la bulle « Modifié par … le … » rend visible.
   */
  horloge: Date.parse("2026-09-30T20:14:00.000Z"),
}));

/** Le jour où quelqu'un a rempli les cases : l'horodatage que les voisines doivent garder. */
const REMPLI_LE = new Date("2026-09-12T18:30:00.000Z");

/** Le journal d'audit lit des noms, jamais des identifiants : le faux client doit donc en rendre. */
const NOMS: Record<string, { prenom: string; nom: string }> = {
  u1: { prenom: "Alice", nom: "Roy" },
  u2: { prenom: "Charlie", nom: "Sel" },
};
const nomFaux = (id: string | null) => (id ? NOMS[id] ?? { prenom: "Inconnu", nom: "Inconnu" } : null);

const partie = (id: string) => faux.parties.find((p) => p.id === id);

vi.mock("@/lib/db", () => {
  const client = {
    sessionPartie: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const p = partie(where.id);
        if (!p) return null;
        return {
          ...p,
          instructeur: nomFaux(p.instructeurId),
          instructeurSecond: nomFaux(p.instructeurSecondId),
          session: { id: p.sessionId, date: "2126-10-01", annulee: faux.annulee, period: { statut: faux.statutPeriode } },
        };
      }),
      findMany: vi.fn(async ({ where }: { where: { sessionId: string } }) => faux.parties.filter((p) => p.sessionId === where.sessionId).map((p) => ({ ...p }))),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const p = partie(where.id);
        if (!p) throw new Error("introuvable");
        return { ...p };
      }),
      findFirst: vi.fn(async ({ where }: { where: { atelierId: string } }) => faux.parties.find((p) => p.atelierId === where.atelierId) ?? null),
      create: vi.fn(async ({ data }: { data: Partial<Partie> }) => {
        const creee: Partie = {
          id: `c-${++faux.compteur}`,
          sessionId: data.sessionId!,
          libelle: data.libelle ?? "",
          ordre: data.ordre ?? 0,
          bloc: data.bloc ?? 1,
          nature: data.nature ?? "COURS",
          instructeurId: null,
          instructeurSecondId: null,
          theme: "",
          description: "",
          niveau: "INDIFFERENT",
          atelierId: null,
          modifieParId: data.modifieParId ?? null,
          updatedAt: new Date((faux.horloge += 60_000)),
        };
        faux.parties.push(creee);
        return { ...creee };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Partie> }) => {
        const p = partie(where.id);
        if (!p) throw new Error("introuvable");
        Object.assign(p, data);
        /*
         * **Le faux client imite `@updatedAt`, valeur explicite comprise.** Prisma pose l'instant de
         * l'écriture *sauf* si l'appelant donne lui-même `updatedAt` (vérifié sur SQLite) — et c'est
         * exactement ce dont `rangerParties` se sert pour ranger une séance sans repeindre la bulle
         * « Modifié par … le … » des cases qu'il renomme. Sans cette imitation, le test ne pourrait
         * pas distinguer les deux.
         */
        if (data.updatedAt === undefined) p.updatedAt = new Date((faux.horloge += 60_000));
        return { ...p, instructeur: nomFaux(p.instructeurId), instructeurSecond: nomFaux(p.instructeurSecondId) };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        faux.parties = faux.parties.filter((p) => p.id !== where.id);
        return {};
      }),
    },
    session: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, date: "2126-10-01", heureDebut: "19:00", lieu: "Gymnase", annulee: false, period: { statut: faux.statutPeriode } })),
    },
    atelier: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.ateliers.find((a) => a.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const a = faux.ateliers.find((x) => x.id === where.id)!;
        Object.assign(a, data);
        return { ...a, updatedAt: new Date(faux.horloge) };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; statut?: string }; data: Record<string, unknown> }) => {
        const vises = faux.ateliers.filter((a) => a.id === where.id && (where.statut === undefined || a.statut === where.statut));
        for (const a of vises) Object.assign(a, data);
        return { count: vises.length };
      }),
    },
    user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.users.find((u) => u.id === where.id) ?? null) },
  };
  const db = {
    ...client,
    /**
     * Les **deux** formes de `$transaction` : un tableau d'écritures (retrait, déplacement) et une
     * fonction qui reçoit le client (ajout). L'ajout a besoin de la seconde parce qu'il doit
     * **relire la séance dans** la transaction — sinon deux ajouts simultanés lisent la même
     * longueur et naissent au même rang.
     */
    $transaction: vi.fn(async (arg: unknown) => {
      const autre = faux.avantTransaction;
      faux.avantTransaction = null;
      autre?.();
      return typeof arg === "function" ? (arg as (c: typeof client) => Promise<unknown>)(client) : Promise.all(arg as Promise<unknown>[]);
    }),
  };
  return { db };
});

vi.mock("@/lib/auth/current-user", () => ({
  assertPermission: vi.fn(async (p: string) => {
    faux.permissions.push(p);
    return faux.acteur;
  }),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_u: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
/** `synchroniserSeance` a ses propres tests (`synchronisation-seance.test.ts`) : ici on compte les appels. */
const synchronisations = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/planning", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  synchroniserSeance: vi.fn(async (id: string) => {
    synchronisations.push(id);
  }),
  placerAtelier: vi.fn(async () => null),
}));
vi.mock("@/lib/notifications/ateliers", () => ({ notifierDecisionAtelier: vi.fn(async () => true) }));

const { ajouterPartie, changerNaturePartie, deplacerElement, deplacerPartie, enregistrerCase, retirerPartie } = await import("@/actions/planning");
const { db } = await import("@/lib/db");
const { PARTIES_PAR_SEANCE_MAX } = await import("@/lib/validation/gestion");

/** L'ordre lu comme la grille le lira : les libellés rangés par `ordre`. */
const rangee = () => [...faux.parties].sort((a, b) => a.ordre - b.ordre).map((p) => p.libelle);
/**
 * **Les éléments eux-mêmes, rangés.** Le libellé est une valeur *dérivée* de la place : la suite des
 * libellés ne dit pas quel élément a bougé. C'est l'identifiant qu'il faut lire pour juger un
 * déplacement, et le libellé pour juger le **nommage**.
 */
const ordreIds = () => [...faux.parties].sort((a, b) => a.ordre - b.ordre).map((p) => p.id);
/** Les rangs eux-mêmes : c'est la contiguïté qu'on surveille, pas seulement l'ordre apparent. */
const rangs = () => [...faux.parties].sort((a, b) => a.ordre - b.ordre).map((p) => p.ordre);
/** Les numéros de partie, dans l'ordre de lecture. */
const blocs = () => [...faux.parties].sort((a, b) => a.ordre - b.ordre).map((p) => p.bloc);
/**
 * Les éléments **réellement écrits** par la dernière action. `SessionPartie.updatedAt` est un
 * `@updatedAt` : chaque `update` repousse l'horodatage que la bulle « Modifié par … le … » affiche.
 * Une ligne qu'on n'a pas fait bouger ne doit donc pas figurer ici.
 */
const touchees = () => vi.mocked(db.sessionPartie.update).mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id);

function ligne(id: string, bloc: number, nature: NatureElement, ordre: number, libelle: string): Partie {
  return {
    id,
    sessionId: "s1",
    libelle,
    ordre,
    bloc,
    nature,
    instructeurId: null,
    instructeurSecondId: null,
    theme: "",
    description: "",
    niveau: "INDIFFERENT",
    atelierId: null,
    modifieParId: null,
    updatedAt: REMPLI_LE,
  };
}

/** Une séance **saine** : les éléments dans l'ordre de lecture, nommés comme le code les nomme. */
function poser(elements: Array<[number, NatureElement]>) {
  const places = placesDansPartie(elements.map(([bloc, nature]) => ({ bloc, nature })));
  const nbParties = new Set(elements.map(([bloc]) => bloc)).size;
  faux.parties = elements.map(([bloc, nature], i) => ligne(`c${i}`, bloc, nature, i, libelleElement(bloc, nature, places[i].rang, places[i].nombre, nbParties)));
}

/**
 * Poser des éléments **tels quels** — rangs troués ou en double, parties trouées, noms faux. C'est
 * l'état qu'une base abîmée peut avoir : il faut que l'application le répare, pas qu'elle le propage.
 */
function poserBrut(lignes: Array<[number, NatureElement, number, string]>) {
  faux.parties = lignes.map(([bloc, nature, ordre, libelle], i) => ligne(`c${i}`, bloc, nature, ordre, libelle));
}

/** La séance de départ : une option en parallèle du cours de la partie 1, puis deux parties d'un cours. */
const DEPART: Array<[number, NatureElement]> = [
  [1, "COURS"],
  [1, "OPTION"],
  [2, "COURS"],
  [3, "COURS"],
];

/** L'annuaire de départ, reposé à chaque cas : deux instructeurs et le compte du portail. */
const USERS_DEPART = [
  { id: "u1", actif: true, service: false },
  { id: "u2", actif: true, service: false },
  { id: "u-service", actif: true, service: true },
];

beforeEach(() => {
  faux.permissions = [];
  faux.audits = [];
  // Sans cette remise à neuf, un cas qui désactive quelqu'un l'emporte dans tous les suivants : les
  // quatre cas d'après tombaient sur « Cette personne n'existe plus » sans rien avoir demandé.
  faux.users = USERS_DEPART.map((u) => ({ ...u }));
  faux.statutPeriode = "ACTIVE";
  faux.annulee = false;
  faux.avantTransaction = null;
  faux.compteur = 0;
  faux.horloge = Date.parse("2026-09-30T20:14:00.000Z");
  poser(DEPART);
  faux.ateliers = [
    { id: "at-1", titre: "Lutte au sol", statut: "PROPOSE", sessionId: null, commentaireInstructeur: null, proposePar: { id: "u2", prenom: "Charlie", nom: "Sel", email: "b@ex.fr" } },
  ];
  vi.clearAllMocks();
});

describe("remplir et vider une case", () => {
  it("enregistre les deux instructeurs, le thème, la description et le niveau", async () => {
    const res = await enregistrerCase({
      partieId: "c0",
      instructeurId: "u1",
      instructeurSecondId: "u2",
      theme: "Messer",
      description: "Garde haute, trois passes lentes.",
      niveau: "DEBUTANT",
    });
    expect(res.succes).toBe("Enregistré");
    expect(partie("c0")).toMatchObject({
      instructeurId: "u1",
      instructeurSecondId: "u2",
      theme: "Messer",
      description: "Garde haute, trois passes lentes.",
      niveau: "DEBUTANT",
    });
  });

  /**
   * **La description est facultative et ne se réclame jamais.** Une grille déjà ouverte dans un
   * navigateur au moment du déploiement n'envoie pas encore ce champ : le refuser ferait perdre un
   * geste à quelqu'un qui n'a rien fait de mal (même raison que le niveau, `casePlanningSchema`).
   */
  it("accepte une case sans description du tout, et la tient pour vide", async () => {
    const res = await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "Messer", niveau: "INDIFFERENT" });
    expect(res.succes).toBe("Enregistré");
    expect(partie("c0")?.description).toBe("");
  });

  /**
   * **Une personne désactivée qu'on ne touche pas ne bloque pas la case**.
   *
   * Le défaut existait depuis toujours mais ne se voyait pas : la liste déroulante ne proposait plus
   * la personne désactivée, le champ retombait sur « ---------- », et le premier enregistrement
   * **effaçait son nom en silence**. Depuis que la liste retient qui est déjà posé
   * (`personnesPlanning`, paramètre `dejaPosees`), le nom s'affiche — et le refus « Cette personne
   * n'existe plus » se mettait alors à tomber sur une valeur qu'on ne modifiait pas, bloquant du
   * même coup le thème, le niveau et la description de cette case.
   *
   * L'exception ne couvre **que** « laisser en place ce qui est déjà écrit » : poser cette même
   * personne sur une autre case reste refusé, et c'est ce que le second cas vérifie.
   */
  it("laisse enregistrer le thème d'une case dont l'instructeur a été désactivé depuis", async () => {
    await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "Messer", niveau: "INDIFFERENT" });
    faux.users = faux.users.map((u) => (u.id === "u1" ? { ...u, actif: false } : u));
    const res = await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "Dague", niveau: "INDIFFERENT" });
    expect(res.succes).toBe("Enregistré");
    expect(partie("c0")).toMatchObject({ instructeurId: "u1", theme: "Dague" });
  });

  it("refuse malgré tout de POSER une personne désactivée sur une case où elle n'était pas", async () => {
    faux.users = faux.users.map((u) => (u.id === "u2" ? { ...u, actif: false } : u));
    const res = await enregistrerCase({ partieId: "c1", instructeurId: "u2", theme: "Messer", niveau: "INDIFFERENT" });
    expect(res.erreur).toBe("Cette personne n'existe plus.");
    expect(partie("c1")?.instructeurId).not.toBe("u2");
  });

  it("refuse une description au-delà du plafond annoncé, et l'accepte à la limite", async () => {
    const { PARTIE_DESCRIPTION_MAX } = await import("@/lib/constants");
    const trop = "a".repeat(PARTIE_DESCRIPTION_MAX + 1);
    expect((await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "Messer", description: trop, niveau: "INDIFFERENT" })).erreur).toBeTruthy();
    expect(partie("c0")?.description).toBe("");
    const pile = "a".repeat(PARTIE_DESCRIPTION_MAX);
    expect((await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "Messer", description: pile, niveau: "INDIFFERENT" })).succes).toBe("Enregistré");
    expect(partie("c0")?.description).toBe(pile);
  });

  it("journalise la description avant et après, comme les autres réglages de la case", async () => {
    await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "Messer", description: "Premier jet.", niveau: "INDIFFERENT" });
    await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "Messer", description: "Version corrigée.", niveau: "INDIFFERENT" });
    expect(faux.audits.at(-1)).toMatchObject({
      action: "planning.case",
      details: { avant: { description: "Premier jet." }, apres: { description: "Version corrigée." } },
    });
  });

  it("ne repart pas au serveur pour une description inchangée", async () => {
    await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "Messer", description: "Idem.", niveau: "INDIFFERENT" });
    const res = await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "Messer", description: "Idem.", niveau: "INDIFFERENT" });
    expect(res.succes).toBe("Rien à changer.");
  });

  it("sans thème, le niveau et la description sont vidés — la grille ne les montre qu'avec un thème", async () => {
    await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "", description: "Orpheline.", niveau: "AVANCE" });
    expect(partie("c0")).toMatchObject({ theme: "", description: "", niveau: "INDIFFERENT", instructeurId: "u1" });
  });

  it("effacer le thème emporte le niveau et la description déjà posés", async () => {
    await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "Messer", description: "Quelque chose.", niveau: "DEBUTANT" });
    await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "", description: "Quelque chose.", niveau: "DEBUTANT" });
    expect(partie("c0")).toMatchObject({ theme: "", description: "", niveau: "INDIFFERENT" });
  });

  it("**ne retire jamais la partie** quand on vide la case", async () => {
    await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "Messer", description: "Quelque chose.", niveau: "DEBUTANT" });
    await enregistrerCase({ partieId: "c0", instructeurId: "", instructeurSecondId: "", theme: "", description: "", niveau: "INDIFFERENT" });
    expect(rangee()).toHaveLength(4);
    expect(partie("c0")).toMatchObject({ theme: "", description: "", instructeurId: null, niveau: "INDIFFERENT" });
  });

  it("refuse la même personne pour mener et pour assister", async () => {
    const res = await enregistrerCase({ partieId: "c0", instructeurId: "u1", instructeurSecondId: "u1", theme: "", niveau: "INDIFFERENT" });
    expect(res.erreur).toMatch(/deux personnes différentes/);
  });

  it("**refuse un second instructeur sans premier** : la case serait occupée pour les uns, absente pour les autres", async () => {
    /*
     * L'écran l'interdit déjà, mais `enregistrerCase` est une action serveur — donc une route
     * ouverte. Sans ce refus, l'application se coupait en deux moitiés qui se contredisent :
     * `caseVide` et `partieLibrePourAtelier` tenaient la case pour **occupée** (aucun atelier ne
     * pouvait plus s'y poser), `synchroniserSeance` inscrivait la personne dans les instructeurs de
     * la séance (elle recevait le récap du soir et l'alerte « peu de monde »), et l'affichage, lui,
     * faisait **disparaître la ligne entière**. On ferme la porte plutôt que d'entretenir l'état.
     */
    const res = await enregistrerCase({ partieId: "c0", instructeurId: "", instructeurSecondId: "u2", theme: "Messer", niveau: "INDIFFERENT" });
    expect(res.erreur).toMatch(/qui mène/);
    expect(partie("c0")).toMatchObject({ instructeurId: null, instructeurSecondId: null });
  });

  it("laisse vider les deux d'un coup : c'est le premier seul qui est interdit d'absence", async () => {
    await enregistrerCase({ partieId: "c0", instructeurId: "u1", instructeurSecondId: "u2", theme: "Messer", niveau: "INDIFFERENT" });
    const res = await enregistrerCase({ partieId: "c0", instructeurId: "", instructeurSecondId: "", theme: "", niveau: "INDIFFERENT" });
    expect(res.succes).toBe("Enregistré");
    expect(partie("c0")).toMatchObject({ instructeurId: null, instructeurSecondId: null });
  });

  it("refuse le compte de service comme second instructeur", async () => {
    const res = await enregistrerCase({ partieId: "c0", instructeurId: "u1", instructeurSecondId: "u-service", theme: "", niveau: "INDIFFERENT" });
    expect(res.erreur).toMatch(/ne peut pas être instructeur/);
  });

  it("refuse d'écrire dans une période close", async () => {
    faux.statutPeriode = "CLOSE";
    const res = await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "Messer", niveau: "INDIFFERENT" });
    expect(res.erreur).toMatch(/close/);
  });
});

describe("ajouter un élément dans une partie", () => {
  it("ajoute un second cours dans une partie : les deux se numérotent, l'option reste derrière", async () => {
    const res = await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "COURS" });
    expect(res.succes).toBe("Cours ajouté.");
    expect(res.partieId).toBeTruthy();
    expect(rangee()).toEqual(["Partie 1 · Cours 1", "Partie 1 · Cours 2", "Partie 1 · Option", "Partie 2 · Cours", "Partie 3 · Cours"]);
    expect(rangs()).toEqual([0, 1, 2, 3, 4]);
    expect(partie(res.partieId!)).toMatchObject({ bloc: 1, nature: "COURS", libelle: "Partie 1 · Cours 2" });
  });

  it("pose un échauffement **devant** le cours de sa partie, quel que soit l'ordre d'ajout", async () => {
    const res = await ajouterPartie({ sessionId: "s1", bloc: 2, nature: "ECHAUFFEMENT" });
    expect(res.succes).toBe("Échauffement ajouté.");
    expect(rangee()).toEqual(["Partie 1 · Cours", "Partie 1 · Option", "Partie 2 · Échauffement", "Partie 2 · Cours", "Partie 3 · Cours"]);
  });

  it("pose l'élément à sa place par défaut — échauffement, cours, atelier, option — sans retrier les autres", async () => {
    // Partie 1 réordonnée à la main : l'option d'abord, puis le cours.
    poser([
      [1, "OPTION"],
      [1, "COURS"],
    ]);
    const cours = await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "COURS" });
    expect(ordreIds()).toEqual(["c0", "c1", cours.partieId]);
    const echauffement = await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "ECHAUFFEMENT" });
    expect(ordreIds()).toEqual([echauffement.partieId, "c0", "c1", cours.partieId]);
    expect(rangs()).toEqual([0, 1, 2, 3]);
    expect(rangee()).toEqual(["Échauffement", "Option", "Cours 1", "Cours 2"]);
  });

  it("ouvre une partie nouvelle à la fin (`nbParties + 1`), et ramène un numéro trop grand à celle-là", async () => {
    await ajouterPartie({ sessionId: "s1", bloc: 4, nature: "OPTION" });
    expect(rangee().at(-1)).toBe("Partie 4 · Option");
    const res = await ajouterPartie({ sessionId: "s1", bloc: 20, nature: "COURS" });
    expect(partie(res.partieId!)).toMatchObject({ bloc: 5, libelle: "Partie 5 · Cours" });
    expect(blocs()).toEqual([1, 1, 2, 3, 4, 5]);
  });

  it("refuse une partie hors bornes et une nature inconnue — le schéma, avant toute lecture", async () => {
    expect((await ajouterPartie({ sessionId: "s1", bloc: 0, nature: "COURS" })).erreur).toBeTruthy();
    expect((await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "SPARRING" as never })).erreur).toBeTruthy();
    expect(faux.parties).toHaveLength(4);
  });

  it("n'accepte **aucun libellé** venu du réseau : le nom se calcule, il ne s'envoie pas", async () => {
    const res = await ajouterPartie({ sessionId: "s1", bloc: 3, nature: "OPTION", libelle: "Choisi par le réseau" } as never);
    expect(partie(res.partieId!)).toMatchObject({ libelle: "Partie 3 · Option" });
  });

  it("**répare la séance** au lieu de propager des rangs troués ou une partie manquante", async () => {
    poserBrut([
      [1, "COURS", 3, "n'importe quoi"],
      [3, "COURS", 3, "Partie 3 · Cours"],
      [1, "OPTION", 0, "Option 1"],
    ]);
    await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "ECHAUFFEMENT" });
    expect(rangs()).toEqual([0, 1, 2, 3]);
    // L'ordre stocké de la partie 1 (l'option au rang 0, le cours au rang 3) est gardé : il est libre.
    // L'échauffement, lui, se pose en tête.
    expect(rangee()).toEqual(["Partie 1 · Échauffement", "Partie 1 · Option", "Partie 1 · Cours", "Partie 2 · Cours"]);
  });

  it("écrit l'ajout **et** le rangement dans une seule transaction", async () => {
    await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "COURS" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof vi.mocked(db.$transaction).mock.calls[0][0]).toBe("function");
  });

  it("refuse d'ajouter au-delà du plafond d'éléments d'une séance, et accepte le dernier", async () => {
    poser(Array.from({ length: PARTIES_PAR_SEANCE_MAX - 1 }, (_, i) => [i + 1, "COURS"] as [number, NatureElement]));
    expect((await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "COURS" })).succes).toBe("Cours ajouté.");
    const res = await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "COURS" });
    expect(res.erreur).toMatch(new RegExp(String(PARTIES_PAR_SEANCE_MAX)));
    expect(faux.parties).toHaveLength(PARTIES_PAR_SEANCE_MAX);
  });

  it("n'écrit que la ligne créée quand rien d'autre ne bouge (une partie nouvelle à la fin)", async () => {
    const res = await ajouterPartie({ sessionId: "s1", bloc: 4, nature: "COURS" });
    // La seule écriture de rangement est celle qui pose le nom de la ligne née ici.
    expect(touchees()).toEqual([res.partieId]);
  });

  it("renomme la voisine qui cesse d'être seule de sa nature, **sans** repeindre sa bulle", async () => {
    await ajouterPartie({ sessionId: "s1", bloc: 3, nature: "COURS" });
    expect(partie("c3")).toMatchObject({ libelle: "Partie 3 · Cours 1", updatedAt: REMPLI_LE });
    expect(touchees()).toContain("c3");
  });

  it("journalise l'ajout avec la partie et la nature", async () => {
    await ajouterPartie({ sessionId: "s1", bloc: 2, nature: "OPTION" });
    expect(faux.audits.at(-1)).toMatchObject({
      action: "planning.partie.ajout",
      details: { partie: "Partie 2 · Option", bloc: 2, nature: "OPTION" },
    });
  });
});

describe("ajouter un atelier en attente depuis le menu", () => {
  it("exige l'atelier : une nature ATELIER sans atelier est refusée", async () => {
    const res = await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "ATELIER" });
    expect(res.erreur).toBeTruthy();
    expect(faux.parties).toHaveLength(4);
  });

  it("crée l'élément Atelier, planifie l'atelier sur la séance et le place dans **cet** élément", async () => {
    const { placerAtelier } = await import("@/lib/planning");
    const { notifierDecisionAtelier } = await import("@/lib/notifications/ateliers");
    const res = await ajouterPartie({ sessionId: "s1", bloc: 2, nature: "ATELIER", atelierId: "at-1" });
    expect(res.succes).toMatch(/^Atelier placé/);
    expect(partie(res.partieId!)).toMatchObject({ bloc: 2, nature: "ATELIER", libelle: "Partie 2 · Atelier" });
    expect(faux.ateliers[0]).toMatchObject({ statut: "PLANIFIE", sessionId: "s1" });
    expect(placerAtelier).toHaveBeenCalledWith("at-1", "s1", "u-admin", res.partieId);
    expect(notifierDecisionAtelier).toHaveBeenCalledTimes(1);
    expect(faux.audits.map((a) => a.action)).toEqual(["atelier.decision", "planning.partie.ajout"]);
    expect(faux.audits[0].details).toMatchObject({ statut: "PLANIFIE", depuis: "planning" });
  });

  it("refuse un atelier qui n'est plus en attente, ou déjà dans une case — sans rien créer", async () => {
    faux.ateliers[0].statut = "PLANIFIE";
    expect((await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "ATELIER", atelierId: "at-1" })).erreur).toMatch(/plus en attente/);
    faux.ateliers[0].statut = "PROPOSE";
    partie("c1")!.atelierId = "at-1";
    expect((await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "ATELIER", atelierId: "at-1" })).erreur).toMatch(/plus en attente/);
    expect(faux.parties).toHaveLength(4);
    expect(faux.audits).toEqual([]);
  });

  it("refuse une séance passée, comme la grille et la file", async () => {
    vi.mocked(db.session.findUnique).mockImplementation((async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      date: "2000-01-01",
      heureDebut: "19:00",
      lieu: "Gymnase",
      annulee: false,
      period: { statut: faux.statutPeriode },
    })) as never);
    expect((await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "ATELIER", atelierId: "at-1" })).erreur).toMatch(/à venir/);
    expect(faux.parties).toHaveLength(4);
  });
});

describe("changer la nature d'un élément", () => {
  it("passe le cours seul d'une partie en option, dans sa partie", async () => {
    const res = await changerNaturePartie({ partieId: "c3", nature: "OPTION" });
    expect(res.succes).toBe("Passé en option.");
    expect(partie("c3")).toMatchObject({ bloc: 3, nature: "OPTION", libelle: "Partie 3 · Option" });
  });

  it("**garde la place** de l'élément, et numérote la partie", async () => {
    await changerNaturePartie({ partieId: "c0", nature: "OPTION" });
    expect(ordreIds()).toEqual(["c0", "c1", "c2", "c3"]);
    expect(rangs()).toEqual([0, 1, 2, 3]);
    expect(rangee()).toEqual(["Partie 1 · Option 1", "Partie 1 · Option 2", "Partie 2 · Cours", "Partie 3 · Cours"]);
  });

  it("garde la place même quand la nouvelle nature se poserait ailleurs par défaut", async () => {
    // L'option de la partie 1 devient un échauffement : par défaut, il irait en tête ; il reste second.
    await changerNaturePartie({ partieId: "c1", nature: "ECHAUFFEMENT" });
    expect(ordreIds()).toEqual(["c0", "c1", "c2", "c3"]);
    expect(rangee()).toEqual(["Partie 1 · Cours", "Partie 1 · Échauffement", "Partie 2 · Cours", "Partie 3 · Cours"]);
  });

  it("renomme la voisine **sans** repeindre sa bulle, et n'horodate que l'élément du clic", async () => {
    await changerNaturePartie({ partieId: "c0", nature: "OPTION" });
    expect(partie("c1")).toMatchObject({ libelle: "Partie 1 · Option 2", updatedAt: REMPLI_LE, modifieParId: null });
    expect(partie("c0")!.updatedAt.getTime()).toBeGreaterThan(REMPLI_LE.getTime());
    expect(partie("c0")?.modifieParId).toBe("u-admin");
  });

  it("ne fait rien — sans se plaindre — quand la nature demandée est déjà la bonne", async () => {
    const res = await changerNaturePartie({ partieId: "c1", nature: "OPTION" });
    expect(res.succes).toBe("Rien à changer.");
    expect(touchees()).toEqual([]);
  });

  it("refuse un élément qui porte un atelier, mais accepte un élément Atelier **vide**", async () => {
    Object.assign(partie("c1")!, { atelierId: "at-1", nature: "ATELIER" });
    expect((await changerNaturePartie({ partieId: "c1", nature: "COURS" })).erreur).toMatch(/déprogramme-le d'abord/);
    expect(touchees()).toEqual([]);
    partie("c1")!.atelierId = null;
    expect((await changerNaturePartie({ partieId: "c1", nature: "OPTION" })).succes).toBe("Passé en option.");
    expect(partie("c1")).toMatchObject({ nature: "OPTION", libelle: "Partie 1 · Option" });
  });

  it("ne laisse pas choisir « atelier » à la main : un atelier naît d'une proposition", async () => {
    expect((await changerNaturePartie({ partieId: "c0", nature: "ATELIER" as never })).erreur).toBeTruthy();
  });

  it("journalise le changement sous sa propre action, avec le nom et la nature d'avant et d'après", async () => {
    await changerNaturePartie({ partieId: "c2", nature: "ECHAUFFEMENT" });
    expect(faux.audits.at(-1)).toMatchObject({
      action: "planning.partie.nature",
      details: { bloc: 2, avant: { partie: "Partie 2 · Cours", nature: "COURS" }, apres: { partie: "Partie 2 · Échauffement", nature: "ECHAUFFEMENT" } },
    });
  });
});

describe("retirer un élément", () => {
  it("retirer le seul élément d'une partie la fait disparaître, et **renumérote** les suivantes", async () => {
    const res = await retirerPartie({ partieId: "c2" });
    expect(res.succes).toBe("Élément retiré.");
    expect(ordreIds()).toEqual(["c0", "c1", "c3"]);
    expect(blocs()).toEqual([1, 1, 2]);
    expect(rangee()).toEqual(["Partie 1 · Cours", "Partie 1 · Option", "Partie 2 · Cours"]);
    expect(rangs()).toEqual([0, 1, 2]);
    // Renommée parce que sa partie a changé de numéro — pas modifiée par quelqu'un.
    expect(partie("c3")?.updatedAt).toEqual(REMPLI_LE);
  });

  it("ne renomme rien quand l'élément retiré ne décale personne", async () => {
    await ajouterPartie({ sessionId: "s1", bloc: 4, nature: "COURS" });
    vi.clearAllMocks();
    await retirerPartie({ partieId: faux.parties.find((p) => p.bloc === 4)!.id });
    expect(touchees()).toEqual([]);
    expect(rangee()).toEqual(["Partie 1 · Cours", "Partie 1 · Option", "Partie 2 · Cours", "Partie 3 · Cours"]);
  });

  it("garde dans le journal **les cinq champs** que le retrait efface, avec la partie et la nature", async () => {
    Object.assign(partie("c2")!, {
      instructeurId: "u1",
      instructeurSecondId: "u2",
      theme: "Messer",
      description: "Garde haute, trois passes lentes, puis libre.",
      niveau: "DEBUTANT",
    });
    await retirerPartie({ partieId: "c2" });
    expect(faux.audits.at(-1)).toMatchObject({
      action: "planning.partie.retrait",
      details: {
        partie: "Partie 2 · Cours",
        bloc: 2,
        nature: "COURS",
        theme: "Messer",
        instructeur: "Alice Roy",
        instructeurSecond: "Charlie Sel",
        description: "Garde haute, trois passes lentes, puis libre.",
        niveau: "Débutant",
      },
    });
  });

  it("ne raconte rien d'une case vide : les champs y sont, vides, sans inventer de mot", async () => {
    await retirerPartie({ partieId: "c1" });
    expect(faux.audits.at(-1)?.details).toMatchObject({ theme: "", description: "", instructeur: null, instructeurSecond: null, niveau: "Indifférent" });
  });

  it("rend l'atelier d'un élément retiré à la file d'attente, et le journalise comme une décision", async () => {
    Object.assign(partie("c1")!, { atelierId: "at-1", nature: "ATELIER", theme: "Lutte au sol", instructeurId: "u2" });
    Object.assign(faux.ateliers[0], { statut: "PLANIFIE", sessionId: "s1" });
    const res = await retirerPartie({ partieId: "c1" });
    expect(res.succes).toMatch(/de retour en attente/);
    expect(faux.ateliers[0]).toMatchObject({ statut: "PROPOSE", sessionId: null });
    expect(partie("c1")).toBeUndefined();
    expect(faux.audits.map((a) => a.action)).toEqual(["atelier.decision", "planning.partie.retrait"]);
    expect(faux.audits[0]).toMatchObject({ cible: "at-1", details: { statut: "PROPOSE", depuis: "planning" } });
    expect(faux.audits[1].details).toMatchObject({ atelier: "Lutte au sol", nature: "ATELIER" });
  });
});

describe("changer un élément de partie", () => {
  it("descend un cours dans la partie suivante : il se pose après le cours qui y était, les deux se numérotent", async () => {
    const res = await deplacerPartie({ partieId: "c0", versBloc: 2 });
    expect(res.succes).toBe("Élément déplacé.");
    expect(ordreIds()).toEqual(["c1", "c2", "c0", "c3"]);
    expect(rangee()).toEqual(["Partie 1 · Option", "Partie 2 · Cours 1", "Partie 2 · Cours 2", "Partie 3 · Cours"]);
    expect(rangs()).toEqual([0, 1, 2, 3]);
  });

  it("monte l'élément seul d'une partie : la partie vidée disparaît, les suivantes se renumérotent", async () => {
    await deplacerPartie({ partieId: "c2", versBloc: 1 });
    expect(blocs()).toEqual([1, 1, 1, 2]);
    expect(rangee()).toEqual(["Partie 1 · Cours 1", "Partie 1 · Cours 2", "Partie 1 · Option", "Partie 2 · Cours"]);
  });

  it("descend vers une partie nouvelle à la fin (`nbParties + 1`)", async () => {
    await deplacerPartie({ partieId: "c1", versBloc: 4 });
    expect(rangee()).toEqual(["Partie 1 · Cours", "Partie 2 · Cours", "Partie 3 · Cours", "Partie 4 · Option"]);
  });

  it("ne fait rien — sans se plaindre — quand le résultat rangé est le même", async () => {
    // Monter depuis la partie 1 (le bouton envoie 0), ou rester où l'on est.
    expect((await deplacerPartie({ partieId: "c0", versBloc: 0 })).succes).toBe("Rien à changer.");
    expect((await deplacerPartie({ partieId: "c0", versBloc: 1 })).succes).toBe("Rien à changer.");
    // L'élément **seul** de la dernière partie « descendu » vers une partie nouvelle y retombe.
    expect((await deplacerPartie({ partieId: "c3", versBloc: 4 })).succes).toBe("Rien à changer.");
    expect(touchees()).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("pose l'élément à sa place par défaut dans la partie d'arrivée : un échauffement en tête", async () => {
    poser([
      [1, "ECHAUFFEMENT"],
      [1, "COURS"],
      [2, "COURS"],
      [2, "OPTION"],
    ]);
    await deplacerPartie({ partieId: "c0", versBloc: 2 });
    expect(ordreIds()).toEqual(["c1", "c0", "c2", "c3"]);
    expect(rangee()).toEqual(["Partie 1 · Cours", "Partie 2 · Échauffement", "Partie 2 · Cours", "Partie 2 · Option"]);
  });

  it("une option qui change de partie se pose après l'atelier, en fin de partie", async () => {
    poser([
      [1, "COURS"],
      [1, "OPTION"],
      [2, "COURS"],
      [2, "ATELIER"],
    ]);
    await deplacerPartie({ partieId: "c1", versBloc: 2 });
    expect(ordreIds()).toEqual(["c0", "c2", "c3", "c1"]);
    expect(rangs()).toEqual([0, 1, 2, 3]);
  });

  it("ramène un numéro hors de la séance à la partie nouvelle plutôt que de refuser", async () => {
    await deplacerPartie({ partieId: "c0", versBloc: PARTIES_PAR_SEANCE_MAX + 1 });
    expect(partie("c0")).toMatchObject({ bloc: 4, libelle: "Partie 4 · Cours" });
  });

  it("refuse en revanche un numéro qui n'est plus un déplacement", async () => {
    expect((await deplacerPartie({ partieId: "c0", versBloc: -1 })).erreur).toBeTruthy();
    expect((await deplacerPartie({ partieId: "c0", versBloc: PARTIES_PAR_SEANCE_MAX + 2 })).erreur).toBeTruthy();
    expect(touchees()).toEqual([]);
  });

  it("n'écrit que les lignes qui changent, et ne repeint la bulle de personne", async () => {
    await deplacerPartie({ partieId: "c1", versBloc: 2 });
    // L'option change de partie et de nom ; le cours de la partie 2 avance d'un rang (l'option ne
    // le précède plus) — et la partie 1 et la partie 3 ne sont pas touchées.
    expect(new Set(touchees())).toEqual(new Set(["c1", "c2"]));
    expect(rangee()).toEqual(["Partie 1 · Cours", "Partie 2 · Cours", "Partie 2 · Option", "Partie 3 · Cours"]);
    for (const p of faux.parties) expect(p.updatedAt).toEqual(REMPLI_LE);
  });

  it("journalise d'où à où, avec la nature — et le numéro demandé à part du numéro rangé", async () => {
    // La partie 2 n'a qu'un cours : elle se vide, la partie 3 devient la 2, et la « partie 4 »
    // demandée devient la 3 une fois rangée. Les deux numéros se lisent, chacun sous son nom.
    await deplacerPartie({ partieId: "c2", versBloc: 4 });
    expect(faux.audits.at(-1)).toMatchObject({
      action: "planning.partie.ordre",
      details: { partie: "Partie 2 · Cours", nature: "COURS", partieDepart: 2, versDemande: 4, partieArrivee: 3 },
    });
    expect(faux.audits.at(-1)?.details).not.toHaveProperty("de");
    expect(faux.audits.at(-1)?.details).not.toHaveProperty("vers");
  });
});

describe("poser un élément à une place précise", () => {
  /** Une partie de trois éléments, puis une partie d'un cours : de quoi glisser dans tous les sens. */
  beforeEach(() =>
    poser([
      [1, "ECHAUFFEMENT"],
      [1, "COURS"],
      [1, "OPTION"],
      [2, "COURS"],
    ]),
  );

  it("inverse deux éléments d'une partie : l'option passe au-dessus du cours", async () => {
    const res = await deplacerElement({ partieId: "c2", versBloc: 1, avantId: "c1" });
    expect(res.succes).toBe("Élément déplacé.");
    expect(ordreIds()).toEqual(["c0", "c2", "c1", "c3"]);
    expect(rangs()).toEqual([0, 1, 2, 3]);
    expect(rangee()).toEqual(["Partie 1 · Échauffement", "Partie 1 · Option", "Partie 1 · Cours", "Partie 2 · Cours"]);
  });

  it("pose en tête, et en fin de partie quand rien n'est visé", async () => {
    await deplacerElement({ partieId: "c2", versBloc: 1, avantId: "c0" });
    expect(ordreIds()).toEqual(["c2", "c0", "c1", "c3"]);
    await deplacerElement({ partieId: "c2", versBloc: 1, avantId: null });
    expect(ordreIds()).toEqual(["c0", "c1", "c2", "c3"]);
  });

  it("change de partie à la place visée, et ouvre une partie nouvelle (`nbParties + 1`)", async () => {
    await deplacerElement({ partieId: "c0", versBloc: 2, avantId: "c3" });
    expect(ordreIds()).toEqual(["c1", "c2", "c0", "c3"]);
    expect(blocs()).toEqual([1, 1, 2, 2]);
    await deplacerElement({ partieId: "c1", versBloc: 3, avantId: null });
    expect(rangee()).toEqual(["Partie 1 · Option", "Partie 2 · Échauffement", "Partie 2 · Cours", "Partie 3 · Cours"]);
  });

  it("ne fait rien — sans se plaindre — quand le résultat rangé est le même", async () => {
    expect((await deplacerElement({ partieId: "c1", versBloc: 1, avantId: "c2" })).succes).toBe("Rien à changer.");
    expect((await deplacerElement({ partieId: "c1", versBloc: 1, avantId: "c1" })).succes).toBe("Rien à changer.");
    expect((await deplacerElement({ partieId: "c3", versBloc: 2, avantId: null })).succes).toBe("Rien à changer.");
    // L'élément seul de la dernière partie « posé » dans une partie nouvelle y retombe.
    expect((await deplacerElement({ partieId: "c3", versBloc: 3, avantId: null })).succes).toBe("Rien à changer.");
    expect(touchees()).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("refuse un voisin d'une autre partie, d'une autre séance, ou disparu — sans rien écrire", async () => {
    faux.parties.push({ ...ligne("x0", 1, "COURS", 0, "Cours"), sessionId: "s2" });
    expect((await deplacerElement({ partieId: "c2", versBloc: 2, avantId: "c1" })).erreur).toMatch(/n'existe plus/);
    expect((await deplacerElement({ partieId: "c2", versBloc: 1, avantId: "x0" })).erreur).toMatch(/n'existe plus/);
    expect((await deplacerElement({ partieId: "c2", versBloc: 1, avantId: "disparu" })).erreur).toMatch(/n'existe plus/);
    // Une partie nouvelle est vide : rien ne peut s'y trouver « avant ».
    expect((await deplacerElement({ partieId: "c2", versBloc: 3, avantId: "c3" })).erreur).toMatch(/n'existe plus/);
    expect(touchees()).toEqual([]);
  });

  it("refuse une partie hors bornes — zéro compris — par le schéma", async () => {
    expect((await deplacerElement({ partieId: "c0", versBloc: 0, avantId: null })).erreur).toBeTruthy();
    expect((await deplacerElement({ partieId: "c0", versBloc: PARTIES_PAR_SEANCE_MAX + 2, avantId: null })).erreur).toBeTruthy();
    expect((await deplacerElement({ partieId: "c0", versBloc: 1, avantId: 3 as never })).erreur).toBeTruthy();
    expect(touchees()).toEqual([]);
  });

  it("n'écrit que les lignes qui changent, et ne repeint la bulle de personne", async () => {
    await deplacerElement({ partieId: "c2", versBloc: 1, avantId: "c1" });
    expect(new Set(touchees())).toEqual(new Set(["c1", "c2"]));
    for (const p of faux.parties) expect(p.updatedAt).toEqual(REMPLI_LE);
  });

  it("passe par planning.edit, refuse une période close, et resynchronise la séance", async () => {
    synchronisations.length = 0;
    await deplacerElement({ partieId: "c2", versBloc: 1, avantId: "c1" });
    expect(faux.permissions).toEqual(["planning.edit"]);
    expect(synchronisations).toEqual(["s1"]);
    faux.statutPeriode = "CLOSE";
    vi.clearAllMocks();
    expect((await deplacerElement({ partieId: "c1", versBloc: 1, avantId: "c0" })).erreur).toMatch(/close/);
    expect(touchees()).toEqual([]);
  });

  it("journalise sous la même action que ↑ ↓, avec d'où à où et la place d'arrivée", async () => {
    await deplacerElement({ partieId: "c0", versBloc: 2, avantId: null });
    expect(faux.audits).toEqual([
      {
        action: "planning.partie.ordre",
        cible: "s1",
        details: {
          date: "2126-10-01",
          partie: "Partie 1 · Échauffement",
          bloc: 1,
          nature: "ECHAUFFEMENT",
          partieDepart: 1,
          versDemande: 2,
          partieArrivee: 2,
          position: 2,
        },
      },
    ]);
  });
});

describe("les déplacements lisent et écrivent dans une seule transaction", () => {
  it("refusent une séance annulée, sans rien écrire", async () => {
    faux.annulee = true;
    expect((await deplacerPartie({ partieId: "c0", versBloc: 2 })).erreur).toMatch(/annulée/);
    expect((await deplacerElement({ partieId: "c1", versBloc: 1, avantId: "c0" })).erreur).toMatch(/annulée/);
    expect((await deplacerElement({ partieId: "c1", versBloc: 1, avantId: "c1" })).erreur).toMatch(/annulée/);
    expect(touchees()).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("voient un retrait arrivé juste avant eux, et le disent au lieu d'écrire sur une lecture périmée", async () => {
    const retirer = (id: string) => () => {
      faux.parties = faux.parties.filter((p) => p.id !== id);
    };
    faux.avantTransaction = retirer("c0");
    expect((await deplacerPartie({ partieId: "c0", versBloc: 2 })).erreur).toBe("Cette partie n'existe plus.");
    faux.avantTransaction = retirer("c1");
    expect((await deplacerElement({ partieId: "c1", versBloc: 2, avantId: null })).erreur).toBe("Cette partie n'existe plus.");
    expect(touchees()).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("une ligne disparue pendant l'écriture (P2025) donne une phrase, pas une exception", async () => {
    vi.mocked(db.sessionPartie.update).mockImplementationOnce((async () => {
      throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
    }) as never);
    const res = await deplacerElement({ partieId: "c2", versBloc: 1, avantId: "c0" });
    expect(res.erreur).toMatch(/changé entre-temps/);
    expect(faux.audits).toEqual([]);
  });
});

describe("la garde des actions", () => {
  it("toutes passent par planning.edit", async () => {
    faux.permissions = [];
    await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "", niveau: "INDIFFERENT" });
    await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "COURS" });
    await changerNaturePartie({ partieId: "c0", nature: "OPTION" });
    await deplacerPartie({ partieId: "c0", versBloc: 2 });
    await retirerPartie({ partieId: "c0" });
    expect(faux.permissions).toEqual(["planning.edit", "planning.edit", "planning.edit", "planning.edit", "planning.edit"]);
  });

  it("un élément qui n'existe plus ne fait rien écrire", async () => {
    for (const res of [
      await enregistrerCase({ partieId: "inconnu", instructeurId: "", theme: "", niveau: "INDIFFERENT" }),
      await changerNaturePartie({ partieId: "inconnu", nature: "OPTION" }),
      await deplacerPartie({ partieId: "inconnu", versBloc: 1 }),
      await retirerPartie({ partieId: "inconnu" }),
    ]) {
      expect(res.erreur).toBe("Cette partie n'existe plus.");
    }
    expect(rangee()).toHaveLength(4);
  });

  it("chacune resynchronise la séance : disciplines et encadrants suivent toujours les cases", async () => {
    synchronisations.length = 0;
    await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "Messer", niveau: "INDIFFERENT" });
    await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "COURS" });
    await changerNaturePartie({ partieId: "c0", nature: "OPTION" });
    await deplacerPartie({ partieId: "c0", versBloc: 2 });
    await retirerPartie({ partieId: "c0" });
    expect(synchronisations).toEqual(["s1", "s1", "s1", "s1", "s1"]);
  });

  it("journalise chaque geste sous sa propre action", async () => {
    await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "COURS" });
    await changerNaturePartie({ partieId: "c0", nature: "OPTION" });
    await deplacerPartie({ partieId: "c0", versBloc: 2 });
    await retirerPartie({ partieId: "c0" });
    expect(faux.audits.map((a) => a.action)).toEqual([
      "planning.partie.ajout",
      "planning.partie.nature",
      "planning.partie.ordre",
      "planning.partie.retrait",
    ]);
  });

  it("refuse chaque geste dans une période close", async () => {
    faux.statutPeriode = "CLOSE";
    expect((await changerNaturePartie({ partieId: "c0", nature: "OPTION" })).erreur).toMatch(/close/);
    expect((await deplacerPartie({ partieId: "c0", versBloc: 2 })).erreur).toMatch(/close/);
    expect((await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "COURS" })).erreur).toMatch(/close/);
    expect(touchees()).toEqual([]);
  });
});

/**
 * **Les trois invariants tiennent après n'importe quelle suite de gestes** : parties contiguës à
 * partir de 1, rangs contigus à partir de 0 dans l'ordre de lecture, libellés d'accord. Ce qui compte
 * n'est pas qu'un geste isolé soit juste, c'est que la colonne le soit encore après une suite de
 * gestes — c'est elle que lisent l'API publique, les emails et les embeds.
 */
describe("la séance reste rangée, quoi qu'on lui fasse", () => {
  /** La règle elle-même ne trouve plus rien à corriger : c'est la définition d'une séance rangée. */
  const rangeeSelonLaRegle = () => {
    expect(rangementsParties(faux.parties)).toEqual([]);
    expect(ordreIds()).toEqual(sequenceRangee(faux.parties));
    expect(rangs()).toEqual(faux.parties.map((_, i) => i));
    const presents = [...new Set(blocs())];
    expect(presents).toEqual(presents.map((_, i) => i + 1));
  };

  it("après n'importe quelle suite d'ajouts, de retraits, de déplacements et de changements de nature", async () => {
    await ajouterPartie({ sessionId: "s1", bloc: 2, nature: "OPTION" });
    await deplacerPartie({ partieId: "c3", versBloc: 1 });
    await changerNaturePartie({ partieId: "c0", nature: "ECHAUFFEMENT" });
    await retirerPartie({ partieId: "c2" });
    await ajouterPartie({ sessionId: "s1", bloc: 9, nature: "COURS" });
    await deplacerPartie({ partieId: "c1", versBloc: 3 });
    await changerNaturePartie({ partieId: "c1", nature: "COURS" });
    rangeeSelonLaRegle();
  });

  it("y compris au départ d'une séance abîmée (parties trouées, rangs en double, noms faux)", async () => {
    poserBrut([
      [2, "OPTION", 1, "Option 2"],
      [5, "COURS", 1, "Cours 2"],
      [2, "COURS", 5, "Option 1"],
    ]);
    await ajouterPartie({ sessionId: "s1", bloc: 1, nature: "ECHAUFFEMENT" });
    rangeeSelonLaRegle();
    // Les parties 2 et 5 deviennent 2 et 3 derrière la partie 1 née ici ; dans la partie 2, l'option
    // garde sa place devant le cours (rang 1 contre 5) : l'ordre d'une partie est libre.
    expect(rangee()).toEqual(["Partie 1 · Échauffement", "Partie 2 · Option", "Partie 2 · Cours", "Partie 3 · Cours"]);
  });
});
