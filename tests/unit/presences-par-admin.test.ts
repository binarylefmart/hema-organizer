import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, exigeSessionForte } from "@/lib/permissions";
import { participantsAPlat, type ListesParStatut, type Participant } from "@/lib/seances";

/**
 * **Corriger la réponse de quelqu'un d'autre** (écran de gestion d'une séance).
 *
 * Le besoin vient du terrain : untel est venu sans jamais répondre, tel autre avait coché
 * « présent » et n'est pas venu. Le taux de présence sert ensuite aux bilans du club, donc la
 * feuille doit pouvoir être tenue **après coup** — c'est de la tenue de registre, pas de
 * l'organisation :
 *
 * - c'est **réservé au bureau** : un instructeur organise (séances, planning, liens) mais ne
 *   réécrit pas la réponse des autres ;
 * - la correction reste possible **une fois le cours commencé** (à la différence de sa propre
 *   réponse, verrouillée au début du cours) : c'est précisément le moment où l'on sait qui est venu ;
 * - une séance **annulée** n'a pas de feuille à tenir, et on n'écrit rien pour quelqu'un qui
 *   **n'est pas invité** sur la période ;
 * - `null` **efface** la réponse (retour à « sans réponse »), ce qu'aucun bouton de membre ne fait ;
 * - et chaque correction laisse une trace : qui a écrit quoi, à la place de qui.
 */

/* ------------------------------------------------------------------ */
/* 1. Une ligne par invité : participantsAPlat                         */
/* ------------------------------------------------------------------ */

function gens(...noms: [string, string][]): Participant[] {
  return noms.map(([prenom, nom]) => ({ id: `u-${nom.toLowerCase()}`, prenom, nom, couleur: null }));
}

const VIDE: ListesParStatut = { presents: [], peutEtre: [], absents: [], sansReponse: [] };

