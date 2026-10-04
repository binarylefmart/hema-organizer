import { beforeEach, describe, expect, it, vi } from "vitest";
import { selonOrdreFige, trierParActionnabilite } from "@/components/seances/listes";
import {
  ajouter,
  basculer,
  etatToutCocher,
  libelleDeplierEtSelectionner,
  libelleToutSelectionner,
  lignesSelectionnees,
  resumeEcrasement,
  restreindre,
  retirer,
  texteApresCoup,
  texteConfirmation,
  texteRepliees,
} from "@/components/gestion/selection-presences";

/**
 * **Corriger la réponse de plusieurs personnes d'un coup**.
 *
 * Le besoin vient d'un soir de cours dans un club de quatre-vingts : la feuille de présence est
 * relevée à la main, et l'écran s'ouvre sur quarante-six à cinquante-cinq personnes **sans
 * réponse**. Les passer une par une, c'est cinquante listes déroulantes.
 *
 * Ce qui est vérifié ici, dans cet ordre :
 *
 * 1. **la sélection ne porte que sur ce qui est affiché** — le résultat de la recherche en cours et
 *    les lignes dépliées, jamais la liste entière en silence ;
 * 2. **elle ne rouvre pas l'ordre figé à l'ouverture** de l'écran (`selonOrdreFige`) : cocher ne
 *    doit pas faire sauter les lignes sous le doigt ;
 * 3. **la confirmation distingue les deux populations** — ceux qui n'avaient rien dit, et ceux qui
 *    avaient répondu eux-mêmes et dont on écrase la réponse ;
 * 4. **l'action serveur** garde exactement les mêmes verrous que la correction unitaire, écrit en
 *    **une seule transaction**, et journalise **une entrée par personne**.
 */

/* ------------------------------------------------------------------ */
/* 1. La sélection : ce qu'elle prend, ce qu'elle laisse               */
/* ------------------------------------------------------------------ */

type Ligne = { id: string; prenom: string; nom: string; statut: "PRESENT" | "ABSENT" | "PEUT_ETRE" | null };

function ligne(id: string, statut: Ligne["statut"] = null): Ligne {
  return { id, prenom: id, nom: id.toUpperCase(), statut };
}

describe("cocher et décocher", () => {
  it("bascule une ligne sans toucher au reste, et ne modifie jamais la sélection reçue", () => {
    const avant = new Set(["a", "b"]);
    const apres = basculer(avant, "c");
    expect([...apres]).toEqual(["a", "b", "c"]);
    expect([...avant]).toEqual(["a", "b"]);
    expect([...basculer(apres, "a")]).toEqual(["b", "c"]);
  });

  it("ajoute et retire des paquets (le « tout sélectionner » et son inverse)", () => {
    expect([...ajouter(new Set(["a"]), ["b", "c", "a"])]).toEqual(["a", "b", "c"]);
    expect([...retirer(new Set(["a", "b", "c"]), ["b", "z"])]).toEqual(["a", "c"]);
  });

  it("oublie qui a quitté la liste, et garde qui y est toujours", () => {
    // Quelqu'un retiré de la période entre deux rendus ne doit pas rester coché dans le vide :
    // la barre d'action annoncerait un nombre que l'écran ne montre plus.
    expect([...restreindre(new Set(["a", "parti", "b"]), [ligne("a"), ligne("b")])]).toEqual(["a", "b"]);
  });
});

