import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Quand part le lien d'un trimestre, et ce qu'il emporte avec lui**.
 *
 * Deux gestes étaient confondus, et ils ne disent pas la même chose. **Activer** un trimestre, c'est
 * l'ouvrir au travail de l'équipe : les séances apparaissent, le planning se remplit. Ça se fait des
 * semaines à l'avance. **Envoyer les liens**, c'est ouvrir l'application aux membres — et ça n'a de
 * sens qu'au moment où il y a quelque chose à y faire. Un lien reçu six semaines avant le premier
 * cours est un lien oublié, donc un lien qu'on redemandera.
 *
 * D'où : envoi **trois jours avant le premier cours** — et non trois jours avant la date de début,
 * qui n'est pas le même jour : un trimestre peut s'ouvrir un lundi pour un premier cours le jeudi,
 * et c'est le cours qui compte, puisque c'est la seule date à laquelle il y a quelque chose à faire.
 * Et un seul lien vivant par personne — les anciens sont révoqués, tous trimestres confondus.
 */

/** Un trimestre tel qu'il est **en base**, séances annulées comprises : c'est le mock de `findMany`
 *  qui rejoue le tri de Prisma, sinon on se contenterait de lui souffler la bonne réponse. */
type TrimestreFaux = {
  id: string;
  dateDebut: string;
  membres: { userId: string }[];
  seances?: { date: string; annulee?: boolean }[];
  statut?: string;
  liensEnvoyesLe?: Date | null;
};

type SelectionPeriode = { sessions: { where: { annulee: boolean }; orderBy: { date: "asc" }; take: number } };

const faux = vi.hoisted(() => ({
  periodes: [] as TrimestreFaux[],
  filtres: [] as unknown[],
  selections: [] as unknown[],
  revocations: [] as unknown[],
  crees: [] as { userId: string; periodId: string }[],
  emails: [] as { to: string; ref: string }[],
  marquees: [] as string[],
  sansEmail: [] as string[],
}));

// L'email d'invitation porte le nom de l'application : il est lu dans l'identité du club, que ces
// tests-ci n'ont pas à peupler (leur simulacre de base ne connaît pas la table `Setting`).
vi.mock("@/lib/identite", () => ({ identite: vi.fn(async () => ({ nomCourt: "CEA Organizer" })) }));

vi.mock("@/lib/db", () => ({
  db: {
    period: {
      /*
       * La requête ne trie plus sur `dateDebut` : le repère (le premier cours) vit dans une autre
       * table. Elle ramène donc tous les trimestres actifs pas encore servis, avec leur première
       * séance non annulée, et c'est le code qui tranche ensuite en mémoire. Le mock rejoue cette
       * sous-requête — filtre `annulee: false`, tri par date, `take: 1` — pour que le test porte
       * bien sur le choix du premier cours et non sur une réponse préparée.
       */
      findMany: vi.fn(async ({ where, select }: { where: { statut: string; liensEnvoyesLe: null }; select: SelectionPeriode }) => {
        faux.filtres.push(where);
        faux.selections.push(select);
        return faux.periodes
          .filter((p) => (p.statut ?? "ACTIVE") === where.statut && (p.liensEnvoyesLe ?? null) === where.liensEnvoyesLe)
          .map((p) => ({
            id: p.id,
            dateDebut: p.dateDebut,
            membres: p.membres,
            sessions: (p.seances ?? [])
              .filter((s) => (s.annulee ?? false) === select.sessions.where.annulee)
              .slice()
              .sort((a, b) => (select.sessions.orderBy.date === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)))
              .slice(0, select.sessions.take)
              .map((s) => ({ date: s.date })),
          }));
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, nom: "T2 2026-2027", statut: "ACTIVE" })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { liensEnvoyesLe: Date } }) => {
        faux.marquees.push(where.id);
        // Le marqueur est posé **en base** : c'est lui qui rend le balayage du lendemain sans effet
        const p = faux.periodes.find((x) => x.id === where.id);
        if (p) p.liensEnvoyesLe = data.liensEnvoyesLe;
        return {};
      }),
    },
    user: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        prenom: where.id,
        service: false,
        email: faux.sansEmail.includes(where.id) ? null : `${where.id}@club.test`,
      })),
    },
    invitation: {
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async ({ where }: { where: unknown }) => {
        faux.revocations.push(where);
        return { count: 1 };
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; periodId: string } }) => {
        faux.crees.push({ userId: data.userId, periodId: data.periodId });
        return data;
      }),
    },
    periodMember: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((m: { to: string; ref: string }) => {
    faux.emails.push({ to: m.to, ref: m.ref });
  }),
}));

