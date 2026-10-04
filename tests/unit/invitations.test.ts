import { describe, expect, it } from "vitest";
import { DUREE_LIEN_MS, invitationExpiry, lienARenouveler, RENOUVELLEMENT_AVANT_MS } from "@/lib/invitations";
import { emailInvitation } from "@/lib/email/templates/auth";

describe("liens d'accès personnels", () => {
  const now = new Date("2026-09-22T10:00:00Z");
  // 4 mois : un lien doit couvrir la période pour laquelle il a été émis, et un trimestre du club
  // dure quatre mois (T1 : 1er septembre → 31 décembre).
  it("expirent 4 mois après leur création", () => {
    expect(invitationExpiry(now).getTime() - now.getTime()).toBe(DUREE_LIEN_MS);
    expect(DUREE_LIEN_MS).toBe(120 * 86_400_000);
  });
  it("sont à renouveler quand il reste moins de 7 jours (ou qu'ils sont expirés)", () => {
    expect(lienARenouveler(new Date(now.getTime() + 30 * 86_400_000), now)).toBe(false);
    expect(lienARenouveler(new Date(now.getTime() + RENOUVELLEMENT_AVANT_MS - 1), now)).toBe(true);
    expect(lienARenouveler(new Date(now.getTime() - 1), now)).toBe(true);
  });
  it("l'email varie selon le motif (invitation, renouvellement, sécurité)", () => {
    const base = { prenom: "Chloé", periodeNom: "T4 2026", url: "https://x.fr/invitation/abc", nomApp: "CEA Organizer" };
    expect(emailInvitation(base).sujet).toContain("Ton lien pour les cours");
    expect(emailInvitation({ ...base, motif: "renouvellement" }).contenu.paragraphes[0]).toContain("4 mois");
    const securite = emailInvitation({ ...base, motif: "securite" }).contenu;
    expect(securite.paragraphes[0]).toContain("désactivé");
    expect(securite.paragraphes.some((p) => p.includes("préviens l'administrateur"))).toBe(true);
  });
});

describe("liens liés aux appareils", () => {
  // Le plafond compte des **sessions vivantes** (un appareil, une session), et non les ouvertures
  // cumulées du lien — voir `verifierAppareils` et tests/unit/liens-appareils.test.ts.
  it("un lien est saturé à partir de 3 sessions vivantes", async () => {
    const { lienSature } = await import("@/lib/invitations");
    expect(lienSature(0, 3)).toBe(false);
    expect(lienSature(2, 3)).toBe(false);
    expect(lienSature(3, 3)).toBe(true);
  });
  it("décrit l'appareil à partir du user-agent", async () => {
    const { decrireAppareil } = await import("@/lib/email/templates/auth");
    expect(decrireAppareil("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari sur iPhone/iPad");
    expect(decrireAppareil("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36")).toBe("Chrome sur Linux");
    expect(decrireAppareil("")).toBe("navigateur inconnu sur appareil inconnu");
  });
});

describe("export CSV du journal d'audit", () => {
  it("échappe les guillemets et les points-virgules", async () => {
    const { csvAudit } = await import("@/lib/alertes");
    const csv = csvAudit([{ date: new Date("2026-09-22T10:00:00Z"), acteurEmail: "a@b.fr", action: "planning.case", cible: null, details: 'x;"y"', ip: "1.2.3.4" }]);
    expect(csv.split("\r\n")[0]).toBe("date;acteur;action;cible;details;ip");
    expect(csv).toContain('2026-09-22T10:00:00.000Z;a@b.fr;planning.case;;"x;""y""";1.2.3.4');
  });
});