describe("liste à plat des participants d'une séance", () => {
  /** Les quatre groupes de l'affichage en colonnes, volontairement en désordre. */
  const liste: ListesParStatut = {
    presents: gens(["Éloïse", "Delta"], ["Adrien", "Zacharie"]),
    peutEtre: gens(["Emma", "Durand"]),
    absents: gens(["Eloi", "Vasseur"]),
    sansReponse: gens(["Zoé", "Amblard"], ["Adrien", "Boucher"]),
  };

  it("range tout le monde par prénom puis nom, selon l'alphabet français", () => {
    // Le tri est celui de `localeCompare(…, "fr")` : l'accent ne renvoie pas en fin de liste
    // (Eloi < Éloïse < Emma), et à prénom égal c'est le nom qui départage.
    expect(participantsAPlat(liste).map((p) => `${p.prenom} ${p.nom}`)).toEqual([
      "Adrien Boucher",
      "Adrien Zacharie",
      "Eloi Vasseur",
      "Éloïse Delta",
      "Emma Durand",
      "Zoé Amblard",
    ]);
  });

  it("porte sur chaque ligne le statut du groupe d'origine, et null pour « sans réponse »", () => {
    const parNom = new Map(participantsAPlat(liste).map((p) => [p.prenom, p.statut]));
    expect(parNom.get("Éloïse")).toBe("PRESENT");
    expect(parNom.get("Adrien")).toBe("PRESENT"); // Adrien Zacharie est présent…
    expect(participantsAPlat(liste).find((p) => p.nom === "Boucher")?.statut).toBeNull(); // … Adrien Boucher n'a pas répondu
    expect(parNom.get("Emma")).toBe("PEUT_ETRE");
    expect(parNom.get("Eloi")).toBe("ABSENT");
    expect(parNom.get("Zoé")).toBeNull();
  });

  it("ne fait apparaître chaque invité qu'une seule fois", () => {
    const plat = participantsAPlat(liste);
    const attendus = liste.presents.length + liste.peutEtre.length + liste.absents.length + liste.sansReponse.length;
    expect(plat).toHaveLength(attendus);
    expect(new Set(plat.map((p) => p.id)).size).toBe(attendus);
  });

  it("conserve le reste de la fiche (identifiant, couleur)", () => {
    const avecCouleur: ListesParStatut = { ...VIDE, presents: [{ id: "u-chloe", prenom: "Chloé", nom: "Marchand", couleur: 3 }] };
    expect(participantsAPlat(avecCouleur)).toEqual([{ id: "u-chloe", prenom: "Chloé", nom: "Marchand", couleur: 3, statut: "PRESENT" }]);
  });

  it("rend une liste vide quand personne n'est invité", () => {
    expect(participantsAPlat(VIDE)).toEqual([]);
  });

  it("laisse les quatre groupes d'origine intacts (l'affichage en colonnes continue de servir)", () => {
    const presentsAvant = [...liste.presents];
    participantsAPlat(liste);
    expect(liste.presents).toEqual(presentsAvant);
    expect(liste.sansReponse).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Qui a le droit de corriger la réponse d'un autre                 */
/* ------------------------------------------------------------------ */

describe("qui peut corriger la réponse de quelqu'un d'autre", () => {
  it("le bureau, et lui seul (matrice de permissions)", () => {
    expect(can({ role: "INSTRUCTEUR", estAdmin: true, actif: true }, "attendances.autrui")).toBe(true);
    expect(can({ role: "INSTRUCTEUR", actif: true }, "attendances.autrui")).toBe(false);
    expect(can({ role: "MEMBRE", actif: true }, "attendances.autrui")).toBe(false);
  });

  it("jamais depuis un compte désactivé, ni sans personne connectée", () => {
    expect(can({ role: "INSTRUCTEUR", estAdmin: true, actif: false }, "attendances.autrui")).toBe(false);
    expect(can(null, "attendances.autrui")).toBe(false);
    expect(can(undefined, "attendances.autrui")).toBe(false);
  });

  /**
   * **Et il faut l'espace admin ouvert**. Pendant cinq jours ce geste en était dispensé, pour une
   * raison vraie : les administrateurs nominatifs entrent par leur lien personnel, et le carnet se
   * tient un soir de cours, pas devant un écran. Une relecture a mesuré ce que l'exemption laissait
   * passer — un appel forgé depuis une session ouverte par ce seul lien ramenait une séance de onze
   * réponses à zéro, puis déclarait les douze invités présents.
   *
   * Ce qui rend le verrou vivable n'est pas dans cette liste mais dans les deux actions, et les deux
   * décisions ne se séparent pas : on exige l'**espace admin ouvert** (une fois, valable douze
   * heures) et **non** un code récent, et **cocher repousse l'élévation** — sinon elle tomberait au
   * milieu d'une liste, la fiche d'une séance ne vivant pas dans `/admin/**`.
   */
  it("et il exige l'espace admin ouvert, comme les autres gestes du bureau", () => {
    expect(exigeSessionForte("attendances.autrui")).toBe(true);
    expect(exigeSessionForte("members.delete")).toBe(true);
    // Ce qui reste dispensé : régler ce que quelqu'un reçoit, qui ne touche à rien du club.
    expect(exigeSessionForte("notifications.autrui")).toBe(false);
  });

  it("répondre pour soi reste ouvert à tous : ce sont deux droits distincts", () => {
    expect(can({ role: "MEMBRE", actif: true }, "attendances.own")).toBe(true);
    expect(can({ role: "INSTRUCTEUR", actif: true }, "attendances.own")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 3. L'action serveur                                                 */
/* ------------------------------------------------------------------ */

const SEANCE = "s-1";
const PERIODE = "p-1";
const CHLOE = "u-chloe";
const CHARLIE = "u-charlie"; // membre du club, mais pas invité sur cette période
const FOXTROT = "u-foxtrot"; // administrateur : lui aussi peut être corrigé

/** `role` est le rôle **de base** (`MEMBRE` ou `INSTRUCTEUR`) ; le bureau est à part (`estAdmin`). */
type FauxCompte = { id: string; prenom: string; nom: string; email: string | null; role: string; estAdmin: boolean; actif: boolean; service: boolean };
type FauxSeance = { id: string; periodId: string; date: string; heureDebut: string; heureFin: string; lieu: string; theme: string; annulee: boolean; motifAnnulation: string | null; period: { statut: string } };

const faux = vi.hoisted(() => ({
  /**
   * Administrateur **avec l'espace admin ouvert** — le cas normal depuis que `attendances.autrui`
   * exige l'élévation. Les tests du durcissement, plus bas, remettent `sessionForte` à `false` pour
   * rejouer l'administrateur entré par son seul lien personnel.
   */
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `attendances.autrui` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que
  // par `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-delta", prenom: "Delta", nom: "Roy", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true, sessionId: "sess-1", sessionForte: true, reauthAt: null as Date | null, rappelEmail: true },
  comptes: [] as FauxCompte[],
  seance: null as FauxSeance | null,
  periodeStatut: "ACTIVE",
  /** Invités de la période (PeriodMember) */
  invites: [] as string[],
  presences: [] as { userId: string; sessionId: string; statut: string }[],
  audits: [] as { acteur: unknown; action: string; cible: string | null; details: unknown }[],
  chemins: [] as string[],
  /** Les chemins de retour passés à `exigerReauth` : dire *quand* le code est exigé ne suffit pas. */
  reauths: [] as string[],
  /** Les sessions dont l'élévation a été repoussée : c'est ce qui rend le verrou vivable. */
  elevations: [] as string[],
}));

function periode(filtreUserId?: string) {
  const membres = faux.invites.filter((id) => filtreUserId === undefined || id === filtreUserId).map((userId) => ({ userId, periodId: PERIODE }));
  return { id: PERIODE, nom: "T4 2026", statut: faux.periodeStatut, membres };
}

/** Le filtre `where: { userId }` posé sur les membres de la période, quelle que soit la forme de la requête. */
type SousMembres = { membres?: { where?: { userId?: string } } };
type SousPeriode = { include?: SousMembres; select?: SousMembres };
type ArgsSeance = { where: { id: string }; include?: { period?: SousPeriode }; select?: { period?: SousPeriode } };

function filtreMembres(args: ArgsSeance): string | undefined {
  const p = args.include?.period ?? args.select?.period;
  return (p?.include?.membres ?? p?.select?.membres)?.where?.userId;
}

type ClePresence = { userId: string; sessionId: string };
type OuPresence = { where: { userId_sessionId: ClePresence } };

const laPresence = (userId: string, sessionId: string) => faux.presences.find((p) => p.userId === userId && p.sessionId === sessionId);

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => faux.comptes.find((c) => (where.id ? c.id === where.id : c.email === where.email)) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const c = faux.comptes.find((u) => u.id === where.id);
        if (!c) throw new Error("Compte introuvable");
        return c;
      }),
      findMany: vi.fn(async () => faux.comptes),
      update: vi.fn(async ({ where }: { where: { id: string } }) => faux.comptes.find((u) => u.id === where.id) ?? null),
    },
    session: {
      findUnique: vi.fn(async (args: ArgsSeance) => {
        if (!faux.seance || faux.seance.id !== args.where.id) return null;
        return { ...faux.seance, period: periode(filtreMembres(args)), attendances: faux.presences.filter((p) => p.sessionId === args.where.id) };
      }),
      findUniqueOrThrow: vi.fn(async (args: ArgsSeance) => {
        if (!faux.seance || faux.seance.id !== args.where.id) throw new Error("Séance introuvable");
        return { ...faux.seance, period: periode(filtreMembres(args)), attendances: faux.presences.filter((p) => p.sessionId === args.where.id) };
      }),
    },
    period: { findUnique: vi.fn(async () => periode()), findUniqueOrThrow: vi.fn(async () => periode()) },
    periodMember: {
      findUnique: vi.fn(async ({ where }: { where: { periodId_userId?: { periodId: string; userId: string } } }) => {
        const c = where.periodId_userId;
        return c && faux.invites.includes(c.userId) ? { periodId: c.periodId, userId: c.userId } : null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { userId?: string } }) => (where.userId && faux.invites.includes(where.userId) ? { periodId: PERIODE, userId: where.userId } : null)),
      count: vi.fn(async ({ where }: { where: { userId?: string } }) => (where?.userId && faux.invites.includes(where.userId) ? 1 : 0)),
      findMany: vi.fn(async () => faux.invites.map((userId) => ({ periodId: PERIODE, userId }))),
    },
    attendance: {
      findUnique: vi.fn(async ({ where }: OuPresence) => laPresence(where.userId_sessionId.userId, where.userId_sessionId.sessionId) ?? null),
      upsert: vi.fn(async ({ where, create, update }: OuPresence & { create: ClePresence & { statut: string }; update: Record<string, unknown> }) => {
        const existante = laPresence(where.userId_sessionId.userId, where.userId_sessionId.sessionId);
        if (existante) return Object.assign(existante, update);
        const ligne = { ...create };
        faux.presences.push(ligne);
        return ligne;
      }),
      create: vi.fn(async ({ data }: { data: ClePresence & { statut: string } }) => {
        faux.presences.push({ ...data });
        return data;
      }),
      update: vi.fn(async ({ where, data }: OuPresence & { data: Record<string, unknown> }) => {
        const l = laPresence(where.userId_sessionId.userId, where.userId_sessionId.sessionId);
        if (!l) throw new Error("Réponse introuvable");
        return Object.assign(l, data);
      }),
      delete: vi.fn(async ({ where }: OuPresence) => {
        const { userId, sessionId } = where.userId_sessionId;
        const l = laPresence(userId, sessionId);
        if (!l) throw new Error("Réponse introuvable");
        faux.presences = faux.presences.filter((p) => p !== l);
        return l;
      }),
      deleteMany: vi.fn(async ({ where }: { where: ClePresence }) => {
        const avant = faux.presences.length;
        faux.presences = faux.presences.filter((p) => !(p.userId === where.userId && p.sessionId === where.sessionId));
        return { count: avant - faux.presences.length };
      }),
      findMany: vi.fn(async () => faux.presences),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => (typeof ops === "function" ? ops(undefined) : Promise.all(ops))),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (acteur: unknown, action: string, cible?: string | null, details?: unknown) => {
    faux.audits.push({ acteur, action, cible: cible ?? null, details });
  }),
}));

vi.mock("@/lib/auth/session", () => ({ touchSession: vi.fn(async () => {}), revokeAllSessions: vi.fn(async () => 0) }));
vi.mock("@/lib/auth/elevation", () => ({
  toucherElevation: vi.fn(async (sessionId: string) => {
    faux.elevations.push(sessionId);
  }),
}));

/** Le vrai contrôle d'accès (la matrice de permissions), avec l'acteur du test. */
vi.mock("@/lib/auth/current-user", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  const { DUREE_REAUTH_MS } = await vi.importActual<typeof import("@/lib/constants")>("@/lib/constants");
  const { redirect } = await import("next/navigation");
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
    /**
     * **Fidèle à la vraie, et c'est le point**. Les deux portes du bureau (`corrigerPresence*`)
     * n'ont pas d'autre verrou que celui-ci : vérifiées contre un mock qui ne refuse rien, elles
     * auraient été « testées » sans jamais rien refuser. Ce sont les trois lignes de
     * `src/lib/auth/current-user.ts`, avec **sa** constante importée (pas une durée recopiée, qui
     * dériverait le jour où le dépôt la change) : — rien du tout pour un non-admin : c'est ce qui
     * laisse le registre aux instructeurs ; — pas de session forte → `/connexion/admin` ; —
     * dernière preuve trop vieille → `/connexion/verifier`.
     */
    exigerReauth: vi.fn(async (u: typeof faux.acteur, suite: string) => {
      faux.reauths.push(suite);
      if (!u.estAdmin) return;
      if (!u.sessionForte) redirect(`/connexion/admin?suite=${suite}`);
      if (!u.reauthAt || Date.now() - u.reauthAt.getTime() > DUREE_REAUTH_MS) redirect(`/connexion/verifier?suite=${suite}`);
    }),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((chemin: string) => {
    faux.chemins.push(chemin);
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { modifierPresenceMembre, modifierPresencesEnMasse } = await import("@/actions/presences");

function compte(p: Partial<FauxCompte> & { id: string }): FauxCompte {
  return { prenom: "Prénom", nom: "Nom", email: null, role: "MEMBRE", estAdmin: false, actif: true, service: false, ...p };
}

/** Séance passée par défaut : c'est le cas d'usage — on tient le registre après le cours. */
function seance(p: Partial<FauxSeance> = {}): FauxSeance {
  return { id: SEANCE, periodId: PERIODE, date: "2020-01-09", heureDebut: "19:30", heureFin: "21:30", lieu: "Gymnase municipal", theme: "Messer", annulee: false, motifAnnulation: null, period: { statut: "ACTIVE" }, ...p };
}

const statutDe = (userId: string) => laPresence(userId, SEANCE)?.statut ?? null;

/**
 * Un refus, quelle que soit la forme choisie par l'action (exception d'accès ou résultat d'erreur) :
 * ce qui est vérifié ici, c'est la règle — rien n'est écrit, rien n'est journalisé.
 */
async function refuse(promesse: Promise<unknown>): Promise<void> {
  const avant = JSON.stringify(faux.presences);
  let resultat: unknown;
  let aLeve = false;
  try {
    resultat = await promesse;
  } catch {
    aLeve = true;
  }
  const r = resultat as { ok?: boolean; erreur?: string } | undefined;
  expect(aLeve || r?.ok === false || Boolean(r?.erreur), `refus attendu, reçu ${JSON.stringify(resultat)}`).toBe(true);
  expect(JSON.stringify(faux.presences)).toBe(avant);
  expect(faux.audits).toEqual([]);
}

beforeEach(() => {
  faux.acteur = { id: "u-delta", prenom: "Delta", nom: "Roy", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true, sessionId: "sess-1", sessionForte: true, reauthAt: null, rappelEmail: true };
  faux.comptes = [
    compte({ id: "u-delta", prenom: "Delta", nom: "Roy", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true }),
    compte({ id: "u-echo", prenom: "Echo", nom: "Leroy", email: "echo@club.test", role: "INSTRUCTEUR" }),
    compte({ id: CHLOE, prenom: "Chloé", nom: "Marchand", email: "chloe@club.test" }),
    compte({ id: CHARLIE, prenom: "Charlie", nom: "Ledoux", email: "charlie@club.test" }),
    compte({ id: FOXTROT, prenom: "Foxtrot", nom: "Aubert", email: "foxtrot@club.test", role: "INSTRUCTEUR", estAdmin: true }),
  ];
  faux.seance = seance();
  faux.periodeStatut = "ACTIVE";
  faux.invites = [CHLOE, FOXTROT, "u-echo"];
  faux.presences = [];
  faux.audits = [];
  faux.chemins = [];
  faux.reauths = [];
  faux.elevations = [];
});

describe("correction de la réponse d'un membre par le bureau", () => {
  it("écrit la réponse à la place de la personne, même une fois le cours commencé", async () => {
    expect(statutDe(CHLOE)).toBeNull();
    const res = (await modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "PRESENT" })) as { ok?: boolean; erreur?: string };
    expect(res?.erreur).toBeUndefined();
    expect(res?.ok ?? true).toBe(true);
    expect(statutDe(CHLOE)).toBe("PRESENT");
  });

  it("corrige une réponse déjà donnée, sans toucher à celle des autres", async () => {
    faux.presences = [
      { userId: CHLOE, sessionId: SEANCE, statut: "PRESENT" },
      { userId: FOXTROT, sessionId: SEANCE, statut: "PEUT_ETRE" },
    ];
    await modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "ABSENT" });
    expect(statutDe(CHLOE)).toBe("ABSENT");
    expect(statutDe(FOXTROT)).toBe("PEUT_ETRE");
  });

  it("efface la réponse quand le statut est null (retour à « sans réponse »)", async () => {
    faux.presences = [{ userId: CHLOE, sessionId: SEANCE, statut: "PRESENT" }];
    const res = (await modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: null })) as { ok?: boolean; erreur?: string };
    expect(res?.erreur).toBeUndefined();
    expect(statutDe(CHLOE)).toBeNull();
    expect(faux.presences.filter((p) => p.userId === CHLOE)).toEqual([]);
  });

  it("corrige aussi la réponse d'un instructeur ou d'un autre administrateur", async () => {
    await modifierPresenceMembre({ sessionId: SEANCE, userId: FOXTROT, statut: "PRESENT" });
    await modifierPresenceMembre({ sessionId: SEANCE, userId: "u-echo", statut: "ABSENT" });
    expect(statutDe(FOXTROT)).toBe("PRESENT");
    expect(statutDe("u-echo")).toBe("ABSENT");
  });

  it("garde la trace de qui a écrit à la place de qui", async () => {
    await modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "PRESENT" });
    expect(faux.audits).toHaveLength(1);
    expect(faux.audits[0].action).toBe("presence.modifiee_par_admin");
    expect(faux.audits[0].acteur).toMatchObject({ id: "u-delta" });
    expect(JSON.stringify(faux.audits[0])).toContain(CHLOE);
  });

  /*
   * **`estAdmin: false` est ici le cœur du test, pas un détail de forme**. L'acteur de référence
   * est désormais un instructeur **du bureau** ; l'oublier dans ce dérivé laisserait le supplément
   * passer par le `...faux.acteur` et le refus ne refuserait plus rien. C'est la contre-épreuve
   * exacte du modèle : même rôle de base, bureau en moins.
   */
  it("refuse un instructeur : organiser n'est pas réécrire la réponse des autres", async () => {
    faux.acteur = { ...faux.acteur, id: "u-echo", prenom: "Echo", nom: "Leroy", email: "echo@club.test", role: "INSTRUCTEUR", estAdmin: false };
    await refuse(modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "PRESENT" }));
  });

  it("refuse un membre, y compris pour lui-même (il a son propre bouton)", async () => {
    faux.acteur = { ...faux.acteur, id: CHLOE, prenom: "Chloé", nom: "Marchand", email: "chloe@club.test", role: "MEMBRE", estAdmin: false };
    await refuse(modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "PRESENT" }));
  });

  it("refuse un administrateur désactivé", async () => {
    faux.acteur = { ...faux.acteur, actif: false };
    await refuse(modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "PRESENT" }));
  });

  it("refuse sur une séance annulée : il n'y a pas de feuille à tenir", async () => {
    faux.seance = seance({ annulee: true, motifAnnulation: "Gymnase fermé" });
    await refuse(modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "PRESENT" }));
  });

  it("refuse pour quelqu'un qui n'est pas invité sur la période", async () => {
    await refuse(modifierPresenceMembre({ sessionId: SEANCE, userId: CHARLIE, statut: "PRESENT" }));
  });

  it("refuse sur une séance inconnue", async () => {
    await refuse(modifierPresenceMembre({ sessionId: "s-inexistante", userId: CHLOE, statut: "PRESENT" }));
  });

  it("refuse un statut inventé", async () => {
    await refuse(modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "VIENDRA_PEUT_ETRE" as never }));
  });

  it("fonctionne aussi avant le cours (la correction n'est pas réservée à l'après-coup)", async () => {
    faux.seance = seance({ date: "2099-01-09" });
    await modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "PEUT_ETRE" });
    expect(statutDe(CHLOE)).toBe("PEUT_ETRE");
  });
});

