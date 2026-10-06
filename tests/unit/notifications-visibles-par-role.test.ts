import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
const { typesVisiblesPour, TYPES_BUREAU, TYPES_ENCADREMENT } = await import("@/lib/notifications/membre");

/**
 * **Chacun ne voit dans ses réglages que ce qui peut lui arriver** : un membre ne voit ni les alertes de
 * l'encadrement ni celles du bureau, et les rôles s'additionnent pour un instructeur du bureau.
 */
describe("les notifications visibles selon le rôle", () => {
  it("un membre ne voit ni l'encadrement ni le bureau", () => {
    const vus = typesVisiblesPour({ role: "MEMBRE", estAdmin: false });
    for (const t of [...TYPES_ENCADREMENT, ...TYPES_BUREAU]) expect(vus).not.toContain(t);
    expect(vus).toContain("recap_veille");
  });

  it("un instructeur voit l'encadrement, pas le bureau", () => {
    const vus = typesVisiblesPour({ role: "INSTRUCTEUR", estAdmin: false });
    expect(vus).toEqual(expect.arrayContaining(["effectif_faible", "desistement_tardif"]));
    for (const t of TYPES_BUREAU) expect(vus).not.toContain(t);
  });

  it("un membre du bureau voit le bureau ; instructeur et bureau, il voit les deux", () => {
    expect(typesVisiblesPour({ role: "MEMBRE", estAdmin: true })).toEqual(expect.arrayContaining(["periode_suivante", "periode_non_activee"]));
    expect(typesVisiblesPour({ role: "MEMBRE", estAdmin: true })).not.toContain("desistement_tardif");
    const tout = typesVisiblesPour({ role: "INSTRUCTEUR", estAdmin: true });
    for (const t of [...TYPES_ENCADREMENT, ...TYPES_BUREAU]) expect(tout).toContain(t);
  });
});
