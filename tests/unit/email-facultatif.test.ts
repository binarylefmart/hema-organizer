import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailFacultatifSchema, ligneCsvSchema, membreSchema } from "@/lib/validation/gestion";
import { analyserCsvMembres } from "@/lib/periodes";
import { aUnEmail, messageSansEmail } from "@/lib/membres";
import { destinataireRetenu, preferencesDefaut } from "@/lib/notifications/preferences";
import { destinatairesRecap } from "@/lib/notifications/recap";
import { destinatairesRappel } from "@/lib/notifications/rappels";
import type { MembreSeance } from "@/lib/notifications/invites";

/**
 * **L'adresse email est facultative** (`User.email` est nullable depuis la migration
 * `email_facultatif`). Une personne sans adresse :
 * - existe dans l'effectif, compte dans les taux, voit sa présence cochée par l'équipe ;
 * - ne reçoit **aucun** message et n'a **aucun** lien personnel ;
 * - n'est jamais une erreur : les envois de masse l'écartent en silence, seuls les envois à
 *   l'unité le disent, en la nommant.
 *
 * Deux pièges que ces tests verrouillent :
 * 1. une case vide doit être enregistrée en `null`, **jamais** en `""` — l'index unique accepte
 *    autant de `null` qu'on veut mais refuserait la deuxième chaîne vide ;
 * 2. le contrôle « adresse déjà utilisée » ne vaut que pour les adresses **renseignées**.
 */

/* ------------------------------------------------------------------ */
/* Base simulée : un index unique fidèle à SQLite (plusieurs NULL, un  */
/* seul exemplaire de chaque adresse renseignée)                       */
/* ------------------------------------------------------------------ */

type Compte = {
  id: string;
  prenom: string;
  nom: string;
  email: string | null;
  role: string;
  actif: boolean;
  service: boolean;
  couleur: number | null;
  [k: string]: unknown;
};

const faux = vi.hoisted(() => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `members.manage` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true },
  comptes: [] as Record<string, unknown>[],
  periodes: [] as Record<string, unknown>[],
  invitations: [] as Record<string, unknown>[],
  /** Qui est inscrit au trimestre ouvert (pour `periodMember.findFirst`). */
  inscriptions: [] as string[],
  ateliers: [] as Record<string, unknown>[],
  seances: [] as Record<string, unknown>[],
  logs: [] as Record<string, unknown>[],
  emails: [] as Array<{ to: string; sujet: string; ref?: string }>,
  audits: [] as Array<{ action: string; cible: string | null; details: unknown }>,
  push: [] as Array<{ userId: string; titre: string; corps: string; url: string }>,
  reauths: [] as string[],
  chemins: [] as string[],
  notificationsActives: true,
}));