const deconnexions = vi.hoisted(() => ({ appels: [] as string[] }));
vi.mock("@/lib/auth/session", () => ({
  revokeAllSessions: vi.fn(async (userId: string) => {
    deconnexions.appels.push(userId);
    return 0;
  }),
}));

const { envoyerLiensDesTrimestresQuiCommencent, LIENS_AVANT_DEBUT_JOURS } = await import("@/lib/invitations");

const MAINTENANT = new Date("2026-09-24T07:00:00Z");
const LENDEMAIN = new Date("2026-09-25T07:00:00Z");
/** Trois jours après le 24 septembre : le 27. C'est la date qu'un premier cours doit atteindre. */
const DANS_TROIS_JOURS = "2026-09-27";

beforeEach(() => {
  faux.periodes = [];
  faux.filtres = [];
  faux.selections = [];
  faux.revocations = [];
  faux.crees = [];
  faux.emails = [];
  faux.marquees = [];
  faux.sansEmail = [];
  deconnexions.appels = [];
});

describe("l'envoi des liens d'un trimestre qui commence", () => {
  it("ne demande à la base que les trimestres actifs pas encore servis, avec leur premier cours", async () => {
    await envoyerLiensDesTrimestresQuiCommencent(MAINTENANT);
    expect(faux.filtres).toHaveLength(1);
    expect(faux.filtres[0]).toMatchObject({ statut: "ACTIVE", liensEnvoyesLe: null });
    /*
     * **Plus aucun filtre sur `dateDebut`** : l'échéance qui décide est le premier cours, qui vit
     * dans une autre table. Le tri se fait donc en mémoire, sur ce que la sous-requête ramène —
     * une seule séance, la plus proche, et **non annulée** : une séance barrée n'est pas une échéance.
     */
    expect(faux.filtres[0]).not.toHaveProperty("dateDebut");
    expect(faux.selections[0]).toMatchObject({ sessions: { where: { annulee: false }, orderBy: { date: "asc" }, take: 1 } });
    expect(LIENS_AVANT_DEBUT_JOURS).toBe(3);
  });

  it("donne une clé neuve à chacun, et révoque toutes les anciennes", async () => {
    faux.periodes = [{ id: "p-t2", dateDebut: "2026-09-21", seances: [{ date: DANS_TROIS_JOURS }], membres: [{ userId: "u-1" }, { userId: "u-2" }] }];
    const n = await envoyerLiensDesTrimestresQuiCommencent(MAINTENANT);
    expect(n).toBe(2);
    expect(faux.crees).toEqual([
      { userId: "u-1", periodId: "p-t2" },
      { userId: "u-2", periodId: "p-t2" },
    ]);
    /*
     * **Le point qui compte** : la révocation ne porte pas de `periodId`. Elle balaie donc *tous*
     * les liens encore actifs de la personne, trimestres précédents compris — un lien oublié dans
     * une vieille boîte mail n'est plus une porte ouverte.
     */
    expect(faux.revocations).toEqual([
      { userId: "u-1", revokedAt: null },
      { userId: "u-2", revokedAt: null },
    ]);
    for (const r of faux.revocations) expect(r).not.toHaveProperty("periodId");
    // Deux emails partis, et personne déconnecté : on remplace des clés, on ne met pas le club dehors
    expect(faux.emails.map((e) => e.to)).toEqual(["u-1@club.test", "u-2@club.test"]);
    expect(deconnexions.appels).toEqual([]);
  });

  it("ne réexpédie pas le même trimestre le lendemain", async () => {
    faux.periodes = [{ id: "p-t2", dateDebut: "2026-09-21", seances: [{ date: DANS_TROIS_JOURS }], membres: [{ userId: "u-1" }] }];
    expect(await envoyerLiensDesTrimestresQuiCommencent(MAINTENANT)).toBe(1);
    // Le marqueur est posé sur la période…
    expect(faux.marquees).toEqual(["p-t2"]);
    // …et le balayage du lendemain ne la retrouve plus : le premier cours est encore devant, mais
    // le lien est déjà parti. Sans ce garde-fou, chacun recevrait un lien neuf tous les matins.
    expect(await envoyerLiensDesTrimestresQuiCommencent(LENDEMAIN)).toBe(0);
    expect(faux.emails).toHaveLength(1);
    expect(faux.marquees).toEqual(["p-t2"]);
  });

  it("saute en silence qui n'a pas d'adresse, et sert les suivants", async () => {
    faux.periodes = [
      { id: "p-t2", dateDebut: "2026-09-21", seances: [{ date: DANS_TROIS_JOURS }], membres: [{ userId: "u-1" }, { userId: "u-2" }, { userId: "u-3" }] },
    ];
    faux.sansEmail = ["u-2"];
    const n = await envoyerLiensDesTrimestresQuiCommencent(MAINTENANT);
    expect(n).toBe(2);
    expect(faux.emails.map((e) => e.to)).toEqual(["u-1@club.test", "u-3@club.test"]);
    // Le trimestre est marqué malgré l'échec : réexpédier demain pour rattraper une personne
    // enverrait un second lien à toutes les autres. Le cas manquant se rattrape à la main.
    expect(faux.marquees).toEqual(["p-t2"]);
  });
});

