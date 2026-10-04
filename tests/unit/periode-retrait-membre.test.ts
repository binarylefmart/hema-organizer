import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Retirer quelqu'un d'une période emporte ses réponses sur les séances de cette période.**
 *
 * La base ne le fait pas toute seule : `Attendance` pend à `User` et à `Session`, jamais à
 * `PeriodMember`. Sortir quelqu'un du trimestre laissait donc ses « Présent » derrière lui, et
 * comme le dénominateur des taux est l'effectif invité, le numérateur comptait des gens qui n'y
 * étaient plus : « 12 présents sur 11 », 109 %, et des « sans réponse » qui disparaissaient des
 * compteurs tout en restant dans les listes nominatives. Le même écart se propageait au planning,
 * au tableau de bord, à l'export CSV et aux pages publiques.
 *
 * Les tests portent donc sur ce que le geste **demande à la base**, et sur le fait qu'il le
 * demande **dans la même transaction** que le retrait lui-même : un retrait sans son effacement
 * laisserait exactement le trou qu'on vient de boucher.
 */

const faux = vi.hoisted(() => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `periods.manage` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true } as { id: string; email: string; role: string; estAdmin: boolean; actif: boolean },
  /** Les opérations passées à `$transaction`, dans l'ordre, sous la forme « modèle.méthode ». */
  operations: [] as Array<{ operation: string; where: unknown; data?: unknown }>,
  transactions: 0,
  audits: [] as { action: string; cible: string | null; details: unknown }[],
}));