/** Reproduit `CREATE UNIQUE INDEX ON User(email)` : plusieurs NULL passent, un doublon renseigné non. */
function verifierUnicite(email: unknown, saufId?: string) {
  if (typeof email !== "string" || email === "") return;
  if (faux.comptes.some((c) => c.email === email && c.id !== saufId)) {
    throw Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), { code: "P2002" });
  }
}

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === "string") return faux.comptes.find((c) => c.id === where.id) ?? null;
        // Prisma ne sait pas chercher `email: null` par findUnique : seules les adresses renseignées se cherchent
        if (typeof where.email === "string") return faux.comptes.find((c) => c.email === where.email) ?? null;
        return null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const c = faux.comptes.find((u) => u.id === where.id);
        if (!c) throw new Error("Compte introuvable");
        return c;
      }),
      findMany: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
        faux.comptes.filter((c) => {
          if (where.role !== undefined && c.role !== where.role) return false;
          /*
           * **`estAdmin`, parce que c'est ce que la vraie requête demande** : les alertes de
           * sécurité cherchent `{ estAdmin: true, service: false, actif: true }`
           * (`src/lib/alertes.ts`), plus un rôle. Ce bouchon ne connaissait que `role` : il rendait
           * donc **tout le monde** quand le code filtrait sur le bureau, et la liste des
           * destinataires n'était juste que parce que ces scénarios-là ne peuplent que des comptes
           * du bureau. Un seul membre ajouté à `faux.comptes` aurait reçu l'alerte dans le test
           * sans que rien n'échoue.
           */
          if (where.estAdmin !== undefined && Boolean(c.estAdmin) !== where.estAdmin) return false;
          if (where.actif !== undefined && c.actif !== where.actif) return false;
          if (where.service !== undefined && c.service !== where.service) return false;
          // { email: { not: null } } : écarte les comptes sans adresse, comme la vraie requête
          const email = where.email as { not?: unknown } | undefined;
          if (email && "not" in email && email.not === null && c.email == null) return false;
          return true;
        }),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        verifierUnicite(data.email);
        const cree = { actif: true, service: false, couleur: null, ...data } as Record<string, unknown>;
        cree.id ??= `u-${faux.comptes.length + 1}`;
        faux.comptes.push(cree);
        return cree;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const c = faux.comptes.find((u) => u.id === where.id);
        if (!c) throw new Error("Compte introuvable");
        verifierUnicite(data.email, where.id);
        Object.assign(c, data);
        return c;
      }),
    },
    period: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.periodes.find((p) => p.id === where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const p = faux.periodes.find((x) => x.id === where.id);
        if (!p) throw new Error("Période introuvable");
        return p;
      }),
    },
    periodMember: {
      upsert: vi.fn(async () => ({})),
      // Le trimestre en cours de la personne : c'est là que part le lien neuf quand son adresse
      // change. `null` = aucun trimestre ouvert, donc rien à envoyer.
      findFirst: vi.fn(async ({ where }: { where: { userId: string; period: { statut: string } } }) => {
        const ouverte = faux.periodes.find((p) => p.statut === where.period.statut);
        return ouverte && faux.inscriptions.includes(where.userId) ? { periodId: ouverte.id as string } : null;
      }),
    },
    invitation: {
      // Personne n'a encore fait le parcours d'entrée dans ces scénarios : le lien neuf le proposera
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.invitations.push(data);
        return data;
      }),
      // Révocation en masse : le faux applique vraiment le motif, sinon un test ne pourrait pas
      // distinguer « le lien de l'ancienne adresse est mort » de « on a appelé une fonction ».
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const vises = faux.invitations.filter(
          (i) => (where.userId === undefined || i.userId === where.userId) && (where.revokedAt !== null || i.revokedAt == null),
        );
        for (const i of vises) Object.assign(i, data);
        return { count: vises.length };
      }),
    },
    atelier: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = faux.ateliers.find((x) => x.id === where.id);
        if (!a) throw new Error("Atelier introuvable");
        return a;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const a = faux.ateliers.find((x) => x.id === where.id);
        // `updatedAt` est posé par Prisma à chaque écriture : c'est lui qui date la décision, et
        // donc la clé de journal de la réponse envoyée au membre.
        Object.assign(a ?? {}, data, { updatedAt: new Date() });
        return a;
      }),
    },
    session: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.seances.find((s) => s.id === where.id) ?? null),
    },
    notificationLog: {
      findUnique: vi.fn(async ({ where }: { where: { dedupKey: string } }) => faux.logs.find((l) => l.dedupKey === where.dedupKey) ?? null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // La colonne `dedupKey` est `@unique` : le faux doit refuser la seconde écriture comme
        // SQLite le ferait, sinon l'idempotence des envois n'est jamais réellement éprouvée ici.
        if (faux.logs.some((l) => l.dedupKey === data.dedupKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        faux.logs.push(data);
        return data;
      }),
    },
    setting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) },
    // Le transport push est simulé plus bas ; cette table n'est lue que par lui.
    pushAbonnement: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; sujet: string; ref?: string }) => {
    faux.emails.push(mail);
  }),
  sendEmailNow: vi.fn(async () => ({ mode: "fichier" as const, chemin: "x" })),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, cible?: string | null, details?: unknown) => {
    faux.audits.push({ action, cible: cible ?? null, details });
  }),
}));

vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0) }));

vi.mock("@/lib/auth/current-user", async () => {
  const { can: vraiCan } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof vraiCan>[1]) => {
      if (!vraiCan(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async (_u: unknown, suite: string) => {
      faux.reauths.push(suite);
    }),
    getCurrentUser: vi.fn(async () => null),
  };
});

// Les fonctions pures du module restent les vraies : seul le réglage stocké est simulé
vi.mock("@/lib/notifications/preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/preferences")>()),
  notificationActive: vi.fn(async () => faux.notificationsActives),
}));

vi.mock("@/lib/notifications/canaux", () => ({
  envoiPossible: vi.fn(async (_type: string, canal: string) => canal === "email"),
}));

