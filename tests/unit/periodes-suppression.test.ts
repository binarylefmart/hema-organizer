import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, type UserLike } from "@/lib/permissions";

/**
 * Suppression définitive d'une période : qui a le droit, ce qui est refusé,
 * et ce que la base emporte réellement avec elle.
 */

const faux = vi.hoisted(() => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `periods.delete` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true } as { id: string; email: string; role: string; estAdmin: boolean; actif: boolean },
  periode: { id: "p-close", nom: "T3 2026-2027", dateDebut: "2027-04-01", dateFin: "2027-06-30", statut: "CLOSE" } as Record<string, unknown>,
  seances: [] as { id: string }[],
  reponses: 0,
  invitations: 0,
  filtresSeances: [] as unknown[],
  filtresReponses: [] as unknown[],
  filtresInvitations: [] as unknown[],
  ateliersMaj: [] as { where: unknown; data: unknown }[],
  supprimees: [] as string[],
  transactions: 0,
  audits: [] as { action: string; cible: string | null; details: unknown }[],
  reauths: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    period: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (faux.periode.id !== where.id) throw new Error("Période introuvable");
        return faux.periode;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        faux.supprimees.push(where.id);
        return faux.periode;
      }),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    session: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        faux.filtresSeances.push(where);
        return faux.seances;
      }),
    },
    attendance: {
      count: vi.fn(async ({ where }: { where: unknown }) => {
        faux.filtresReponses.push(where);
        return faux.reponses;
      }),
    },
    invitation: {
      count: vi.fn(async ({ where }: { where: unknown }) => {
        faux.filtresInvitations.push(where);
        return faux.invitations;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    atelier: {
      updateMany: vi.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        faux.ateliersMaj.push({ where, data });
        return { count: 0 };
      }),
    },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => {
      faux.transactions++;
      return Promise.all(operations);
    }),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/invitations", () => ({
  envoyerInvitation: vi.fn(async () => {}),
  revokeInvitation: vi.fn(async () => {}),
}));

// La matrice réelle des permissions décide : l'acteur simulé change simplement de rôle.
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { supprimerPeriode } = await import("@/actions/periodes");

const ADMIN = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
// **Le même rôle de base que l'acteur du bureau, sans le supplément** : c'est la seule différence
// entre les deux comptes, et c'est elle qui doit décider. `estAdmin: false` est donc écrit, pas sous-
// entendu — l'omettre ferait de ce refus un test qui n'éprouve plus rien.
const INSTRUCTEUR = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };

beforeEach(() => {
  faux.acteur = { ...ADMIN };
  faux.periode = { id: "p-close", nom: "T3 2026-2027", dateDebut: "2027-04-01", dateFin: "2027-06-30", statut: "CLOSE" };
  faux.seances = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
  faux.reponses = 187;
  faux.invitations = 18;
  faux.filtresSeances = [];
  faux.filtresReponses = [];
  faux.filtresInvitations = [];
  faux.ateliersMaj = [];
  faux.supprimees = [];
  faux.transactions = 0;
  faux.audits = [];
  faux.reauths = [];
});