/**
 * **C'est le premier cours qui déclenche l'envoi, pas la date de début.**
 *
 * Les deux se ressemblent assez pour qu'on les confonde, et c'est précisément pour ça que ces cas
 * existent : un trimestre administrativement ouvert le lundi dont le premier cours tombe trois
 * semaines plus tard n'a rien à proposer à personne, et le lien reçu en attendant serait oublié.
 */
describe("le repère est le premier cours", () => {
  it("attend, quand le trimestre s'ouvre dans trois jours mais que le premier cours est dans trois semaines", async () => {
    faux.periodes = [{ id: "p-tard", dateDebut: DANS_TROIS_JOURS, seances: [{ date: "2026-10-15" }], membres: [{ userId: "u-1" }] }];
    expect(await envoyerLiensDesTrimestresQuiCommencent(MAINTENANT)).toBe(0);
    expect(faux.emails).toEqual([]);
    // Rien n'est marqué non plus : le trimestre doit être repris par le balayage du 12 octobre
    expect(faux.marquees).toEqual([]);
  });

  it("envoie quand le premier cours est dans trois jours, même si le trimestre a commencé depuis longtemps", async () => {
    faux.periodes = [{ id: "p-tot", dateDebut: "2026-08-01", seances: [{ date: DANS_TROIS_JOURS }], membres: [{ userId: "u-1" }] }];
    expect(await envoyerLiensDesTrimestresQuiCommencent(MAINTENANT)).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual(["u-1@club.test"]);
    expect(faux.marquees).toEqual(["p-tot"]);
  });

  it("ne compte pas une séance annulée comme premier cours", async () => {
    // La séance du 27 est barrée : rien n'aura lieu ce jour-là, donc rien à faire dans l'application.
    // Le vrai premier cours est le 15 octobre, et les liens partiront trois jours avant celui-là.
    faux.periodes = [
      {
        id: "p-annule",
        dateDebut: "2026-09-21",
        seances: [
          { date: DANS_TROIS_JOURS, annulee: true },
          { date: "2026-10-15" },
        ],
        membres: [{ userId: "u-1" }],
      },
    ];
    expect(await envoyerLiensDesTrimestresQuiCommencent(MAINTENANT)).toBe(0);
    expect(faux.emails).toEqual([]);
    expect(faux.marquees).toEqual([]);
  });

  it("retombe sur la date de début quand aucune séance n'a encore été engendrée", async () => {
    // Un trimestre créé sans ses séances (elles viendront plus tard) n'a pas de premier cours à
    // regarder : la date de début est alors la seule échéance connue, et elle vaut repère.
    faux.periodes = [
      { id: "p-sans-seances", dateDebut: DANS_TROIS_JOURS, membres: [{ userId: "u-1" }] },
      { id: "p-plus-tard", dateDebut: "2026-10-20", membres: [{ userId: "u-2" }] },
    ];
    expect(await envoyerLiensDesTrimestresQuiCommencent(MAINTENANT)).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual(["u-1@club.test"]);
    expect(faux.marquees).toEqual(["p-sans-seances"]);
  });
});