describe("la case « tout sélectionner » ne porte que sur ce qui est affiché", () => {
  const tous = [ligne("a"), ligne("b"), ligne("c"), ligne("d")];
  const affiches = tous.slice(0, 2); // deux lignes montrées, deux repliées

  it("ne coche que les lignes montrées, jamais celles qui sont repliées", () => {
    const selection = ajouter(new Set<string>(), affiches.map((l) => l.id));
    expect([...selection]).toEqual(["a", "b"]);
    expect(selection.has("c")).toBe(false);
    expect(selection.has("d")).toBe(false);
  });

  it("la décocher ne relâche que les lignes montrées", () => {
    const selection = retirer(new Set(["a", "b", "c"]), affiches.map((l) => l.id));
    expect([...selection]).toEqual(["c"]);
  });

  it("dit son état : aucune, une partie, ou toutes les lignes affichées", () => {
    expect(etatToutCocher(affiches, new Set())).toBe("aucune");
    expect(etatToutCocher(affiches, new Set(["a"]))).toBe("partielle");
    expect(etatToutCocher(affiches, new Set(["a", "b"]))).toBe("toutes");
    // Des cases cochées ailleurs (une recherche précédente) ne rendent pas « toutes » vrai ici.
    expect(etatToutCocher(affiches, new Set(["a", "c", "d"]))).toBe("partielle");
    // Une liste vide n'est pas « toutes cochées » : la case reste décochée et sans effet.
    expect(etatToutCocher([], new Set(["a"]))).toBe("aucune");
  });
});

describe("le libellé dit sur quoi la case agit", () => {
  it("annonce le nombre de résultats quand on cherche", () => {
    expect(libelleToutSelectionner(12, { recherche: true, replie: false })).toBe("Sélectionner les 12 résultats");
  });

  it("annonce le nombre de personnes quand on ne cherche pas", () => {
    expect(libelleToutSelectionner(12, { recherche: false, replie: false })).toBe("Sélectionner les 12 personnes");
  });

  it("dit « affichées » — et rien d'autre — quand la liste est repliée : c'est le piège à éviter", () => {
    // Soixante lignes repliées derrière un bouton, une case « Tout sélectionner » : le bureau
    // croirait en avoir pris soixante et n'en aurait pris que vingt.
    const libelle = libelleToutSelectionner(20, { recherche: false, replie: true });
    expect(libelle).toBe("Sélectionner les 20 lignes affichées");
    expect(libelle).not.toMatch(/^Tout/);
  });

  it("n'écrit jamais « Tout », quel que soit le cas", () => {
    for (const recherche of [true, false]) {
      for (const replie of [true, false]) {
        for (const n of [1, 12, 80]) {
          expect(libelleToutSelectionner(n, { recherche, replie })).not.toMatch(/\bTout\b/i);
        }
      }
    }
  });

  it("reste français au singulier", () => {
    expect(libelleToutSelectionner(1, { recherche: true, replie: false })).toBe("Sélectionner ce résultat");
    expect(libelleToutSelectionner(1, { recherche: false, replie: false })).toBe("Sélectionner cette personne");
  });

  it("propose de déplier ET de sélectionner, plutôt que de cacher le reste", () => {
    expect(libelleDeplierEtSelectionner(46, true)).toBe("Afficher et sélectionner les 46 résultats");
    expect(libelleDeplierEtSelectionner(46, false)).toBe("Afficher et sélectionner les 46 personnes");
  });

  it("dit combien de lignes restent en dehors de la sélection tant qu'elles sont repliées", () => {
    // Le cas ordinaire : on vient d'ouvrir l'écran, rien n'est coché derrière le bouton.
    expect(texteRepliees([ligne("a"), ligne("b")], new Set())).toBe("2 autres lignes sont repliées : elles ne sont pas sélectionnées.");
    expect(texteRepliees([ligne("a")], new Set())).toBe("1 autre ligne est repliée : elle n'est pas sélectionnée.");
    expect(texteRepliees([], new Set(["a"]))).toBeNull();
  });

  /**
   * **Le lot composé sur deux recherches.** La sélection survit volontairement au changement de
   * recherche (`restreindre`, `retirer`) : on coche Chloé sous « du », on efface, on tape « ma », et
   * Chloé se retrouve derrière le bouton « Afficher les 60 autres ». La phrase qui jurait que les
   * soixante repliées « ne sont pas sélectionnées » était alors fausse — et c'est exactement la
   * phrase qu'on relit avant d'appuyer sur un bouton qui écrit en base.
   */
  it("ne met pas dans le même sac les lignes repliées cochées et celles qui ne le sont pas", () => {
    const repliees = [ligne("chloe"), ligne("marc"), ligne("maya")];
    expect(texteRepliees(repliees, new Set(["chloe"]))).toBe("3 autres lignes sont repliées : 1 est sélectionnée, 2 ne le sont pas.");
    expect(texteRepliees(repliees, new Set(["chloe", "marc"]))).toBe("3 autres lignes sont repliées : 2 sont sélectionnées, 1 ne l'est pas.");
  });

  it("ne dit jamais « pas sélectionnées » quand tout le repli est coché", () => {
    // Le cas du bouton « Afficher et sélectionner les 80 personnes » cliqué, puis d'un repli repris.
    const repliees = [ligne("chloe"), ligne("marc")];
    const texte = texteRepliees(repliees, new Set(["chloe", "marc"]));
    expect(texte).toBe("2 autres lignes sont repliées : elles sont toutes sélectionnées.");
    expect(texte).not.toMatch(/ne (le )?sont pas/);
    expect(texteRepliees([ligne("chloe")], new Set(["chloe"]))).toBe("1 autre ligne est repliée : elle est sélectionnée.");
  });
});

