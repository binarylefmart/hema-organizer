import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Renvoyer un lien renvoie un lien ; remettre l'accès à zéro fait tout recommencer.**
 *
 * Le parcours d'entrée est attaché à l'**invitation** (`Invitation.parcoursVuLe`), pas à la
 * personne : un lien neuf le rejouait donc à chaque régénération. Delta a tranché — « la remise à
 * zéro relance un onboarding complet, régénérer et renvoyer renvoie simplement un lien ». C'est
 * `OptionsEnvoi.parcours` qui porte la différence, et ce fichier la tient.
 */
const faux = vi.hoisted(() => ({
  dejaFaitLeParcours: false,
  crees: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUniqueOrThrow: vi.fn(async () => ({ service: false })) },
    invitation: {
      findFirst: vi.fn(async () => (faux.dejaFaitLeParcours ? { id: "inv-ancienne" } : null)),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.crees.push(data);
        return data;
      }),
    },
    periodMember: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));
vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0) }));
vi.mock("@/lib/env", () => ({
  env: () => ({ SESSION_SECRET: "secret-de-test", DOMAIN: "organizer.test" }),
  baseUrl: () => "https://organizer.test",
}));

const { createInvitation } = await import("@/lib/invitations");

beforeEach(() => {
  faux.dejaFaitLeParcours = false;
  faux.crees = [];
});

describe("le parcours d'entrée quand un lien neuf part", () => {
  it("se montre à qui ne l'a jamais fait", async () => {
    await createInvitation("u-1", "per-1");
    expect(faux.crees[0].parcoursVuLe).toBeNull();
  });

  it("ne se rejoue pas pour un simple renvoi à quelqu'un qui l'a déjà fait", async () => {
    faux.dejaFaitLeParcours = true;
    await createInvitation("u-1", "per-1");
    // Le lien neuf naît « parcours déjà vu » : on retombe droit sur l'accueil
    expect(faux.crees[0].parcoursVuLe).toBeInstanceOf(Date);
  });

  it("se rejoue en entier après une remise à zéro, même pour un ancien", async () => {
    faux.dejaFaitLeParcours = true;
    await createInvitation("u-1", "per-1", { parcours: "force" });
    expect(faux.crees[0].parcoursVuLe).toBeNull();
  });
});
