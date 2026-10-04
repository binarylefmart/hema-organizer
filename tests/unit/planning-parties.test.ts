import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Les parties d'une séance sont devenues des données** : on en ajoute, on en retire, on les
 * monte, on les descend, on change leur nature, et chacune peut porter un second instructeur —
 * celui qui assiste.
 *
 * Ce fichier verrouille ce que ces cinq actions promettent et que rien à l'écran ne montrerait si
 * elles se brisaient :
 *
 * - **vider une case ne retire plus jamais la ligne** (l'ancien code la supprimait, et le programme
 *   perdait une partie sans que personne ne l'ait demandé) ;
 * - **`ordre` reste contigu à partir de 0** après chaque écriture — un trou finirait par décider de
 *   l'affichage à la place de l'équipe ;
 * - **le `libelle` redit toujours le rang dans la nature** : il ne se saisit plus, il se calcule,
 *   et `rangerParties` le remet d'accord à chaque écriture. Une colonne dérivée qui ne suit pas est
 *   pire qu'une colonne absente — l'API publique et les emails la lisent ;
 * - **un atelier programmé barre le retrait** de sa partie ;
 * - et les cinq passent par `planning.edit` : ce sont des routes ouvertes sur le réseau.
 */

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
  users: [{ id: "u1", actif: true, service: false }, { id: "u2", actif: true, service: false }, { id: "u-service", actif: true, service: true }],
  audits: [] as Array<{ action: string; cible: string | null; details: unknown }>,
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
          session: { id: p.sessionId, date: "2126-10-01", period: { statut: faux.statutPeriode } },
        };
      }),
      findMany: vi.fn(async ({ where }: { where: { sessionId: string } }) => faux.parties.filter((p) => p.sessionId === where.sessionId).map((p) => ({ ...p }))),
      create: vi.fn(async ({ data }: { data: Partial<Partie> }) => {
        const creee: Partie = {
          id: `c-${++faux.compteur}`,
          sessionId: data.sessionId!,
          libelle: data.libelle ?? "",
          ordre: data.ordre ?? 0,
          estOption: data.estOption ?? false,
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
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, date: "2126-10-01", period: { statut: faux.statutPeriode } })),
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
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === "function" ? (arg as (c: typeof client) => Promise<unknown>)(client) : Promise.all(arg as Promise<unknown>[]),
    ),
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

const { ajouterPartie, changerNaturePartie, deplacerPartie, enregistrerCase, retirerPartie } = await import("@/actions/planning");
const { db } = await import("@/lib/db");
const { PARTIES_PAR_SEANCE_MAX } = await import("@/lib/validation/gestion");

/** L'ordre lu comme la grille le lira : les libellés rangés par `ordre`. */
const rangee = () => [...faux.parties].sort((a, b) => a.ordre - b.ordre).map((p) => p.libelle);
/**
 * **Les parties elles-mêmes, rangées.** Depuis que le libellé est une valeur *dérivée* du rang, la
 * suite des libellés ne dit plus quelle partie a bougé : descendre « Cours 1 » sous « Cours 2 » rend
 * exactement la même suite de noms, échangés. C'est donc l'identifiant qu'il faut lire pour juger un
 * déplacement, et le libellé pour juger le **nommage**.
 */
const ordreIds = () => [...faux.parties].sort((a, b) => a.ordre - b.ordre).map((p) => p.id);
/** Les rangs eux-mêmes : c'est la contiguïté qu'on surveille, pas seulement l'ordre apparent. */
const rangs = () => [...faux.parties].sort((a, b) => a.ordre - b.ordre).map((p) => p.ordre);
/**
 * Les parties **réellement écrites** par la dernière action. `SessionPartie.updatedAt` est un
 * `@updatedAt` : chaque `update` repousse l'horodatage que la bulle « Modifié par … le … » affiche.
 * Une ligne qu'on n'a pas fait bouger ne doit donc pas figurer ici.
 */
const touchees = () => vi.mocked(db.sessionPartie.update).mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id);

/**
 * Poser des parties **avec leurs rangs tels quels** — y compris troués ou en double. C'est l'état
 * qu'une séance partiellement remplie pouvait avoir en sortant de la migration : il faut que
 * l'application le répare, pas qu'elle le propage.
 */
