import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Remettre l'accès de quelqu'un à zéro**, demandé par Delta.
 *
 * Le besoin : téléphone perdu *et* mot de passe oublié, retour au club après une absence, doute sur
 * un compte. Jusque-là le bureau pouvait renvoyer un lien, mais l'ancien mot de passe et l'ancienne
 * double authentification restaient en place — donc l'ancienne porte aussi. Ce geste efface les
 * deux facteurs **et** tout ce qui permet de les contourner, puis laisse la personne exactement
 * dans l'état d'un nouveau membre : plus aucune façon d'entrer tant qu'on ne l'a pas réinvitée.
 *
 * Ce qu'il ne fait **pas**, et c'est le point qui rassure : toucher à son histoire. Présences,
 * ateliers, réponses restent. On remet à neuf l'accès, pas la personne.
 */

const faux = vi.hoisted(() => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `members.manage` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true } as { id: string; email: string; role: string; estAdmin: boolean; actif: boolean },
  cible: {} as Record<string, unknown>,
  majs: [] as { where: unknown; data: Record<string, unknown> }[],
  liens: [] as { id: string }[],
  revoques: [] as string[],
  sessionsRevoquees: [] as { userId: string; saufCourante: boolean }[],
  audits: [] as { action: string; cible: string | null; details: unknown }[],
  reauths: [] as string[],
  inscription: null as { periodId: string } | null,
  invitationsEnvoyees: [] as { userId: string; periodId: string; motif: string; options: unknown }[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUniqueOrThrow: vi.fn(async () => faux.cible),
      update: vi.fn(async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
        faux.majs.push({ where, data });
        return faux.cible;
      }),
    },
    invitation: { findMany: vi.fn(async () => faux.liens) },
    periodMember: { findFirst: vi.fn(async () => faux.inscription) },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/invitations", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/invitations")>("@/lib/invitations");
  return {
    ERREUR_COMPTE_SERVICE: vrai.ERREUR_COMPTE_SERVICE,
    // Le vrai filtre : c'est lui qui décide quels liens la remise à zéro ferme (voir plus bas).
    conditionLiensARevoquer: vrai.conditionLiensARevoquer,
    envoyerInvitation: vi.fn(async (userId: string, periodId: string, motif: string, options: unknown) => {
      faux.invitationsEnvoyees.push({ userId, periodId, motif, options });
      return true;
    }),
    revokeInvitation: vi.fn(async (id: string) => {
      faux.revoques.push(id);
    }),
    lienARenouveler: vrai.lienARenouveler,
  };
});

vi.mock("@/lib/auth/session", () => ({
  revokeAllSessions: vi.fn(async (userId: string, saufCourante: boolean) => {
    faux.sessionsRevoquees.push({ userId, saufCourante });
    return 3;
  }),
}));

