import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Renouvellement automatique des liens personnels** (balayage de 07:00, `entretienQuotidien`).
 *
 * Ce que ce fichier verrouille, à :
 *
 * - **aucun filtre de rôle** : membres, instructeurs et administrateurs nominatifs sont renouvelés
 *   de la même façon, et chacun reçoit son nouveau lien par email ;
 * - les seules conditions sont celles qui rendent l'envoi possible : compte actif, adresse email,
 *   période non close, lien pas déjà remplacé ;
 * - l'ancien lien **survit jusqu'à son terme** (`garderAnciens`) : personne n'est coupé en route ;
 * - un cas bancal (compte de service inscrit par erreur) **n'arrête pas** le balayage des autres.
 */

type Invitation = { id: string; userId: string; periodId: string; expiresAt: Date; revokedAt: Date | null };

const faux = vi.hoisted(() => ({
  comptes: [] as Record<string, unknown>[],
  periodes: [] as Record<string, unknown>[],
  invitations: [] as Record<string, unknown>[],
  crees: [] as Record<string, unknown>[],
  envois: [] as { to: string; ref: string }[],
  deconnexions: [] as { userId: string; saufCourante: boolean }[],
}));

const compte = (id: string) => faux.comptes.find((u) => u.id === id) ?? null;
const periode = (id: string) => faux.periodes.find((p) => p.id === id) ?? null;

// L'email d'invitation porte le nom de l'application : il est lu dans l'identité du club, que ces
// tests-ci n'ont pas à peupler (leur simulacre de base ne connaît pas la table `Setting`).
vi.mock("@/lib/identite", () => ({ identite: vi.fn(async () => ({ nomCourt: "CEA Organizer" })) }));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => compte(where.id)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const u = compte(where.id);
        if (!u) throw new Error("compte introuvable");
        return u;
      }),
    },
    period: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => periode(where.id)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const p = periode(where.id);
        if (!p) throw new Error("période introuvable");
        return p;
      }),
    },
    invitation: {
      findFirst: vi.fn(async () => null),
      /**
       * Rejoue les deux requêtes du balayage : « les liens qui expirent bientôt » puis
       * « ceux qui ont déjà un remplaçant ». On applique les clauses réellement utilisées.
       */
      findMany: vi.fn(async ({ where }: { where: Record<string, never> }) => {
        const w = where as Record<string, { lt?: Date; gte?: Date } | null | Record<string, unknown>>;
        const exp = w.expiresAt as { lt?: Date; gte?: Date } | undefined;
        const u = w.user as { actif?: boolean; email?: { not: null } } | undefined;
        const p = w.period as { statut?: { not: string } } | undefined;
        const userIn = (w.userId as { in?: string[] } | undefined)?.in;
        const periodIn = (w.periodId as { in?: string[] } | undefined)?.in;
        return faux.invitations.filter((i) => {
          if (w.revokedAt === null && i.revokedAt !== null) return false;
          const e = i.expiresAt as Date;
          if (exp?.lt && !(e.getTime() < exp.lt.getTime())) return false;
          if (exp?.gte && !(e.getTime() >= exp.gte.getTime())) return false;
          if (userIn && !userIn.includes(i.userId as string)) return false;
          if (periodIn && !periodIn.includes(i.periodId as string)) return false;
          const utilisateur = compte(i.userId as string);
          if (u?.actif !== undefined && utilisateur?.actif !== u.actif) return false;
          if (u?.email && !utilisateur?.email) return false;
          const per = periode(i.periodId as string);
          if (p?.statut?.not && per?.statut === p.statut.not) return false;
          return true;
        });
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.crees.push(data);
        faux.invitations.push({ ...data, id: `inv-${faux.crees.length}`, revokedAt: null });
        return data;
      }),
    },
    periodMember: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  revokeAllSessions: vi.fn(async (userId: string, saufCourante?: boolean) => {
    faux.deconnexions.push({ userId, saufCourante: !!saufCourante });
    return 1;
  }),
}));

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((args: { to: string; ref: string }) => {
    faux.envois.push({ to: args.to, ref: args.ref });
  }),
}));

const { envoyerInvitation, renouvelerLiensExpirants, RENOUVELLEMENT_AVANT_MS } = await import("@/lib/invitations");