/** La nature se lit dans le libellé du jeu d'essai : « Option 2 » est une option, « Cours 2 » non. */
const optionDe = (libelle: string) => libelle.toLowerCase().startsWith("option");

function ligne(libelle: string, ordre: number, id: string): Partie {
  return {
    id,
    sessionId: "s1",
    libelle,
    ordre,
    estOption: optionDe(libelle),
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

function poserRangs(lignes: Array<[string, number]>) {
  faux.parties = lignes.map(([libelle, ordre], i) => ligne(libelle, ordre, `c${i}`));
}

function poser(libelles: string[]) {
  faux.parties = libelles.map((libelle, ordre) => ligne(libelle, ordre, `c${ordre}`));
}

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
  faux.compteur = 0;
  faux.horloge = Date.parse("2026-09-30T20:14:00.000Z");
  poser(["Cours 1", "Cours 2", "Option 1", "Option 2"]);
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
    expect((await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "", description: trop, niveau: "INDIFFERENT" })).erreur).toBeTruthy();
    expect(partie("c0")?.description).toBe("");
    const pile = "a".repeat(PARTIE_DESCRIPTION_MAX);
    expect((await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "", description: pile, niveau: "INDIFFERENT" })).succes).toBe("Enregistré");
    expect(partie("c0")?.description).toBe(pile);
  });

  it("journalise la description avant et après, comme les autres réglages de la case", async () => {
    await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "", description: "Premier jet.", niveau: "INDIFFERENT" });
    await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "", description: "Version corrigée.", niveau: "INDIFFERENT" });
    expect(faux.audits.at(-1)).toMatchObject({
      action: "planning.case",
      details: { avant: { description: "Premier jet." }, apres: { description: "Version corrigée." } },
    });
  });

  it("ne repart pas au serveur pour une description inchangée", async () => {
    await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "", description: "Idem.", niveau: "INDIFFERENT" });
    const res = await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "", description: "Idem.", niveau: "INDIFFERENT" });
    expect(res.succes).toBe("Rien à changer.");
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