/** Une opération de la transaction : elle s'enregistre au lieu de toucher quoi que ce soit. */
function tracer(operation: string) {
  return vi.fn(async ({ where, data }: { where: unknown; data?: unknown }) => {
    faux.operations.push({ operation, where, ...(data === undefined ? {} : { data }) });
    return { count: 0 };
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    periodMember: { deleteMany: tracer("periodMember.deleteMany"), findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    attendance: { deleteMany: tracer("attendance.deleteMany") },
    invitation: { updateMany: tracer("invitation.updateMany") },
    period: { findUniqueOrThrow: vi.fn(async () => ({ id: "p-1", statut: "ACTIVE" })) },
    user: { findMany: vi.fn(async () => []) },
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

vi.mock("@/lib/invitations", async () => {
  // `conditionLiensARevoquer` est la **vraie** : c'est elle qui dit quels liens le retrait ferme,
  // et la simuler reviendrait à tester un filtre qu'on aurait écrit deux fois.
  const vrai = await vi.importActual<typeof import("@/lib/invitations")>("@/lib/invitations");
  return {
    envoyerInvitation: vi.fn(async () => true),
    revokeInvitation: vi.fn(async () => {}),
    conditionLiensARevoquer: vrai.conditionLiensARevoquer,
    ERREUR_COMPTE_SERVICE: "compte de service",
    LIENS_AVANT_DEBUT_JOURS: 3,
  };
});

// La matrice réelle des permissions décide ; seul le rôle de l'acteur simulé change.
vi.mock("@/lib/auth/current-user", async () => {
  const { can: vraiCan } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof vraiCan>[1]) => {
      if (!vraiCan(faux.acteur, permission)) throw new Error("Accès refusé");
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

const { retirerMembrePeriode } = await import("@/actions/periodes");

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  faux.operations = [];
  faux.transactions = 0;
  faux.audits = [];
});

describe("retirer un membre d'une période", () => {
  it("efface ses réponses sur les séances de CETTE période, et d'aucune autre", async () => {
    await retirerMembrePeriode("p-1", "u-chloe");
    const effacement = faux.operations.find((o) => o.operation === "attendance.deleteMany");
    expect(effacement, "les réponses du membre retiré doivent partir avec lui").toBeDefined();
    // Le filtre porte sur la personne **et** sur les séances du trimestre : ses réponses des autres
    // trimestres ne la regardent plus, mais elles restent — elle y est toujours invitée.
    expect(effacement?.where).toEqual({ userId: "u-chloe", session: { periodId: "p-1" } });
  });

  it("efface les réponses dans la même transaction que le retrait : jamais l'un sans l'autre", async () => {
    await retirerMembrePeriode("p-1", "u-chloe");
    expect(faux.transactions).toBe(1);
    expect(faux.operations.map((o) => o.operation)).toEqual(["periodMember.deleteMany", "attendance.deleteMany", "invitation.updateMany"]);
  });

  it("révoque toujours son lien personnel et journalise le retrait", async () => {
    await retirerMembrePeriode("p-1", "u-chloe");
    const revocation = faux.operations.find((o) => o.operation === "invitation.updateMany");
    // Le filtre ne porte plus sur `revokedAt: null` : un lien déjà estampillé `CLOTURE` doit être
    // ré-estampillé, sans quoi rouvrir la période le rendrait à quelqu'un qu'on en a sorti.
    expect(revocation?.where).toMatchObject({
      periodId: "p-1",
      userId: "u-chloe",
      OR: [{ motifRevocation: null }, { motifRevocation: { in: ["MANUEL", "CLOTURE"] } }],
    });
    expect(revocation?.data).toMatchObject({ motifRevocation: "MANUEL" });
    expect(faux.audits).toEqual([{ action: "periode.membre_retire", cible: "p-1", details: { userId: "u-chloe" } }]);
  });

  it("reste réservé au bureau : un instructeur n'efface rien", async () => {
    faux.acteur = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    await expect(retirerMembrePeriode("p-1", "u-chloe")).rejects.toThrow("Accès refusé");
    expect(faux.operations).toEqual([]);
    expect(faux.audits).toEqual([]);
  });
});

describe("les compteurs ne dépendent plus d'un écrêtage", () => {
  /**
   * L'écrêtage de la frise (`partDesInvites`) et le plancher des « sans réponse »
   * (`compteursDepuisTotaux`) restent en place, mais comme **garde-fous**, pas comme correctifs :
   * après ce retrait, plus aucune réponse ne peut sortir de l'effectif invité. Le test le dit dans
   * les deux sens — sur un cas sain, aucun des deux ne rogne quoi que ce soit.
   */
  it("un cas sain ne passe par aucun plafond ni aucun plancher", async () => {
    const { partDesInvites } = await import("@/lib/frise");
    const { compteursDepuisTotaux } = await import("@/lib/presences");
    const c = compteursDepuisTotaux({ PRESENT: 7, ABSENT: 2, PEUT_ETRE: 1 }, 11);
    expect(c.enAttente).toBe(1);
    expect(c.pourcentage).toBe(64);
    expect(partDesInvites(c.presents, c.invites)).toBeCloseTo((7 / 11) * 100);
  });

  it("garde le plafond pour les données d'avant le correctif, qui ne se réécrivent pas", async () => {
    const { partDesInvites } = await import("@/lib/frise");
    // 12 réponses pour 11 invités : ce que laissaient les retraits d'avant. La colonne ne crève
    // pas son cadre, et c'est tout ce qu'on lui demande.
    expect(partDesInvites(12, 11)).toBe(100);
  });
});

/**
 * **L'écran doit dire ce que le geste emporte.** Le correctif ci-dessus a rendu « Retirer » sans
 * retour : il efface les réponses de la personne sur toutes les séances de la période. Or le bouton
 * demandait encore « Retirer Untel de la période ? », collé au bouton « Révoquer », et retirer puis
 * ré-ajouter quelqu'un passait pour une manœuvre banale. La confirmation compte donc les réponses
 * concernées et le dit dans les mêmes termes que l'encart « Séances déjà créées » du même écran.
 */
describe("la confirmation dit ce que le retrait efface", () => {
  const page = readFileSync("src/app/(app)/admin/periodes/[id]/page.tsx", "utf-8");

  /*
   * **Les motifs ne s'accrochent pas à la mise en forme**. Ils cherchaient les deux expressions
   * écrites sur une seule ligne ; Prettier les a coupées en plusieurs le jour où le fichier a
   * grandi, et les deux tests sont tombés alors que **rien du comportement n'avait bougé**. Un test
   * qui échoue sur un retour à la ligne apprend à ne plus le croire. On cherche donc la règle — la
   * requête porte sur la période et ne lit que `userId`, et la confirmation reçoit le décompte de
   * la personne — en tolérant les blancs.
   */
  it("l'écran compte les réponses de chacun sur la période", () => {
    expect(page).toContain("const reponsesParMembre = new Map<string, number>();");
    expect(page).toMatch(/db\.attendance\.findMany\(\{\s*where:\s*\{\s*session:\s*\{\s*periodId:\s*id\s*\}\s*\},\s*select:\s*\{\s*userId:\s*true\s*\},?\s*\}\)/);
  });

  it("le décompte part dans la confirmation du bouton « Retirer »", () => {
    expect(page).toMatch(/confirmation=\{confirmationRetrait\(\s*u\.prenom,\s*reponsesParMembre\.get\(u\.id\) \?\? 0,\s*Boolean\(inv\),?\s*\)\}/);
  });

  it("emploie les mots de l'encart voisin : le décompte, puis « sans retour »", () => {
    const seances = readFileSync("src/app/(app)/admin/periodes/[id]/SelectionDates.tsx", "utf-8");
    expect(seances).toContain("Cette action est sans retour.");
    expect(page).toContain("Cette action est sans retour.");
    expect(page).toContain("seront effacées");
    expect(page).toContain("sera effacée");
  });
});
