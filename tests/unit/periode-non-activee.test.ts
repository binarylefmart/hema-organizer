import { beforeEach, describe, expect, it, vi } from "vitest";
import { preferencesDefaut, serialiserPreferences } from "@/lib/notifications/preferences";

/**
 * **« La période commence et personne ne l'a activée »** — l'alerte aux administrateurs, trois jours
 * puis un jour avant le premier cours d'un trimestre resté en brouillon.
 *
 * Ce qui se casserait sans bruit, et que ce fichier tient :
 *  - **le jour de référence est le premier cours**, pas la date de début de la période — c'est la
 *    règle de l'envoi des liens (`envoyerLiensDesTrimestresQuiCommencent`), et les deux doivent
 *    parler du même jour, sinon l'alerte tombe après le train qu'elle annonce ;
 *  - **une séance annulée n'est pas une échéance** (même règle, même raison) ;
 *  - **seuls les brouillons** sont réclamés : activée, la période fait taire l'alerte d'elle-même,
 *    sans marqueur à poser ;
 *  - **deux jalons, J-3 et J-1**, et l'idempotence de chacun : le balayage tourne tous les matins.
 */

type LigneLog = { type: string; canal: string; userId: string | null; dedupKey: string; statut: string };
type PeriodeFausse = {
  id: string;
  nom: string;
  dateDebut: string;
  dateFin: string;
  statut: string;
  membres: number;
  /** Séances de la période : date + annulée */
  seances: Array<{ date: string; annulee: boolean }>;
};

const faux = vi.hoisted(() => ({
  periodes: [] as Array<Record<string, unknown>>,
  admins: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; sujet: string; ref?: string }>,
  push: [] as Array<{ userId: string; titre: string; corps: string; url: string; tag?: string }>,
  prefs: null as string | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    period: {
      findMany: vi.fn(async (args: { where: { statut: string; dateDebut: { lte: string } } }) =>
        faux.periodes
          .filter((p) => p.statut === args.where.statut && (p.dateDebut as string) <= args.where.dateDebut.lte)
          .map((p) => {
            const seances = (p.seances as PeriodeFausse["seances"]).filter((s) => !s.annulee).sort((a, b) => a.date.localeCompare(b.date));
            return {
              id: p.id,
              nom: p.nom,
              dateDebut: p.dateDebut,
              _count: { membres: p.membres },
              sessions: seances.slice(0, 1).map((s) => ({ date: s.date })),
            };
          }),
      ),
    },
    user: {
      findMany: vi.fn(async (args: { where: { estAdmin: boolean; actif: boolean } }) => faux.admins.filter((u) => u.estAdmin === args.where.estAdmin && u.actif === args.where.actif)),
    },
    notificationLog: {
      findMany: vi.fn(async (args: { where: { dedupKey: { in: string[] } } }) =>
        faux.logs.filter((l) => args.where.dedupKey.in.includes(l.dedupKey as string)).map((l) => ({ dedupKey: l.dedupKey })),
      ),
      create: vi.fn(async ({ data }: { data: LigneLog }) => {
        if (faux.logs.some((l) => l.dedupKey === data.dedupKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        faux.logs.push({ ...data });
        return data;
      }),
      update: vi.fn(async () => ({})),
    },
    pushAbonnement: { count: vi.fn(async () => 2) },
  },
}));

vi.mock("@/lib/notifications/push", () => ({
  pushConfigure: vi.fn(async () => true),
  notifierPersonnes: vi.fn(async (userIds: readonly string[], charge: (userId: string) => { titre: string; corps: string; url: string; tag?: string }) => {
    // Deux nombres : « appareils inscrits » et « appareils atteints ». C'est ce qui permet à
    // `notifierParPush` de distinguer « personne n'a branché de téléphone » (rien à reprendre) de «
    // les téléphones étaient là et l'envoi a échoué » (la clé se libère).
    const atteints = new Map<string, { appareils: number; atteints: number }>();
    for (const userId of userIds) {
      faux.push.push({ userId, ...charge(userId) });
      atteints.set(userId, { appareils: 1, atteints: 1 });
    }
    return atteints;
  }),
  notifierPersonne: vi.fn(async (userId: string, charge: { titre: string; corps: string; url: string; tag?: string }) => {
    faux.push.push({ userId, ...charge });
    return 1;
  }),
}));

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; sujet: string; ref?: string }) => {
    faux.emails.push(mail);
  }),
}));

