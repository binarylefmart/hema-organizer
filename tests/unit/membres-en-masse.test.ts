import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, type UserLike } from "@/lib/permissions";

/**
 * Désactivation / réactivation de tous les comptes d'un coup, envoi du lien personnel
 * depuis la liste, et frontière ADMIN / INSTRUCTEUR sur la gestion des comptes.
 */

type Compte = { id: string; prenom: string; nom: string; email: string; role: string; actif: boolean; service: boolean; couleur: number | null };

const faux = vi.hoisted(() => ({
  /** Personne connectée qui déclenche l'action */
  acteur: { id: "u-admin", email: "delta@club.test", role: "ADMIN", actif: true } as { id: string; email: string; role: string; actif: boolean },
  comptes: [] as Record<string, unknown>[],
  periode: { id: "p-active", nom: "T4 2026", statut: "ACTIVE" } as { id: string; nom: string; statut: string },
  filtres: [] as unknown[],
  misAJour: [] as { ids: string[]; actif: boolean }[],
  crees: [] as unknown[],
  supprimes: [] as unknown[],
  sessionsRevoquees: [] as string[],
  audits: [] as { action: string; cible: string | null; details: unknown }[],
  reauths: [] as string[],
  envois: [] as { userId: string; periodId: string }[],
}));

/** Filtre Prisma minimal : uniquement les clauses dont les actions se servent. */
function correspond(u: Record<string, unknown>, where: Record<string, unknown> = {}) {
  const idNot = (where.id as { not?: string } | undefined)?.not;
  if (where.service !== undefined && u.service !== where.service) return false;
  if (where.actif !== undefined && u.actif !== where.actif) return false;
  if (idNot !== undefined && u.id === idNot) return false;
  return true;
}

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        faux.filtres.push(where);
        return faux.comptes.filter((u) => correspond(u, where));
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { actif: boolean } }) => {
        const ids = where.id.in;
        for (const u of faux.comptes) if (ids.includes(u.id as string)) u.actif = data.actif;
        faux.misAJour.push({ ids, actif: data.actif });
        return { count: ids.length };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const u = faux.comptes.find((c) => c.id === where.id);
        if (!u) throw new Error("Compte introuvable");
        return u;
      }),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.crees.push(data);
        return { id: "u-neuf", ...data };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        faux.supprimes.push(where.id);
        return {};
      }),
    },
    period: { findUniqueOrThrow: vi.fn(async () => faux.periode) },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  revokeAllSessions: vi.fn(async (userId: string) => {
    faux.sessionsRevoquees.push(userId);
    return 1;
  }),
}));

vi.mock("@/lib/invitations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invitations")>()),
  envoyerInvitation: vi.fn(async (userId: string, periodId: string) => {
    faux.envois.push({ userId, periodId });
  }),
}));