vi.mock("@/lib/notifications/salon", () => ({ publierSurSalon: vi.fn(async () => false) }));

/**
 * Le transport push : il note qui aurait été réveillé et avec quel texte. Le téléphone est le seul
 * canal qui **n'a pas besoin d'adresse email** — c'est ce que vérifient les alertes de sécurité.
 */
vi.mock("@/lib/notifications/push", () => ({
  notifierPersonnes: vi.fn(async (userIds: readonly string[], charge: (id: string) => { titre: string; corps: string; url: string }) => {
    // Deux nombres : « appareils inscrits » et « appareils atteints ». C'est ce qui permet à
    // `notifierParPush` de distinguer « personne n'a branché de téléphone » (rien à reprendre) de «
    // les téléphones étaient là et l'envoi a échoué » (la clé se libère).
    const atteints = new Map<string, { appareils: number; atteints: number }>();
    for (const userId of userIds) {
      faux.push.push({ userId, ...charge(userId) });
      atteints.set(userId, { appareils: 1, atteints: 1 });
    }
    return atteints;
  }),
}));

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

const { creerMembre, definirEmailMembre, envoyerLienMembre, importerMembres } = await import("@/actions/membres");
const { envoyerInvitation } = await import("@/lib/invitations");
const { alerterLienRevoque } = await import("@/lib/alertes");
const { notifierAnnulation } = await import("@/lib/notifications/seances");
const { deciderAtelier } = await import("@/actions/ateliers");

function compte(id: string, options: Partial<Compte> = {}): Record<string, unknown> {
  return { id, prenom: id, nom: "Test", email: `${id}@club.test`, role: "MEMBRE", actif: true, service: false, couleur: null, ...options };
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true };
  faux.comptes = [compte("u-admin", { role: "INSTRUCTEUR", estAdmin: true })];
  faux.periodes = [{ id: "p-active", nom: "T4 2026", statut: "ACTIVE" }];
  faux.invitations = [];
  faux.inscriptions = [];
  faux.ateliers = [];
  faux.seances = [];
  faux.logs = [];
  faux.emails = [];
  faux.audits = [];
  faux.push = [];
  faux.reauths = [];
  faux.chemins = [];
  faux.notificationsActives = true;
});

/* ------------------------------------------------------------------ */
/* 1. Validation : vide → null, renseigné → validé comme avant          */
/* ------------------------------------------------------------------ */

