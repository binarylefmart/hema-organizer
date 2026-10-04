import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Les gestes d'accès de l'annuaire, à l'unité, en sélection et pour tout le monde.**
 *
 * La demande : pouvoir, depuis la liste des membres, **renvoyer** ou **révoquer** le lien,
 * **envoyer l'invitation** (à qui n'est jamais entré) ou **réinitialiser les accès** (de qui l'est
 * déjà), pour une personne, pour les cases cochées ou pour tout le monde.
 *
 * Ce fichier protège ce qu'un geste de masse relâche facilement :
 *
 * - **les verrous du geste unitaire** : la permission (`invitations.manage` pour les liens,
 *   `members.manage` pour la réinitialisation), `canEditUser`, le compte du portail intouchable, et
 *   un **code récent** avant la première écriture — jamais demandé pour un geste à blanc ;
 * - **la frontière « déjà entré »** (`aDejaUnAcces`) : l'invitation n'efface rien et ne part qu'aux
 *   jamais entrés ; la réinitialisation efface et ne touche que les déjà entrés. Les gardes serveur
 *   refusent l'unitaire du mauvais côté, la masse saute et compte ;
 * - **une entrée d'audit par personne**, sous l'action du geste unitaire.
 */

type Compte = {
  id: string;
  prenom: string;
  nom: string;
  email: string | null;
  role: string;
  estAdmin: boolean;
  actif: boolean;
  service: boolean;
  passwordHash: string | null;
  totpSecret: string | null;
  totpActiveAt: Date | null;
  sessions: number;
  liensOuverts: number;
};
type Lien = { id: string; userId: string; periodId: string; vivant: boolean };

const faux = vi.hoisted(() => ({
  acteur: { id: "u-admin", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true } as { id: string; email: string; role: string; estAdmin: boolean; actif: boolean },
  comptes: [] as Compte[],
  liens: [] as Lien[],
  periode: { id: "per-1", statut: "ACTIVE" } as { id: string; statut: string } | null,
  revoques: [] as string[],
  envois: [] as { userId: string; periodId: string; motif: string; options: unknown }[],
  remisesAZero: [] as string[],
  audits: [] as { action: string; cible: string | null; details: Record<string, unknown> }[],
  reauths: [] as string[],
  codePerime: false,
}));

/** Ce que Prisma rendrait pour `CHAMPS_TEMOINS_ACCES` : les deux compteurs. */
const avecTemoins = (c: Compte) => ({ ...c, _count: { authSessions: c.sessions, invitations: c.liensOuverts } });