// La matrice réelle décide : l'acteur simulé change simplement de rôle.
vi.mock("@/lib/auth/current-user", async () => {
  const { can } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof can>[1]) => {
      if (!can(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async (_u: unknown, suite: string) => {
      faux.reauths.push(suite);
    }),
    getCurrentUser: vi.fn(async () => faux.acteur),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { reinitialiserAccesMembre } = await import("@/actions/membres");

const EQUIPE = { prenom: "Bravo", nom: "02", email: "bravo@exemple.fr", actif: true, service: false, passwordHash: "$argon2id$x", totpSecret: "chiffre", totpActiveAt: new Date() };

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  faux.cible = { id: "u-m1", role: "MEMBRE", ...EQUIPE };
  faux.majs = [];
  faux.liens = [{ id: "inv-1" }, { id: "inv-2" }];
  faux.revoques = [];
  faux.sessionsRevoquees = [];
  faux.audits = [];
  faux.reauths = [];
  faux.inscription = { periodId: "per-1" };
  faux.invitationsEnvoyees = [];
});

describe("ce que la remise à zéro efface", () => {
  it("efface les deux facteurs et tout ce qui permet de les contourner", async () => {
    await reinitialiserAccesMembre("u-m1");
    expect(faux.majs).toHaveLength(1);
    expect(faux.majs[0].data).toEqual({
      passwordHash: null,
      doitChangerMotDePasse: false,
      totpSecret: null,
      totpActiveAt: null,
      codesSecours: null,
      deuxFaProposeeLe: null,
    });
  });

  it("révoque les liens en cours : « réinitialiser » veut dire qu'aucune porte ne reste ouverte", async () => {
    await reinitialiserAccesMembre("u-m1");
    expect(faux.revoques).toEqual(["inv-1", "inv-2"]);
  });

  it("déconnecte tous les appareils, sans en épargner aucun", async () => {
    // Une session ouverte survivrait à tout le reste et rendrait la remise à zéro décorative
    await reinitialiserAccesMembre("u-m1");
    expect(faux.sessionsRevoquees).toEqual([{ userId: "u-m1", saufCourante: false }]);
  });

  it("ne touche ni au compte ni à son histoire", async () => {
    await reinitialiserAccesMembre("u-m1");
    const data = faux.majs[0].data;
    // Ni suppression, ni désactivation, ni changement de rôle : c'est l'accès qu'on remet à neuf
    expect(data).not.toHaveProperty("actif");
    expect(data).not.toHaveProperty("role");
    expect(data).not.toHaveProperty("email");
  });

  it("laisse au journal de quoi comprendre ce qui a été effacé", async () => {
    await reinitialiserAccesMembre("u-m1");
    expect(faux.audits).toEqual([
      {
        action: "membre.acces_reinitialise",
        cible: "u-m1",
        details: { avaitMotDePasse: true, avaitDeuxFa: true, liensRevoques: 2, sessionsFermees: 3, lienRenvoye: true },
      },
    ]);
  });
});

/**
 * **Remettre à zéro, c'est aussi rendre une porte**. Sans ce renvoi, la personne se retrouvait
 * dehors sans le savoir : liens morts, appareils déconnectés, et aucun email.
 */
describe("le lien neuf qui part dans la foulée", () => {
  it("renvoie un lien qui rejoue le parcours d'entrée complet, sur le trimestre en cours", async () => {
    await reinitialiserAccesMembre("u-m1");
    expect(faux.invitationsEnvoyees).toEqual([
      // `force` : mot de passe et 2FA venant d'être effacés, la personne refait tout le parcours
      { userId: "u-m1", periodId: "per-1", motif: "reinitialisation", options: { deconnecterAppareils: "tous", parcours: "force" } },
    ]);
  });

  it("n'envoie rien sans trimestre en cours, et le journal le dit", async () => {
    faux.inscription = null;
    await reinitialiserAccesMembre("u-m1");
    expect(faux.invitationsEnvoyees).toEqual([]);
    expect(faux.audits[0].details).toMatchObject({ lienRenvoye: false });
  });

  it("n'envoie rien à quelqu'un sans adresse email", async () => {
    faux.cible = { id: "u-m1", role: "MEMBRE", ...EQUIPE, email: null };
    await reinitialiserAccesMembre("u-m1");
    expect(faux.invitationsEnvoyees).toEqual([]);
  });
});

describe("qui peut le faire", () => {
  it("exige un code 2FA récent, comme les autres gestes qui coupent un accès", async () => {
    await reinitialiserAccesMembre("u-m1");
    expect(faux.reauths).toEqual(["/admin/membres/u-m1"]);
  });

  it("refuse un instructeur : les comptes appartiennent au bureau", async () => {
    faux.acteur = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    await expect(reinitialiserAccesMembre("u-m1")).rejects.toThrow("Accès refusé");
    expect(faux.majs).toEqual([]);
    expect(faux.revoques).toEqual([]);
  });

  it("refuse de vider le compte de connexion du portail : c'est la porte de secours du club", async () => {
    // Le compte du portail porte un **rôle de base neutre** et `estAdmin` : c'est ce que le seed
    // écrit (voir `tests/unit/seed-admin.test.ts`), et il n'enseigne rien.
    faux.cible = { id: "portail", role: "MEMBRE", estAdmin: true, ...EQUIPE, service: true };
    /*
     * Le refus renvoyait le message des **invitations** (« ne peut pas être invité à une
     * période »), qui ne décrit pas le bouton sur lequel on vient d'appuyer — corrigé en même temps
     * que (« les autres admin ne doivent pas pouvoir reset ses mdp ou 2fa »). Le contre-exemple est
     * gardé par `tests/unit/compte-permanent-acces.test.ts`.
     */
    await expect(reinitialiserAccesMembre("portail")).rejects.toThrow("ne se remet pas à zéro depuis un autre compte");
    expect(faux.majs).toEqual([]);
  });
});