describe("ajouter, changer de nature, retirer", () => {
  /**
   * **Un cours ajouté va en queue de SA série, donc devant les options**.
   *
   * Ce test attendait « Cours 1, Cours 2, Option 1, Option 2, **Cours 3** » : il encodait un défaut.
   * `ajouterPartie` ne rangeait que les lignes **existantes** et laissait la nouvelle à son rang
   * provisoire — la dernière place de la séance. L'invariant « les cours d'abord, les options ensuite »
   * était donc faux juste après un ajout, et tous les lecteurs trient sur `ordre` seul : la grille, la
   * fiche, la carte de l'accueil, l'objet de l'email du soir, les embeds des salons et l'API publique
   * affichaient « Cours 3 » derrière « Option 2 » — exactement ce que la demande du 30/09 au matin
   * voulait supprimer. L'état se réparait au premier autre geste sur la séance, ce qui explique qu'il
   * soit passé inaperçu.
   */
  it("ajoute un cours en queue de sa série — donc **devant les options**", async () => {
    const res = await ajouterPartie({ sessionId: "s1", estOption: false });
    expect(res.succes).toBe("Cours ajouté.");
    expect(res.partieId).toBeTruthy();
    expect(rangee()).toEqual(["Cours 1", "Cours 2", "Cours 3", "Option 1", "Option 2"]);
    expect(rangs()).toEqual([0, 1, 2, 3, 4]);
  });

  it("ajoute une option sous le nom de la série des options", async () => {
    const res = await ajouterPartie({ sessionId: "s1", estOption: true });
    expect(res.succes).toBe("Option ajoutée.");
    expect(rangee()).toEqual(["Cours 1", "Cours 2", "Option 1", "Option 2", "Option 3"]);
  });

  it("n'accepte **aucun libellé** venu du réseau : le nom se calcule, il ne s'envoie pas", async () => {
    // Une requête forgée qui glisserait un `libelle` ne doit pas pouvoir nommer une partie
    // « Promotions » : Zod ignore la clé inconnue, et le rang décide seul.
    // On lit **la partie créée** et non la dernière ligne : depuis que le rangement place un cours
    // devant les options, « en queue de la séance » et « la nouvelle » ne sont plus la même ligne.
    const res = await ajouterPartie({ sessionId: "s1", libelle: "Choisi par le réseau" } as never);
    expect(partie(res.partieId!)).toMatchObject({ libelle: "Cours 3" });
  });

  it("**répare les rangs de la séance** au lieu de propager un trou hérité de la migration", async () => {
    // Une séance qui n'avait que ses deux options : la migration du 29/09 la laissait en 1, 1.
    poserRangs([["Option 1", 1], ["Option 2", 1]]);
    await ajouterPartie({ sessionId: "s1" });
    expect(rangs()).toEqual([0, 1, 2]);
  });

  it("écrit l'ajout **et** le rangement dans une seule transaction", async () => {
    // Sinon une lecture concurrente verrait la séance à moitié rangée — et deux ajouts
    // simultanés (deux instructeurs, ou un double clic) naîtraient au même rang.
    await ajouterPartie({ sessionId: "s1" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof vi.mocked(db.$transaction).mock.calls[0][0]).toBe("function");
  });

  it("refuse d'ajouter au-delà du plafond de parties d'une séance", async () => {
    poser(Array.from({ length: PARTIES_PAR_SEANCE_MAX }, (_, i) => `Cours ${i + 1}`));
    const res = await ajouterPartie({ sessionId: "s1" });
    expect(res.erreur).toMatch(new RegExp(String(PARTIES_PAR_SEANCE_MAX)));
    expect(faux.parties).toHaveLength(PARTIES_PAR_SEANCE_MAX);
  });

  it("accepte le dernier rang sous le plafond", async () => {
    poser(Array.from({ length: PARTIES_PAR_SEANCE_MAX - 1 }, (_, i) => `Cours ${i + 1}`));
    expect((await ajouterPartie({ sessionId: "s1" })).succes).toBe("Cours ajouté.");
    expect(rangs()).toEqual(Array.from({ length: PARTIES_PAR_SEANCE_MAX }, (_, i) => i));
  });

  /**
   * **L'invariant « aucune écriture inutile » se vérifie sur le geste qui ne décale rien.**
   *
   * `SessionPartie.updatedAt` est un `@updatedAt` et la grille l'affiche dans la bulle « Modifié par …
   * le … » : réécrire une ligne que rien ne concerne ferait dire à sa case que la personne qui l'a
   * remplie la semaine dernière y est revenue à l'instant. Ajouter une **option** la met en queue de la
   * séance entière : aucun rang, aucun nom existant ne bouge, donc aucune écriture.
   *
   * Ce test portait sur l'ajout d'un **cours**, du temps où la nouvelle ligne restait en queue. Elle
   * passe maintenant devant les options, qui se décalent donc réellement d'un rang — et doivent être
   * écrites. L'invariant n'a pas changé ; c'est le cas d'épreuve qui devait changer, et le cas voisin
   * ci-dessous garde l'autre moitié : ce décalage-là est **nécessaire**, et limité aux options.
   */
  it("n'écrit rien d'autre que la ligne créée quand rien ne se décale (ajout d'une option)", async () => {
    await ajouterPartie({ sessionId: "s1", estOption: true });
    expect(touchees()).toEqual([]);
  });

  it("ajouter un cours ne décale **que** les options, et pas les cours qui le précèdent", async () => {
    await ajouterPartie({ sessionId: "s1", estOption: false });
    // Les deux options reculent d'un rang ; les deux premiers cours ne sont pas touchés.
    expect(touchees().sort()).toEqual(["c-1", "c2", "c3"].sort());
  });

  it("change la nature d'une partie, et les **deux séries** se renumérotent", async () => {
    const res = await changerNaturePartie({ partieId: "c2", estOption: false });
    expect(res.succes).toBe("Partie passée en cours.");
    // « Option 1 » devient le 3e cours (elle reste à sa place, ordre 2), et « Option 2 » devient la
    // 1ère option de la séance : deux noms changent pour un seul clic, c'est tout l'objet du calcul.
    expect(partie("c2")).toMatchObject({ libelle: "Cours 3", estOption: false });
    expect(rangee()).toEqual(["Cours 1", "Cours 2", "Cours 3", "Option 1"]);
    expect(rangs()).toEqual([0, 1, 2, 3]);
  });

  it("ne fait rien — sans se plaindre — quand la nature demandée est déjà la bonne", async () => {
    const res = await changerNaturePartie({ partieId: "c2", estOption: true });
    expect(res.succes).toBe("Rien à changer.");
    expect(touchees()).toEqual([]);
  });

  /**
   * **« Modifié par … le … » ne doit jamais coller l'heure du clic de l'un sur le nom de l'autre.**
   *
   * Le défaut, celui que le dossier croyait avoir tué le matin même : il avait seulement déménagé
   * de « toute la séance » vers « les voisines dont le nom glisse ». Depuis que le nom suit le
   * rang, basculer « Cours 1 » en option renomme **trois** autres lignes pour de bon — elles sont
   * donc réécrites, et leur `updatedAt` (un `@updatedAt`) passait à l'instant du clic pendant que
   * `modifieParId` continuait de nommer celui qui les avait remplies. La case de Charlie annonçait «
   * Modifié par Charlie à 20:14 », et Chloé, qui venait de cliquer, n'apparaissait nulle part.
   *
   * Le choix retenu : **ranger ne touche pas `updatedAt`**. Porter l'auteur à sa place aurait écrit
   * le nom de Chloé sur des cases qu'elle n'a jamais remplies, et fait perdre le seul renseignement
   * que la bulle donne. Le rangement, lui, se lit dans le journal d'audit.
   */
  it("renomme les voisines **sans** repeindre leur bulle, et n'horodate que la partie du clic", async () => {
    await changerNaturePartie({ partieId: "c0", estOption: true });
    // Les trois voisines changent bel et bien de nom : c'est ce qui les faisait réécrire. Et le
    // cours devenu option **rejoint la fin de sa nouvelle série** : les cours passent devant.
    expect(rangee()).toEqual(["Cours 1", "Option 1", "Option 2", "Option 3"]);
    for (const id of ["c1", "c2", "c3"]) {
      expect(partie(id)?.updatedAt).toEqual(REMPLI_LE);
      expect(partie(id)?.modifieParId).toBeNull();
    }
    // Contre-épreuve : la partie qu'on a basculée, elle, porte l'heure du clic **et** son auteur.
    expect(partie("c0")!.updatedAt.getTime()).toBeGreaterThan(REMPLI_LE.getTime());
    expect(partie("c0")?.modifieParId).toBe("u-admin");
  });

  it("refuse de changer la nature d'une partie occupée par un atelier programmé", async () => {
    /*
     * Ses deux voisines le refusaient déjà (`enregistrerCase`, `retirerPartie`), pas celle-ci : un
     * clic sur « Cours » faisait atterrir l'atelier dans « Cours 3 », `estOption = false`, et il
     * était publié tel quel par l'API publique et les pages de partage.
     */
    partie("c2")!.atelierId = "at-1";
    const res = await changerNaturePartie({ partieId: "c2", estOption: false });
    expect(res.erreur).toMatch(/déprogramme-le d'abord/);
    expect(partie("c2")).toMatchObject({ estOption: true, libelle: "Option 1" });
    expect(touchees()).toEqual([]);
    // Contre-épreuve : l'atelier déprogrammé, la même bascule passe.
    partie("c2")!.atelierId = null;
    expect((await changerNaturePartie({ partieId: "c2", estOption: false })).succes).toBe("Partie passée en cours.");
    expect(partie("c2")).toMatchObject({ estOption: false, libelle: "Cours 3" });
  });

  it("journalise le changement de nature sous sa propre action, avec le nom d'avant et d'après", async () => {
    await changerNaturePartie({ partieId: "c2", estOption: false });
    expect(faux.audits.at(-1)).toMatchObject({
      action: "planning.partie.nature",
      details: { avant: { partie: "Option 1", option: true }, apres: { partie: "Cours 3", option: false } },
    });
  });

  it("retire la partie, **renumérote** ce qui reste et **renomme** ce qui a changé de rang", async () => {
    const res = await retirerPartie({ partieId: "c0" });
    expect(res.succes).toBe("Partie retirée.");
    // Retirer « Cours 1 » fait du second cours le premier : son nom suit.
    expect(ordreIds()).toEqual(["c1", "c2", "c3"]);
    expect(rangee()).toEqual(["Cours 1", "Option 1", "Option 2"]);
    expect(rangs()).toEqual([0, 1, 2]);
  });

  it("ne renomme rien quand la partie retirée est la dernière de sa série", async () => {
    // « Option 2 » s'en va : les trois autres gardent leur rang **et** leur nom, aucune écriture.
    const res = await retirerPartie({ partieId: "c3" });
    expect(res.succes).toBe("Partie retirée.");
    expect(rangee()).toEqual(["Cours 1", "Cours 2", "Option 1"]);
    expect(touchees()).toEqual([]);
  });

  /**
   * **Ce que l'écran promet d'effacer, le journal doit le garder.** La confirmation annonce « son
   * instructeur, son thème et sa **description** seront perdus » ; le journal, lui, ne gardait que le
   * thème et l'instructeur — la règle avait été écrite avant que la description, le niveau et le
   * second instructeur n'existent. Le geste est irréversible : le journal est tout ce qui reste.
   */
  it("garde dans le journal **les cinq champs** que le retrait efface", async () => {
    Object.assign(partie("c1")!, {
      instructeurId: "u1",
      instructeurSecondId: "u2",
      theme: "Messer",
      description: "Garde haute, trois passes lentes, puis libre.",
      niveau: "DEBUTANT",
    });
    await retirerPartie({ partieId: "c1" });
    expect(faux.audits.at(-1)).toMatchObject({
      action: "planning.partie.retrait",
      details: {
        partie: "Cours 2",
        theme: "Messer",
        instructeur: "Alice Roy",
        instructeurSecond: "Charlie Sel",
        description: "Garde haute, trois passes lentes, puis libre.",
        niveau: "Débutant",
      },
    });
  });

  it("ne raconte rien d'une case vide : les champs y sont, vides, sans inventer de mot", async () => {
    // Contre-épreuve de la précédente : le journal doit dire « rien » plutôt que de taire le champ.
    await retirerPartie({ partieId: "c1" });
    expect(faux.audits.at(-1)?.details).toMatchObject({ theme: "", description: "", instructeur: null, instructeurSecond: null, niveau: "Indifférent" });
  });

  it("refuse de retirer une partie occupée par un atelier programmé", async () => {
    partie("c2")!.atelierId = "at-1";
    const res = await retirerPartie({ partieId: "c2" });
    expect(res.erreur).toMatch(/déprogramme-le d'abord/);
    expect(rangee()).toHaveLength(4);
  });
});

describe("monter et descendre", () => {
  it("descend une partie, renumérote tout le monde — et **le nom suit la place**", async () => {
    await deplacerPartie({ partieId: "c0", versOrdre: 1 });
    // Les deux cours ont échangé leurs places, donc leurs noms : c'est exactement ce que la
    // décision promet. La suite des libellés est inchangée ; celle des identifiants, non.
    expect(ordreIds()).toEqual(["c1", "c0", "c2", "c3"]);
    expect(rangee()).toEqual(["Cours 1", "Cours 2", "Option 1", "Option 2"]);
    expect(partie("c0")?.libelle).toBe("Cours 2");
    expect(partie("c1")?.libelle).toBe("Cours 1");
    expect(rangs()).toEqual([0, 1, 2, 3]);
  });

  /**
   * **Une option montée « tout en haut » s'arrête à la tête de sa série**.
   *
   * Le rang visé est intercalaire, donc il peut désigner un point situé avant le premier cours — mais
   * le rangement trie d'abord par nature. La partie remonte donc jusqu'à la frontière et pas au-delà :
   * elle devient « Option 1 », et l'autre option « Option 2 ». Changer de série reste le travail de
   * l'interrupteur Cours/Option, pas celui des flèches.
   */
  it("monte une option jusqu'en tête de **sa** série, jamais devant les cours", async () => {
    await deplacerPartie({ partieId: "c3", versOrdre: 0 });
    expect(ordreIds()).toEqual(["c0", "c1", "c3", "c2"]);
    expect(rangee()).toEqual(["Cours 1", "Cours 2", "Option 1", "Option 2"]);
  });

  it("ne fait rien — sans se plaindre — quand on monte la première ligne", async () => {
    const res = await deplacerPartie({ partieId: "c0", versOrdre: 0 });
    expect(res.succes).toBe("Rien à changer.");
    expect(ordreIds()).toEqual(["c0", "c1", "c2", "c3"]);
    expect(rangee()).toEqual(["Cours 1", "Cours 2", "Option 1", "Option 2"]);
  });

  it("ramène un rang hors des limites dans la séance plutôt que de refuser", async () => {
    // Le plafond d'une séance est le plus grand rang que le schéma accepte ; au-delà de la séance
    // elle-même, l'action ramène dans les limites au lieu d'afficher une erreur.
    await deplacerPartie({ partieId: "c0", versOrdre: PARTIES_PAR_SEANCE_MAX });
    // Ramené dans les limites **et** dans sa série : le cours descend derrière l'autre cours, pas
    // derrière les options.
    expect(ordreIds()).toEqual(["c1", "c0", "c2", "c3"]);
    expect(rangee()).toEqual(["Cours 1", "Cours 2", "Option 1", "Option 2"]);
    expect(rangs()).toEqual([0, 1, 2, 3]);
  });

  /**
   * **Un déplacement n'écrit que les lignes qui bougent.**
   *
   * La transaction réécrivait `ordre` sur **toutes** les parties de la séance, celles déjà au bon rang
   * comprises. Or `ordre` porte `@updatedAt` : chaque « descendre » repoussait donc l'horodatage de
   * toute la séance, et `chargerPlanning` recopie ce champ dans la bulle « Modifié par … le … » de
   * chaque case — avec `modifieParId`, lui, inchangé. Quelqu'un remplissait « Cours n°1 » le
   * 12 septembre ; une autre personne descendait « 2e option » le 30 à 20h14 ; la case de
   * « Cours n°1 » annonçait « Modifié par <la première> le 30 septembre à 20:14 ». Elle n'avait rien
   * fait ce soir-là, et c'est la seule trace que la grille montre.
   *
   * La règle est tenue partout ailleurs — `renumeroter` saute les lignes déjà au bon rang, et les
   * migrations qui réparent des rangs ne touchent volontairement pas `updatedAt` : réparer un rang
   * n'est pas une modification du programme par quelqu'un.
   */
  it("n'écrit que les lignes dont le rang ou le nom change vraiment", async () => {
    // « Option 2 » remonte d'un cran : seules elle et sa voisine changent de rang, donc de nom.
    await deplacerPartie({ partieId: "c3", versOrdre: 2 });
    expect(ordreIds()).toEqual(["c0", "c1", "c3", "c2"]);
    expect(rangee()).toEqual(["Cours 1", "Cours 2", "Option 1", "Option 2"]);
    expect(rangs()).toEqual([0, 1, 2, 3]);
    // Les deux cours ne bougent pas : ni leur rang, ni leur nom. Une écriture sur eux repousserait
    // `updatedAt`, et la grille annoncerait « Modifié par … » sur des cases que personne n'a touchées.
    expect(new Set(touchees())).toEqual(new Set(["c2", "c3"]));
    // Et une seule écriture par ligne, même quand le rang **et** le nom changent.
    expect(touchees()).toHaveLength(2);
  });

  it("ne repeint la bulle de personne : les rangs bougent, les horodatages restent", async () => {
    // Trois lignes changent de rang et deux changent de nom — aucune n'a changé de **contenu**.
    await deplacerPartie({ partieId: "c3", versOrdre: 2 });
    for (const p of faux.parties) expect(p.updatedAt).toEqual(REMPLI_LE);
    // Contre-épreuve : remplir la case, ça, c'est une modification — et elle s'horodate.
    await enregistrerCase({ partieId: "c3", instructeurId: "u1", theme: "Messer", niveau: "INDIFFERENT" });
    expect(partie("c3")!.updatedAt.getTime()).toBeGreaterThan(REMPLI_LE.getTime());
    expect(partie("c3")?.modifieParId).toBe("u-admin");
  });

  /**
   * **« Monter » la première ligne vaut le rang −1**, et l'action promet de le ramener dans les
   * limites « plutôt que refusé : un "monter" sur la première ligne ne doit pas afficher d'erreur, il
   * ne doit rien faire ». Le schéma, lui, posait `min(0)` et le **refusait** avant que l'action n'ait
   * la main : un message d'erreur rouge pour un geste qui devait être sans effet.
   */
  it("accepte un rang négatif et ne fait rien, comme promis", async () => {
    const res = await deplacerPartie({ partieId: "c0", versOrdre: -1 });
    expect(res.erreur).toBeUndefined();
    expect(res.succes).toBe("Rien à changer.");
    expect(touchees()).toEqual([]);
    // Et il ramène vraiment dans les limites quand la partie n'est pas déjà en tête **de sa série** :
    // « Option 1 » visait le rang -5, elle s'arrête à la frontière des cours, donc ne bouge pas.
    expect((await deplacerPartie({ partieId: "c2", versOrdre: -5 })).succes).toBe("Rien à changer.");
    expect(ordreIds()).toEqual(["c0", "c1", "c2", "c3"]);
  });

  it("refuse en revanche un rang qui n'est plus un déplacement, dans les deux sens", async () => {
    // Contre-épreuve du précédent : au-delà d'une séance entière, ce n'est plus un rang de séance.
    expect((await deplacerPartie({ partieId: "c0", versOrdre: -(PARTIES_PAR_SEANCE_MAX + 1) })).erreur).toBeTruthy();
    expect((await deplacerPartie({ partieId: "c0", versOrdre: PARTIES_PAR_SEANCE_MAX + 1 })).erreur).toBeTruthy();
    expect(touchees()).toEqual([]);
  });

  it("ne touche personne quand le déplacement ne change rien", async () => {
    await deplacerPartie({ partieId: "c0", versOrdre: 0 });
    expect(touchees()).toEqual([]);
  });

  it("écrit bien tout le monde quand tout le monde bouge", async () => {
    // Le premier cours descend en queue de sa série, la dernière option remonte en tête de la sienne :
    // les quatre rangs bougent, donc les quatre noms, donc les quatre lignes s'écrivent.
    await deplacerPartie({ partieId: "c0", versOrdre: 1 });
    await deplacerPartie({ partieId: "c3", versOrdre: 2 });
    expect(ordreIds()).toEqual(["c1", "c0", "c3", "c2"]);
    expect(new Set(touchees())).toEqual(new Set(["c0", "c1", "c2", "c3"]));
  });
});

describe("la garde des six actions", () => {
  it("toutes passent par planning.edit", async () => {
    faux.permissions = [];
    await enregistrerCase({ partieId: "c0", instructeurId: "", theme: "", niveau: "INDIFFERENT" });
    await ajouterPartie({ sessionId: "s1" });
    await changerNaturePartie({ partieId: "c0", estOption: true });
    await deplacerPartie({ partieId: "c0", versOrdre: 1 });
    await retirerPartie({ partieId: "c0" });
    expect(faux.permissions).toEqual(["planning.edit", "planning.edit", "planning.edit", "planning.edit", "planning.edit"]);
  });

  it("une partie qui n'existe plus ne fait rien écrire", async () => {
    for (const res of [
      await enregistrerCase({ partieId: "inconnu", instructeurId: "", theme: "", niveau: "INDIFFERENT" }),
      await changerNaturePartie({ partieId: "inconnu", estOption: true }),
      await deplacerPartie({ partieId: "inconnu", versOrdre: 0 }),
      await retirerPartie({ partieId: "inconnu" }),
    ]) {
      expect(res.erreur).toBe("Cette partie n'existe plus.");
    }
    expect(rangee()).toHaveLength(4);
  });

  it("chacune resynchronise la séance : disciplines et encadrants suivent toujours les cases", async () => {
    synchronisations.length = 0;
    await enregistrerCase({ partieId: "c0", instructeurId: "u1", theme: "Messer", niveau: "INDIFFERENT" });
    await ajouterPartie({ sessionId: "s1" });
    await changerNaturePartie({ partieId: "c0", estOption: true });
    // `c0` est devenue une option : on la déplace **dans sa série** (rang 2), sinon le rangement la
    // ramène chez elle et le geste ne change rien — donc ne synchronise rien, à juste titre.
    await deplacerPartie({ partieId: "c0", versOrdre: 3 });
    await retirerPartie({ partieId: "c0" });
    expect(synchronisations).toEqual(["s1", "s1", "s1", "s1", "s1"]);
  });

  it("journalise chaque geste sous sa propre action", async () => {
    await ajouterPartie({ sessionId: "s1" });
    await changerNaturePartie({ partieId: "c0", estOption: true });
    // Même raison qu'au-dessus : un déplacement qui ne déplace rien ne se journalise pas.
    await deplacerPartie({ partieId: "c0", versOrdre: 3 });
    await retirerPartie({ partieId: "c0" });
    expect(faux.audits.map((a) => a.action)).toEqual([
      "planning.partie.ajout",
      "planning.partie.nature",
      "planning.partie.ordre",
      "planning.partie.retrait",
    ]);
    // Le raccourci « planning » du journal filtre sur ce préfixe : toutes doivent le porter.
    expect(faux.audits.every((a) => a.action.startsWith("planning."))).toBe(true);
  });

  it("refuse le changement de nature dans une période close, comme les autres", async () => {
    faux.statutPeriode = "CLOSE";
    expect((await changerNaturePartie({ partieId: "c0", estOption: true })).erreur).toMatch(/close/);
  });
});

/**
 * **Le libellé est une valeur dérivée, et le rester est un invariant du planning.**
 *
 * La colonne `SessionPartie.libelle` n'est plus saisie par personne : elle vaut toujours
 * `libellePartie(rang dans la nature, estOption)`. Elle reste en base parce que l'API publique, les
 * pages de partage, l'embed Discord et l'email du soir la lisent chacun avec leur propre requête — et
 * une colonne dérivée qui prend du retard sur son rang est pire qu'une colonne absente : elle publie
 * une fausse information sans que rien à l'écran ne le montre.
 *
 * Les quatre gestes qui déplacent un rang sont donc éprouvés **ensemble** ici, sur une séance qu'on
 * secoue : ce qui compte n'est pas qu'un geste isolé soit juste, c'est que la colonne le soit encore
 * après une suite de gestes.
 */
describe("le libellé dit toujours le rang, quoi qu'on fasse à la séance", () => {
  /** Ce que le code devrait écrire, recalculé depuis zéro sur l'état courant de la séance. */
  const attendus = async () => {
    const { libellePartie } = await import("@/lib/constants");
    let cours = 0;
    let options = 0;
    return [...faux.parties].sort((a, b) => a.ordre - b.ordre).map((p) => libellePartie(p.estOption ? ++options : ++cours, p.estOption));
  };

  it("après n'importe quelle suite d'ajouts, de retraits, de déplacements et de bascules", async () => {
    await ajouterPartie({ sessionId: "s1", estOption: true });
    await deplacerPartie({ partieId: "c3", versOrdre: 0 });
    await changerNaturePartie({ partieId: "c0", estOption: true });
    await retirerPartie({ partieId: "c1" });
    await ajouterPartie({ sessionId: "s1" });
    await deplacerPartie({ partieId: "c2", versOrdre: 4 });
    await changerNaturePartie({ partieId: "c2", estOption: false });
    expect(rangee()).toEqual(await attendus());
    // Et les rangs sont restés contigus pendant tout ce temps : les deux invariants tiennent ensemble.
    expect(rangs()).toEqual(faux.parties.map((_, i) => i));
  });

  it("y compris au départ d'une séance aux rangs abîmés", async () => {
    // Les rangs troués que la migration du 29/09 pouvait laisser : l'application les répare, elle ne
    // les propage pas — et elle recale les noms dans le même mouvement.
    poserRangs([["Option 2", 1], ["Cours 2", 1], ["Option 1", 5]]);
    await ajouterPartie({ sessionId: "s1" });
    expect(rangs()).toEqual([0, 1, 2, 3]);
    expect(rangee()).toEqual(await attendus());
  });
});