describe("la sélection ne rouvre pas l'ordre figé à l'ouverture", () => {
  /**
   * L'écran fige l'ordre reçu au premier rendu (`selonOrdreFige`) parce que l'action serveur
   * revalide la page et renvoie la liste retriée : sans ce repère, la ligne qu'on vient de cocher
   * descendrait chez les présents et la suivante remonterait **sous le doigt**.
   */
  const ouverture = [ligne("zoe"), ligne("adrien"), ligne("chloe", "PEUT_ETRE"), ligne("charlie", "PRESENT")];
  const ordre = ouverture.map((l) => l.id);

  it("garde l'ordre d'ouverture même après que le serveur a retrié la liste", () => {
    // Le serveur renvoie zoé et adrien passés « Présent » : son tri les mettrait en fin de liste.
    const retriee = trierParActionnabilite([
      ligne("zoe", "PRESENT"),
      ligne("adrien", "PRESENT"),
      ligne("chloe", "PEUT_ETRE"),
      ligne("charlie", "PRESENT"),
    ]);
    expect(selonOrdreFige(ordre, retriee).map((l) => l.id)).toEqual(ordre);
  });

  it("les lignes sélectionnées se lisent dans cet ordre-là, pas dans celui de la sélection", () => {
    const selection = new Set(["charlie", "zoe"]);
    expect(lignesSelectionnees(ouverture, selection).map((l) => l.id)).toEqual(["zoe", "charlie"]);
  });

  it("cocher ne change rien à la liste reçue", () => {
    const copie = [...ouverture];
    lignesSelectionnees(ouverture, new Set(["chloe"]));
    expect(ouverture).toEqual(copie);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Ce que la confirmation annonce                                   */
/* ------------------------------------------------------------------ */

describe("la confirmation distingue ceux qui avaient déjà répondu", () => {
  /** Quatorze personnes : onze muettes, deux « Absent », une « Peut-être ». */
  const quatorze: Ligne[] = [
    ...Array.from({ length: 11 }, (_, i) => ligne(`muet-${i}`)),
    ligne("a1", "ABSENT"),
    ligne("a2", "ABSENT"),
    ligne("p1", "PEUT_ETRE"),
  ];

  it("compte séparément les silencieux et ceux dont on écrase la réponse", () => {
    const r = resumeEcrasement(quatorze, "PRESENT");
    expect(r.total).toBe(14);
    expect(r.sansReponse).toBe(11);
    expect(r.ecrasees).toBe(3);
    expect(r.inchangees).toBe(0);
    expect(r.detail).toEqual([
      { statut: "ABSENT", nombre: 2 },
      { statut: "PEUT_ETRE", nombre: 1 },
    ]);
  });

  it("écrit la phrase de l'énoncé : 14 personnes, dont 3 qui avaient déjà répondu (2 Absent, 1 Peut-être)", () => {
    const texte = texteConfirmation(resumeEcrasement(quatorze, "PRESENT"), "PRESENT");
    expect(texte).toContain("14 personnes");
    expect(texte).toContain("« Présent »");
    expect(texte).toContain("3 avaient déjà répondu");
    expect(texte).toContain("2 Absent, 1 Peut-être");
  });

  it("ne compte pas comme écrasé quelqu'un qui porte déjà la réponse visée", () => {
    const r = resumeEcrasement([ligne("x", "PRESENT"), ligne("y", "ABSENT"), ligne("z")], "PRESENT");
    expect(r.inchangees).toBe(1);
    expect(r.ecrasees).toBe(1);
    expect(r.detail).toEqual([{ statut: "ABSENT", nombre: 1 }]);
    expect(texteConfirmation(r, "PRESENT")).toContain("1 y est déjà");
  });

  it("ne parle d'écrasement que s'il y en a un", () => {
    const texte = texteConfirmation(resumeEcrasement([ligne("a"), ligne("b")], "PRESENT"), "PRESENT");
    expect(texte).toContain("2 personnes");
    expect(texte).not.toContain("déjà répondu");
  });

  it("pour « Sans réponse », annonce les réponses effacées et leur détail", () => {
    const r = resumeEcrasement(quatorze, null);
    expect(r.ecrasees).toBe(3);
    expect(r.inchangees).toBe(11);
    const texte = texteConfirmation(r, null);
    expect(texte).toContain("« Sans réponse »");
    expect(texte).toContain("3 réponses seront effacées");
    expect(texte).toContain("2 Absent, 1 Peut-être");
  });

  it("pour « Sans réponse » sur des gens qui n'avaient rien dit, prévient que rien ne changera", () => {
    expect(texteConfirmation(resumeEcrasement([ligne("a"), ligne("b")], null), null)).toContain("rien ne changera");
  });

  it("rappelle toujours que le journal garde le détail personne par personne", () => {
    for (const cible of ["PRESENT", "ABSENT", "PEUT_ETRE", null] as const) {
      expect(texteConfirmation(resumeEcrasement(quatorze, cible), cible)).toContain("journal");
    }
  });

  it("accorde au singulier", () => {
    const r = resumeEcrasement([ligne("a1", "ABSENT")], "PRESENT");
    const texte = texteConfirmation(r, "PRESENT");
    expect(texte).toContain("1 personne ");
    expect(texte).toContain("1 avait déjà répondu");
    expect(texte).toContain("(Absent)");
  });
});

describe("ce que l'écran dit une fois le lot enregistré", () => {
  it("annonce le nombre écrit, et signale ce qui était déjà à jour", () => {
    expect(texteApresCoup(14, 0)).toBe("14 réponses enregistrées.");
    expect(texteApresCoup(11, 3)).toBe("11 réponses enregistrées, 3 étaient déjà à jour.");
    expect(texteApresCoup(1, 1)).toBe("1 réponse enregistrée, 1 était déjà à jour.");
    expect(texteApresCoup(0, 5)).toBe("Rien à changer : ces 5 réponses étaient déjà à jour.");
  });
});

/* ------------------------------------------------------------------ */
/* 3. L'action serveur                                                 */
/* ------------------------------------------------------------------ */

const SEANCE = "s-1";
const PERIODE = "p-1";
const CHARLIE = "u-charlie"; // membre du club, mais pas invité sur cette période
const PORTAIL = "u-portail"; // compte de service : jamais dans une liste nominative

type FauxCompte = { id: string; prenom: string; nom: string; email: string | null; role: string; actif: boolean; service: boolean };
/* Le statut de la période part avec la séance : un trimestre clos ne corrige plus ses réponses. */
type FauxSeance = { id: string; periodId: string; annulee: boolean; period: { statut: string } };

const faux = vi.hoisted(() => ({
  /** Administrateur entré par son lien personnel (session non forte) : le cas courant un soir de cours. */
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `attendances.autrui` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que
  // par `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-delta", prenom: "Delta", nom: "Roy", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true, sessionId: "sess-1", sessionForte: true },
  seance: null as FauxSeance | null,
  comptes: [] as FauxCompte[],
  invites: [] as string[],
  presences: [] as { userId: string; sessionId: string; statut: string }[],
  audits: [] as { acteur: unknown; action: string; cible: string | null; details: Record<string, unknown> }[],
  chemins: [] as string[],
  /** Chaque écriture de présence, dans l'ordre : c'est ce qui doit tenir dans une seule transaction. */
  ecritures: [] as string[],
  /** Chaque appel à `$transaction`, avec le nombre d'opérations qu'il portait. */
  transactions: [] as number[],
}));

type ClePresence = { userId: string; sessionId: string };
const laPresence = (userId: string, sessionId: string) => faux.presences.find((p) => p.userId === userId && p.sessionId === sessionId);

vi.mock("@/lib/db", () => ({
  db: {
    session: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (faux.seance && faux.seance.id === where.id ? faux.seance : null)),
    },
    periodMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId?: string } }) => (where.userId && faux.invites.includes(where.userId) ? { userId: where.userId } : null)),
      findMany: vi.fn(async ({ where }: { where: { userId?: { in: string[] }; user?: { service?: boolean } } }) => {
        const demandes = where.userId?.in ?? faux.invites;
        return demandes
          .filter((id) => faux.invites.includes(id))
          .filter((id) => {
            if (where.user?.service === undefined) return true;
            return (faux.comptes.find((c) => c.id === id)?.service ?? false) === where.user.service;
          })
          .map((userId) => ({ userId }));
      }),
    },
    attendance: {
      findUnique: vi.fn(async ({ where }: { where: { userId_sessionId: ClePresence } }) => laPresence(where.userId_sessionId.userId, where.userId_sessionId.sessionId) ?? null),
      findMany: vi.fn(async ({ where }: { where: { sessionId: string; userId?: { in: string[] } } }) =>
        faux.presences.filter((p) => p.sessionId === where.sessionId && (!where.userId || where.userId.in.includes(p.userId))),
      ),
      upsert: vi.fn(({ where, create, update }: { where: { userId_sessionId: ClePresence }; create: ClePresence & { statut: string }; update: { statut: string } }) => {
        const { userId, sessionId } = where.userId_sessionId;
        faux.ecritures.push(`upsert:${userId}`);
        const existante = laPresence(userId, sessionId);
        if (existante) Object.assign(existante, update);
        else faux.presences.push({ ...create });
        return Promise.resolve({ userId, sessionId, statut: update.statut });
      }),
      deleteMany: vi.fn(({ where }: { where: { sessionId: string; userId: string | { in: string[] } } }) => {
        const vise = (id: string) => (typeof where.userId === "string" ? id === where.userId : where.userId.in.includes(id));
        faux.ecritures.push(`deleteMany:${typeof where.userId === "string" ? where.userId : where.userId.in.join("+")}`);
        const avant = faux.presences.length;
        faux.presences = faux.presences.filter((p) => !(p.sessionId === where.sessionId && vise(p.userId)));
        return Promise.resolve({ count: avant - faux.presences.length });
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => {
      faux.transactions.push(ops.length);
      return Promise.all(ops);
    }),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (acteur: unknown, action: string, cible?: string | null, details?: Record<string, unknown>) => {
    faux.audits.push({ acteur, action, cible: cible ?? null, details: details ?? {} });
  }),
}));