const MAINTENANT = new Date("2026-09-23T07:00:00Z");
/** Un lien qui arrive à terme dans trois jours : dans la fenêtre des 7 jours du balayage. */
const BIENTOT = new Date(MAINTENANT.getTime() + 3 * 86_400_000);

/**
 * **`estAdmin` est un supplément au rôle de base** : « ADMIN » n'est plus une valeur de `role`, et
 * ce qui veut savoir si quelqu'un est du bureau lit le booléen. Le helper le porte pour que les
 * scénarios ci-dessous décrivent la base telle qu'elle est — un balayage qui se mettrait un jour à
 * filtrer sur l'un ou l'autre champ trouverait ici les quatre formes de compte réelles.
 */
function inscrire(p: { id: string; role: string; estAdmin?: boolean; email?: string | null; actif?: boolean; service?: boolean; periodId?: string; expiresAt?: Date }): Invitation {
  faux.comptes.push({ id: p.id, prenom: p.id, email: p.email === undefined ? `${p.id}@club.test` : p.email, role: p.role, estAdmin: p.estAdmin ?? false, actif: p.actif ?? true, service: p.service ?? false });
  const inv = { id: `inv-${p.id}`, userId: p.id, periodId: p.periodId ?? "per-1", expiresAt: p.expiresAt ?? BIENTOT, revokedAt: null };
  faux.invitations.push(inv as unknown as Record<string, unknown>);
  return inv;
}

beforeEach(() => {
  faux.comptes = [];
  faux.periodes = [{ id: "per-1", nom: "T1 2026-2027", statut: "ACTIVE" }, { id: "per-close", nom: "T4 2025", statut: "CLOSE" }];
  faux.invitations = [];
  faux.crees = [];
  faux.envois = [];
  faux.deconnexions = [];
});

describe("balayage quotidien des liens", () => {
  it("renouvelle tout le monde, quel que soit le rôle, et renvoie le lien par email", async () => {
    inscrire({ id: "chloe", role: "MEMBRE" });
    inscrire({ id: "charlie", role: "INSTRUCTEUR" });
    // Les deux formes du bureau : celui qui n'enseigne pas, et **l'instructeur du bureau** — que
    // l'ancien modèle rendait impossible (les trois rôles étant exclusifs). Les deux sont là parce
    // que « quel que soit le rôle » n'a de sens que si les quatre comptes que la base peut porter
    // sont représentés : un filtre glissé un jour dans le balayage, sur `role` comme sur
    // `estAdmin`, priverait l'un des quatre de son lien sans que rien ne le dise.
    inscrire({ id: "delta", role: "MEMBRE", estAdmin: true });
    inscrire({ id: "elodie", role: "INSTRUCTEUR", estAdmin: true });

    expect(await renouvelerLiensExpirants(MAINTENANT)).toBe(4);
    /*
     * Un email à chacun, et un lien tout neuf en base pour chacun. **La liste attendue se déduit des
     * comptes inscrits** au lieu d'être recopiée à côté d'eux : `.sort()` range des adresses, pas les
     * lignes du test, si bien qu'une liste écrite à la main cessait d'être triée dès qu'un de ces
     * quatre comptes changeait de nom — et le test tombait alors que le balayage faisait exactement
     * son travail. Déduite, elle dit ce qu'elle a toujours dit : ces quatre-là, et personne d'autre.
     */
    expect(faux.envois.map((e) => e.to).sort()).toEqual(faux.comptes.map((c) => c.email).sort());
    expect(faux.envois.every((e) => e.ref.startsWith("invitation_"))).toBe(true);
    expect(faux.crees).toHaveLength(4);
    // L'ancien lien n'est pas coupé : il vit jusqu'à son terme (`garderAnciens`)
    const { db } = await import("@/lib/db");
    expect(db.invitation.updateMany).not.toHaveBeenCalled();
  });

  it("laisse de côté ce qui ne peut pas être renouvelé, sans toucher au reste", async () => {
    inscrire({ id: "chloe", role: "MEMBRE" }); // renouvelée
    inscrire({ id: "sans-adresse", role: "MEMBRE", email: null });
    inscrire({ id: "desactive", role: "INSTRUCTEUR", actif: false });
    inscrire({ id: "periode-close", role: "MEMBRE", periodId: "per-close" });
    inscrire({ id: "encore-loin", role: "MEMBRE", estAdmin: true, expiresAt: new Date(MAINTENANT.getTime() + 60 * 86_400_000) });

    expect(await renouvelerLiensExpirants(MAINTENANT)).toBe(1);
    expect(faux.envois.map((e) => e.to)).toEqual(["chloe@club.test"]);
  });

  it("ne renvoie pas deux fois à qui a déjà un lien neuf", async () => {
    inscrire({ id: "chloe", role: "MEMBRE" });
    // Renouvellement déjà émis hier : un second lien, encore loin de son terme
    faux.invitations.push({ id: "inv-neuve", userId: "chloe", periodId: "per-1", expiresAt: new Date(MAINTENANT.getTime() + 100 * 86_400_000), revokedAt: null });

    expect(await renouvelerLiensExpirants(MAINTENANT)).toBe(0);
    expect(faux.envois).toHaveLength(0);
  });

  /** Un cas bancal ne doit pas priver les suivants de leur lien : l'échec est isolé. */
  it("continue le balayage quand une personne échoue", async () => {
    inscrire({ id: "portail", role: "MEMBRE", estAdmin: true, service: true }); // `createInvitation` refuse le compte de service
    inscrire({ id: "chloe", role: "MEMBRE" });
    inscrire({ id: "charlie", role: "INSTRUCTEUR" });

    expect(await renouvelerLiensExpirants(MAINTENANT)).toBe(2);
    // Les deux autres, **déduits du jeu d'essai** (même raison qu'au-dessus : une liste d'adresses
    // écrite à la main n'est plus triée dès qu'un nom change) : le compte de service est le seul que
    // `createInvitation` refuse, tous les autres inscrits ici reçoivent leur lien.
    expect(faux.envois.map((e) => e.to).sort()).toEqual(
      faux.comptes
        .filter((c) => !c.service)
        .map((c) => c.email)
        .sort(),
    );
  });

  it("regarde bien 7 jours devant lui", () => {
    expect(RENOUVELLEMENT_AVANT_MS).toBe(7 * 86_400_000);
  });
});

