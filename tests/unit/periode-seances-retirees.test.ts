import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Retirer des séances depuis l'écran de la période** : l'encart « Séances déjà créées » les
 * montre cochées, et décocher les supprime.
 *
 * Ce qui compte ici : le geste efface les réponses des membres, donc il reste au bureau, il ne
 * touche que des séances **de cette période** — la liste vient de l'écran, elle ne fait pas foi —
 * et il journalise les dates emportées, seule trace qui restera.
 */

const faux = vi.hoisted(() => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `periods.manage` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true } as { id: string; email: string; role: string; estAdmin: boolean; actif: boolean },
  seances: [] as Array<{ id: string; date: string; heureDebut: string; periodId: string }>,
  /* Statut de la période visée : `CLOSE` doit faire refuser le retrait. */
  statutPeriode: "ACTIVE" as string,
  reponses: 0,
  supprimees: [] as unknown[],
  ateliersMaj: [] as Array<{ where: unknown; data: unknown }>,
  audits: [] as Array<{ action: string; cible: string | null; details: unknown }>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    // `statut` est lu : un trimestre clos ne perd plus de séances (le verrou vivait sur la séance
    // et sur le planning, pas sur la liste des séances de la période).
    period: {
      findUnique: vi.fn(async () => ({ statut: faux.statutPeriode })),
      findUniqueOrThrow: vi.fn(async () => ({ statut: faux.statutPeriode })),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    session: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; periodId: string } }) =>
        faux.seances.filter((s) => where.id.in.includes(s.id) && s.periodId === where.periodId),
      ),
      deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
        faux.supprimees.push(where);
        return { count: 0 };
      }),
    },
    attendance: { count: vi.fn(async () => faux.reponses) },
    invitation: { updateMany: vi.fn(async () => ({ count: 0 })) },
    // Les ateliers des séances retirées sont détachés dans la même transaction que l'effacement :
    // un atelier « planifié » sans séance serait planifié nulle part (voir `supprimerPeriode`).
    atelier: {
      updateMany: vi.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        faux.ateliersMaj.push({ where, data });
        return { count: 0 };
      }),
    },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/invitations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invitations")>()),
  envoyerInvitation: vi.fn(async () => true),
  revokeInvitation: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/current-user", async () => {
  const { can } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof can>[1]) => {
      if (!can(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async () => {}),
    getCurrentUser: vi.fn(async () => null),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { supprimerSeancesPeriode } = await import("@/actions/periodes");

function formulaire(...ids: string[]): FormData {
  const fd = new FormData();
  for (const id of ids) fd.append("supprimer", id);
  return fd;
}

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  faux.statutPeriode = "ACTIVE";
  faux.seances = [
    { id: "s1", date: "2026-10-02", heureDebut: "19:00", periodId: "p1" },
    { id: "s2", date: "2026-10-09", heureDebut: "19:00", periodId: "p1" },
    { id: "ailleurs", date: "2026-10-16", heureDebut: "19:00", periodId: "p2" },
  ];
  faux.reponses = 7;
  faux.supprimees = [];
  faux.ateliersMaj = [];
  faux.audits = [];
});

describe("retirer des séances d'une période", () => {
  it("supprime les séances décochées et dit ce qu'elles emportaient", async () => {
    const res = await supprimerSeancesPeriode("p1", {}, formulaire("s1", "s2"));
    expect(faux.supprimees).toEqual([{ id: { in: ["s1", "s2"] }, periodId: "p1" }]);
    expect(res.succes).toContain("2 séances retirées");
    expect(res.succes).toContain("7 réponses");
    expect(faux.audits).toEqual([
      {
        action: "periode.seances_supprimees",
        cible: "p1",
        details: { seances: 2, reponses: 7, dates: ["2026-10-02 19:00", "2026-10-09 19:00"] },
      },
    ]);
  });

  it("ignore une séance d'une autre période : la liste vient de l'écran, elle ne fait pas foi", async () => {
    await supprimerSeancesPeriode("p1", {}, formulaire("s1", "ailleurs"));
    expect(faux.supprimees).toEqual([{ id: { in: ["s1"] }, periodId: "p1" }]);
  });

  it("ne supprime rien quand plus rien ne correspond", async () => {
    const res = await supprimerSeancesPeriode("p1", {}, formulaire("ailleurs"));
    expect(res.erreur).toContain("n'appartiennent pas à cette période");
    expect(faux.supprimees).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("refuse un formulaire vide sans toucher à la base", async () => {
    const res = await supprimerSeancesPeriode("p1", {}, new FormData());
    expect(res.erreur).toContain("Décoche au moins une séance");
    expect(faux.supprimees).toEqual([]);
  });

  it("reste au bureau : un instructeur ne retire pas de séances par ce chemin", async () => {
    faux.acteur = { id: "u-i", email: "charlie@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    await expect(supprimerSeancesPeriode("p1", {}, formulaire("s1"))).rejects.toThrow("Accès refusé");
    expect(faux.supprimees).toEqual([]);
  });
});

/**
 * **Un trimestre clos ne perd plus de séances**.
 *
 * Le verrou d'état vivait sur la séance (`seancePourEcriture`) et sur le planning, mais pas ici : on
 * pouvait donc effacer des cours — et toutes leurs réponses — sur un trimestre terminé, depuis un écran
 * qui ne disait rien, pendant que l'écran de la séance refusait le même geste. Le statut tranche, jamais
 * la date : on clôt un trimestre sans attendre son dernier cours, donc une période close porte des
 * séances à venir.
 */
describe("verrou d'un trimestre clos", () => {
  it("refuse le retrait, n'efface rien et ne journalise rien", async () => {
    faux.statutPeriode = "CLOSE";
    faux.seances = [{ id: "s-1", date: "2026-09-22", heureDebut: "20:00", periodId: "p-1" }];
    const res = await supprimerSeancesPeriode("p-1", {}, formulaire("s-1"));
    expect(res.erreur).toContain("clos");
    expect(faux.supprimees).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("une période ouverte laisse passer, elle : le refus vient du statut et de rien d'autre", async () => {
    faux.statutPeriode = "ACTIVE";
    faux.seances = [{ id: "s-1", date: "2026-09-22", heureDebut: "20:00", periodId: "p-1" }];
    const res = await supprimerSeancesPeriode("p-1", {}, formulaire("s-1"));
    expect(res.erreur).toBeUndefined();
    expect(faux.supprimees).toHaveLength(1);
  });
});
