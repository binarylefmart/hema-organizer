import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Travailler sans changer de page repousse l'échéance** de l'espace admin (`/api/admin/activite`),
 * et rien d'autre : ni élévation rouverte, ni requête d'un autre site acceptée.
 */
const faux = vi.hoisted(() => ({ entetes: new Map<string, string>(), user: null as null | { sessionForte: boolean; sessionId: string }, touchees: [] as string[] }));

vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => faux.entetes.get(k) ?? null }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => faux.user }));
vi.mock("@/lib/auth/elevation", () => ({ toucherElevation: async (id: string) => void faux.touchees.push(id) }));
vi.mock("@/lib/env", () => ({ baseUrl: () => "https://organizer.exemple.fr" }));

const { POST } = await import("@/app/api/admin/activite/route");

beforeEach(() => {
  faux.entetes = new Map([["sec-fetch-site", "same-origin"]]);
  faux.user = { sessionForte: true, sessionId: "s-1" };
  faux.touchees = [];
});

describe("le signal d'activité de l'espace admin", () => {
  it("repousse l'échéance d'une élévation ouverte", async () => {
    const r = await POST();
    expect(r.status).toBe(204);
    expect(faux.touchees).toEqual(["s-1"]);
  });

  it("ne fait rien sans élévation ouverte : il ne rouvre jamais l'espace admin", async () => {
    faux.user = { sessionForte: false, sessionId: "s-1" };
    expect((await POST()).status).toBe(204);
    faux.user = null;
    expect((await POST()).status).toBe(204);
    expect(faux.touchees).toEqual([]);
  });

  it("refuse une requête venue d'un autre site", async () => {
    faux.entetes = new Map([["sec-fetch-site", "cross-site"]]);
    expect((await POST()).status).toBe(403);
    expect(faux.touchees).toEqual([]);
  });
});
