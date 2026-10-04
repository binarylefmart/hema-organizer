import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **« Trois appareils » doit vouloir dire trois appareils qui se servent du lien.**
 *
 * Deux faux positifs corrigés, dans cet ordre :
 *
 * 1. Le plafond se lisait sur `Invitation.ouvertures` — le cumul de toutes les connexions faites
 *    avec ce lien depuis sa création. Un lien vit quatre mois, une session douze heures : quelqu'un
 *    qui n'a pas de mot de passe rouvre son lien **depuis le même téléphone** chaque fois qu'il
 *    revient. À la quatrième ouverture, donc au bout de quelques jours, son lien était révoqué.
 * 2. On a donc compté les sessions vivantes — mais **toutes**, quelle qu'en soit la porte d'entrée.
 *    Le téléphone le matin, le portable l'après-midi, la tablette du club le soir, tous trois au
 *    **mot de passe** : trois sessions vivantes qui n'ont jamais touché au lien. La personne ouvrait
 *    ensuite son lien depuis sa boîte mail et se faisait révoquer, déconnecter partout, avec une
 *    alerte au bureau racontant un partage de lien qui n'avait pas eu lieu.
 *
 * On compte maintenant les sessions vivantes **d'origine « lien »** (`AuthSession.origine`, posée à
 * la création de la session). Ce fichier verrouille les deux sens : l'usage ordinaire qu'on laisse
 * tranquille, et le lien réellement recopié qu'on remplace — avec ses sessions, et l'alerte.
 */

const faux = vi.hoisted(() => ({
  /** Sessions en base, toutes personnes confondues (une par appareil connecté). */
  sessions: [] as { userId: string; expiresAt: Date; origine: string | null }[],
  periode: { id: "p-1", nom: "T4 2026", statut: "ACTIVE" } as { id: string; nom: string; statut: string },
  /** La fiche de Chloé : l'adresse email est facultative, le mot de passe aussi. */
  compte: { email: "chloe@club.test", passwordHash: null } as { email: string | null; passwordHash: string | null },
  revocations: [] as { id: string; motif: string | null }[],
  liensCrees: [] as { userId: string; periodId: string }[],
  envois: [] as { to: string; ref: string }[],
  deconnexions: [] as { userId: string; saufCourante: boolean }[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    authSession: {
      // Le compte doit filtrer exactement comme Prisma : même personne, session encore vivante,
      // **et** origine demandée (une `origine` absente du `where` ne filtrerait rien).
      count: vi.fn(async ({ where }: { where: { userId: string; expiresAt: { gt: Date }; origine?: string } }) =>
        faux.sessions.filter(
          (s) =>
            s.userId === where.userId &&
            s.expiresAt.getTime() > where.expiresAt.gt.getTime() &&
            (where.origine === undefined || s.origine === where.origine),
        ).length,
      ),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, ...faux.compte })),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, prenom: "Chloé", email: faux.compte.email, service: false })),
    },
    period: {
      findUnique: vi.fn(async () => faux.periode),
      findUniqueOrThrow: vi.fn(async () => faux.periode),
    },
    invitation: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { motifRevocation?: string } }) => {
        faux.revocations.push({ id: where.id, motif: data.motifRevocation ?? null });
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: { userId: string; periodId: string } }) => {
        faux.liensCrees.push({ userId: data.userId, periodId: data.periodId });
        return {};
      }),
    },
    periodMember: { upsert: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/lib/identite", () => ({ identite: vi.fn(async () => ({ nomCourt: "CEA Organizer" })) }));
vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((message: { to: string; ref: string }) => {
    faux.envois.push({ to: message.to, ref: message.ref });
  }),
}));
vi.mock("@/lib/notifications/journal", () => ({ journaliser: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/session", () => ({
  revokeAllSessions: vi.fn(async (userId: string, saufCourante = false) => {
    faux.deconnexions.push({ userId, saufCourante });
    return 0;
  }),
}));

const { lienSature, verifierAppareils, MAX_APPAREILS_PAR_LIEN } = await import("@/lib/invitations");

/** Le lien de Chloé, tel que `checkInvitation` le rend à la page d'entrée. */
const LIEN = { id: "inv-1", userId: "u-chloe", periodId: "p-1" };

/**
 * Le même lien, avec le cumul d'ouvertures que la base tient toujours — il sert au suivi affiché
 * sur la fiche du membre et au rang de l'appareil dans le journal, il ne décide plus du plafond.
 */
function lienOuvert(ouvertures: number) {
  return { ...LIEN, ouvertures };
}

/** Pose `n` sessions vivantes (12 h) pour quelqu'un, en disant par quelle porte elles sont entrées. */
function connecter(userId: string, n: number, origine: string | null = "lien"): void {
  for (let i = 0; i < n; i++) faux.sessions.push({ userId, expiresAt: new Date(Date.now() + 12 * 3_600_000), origine });
}

