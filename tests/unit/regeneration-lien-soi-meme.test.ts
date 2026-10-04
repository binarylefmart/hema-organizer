import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Régénérer un lien ne doit jamais mettre dehors la personne qui clique.**
 *
 * Les deux boutons « Renvoyer le lien » de la gestion (fiche/liste des membres et ligne d'une
 * période) coupent, à dessein, toutes les sessions ouvertes avec l'ancien lien : c'est le geste
 * que l'on fait quand un lien a pu fuiter, et le vider de cet effet le rendrait décoratif.
 *
 * Sauf dans un cas, très courant : **la cible est la personne connectée**. Un administrateur qui
 * régénère son propre lien est devant son écran ; le déconnecter dans la foulée ressemble à une
 * panne et l'oblige à rouvrir un email pour rentrer. On coupe alors ses **autres** appareils —
 * exactement ce que fait déjà « Renvoyer mon lien » depuis le profil (`renvoyerMonLien`).
 *
 * Ce fichier verrouille les deux branches, des deux côtés (membres et périodes) : c'est une
 * différence d'un seul mot dans les options, qu'une relecture ne rattrape pas deux fois.
 */

const faux = vi.hoisted(() => ({
  /**
   * Personne connectée qui déclenche l'action (le bureau : `invitations.manage`).
   *
   * `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
   * `invitations.manage` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que
   * par `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
   */
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true },
  comptes: [] as Record<string, unknown>[],
  periode: { id: "p-active", nom: "T4 2026", statut: "ACTIVE" } as { id: string; nom: string; statut: string },
  envois: [] as { userId: string; periodId: string; deconnecterAppareils?: "tous" | "autres" }[],
  audits: [] as { action: string; cible: string | null; details: unknown }[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const u = faux.comptes.find((c) => c.id === where.id);
        if (!u) throw new Error("Compte introuvable");
        return u;
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

// Seule la décision compte ici : on relève les options passées, sans rejouer la création du lien.
vi.mock("@/lib/invitations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invitations")>()),
  envoyerInvitation: vi.fn(async (userId: string, periodId: string, _motif?: string, options?: { deconnecterAppareils?: "tous" | "autres" }) => {
    faux.envois.push({ userId, periodId, deconnecterAppareils: options?.deconnecterAppareils });
    return true;
  }),
  revokeInvitation: vi.fn(async () => {}),
}));