vi.mock("@/lib/auth/session", () => ({ touchSession: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/elevation", () => ({
  // Repoussée à chaque correction : c'est ce qui permet d'exiger l'élévation sans mettre dehors
  // celui qui tient le registre (voir `presences-par-admin.test.ts`, section 5).
  toucherElevation: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/current-user", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  class AccesRefuse extends Error {}
  return {
    AccesRefuse,
    getCurrentUser: vi.fn(async () => faux.acteur),
    requireUser: vi.fn(async () => faux.acteur),
    assertPermission: vi.fn(async (permission: Parameters<typeof vrai.can>[1]) => {
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

const { modifierPresencesEnMasse } = await import("@/actions/presences");

function compte(p: Partial<FauxCompte> & { id: string }): FauxCompte {
  return { prenom: "Prénom", nom: "Nom", email: null, role: "MEMBRE", actif: true, service: false, ...p };
}

/** Quinze invités : de quoi faire un lot qui ressemble à un vrai soir de cours. */
const INVITES = Array.from({ length: 15 }, (_, i) => `u-${i}`);

type Resultat = { ok?: boolean; erreur?: string; modifiees?: number; inchangees?: number };
const statutDe = (userId: string) => laPresence(userId, SEANCE)?.statut ?? null;

/** Un refus : rien n'est écrit, rien n'est journalisé, aucune transaction n'est ouverte. */
async function refuse(promesse: Promise<unknown>): Promise<void> {
  const avant = JSON.stringify(faux.presences);
  let resultat: unknown;
  let aLeve = false;
  try {
    resultat = await promesse;
  } catch {
    aLeve = true;
  }
  const r = resultat as Resultat | undefined;
  expect(aLeve || r?.ok === false || Boolean(r?.erreur), `refus attendu, reçu ${JSON.stringify(resultat)}`).toBe(true);
  expect(JSON.stringify(faux.presences)).toBe(avant);
  expect(faux.audits).toEqual([]);
  expect(faux.transactions).toEqual([]);
}

beforeEach(() => {
  faux.acteur = { id: "u-delta", prenom: "Delta", nom: "Roy", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true, sessionId: "sess-1", sessionForte: true };
  faux.seance = { id: SEANCE, periodId: PERIODE, annulee: false, period: { statut: "ACTIVE" } };
  faux.comptes = [...INVITES.map((id) => compte({ id })), compte({ id: CHARLIE }), compte({ id: PORTAIL, service: true })];
  faux.invites = [...INVITES, PORTAIL];
  faux.presences = [];
  faux.audits = [];
  faux.chemins = [];
  faux.ecritures = [];
  faux.transactions = [];
});

describe("correction en masse : ce qu'elle écrit", () => {
  it("passe tout un lot au même statut", async () => {
    const lot = INVITES.slice(0, 12);
    const res = (await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: lot, statut: "PRESENT" })) as Resultat;
    expect(res.erreur).toBeUndefined();
    expect(res.modifiees).toBe(12);
    expect(res.inchangees).toBe(0);
    for (const id of lot) expect(statutDe(id)).toBe("PRESENT");
    expect(statutDe(INVITES[13])).toBeNull();
  });

  it("écrase la réponse que les gens avaient donnée eux-mêmes", async () => {
    faux.presences = [
      { userId: INVITES[0], sessionId: SEANCE, statut: "ABSENT" },
      { userId: INVITES[1], sessionId: SEANCE, statut: "PEUT_ETRE" },
    ];
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0], INVITES[1], INVITES[2]], statut: "PRESENT" });
    expect([INVITES[0], INVITES[1], INVITES[2]].map(statutDe)).toEqual(["PRESENT", "PRESENT", "PRESENT"]);
  });

  it("remet un lot à « sans réponse » : les lignes disparaissent", async () => {
    faux.presences = INVITES.slice(0, 3).map((userId) => ({ userId, sessionId: SEANCE, statut: "PRESENT" }));
    const res = (await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: INVITES.slice(0, 3), statut: null })) as Resultat;
    expect(res.erreur).toBeUndefined();
    expect(res.modifiees).toBe(3);
    expect(faux.presences).toEqual([]);
  });

  it("accepte la case vide du <select> comme « sans réponse »", async () => {
    faux.presences = [{ userId: INVITES[0], sessionId: SEANCE, statut: "PRESENT" }];
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0]], statut: "" as never });
    expect(statutDe(INVITES[0])).toBeNull();
  });

  it("n'écrit rien pour qui porte déjà la réponse visée, et le dit", async () => {
    faux.presences = [
      { userId: INVITES[0], sessionId: SEANCE, statut: "PRESENT" },
      { userId: INVITES[1], sessionId: SEANCE, statut: "PRESENT" },
    ];
    const res = (await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0], INVITES[1], INVITES[2]], statut: "PRESENT" })) as Resultat;
    expect(res.modifiees).toBe(1);
    expect(res.inchangees).toBe(2);
    expect(faux.ecritures).toEqual([`upsert:${INVITES[2]}`]);
  });

  it("ignore un identifiant répété (une case cochée deux fois ne s'écrit pas deux fois)", async () => {
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0], INVITES[0], INVITES[1]], statut: "ABSENT" });
    expect(faux.ecritures).toHaveLength(2);
    expect(faux.audits).toHaveLength(2);
  });
});