describe("qui peut supprimer une période", () => {
  it("réserve la suppression au bureau : un instructeur est refusé, rien n'est touché", async () => {
    faux.acteur = { ...INSTRUCTEUR };
    await expect(supprimerPeriode("p-close")).rejects.toThrow("Accès refusé");
    expect(faux.supprimees).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  /**
   * **Le trimestre appartient au bureau** : l'ouvrir, l'activer — donc envoyer son lien à chaque
   * membre — et l'effacer. Ce qui reste à l'encadrement, c'est le travail *dans* le trimestre : les
   * séances, le planning, les thèmes, les présences.
   */
  it("réserve le trimestre au bureau, et garde le contenu des séances à l'encadrement", () => {
    const instructeur: UserLike = { role: "INSTRUCTEUR", actif: true };
    const admin: UserLike = { role: "INSTRUCTEUR", estAdmin: true, actif: true };
    expect(can(instructeur, "periods.manage")).toBe(false);
    expect(can(instructeur, "periods.delete")).toBe(false);
    expect(can(admin, "periods.manage")).toBe(true);
    expect(can(admin, "periods.delete")).toBe(true);
    // Le travail d'un instructeur, lui, n'a pas bougé
    expect(can(instructeur, "sessions.manage")).toBe(true);
    expect(can(instructeur, "planning.edit")).toBe(true);
  });

  it("exige un code 2FA récent avant d'effacer quoi que ce soit", async () => {
    await expect(supprimerPeriode("p-close")).rejects.toThrow("REDIRECTION:");
    expect(faux.reauths).toEqual(["/admin/periodes/p-close"]);
  });
});

describe("période active : refus", () => {
  it("refuse la suppression d'une période ACTIVE et dit qu'il faut la clôturer", async () => {
    faux.periode = { ...faux.periode, statut: "ACTIVE" };
    await expect(supprimerPeriode("p-close")).rejects.toThrow("clôture-la avant de pouvoir la supprimer");
    expect(faux.supprimees).toEqual([]);
    expect(faux.ateliersMaj).toEqual([]);
    expect(faux.audits).toEqual([]);
    // Le refus tombe avant même la demande de code 2FA : rien n'est engagé
    expect(faux.reauths).toEqual([]);
  });

  it("laisse partir un brouillon comme une période close", async () => {
    faux.periode = { ...faux.periode, statut: "BROUILLON" };
    await expect(supprimerPeriode("p-close")).rejects.toThrow("REDIRECTION:");
    expect(faux.supprimees).toEqual(["p-close"]);
  });
});

describe("ce que la suppression emporte", () => {
  it("efface la période, ses séances, les réponses et les invitations en une seule transaction", async () => {
    await expect(supprimerPeriode("p-close")).rejects.toThrow("REDIRECTION:/admin/periodes?supprimee=T3%202026-2027");
    // La suppression demandée à la base : la période (le reste suit en cascade, voir le test du schéma)
    expect(faux.supprimees).toEqual(["p-close"]);
    expect(faux.transactions).toBe(1);
    expect(faux.filtresSeances).toEqual([{ periodId: "p-close" }]);
    expect(faux.filtresReponses).toEqual([{ sessionId: { in: ["s1", "s2", "s3"] } }]);
    expect(faux.filtresInvitations).toEqual([{ periodId: "p-close" }]);
  });

  it("détache les ateliers avant l'effacement : un atelier planifié repasse en attente", async () => {
    await expect(supprimerPeriode("p-close")).rejects.toThrow("REDIRECTION:");
    expect(faux.ateliersMaj).toEqual([
      { where: { sessionId: { in: ["s1", "s2", "s3"] }, statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } },
      { where: { sessionId: { in: ["s1", "s2", "s3"] } }, data: { sessionId: null } },
    ]);
  });

  it("journalise le nom, les dates et les décomptes : c'est la seule trace qui restera", async () => {
    await expect(supprimerPeriode("p-close")).rejects.toThrow("REDIRECTION:");
    expect(faux.audits).toEqual([
      {
        action: "periode.supprimee",
        cible: "p-close",
        details: { nom: "T3 2026-2027", dateDebut: "2027-04-01", dateFin: "2027-06-30", seances: 3, reponses: 187, invitations: 18 },
      },
    ]);
  });

  it("supporte une période sans aucune séance", async () => {
    faux.seances = [];
    faux.reponses = 0;
    faux.invitations = 0;
    await expect(supprimerPeriode("p-close")).rejects.toThrow("REDIRECTION:");
    expect(faux.supprimees).toEqual(["p-close"]);
    expect(faux.audits[0].details).toMatchObject({ seances: 0, reponses: 0, invitations: 0 });
  });
});

describe("garanties du schéma (ce qui part en cascade)", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf-8");
  /** Relation déclarée dans le modèle : renvoie la ligne complète. */
  const relation = (modele: string, ligne: string) => {
    const bloc = schema.split(`model ${modele} {`)[1]?.split("\n}")[0] ?? "";
    return bloc.split("\n").find((l) => l.trim().startsWith(ligne)) ?? "";
  };

  it("efface avec la période ses séances, membres, instructeurs, créneaux et invitations", () => {
    for (const [modele, champ] of [
      ["Session", "period "],
      ["PeriodMember", "period "],
      ["PeriodInstructeur", "period "],
      ["Creneau", "period "],
      ["Invitation", "period "],
    ] as const) {
      expect(relation(modele, champ), `${modele}.${champ.trim()}`).toContain("onDelete: Cascade");
    }
  });

  it("efface avec les séances les réponses, les cases du planning et les instructeurs de séance", () => {
    for (const [modele, champ] of [
      ["Attendance", "session "],
      ["SessionPartie", "session "],
      ["SessionInstructeur", "session "],
    ] as const) {
      expect(relation(modele, champ), `${modele}.${champ.trim()}`).toContain("onDelete: Cascade");
    }
  });

  it("conserve les propositions d'ateliers, simplement détachées de leur séance", () => {
    expect(relation("Atelier", "session ")).toContain("onDelete: SetNull");
  });
});