beforeEach(() => {
  faux.sessions.length = 0;
  faux.revocations.length = 0;
  faux.liensCrees.length = 0;
  faux.envois.length = 0;
  faux.deconnexions.length = 0;
  faux.periode = { id: "p-1", nom: "T4 2026", statut: "ACTIVE" };
  faux.compte = { email: "chloe@club.test", passwordHash: null };
});

describe("le plafond d'appareils ne compte que les sessions ouvertes par le lien", () => {
  /**
   * Le faux positif signalé par la relecture adverse : la journée ordinaire de quelqu'un qui s'est
   * donné un mot de passe. Rien de tout cela ne s'est servi du lien.
   */
  it("trois connexions par mot de passe dans la journée, puis une ouverture du lien : rien n'est révoqué", async () => {
    connecter("u-chloe", 3, "mot-de-passe"); // le téléphone, le portable, la tablette du club
    faux.compte.passwordHash = "argon2id$…";
    expect(await verifierAppareils(lienOuvert(1))).toBe("rien");
    // Ni révocation, ni nouveau lien, ni déconnexion — donc pas d'alerte mensongère au bureau.
    expect(faux.revocations).toHaveLength(0);
    expect(faux.envois).toHaveLength(0);
    expect(faux.deconnexions).toHaveLength(0);
  });

  it("deux sessions par mot de passe et deux par lien ne font toujours que deux appareils du lien", async () => {
    connecter("u-chloe", 2, "mot-de-passe");
    connecter("u-chloe", 2, "lien");
    expect(await verifierAppareils(lienOuvert(4))).toBe("rien");
    expect(faux.revocations).toHaveLength(0);
  });

  /**
   * Les sessions ouvertes avant la migration n'ont pas d'origine connue. Elles restent parfaitement
   * valables — on ne déconnecte personne pour une colonne ajoutée — et ne comptent nulle part : en
   * cas de doute, on ne révoque pas.
   */
  it("les sessions d'avant la migration (origine inconnue) ne comptent pour personne", async () => {
    connecter("u-chloe", 5, null);
    expect(await verifierAppareils(lienOuvert(5))).toBe("rien");
    expect(faux.revocations).toHaveLength(0);
  });

  it("le même téléphone qui rouvre son lien pour la quatrième fois n'est pas un quatrième appareil", async () => {
    // Le cumul d'ouvertures dit 3 ; la vérité est : une seule session ouverte, sur un seul téléphone.
    connecter("u-chloe", 1);
    expect(await verifierAppareils(lienOuvert(3))).toBe("rien");
    expect(faux.revocations).toHaveLength(0);
    expect(faux.envois).toHaveLength(0);
    expect(faux.deconnexions).toHaveLength(0);
  });

  it("quatre mois d'ouvertures depuis le même appareil ne saturent jamais rien", async () => {
    connecter("u-chloe", 1);
    expect(await verifierAppareils(lienOuvert(87))).toBe("rien");
    expect(faux.revocations).toHaveLength(0);
  });

  /** Le vrai positif : celui-là ne doit surtout pas s'assouplir. */
  it("un lien recopié sur un quatrième appareil est révoqué, remplacé, et tout ce qu'il a ouvert tombe", async () => {
    connecter("u-chloe", MAX_APPAREILS_PAR_LIEN, "lien");
    // « remplace » : un lien neuf est vraiment parti — c'est ce que l'écran d'après annonce.
    expect(await verifierAppareils(lienOuvert(3))).toBe("remplace");
    expect(faux.revocations).toEqual([{ id: "inv-1", motif: "APPAREILS" }]);
    // Un lien neuf part par email, et tout ce que l'ancien avait ouvert tombe.
    expect(faux.liensCrees).toEqual([{ userId: "u-chloe", periodId: "p-1" }]);
    expect(faux.envois[0]?.to).toBe("chloe@club.test");
    expect(faux.deconnexions).toEqual([{ userId: "u-chloe", saufCourante: false }]);
  });

  it("les sessions du lien déjà expirées n'occupent plus d'appareil", async () => {
    for (let i = 0; i < 5; i++) faux.sessions.push({ userId: "u-chloe", expiresAt: new Date(Date.now() - 1000), origine: "lien" });
    connecter("u-chloe", 1);
    expect(await verifierAppareils(lienOuvert(5))).toBe("rien");
  });

  it("les sessions des autres membres ne comptent pas non plus", async () => {
    connecter("u-hotel", 9);
    connecter("u-chloe", 2);
    expect(await verifierAppareils(lienOuvert(2))).toBe("rien");
  });

  it("la fonction pure compare bien des sessions du lien au plafond", () => {
    expect(lienSature(0, 3)).toBe(false);
    expect(lienSature(2, 3)).toBe(false);
    expect(lienSature(3, 3)).toBe(true);
  });
});