// La matrice réelle des permissions décide : l'acteur simulé change simplement de rôle.
vi.mock("@/lib/auth/current-user", async () => {
  const { can: vraiCan } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof vraiCan>[1]) => {
      if (!vraiCan(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async () => {}),
    getCurrentUser: vi.fn(async () => faux.acteur),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { envoyerLienMembre } = await import("@/actions/membres");
const { renvoyerInvitation } = await import("@/actions/periodes");

/* `estAdmin` à part du rôle de base : « ADMIN » n'est plus une valeur de `role`. */
const compte = (id: string, role = "MEMBRE", estAdmin = false) => ({ id, prenom: id, nom: "Test", email: `${id}@club.test`, role, estAdmin, actif: true, service: false });

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  // « u-admin » est un **instructeur du bureau** : c'est la cible dont `canEditUser` dit qu'elle ne
  // se touche qu'avec `admins.manage`, et la garde le lit sur `estAdmin` — jamais plus sur le rôle.
  faux.comptes = [compte("u-admin", "INSTRUCTEUR", true), compte("u-instru", "INSTRUCTEUR"), compte("u-m1")];
  faux.periode = { id: "p-active", nom: "T4 2026", statut: "ACTIVE" };
  faux.envois = [];
  faux.audits = [];
});

describe("« Renvoyer le lien » depuis la fiche d'un membre", () => {
  it("coupe tous les appareils de la personne visée quand ce n'est pas soi", async () => {
    await envoyerLienMembre("u-m1", "p-active");
    expect(faux.envois).toEqual([{ userId: "u-m1", periodId: "p-active", deconnecterAppareils: "tous" }]);
  });

  /** Le cas courant : l'administrateur clique sur sa **propre** fiche. Il ne doit pas s'éjecter. */
  it("épargne la session en cours quand l'administrateur régénère son propre lien", async () => {
    await envoyerLienMembre("u-admin", "p-active");
    expect(faux.envois).toEqual([{ userId: "u-admin", periodId: "p-active", deconnecterAppareils: "autres" }]);
  });

  /** Ce n'est plus l'identité de l'acteur qui décide ici : un instructeur n'a plus la main du tout. */
  it("refuse à un instructeur de régénérer le lien de quelqu'un d'autre", async () => {
    faux.acteur = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    await expect(envoyerLienMembre("u-admin", "p-active")).rejects.toThrow("Accès refusé");
    expect(faux.envois).toEqual([]);
  });
});

describe("« Renvoyer le lien » depuis la liste d'une période", () => {
  it("coupe tous les appareils de la personne visée quand ce n'est pas soi", async () => {
    await renvoyerInvitation("p-active", "u-m1");
    expect(faux.envois).toEqual([{ userId: "u-m1", periodId: "p-active", deconnecterAppareils: "tous" }]);
    expect(faux.audits).toEqual([{ action: "invitation.renvoyee", cible: "p-active", details: { userId: "u-m1" } }]);
  });

  it("épargne la session en cours quand l'administrateur régénère son propre lien", async () => {
    await renvoyerInvitation("p-active", "u-admin");
    expect(faux.envois).toEqual([{ userId: "u-admin", periodId: "p-active", deconnecterAppareils: "autres" }]);
  });

  it("garde « tous » quand un administrateur régénère le lien d'un autre membre du bureau", async () => {
    faux.acteur = { id: "u-admin2", email: "foxtrot@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
    await renvoyerInvitation("p-active", "u-admin");
    expect(faux.envois[0]?.deconnecterAppareils).toBe("tous");
  });

  it("refuse à un instructeur de régénérer le lien de quelqu'un d'autre", async () => {
    faux.acteur = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    await expect(renvoyerInvitation("p-active", "u-m1")).rejects.toThrow("Accès refusé");
    expect(faux.envois).toEqual([]);
  });
});

/**
 * **Les deux boutons refusent les mêmes envois.**
 *
 * C'est le même geste depuis deux écrans, il ne peut pas obéir à deux jeux de règles. Et l'envoi
 * n'est pas anodin : la création du lien **inscrit la personne sur la période** au passage. Un
 * envoi qui n'aurait pas dû partir n'expédie donc pas seulement un lien mort — il ajoute quelqu'un
 * au trimestre, sans que personne ne l'ait décidé.
 */
describe("ce qu'aucun des deux boutons n'envoie", () => {
  /** Les deux portes d'entrée, appelées avec le même couple (personne, période). */
  const boutons: [string, (userId: string, periodId: string) => Promise<void>][] = [
    ["fiche du membre", (userId, periodId) => envoyerLienMembre(userId, periodId)],
    ["liste de la période", (userId, periodId) => renvoyerInvitation(periodId, userId)],
  ];

  for (const [ou, envoyer] of boutons) {
    describe(ou, () => {
      it("rien à un compte désactivé : son lien serait mort à l'ouverture", async () => {
        faux.comptes.push({ ...compte("u-parti"), actif: false });
        await expect(envoyer("u-parti", "p-active")).rejects.toThrow(/désactivé/);
        expect(faux.envois).toEqual([]);
        expect(faux.audits).toEqual([]);
      });

      it("rien à quelqu'un dont le club n'a pas l'adresse", async () => {
        faux.comptes.push({ ...compte("u-sans-mail"), email: null });
        await expect(envoyer("u-sans-mail", "p-active")).rejects.toThrow();
        expect(faux.envois).toEqual([]);
        expect(faux.audits).toEqual([]);
      });

      it("rien sur une période close : les liens n'y valent plus rien", async () => {
        faux.periode = { id: "p-close", nom: "T2 2026", statut: "CLOSE" };
        await expect(envoyer("u-m1", "p-close")).rejects.toThrow(/close/i);
        expect(faux.envois).toEqual([]);
        expect(faux.audits).toEqual([]);
      });

      it("rien au compte de connexion du portail, qui n'est pas une personne du club", async () => {
        faux.comptes.push({ ...compte("u-portail"), service: true });
        await expect(envoyer("u-portail", "p-active")).rejects.toThrow();
        expect(faux.envois).toEqual([]);
        expect(faux.audits).toEqual([]);
      });
    });
  }
});