describe("correction en masse : une seule transaction", () => {
  it("passe toutes les écritures dans un seul appel", async () => {
    const lot = INVITES.slice(0, 9);
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: lot, statut: "PRESENT" });
    expect(faux.transactions).toHaveLength(1);
    expect(faux.transactions[0]).toBe(9);
    // Aucune écriture n'est passée à côté du lot.
    expect(faux.ecritures).toHaveLength(9);
  });

  it("efface tout un lot en une seule opération, pas une par personne", async () => {
    faux.presences = INVITES.slice(0, 5).map((userId) => ({ userId, sessionId: SEANCE, statut: "PEUT_ETRE" }));
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: INVITES.slice(0, 5), statut: null });
    expect(faux.transactions).toEqual([1]);
    expect(faux.ecritures).toHaveLength(1);
    expect(faux.ecritures[0]).toMatch(/^deleteMany:/);
  });

  it("n'ouvre aucune transaction quand il n'y a rien à écrire", async () => {
    faux.presences = [{ userId: INVITES[0], sessionId: SEANCE, statut: "PRESENT" }];
    const res = (await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0]], statut: "PRESENT" })) as Resultat;
    expect(res.erreur).toBeUndefined();
    expect(res.modifiees).toBe(0);
    expect(res.inchangees).toBe(1);
    expect(faux.transactions).toEqual([]);
    expect(faux.audits).toEqual([]);
  });
});

