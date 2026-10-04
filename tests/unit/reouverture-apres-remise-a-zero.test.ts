import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Rouvrir un trimestre ne doit pas ressusciter un lien qu'une remise à zéro avait dû tuer.**
 *
 * Le scénario, joué ici de bout en bout :
 *
 * 1. **décembre** — le trimestre d'automne est clos. La clôture estampille `CLOTURE` sur tous les
 *    liens vivants de la période : celui de Chloé, envoyé en novembre, est donc révoqué — mais il
 *    est encore *valable* au sens de sa date (un lien vaut quatre mois) ;
 * 2. **janvier** — la boîte mail de Chloé est compromise. Le bureau remet son accès à zéro : mot de
 *    passe effacé, 2FA retirée, liens révoqués, appareils déconnectés. Aucun trimestre n'étant
 *    ouvert, aucun lien neuf ne part — c'est normal, et c'est dit ;
 * 3. **février** — le bureau rouvre le trimestre d'automne pour corriger une présence oubliée. La
 *    réouverture rend les liens que *la clôture* avait fermés, c'est son métier.
 *
 * Le trou : la remise à zéro ne visait que les liens `revokedAt: null`. Celui de Chloé, déjà
 * estampillé `CLOTURE`, était **sauté** et gardait ce motif — si bien qu'à l'étape 3 la réouverture
 * le remettait en service. Le lien de novembre redevenait une clé valide, dans la boîte mail qu'on
 * avait justement voulu fermer, et personne au club n'avait de raison de s'en douter.
 *
 * Le correctif : une révocation décidée par l'équipe ré-estampille **toutes** les invitations encore
 * valables (`conditionLiensARevoquer`, src/lib/invitations.ts), révoquées ou non. Ce fichier rejoue
 * le scénario complet, sur une base simulée qui garde vraiment l'état des liens.
 *
 * **Le même trou existait sur le second geste de cette famille** : corriger l'**adresse email** de
 * quelqu'un (`revoquerLiensApresChangementEmail`, motif `REMPLACE`). Le scénario y est encore plus
 * direct — la boîte a fuité, le bureau change l'adresse pour cette raison précise, et le lien de
 * novembre restait dans la boîte fuitée, prêt à redevenir une clé à la première réouverture. Les
 * deux gestes sont donc joués ici, avec la même base simulée.
 *
 * Et puisque l'écran **annonce** ce qui a été fermé, ce fichier garde aussi la phrase : elle
 * s'écrivait inconditionnellement, y compris quand rien n'avait été révoqué — le bureau repartait
 * convaincu que l'ancienne boîte ne pouvait plus rien ouvrir (`messageChangementAdresse`).
 */

type Lien = {
  id: string;
  userId: string;
  periodId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  motifRevocation: string | null;
};

const faux = vi.hoisted(() => ({
  liens: [] as Lien[],
  periodes: [] as Array<{ id: string; statut: string; dateDebut: string; liensEnvoyesLe: Date | null }>,
  /** Le trimestre ouvert où un lien neuf pourrait partir — aucun, dans le scénario. */
  inscription: null as { periodId: string } | null,
  invitationsEnvoyees: [] as string[],
  audits: [] as { action: string; details: unknown }[],
}));

/** Un `where` de Prisma, réduit à ce que ces trois actions demandent réellement. */
type Filtre = Record<string, unknown>;

function correspond(lien: Lien, where: Filtre): boolean {
  for (const [cle, valeur] of Object.entries(where)) {
    if (cle === "OR") {
      if (!(valeur as Filtre[]).some((sous) => correspond(lien, sous))) return false;
      continue;
    }
    const champ = (lien as unknown as Record<string, unknown>)[cle];
    if (valeur === null) {
      if (champ !== null && champ !== undefined) return false;
    } else if (typeof valeur === "object" && valeur !== null) {
      const v = valeur as { in?: unknown[]; gt?: Date };
      if (v.in && !v.in.includes(champ as never)) return false;
      if (v.gt && !((champ as Date).getTime() > v.gt.getTime())) return false;
    } else if (champ !== valeur) {
      return false;
    }
  }
  return true;
}