/**
 * **Ne jamais enfermer quelqu'un dehors.** Cette garde ne protège personne si elle se déclenche à
 * tort : elle ne fait que couper l'accès d'un membre. On ne ferme donc une porte que si l'on peut en
 * désigner une autre — un nouveau lien qui part vraiment, ou un mot de passe.
 */
describe("le plafond ne révoque que si la personne peut revenir", () => {
  it("sans adresse email ni mot de passe, le lien saturé n'est pas révoqué", async () => {
    // L'adresse a été retirée de la fiche après l'envoi du lien : aucun remplacement ne peut partir.
    faux.compte = { email: null, passwordHash: null };
    connecter("u-chloe", MAX_APPAREILS_PAR_LIEN, "lien");
    expect(await verifierAppareils(lienOuvert(3))).toBe("rien");
    expect(faux.revocations).toHaveLength(0);
    expect(faux.deconnexions).toHaveLength(0);
  });

  it("sans adresse email mais avec un mot de passe, le lien tombe et ses sessions avec lui", async () => {
    faux.compte = { email: null, passwordHash: "argon2id$…" };
    connecter("u-chloe", MAX_APPAREILS_PAR_LIEN, "lien");
    // …et l'issue le **dit**, pour que l'écran ne promette pas un email.
    expect(await verifierAppareils(lienOuvert(3))).toBe("remplace-sans-email");
    expect(faux.revocations).toEqual([{ id: "inv-1", motif: "APPAREILS" }]);
    // Aucun lien ne part (pas d'adresse), mais rien n'est relâché : les sessions du lien tombent.
    expect(faux.envois).toHaveLength(0);
    expect(faux.deconnexions).toEqual([{ userId: "u-chloe", saufCourante: false }]);
  });

  it("période close et pas de mot de passe : on ne révoque pas, aucun lien ne pourrait la remplacer", async () => {
    faux.periode = { id: "p-1", nom: "T3 2026", statut: "CLOSE" };
    connecter("u-chloe", MAX_APPAREILS_PAR_LIEN, "lien");
    expect(await verifierAppareils(lienOuvert(3))).toBe("rien");
    expect(faux.revocations).toHaveLength(0);
    expect(faux.envois).toHaveLength(0);
  });

  it("période close mais mot de passe défini : le lien saturé est bien révoqué, sans email envoyé", async () => {
    faux.periode = { id: "p-1", nom: "T3 2026", statut: "CLOSE" };
    faux.compte.passwordHash = "argon2id$…";
    connecter("u-chloe", MAX_APPAREILS_PAR_LIEN, "lien");
    expect(await verifierAppareils(lienOuvert(3))).toBe("remplace-sans-email");
    expect(faux.revocations).toEqual([{ id: "inv-1", motif: "APPAREILS" }]);
    expect(faux.envois).toHaveLength(0);
    expect(faux.deconnexions).toEqual([{ userId: "u-chloe", saufCourante: false }]);
  });
});

/**
 * L'origine se pose à la création de la session, et nulle part ailleurs : si un jour une porte
 * d'entrée oublie de se nommer, le plafond se remet à mentir dans un sens ou dans l'autre. Ces
 * vérifications lisent le source, comme celles de `elevation-admin.test.ts`, parce que c'est
 * exactement ce qu'on veut figer : **qui** appelle **avec quoi**.
 */
describe("chaque porte d'entrée dit par où elle passe", () => {
  const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

  it("seule la connexion par lien personnel ouvre une session d'origine « lien »", () => {
    const actions = lire("src/actions/auth.ts");
    const origines = actions.match(/createSession\([^)]*\)/g) ?? [];
    expect(origines.filter((appel) => appel.includes('"lien"'))).toHaveLength(1);
    // Toutes les autres se nomment « mot-de-passe » : aucune création de session ne reste muette.
    expect(origines.filter((appel) => appel.includes('"mot-de-passe"'))).toHaveLength(origines.length - 1);
    expect(actions).toContain('await createSession(userId, true, "lien");');
  });

  it("le plafond filtre bien sur l'origine, et pas sur `forte` (qui ne dit plus rien de la porte)", () => {
    const invitations = lire("src/lib/invitations.ts");
    expect(invitations).toContain('const ORIGINE_COMPTEE: OrigineSession = "lien";');
    expect(invitations).toContain("where: { userId: invitation.userId, expiresAt: { gt: now }, origine: ORIGINE_COMPTEE },");
    const corps = /export async function verifierAppareils[\s\S]*?\n}/.exec(invitations)?.[0] ?? "";
    expect(corps).not.toContain("forte");
  });
});
