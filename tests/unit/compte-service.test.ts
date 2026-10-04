import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, estCompteDeService, personnesDuClub, peutEtreInvite } from "@/lib/permissions";
import { ERREUR_COMPTE_SERVICE } from "@/lib/invitations";

/*
 * **Les comptes du bureau portent un rôle de base et `estAdmin`** : c'est la forme que la base a
 * vraiment depuis la migration `role_de_base_et_admin_en_supplement`. Écrits `role: "ADMIN"`, ces
 * objets ne prouvaient plus rien de ce que le fichier affirme — ils ne passaient que par le repli
 * de compatibilité de `can()`, qui existe pour une base non migrée, pas pour un test.
 */
const portail = { id: "p", prenom: "Bureau", nom: "HEMA", role: "MEMBRE", estAdmin: true, actif: true, service: true };
const admin = { id: "a", prenom: "Delta", nom: "L.", role: "MEMBRE", estAdmin: true, actif: true, service: false };
const membre = { id: "m", prenom: "Chloé", nom: "D.", role: "MEMBRE", estAdmin: false, actif: true, service: false };

describe("compte de connexion du portail", () => {
  it("se reconnaît au champ service (et pas au rôle)", () => {
    expect(estCompteDeService(portail)).toBe(true);
    expect(estCompteDeService(admin)).toBe(false);
    expect(estCompteDeService({})).toBe(false);
    expect(estCompteDeService(undefined)).toBe(false);
    expect(estCompteDeService(null)).toBe(false);
  });

  it("ne peut être ni invité à une période ni destinataire d'un lien personnel", () => {
    expect(peutEtreInvite(portail)).toBe(false);
    expect(peutEtreInvite(admin)).toBe(true);
    expect(peutEtreInvite(membre)).toBe(true);
    expect(ERREUR_COMPTE_SERVICE).toContain("portail");
  });

  it("disparaît des listes nominatives, sans toucher aux autres", () => {
    expect(personnesDuClub([portail, admin, membre])).toEqual([admin, membre]);
    expect(personnesDuClub([portail])).toEqual([]);
    expect(personnesDuClub([])).toEqual([]);
  });

  it("garde tous ses droits d'administration (alertes de sécurité, audit, sessions)", () => {
    expect(can(portail, "admins.manage")).toBe(true);
    expect(can(portail, "audit.view")).toBe(true);
    expect(can(portail, "auth_sessions.revoke")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Garde-fous des server actions : on simule la base et l'acteur admin. */
/* ------------------------------------------------------------------ */

const faux = vi.hoisted(() => ({
  /** L'acteur de l'action. Réglable depuis un test : c'est ainsi qu'on joue « Mon profil ». */
  acteur: { id: "a", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true } as Record<string, unknown>,
  cible: null as Record<string, unknown> | null,
  misAJour: [] as unknown[],
  supprimes: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUniqueOrThrow: vi.fn(async () => faux.cible),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async (args: unknown) => {
        faux.misAJour.push(args);
        return faux.cible;
      }),
      delete: vi.fn(async (args: unknown) => {
        faux.supprimes.push(args);
        return faux.cible;
      }),
    },
    // Corriger une adresse **renseignée** révoque les liens de l'ancienne et en renvoie un neuf
    // (voir `revoquerLiensApresChangementEmail`) : le compte du portail n'a ni lien ni trimestre,
    // mais le chemin est le même, et la base simulée doit savoir répondre.
    invitation: { updateMany: vi.fn(async () => ({ count: 0 })) },
    periodMember: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0) }));
vi.mock("@/lib/auth/current-user", () => ({
  assertPermission: vi.fn(async () => faux.acteur),
  exigerReauth: vi.fn(async () => {}),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { definirActif, modifierMembre, supprimerMembre } = await import("@/actions/membres");

const ERREUR_ATTENDUE = "Le compte de connexion du portail ne peut pas être désactivé ni supprimé.";

function formulaire(role: string, email = "contact@club.test") {
  const fd = new FormData();
  fd.set("prenom", "Bureau");
  fd.set("nom", "HEMA");
  fd.set("email", email);
  fd.set("role", role);
  return fd;
}

const comptePortail = { id: "p", prenom: "Bureau", nom: "HEMA", email: "contact@club.test", role: "MEMBRE", estAdmin: true, actif: true, service: true };
const compteMembre = { id: "m", prenom: "Chloé", nom: "D.", email: "chloe@exemple.fr", role: "MEMBRE", estAdmin: false, actif: true, service: false };

describe("garde-fous serveur sur le compte du portail", () => {
  beforeEach(() => {
    faux.cible = null;
    faux.misAJour = [];
    faux.supprimes = [];
  });

  it("refuse de désactiver le compte du portail", async () => {
    faux.cible = comptePortail;
    await expect(definirActif("p", false)).rejects.toThrow(ERREUR_ATTENDUE);
    expect(faux.misAJour).toEqual([]);
  });

  it("refuse aussi de le réactiver : on n'y touche pas du tout", async () => {
    faux.cible = comptePortail;
    await expect(definirActif("p", true)).rejects.toThrow(ERREUR_ATTENDUE);
    expect(faux.misAJour).toEqual([]);
  });

  it("refuse de supprimer le compte du portail", async () => {
    faux.cible = comptePortail;
    await expect(supprimerMembre("p")).rejects.toThrow(ERREUR_ATTENDUE);
    expect(faux.supprimes).toEqual([]);
  });

  /**
   * **Son rôle ne se règle pas depuis l'annuaire, et son bureau ne s'y retire pas non plus.**
   *
   * Deux refus distincts depuis que le bureau est un supplément : celui-ci porte sur le **rôle de
   * base** (« membre ou instructeur » ne veut rien dire pour un compte qui n'est pas une personne
   * du club), et le retrait de son `estAdmin` est refusé là où il pourrait se tenter —
   * `retirerDroitsAdmin`, éprouvé par `tests/unit/retirer-droits-admin.test.ts`. La garde comparait
   * le rôle demandé à « ADMIN » : elle ne pouvait plus être satisfaite et refusait **tout**
   * enregistrement de cette fiche, le nom et l'adresse compris (voir le test suivant).
   */
  it("refuse de changer son rôle de base", async () => {
    faux.cible = comptePortail;
    const res = await modifierMembre("p", {}, formulaire("INSTRUCTEUR"));
    expect(res.erreur).toBe("Le compte de connexion du portail n'est pas une personne du club : son rôle ne se règle pas ici.");
    expect(res.erreurs?.role).toBeTruthy();
    // « Administrateur » n'est pas davantage un rôle qu'on lui attribue : il l'est par `estAdmin`.
    const admin = await modifierMembre("p", {}, formulaire("ADMIN"));
    expect(admin.erreur).toBeTruthy();
    expect(faux.misAJour).toEqual([]);
  });

  /**
   * **Son identité ne se corrige que par lui-même**.
   *
   * Pourquoi ce compte-là et pas un autre : son adresse est celle par laquelle le club reçoit les
   * **alertes de sécurité** — `src/lib/alertes.ts` le sélectionne exprès, sans l'exclure comme le font
   * les envois ordinaires — et c'est **sa seule porte**, puisqu'il n'a pas de lien personnel. Un autre
   * administrateur qui la réécrit déplace donc la porte du compte le plus fort de l'installation, et
   * les alertes avec elle. Le reste de la fiche d'un compte ordinaire, lui, reste modifiable par le
   * bureau : le refus ne porte que sur ce compte-ci.
   */
  it("refuse qu'un AUTRE administrateur corrige son identité", async () => {
    faux.cible = comptePortail;
    const res = await modifierMembre("p", {}, formulaire("MEMBRE", "bureau@club.test"));
    expect(res.erreur).toContain("depuis son propre profil");
    expect(faux.misAJour).toEqual([]);
  });

  it("mais le laisse corriger la sienne, et son rôle reste celui qu'il a", async () => {
    faux.cible = comptePortail;
    // L'acteur **est** le compte du portail : c'est le cas de « Mon profil ».
    const avant = faux.acteur;
    faux.acteur = comptePortail;
    const res = await modifierMembre("p", {}, formulaire("MEMBRE", "bureau@club.test"));
    faux.acteur = avant;
    expect(res.succes).toBeTruthy();
    expect(faux.misAJour).toHaveLength(1);
  });

  it("ne change rien pour les comptes ordinaires (toujours désactivables et supprimables)", async () => {
    faux.cible = compteMembre;
    await definirActif("m", false);
    expect(faux.misAJour).toHaveLength(1);
    await expect(supprimerMembre("m")).rejects.toThrow("REDIRECTION:/admin/membres");
    expect(faux.supprimes).toHaveLength(1);
  });
});