/**
 * **Le geste unitaire porte le même verrou que son jumeau de masse** — et c'est la règle du dépôt :
 * deux portes vers la même écriture ne peuvent pas avoir deux serrures. La relecture de sécurité a
 * trouvé les deux ouvertes sur un trimestre clos ; elles se referment ensemble.
 */
describe("une période close ne corrige plus ses réponses", () => {
  it("refuse la correction unitaire, et n'écrit rien", async () => {
    // Le statut vient de `faux.periodeStatut` : c'est le jeu d'essai de ce fichier qui le porte.
    faux.periodeStatut = "CLOSE";
    const res = (await modifierPresenceMembre({ sessionId: SEANCE, userId: CHLOE, statut: "ABSENT" })) as { ok?: boolean; erreur?: string };
    expect(res.ok).toBe(false);
    expect(res.erreur).toContain("Ce trimestre est clos");
    expect(faux.audits).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Le registre derrière l'espace admin                              */
/* ------------------------------------------------------------------ */

/**
 * **Corriger le registre exige l'espace admin ouvert**.
 *
 * Ce que ces tests gardent, c'est un **couple** de décisions qui ne se séparent pas : le verrou, et
 * ce qui le rend tenable un soir de cours. Posé seul, il renverrait sur `/connexion/admin` au milieu
 * d'une liste de quatre-vingts noms ; et la correction posée seule n'aurait rien à repousser.
 */
describe("corriger le registre exige l'espace admin ouvert", () => {
  const ALLER = { sessionId: SEANCE, userId: CHLOE, statut: "PRESENT" as const };

  it("refuse l'administrateur entré par son seul lien personnel, et n'écrit rien", async () => {
    faux.acteur.sessionForte = false; // entré par `/invitation/<jeton>`, sans mot de passe
    const res = (await modifierPresenceMembre(ALLER)) as { ok?: boolean; erreur?: string };
    expect(res.ok).toBe(false);
    expect(faux.presences).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("et le lui dit de façon réparable : « ouvre l'espace admin », pas « tu n'as pas le droit »", async () => {
    /*
     * Les deux refus de cette action ne se corrigent pas du tout pareil : un instructeur n'y pourra
     * rien, un administrateur en est à dix secondes près. Un message unique enverrait le bureau
     * chercher un droit qu'il a déjà.
     */
    faux.acteur.sessionForte = false;
    const admin = (await modifierPresenceMembre(ALLER)) as { erreur?: string };
    expect(admin.erreur).toContain("espace admin");

    faux.acteur.estAdmin = false; // un instructeur, cette fois
    const instructeur = (await modifierPresenceMembre(ALLER)) as { erreur?: string };
    expect(instructeur.erreur).toContain("Tu n'as pas le droit");
    expect(instructeur.erreur).not.toContain("espace admin");
  });

  it("refuse le lot entier de la même façon", async () => {
    faux.acteur.sessionForte = false;
    const res = (await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: faux.invites, statut: "ABSENT" })) as { ok?: boolean };
    expect(res.ok).toBe(false);
    expect(faux.presences).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("écrit, avec son audit, quand l'espace admin est ouvert", async () => {
    const res = (await modifierPresenceMembre(ALLER)) as { ok?: boolean };
    expect(res.ok).toBe(true);
    expect(laPresence(CHLOE, SEANCE)?.statut).toBe("PRESENT");
    expect(faux.audits.map((a) => a.action)).toEqual(["presence.modifiee_par_admin"]);
  });

  /**
   * **La moitié qui rend le verrou vivable.** L'élévation tombe après dix minutes sans geste dans
   * `/admin/**`, et on corrige le plus souvent depuis la fiche d'une séance, qui n'en fait pas
   * partie. Sans ce geste-ci, le bureau serait mis dehors au milieu de son registre — exactement le
   * défaut qui avait justifié l'exemption d'origine.
   */
  it("cocher une présence repousse l'élévation, à l'unité comme en lot", async () => {
    await modifierPresenceMembre(ALLER);
    expect(faux.elevations).toEqual(["sess-1"]);
    await modifierPresencesEnMasse({ sessionId: SEANCE, userIds: faux.invites, statut: "ABSENT" });
    expect(faux.elevations).toEqual(["sess-1", "sess-1"]);
  });

  it("et ne la repousse jamais sur un refus : il n'y a rien à prolonger", async () => {
    faux.acteur.sessionForte = false;
    await modifierPresenceMembre(ALLER);
    faux.periodeStatut = "CLOSE";
    faux.acteur.sessionForte = true;
    await modifierPresenceMembre(ALLER);
    expect(faux.elevations).toEqual([]);
  });

  it("n'exige en revanche aucun code récent : on en redonnerait un toutes les dix minutes", async () => {
    await modifierPresenceMembre(ALLER);
    expect(faux.reauths).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Une seule paire d'écritures, et un seul jeu de verrous           */
/* ------------------------------------------------------------------ */

/**
 * Le 02/10 en fin d'après-midi, l'écran du bureau est passé par deux portes à lui
 * (`corrigerPresence*`) qui ajoutaient `exigerReauth` avant de déléguer. Elles ont vécu deux heures :
 * dès que la règle a été posée sur la **permission**, elles ne protégeaient plus rien que leur propre
 * écran — celui qui exige déjà l'élévation pour s'afficher — tout en laissant croire à un verrou. Ce
 * test garde leur disparition : **une seule paire d'écritures**, donc une seule serrure à vérifier.
 */
describe("une seule paire d'écritures pour le registre", () => {
  const lire = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("les deux écrans montent le même composant, sans drapeau d'aiguillage", () => {
    for (const f of ["src/app/(app)/admin/presences/page.tsx", "src/app/(app)/seances/[id]/page.tsx"]) {
      const code = lire(f);
      expect(code, f).toContain("<PresencesEquipe");
      expect(code, f).not.toContain("depuisBureau");
    }
  });

  it("et le composant n'appelle que les deux actions, jamais une variante", () => {
    const comp = lire("src/components/gestion/PresencesEquipe.tsx");
    expect(comp).toContain("await modifierPresenceMembre(");
    expect(comp).toContain("await modifierPresencesEnMasse(");
    expect(comp).not.toContain("corrigerPresence");
  });

  it("la fiche de séance ne montre pas un registre qui ne pourrait que refuser", () => {
    const fiche = lire("src/app/(app)/seances/[id]/page.tsx");
    // Le droit, puis l'élévation : sans la seconde, une phrase qui mène à la porte, pas un registre.
    expect(fiche).toMatch(/can\(user, "attendances\.autrui"\) &&\s*\(user\.sessionForte \?/);
    expect(fiche).toContain("/connexion/admin?suite=");
  });
});