describe("correction en masse : le journal, personne par personne", () => {
  it("écrit une entrée par personne modifiée, jamais une entrée pour le lot", async () => {
    const lot = INVITES.slice(0, 7);
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: lot, statut: "PRESENT" });
    expect(faux.audits).toHaveLength(7);
    expect(faux.audits.map((a) => a.cible).sort()).toEqual([...lot].sort());
  });

  it("garde la même action que la correction unitaire : le journal se lit d'un seul filtre", async () => {
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0]], statut: "PRESENT" });
    expect(faux.audits[0].action).toBe("presence.modifiee_par_admin");
    expect(faux.audits[0].acteur).toMatchObject({ id: "u-delta" });
  });

  it("dit pour chacun ce qui a été remplacé, et signale que le geste était collectif", async () => {
    faux.presences = [{ userId: INVITES[0], sessionId: SEANCE, statut: "ABSENT" }];
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0], INVITES[1]], statut: "PRESENT" });
    const parCible = new Map(faux.audits.map((a) => [a.cible, a.details]));
    expect(parCible.get(INVITES[0])).toMatchObject({ sessionId: SEANCE, avant: "ABSENT", apres: "PRESENT", enMasse: true });
    expect(parCible.get(INVITES[1])).toMatchObject({ sessionId: SEANCE, avant: null, apres: "PRESENT", enMasse: true });
  });

  it("journalise aussi les effacements, un par personne", async () => {
    faux.presences = INVITES.slice(0, 3).map((userId) => ({ userId, sessionId: SEANCE, statut: "PRESENT" }));
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: INVITES.slice(0, 3), statut: null });
    expect(faux.audits).toHaveLength(3);
    expect(faux.audits.every((a) => a.details.apres === null && a.details.avant === "PRESENT")).toBe(true);
  });
});

