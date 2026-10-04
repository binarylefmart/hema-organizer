import { beforeEach, describe, expect, it, vi } from "vitest";
import { datesTrimestre, periodeAttendueApres, trimestreDe, trimestreSuivant } from "@/lib/periodes";
import { serialiserPreferences, preferencesDefaut } from "@/lib/notifications/preferences";

/**
 * **« La période suivante reste à créer »** — le rappel aux administrateurs, une semaine puis deux
 * jours avant la fin d'un trimestre.
 *
 * Deux moitiés : l'enchaînement des trimestres (fonctions pures de `src/lib/periodes.ts`, T1 → T2
 * → T3 → Été → T1 de la saison d'après), et l'envoi lui-même, joué contre une base simulée —
 * qui reçoit, quand on se tait, et l'idempotence des deux jalons.
 */

type LigneLog = { type: string; canal: string; userId: string | null; dedupKey: string; statut: string };
type PeriodeFausse = { id: string; nom: string; dateDebut: string; dateFin: string; statut: string };

const faux = vi.hoisted(() => ({
  periodes: [] as Array<{ id: string; nom: string; dateDebut: string; dateFin: string; statut: string }>,
  admins: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; sujet: string; ref?: string }>,
  push: [] as Array<{ userId: string; titre: string; corps: string; url: string; tag?: string }>,
  prefs: null as string | null,
  /** Comptes **sans accès actif** (src/lib/acces-actif.ts) : tous les autres en ont un. */
  sansAcces: new Set<string>(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    period: {
      findMany: vi.fn(async (args: { where: { statut: string; dateFin: { in: string[] } } }) =>
        faux.periodes.filter((p) => p.statut === args.where.statut && args.where.dateFin.in.includes(p.dateFin)),
      ),
      count: vi.fn(async (args: { where: { dateDebut: { gt: string } } }) => faux.periodes.filter((p) => p.dateDebut > args.where.dateDebut.gt).length),
    },
    user: {
      findMany: vi.fn(async (args: { where: { estAdmin: boolean; actif: boolean } | { AND: [{ id: { in: string[] } }, unknown] } }) =>
        // Le second appel est le tri « accès actif » (`idsAvecAccesActif`) : tout le monde a un
        // accès, sauf `faux.sansAcces`.
        "AND" in args.where
          ? args.where.AND[0].id.in.filter((id) => !faux.sansAcces.has(id)).map((id) => ({ id }))
          : faux.admins.filter((u) => "estAdmin" in args.where && u.estAdmin === args.where.estAdmin && u.actif === args.where.actif),
      ),
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

/** Le transport push, simulé : on note qui aurait été réveillé, et avec quel texte. */
vi.mock("@/lib/notifications/push", () => ({
  pushConfigure: vi.fn(async () => true),
  // Les envois groupés passent par `notifierPersonnes` : une seule lecture des appareils pour
  // toute la liste (voir `notifierParPush` dans journal.ts). Le faux garde la trace de chaque
  // personne notifiée, avec le texte qui lui était destiné.
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

const { clePeriodeSuivante, clePeriodeSuivantePush, rappelerPeriodeSuivante } = await import("@/lib/notifications/fin-periode");

/** Le 24 décembre 2026 : T1 2026-2027 finit le 31 (J-7), et le 29 sera J-2. */
const J7 = new Date("2026-12-24T06:00:00Z");
const J2 = new Date("2026-12-29T06:00:00Z");

const T1: PeriodeFausse = { id: "p1", nom: "T1 2026-2027", dateDebut: "2026-09-01", dateFin: "2026-12-31", statut: "ACTIVE" };

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
  { id: "echo-i", prenom: "Chloé", email: "chloe@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true, rappelEmail: true, preferencesNotifications: null },
];

beforeEach(() => {
  faux.periodes = [{ ...T1 }];
  faux.admins = ADMINS.map((a) => ({ ...a }));
  faux.logs = [];
  faux.emails = [];
  faux.push = [];
  faux.prefs = null;
  faux.sansAcces = new Set();
});

/* ------------------------------------------------------------------ */
/* L'enchaînement des trimestres                                       */
/* ------------------------------------------------------------------ */

describe("enchaînement des trimestres", () => {
  it("T1 → T2 → T3 → Été, puis le T1 de la saison suivante", () => {
    expect(trimestreSuivant(2026, 1)).toEqual({ saison: 2026, trimestre: 2 });
    expect(trimestreSuivant(2026, 2)).toEqual({ saison: 2026, trimestre: 3 });
    expect(trimestreSuivant(2026, 3)).toEqual({ saison: 2026, trimestre: 4 });
    // L'été referme la saison : ce qui suit est le T1 de l'année d'après
    expect(trimestreSuivant(2026, 4)).toEqual({ saison: 2027, trimestre: 1 });
  });

  it("reconnaît un trimestre enregistré par son nom, puis par ses dates", () => {
    expect(trimestreDe(T1)).toEqual({ saison: 2026, trimestre: 1 });
    // Dates rognées d'une semaine (vacances scolaires) : le nom suffit à le reconnaître
    expect(trimestreDe({ ...T1, dateFin: "2026-12-19" })).toEqual({ saison: 2026, trimestre: 1 });
    // Nom réécrit à la main : les dates exactes le rattrapent
    expect(trimestreDe({ nom: "Trimestre d'automne", dateDebut: "2026-09-01", dateFin: "2026-12-31" })).toEqual({ saison: 2026, trimestre: 1 });
    // L'été appartient encore à la saison qui s'achève
    expect(trimestreDe({ nom: "Été 2027", dateDebut: "2027-07-01", dateFin: "2027-08-31" })).toEqual({ saison: 2026, trimestre: 4 });
  });

  it("ne reconnaît pas un cycle libre : il n'appelle aucune suite", () => {
    expect(trimestreDe({ nom: "Stage de Pâques", dateDebut: "2027-04-12", dateFin: "2027-04-17" })).toBeNull();
    expect(periodeAttendueApres({ nom: "Stage de Pâques", dateDebut: "2027-04-12", dateFin: "2027-04-17" })).toBeNull();
  });

  it("annonce la période attendue, nom et dates compris", () => {
    expect(periodeAttendueApres(T1)).toEqual({ ...datesTrimestre(2026, 2), saison: 2026, trimestre: 2 });
    expect(periodeAttendueApres({ nom: "Été 2027", dateDebut: "2027-07-01", dateFin: "2027-08-31" })).toEqual({ ...datesTrimestre(2027, 1), saison: 2027, trimestre: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* L'envoi                                                             */
/* ------------------------------------------------------------------ */

describe("rappel « période suivante à créer »", () => {
  it("prévient tous les administrateurs sept jours avant la fin, le bureau compris", async () => {
    const envoyes = await rappelerPeriodeSuivante(J7);
    expect(envoyes).toBe(3);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["contact@club.test", "delta@club.test", "echo@club.test"]);
    // Le sujet dit ce qui se termine et ce qui manque
    expect(faux.emails[0].sujet).toContain("T1 2026-2027");
    expect(faux.emails[0].sujet).toContain("T2 2026-2027");
    expect(faux.logs.map((l) => l.dedupKey)).toContain(clePeriodeSuivante("p1", "a1", 7));
  });

  /**
   * **Accès actif** (src/lib/acces-actif.ts) : un administrateur qui ne peut plus entrer ne reçoit
   * plus le pense-bête. Le compte de service, lui, reste dans le tri — c'est la boîte de
   * l'association, et ces messages sont son affaire —, à condition d'avoir lui aussi un accès.
   */
  it("n'écrit qu'aux administrateurs qui ont un accès actif, le compte du bureau compris", async () => {
    faux.sansAcces = new Set(["a2"]);
    const { db } = await import("@/lib/db");
    await rappelerPeriodeSuivante(J7);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["contact@club.test", "delta@club.test"]);
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["a1", "contact"]);
    const tri = vi.mocked(db.user.findMany).mock.calls.map(([args]) => args?.where).find((w) => w && "AND" in w) as { AND: [unknown, Record<string, unknown>] };
    expect(tri.AND[1]).toMatchObject({ actif: true });
    expect(tri.AND[1]).not.toHaveProperty("service");
  });

  it("ne se répète pas le même jour, mais repart au second jalon", async () => {
    await rappelerPeriodeSuivante(J7);
    faux.emails = [];
    expect(await rappelerPeriodeSuivante(J7)).toBe(0);
    // Deux jours avant la fin : un second rappel part, avec sa propre clé
    expect(await rappelerPeriodeSuivante(J2)).toBe(3);
    expect(faux.logs.map((l) => l.dedupKey)).toContain(clePeriodeSuivante("p1", "a1", 2));
  });

  it("se tait dès qu'une période prend la suite, même en brouillon", async () => {
    faux.periodes.push({ id: "p2", nom: "T2 2026-2027", dateDebut: "2027-01-01", dateFin: "2027-03-31", statut: "BROUILLON" });
    expect(await rappelerPeriodeSuivante(J7)).toBe(0);
    expect(faux.emails).toHaveLength(0);
  });

  it("ne réclame rien après un cycle libre", async () => {
    faux.periodes = [{ id: "p9", nom: "Stage de Pâques", dateDebut: "2026-12-20", dateFin: "2026-12-31", statut: "ACTIVE" }];
    expect(await rappelerPeriodeSuivante(J7)).toBe(0);
  });

  it("n'écrit qu'aux périodes actives, et seulement aux jalons", async () => {
    faux.periodes = [{ ...T1, statut: "CLOSE" }];
    expect(await rappelerPeriodeSuivante(J7)).toBe(0);
    faux.periodes = [{ ...T1 }];
    // Trois jours avant : ce n'est ni J-7 ni J-2, rien ne part
    expect(await rappelerPeriodeSuivante(new Date("2026-12-28T06:00:00Z"))).toBe(0);
  });

  it("respecte le choix personnel d'un administrateur, et l'interrupteur du club", async () => {
    faux.admins[1].preferencesNotifications = JSON.stringify({ periode_suivante: false });
    expect(await rappelerPeriodeSuivante(J7)).toBe(2);
    expect(faux.emails.map((e) => e.to)).not.toContain("echo@club.test");
    // Interrupteur du club : le type est décoché pour l'email, plus rien ne part
    faux.emails = [];
    faux.logs = [];
    const prefs = preferencesDefaut();
    prefs.notifications.periode_suivante = { email: false };
    faux.prefs = serialiserPreferences(prefs);
    expect(await rappelerPeriodeSuivante(J7)).toBe(0);
  });

  it("pose le même pense-bête sur le téléphone, avec le lien du formulaire pré-rempli", async () => {
    await rappelerPeriodeSuivante(J7);
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["a1", "a2", "contact"]);
    expect(faux.push[0].titre).toBe("Période suivante à créer");
    expect(faux.push[0].corps).toBe("« T1 2026-2027 » se termine dans une semaine. « T2 2026-2027 » reste à créer.");
    expect(faux.push[0].url).toBe("/admin/periodes/nouvelle?saison=2026&trimestre=2");
    // Une clé par canal : le push ne prend pas la place de l'email, et ne repart pas au passage suivant.
    expect(faux.logs.map((l) => l.dedupKey)).toContain(clePeriodeSuivantePush("p1", "a1", 7));
    expect(faux.logs.map((l) => l.dedupKey)).toContain(clePeriodeSuivante("p1", "a1", 7));
    faux.push = [];
    await rappelerPeriodeSuivante(J7);
    expect(faux.push).toHaveLength(0);
    // Le second jalon, lui, repart : sa clé est différente.
    expect(await rappelerPeriodeSuivante(J2)).toBe(3);
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["a1", "a2", "contact"]);
  });

  it("sépare les deux canaux : un refus du push, un club qui le coupe, et l'email part quand même", async () => {
    faux.admins[1].preferencesNotifications = JSON.stringify({ periode_suivante: { email: true, push: false } });
    expect(await rappelerPeriodeSuivante(J7)).toBe(3);
    expect(faux.emails.map((e) => e.to)).toContain("echo@club.test");
    expect(faux.push.map((p) => p.userId)).not.toContain("a2");

    // Canal coupé côté club : plus aucune notification sur les téléphones, mais les emails partent.
    faux.logs = [];
    faux.emails = [];
    faux.push = [];
    const prefs = preferencesDefaut();
    prefs.canaux.push = false;
    faux.prefs = serialiserPreferences(prefs);
    expect(await rappelerPeriodeSuivante(J7)).toBe(3);
    expect(faux.push).toHaveLength(0);
    expect(faux.logs.some((l) => l.canal === "PUSH")).toBe(false);
  });

  it("prévient sur le téléphone un administrateur qui n'a pas donné d'adresse email", async () => {
    faux.admins = [{ id: "a3", prenom: "Sans", email: null, role: "MEMBRE", estAdmin: true, actif: true, rappelEmail: true, preferencesNotifications: null }];
    expect(await rappelerPeriodeSuivante(J7)).toBe(0); // aucun email possible…
    expect(faux.push.map((p) => p.userId)).toEqual(["a3"]); // … mais son téléphone sonne
  });

  it("écarte un compte désactivé ou sans adresse", async () => {
    faux.admins = [
      { id: "a1", prenom: "Delta", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true, rappelEmail: true, preferencesNotifications: null },
      { id: "a3", prenom: "Sans", email: null, role: "MEMBRE", estAdmin: true, actif: true, rappelEmail: true, preferencesNotifications: null },
    ];
    expect(await rappelerPeriodeSuivante(J7)).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual(["delta@club.test"]);
  });
});
