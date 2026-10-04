import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Une rafale de liens inconnus ne doit ni doubler l'alerte, ni casser la page qui la déclenche.**
 *
 * L'alerte de sécurité lisait le journal (« cette clé existe-t-elle ? »), envoyait, puis écrivait la
 * clé. Entre la lecture et l'écriture, il y a tout le temps du monde : c'est précisément quand
 * quelqu'un essaie des liens au hasard que plusieurs requêtes entrent ensemble. Toutes lisaient
 * « pas encore d'alerte », toutes écrivaient à l'équipe, et le `create` des perdantes remontait une
 * P2002 **jusque dans l'action de connexion** (`src/actions/auth.ts`), qui répondait une erreur à
 * quelqu'un dont le seul tort était d'avoir recopié son lien de travers.
 *
 * La clé est maintenant posée **avant** l'envoi, par `journaliser` : la contrainte d'unicité de la
 * colonne tranche, et rien ne remonte jamais.
 */

type LigneLog = { type: string; canal: string; userId: string | null; dedupKey: string; statut: string };

const faux = vi.hoisted(() => ({
  admins: [] as Array<{ id: string; email: string | null }>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; ref?: string }>,
  push: [] as Array<{ userId: string }>,
  /** Nombre d'entrées d'audit « lien inconnu » dans l'heure */
  liensInconnus: 0,
  /** L'erreur que la file d'envoi rend à son appelant, quand le test en veut une. */
  echecEmail: null as Error | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: vi.fn(async () => null) },
    user: { findMany: vi.fn(async () => faux.admins) },
    auditLog: { count: vi.fn(async () => faux.liensInconnus), deleteMany: vi.fn(async () => ({ count: 0 })) },
    notificationLog: {
      findUnique: vi.fn(async (args: { where: { dedupKey: string } }) => faux.logs.find((l) => l.dedupKey === args.where.dedupKey) ?? null),
      findMany: vi.fn(async (args: { where: { dedupKey: { in: string[] } } }) =>
        faux.logs.filter((l) => args.where.dedupKey.in.includes(l.dedupKey as string)).map((l) => ({ dedupKey: l.dedupKey })),
      ),
      create: vi.fn(async ({ data }: { data: LigneLog }) => {
        // Exactement ce que fait SQLite sur une colonne `@unique` : la seconde écriture est refusée.
        if (faux.logs.some((l) => l.dedupKey === data.dedupKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        faux.logs.push({ ...data });
        return data;
      }),
      update: vi.fn(async ({ where, data }: { where: { dedupKey: string }; data: Partial<LigneLog> }) => {
        const ligne = faux.logs.find((l) => l.dedupKey === where.dedupKey);
        if (!ligne) throw new Error("introuvable");
        Object.assign(ligne, data);
        return ligne;
      }),
    },
  },
}));

/** La vraie file rappelle son appelant quand l'envoi a échoué : le faux fait pareil, à la demande. */
vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; ref?: string }, onDone?: (err: Error | null) => void) => {
    faux.emails.push(mail);
    onDone?.(faux.echecEmail);
  }),
}));

vi.mock("@/lib/notifications/push", () => ({
  notifierPersonnes: vi.fn(async (userIds: readonly string[]) => {
    for (const userId of userIds) faux.push.push({ userId });
    return new Map(userIds.map((id) => [id, { appareils: 1, atteints: 1 }]));
  }),
}));

vi.mock("@/lib/identite", () => ({
  identite: vi.fn(async () => ({ nomClub: "Cercle d'escrime ancienne", nomCourt: "Cercle Organizer", partEffectifMin: 20 })),
}));

const { alerterLienRevoque, SEUIL_LIENS_INCONNUS_PAR_HEURE, surveillerLiensInconnus } = await import("@/lib/alertes");

beforeEach(() => {
  faux.admins = [
    { id: "u-admin", email: "bureau@club.test" },
    { id: "u-echo", email: "echo@club.test" },
  ];
  faux.logs = [];
  faux.emails = [];
  faux.push = [];
  faux.liensInconnus = 0;
  faux.echecEmail = null;
});