describe("correction en masse : les mêmes verrous que la correction unitaire", () => {
  // `estAdmin: false` est indispensable : l'acteur de référence est un instructeur **du bureau**, et
  // le laisser filtrer par le `...faux.acteur` ferait d'un refus un test qui n'éprouve plus rien.
  it("refuse un instructeur qui n'est pas du bureau", async () => {
    faux.acteur = { ...faux.acteur, id: "u-echo", role: "INSTRUCTEUR", estAdmin: false };
    await refuse(modifierPresencesEnMasse({ sessionId: SEANCE, userIds: INVITES.slice(0, 3), statut: "PRESENT" }));
  });

  it("refuse un membre", async () => {
    faux.acteur = { ...faux.acteur, id: INVITES[0], role: "MEMBRE", estAdmin: false };
    await refuse(modifierPresencesEnMasse({ sessionId: SEANCE, userIds: INVITES.slice(0, 3), statut: "PRESENT" }));
  });

  it("refuse un administrateur désactivé", async () => {
    faux.acteur = { ...faux.acteur, actif: false };
    await refuse(modifierPresencesEnMasse({ sessionId: SEANCE, userIds: INVITES.slice(0, 3), statut: "PRESENT" }));
  });

  it("refuse une séance inconnue", async () => {
    await refuse(modifierPresencesEnMasse({ sessionId: "s-inexistante", userIds: INVITES.slice(0, 3), statut: "PRESENT" }));
  });

  it("refuse une séance annulée", async () => {
    faux.seance = { id: SEANCE, periodId: PERIODE, annulee: true, period: { statut: "ACTIVE" } };
    await refuse(modifierPresencesEnMasse({ sessionId: SEANCE, userIds: INVITES.slice(0, 3), statut: "PRESENT" }));
  });

  it("refuse un statut inventé", async () => {
    await refuse(modifierPresencesEnMasse({ sessionId: SEANCE, userIds: INVITES.slice(0, 3), statut: "VIENDRA_PEUT_ETRE" as never }));
  });

  it("refuse une sélection vide", async () => {
    await refuse(modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [], statut: "PRESENT" }));
  });

  it("refuse le lot entier si une seule personne n'est pas invitée : on ne corrige pas 13 sur 14 en silence", async () => {
    await refuse(modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0], CHARLIE], statut: "PRESENT" }));
  });

  it("refuse le compte de service du portail, qui n'a pas de présence", async () => {
    await refuse(modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0], PORTAIL], statut: "PRESENT" }));
  });

  it("refuse un lot démesuré : une action serveur est une route ouverte", async () => {
    const enorme = Array.from({ length: 5000 }, (_, i) => `u-faux-${i}`);
    await refuse(modifierPresencesEnMasse({ sessionId: SEANCE, userIds: enorme, statut: "PRESENT" }));
  });

  it("rafraîchit les mêmes écrans que la correction unitaire", async () => {
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0]], statut: "PRESENT" });
    expect(faux.chemins).toEqual(expect.arrayContaining(["/seances", "/", "/planning", `/seances/${SEANCE}`, "/gestion/tableau-de-bord"]));
  });
});

