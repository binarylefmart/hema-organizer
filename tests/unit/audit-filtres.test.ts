import { describe, expect, it } from "vitest";
import { lireFiltresAudit, orderByAudit, whereAudit } from "@/lib/audit-filtres";

/** Journal d'audit : filtrer par personne et trier par date ou par personne. */
describe("filtres du journal d'audit", () => {
  it("une personne : ce qu'elle a fait et ce qu'on a fait à son compte, en plus des autres filtres", () => {
    const w = whereAudit(lireFiltresAudit({ q: "presence.", personne: "u1", du: "2026-11-01" }));
    expect(w.AND).toEqual([
      { OR: [{ action: { startsWith: "presence." } }] },
      { OR: [{ acteurId: "u1" }, { cible: "u1" }] },
      { date: { gte: new Date("2026-11-01T00:00:00Z") } },
    ]);
  });

  it("aucun filtre : tout", () => {
    expect(whereAudit(lireFiltresAudit({}))).toEqual({});
  });

  it("trie par date dans les deux sens, ou par personne", () => {
    expect(orderByAudit("recent")).toEqual([{ date: "desc" }]);
    expect(orderByAudit("ancien")).toEqual([{ date: "asc" }]);
    expect(orderByAudit("personne")).toEqual([{ acteurEmail: "asc" }, { date: "desc" }]);
    expect(lireFiltresAudit({ tri: "toto" }).tri).toBe("recent");
  });
});