vi.mock("@/lib/db", () => ({
  db: {
    invitation: {
      findMany: vi.fn(async ({ where, orderBy }: { where: Filtre; orderBy?: { createdAt: "desc" } }) => {
        let trouves = faux.liens.filter((l) => correspond(l, where));
        if (orderBy?.createdAt === "desc") trouves = [...trouves].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return trouves.map((l) => ({ ...l }));
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Filtre; data: Partial<Lien> }) => {
        const vises = faux.liens.filter((l) => correspond(l, where));
        for (const l of vises) Object.assign(l, data);
        return { count: vises.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Lien> }) => {
        const l = faux.liens.find((x) => x.id === where.id);
        if (!l) throw new Error("Invitation introuvable");
        Object.assign(l, data);
        return l;
      }),
    },
    period: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const p = faux.periodes.find((x) => x.id === where.id);
        if (!p) throw new Error("Période introuvable");
        return p;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = faux.periodes.find((x) => x.id === where.id);
        Object.assign(p ?? {}, data);
        return p;
      }),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => CHLOE),
      // « Cette adresse est-elle déjà celle de quelqu'un d'autre ? » — non, dans ce scénario.
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => CHLOE),
    },
    periodMember: { findFirst: vi.fn(async () => faux.inscription) },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, _cible: unknown, details: unknown) => {
    faux.audits.push({ action, details });
  }),
}));

vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0) }));

// L'envoi d'email est le seul point simulé côté invitations : tout le reste (le filtre de
// révocation, la remise en service) est le vrai code, c'est lui qu'on éprouve.
vi.mock("@/lib/invitations", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/invitations")>("@/lib/invitations");
  return {
    ...vrai,
    envoyerInvitation: vi.fn(async (userId: string) => {
      faux.invitationsEnvoyees.push(userId);
      return true;
    }),
  };
});