// La matrice réelle des permissions décide : l'acteur simulé change simplement de rôle.
vi.mock("@/lib/auth/current-user", async () => {
  const { can: vraiCan } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof vraiCan>[1]) => {
      if (!vraiCan(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async (_u: unknown, suite: string) => {
      faux.reauths.push(suite);
    }),
    getCurrentUser: vi.fn(async () => null),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { periodeDuLien } = await import("@/lib/membres");
const { creerMembre, definirActif, definirActifTous, envoyerLienMembre, importerMembres, supprimerMembre } =
  await import("@/actions/membres");

const compte = (id: string, role: string, options: Partial<Compte> = {}): Record<string, unknown> => ({
  id,
  prenom: id,
  nom: "Test",
  email: `${id}@club.test`,
  role,
  actif: true,
  service: false,
  couleur: null,
  passwordHash: null,
  ...options,
});

const ADMIN = { id: "u-admin", email: "delta@club.test", role: "ADMIN", actif: true };
const INSTRUCTEUR = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", actif: true };

function jeuDeComptes() {
  return [
    compte("portail", "ADMIN", { service: true, email: "contact@club.test" }),
    compte("u-admin", "ADMIN"),
    compte("u-admin2", "ADMIN"), // co-administrateur : il fait partie du lot
    compte("u-instru", "INSTRUCTEUR"),
    compte("u-m1", "MEMBRE"),
    compte("u-m2", "MEMBRE", { actif: false }), // déjà désactivé à la main
  ];
}

beforeEach(() => {
  faux.acteur = { ...ADMIN };
  faux.comptes = jeuDeComptes();
  faux.periode = { id: "p-active", nom: "T4 2026", statut: "ACTIVE" };
  faux.filtres = [];
  faux.misAJour = [];
  faux.crees = [];
  faux.supprimes = [];
  faux.sessionsRevoquees = [];
  faux.audits = [];
  faux.reauths = [];
  faux.envois = [];
});

const actifs = () => faux.comptes.filter((c) => c.actif).map((c) => c.id);

describe("désactivation de tous les comptes", () => {
  it("est refusée à un instructeur (rien n'est touché)", async () => {
    faux.acteur = { ...INSTRUCTEUR };
    await expect(definirActifTous(false)).rejects.toThrow("Accès refusé");
    expect(faux.misAJour).toEqual([]);
    expect(faux.audits).toEqual([]);
    expect(actifs()).toContain("u-m1");
  });

  it("exige un code 2FA récent avant d'agir", async () => {
    await definirActifTous(false);
    expect(faux.reauths).toEqual(["/admin/membres"]);
  });

  it("épargne le compte du portail et l'acteur, mais désactive les autres administrateurs", async () => {
    const message = await definirActifTous(false);
    expect(message).toBe("3 comptes désactivés.");
    expect(faux.misAJour).toEqual([{ ids: ["u-admin2", "u-instru", "u-m1"], actif: false }]);
    // Le tri est fait en base, pas à l'affichage : le filtre part bien à Prisma
    expect(faux.filtres[0]).toEqual({ service: false, id: { not: "u-admin" }, actif: true });
    expect(actifs()).toEqual(["portail", "u-admin"]);
  });

  /**
   * **La confirmation doit nommer les deux comptes épargnés, pas un seul**. Elle disait « Seul le
   * compte de connexion du portail reste actif » alors que l'action épargne **aussi celui de
   * l'acteur** (`id: { not: acteur.id }`, vérifié juste au-dessus). Le bureau lisait donc, juste
   * avant de couper l'accès de tout le club, qu'il allait se couper le sien — et le seul moyen de
   * savoir que c'était faux était d'oser. Une confirmation annonce **ce qui sera écrit**, ni plus
   * ni moins : c'est la même règle que les réponses nommées une par une avant une suppression en
   * masse.
   */
  it("l'écran annonce les deux comptes qu'il épargne", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/admin/membres/page.tsx"), "utf8");
    // Les confirmations du volet « Pour tout le monde » sont rangées par geste (`confirmations=`) :
    // celle de la désactivation est l'entrée `desactiver`.
    const bloc = page.slice(page.indexOf("confirmations={{"));
    // La phrase est un gabarit (`${aDesactiver > 1 …}`) : on la découpe sur ses accents graves, pas
    // sur le premier `>`, qui tombe au milieu d'une interpolation.
    const debut = bloc.indexOf("desactiver: `");
    const phrase = bloc.slice(debut, bloc.indexOf("`,", debut));
    expect(phrase).toContain("administrateurs compris");
    expect(phrase).toMatch(/[Ll]e vôtre/);
    expect(phrase).toContain("portail");
    // Et surtout : plus de « seul le portail », qui excluait l'acteur de la liste des épargnés.
    expect(phrase).not.toMatch(/[Ss]eul le compte/);
  });

  it("coupe les sessions en cours de chaque compte désactivé, et d'eux seuls", async () => {
    await definirActifTous(false);
    expect(faux.sessionsRevoquees).toEqual(["u-admin2", "u-instru", "u-m1"]);
    expect(faux.sessionsRevoquees).not.toContain("portail");
    expect(faux.sessionsRevoquees).not.toContain("u-admin");
    expect(faux.sessionsRevoquees).not.toContain("u-m2"); // déjà désactivé : rien à couper
  });

  it("journalise une seule entrée d'audit, avec le décompte et les identifiants", async () => {
    await definirActifTous(false);
    expect(faux.audits).toHaveLength(1);
    expect(faux.audits[0]).toEqual({
      action: "membres.desactives_en_masse",
      cible: null,
      details: { nombre: 3, identifiants: ["u-admin2", "u-instru", "u-m1"] },
    });
  });

  it("accorde le singulier quand un seul compte est concerné", async () => {
    faux.comptes = [compte("portail", "ADMIN", { service: true }), compte("u-admin", "ADMIN"), compte("u-m1", "MEMBRE")];
    expect(await definirActifTous(false)).toBe("1 compte désactivé.");
  });

  it("ne fait rien, et ne journalise rien, quand il n'y a personne à désactiver", async () => {
    faux.comptes = [compte("portail", "ADMIN", { service: true }), compte("u-admin", "ADMIN")];
    expect(await definirActifTous(false)).toBe("aucun compte à désactiver");
    expect(faux.misAJour).toEqual([]);
    expect(faux.sessionsRevoquees).toEqual([]);
    expect(faux.audits).toEqual([]);
  });
});

describe("réactivation de tous les comptes", () => {
  it("ne remet en route que les comptes désactivés, sans toucher aux actifs", async () => {
    await definirActifTous(false);
    faux.misAJour = [];
    faux.audits = [];
    faux.sessionsRevoquees = [];
    const message = await definirActifTous(true);
    expect(message).toBe("4 comptes réactivés.");
    // u-m2 était déjà désactivé avant l'opération de masse : il revient lui aussi
    expect(faux.misAJour).toEqual([{ ids: ["u-admin2", "u-instru", "u-m1", "u-m2"], actif: true }]);
    expect(actifs()).toEqual(["portail", "u-admin", "u-admin2", "u-instru", "u-m1", "u-m2"]);
    // Réactiver ne coupe évidemment aucune session
    expect(faux.sessionsRevoquees).toEqual([]);
    expect(faux.audits).toEqual([
      { action: "membres.reactives_en_masse", cible: null, details: { nombre: 4, identifiants: ["u-admin2", "u-instru", "u-m1", "u-m2"] } },
    ]);
  });

  it("annonce qu'il n'y a rien à faire quand tout le monde est déjà actif", async () => {
    faux.comptes = [compte("portail", "ADMIN", { service: true }), compte("u-admin", "ADMIN"), compte("u-m1", "MEMBRE")];
    expect(await definirActifTous(true)).toBe("aucun compte à réactiver");
    expect(faux.audits).toEqual([]);
  });
});

describe("lien personnel envoyé depuis la liste des membres", () => {
  it("ne s'affiche que s'il existe une période active", async () => {
    expect(periodeDuLien([])).toBeNull();
    expect(periodeDuLien([{ id: "p1", nom: "T1 2027", statut: "BROUILLON" }])).toBeNull();
    expect(
      periodeDuLien([
        { id: "p2", nom: "T4 2026", statut: "ACTIVE" },
        { id: "p1", nom: "T1 2027", statut: "BROUILLON" },
      ]),
    ).toEqual({ id: "p2", nom: "T4 2026" });
  });

  it("part pour un membre actif et journalise l'envoi", async () => {
    await envoyerLienMembre("u-m1", "p-active");
    expect(faux.envois).toEqual([{ userId: "u-m1", periodId: "p-active" }]);
    // La trace dit aussi que les autres appareils sont tombés : régénérer, c'est déconnecter
    expect(faux.audits).toEqual([{ action: "invitation.renvoyee", cible: "p-active", details: { userId: "u-m1", appareilsDeconnectes: true } }]);
  });

  /**
   * **Renvoyer le lien de quelqu'un d'autre est passé au bureau**.
   *
   * Ce n'était pas la régénération en elle-même qui posait problème, mais son voisinage : qui peut
   * changer l'adresse email d'une personne **et** lui renvoyer son lien reçoit ce lien chez lui, et
   * entre sous son identité. Chacun peut toujours se renvoyer **le sien** depuis « Mon profil ».
   */
  it("n'est plus accessible aux instructeurs : le lien d'autrui appartient au bureau", async () => {
    faux.acteur = { ...INSTRUCTEUR };
    await expect(envoyerLienMembre("u-m1", "p-active")).rejects.toThrow("Accès refusé");
    expect(faux.envois).toEqual([]);
  });

  it("ne part jamais pour le compte de connexion du portail", async () => {
    await expect(envoyerLienMembre("portail", "p-active")).rejects.toThrow("ne peut pas être invité");
    expect(faux.envois).toEqual([]);
  });

  it("ne part pas pour un compte désactivé : le lien serait mort-né", async () => {
    await expect(envoyerLienMembre("u-m2", "p-active")).rejects.toThrow("Ce compte est désactivé");
    expect(faux.envois).toEqual([]);
  });

  it("ne part pas sur une période close", async () => {
    faux.periode = { id: "p-close", nom: "T3 2026", statut: "CLOSE" };
    await expect(envoyerLienMembre("u-m1", "p-close")).rejects.toThrow("Période close");
    expect(faux.envois).toEqual([]);
  });
});

describe("frontière administrateur / instructeur sur les comptes", () => {
  const instructeur: UserLike = { role: "INSTRUCTEUR", actif: true };
  const admin: UserLike = { role: "ADMIN", actif: true };

  it("réserve au bureau tout ce qui touche aux comptes et aux liens (ce qui commande l'affichage des boutons)", () => {
    for (const permission of ["members.view", "members.activate", "members.create", "members.delete", "members.manage", "invitations.manage"] as const) {
      expect(can(admin, permission)).toBe(true);
      expect(can(instructeur, permission)).toBe(false);
    }
    // Ce qui reste à l'encadrement : le travail dans le trimestre, et rien du registre des comptes
    expect(can(instructeur, "sessions.manage")).toBe(true);
    expect(can(instructeur, "planning.edit")).toBe(true);
    // Le trimestre lui-même, lui, appartient au bureau
    expect(can(instructeur, "periods.manage")).toBe(false);
  });

  it("refuse à un instructeur de désactiver un compte à l'unité", async () => {
    faux.acteur = { ...INSTRUCTEUR };
    await expect(definirActif("u-m1", false)).rejects.toThrow("Accès refusé");
    expect(faux.audits).toEqual([]);
    expect(actifs()).toContain("u-m1");
  });

  it("laisse un administrateur désactiver un compte à l'unité", async () => {
    await definirActif("u-m1", false);
    expect(faux.sessionsRevoquees).toEqual(["u-m1"]);
    expect(faux.audits).toEqual([{ action: "membre.desactive", cible: "u-m1", details: undefined }]);
  });

  it("refuse à un instructeur la création d'un compte et l'import CSV", async () => {
    faux.acteur = { ...INSTRUCTEUR };
    const fd = new FormData();
    fd.set("prenom", "Bravo");
    fd.set("nom", "02");
    fd.set("email", "bravo@club.test");
    fd.set("role", "MEMBRE");
    await expect(creerMembre({}, fd)).rejects.toThrow("Accès refusé");
    const csv = new FormData();
    csv.set("texte", "Bravo;02;bravo@club.test;MEMBRE");
    await expect(importerMembres({}, csv)).rejects.toThrow("Accès refusé");
    expect(faux.crees).toEqual([]);
  });

  /**
   * Un administrateur ne **naît** plus : il se **nomme** parmi les personnes de l'annuaire.
   */
  it("refuse de créer un compte administrateur, au formulaire comme au copier-coller", async () => {
    const fd = new FormData();
    fd.set("prenom", "Bravo");
    fd.set("nom", "02");
    fd.set("email", "bravo@club.test");
    fd.set("role", "ADMIN");
    const res = await creerMembre({}, fd);
    expect(res.erreur).toContain("se nomme parmi les personnes de l'annuaire");
    expect(faux.crees).toEqual([]);

    const csv = new FormData();
    csv.set("texte", "Bravo;02;bravo@club.test;ADMIN\nJeanne;Roy;jeanne@club.test;MEMBRE");
    const bilan = await importerMembres({}, csv);
    expect((faux.crees as Array<{ email: string }>).map((c) => c.email)).toEqual(["jeanne@club.test"]);
    expect(bilan.succes).toContain("1");
    expect(JSON.stringify(bilan)).toContain("Comptes admin");
  });

  it("refuse à un instructeur la suppression définitive d'un membre", async () => {
    faux.acteur = { ...INSTRUCTEUR };
    await expect(supprimerMembre("u-m1")).rejects.toThrow("Accès refusé");
    expect(faux.supprimes).toEqual([]);
  });

  it("laisse un administrateur supprimer définitivement un membre", async () => {
    await expect(supprimerMembre("u-m1")).rejects.toThrow("REDIRECTION:/admin/membres");
    expect(faux.supprimes).toEqual(["u-m1"]);
  });
});