vi.mock("@/lib/settings", () => ({
  CLES: { notifications: "notifications" },
  getSetting: vi.fn(async (cle: string) => (cle === "notifications" ? faux.prefs : null)),
  setSetting: vi.fn(async () => {}),
  getDiscordWebhookUrl: vi.fn(async () => ({ url: "", source: "aucune" as const })),
}));

const { alerterPeriodeNonActivee, clePeriodeNonActivee, jalonActivation, JALONS_ACTIVATION } = await import("@/lib/notifications/periode-non-activee");

/** Le premier cours du trimestre a lieu le lundi 5 janvier 2027. */
const PREMIER_COURS = "2027-01-05";
const J3 = new Date("2027-01-02T06:00:00Z");
const J2 = new Date("2027-01-03T06:00:00Z");
const J1 = new Date("2027-01-04T06:00:00Z");

const T2: PeriodeFausse = {
  id: "p2",
  nom: "T2 2026-2027",
  dateDebut: "2027-01-04",
  dateFin: "2027-03-31",
  statut: "BROUILLON",
  membres: 12,
  seances: [{ date: PREMIER_COURS, annulee: false }, { date: "2027-01-12", annulee: false }],
};

/**
 * **Le bureau se lit sur `estAdmin`, plus sur le rôle** : « administrateur » est devenu un
 * supplément au rôle de base, et `role` ne vaut plus jamais « ADMIN ». Les acteurs d'épreuve
 * suivent donc ce que la base porte — un rôle de base, et le supplément par-dessus —, dont le cas
 * que l'ancien modèle rendait impossible : Echo enseigne **et** siège au bureau.
 *
 * `echo-i` est la contre-épreuve de la requête : une instructrice qui n'est **pas** du bureau ne doit
 * jamais recevoir ces messages d'organisation. C'est elle qui attrape la correction de travers — passer
 * de `role: "ADMIN"` à « tout l'encadrement » au lieu de `estAdmin`.
 */
