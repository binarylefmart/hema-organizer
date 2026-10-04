import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Effacer une proposition d'atelier sans y répondre**.
 *
 * Ce n'est pas un troisième verdict : la ligne disparaît, personne n'est prévenu, et la file n'en
 * garde rien. Trois choses à verrouiller, parce qu'elles se casseraient sans bruit :
 *  - **le bureau seul** : un instructeur décide (placer, refuser), il ne fait pas disparaître
 *    l'écrit de quelqu'un ;
 *  - **aucun email** — c'est toute la différence avec « Refuser », dont la raison d'être est d'être
 *    envoyé ;
 *  - **la case du planning est libérée d'abord**, et dans cet ordre : la base mettrait bien le lien
 *    à `null` toute seule (`onDelete: SetNull`), mais la case resterait affichée avec son titre et
 *    plus rien derrière.
 */

type FauxAtelier = { id: string; titre: string; statut: string; proposePar: { prenom: string; nom: string } };

const faux = vi.hoisted(() => ({
  /**
   * **L'acteur du bureau est un INSTRUCTEUR qui porte `estAdmin`** : « administrateur » n'est plus
   * une valeur de `role`. Ce rôle de base-là est choisi exprès — `ateliers.supprimer` n'est ouverte
   * à aucun instructeur, donc tout ce qui aboutit ici ne peut passer **que** par `estAdmin`. Décrit
   * `role: "ADMIN"`, le test passait par le repli de compatibilité de `can()` et une garde restée
   * écrite sur le rôle l'aurait laissé vert. Son miroir est deux pas plus bas : le même instructeur
   * **sans** le supplément se fait refuser.
   */
  acteur: { id: "u-admin", email: "bureau@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true },
  ateliers: [] as FauxAtelier[],
  supprimes: [] as string[],
  retires: [] as string[],
  audits: [] as { action: string; cible: string | null; details: unknown }[],
  emails: [] as unknown[],
  /** Ordre réel des écritures : c'est lui qui dit si la case a été libérée avant l'effacement. */
  gestes: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    atelier: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = faux.ateliers.find((x) => x.id === where.id);
        if (!a) throw new Error("introuvable");
        return a;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        faux.supprimes.push(where.id);
        faux.gestes.push(`supprime:${where.id}`);
        faux.ateliers = faux.ateliers.filter((x) => x.id !== where.id);
        return {};
      }),
      update: vi.fn(async () => ({})),
    },
    session: { findUnique: vi.fn(async () => null), findUniqueOrThrow: vi.fn(async () => ({ date: "2026-10-01", heureDebut: "19:00", lieu: "Villebourg" })) },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/planning", () => ({
  retirerAtelier: vi.fn(async (atelierId: string) => {
    faux.retires.push(atelierId);
    faux.gestes.push(`case-liberee:${atelierId}`);
  }),
  placerAtelier: vi.fn(async () => {}),
}));

vi.mock("@/lib/email/mailer", () => ({ enqueueEmail: vi.fn((m: unknown) => faux.emails.push(m)) }));
// Mock **partiel** : la décision passe par `src/lib/notifications/ateliers.ts`, qui entraîne toute
// la chaîne des canaux — laquelle a besoin des constantes réelles de ce module.
vi.mock("@/lib/notifications/preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/preferences")>()),
  destinataireRetenu: vi.fn(() => true),
  getPreferencesNotifications: vi.fn(async () => ({})),
}));
vi.mock("@/lib/notifications/journal", () => ({
  journaliser: vi.fn(async () => true),
  marquerEchec: vi.fn(async () => {}),
  notifierParPush: vi.fn(async () => {}),
  pushPossible: vi.fn(async () => false),
}));
vi.mock("@/lib/notifications/canaux", () => ({ envoiPossible: vi.fn(async () => false), canalOperationnel: vi.fn(async () => false) }));

// La matrice réelle des permissions décide : l'acteur simulé change simplement de rôle.
vi.mock("@/lib/auth/current-user", async () => {
  const { can: vraiCan } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof vraiCan>[1]) => {
      if (!vraiCan(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    getCurrentUser: vi.fn(async () => faux.acteur),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { effacerProposition } = await import("@/actions/ateliers");

const EN_ATTENTE: FauxAtelier = { id: "at-1", titre: "Échauffement à la corde", statut: "PROPOSE", proposePar: { prenom: "Golf", nom: "09" } };
const PLACE: FauxAtelier = { id: "at-2", titre: "Lutte au sol", statut: "PLANIFIE", proposePar: { prenom: "Bravo", nom: "02" } };

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "bureau@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  faux.ateliers = [{ ...EN_ATTENTE }, { ...PLACE }];
  faux.supprimes = [];
  faux.retires = [];
  faux.audits = [];
  faux.emails = [];
  faux.gestes = [];
});

describe("effacer une proposition sans y répondre", () => {
  it("le bureau efface, et personne n'est prévenu", async () => {
    await effacerProposition("at-1");
    expect(faux.supprimes).toEqual(["at-1"]);
    expect(faux.emails).toEqual([]);
  });

  it("le journal garde ce qui disparaît : le titre, l'auteur et le statut d'alors", async () => {
    await effacerProposition("at-1");
    expect(faux.audits).toHaveLength(1);
    expect(faux.audits[0]).toMatchObject({
      action: "atelier.efface_sans_reponse",
      cible: "at-1",
      details: { titre: "Échauffement à la corde", statut: "PROPOSE", proposePar: "Golf 09" },
    });
  });

  it("un atelier déjà placé libère sa case du planning, et dans cet ordre", async () => {
    await effacerProposition("at-2");
    expect(faux.retires).toEqual(["at-2"]);
    expect(faux.gestes).toEqual(["case-liberee:at-2", "supprime:at-2"]);
  });

  it("une proposition en attente ne touche à aucune case", async () => {
    await effacerProposition("at-1");
    expect(faux.retires).toEqual([]);
  });

  // La contre-épreuve de l'acteur du bureau : **même rôle de base, sans le supplément**. C'est la
  // seule différence entre les deux comptes, donc c'est bien `estAdmin` qui ouvre l'effacement.
  it("un instructeur ne peut pas effacer : il décide, il ne fait pas disparaître", async () => {
    faux.acteur = { id: "u-instructeur", email: "charlie@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    await expect(effacerProposition("at-1")).rejects.toThrow("Accès refusé");
    expect(faux.supprimes).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("un membre non plus, pas même sur la proposition d'un autre", async () => {
    faux.acteur = { id: "u-membre", email: "bravo@club.test", role: "MEMBRE", estAdmin: false, actif: true };
    await expect(effacerProposition("at-1")).rejects.toThrow("Accès refusé");
    expect(faux.supprimes).toEqual([]);
  });
});