vi.mock("@/lib/auth/current-user", () => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `periods.manage` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  assertPermission: vi.fn(async () => ({ id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true })),
  exigerReauth: vi.fn(async () => {}),
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const CHLOE = {
  id: "u-chloe",
  prenom: "Chloé",
  nom: "Dupont",
  email: "chloe@compromise.fr",
  role: "MEMBRE",
  actif: true,
  service: false,
  passwordHash: "$argon2id$x",
  totpSecret: null,
  totpActiveAt: null,
};

const { reinitialiserAccesMembre, definirEmailMembre } = await import("@/actions/membres");
const { clorePeriode, reactiverPeriode } = await import("@/actions/periodes");

const DANS_DEUX_MOIS = new Date(Date.now() + 60 * 86_400_000);

/** Le formulaire d'adresse de la liste des membres, réduit à son unique champ. */
function formulaireEmail(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

/** L'état qui décide : ce lien ouvre-t-il encore l'application ? */
function ouvreEncore(id: string): boolean {
  const l = faux.liens.find((x) => x.id === id);
  return Boolean(l && l.revokedAt === null && l.expiresAt.getTime() > Date.now());
}

beforeEach(() => {
  faux.liens = [
    // Le lien de novembre, envoyé pour le trimestre d'automne, valable jusqu'en mars.
    { id: "inv-novembre", userId: "u-chloe", periodId: "p-automne", createdAt: new Date("2026-11-02T08:00:00Z"), expiresAt: DANS_DEUX_MOIS, revokedAt: null, motifRevocation: null },
  ];
  faux.periodes = [{ id: "p-automne", statut: "ACTIVE", dateDebut: "2026-09-01", liensEnvoyesLe: new Date("2026-08-29T07:00:00Z") }];
  // Aucun trimestre ouvert au moment de la remise à zéro : c'est bien le cas qui piégeait.
  faux.inscription = null;
  faux.invitationsEnvoyees = [];
  faux.audits = [];
});

describe("boîte mail compromise, accès remis à zéro, trimestre rouvert", () => {
  it("ne rend pas le lien de novembre à la réouverture de février", async () => {
    // Décembre : la clôture estampille CLOTURE sur le lien vivant
    await clorePeriode("p-automne");
    expect(faux.liens[0].motifRevocation).toBe("CLOTURE");

    // Janvier : le bureau remet l'accès de Chloé à zéro
    await reinitialiserAccesMembre("u-chloe");
    // Aucun trimestre ouvert : rien ne part, et c'est le cas qui laissait le lien intact
    expect(faux.invitationsEnvoyees).toEqual([]);
    // Le motif a changé : ce n'est plus la clôture qui tient ce lien fermé, c'est la décision du bureau
    expect(faux.liens[0].motifRevocation, "le lien doit être ré-estampillé, pas sauté").toBe("MANUEL");

    // Février : on rouvre le trimestre pour corriger une présence
    await reactiverPeriode("p-automne");
    expect(ouvreEncore("inv-novembre"), "le lien de la boîte compromise ne doit jamais revivre").toBe(false);
  });

  it("rend en revanche les liens que la clôture seule avait fermés (la réouverture garde son métier)", async () => {
    faux.liens.push({
      id: "inv-bravo",
      userId: "u-bravo",
      periodId: "p-automne",
      createdAt: new Date("2026-11-02T08:00:00Z"),
      expiresAt: DANS_DEUX_MOIS,
      revokedAt: null,
      motifRevocation: null,
    });
    await clorePeriode("p-automne");
    await reinitialiserAccesMembre("u-chloe");
    await reactiverPeriode("p-automne");
    // Bravo n'a rien fait de particulier : il retrouve son accès, c'est tout l'intérêt du geste
    expect(ouvreEncore("inv-bravo")).toBe(true);
    expect(ouvreEncore("inv-novembre")).toBe(false);
  });

  it("compte le lien déjà estampillé dans ce que le journal dit avoir révoqué", async () => {
    await clorePeriode("p-automne");
    faux.audits = [];
    await reinitialiserAccesMembre("u-chloe");
    expect(faux.audits[0]).toMatchObject({ action: "membre.acces_reinitialise", details: { liensRevoques: 1 } });
  });
});

/**
 * **Ce que le correctif ne doit pas relâcher.** `SUSPECT`, `APPAREILS` et `REMPLACE` ferment plus
 * fort que `MANUEL` : la page du lien annonce la révocation même à quelqu'un de déjà connecté
 * (`revocationDeSecurite` / `entrerMalgreLienInvalide`). Les ré-estampiller en `MANUEL` ferait
 * perdre cette parole — et aucune réouverture ne les ressuscite, puisqu'elle ne rend que les
 * `CLOTURE`. Ils sont donc laissés tels quels.
 */
describe("les révocations de sécurité gardent leur motif", () => {
  it("ne repasse pas un lien SUSPECT en MANUEL", async () => {
    faux.liens = [
      { id: "inv-suspect", userId: "u-chloe", periodId: "p-automne", createdAt: new Date("2026-11-02T08:00:00Z"), expiresAt: DANS_DEUX_MOIS, revokedAt: new Date("2026-12-01T10:00:00Z"), motifRevocation: "SUSPECT" },
    ];
    await reinitialiserAccesMembre("u-chloe");
    expect(faux.liens[0].motifRevocation).toBe("SUSPECT");
    expect(ouvreEncore("inv-suspect")).toBe(false);
  });

  it("laisse tranquille un lien déjà expiré : il n'ouvre plus rien, le réécrire brouillerait le journal", async () => {
    faux.liens = [
      { id: "inv-perime", userId: "u-chloe", periodId: "p-automne", createdAt: new Date("2026-01-02T08:00:00Z"), expiresAt: new Date(Date.now() - 86_400_000), revokedAt: null, motifRevocation: null },
    ];
    await reinitialiserAccesMembre("u-chloe");
    expect(faux.liens[0].motifRevocation).toBeNull();
    expect(ouvreEncore("inv-perime")).toBe(false);
  });
});

/**
 * **Le second geste de la même famille : corriger l'adresse email.**
 *
 * Le scénario est le plus direct des deux, parce que c'est *la fuite* qui motive le geste : la boîte
 * de Chloé est compromise, le bureau lui met une nouvelle adresse. `revoquerLiensApresChangementEmail`
 * doit alors tuer **toutes** ses clés encore valables — y compris celle que la clôture du trimestre
 * d'automne avait fermée d'un motif `CLOTURE`, car c'est exactement celle que la réouverture de
 * février rend. Sans ce filtre, le geste censé fermer la boîte fuitée y laissait la clé la plus
 * discrète du lot.
 */
describe("boîte mail compromise, adresse corrigée, trimestre rouvert", () => {
  it("ne rend pas à la réouverture le lien que le changement d'adresse devait tuer", async () => {
    // Décembre : la clôture estampille CLOTURE sur le lien de novembre
    await clorePeriode("p-automne");
    expect(faux.liens[0].motifRevocation).toBe("CLOTURE");

    // Janvier : on corrige l'adresse, précisément parce que l'ancienne boîte a fuité
    const res = await definirEmailMembre("u-chloe", undefined, {}, formulaireEmail("chloe@refuge.fr"));
    expect(res.erreur).toBeUndefined();
    // `REMPLACE` ferme plus fort que `CLOTURE` : la page du lien l'annoncera, même à qui est connecté
    expect(faux.liens[0].motifRevocation, "le lien clos doit être ré-estampillé, pas sauté").toBe("REMPLACE");

    // Février : on rouvre le trimestre pour corriger une présence
    await reactiverPeriode("p-automne");
    expect(ouvreEncore("inv-novembre"), "la clé de la boîte fuitée ne doit jamais revivre").toBe(false);
  });

  it("compte ce lien-là dans ce que le journal dit avoir révoqué", async () => {
    await clorePeriode("p-automne");
    faux.audits = [];
    await definirEmailMembre("u-chloe", undefined, {}, formulaireEmail("chloe@refuge.fr"));
    expect(faux.audits[0]).toMatchObject({ action: "membre.email_modifie", details: { liensRevoques: 1 } });
  });

  it("laisse tranquille un lien déjà expiré, comme la remise à zéro", async () => {
    faux.liens = [
      { id: "inv-perime", userId: "u-chloe", periodId: "p-automne", createdAt: new Date("2026-01-02T08:00:00Z"), expiresAt: new Date(Date.now() - 86_400_000), revokedAt: null, motifRevocation: null },
    ];
    await definirEmailMembre("u-chloe", undefined, {}, formulaireEmail("chloe@refuge.fr"));
    expect(faux.liens[0].motifRevocation).toBeNull();
  });
});

/**
 * **Ce que l'écran annonce après un changement d'adresse doit être vrai.**
 *
 * « Le lien personnel de l'ancienne adresse a été annulé » s'écrivait **inconditionnellement**, y
 * compris quand il n'y avait rien à annuler. Le sens de l'erreur est le pire possible : le bureau
 * repart convaincu que la boîte d'avant ne peut plus rien ouvrir — c'est-à-dire convaincu du
 * contraire de ce que le correctif ci-dessus vient de rendre vrai. La phrase suit donc le compte réel
 * de liens révoqués (`messageChangementAdresse`).
 */
describe("la phrase du changement d'adresse suit ce qui a réellement été fermé", () => {
  it("annonce l'annulation quand une clé est bien morte", async () => {
    await clorePeriode("p-automne");
    const res = await definirEmailMembre("u-chloe", undefined, {}, formulaireEmail("chloe@refuge.fr"));
    expect(res.succes).toContain("Le lien personnel de l'ancienne adresse a été annulé");
  });

  it("dit le contraire, sobrement, quand il n'y avait aucune clé à fermer", async () => {
    // Le seul lien de Chloé est périmé : il n'ouvre plus rien, et rien n'est donc révoqué.
    faux.liens = [
      { id: "inv-perime", userId: "u-chloe", periodId: "p-automne", createdAt: new Date("2026-01-02T08:00:00Z"), expiresAt: new Date(Date.now() - 86_400_000), revokedAt: null, motifRevocation: null },
    ];
    const res = await definirEmailMembre("u-chloe", undefined, {}, formulaireEmail("chloe@refuge.fr"));
    expect(res.succes).toContain("Aucun lien ne restait à annuler dans l'ancienne boîte");
    expect(res.succes).not.toContain("a été annulé");
  });

  it("n'envoie aucun lien neuf, même avec un trimestre ouvert, et dit comment l'envoyer", async () => {
    // Corriger une adresse et envoyer une clé sont deux gestes : le second part d'un bouton.
    faux.inscription = { periodId: "p-automne" };
    const res = await definirEmailMembre("u-chloe", undefined, {}, formulaireEmail("chloe@refuge.fr"));
    expect(faux.invitationsEnvoyees).toEqual([]);
    expect(res.succes).toContain("Aucun email n'est parti");
    expect(res.succes).toContain("« Envoyer le lien »");
  });
});
