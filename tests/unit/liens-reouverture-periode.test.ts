import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Rouvrir un trimestre clos ne doit pas ressusciter une clé qu'un autre lien a remplacée.**
 *
 * La réouverture remet en service les liens que *la clôture* avait fermés. Mais entre la clôture et
 * la réouverture, la personne a très bien pu recevoir un lien neuf — ouverture du trimestre
 * suivant, « Renvoyer le lien », renouvellement d'échéance. Remettre l'ancien en service lui en
 * donnait **deux vivants à la fois**, contre l'invariant « une seule clé en circulation par
 * personne » : le plus vieux dort dans une boîte mail, souvent celle qu'on voulait justement
 * fermer.
 *
 * Ce fichier verrouille l'invariant : après une réouverture, personne n'a plus d'un lien vivant.
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

const faux = vi.hoisted(() => ({ liens: [] as Lien[] }));

const DANS_UN_MOIS = new Date(Date.now() + 30 * 86_400_000);
const HIER = new Date(Date.now() - 86_400_000);

vi.mock("@/lib/db", () => ({
  db: {
    invitation: {
      findMany: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: "desc" } }) => {
        const w = where as {
          periodId?: string;
          motifRevocation?: string;
          revokedAt?: null;
          expiresAt?: { gt: Date };
          userId?: { in: string[] };
        };
        let trouves = faux.liens.filter((l) => {
          if (w.periodId && l.periodId !== w.periodId) return false;
          if (w.motifRevocation && l.motifRevocation !== w.motifRevocation) return false;
          if (w.revokedAt === null && l.revokedAt !== null) return false;
          if (w.expiresAt && l.expiresAt.getTime() <= w.expiresAt.gt.getTime()) return false;
          if (w.userId && !w.userId.in.includes(l.userId)) return false;
          return true;
        });
        if (orderBy?.createdAt === "desc") trouves = [...trouves].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return trouves;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { revokedAt: null; motifRevocation: null } }) => {
        const vises = faux.liens.filter((l) => where.id.in.includes(l.id));
        for (const l of vises) Object.assign(l, data);
        return { count: vises.length };
      }),
    },
  },
}));

const { remettreEnServiceLiensDeCloture } = await import("@/lib/invitations");

/** Un lien, tel que la base le garde. Par défaut : vivant, valable un mois. */
function lien(partiel: Partial<Lien> & { id: string; userId: string }): Lien {
  return {
    periodId: "p-close",
    createdAt: new Date("2026-06-01T08:00:00Z"),
    expiresAt: DANS_UN_MOIS,
    revokedAt: null,
    motifRevocation: null,
    ...partiel,
  };
}

/** L'invariant : combien de clés vivantes chacun a-t-il ? */
function liensVivantsPar(userId: string): number {
  return faux.liens.filter((l) => l.userId === userId && l.revokedAt === null && l.expiresAt.getTime() > Date.now()).length;
}

beforeEach(() => {
  faux.liens.length = 0;
});

describe("réouverture d'un trimestre clos", () => {
  it("rend leur lien à ceux que la clôture avait fermés", async () => {
    faux.liens.push(
      lien({ id: "l-chloe", userId: "u-chloe", revokedAt: HIER, motifRevocation: "CLOTURE" }),
      lien({ id: "l-hotel", userId: "u-hotel", revokedAt: HIER, motifRevocation: "CLOTURE" }),
    );
    expect(await remettreEnServiceLiensDeCloture("p-close")).toBe(2);
    expect(liensVivantsPar("u-chloe")).toBe(1);
    expect(liensVivantsPar("u-hotel")).toBe(1);
  });

  it("ne ressuscite pas le lien de quelqu'un qui en a déjà reçu un neuf depuis", async () => {
    faux.liens.push(
      lien({ id: "l-ancien", userId: "u-chloe", revokedAt: HIER, motifRevocation: "CLOTURE" }),
      // Le trimestre suivant est parti entre-temps : c'est la clé qui circule aujourd'hui.
      lien({ id: "l-neuf", userId: "u-chloe", periodId: "p-suivante", createdAt: new Date("2026-09-01T08:00:00Z") }),
      lien({ id: "l-hotel", userId: "u-hotel", revokedAt: HIER, motifRevocation: "CLOTURE" }),
    );
    expect(await remettreEnServiceLiensDeCloture("p-close")).toBe(1);
    // Une seule clé vivante par personne : celle de Chloé reste la plus récente.
    expect(liensVivantsPar("u-chloe")).toBe(1);
    expect(faux.liens.find((l) => l.id === "l-ancien")?.revokedAt).not.toBeNull();
    expect(faux.liens.find((l) => l.id === "l-ancien")?.motifRevocation).toBe("CLOTURE");
    expect(liensVivantsPar("u-hotel")).toBe(1);
  });

  it("n'en remet qu'un seul par personne quand la clôture en avait fermé deux", async () => {
    // Renouvellement anticipé (`garderAnciens`) : les deux liens vivaient, la clôture a fermé les deux.
    faux.liens.push(
      lien({ id: "l-vieux", userId: "u-chloe", createdAt: new Date("2026-05-01T08:00:00Z"), revokedAt: HIER, motifRevocation: "CLOTURE" }),
      lien({ id: "l-recent", userId: "u-chloe", createdAt: new Date("2026-08-20T08:00:00Z"), revokedAt: HIER, motifRevocation: "CLOTURE" }),
    );
    expect(await remettreEnServiceLiensDeCloture("p-close")).toBe(1);
    expect(liensVivantsPar("u-chloe")).toBe(1);
    expect(faux.liens.find((l) => l.id === "l-recent")?.revokedAt).toBeNull();
  });

  it("laisse fermés les liens périmés et ceux qui n'ont pas été fermés par la clôture", async () => {
    faux.liens.push(
      lien({ id: "l-perime", userId: "u-chloe", expiresAt: HIER, revokedAt: HIER, motifRevocation: "CLOTURE" }),
      lien({ id: "l-manuel", userId: "u-hotel", revokedAt: HIER, motifRevocation: "MANUEL" }),
      lien({ id: "l-suspect", userId: "u-sam", revokedAt: HIER, motifRevocation: "SUSPECT" }),
    );
    expect(await remettreEnServiceLiensDeCloture("p-close")).toBe(0);
    for (const id of ["l-perime", "l-manuel", "l-suspect"]) expect(faux.liens.find((l) => l.id === id)?.revokedAt).not.toBeNull();
  });

  it("ne touche à rien quand la clôture n'avait rien fermé de récupérable", async () => {
    expect(await remettreEnServiceLiensDeCloture("p-close")).toBe(0);
  });
});