vi.mock("@/lib/db", () => {
  const filtreUsers = (where: Record<string, unknown> = {}) => {
    const ids = (where.id as { in?: string[] } | undefined)?.in;
    if (ids) return faux.comptes.filter((c) => ids.includes(c.id));
    // « Tout le monde » : `perimetreToutLeMonde` (portail et soi-même exclus), plus l'éventuel filtre des liens vivants.
    const exclu = (where.id as { not?: string } | undefined)?.not;
    let liste = faux.comptes.filter((c) => !c.service && c.id !== exclu);
    if (where.invitations) liste = liste.filter((c) => faux.liens.some((l) => l.userId === c.id && l.vivant));
    return liste;
  };
  const trier = (liste: Compte[]) => [...liste].sort((a, b) => `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, "fr"));
  return {
    db: {
      user: {
        findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => trier(filtreUsers(where)).map(avecTemoins)),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const c = faux.comptes.find((x) => x.id === where.id);
          return c ? avecTemoins(c) : null;
        }),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
          const c = faux.comptes.find((x) => x.id === where.id);
          if (!c) throw new Error("introuvable");
          return avecTemoins(c);
        }),
      },
      invitation: {
        findMany: vi.fn(async ({ where }: { where: { userId: string | { in: string[] }; periodId: string } }) => {
          const ids = typeof where.userId === "string" ? [where.userId] : where.userId.in;
          return faux.liens.filter((l) => ids.includes(l.userId) && l.periodId === where.periodId && l.vivant).map((l) => ({ id: l.id, userId: l.userId }));
        }),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
          const l = faux.liens.find((x) => x.id === where.id);
          if (!l) throw new Error("introuvable");
          return l;
        }),
      },
      period: {
        findUnique: vi.fn(async () => faux.periode),
        findUniqueOrThrow: vi.fn(async () => {
          if (!faux.periode) throw new Error("introuvable");
          return { ...faux.periode, membres: faux.comptes.map((c) => ({ userId: c.id, user: c })) };
        }),
      },
    },
  };
});

vi.mock("@/lib/invitations", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/invitations")>("@/lib/invitations");
  return {
    ERREUR_COMPTE_SERVICE: vrai.ERREUR_COMPTE_SERVICE,
    conditionLiensARevoquer: vrai.conditionLiensARevoquer,
    LIENS_AVANT_DEBUT_JOURS: vrai.LIENS_AVANT_DEBUT_JOURS,
    remettreEnServiceLiensDeCloture: vi.fn(async () => 0),
    revokeInvitation: vi.fn(async (id: string) => {
      faux.revoques.push(id);
    }),
    envoyerInvitation: vi.fn(async (userId: string, periodId: string, motif: string, options: unknown) => {
      faux.envois.push({ userId, periodId, motif, options });
      return true;
    }),
  };
});

vi.mock("@/lib/reinitialisation-acces", () => ({
  remettreAccesAZero: vi.fn(async (cible: { id: string; email: string | null }) => {
    faux.remisesAZero.push(cible.id);
    return { liensRevoques: 1, sessionsFermees: 2, lienRenvoye: Boolean(cible.email) };
  }),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, cible: string | null, details: Record<string, unknown>) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0) }));

// La matrice réelle des permissions tranche : l'acteur simulé change simplement de rôle.
vi.mock("@/lib/auth/current-user", async () => {
  const { can } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof can>[1]) => {
      if (!can(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async (_u: unknown, suite: string) => {
      faux.reauths.push(suite);
      if (faux.codePerime) throw new Error(`REDIRECTION:/connexion/verifier?suite=${suite}`);
    }),
    getCurrentUser: vi.fn(async () => faux.acteur),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { revoquerLienMembre, revoquerLiensEnMasse, envoyerInvitationsEnMasse, reinitialiserAccesEnMasse } = await import("@/app/(app)/admin/membres/actions");
const { envoyerInvitationMembre, reinitialiserAccesMembre } = await import("@/actions/membres");
const { revoquerInvitation, renvoyerTousLesLiens } = await import("@/actions/periodes");
const { aDejaUnAcces, temoinsAcces } = await import("@/lib/membres");
const { DEJA_ENTRE, JAMAIS_ENTRE } = await import("@/app/(app)/admin/membres/tout-le-monde");
const { resumeInvitations, resumeReinitialisation, texteConfirmationInvitations, texteConfirmationReinitialisation, texteConfirmationRevocationTous } = await import(
  "@/app/(app)/admin/membres/selection-liens"
);

const compte = (id: string, options: Partial<Compte> = {}): Compte => ({
  id,
  prenom: id,
  nom: "Test",
  email: `${id}@club.test`,
  role: "MEMBRE",
  estAdmin: false,
  actif: true,
  service: false,
  passwordHash: null,
  totpSecret: null,
  totpActiveAt: null,
  sessions: 0,
  liensOuverts: 0,
  ...options,
});
/** Quelqu'un d'installé : il a déjà ouvert son lien et a une session. */
const installe = (id: string, options: Partial<Compte> = {}) => compte(id, { liensOuverts: 1, sessions: 1, ...options });

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true };
  faux.comptes = [compte("u-admin", { estAdmin: true, passwordHash: "x", sessions: 1 })];
  faux.liens = [];
  faux.periode = { id: "per-1", statut: "ACTIVE" };
  faux.revoques = [];
  faux.envois = [];
  faux.remisesAZero = [];
  faux.audits = [];
  faux.reauths = [];
  faux.codePerime = false;
});

const INSTRUCTEUR = { id: "u-instr", email: "i@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };

describe("« déjà entré » : une seule fonction pour l'écran et les gardes", () => {
  it("un seul témoin suffit, aucun ne veut dire « jamais entré »", () => {
    const rien = { aOuvertUnLien: false, aUnMotDePasse: false, aLaDeuxFa: false, aUneSession: false };
    expect(aDejaUnAcces(rien)).toBe(false);
    for (const cle of Object.keys(rien) as (keyof typeof rien)[]) expect(aDejaUnAcces({ ...rien, [cle]: true }), cle).toBe(true);
  });

  it("lit les témoins sur un compte tel que Prisma le rend", () => {
    expect(temoinsAcces({ passwordHash: null, totpActiveAt: null, _count: { authSessions: 0, invitations: 0 } })).toEqual({
      aOuvertUnLien: false,
      aUnMotDePasse: false,
      aLaDeuxFa: false,
      aUneSession: false,
    });
    expect(aDejaUnAcces(temoinsAcces({ passwordHash: null, totpActiveAt: null, _count: { authSessions: 0, invitations: 1 } }))).toBe(true);
  });

  it("les filtres de base posent les mêmes quatre questions, l'un en « ou », l'autre en « aucun »", () => {
    expect(DEJA_ENTRE.OR).toHaveLength(4);
    expect(Object.keys(JAMAIS_ENTRE).sort()).toEqual(["authSessions", "invitations", "passwordHash", "totpActiveAt"]);
    const champsDeja = DEJA_ENTRE.OR.map((o) => Object.keys(o)[0]).sort();
    expect(champsDeja).toEqual(Object.keys(JAMAIS_ENTRE).sort());
  });
});

describe("révoquer le lien d'une ligne", () => {
  beforeEach(() => {
    faux.comptes.push(installe("chloe"));
    faux.liens = [{ id: "inv-1", userId: "chloe", periodId: "per-1", vivant: true }];
  });

  it("révoque ses liens vivants, demande le code avec la suite de l'écran, et journalise", async () => {
    const res = await revoquerLienMembre("chloe", "per-1", "/admin/membres?q=chl");
    expect(res.succes).toContain("révoqué");
    expect(faux.reauths).toEqual(["/admin/membres?q=chl"]);
    expect(faux.revoques).toEqual(["inv-1"]);
    expect(faux.audits).toEqual([{ action: "invitation.revoquee", cible: "per-1", details: { userId: "chloe", liens: 1 } }]);
  });

  it("sans lien en cours, refuse sans réclamer de code", async () => {
    faux.liens = [];
    const res = await revoquerLienMembre("chloe", "per-1");
    expect(res.erreur).toContain("rien à révoquer");
    expect(faux.reauths).toEqual([]);
  });

  it("refuse le compte du portail, et un instructeur", async () => {
    faux.comptes.push(compte("portail", { service: true }));
    expect((await revoquerLienMembre("portail", "per-1")).erreur).toContain("portail");
    faux.acteur = INSTRUCTEUR;
    await expect(revoquerLienMembre("chloe", "per-1")).rejects.toThrow("Accès refusé");
    expect(faux.revoques).toEqual([]);
  });

  it("n'écrit rien quand le code est trop vieux", async () => {
    faux.codePerime = true;
    await expect(revoquerLienMembre("chloe", "per-1")).rejects.toThrow("REDIRECTION");
    expect(faux.revoques).toEqual([]);
    expect(faux.audits).toEqual([]);
  });
});

describe("révoquer le lien en masse", () => {
  beforeEach(() => {
    faux.comptes.push(installe("chloe"), installe("marc"), compte("zoe"));
    faux.liens = [
      { id: "inv-c", userId: "chloe", periodId: "per-1", vivant: true },
      { id: "inv-m", userId: "marc", periodId: "per-1", vivant: true },
    ];
  });

  it("révoque ceux qui ont un lien, nomme les autres, un code et une trace par personne", async () => {
    const res = await revoquerLiensEnMasse({ periodId: "per-1", userIds: ["chloe", "marc", "zoe"] });
    expect(res.succes).toContain("2 liens révoqués");
    expect(res.succes).toContain("zoe");
    expect(faux.reauths).toHaveLength(1);
    expect(faux.revoques.sort()).toEqual(["inv-c", "inv-m"]);
    expect(faux.audits.map((a) => [a.action, a.details.userId, a.details.enMasse])).toEqual([
      ["invitation.revoquee", "chloe", true],
      ["invitation.revoquee", "marc", true],
    ]);
  });

  it("refuse le lot entier si son propre compte ou le portail s'y trouve", async () => {
    faux.comptes.push(compte("portail", { service: true }));
    for (const intrus of ["u-admin", "portail"]) {
      const res = await revoquerLiensEnMasse({ periodId: "per-1", userIds: ["chloe", intrus] });
      expect(res.erreur).toContain("le lot entier est refusé");
    }
    expect(faux.revoques).toEqual([]);
    expect(faux.reauths).toEqual([]);
  });

  it("pour tout le monde, ne prend que ceux qui ont un lien vivant, hors soi-même", async () => {
    faux.liens.push({ id: "inv-a", userId: "u-admin", periodId: "per-1", vivant: true });
    const res = await revoquerLiensEnMasse({ periodId: "per-1", tous: true });
    expect(res.succes).toContain("2 liens révoqués");
    expect(faux.revoques).not.toContain("inv-a");
    expect(faux.audits.every((a) => a.details.tous === true)).toBe(true);
  });

  it("refuse à qui n'a pas `invitations.manage`", async () => {
    faux.acteur = INSTRUCTEUR;
    await expect(revoquerLiensEnMasse({ periodId: "per-1", tous: true })).rejects.toThrow("Accès refusé");
  });
});

describe("envoyer l'invitation : seulement à qui n'est jamais entré, et rien n'est effacé", () => {
  it("l'unitaire envoie le parcours complet après le code, et journalise", async () => {
    faux.comptes.push(compte("zoe"));
    await envoyerInvitationMembre("zoe", "per-1", "/admin/membres");
    expect(faux.reauths).toEqual(["/admin/membres"]);
    expect(faux.envois).toEqual([{ userId: "zoe", periodId: "per-1", motif: "invitation", options: { parcours: "force" } }]);
    expect(faux.remisesAZero).toEqual([]);
    expect(faux.audits[0]).toMatchObject({ action: "invitation.envoyee", cible: "per-1", details: { userId: "zoe" } });
  });

  it("l'unitaire refuse un compte déjà entré — garde serveur, pas seulement un bouton masqué — sans réclamer de code", async () => {
    faux.comptes.push(compte("chloe", { passwordHash: "x" }));
    await expect(envoyerInvitationMembre("chloe", "per-1")).rejects.toThrow("déjà entré");
    expect(faux.reauths).toEqual([]);
    expect(faux.envois).toEqual([]);
  });

  it("l'unitaire refuse un compte désactivé, le portail, et un instructeur", async () => {
    faux.comptes.push(compte("zoe", { actif: false }), compte("portail", { service: true }));
    await expect(envoyerInvitationMembre("zoe", "per-1")).rejects.toThrow("désactivé");
    await expect(envoyerInvitationMembre("portail", "per-1")).rejects.toThrow();
    faux.acteur = INSTRUCTEUR;
    await expect(envoyerInvitationMembre("zoe", "per-1")).rejects.toThrow("Accès refusé");
    expect(faux.envois).toEqual([]);
  });

  it("en masse, saute et compte les déjà entrés, un code et une trace par envoi", async () => {
    faux.comptes.push(compte("zoe"), compte("yann"), installe("chloe"), compte("sans", { email: null }));
    const res = await envoyerInvitationsEnMasse({ periodId: "per-1", userIds: ["zoe", "yann", "chloe", "sans"] });
    expect(res.succes).toContain("2 invitations envoyées");
    expect(res.succes).toContain("1 personne ignorée (déjà entrées");
    expect(res.succes).toContain("sans adresse email");
    expect(faux.reauths).toHaveLength(1);
    expect(faux.envois.map((e) => e.userId).sort()).toEqual(["yann", "zoe"]);
    expect(faux.audits.map((a) => a.action)).toEqual(["invitation.envoyee", "invitation.envoyee"]);
  });

  it("en masse, quand tout le monde est déjà entré, ne réclame aucun code", async () => {
    faux.comptes.push(installe("chloe"));
    const res = await envoyerInvitationsEnMasse({ periodId: "per-1", tous: true });
    expect(res.erreur).toContain("Aucune invitation");
    expect(faux.reauths).toEqual([]);
  });

  it("en masse, refuse une période close avant tout code", async () => {
    faux.comptes.push(compte("zoe"));
    faux.periode = { id: "per-1", statut: "CLOSE" };
    expect((await envoyerInvitationsEnMasse({ periodId: "per-1", userIds: ["zoe"] })).erreur).toContain("close");
    expect(faux.reauths).toEqual([]);
  });
});

describe("réinitialiser les accès : seulement qui est déjà entré", () => {
  it("l'unitaire refuse un compte jamais entré, sans réclamer de code", async () => {
    faux.comptes.push(compte("zoe"));
    await expect(reinitialiserAccesMembre("zoe")).rejects.toThrow("jamais entré");
    expect(faux.reauths).toEqual([]);
    expect(faux.remisesAZero).toEqual([]);
  });

  it("l'unitaire passe la suite de l'écran au code redonné", async () => {
    faux.comptes.push(installe("chloe"));
    await reinitialiserAccesMembre("chloe", "/admin/membres?tout=1");
    expect(faux.reauths).toEqual(["/admin/membres?tout=1"]);
    expect(faux.remisesAZero).toEqual(["chloe"]);
    expect(faux.audits[0].action).toBe("membre.acces_reinitialise");
  });

  it("en masse, saute et compte les jamais entrés, un code et une trace par personne", async () => {
    faux.comptes.push(installe("chloe"), installe("marc", { email: null }), compte("zoe"));
    const res = await reinitialiserAccesEnMasse({ userIds: ["chloe", "marc", "zoe"] });
    expect(res.succes).toContain("2 accès réinitialisés");
    expect(res.succes).toContain("1 invitation neuve");
    expect(res.succes).toContain("jamais entrées");
    expect(faux.reauths).toHaveLength(1);
    expect(faux.remisesAZero).toEqual(["chloe", "marc"]);
    expect(faux.audits.map((a) => [a.action, a.cible, a.details.enMasse])).toEqual([
      ["membre.acces_reinitialise", "chloe", true],
      ["membre.acces_reinitialise", "marc", true],
    ]);
  });

  it("en masse, refuse le lot entier si son propre compte s'y trouve", async () => {
    faux.comptes.push(installe("chloe"));
    const res = await reinitialiserAccesEnMasse({ userIds: ["chloe", "u-admin"] });
    expect(res.erreur).toContain("le lot entier est refusé");
    expect(faux.remisesAZero).toEqual([]);
  });

  it("pour tout le monde, jamais soi-même ni le portail", async () => {
    faux.comptes.push(installe("chloe"), installe("portail", { service: true }));
    await reinitialiserAccesEnMasse({ tous: true });
    expect(faux.remisesAZero).toEqual(["chloe"]);
  });

  it("refuse à qui n'a pas `members.manage`", async () => {
    faux.acteur = INSTRUCTEUR;
    await expect(reinitialiserAccesEnMasse({ tous: true })).rejects.toThrow("Accès refusé");
  });
});

describe("les portes de la page d'une période suivent", () => {
  it("révoquer une invitation demande désormais le code, avec la suite de l'écran d'origine", async () => {
    faux.comptes.push(installe("chloe"));
    faux.liens = [{ id: "inv-1", userId: "chloe", periodId: "per-1", vivant: true }];
    await revoquerInvitation("inv-1", "/admin/membres/chloe");
    expect(faux.reauths).toEqual(["/admin/membres/chloe"]);
    expect(faux.revoques).toEqual(["inv-1"]);
    faux.reauths = [];
    await revoquerInvitation("inv-1");
    expect(faux.reauths).toEqual(["/admin/periodes/per-1"]);
  });

  it("« Renvoyer le lien à tout le monde » ramène à la liste des membres après le code", async () => {
    await renvoyerTousLesLiens("per-1", "/admin/membres");
    expect(faux.reauths).toEqual(["/admin/membres"]);
    faux.reauths = [];
    await renvoyerTousLesLiens("per-1");
    expect(faux.reauths).toEqual(["/admin/periodes/per-1"]);
  });
});

describe("ce que les confirmations annoncent", () => {
  const ligne = (nom: string, o: Partial<{ actif: boolean; aUnEmail: boolean; dejaEntre: boolean; recoitInvitation: boolean }> = {}) => ({
    id: nom,
    nom,
    actif: true,
    aUnEmail: true,
    dejaEntre: false,
    recoitInvitation: true,
    ...o,
  });

  it("l'invitation compte ses emails et nomme les déjà entrés qu'elle saute", () => {
    const r = resumeInvitations([ligne("Zoé"), ligne("Chloé", { dejaEntre: true }), ligne("Paul", { aUnEmail: false })]);
    expect(r).toEqual({ emails: 1, dejaEntres: ["Chloé"], inactifs: [], sansEmail: ["Paul"] });
    const texte = texteConfirmationInvitations(r);
    expect(texte).toContain("1 email partira");
    expect(texte).toContain("Rien n'est effacé");
    expect(texte).toContain("Chloé");
  });

  it("la réinitialisation dit ce qu'elle efface, compte ses emails et saute les jamais entrés", () => {
    const r = resumeReinitialisation([ligne("Chloé", { dejaEntre: true }), ligne("Marc", { dejaEntre: true, recoitInvitation: false }), ligne("Zoé")]);
    expect(r).toEqual({ total: 2, emails: 1, muets: ["Marc"], jamaisEntres: ["Zoé"] });
    const texte = texteConfirmationReinitialisation(r);
    expect(texte).toContain("efface le mot de passe et la double authentification");
    expect(texte).toContain("1 email partira");
    expect(texte).toContain("Zoé");
  });

  it("la révocation pour tout le monde dit qu'aucun email ne part et que les sessions restent", () => {
    const texte = texteConfirmationRevocationTous(5, "Automne");
    expect(texte).toContain("5 liens");
    expect(texte).toContain("Aucun email ne part");
    expect(texte).toContain("appareils déjà connectés le restent");
  });
});
