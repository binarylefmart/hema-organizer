import { describe, expect, it } from "vitest";
import { basculerType, lireFiltresAudit, paramsAudit, whereAudit } from "@/lib/audit-filtres";

/** Les trois filtres ajoutés au journal : plusieurs types, une séance, une adresse IP. */
describe("journal d'audit — filtres", () => {
  it("lit plusieurs types, dans l'ordre de la liste, et ignore les inconnus", () => {
    const f = lireFiltresAudit({ types: "notification.desistement,presence.,inventé" });
    expect(f.types).toEqual(["presence.", "notification.desistement"]);
  });

  it("un ancien lien ?q=<famille> devient une case cochée, pas une recherche", () => {
    const f = lireFiltresAudit({ q: "presence.desistement" });
    expect(f.q).toBe("");
    expect(f.types).toEqual(["presence.desistement"]);
  });

  it("plusieurs types : une entrée de l'une OU de l'autre famille", () => {
    const where = whereAudit(lireFiltresAudit({ types: "connexion.,deux_fa" }));
    expect(JSON.stringify(where)).toContain('"startsWith":"connexion."');
    expect(JSON.stringify(where)).toContain('"startsWith":"deux_fa"');
    expect(JSON.stringify(where)).toContain('"startsWith":"admin.deux_fa"');
  });

  it("une séance : en cible, ou citée dans le détail", () => {
    const where = whereAudit(lireFiltresAudit({ seance: "s1" }));
    expect(where).toEqual({ AND: [{ OR: [{ cible: "s1" }, { details: { contains: '"sessionId":"s1"' } }] }] });
  });

  it("une adresse IP, ou son début ; rien d'autre que des caractères d'adresse", () => {
    expect(whereAudit(lireFiltresAudit({ ip: "192.168." }))).toEqual({ AND: [{ ip: { startsWith: "192.168." } }] });
    expect(lireFiltresAudit({ ip: "2001:db8::1" }).ip).toBe("2001:db8::1");
    expect(lireFiltresAudit({ ip: "1.1.1.1' OR 1=1" }).ip).toBe("");
  });

  it("garde tous les filtres d'une adresse à l'autre (pagination, export)", () => {
    const f = lireFiltresAudit({ types: "presence.,connexion.", seance: "s1", ip: "10.0." });
    expect(paramsAudit(f).toString()).toBe("types=connexion.%2Cpresence.&seance=s1&ip=10.0.");
  });

  it("cocher puis décocher une famille", () => {
    expect(basculerType(["presence."], "connexion.")).toEqual(["connexion.", "presence."]);
    expect(basculerType(["connexion.", "presence."], "presence.")).toEqual(["connexion."]);
  });
});