describe("alerte de sécurité : la clé est posée avant l'envoi", () => {
  it("n'écrit qu'une fois à l'équipe quand deux requêtes arrivent ensemble", async () => {
    const [a, b] = await Promise.all([
      alerterLienRevoque({ invitationId: "i-1", motif: "SUSPECT", email: "chloe@club.test", ip: "10.0.0.1", remplace: true }),
      alerterLienRevoque({ invitationId: "i-1", motif: "SUSPECT", email: "chloe@club.test", ip: "10.0.0.1", remplace: true }),
    ]);
    // Une seule des deux a pris la clé : c'est elle, et elle seule, qui a écrit.
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["bureau@club.test", "echo@club.test"]);
    expect(faux.logs.filter((l) => l.canal === "EMAIL")).toHaveLength(1);
  });

  /**
   * Le point qui touchait la personne à l'écran : une P2002 remontée ici sortait par l'action de
   * connexion, qui répondait « une erreur est survenue » sur un simple lien mal recopié.
   */
  it("ne remonte jamais rien à l'appelant, même en rafale", async () => {
    faux.liensInconnus = SEUIL_LIENS_INCONNUS_PAR_HEURE + 5;
    const maintenant = new Date("2026-09-29T14:12:00Z");
    const resultats = await Promise.all(Array.from({ length: 6 }, () => surveillerLiensInconnus(maintenant)));
    // Chacune rend bien le décompte de l'heure, aucune ne lève.
    expect(resultats).toEqual(Array(6).fill(SEUIL_LIENS_INCONNUS_PAR_HEURE + 5));
    // Une alerte pour l'heure, pas six.
    expect(faux.logs.filter((l) => l.canal === "EMAIL")).toHaveLength(1);
    expect(faux.emails).toHaveLength(2);
  });

  it("ne consomme pas la clé quand aucun administrateur n'a d'adresse", async () => {
    faux.admins = [{ id: "u-foxtrot", email: null }];
    expect(await alerterLienRevoque({ invitationId: "i-1", motif: "SUSPECT", email: null, ip: "10.0.0.1", remplace: true })).toBe(false);
    expect(faux.logs).toHaveLength(0);
    // Une adresse renseignée plus tard doit encore pouvoir déclencher l'alerte.
    faux.admins = [{ id: "u-foxtrot", email: "foxtrot@club.test" }];
    expect(await alerterLienRevoque({ invitationId: "i-1", motif: "SUSPECT", email: null, ip: "10.0.0.1", remplace: true })).toBe(true);
    expect(faux.emails.map((e) => e.to)).toEqual(["foxtrot@club.test"]);
  });

  /**
   * **L'autre moitié de l'invariant, restée dehors.** La clé était bien posée avant l'envoi (tests
   * ci-dessus), mais rien ne la rendait si le SMTP refusait : la ligne disait « envoyé », et comme
   * la clé d'une alerte porte l'identifiant du lien qui l'a déclenchée, elle ne revenait
   * **jamais**. Une révocation pour lien suspect disparaissait sans que personne l'apprenne.
   */
  it("libère la clé quand l'email échoue, et réalerte au passage suivant", async () => {
    faux.echecEmail = new Error("SMTP : connexion refusée");
    await alerterLienRevoque({ invitationId: "i-3", motif: "SUSPECT", email: "chloe@club.test", ip: "10.0.0.3", remplace: true });

    const email = faux.logs.filter((l) => l.canal === "EMAIL");
    expect(email).toHaveLength(1);
    expect(email[0].statut).toBe("ECHEC");
    expect(String(email[0].dedupKey)).toMatch(/^alerte_lien_i-3_echec_\d+$/);
    expect(String(email[0].erreur)).toContain("SMTP");

    // La clé nominale est libre : le passage suivant alerte vraiment, ce qui est tout l'objet.
    faux.echecEmail = null;
    faux.emails = [];
    expect(await alerterLienRevoque({ invitationId: "i-3", motif: "SUSPECT", email: "chloe@club.test", ip: "10.0.0.3", remplace: true })).toBe(true);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["bureau@club.test", "echo@club.test"]);
    expect(faux.logs.some((l) => l.dedupKey === "alerte_lien_i-3" && l.statut === "ENVOYE")).toBe(true);
  });

  /** Une clé pour toute l'équipe : deux adresses fâchées ne la libèrent pas deux fois. */
  it("ne libère la clé qu'une fois, même si les deux emails échouent", async () => {
    faux.echecEmail = new Error("SMTP : connexion refusée");
    await alerterLienRevoque({ invitationId: "i-4", motif: "APPAREILS", email: "chloe@club.test", ip: "10.0.0.4", remplace: true });
    expect(faux.emails).toHaveLength(2);
    expect(faux.logs.filter((l) => String(l.dedupKey).includes("_echec_"))).toHaveLength(1);
  });

  it("garde l'ordre : l'email d'abord, le téléphone ensuite et jamais à sa place", async () => {
    await alerterLienRevoque({ invitationId: "i-2", motif: "APPAREILS", email: "chloe@club.test", ip: "10.0.0.2", remplace: true });
    expect(faux.logs.map((l) => l.dedupKey)).toEqual(["alerte_lien_i-2", "alerte_lien_i-2_push_u-admin", "alerte_lien_i-2_push_u-echo"]);
    expect(faux.push.map((p) => p.userId)).toEqual(["u-admin", "u-echo"]);
  });
});
