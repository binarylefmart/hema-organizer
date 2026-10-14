import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **« Demander la réinitialisation de ma double authentification »** — le bouton de « Mon profil »
 * pour qui a perdu son téléphone et n'entre plus dans l'espace admin.
 *
 * Ce qui est tenu ici :
 * - **qui est prévenu** : tous les autres membres actifs du bureau, **jamais la personne qui
 *   demande** (même du bureau), et le compte du portail seulement à défaut d'un autre ;
 * - **pas de rafale** : une demande toutes les six heures (journal d'audit), le limiteur et la clé de
 *   déduplication tenant la même borne quand deux appuis arrivent ensemble ;
 * - **ce qui se lit dans « Comptes admin »** : une demande attend tant qu'aucune réinitialisation ne
 *   l'a suivie ;
 * - les gestes de sa propre 2FA, déplacés dans l'espace admin, **exigent l'élévation**.
 */

type Compte = {
  id: string;
  prenom: string;
  nom: string;
  email: string | null;
  role: string;
  estAdmin: boolean;
  actif: boolean;
  service: boolean;
  totpSecret: string | null;
  totpActiveAt: Date | null;
};

const faux = vi.hoisted(() => ({
  utilisateur: null as { id: string; email: string | null } | null,
  comptes: [] as Array<Record<string, unknown>>,
  audits: [] as Array<{
    acteurId: string | null;
    action: string;
    cible: string | null;
    date: Date;
  }>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{
    to: string;
    sujet: string;
    contenu: { paragraphes: string[] };
  }>,
  push: [] as string[],
  echecEmail: null as Error | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          faux.comptes.find((c) => c.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async ({ where }: { where: { estAdmin?: boolean; actif?: boolean } }) =>
          faux.comptes.filter(
            (c) =>
              (where.estAdmin === undefined || c.estAdmin === where.estAdmin) &&
              (where.actif === undefined || c.actif === where.actif),
          ),
      ),
    },
    auditLog: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { action: string; acteurId: string; date: { gt: Date } };
        }) => {
          const lignes = faux.audits
            .filter(
              (a) =>
                a.action === where.action &&
                a.acteurId === where.acteurId &&
                a.date > where.date.gt,
            )
            .sort((a, b) => +b.date - +a.date);
          return lignes[0] ? { date: lignes[0].date } : null;
        },
      ),
    },
    notificationLog: {
      findUnique: vi.fn(async (args: { where: { dedupKey: string } }) => faux.logs.find((l) => l.dedupKey === args.where.dedupKey) ?? null),
      findMany: vi.fn(async (args: { where: { dedupKey: { in: string[] } } }) =>
        faux.logs
          .filter((l) => args.where.dedupKey.in.includes(l.dedupKey as string))
          .map((l) => ({ dedupKey: l.dedupKey })),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (faux.logs.some((l) => l.dedupKey === data.dedupKey))
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        faux.logs.push({ ...data });
        return data;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { dedupKey: string };
          data: Record<string, unknown>;
        }) => {
          const ligne = faux.logs.find((l) => l.dedupKey === where.dedupKey);
          if (!ligne) throw new Error("introuvable");
          Object.assign(ligne, data);
          return ligne;
        },
      ),
    },
  },
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(
    async (
      acteur: { id: string } | null,
      action: string,
      cible?: string | null,
    ) => {
      faux.audits.push({
        acteurId: acteur?.id ?? null,
        action,
        cible: cible ?? null,
        date: new Date(),
      });
    },
  ),
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => faux.utilisateur),
  assertPermission: vi.fn(async () => {
    throw new Error("élévation exigée");
  }),
  exigerReauth: vi.fn(async () => {}),
}));
vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn(
    (
      mail: { to: string; sujet: string; contenu: { paragraphes: string[] } },
      onDone?: (err: Error | null) => void,
    ) => {
      faux.emails.push(mail);
      onDone?.(faux.echecEmail);
    },
  ),
}));
vi.mock("@/lib/notifications/push", () => ({
  notifierPersonnes: vi.fn(async (userIds: readonly string[]) => {
    for (const id of userIds) faux.push.push(id);
    return new Map(userIds.map((id) => [id, { appareils: 1, atteints: 1 }]));
  }),
}));
vi.mock("@/lib/identite", () => ({
  identite: vi.fn(async () => ({
    nomClub: "Cercle",
    nomCourt: "Cercle Organizer",
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { destinatairesDemande, demandesEnAttente, DELAI_ENTRE_DEMANDES_MS } =
  await import("@/lib/auth/demande-deux-fa");
const { demanderReinitialisationDeuxFa } = await import("@/actions/profil");
const { regenererMesCodesSecours, reinitialiserMaDeuxFa, retirerDeuxFaMembre } =
  await import("@/actions/admin");
const { utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");

const ACTIVE = new Date("2026-09-01T10:00:00Z");
const compte = (
  id: string,
  prenom: string,
  extra: Partial<Compte> = {},
): Compte => ({
  id,
  prenom,
  nom: "Test",
  email: `${prenom.toLowerCase()}@club.test`,
  role: "MEMBRE",
  estAdmin: true,
  actif: true,
  service: false,
  totpSecret: "s",
  totpActiveAt: ACTIVE,
  ...extra,
});
const portail = compte("p", "Portail", {
  email: "contact@club.test",
  service: true,
});
const alix = compte("a", "Alix");
const basile = compte("b", "Basile");
const camille = compte("c", "Camille");

beforeEach(() => {
  utiliserMagasinMemoire();
  faux.utilisateur = null;
  faux.comptes = [];
  faux.audits = [];
  faux.logs = [];
  faux.emails = [];
  faux.push = [];
  faux.echecEmail = null;
});

describe("qui reçoit la demande", () => {
  it("tous les autres membres du bureau, jamais la personne qui demande — ni le portail quand il y a quelqu'un", () => {
    const { destinataires, repliPortail } = destinatairesDemande("a", [
      alix,
      basile,
      camille,
      portail,
    ]);
    expect(destinataires.map((d) => d.id)).toEqual(["b", "c"]);
    expect(repliPortail).toBe(false);
  });

  it("le compte du portail, à défaut d'aucun autre membre du bureau", () => {
    const { destinataires, repliPortail } = destinatairesDemande("a", [
      alix,
      portail,
    ]);
    expect(destinataires.map((d) => d.id)).toEqual(["p"]);
    expect(repliPortail).toBe(true);
  });

  it("quand c'est le portail qui demande : les personnes du bureau, et lui jamais", () => {
    expect(
      destinatairesDemande("p", [alix, portail]).destinataires.map((d) => d.id),
    ).toEqual(["a"]);
    expect(destinatairesDemande("p", [portail]).destinataires).toEqual([]);
  });
});

/** Les emails partis **au bureau** — l'avis personnel au titulaire (« … ta double authentification ») à part. */
const auBureau = () => faux.emails.filter((e) => !e.sujet.includes("ta double authentification"));
const auTitulaire = () => faux.emails.filter((e) => e.sujet.includes("ta double authentification"));

describe("demanderReinitialisationDeuxFa", () => {
  it("prévient les autres membres du bureau par email et sur le téléphone, et pas la personne elle-même", async () => {
    faux.comptes = [alix, basile, camille, portail];
    faux.utilisateur = { id: "a", email: alix.email };
    const r = await demanderReinitialisationDeuxFa();
    expect(r.succes).toMatch(/^Ta demande est partie au bureau/);
    expect(auBureau().map((e) => e.to).sort()).toEqual([
      "basile@club.test",
      "camille@club.test",
    ]);
    expect(auBureau().some((e) => e.to === alix.email)).toBe(false);
    // La personne elle-même reçoit son avis de sécurité, à sa propre adresse et sur ses appareils
    expect(auTitulaire().map((e) => e.to)).toEqual([alix.email]);
    expect(faux.push.sort()).toEqual(["a", "b", "c"]);
    // Le message nomme la personne et mène à « Comptes admin »
    expect(auBureau()[0].sujet).toContain("Alix Test");
    expect(
      faux.audits.some(
        (a) =>
          a.action === "deux_fa.reinitialisation_demandee" &&
          a.acteurId === "a",
      ),
    ).toBe(true);
  });

  it("se replie sur le compte du portail quand il n'y a personne d'autre au bureau", async () => {
    faux.comptes = [alix, portail];
    faux.utilisateur = { id: "a", email: alix.email };
    const r = await demanderReinitialisationDeuxFa();
    expect(r.succes).toMatch(/compte du portail/);
    expect(auBureau().map((e) => e.to)).toEqual(["contact@club.test"]);
  });

  it("depuis le compte du portail : rappelle la commande de secours aux autres", async () => {
    faux.comptes = [alix, portail];
    faux.utilisateur = { id: "p", email: portail.email };
    await demanderReinitialisationDeuxFa();
    expect(auBureau().map((e) => e.to)).toEqual(["alix@club.test"]);
    expect(auBureau()[0].contenu.paragraphes.join(" ")).toContain(
      "npm run admin:reset-2fa -- contact@club.test",
    );
  });

  it("ne repart pas avant six heures, et le dit", async () => {
    faux.comptes = [alix, basile];
    faux.utilisateur = { id: "a", email: alix.email };
    await demanderReinitialisationDeuxFa();
    faux.emails = [];
    const r = await demanderReinitialisationDeuxFa();
    expect(r.erreur).toMatch(/déjà partie au bureau/);
    expect(faux.emails).toEqual([]);
    expect(DELAI_ENTRE_DEMANDES_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("le limiteur tient la borne même sans trace au journal (deux appuis simultanés)", async () => {
    faux.comptes = [alix, basile];
    faux.utilisateur = { id: "a", email: alix.email };
    await demanderReinitialisationDeuxFa();
    faux.audits = []; // l'audit de la première n'est pas encore écrit
    faux.emails = [];
    const r = await demanderReinitialisationDeuxFa();
    expect(r.erreur).toMatch(/déjà partie/);
    expect(faux.emails).toEqual([]);
  });

  it("la clé de déduplication est posée avant l'envoi et libérée si l'envoi échoue", async () => {
    faux.comptes = [alix, basile];
    faux.utilisateur = { id: "a", email: alix.email };
    faux.echecEmail = new Error("SMTP indisponible");
    await demanderReinitialisationDeuxFa();
    const ligne = faux.logs.find((l) => l.canal === "EMAIL");
    expect(ligne?.statut).toBe("ECHEC");
    expect(String(ligne?.dedupKey)).toMatch(/^demande_2fa_a_\d+_echec_/);
  });

  it("une demande dont l'email a échoué ne bloque pas six heures : la personne peut redemander", async () => {
    faux.comptes = [alix, basile];
    faux.utilisateur = { id: "a", email: alix.email };
    faux.echecEmail = new Error("SMTP indisponible");
    await demanderReinitialisationDeuxFa();
    faux.echecEmail = null;
    faux.emails = [];
    const r = await demanderReinitialisationDeuxFa();
    expect(r.succes).toMatch(/^Ta demande est partie au bureau/);
    expect(auBureau().map((e) => e.to)).toEqual(["basile@club.test"]);
  });

  it("signale au bureau un mot de passe réinitialisé récemment (« mot de passe oublié »)", async () => {
    faux.comptes = [alix, basile];
    faux.utilisateur = { id: "a", email: alix.email };
    faux.audits.push({ action: "mot_de_passe.reinitialise", acteurId: "a", date: new Date(Date.now() - 60_000) } as never);
    await demanderReinitialisationDeuxFa();
    expect(auBureau()[0].contenu.paragraphes[0]).toMatch(/réinitialisé par « mot de passe oublié »/);
  });

  it("refuse sans double authentification active, et sans session", async () => {
    faux.comptes = [{ ...alix, totpActiveAt: null }, basile];
    faux.utilisateur = { id: "a", email: alix.email };
    expect((await demanderReinitialisationDeuxFa()).erreur).toMatch(
      /rien à réinitialiser/,
    );
    faux.utilisateur = null;
    expect((await demanderReinitialisationDeuxFa()).erreur).toMatch(
      /session a expiré/,
    );
    expect(faux.emails).toEqual([]);
  });

  it("le portail seul au bureau reçoit la commande de secours à l'écran", async () => {
    faux.comptes = [portail];
    faux.utilisateur = { id: "p", email: portail.email };
    expect((await demanderReinitialisationDeuxFa()).erreur).toContain(
      "npm run admin:reset-2fa",
    );
    expect(faux.emails).toEqual([]);
  });
});

describe("demande en attente dans « Comptes admin »", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 9, 14, h));
  it("attend tant qu'aucune réinitialisation ne l'a suivie", () => {
    const attente = demandesEnAttente(
      [
        { acteurId: "a", date: t(8) },
        { acteurId: "b", date: t(8) },
        { acteurId: "c", date: t(6) },
        { acteurId: "c", date: t(12) },
      ],
      [
        { cible: "b", date: t(9) },
        { cible: "c", date: t(10) },
      ],
    );
    expect([...attente.keys()].sort()).toEqual(["a", "c"]);
    expect(attente.get("c")).toEqual(t(12));
  });
});

describe("sa propre double authentification, dans l'espace admin", () => {
  it("chaque geste exige l'élévation (assertPermission)", async () => {
    const fd = new FormData();
    fd.set("motDePasse", "x");
    await expect(regenererMesCodesSecours({}, fd)).rejects.toThrow(
      "élévation exigée",
    );
    await expect(reinitialiserMaDeuxFa({}, fd)).rejects.toThrow(
      "élévation exigée",
    );
    await expect(retirerDeuxFaMembre("m")).rejects.toThrow("élévation exigée");
  });
});