/**
 * **Le registre d'un trimestre clos se lit, il ne se réécrit plus**.
 *
 * `CLAUDE.md` annonce que ce verrou est « lu par les quatre appelants » — la correction des réponses,
 * unitaire comme en masse, n'en faisait pas partie. Un appel forgé depuis une session ouverte par le
 * **seul lien personnel** d'un administrateur (donc sans mot de passe ni code) a ramené le registre
 * d'une séance de **11 réponses à 0**, puis déclaré les douze invités présents — **sur une période
 * CLOSE**, que l'écran ne propose jamais. Même asymétrie que celle du 01/10, où le verrou valait pour
 * la séance et pas pour la liste des séances : deux portes vers la même écriture ne peuvent pas avoir
 * deux serrures.
 *
 * Ce que ce verrou **ne** fait pas, et c'est une décision : il n'exige pas de session forte.
 * `attendances.autrui` en est dispensée exprès — on tient le registre un soir de cours, et un
 * instructeur n'a pas de session forte. C'est l'échelle qui change avec le lot, pas la serrure, et
 * les deux gestes ont exactement les mêmes verrous.
 */
describe("une période close ne corrige plus ses réponses", () => {
  it("refuse le lot, et n'écrit rien", async () => {
    faux.seance = { id: SEANCE, periodId: PERIODE, annulee: false, period: { statut: "CLOSE" } };
    const res = await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: [INVITES[0], INVITES[1]], statut: "ABSENT" });
    expect(res.ok).toBe(false);
    expect("erreur" in res && res.erreur).toContain("Ce trimestre est clos");
    expect(faux.ecritures, "aucune réponse n'a bougé").toEqual([]);
    expect(faux.audits, "et rien n'est inscrit au journal").toEqual([]);
  });
});
