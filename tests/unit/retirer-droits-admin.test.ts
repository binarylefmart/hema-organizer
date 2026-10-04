import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Retirer les droits d'administrateur**, depuis la liste des comptes admin. Le compte n'est pas
 * supprimé et **la personne garde son rôle de base** : le bureau est un supplément (`estAdmin`), on
 * ne « redescend » plus personne.
 *
 * La cible du scénario principal est donc un **instructeur du bureau** — le cas que ce changement
 * rend possible, et celui qui attrape le défaut : le geste écrivait `role = "MEMBRE"`, ce qui lui
 * aurait retiré l'instruction au passage, sans que personne l'ait demandé ni le voie.
 *
 * Ce fichier tient les trois refus qui empêchent de se fermer la porte au nez — soi-même, le
 * compte du portail, un compte qui n'est pas administrateur — et vérifie que les sessions de la
 * personne perdent leur élévation dans la foulée.
 */
const faux = vi.hoisted(() => ({
  cible: null as Record<string, unknown> | null,
  misAJour: [] as unknown[],
  sessions: [] as unknown[],
  reauth: [] as unknown[],
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
    },
    authSession: {
      updateMany: vi.fn(async (args: unknown) => {
        faux.sessions.push(args);
        return { count: 1 };
      }),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0) }));
vi.mock("@/lib/auth/current-user", () => ({
  assertPermission: vi.fn(async () => ({ id: "a", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true })),
  exigerReauth: vi.fn(async (...args: unknown[]) => {
    faux.reauth.push(args);
  }),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { retirerDroitsAdmin } = await import("@/actions/membres");

const portail = { id: "p", prenom: "Bureau", nom: "HEMA", email: "contact@club.test", role: "MEMBRE", estAdmin: true, actif: true, service: true };
const soi = { id: "a", prenom: "Delta", nom: "L.", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true, service: false };
/** Un **instructeur** du bureau : c'est son rôle de base qui doit survivre au retrait. */
const autre = { id: "n", prenom: "Foxtrot", nom: "M.", email: "foxtrot@exemple.fr", role: "INSTRUCTEUR", estAdmin: true, actif: true, service: false };
const membre = { id: "m", prenom: "Chloé", nom: "D.", email: "chloe@exemple.fr", role: "MEMBRE", estAdmin: false, actif: true, service: false };

describe("retirer les droits d'administrateur", () => {
  beforeEach(() => {
    faux.cible = null;
    faux.misAJour = [];
    faux.sessions = [];
    faux.reauth = [];
  });

  it("retire le bureau et laisse le rôle de base intact, sans supprimer le compte", async () => {
    faux.cible = autre;
    await retirerDroitsAdmin("n");
    expect(faux.misAJour).toEqual([{ where: { id: "n" }, data: { estAdmin: false } }]);
    // **Le rôle n'est pas touché**, et c'est tout l'objet du changement : l'instructeur du bureau
    // reste instructeur. Un `role` dans cette écriture serait une rétrogradation silencieuse.
    expect(JSON.stringify(faux.misAJour)).not.toContain("role");
    // …et ses sessions perdent l'élévation : plus d'espace admin, même sur un onglet resté ouvert
    expect(faux.sessions).toEqual([{ where: { userId: "n" }, data: { forte: false, elevationVueLe: null } }]);
    // Geste sensible : le code à usage unique est redemandé s'il date
    expect(faux.reauth).toHaveLength(1);
  });

  it("refuse qu'on se retire ses propres droits", async () => {
    faux.cible = soi;
    await expect(retirerDroitsAdmin("a")).rejects.toThrow(/tes propres droits/i);
    expect(faux.misAJour).toEqual([]);
  });

  it("refuse de toucher au compte du portail", async () => {
    faux.cible = portail;
    await expect(retirerDroitsAdmin("p")).rejects.toThrow("Le compte de connexion du portail doit rester administrateur.");
    expect(faux.misAJour).toEqual([]);
  });

  it("refuse un compte qui n'est pas du bureau", async () => {
    faux.cible = membre;
    await expect(retirerDroitsAdmin("m")).rejects.toThrow(/pas administrateur/i);
    expect(faux.misAJour).toEqual([]);
  });
});

describe("le bouton de la liste des comptes admin", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/admin/comptes/page.tsx"), "utf8");

  it("est proposé sur chaque ligne, avec confirmation", () => {
    expect(page).toContain("retirerDroitsAdmin.bind(null, a.id)");
    expect(page).toContain("Retirer les droits d'administrateur de ${a.prenom} ${a.nom}");
    expect(page).toContain("confirmation={");
  });

  it("n'apparaît ni pour le compte du portail, ni pour soi-même", () => {
    expect(page).toContain("a.service ? (");
    expect(page).toContain("a.id === acteur.id ? (");
  });
});