describe("validation d'une adresse facultative", () => {
  it("accepte une adresse absente et l'enregistre en null, jamais en chaîne vide", () => {
    for (const vide of ["", "   ", undefined, null]) {
      const r = emailFacultatifSchema.safeParse(vide);
      expect(r.success).toBe(true);
      expect(r.success && r.data).toBeNull();
      expect(r.success && r.data).not.toBe("");
    }
  });

  it("valide et normalise une adresse renseignée exactement comme avant", () => {
    const r = emailFacultatifSchema.safeParse("  Bravo.02@CLUB.test ");
    expect(r.success && r.data).toBe("bravo.02@club.test");
  });

  it("refuse toujours une adresse mal formée (le champ reste vérifié quand il est rempli)", () => {
    const r = emailFacultatifSchema.safeParse("pas-une-adresse");
    expect(r.success).toBe(false);
  });

  it("laisse passer une fiche membre sans adresse", () => {
    const r = membreSchema.safeParse({ prenom: "Bravo", nom: "02", email: "", role: "MEMBRE" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.email).toBeNull();
  });

  it("laisse passer une ligne CSV dont la colonne email est vide", () => {
    const [ligne] = analyserCsvMembres("Bravo;02;;MEMBRE");
    expect(ligne.email).toBe("");
    const r = ligneCsvSchema.safeParse(ligne);
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({ prenom: "Bravo", nom: "02", email: null, role: "MEMBRE" });
  });

  it("garde la garde de type et le message d'envoi impossible", () => {
    expect(aUnEmail({ email: "a@b.fr" })).toBe(true);
    expect(aUnEmail({ email: null })).toBe(false);
    expect(aUnEmail({ email: "" })).toBe(false);
    expect(messageSansEmail({ prenom: "Bravo", nom: "02" })).toBe("Bravo 02 n'a pas d'adresse email : renseigne-la pour lui envoyer son lien.");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Création et unicité                                               */
/* ------------------------------------------------------------------ */

describe("création d'un membre sans adresse email", () => {
  it("crée le compte avec email null et le dit sans promettre d'email", async () => {
    const res = await creerMembre({}, formulaire({ prenom: "Bravo", nom: "02", email: "", role: "MEMBRE" }));
    expect(res.erreur).toBeUndefined();
    expect(res.succes).toContain("sans adresse email");
    const cree = faux.comptes.find((c) => c.prenom === "Bravo");
    expect(cree?.email).toBeNull();
    expect(faux.emails).toEqual([]);
  });

  it("laisse cohabiter deux comptes sans adresse (l'index unique accepte plusieurs NULL)", async () => {
    await creerMembre({}, formulaire({ prenom: "Bravo", nom: "02", email: "", role: "MEMBRE" }));
    const res = await creerMembre({}, formulaire({ prenom: "Jeanne", nom: "Sansmail", email: "", role: "MEMBRE" }));
    expect(res.erreur).toBeUndefined();
    expect(faux.comptes.filter((c) => c.email === null)).toHaveLength(2);
  });

  it("refuse toujours un doublon d'adresse renseignée", async () => {
    faux.comptes.push(compte("u-bravo", { email: "bravo.02@club.test" }));
    const res = await creerMembre({}, formulaire({ prenom: "Bravo", nom: "02", email: "Bravo.02@club.test", role: "MEMBRE" }));
    expect(res.erreur).toBe("Un compte existe déjà avec cet email.");
    expect(faux.comptes.filter((c) => c.email === "bravo.02@club.test")).toHaveLength(1);
  });

  it("envoie le lien aussitôt quand l'adresse est renseignée et qu'une période est active", async () => {
    const fd = formulaire({ prenom: "Chloé", nom: "Dupont", email: "chloe@club.test", role: "MEMBRE" });
    fd.append("periodIds", "p-active");
    const res = await creerMembre({}, fd);
    expect(res.succes).toContain("son lien d'accès vient de partir");
    expect(faux.emails.map((e) => e.to)).toEqual(["chloe@club.test"]);
  });

  it("inscrit à la période une personne sans adresse, mais ne fabrique ni lien ni email", async () => {
    const fd = formulaire({ prenom: "Bravo", nom: "02", email: "", role: "MEMBRE" });
    fd.append("periodIds", "p-active");
    const res = await creerMembre({}, fd);
    expect(res.erreur).toBeUndefined();
    expect(faux.invitations).toEqual([]); // aucun jeton créé pour rien
    expect(faux.emails).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Import CSV                                                        */
/* ------------------------------------------------------------------ */

describe("import CSV avec des colonnes email vides", () => {
  it("importe les lignes sans adresse et ne les compte pas comme des doublons", async () => {
    const texte = ["prenom;nom;email;role", "Bravo;02;;MEMBRE", "Jeanne;Sansmail;;MEMBRE", "Chloé;Dupont;chloe@club.test;MEMBRE"].join("\n");
    const res = await importerMembres({}, formulaire({ texte }));
    expect(res.importes).toBe(3);
    expect(res.ignores).toEqual([]);
    expect(faux.comptes.filter((c) => c.email === null)).toHaveLength(2);
    expect(faux.comptes.find((c) => c.prenom === "Chloé")?.email).toBe("chloe@club.test");
  });

  it("ignore toujours une adresse renseignée déjà connue, sans bloquer le reste du fichier", async () => {
    faux.comptes.push(compte("u-chloe", { email: "chloe@club.test" }));
    const texte = ["Chloé;Dupont;chloe@club.test;MEMBRE", "Bravo;02;;MEMBRE"].join("\n");
    const res = await importerMembres({}, formulaire({ texte }));
    expect(res.importes).toBe(1);
    expect(res.ignores?.[0]).toContain("chloe@club.test existe déjà");
    expect(faux.comptes.find((c) => c.prenom === "Bravo")?.email).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 4. Envoi du lien : refus nommé à l'unité, silence en masse           */
/* ------------------------------------------------------------------ */

describe("envoi du lien personnel", () => {
  it("refuse proprement, en nommant la personne, quand elle n'a pas d'adresse", async () => {
    faux.comptes.push(compte("u-bravo", { prenom: "Bravo", nom: "02", email: null }));
    await expect(envoyerLienMembre("u-bravo", "p-active")).rejects.toThrow("Bravo 02 n'a pas d'adresse email : renseigne-la pour lui envoyer son lien.");
    expect(faux.invitations).toEqual([]);
    expect(faux.emails).toEqual([]);
  });

  it("envoie normalement quand l'adresse est là", async () => {
    faux.comptes.push(compte("u-chloe", { prenom: "Chloé", email: "chloe@club.test" }));
    await envoyerLienMembre("u-chloe", "p-active");
    expect(faux.emails.map((e) => e.to)).toEqual(["chloe@club.test"]);
    expect(faux.invitations).toHaveLength(1);
  });

  it("envoyerInvitation renvoie false sans rien créer ni lever (envois de masse)", async () => {
    faux.comptes.push(compte("u-bravo", { email: null }), compte("u-chloe", { email: "chloe@club.test" }));
    await expect(envoyerInvitation("u-bravo", "p-active")).resolves.toBe(false);
    expect(faux.invitations).toEqual([]);
    expect(faux.emails).toEqual([]);
    // La personne suivante, elle, reçoit bien le sien : un envoi de masse n'est jamais interrompu
    await expect(envoyerInvitation("u-chloe", "p-active")).resolves.toBe(true);
    expect(faux.emails.map((e) => e.to)).toEqual(["chloe@club.test"]);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Adresse modifiable depuis la liste des membres                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Corriger une adresse : la clé suit l'adresse                        */
/* ------------------------------------------------------------------ */

/**
 * **Le scénario.** Le lien personnel *est* le mot de passe du projet : quatre mois de validité,
 * connexion directe, et il dort dans une boîte mail. Chloé change d'adresse — elle quitte celle
 * d'un conjoint, ou celle-ci s'est fait pirater, ou elle appartenait en fait à un homonyme. Le
 * bureau corrige la fiche. Avant ce correctif, **rien n'était révoqué** : le lien envoyé à
 * l'ancienne adresse restait valable jusqu'à ses quatre mois, et qui lisait cette boîte entrait
 * dans l'application sous l'identité de Chloé.
 *
 * C'est le couple que CLAUDE.md décrit comme valant un mot de passe — « changer l'adresse de
 * quelqu'un *et* lui renvoyer son lien fait arriver ce lien chez soi » — pris par l'autre bout :
 * ici c'est l'**ancienne** boîte qui garde la clé.
 */
describe("changer une adresse remplace la clé", () => {
  beforeEach(() => {
    faux.comptes.push(compte("u-chloe", { prenom: "Chloé", nom: "Dupont", email: "chloe@ancienne.fr" }));
    faux.inscriptions.push("u-chloe");
    // La clé envoyée à l'ancienne adresse, bien vivante.
    faux.invitations.push({ id: "inv-ancienne", userId: "u-chloe", periodId: "p-active", revokedAt: null, motifRevocation: null });
  });

  it("tue le lien resté dans l'ancienne boîte, et n'envoie rien à la nouvelle", async () => {
    await definirEmailMembre("u-chloe", undefined, {}, formulaire({ email: "chloe@nouvelle.fr" }));
    const ancienne = faux.invitations.find((i) => i.id === "inv-ancienne");
    expect(ancienne?.revokedAt, "le lien de l'ancienne boîte doit être révoqué").not.toBeNull();
    // `REMPLACE` est une révocation de sécurité : la page du lien le dira, même à qui est déjà connecté
    expect(ancienne?.motifRevocation).toBe("REMPLACE");
    // Corriger une adresse n'envoie rien : le lien part d'un bouton, quand l'équipe le décide
    expect(faux.emails).toEqual([]);
    expect(faux.invitations.filter((i) => i.revokedAt == null)).toHaveLength(0);
  });

  it("révoque même quand aucun trimestre n'est ouvert : rien à envoyer n'est pas une raison de laisser la porte", async () => {
    faux.periodes = [{ id: "p-close", nom: "T3 2026", statut: "CLOSE" }];
    const res = await definirEmailMembre("u-chloe", undefined, {}, formulaire({ email: "chloe@nouvelle.fr" }));
    expect(faux.invitations.find((i) => i.id === "inv-ancienne")?.motifRevocation).toBe("REMPLACE");
    expect(faux.emails).toEqual([]);
    expect(res.succes).toContain("envoie-lui son lien");
  });

  it("le journal garde de quoi relire l'opération", async () => {
    await definirEmailMembre("u-chloe", undefined, {}, formulaire({ email: "chloe@nouvelle.fr" }));
    expect(faux.audits).toContainEqual({
      action: "membre.email_modifie",
      cible: "u-chloe",
      details: { ancienne: "chloe@ancienne.fr", nouvelle: "chloe@nouvelle.fr", liensRevoques: 1 },
    });
  });

  it("ne touche à rien quand on ne fait qu'AJOUTER une adresse : il n'y avait aucun lien à tuer", async () => {
    faux.comptes.push(compte("u-bravo", { prenom: "Bravo", nom: "02", email: null }));
    await definirEmailMembre("u-bravo", undefined, {}, formulaire({ email: "bravo@club.test" }));
    expect(faux.invitations.find((i) => i.id === "inv-ancienne")?.revokedAt).toBeNull();
    expect(faux.emails).toEqual([]);
  });
});

describe("ajout, correction et retrait de l'adresse depuis la liste", () => {
  beforeEach(() => {
    faux.comptes.push(
      compte("u-bravo", { prenom: "Bravo", nom: "02", email: null }),
      compte("u-chloe", { prenom: "Chloé", nom: "Dupont", email: "chloe@club.test" }),
      // Rôle de base neutre pour le compte du portail : du bureau (`estAdmin`), mais il n'enseigne pas.
      compte("u-portail", { prenom: "Bureau", nom: "HEMA", role: "MEMBRE", estAdmin: true, service: true, email: "contact@club.test" }),
    );
  });

  it("ajoute une adresse à quelqu'un qui n'en avait pas", async () => {
    const res = await definirEmailMembre("u-bravo", undefined, {}, formulaire({ email: " Bravo.02@CLUB.test " }));
    expect(res.succes).toBe("Adresse enregistrée.");
    expect(faux.comptes.find((c) => c.id === "u-bravo")?.email).toBe("bravo.02@club.test");
    expect(faux.audits).toContainEqual({ action: "membre.email_ajoute", cible: "u-bravo", details: { ancienne: null, nouvelle: "bravo.02@club.test" } });
  });

  it("corrige une adresse existante", async () => {
    const res = await definirEmailMembre("u-chloe", undefined, {}, formulaire({ email: "c.dupont@club.test" }));
    expect(res.succes).toContain("Adresse enregistrée.");
    expect(faux.audits).toContainEqual({
      action: "membre.email_modifie",
      cible: "u-chloe",
      details: { ancienne: "chloe@club.test", nouvelle: "c.dupont@club.test", liensRevoques: 0 },
    });
  });

  it("retire l'adresse quand le champ est vidé, et le dit clairement", async () => {
    const res = await definirEmailMembre("u-chloe", undefined, {}, formulaire({ email: "" }));
    expect(res.succes).toBe("Adresse retirée : plus de lien personnel possible.");
    expect(faux.comptes.find((c) => c.id === "u-chloe")?.email).toBeNull();
    expect(faux.audits).toContainEqual({ action: "membre.email_retire", cible: "u-chloe", details: { ancienne: "chloe@club.test", nouvelle: null } });
  });

  it("ne révoque aucun lien et ne ferme aucune session en retirant l'adresse", async () => {
    faux.invitations.push({ userId: "u-chloe", periodId: "p-active", revokedAt: null });
    const { revokeAllSessions } = await import("@/lib/auth/session");
    await definirEmailMembre("u-chloe", undefined, {}, formulaire({ email: "" }));
    // La personne déjà entrée reste chez elle : elle ne recevra simplement plus rien
    expect(faux.invitations[0].revokedAt).toBeNull();
    expect(vi.mocked(revokeAllSessions)).not.toHaveBeenCalled();
  });

  it("refuse une adresse déjà utilisée par quelqu'un d'autre, en le disant", async () => {
    const res = await definirEmailMembre("u-bravo", undefined, {}, formulaire({ email: "chloe@club.test" }));
    expect(res.erreur).toBe("Cette adresse est déjà celle de Chloé Dupont.");
    expect(faux.comptes.find((c) => c.id === "u-bravo")?.email).toBeNull();
  });

  it("refuse de toucher au compte de connexion du portail", async () => {
    const res = await definirEmailMembre("u-portail", undefined, {}, formulaire({ email: "" }));
    expect(res.erreur).toContain("compte de connexion du portail");
    expect(faux.comptes.find((c) => c.id === "u-portail")?.email).toBe("contact@club.test");
  });

  it("refuse une adresse mal formée sans rien enregistrer", async () => {
    const res = await definirEmailMembre("u-bravo", undefined, {}, formulaire({ email: "pas-une-adresse" }));
    expect(res.erreur).toBeTruthy();
    expect(faux.comptes.find((c) => c.id === "u-bravo")?.email).toBeNull();
  });

  it("rafraîchit la liste et la fiche du membre", async () => {
    await definirEmailMembre("u-bravo", undefined, {}, formulaire({ email: "bravo@club.test" }));
    expect(faux.chemins).toContain("/admin/membres");
    expect(faux.chemins).toContain("/admin/membres/u-bravo");
  });
});

/* ------------------------------------------------------------------ */
/* 6. Destinataires : écartés en silence, jamais comptés en moins       */
/* ------------------------------------------------------------------ */

const membre = (id: string, email: string | null, statut: string | null): MembreSeance => ({
  id,
  prenom: id,
  email,
  actif: true,
  rappelEmail: true,
  statut,
});

describe("sélection des destinataires (fonctions pures)", () => {
  const prefs = preferencesDefaut();

  it("écarte une personne sans adresse de tout envoi email, et d'elle seule", () => {
    expect(destinataireRetenu(prefs, "recap_veille", "email", { actif: true, rappelEmail: true, email: "a@b.fr" })).toBe(true);
    expect(destinataireRetenu(prefs, "recap_veille", "email", { actif: true, rappelEmail: true, email: null })).toBe(false);
    expect(destinataireRetenu(prefs, "recap_veille", "email", { actif: true, rappelEmail: true, email: "" })).toBe(false);
    // Le canal Discord est collectif : l'absence d'adresse n'y change rien
    expect(destinataireRetenu(prefs, "recap_veille", "discord", { actif: true, rappelEmail: true, email: null })).toBe(true);
  });

  it("récap de la veille : les inscrits sans adresse sont sautés", () => {
    const membres = [membre("u-chloe", "chloe@club.test", "PRESENT"), membre("u-bravo", null, "PRESENT"), membre("u-jeanne", "", "PEUT_ETRE")];
    expect(destinatairesRecap(prefs, membres).map((m) => m.id)).toEqual(["u-chloe"]);
  });

  it("rappel sans réponse : idem, sans erreur ni envoi à vide", () => {
    const membres = [membre("u-chloe", "chloe@club.test", null), membre("u-bravo", null, null)];
    expect(destinatairesRappel(prefs, membres).map((m) => m.id)).toEqual(["u-chloe"]);
  });
});

describe("annulation d'une séance", () => {
  it("prévient les invités joignables et saute silencieusement les autres", async () => {
    faux.seances.push({
      id: "s-1",
      date: "2026-09-25",
      heureDebut: "19:00",
      heureFin: "21:00",
      lieu: "Villebourg",
      annulee: true,
      motifAnnulation: "Peu de monde",
      updatedAt: new Date("2026-09-24T10:00:00Z"),
      period: {
        membres: [
          { user: { id: "u-chloe", prenom: "Chloé", email: "chloe@club.test", actif: true } },
          { user: { id: "u-bravo", prenom: "Bravo", email: null, actif: true } },
        ],
      },
    });
    const prevenus = await notifierAnnulation("s-1");
    expect(prevenus).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual(["chloe@club.test"]);
  });
});

describe("alertes de sécurité aux administrateurs", () => {
  it("n'écrit qu'aux administrateurs qui ont une adresse", async () => {
    faux.comptes.push(compte("u-echo", { role: "INSTRUCTEUR", estAdmin: true, service: false, email: "echo@club.test" }), compte("u-foxtrot", { role: "INSTRUCTEUR", estAdmin: true, service: false, email: null }));
    const envoye = await alerterLienRevoque({ invitationId: "i-1", motif: "SUSPECT", email: "chloe@club.test", ip: "10.0.0.1", remplace: true });
    expect(envoye).toBe(true);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["echo@club.test", "u-admin@club.test"]);
  });

  /**
   * Le téléphone est le seul canal qui ne demande pas d'adresse : un administrateur sans email —
   * cas prévu, l'adresse est facultative — reste prévenu d'un incident de sécurité.
   */
  it("prévient aussi sur le téléphone, y compris l'administrateur sans adresse", async () => {
    faux.comptes.push(compte("u-foxtrot", { role: "INSTRUCTEUR", estAdmin: true, service: false, email: null }));
    await alerterLienRevoque({ invitationId: "i-1", motif: "SUSPECT", email: "chloe@club.test", ip: "10.0.0.1", remplace: true });
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["u-admin", "u-foxtrot"]);
    expect(faux.push[0].titre).toBe("Alerte de sécurité");
    expect(faux.push[0].corps).toBe("Un lien d'accès a été révoqué automatiquement. Ouvre le journal d'audit.");
    expect(faux.push[0].url).toBe("/admin/audit");
  });

  /** Le point qui compte : ce qui s'affiche écran verrouillé ne nomme personne et ne situe rien. */
  it("ne met sur l'écran verrouillé ni nom, ni adresse IP, ni identifiant de lien", async () => {
    await alerterLienRevoque({ invitationId: "i-1", motif: "APPAREILS", email: "chloe@club.test", ip: "10.0.0.1", remplace: true });
    const affiche = JSON.stringify(faux.push);
    expect(affiche).not.toContain("chloe@club.test");
    expect(affiche).not.toContain("10.0.0.1");
    expect(affiche).not.toContain("i-1");
    expect(affiche).not.toContain("appareils");
    // …alors que l'email, lui, raconte : c'est bien deux textes différents, pas une recopie.
    expect(JSON.stringify(faux.emails)).toContain("chloe@club.test");
  });

  it("journalise le téléphone sous une clé à lui, une par administrateur, et ne la rejoue pas", async () => {
    await alerterLienRevoque({ invitationId: "i-1", motif: "SUSPECT", email: "chloe@club.test", ip: "10.0.0.1", remplace: true });
    expect(faux.logs.map((l) => l.dedupKey)).toEqual(["alerte_lien_i-1", "alerte_lien_i-1_push_u-admin"]);
    expect(faux.logs.find((l) => l.canal === "PUSH")?.userId).toBe("u-admin");
    // Le même incident, une seconde fois : ni email, ni notification.
    expect(await alerterLienRevoque({ invitationId: "i-1", motif: "SUSPECT", email: "chloe@club.test", ip: "10.0.0.1", remplace: true })).toBe(false);
    expect(faux.push).toHaveLength(1);
    expect(faux.emails).toHaveLength(1);
  });

  it("part par email même si le service de push tombe", async () => {
    const { notifierPersonnes } = await import("@/lib/notifications/push");
    vi.mocked(notifierPersonnes).mockRejectedValueOnce(new Error("service de push injoignable"));
    await expect(alerterLienRevoque({ invitationId: "i-2", motif: "SUSPECT", email: "chloe@club.test", ip: "10.0.0.1", remplace: true })).resolves.toBe(true);
    expect(faux.emails.map((e) => e.to)).toEqual(["u-admin@club.test"]);
  });
});

describe("réponse à une proposition d'atelier", () => {
  beforeEach(() => {
    faux.comptes.push(compte("u-bravo", { prenom: "Bravo", nom: "02", email: null }));
    faux.ateliers.push({
      id: "a-1",
      titre: "Travail au messer",
      statut: "PROPOSE",
      commentaireInstructeur: null,
      sessionId: null,
      proposePar: { id: "u-bravo", prenom: "Bravo", email: null, actif: true },
    });
  });

  it("traite l'atelier normalement mais n'envoie rien, et ne promet pas d'email", async () => {
    const res = await deciderAtelier({}, formulaire({ atelierId: "a-1", statut: "REFUSE", commentaire: "Pas cette fois" }));
    expect(res.succes).toBe("Atelier refusé.");
    expect(res.succes).not.toContain("prévenu par email");
    expect(faux.emails).toEqual([]);
    expect(faux.ateliers[0].statut).toBe("REFUSE");
  });

  it("prévient bien la personne quand son adresse est renseignée", async () => {
    (faux.ateliers[0].proposePar as { email: string | null }).email = "bravo@club.test";
    const res = await deciderAtelier({}, formulaire({ atelierId: "a-1", statut: "REFUSE" }));
    expect(res.succes).toContain("prévenu par email");
    expect(faux.emails.map((e) => e.to)).toEqual(["bravo@club.test"]);
  });
});