/* ---------------------------------------------------------------- */
/* Régénérer déconnecte ; renouveler à l'expiration ne déconnecte pas */
/* ---------------------------------------------------------------- */

describe("un nouveau lien déconnecte-t-il les appareils ?", () => {
  /**
   * La distinction, et le piège qu'elle évite : si le **renouvellement automatique** déconnectait
   * aussi, tout le club se retrouverait dehors le même matin, tous les quatre mois, sans avoir rien
   * demandé. Voir `OptionsEnvoi` dans src/lib/invitations.ts.
   */
  it("ne déconnecte personne sur le balayage d'expiration", async () => {
    inscrire({ id: "chloe", role: "MEMBRE" });
    inscrire({ id: "charlie", role: "INSTRUCTEUR" });
    expect(await renouvelerLiensExpirants(MAINTENANT)).toBe(2);
    expect(faux.deconnexions).toEqual([]);
  });

  it("déconnecte tous les appareils sur une régénération décidée par l'équipe", async () => {
    inscrire({ id: "chloe", role: "MEMBRE" });
    await envoyerInvitation("chloe", "per-1", "invitation", { deconnecterAppareils: "tous" });
    expect(faux.deconnexions).toEqual([{ userId: "chloe", saufCourante: false }]);
  });

  it("épargne la session en cours quand la personne demande elle-même son lien", async () => {
    inscrire({ id: "chloe", role: "MEMBRE" });
    await envoyerInvitation("chloe", "per-1", "renouvellement", { deconnecterAppareils: "autres" });
    // Elle est devant son écran : ce sont ses **autres** appareils qu'elle coupe, pas celui-ci
    expect(faux.deconnexions).toEqual([{ userId: "chloe", saufCourante: true }]);
  });

  it("ne déconnecte personne sur un envoi de masse (activation, correction d'adresses)", async () => {
    inscrire({ id: "chloe", role: "MEMBRE" });
    await envoyerInvitation("chloe", "per-1");
    expect(faux.deconnexions).toEqual([]);
  });

  it("ne déconnecte que la personne concernée, jamais les autres", async () => {
    inscrire({ id: "chloe", role: "MEMBRE" });
    inscrire({ id: "charlie", role: "INSTRUCTEUR" });
    await envoyerInvitation("chloe", "per-1", "securite", { deconnecterAppareils: "tous" });
    expect(faux.deconnexions.map((d) => d.userId)).toEqual(["chloe"]);
  });
});