const ADMINS = [
  { id: "a1", prenom: "Delta", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true, rappelEmail: true, preferencesNotifications: null },
  { id: "a2", prenom: "Echo", email: "echo@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true, rappelEmail: true, preferencesNotifications: null },
  { id: "contact", prenom: "Bureau", email: "contact@club.test", role: "MEMBRE", estAdmin: true, actif: true, rappelEmail: true, preferencesNotifications: null, service: true },
  { id: "chloe-i", prenom: "Chloé", email: "chloe@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true, rappelEmail: true, preferencesNotifications: null },
];

beforeEach(() => {
  faux.periodes = [{ ...T2 }];
  faux.admins = ADMINS.map((a) => ({ ...a }));
  faux.logs = [];
  faux.emails = [];
  faux.push = [];
  faux.prefs = null;
});

describe("le jalon d'activation", () => {
  it("trois jours avant le premier cours, puis un jour avant", () => {
    expect(JALONS_ACTIVATION).toEqual([3, 1]);
    expect(jalonActivation(PREMIER_COURS, "2027-01-02")).toBe(3);
    expect(jalonActivation(PREMIER_COURS, "2027-01-04")).toBe(1);
  });

  it("et rien les autres jours — ni la veille de J-3, ni J-2, ni le jour même", () => {
    for (const jour of ["2027-01-01", "2027-01-03", PREMIER_COURS, "2027-01-06"]) {
      expect(jalonActivation(PREMIER_COURS, jour), jour).toBeNull();
    }
  });

  it("J-3, c'est le jour où les liens seraient partis", async () => {
    const { LIENS_AVANT_DEBUT_JOURS } = await import("@/lib/invitations");
    expect(JALONS_ACTIVATION[0]).toBe(LIENS_AVANT_DEBUT_JOURS);
  });
});

describe("l'alerte aux administrateurs", () => {
  it("part à tous les administrateurs, le compte du bureau compris", async () => {
    const envoyes = await alerterPeriodeNonActivee(J3);
    expect(envoyes).toBe(3);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["contact@club.test", "delta@club.test", "echo@club.test"]);
    expect(faux.emails[0].sujet).toContain("T2 2026-2027");
    expect(faux.emails[0].sujet).toContain("dans 3 jours");
  });

  it("dit combien de personnes attendent leur lien, et mène à la période", async () => {
    await alerterPeriodeNonActivee(J3);
    expect(faux.push).toHaveLength(3);
    expect(faux.push[0].corps).toContain("12 membres");
    expect(faux.push[0].url).toBe("/admin/periodes/p2");
  });

  it("repart à J-1, sous une autre clé", async () => {
    await alerterPeriodeNonActivee(J3);
    faux.emails = [];
    await alerterPeriodeNonActivee(J1);
    expect(faux.emails).toHaveLength(3);
    expect(faux.emails[0].sujet).toContain("demain");
    expect(faux.logs.filter((l) => l.canal === "EMAIL").map((l) => l.dedupKey)).toContain(clePeriodeNonActivee("p2", "a1", 1));
  });

  it("ne se répète pas dans la même journée", async () => {
    await alerterPeriodeNonActivee(J3);
    await alerterPeriodeNonActivee(J3);
    expect(faux.emails).toHaveLength(3);
  });

  it("se tait les jours qui ne sont pas des jalons", async () => {
    expect(await alerterPeriodeNonActivee(J2)).toBe(0);
    expect(faux.emails).toHaveLength(0);
    expect(faux.push).toHaveLength(0);
  });

  it("se tait dès que la période est activée : c'est la condition même de l'alerte", async () => {
    faux.periodes = [{ ...T2, statut: "ACTIVE" }];
    expect(await alerterPeriodeNonActivee(J3)).toBe(0);
    faux.periodes = [{ ...T2, statut: "CLOSE" }];
    expect(await alerterPeriodeNonActivee(J3)).toBe(0);
  });

  it("compte depuis le premier cours, pas depuis la date de début", async () => {
    // La période s'ouvre le 4, mais le premier cours est le 8 : l'alerte part le 5, pas le 1er.
    faux.periodes = [{ ...T2, seances: [{ date: "2027-01-08", annulee: false }] }];
    expect(await alerterPeriodeNonActivee(J3)).toBe(0);
    expect(await alerterPeriodeNonActivee(new Date("2027-01-05T06:00:00Z"))).toBe(3);
  });

  it("une séance annulée n'est pas une échéance", async () => {
    faux.periodes = [
      {
        ...T2,
        seances: [
          { date: PREMIER_COURS, annulee: true },
          { date: "2027-01-12", annulee: false },
        ],
      },
    ];
    // Le premier cours qui aura lieu est le 12 : le 2 janvier ne dit plus rien.
    expect(await alerterPeriodeNonActivee(J3)).toBe(0);
    expect(await alerterPeriodeNonActivee(new Date("2027-01-09T06:00:00Z"))).toBe(3);
  });

  it("une période sans aucune séance se règle sur sa date de début", async () => {
    faux.periodes = [{ ...T2, dateDebut: PREMIER_COURS, seances: [] }];
    expect(await alerterPeriodeNonActivee(J3)).toBe(3);
  });

  it("respecte le refus d'un administrateur, sur chaque canal séparément", async () => {
    const club = preferencesDefaut();
    faux.prefs = serialiserPreferences(club);
    faux.admins = [{ ...ADMINS[0], preferencesNotifications: JSON.stringify({ periode_non_activee: { email: false, push: true } }) }];
    const envoyes = await alerterPeriodeNonActivee(J3);
    expect(envoyes).toBe(0);
    expect(faux.push.map((p) => p.userId)).toEqual(["a1"]);
  });

  it("se tait quand le club a coupé les deux canaux", async () => {
    const club = preferencesDefaut();
    club.notifications.periode_non_activee = { email: false, push: false };
    faux.prefs = serialiserPreferences(club);
    expect(await alerterPeriodeNonActivee(J3)).toBe(0);
    expect(faux.push).toHaveLength(0);
  });
});
