import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERREUR_COMPTE_SERVICE } from "@/lib/invitations";

/**
 * **Personne ne remet à zéro l'accès du compte permanent, sauf lui**.
 *
 * Les deux portes qui remettent un accès à neuf sont `reinitialiserAccesMembre` (mot de passe,
 * second facteur, codes de secours, liens) et `reinitialiserDeuxFaCompte` (le second facteur seul,
 * depuis l'onglet « Comptes admin »). Toutes deux refusaient déjà le compte de service — mais **rien
 * ne gardait ce refus** : `reinitialiserDeuxFaCompte` n'avait aucun test, et l'écran rendait quand
 * même son bouton sur la ligne du compte permanent.
 *
 * **Pourquoi c'est ce compte-là qui mérite un fichier.** Il est le seul à pouvoir rouvrir
 * l'administration quand plus personne n'y entre, il porte l'adresse des alertes de sécurité, et il
 * n'a pas de lien personnel : lui effacer ses facteurs le ferme dehors, les lui remplacer serait
 * prendre sa place. Sa voie de secours est sa propre boîte email, puis le redéploiement.
 */

const faux = vi.hoisted(() => ({
  acteur: { id: "a", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true } as Record<string, unknown>,
  cible: null as Record<string, unknown> | null,
  misAJour: [] as unknown[],
  totpDesactives: [] as string[],
  sessionsRevoquees: [] as string[],
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
    invitation: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    periodMember: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/deux-fa", () => ({ desactiverTotp: vi.fn(async (id: string) => void faux.totpDesactives.push(id)) }));
vi.mock("@/lib/auth/session", () => ({
  revokeAllSessions: vi.fn(async (id: string) => {
    faux.sessionsRevoquees.push(id);
    return 0;
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({
  assertPermission: vi.fn(async () => faux.acteur),
  exigerReauth: vi.fn(async () => {}),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { reinitialiserDeuxFaCompte } = await import("@/actions/admin");
const { reinitialiserAccesMembre } = await import("@/actions/membres");

/** Le compte du déploiement : administrateur à demeure, et `service: true` est ce qui le dit. */
const permanent = {
  id: "p",
  prenom: "Bureau",
  nom: "HEMA",
  email: "contact@club.test",
  role: "MEMBRE",
  estAdmin: true,
  actif: true,
  service: true,
  passwordHash: "argon2…",
  totpSecret: "s",
  totpActiveAt: new Date("2026-09-01T10:00:00Z"),
};
/** Un administrateur ordinaire : les deux gestes doivent continuer de marcher sur lui. */
const adminOrdinaire = { ...permanent, id: "b", prenom: "Camille", email: "camille@club.test", service: false };

describe("le compte permanent garde ses facteurs", () => {
  beforeEach(() => {
    faux.cible = null;
    faux.misAJour = [];
    faux.totpDesactives = [];
    faux.sessionsRevoquees = [];
  });

  it("refuse de réinitialiser sa double authentification depuis « Comptes admin »", async () => {
    faux.cible = permanent;
    await expect(reinitialiserDeuxFaCompte("p")).rejects.toThrow(/ne se réinitialise que par lui-même/);
    expect(faux.totpDesactives).toEqual([]);
    expect(faux.sessionsRevoquees).toEqual([]);
  });

  it("refuse de remettre son accès à zéro depuis sa fiche", async () => {
    faux.cible = permanent;
    await expect(reinitialiserAccesMembre("p")).rejects.toThrow(/ne se remet pas à zéro depuis un autre compte/);
    expect(faux.misAJour).toEqual([]);
  });

  it("et ce refus nomme le geste refusé, pas la règle des invitations", async () => {
    /*
     * Le refus renvoyait `ERREUR_COMPTE_SERVICE` — « ne peut pas être invité à une période » —, qui
     * ne décrit pas du tout le bouton sur lequel on vient d'appuyer. Un refus qui nomme la mauvaise
     * règle envoie chercher la solution au mauvais endroit, et finit par passer pour un bug qu'on
     * « corrige ».
     */
    faux.cible = permanent;
    const erreur = await reinitialiserAccesMembre("p").catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(erreur).not.toBe(ERREUR_COMPTE_SERVICE);
    expect(erreur).not.toContain("invité");
  });

  it("mais un administrateur ordinaire se réinitialise toujours, lui", async () => {
    faux.cible = adminOrdinaire;
    await reinitialiserDeuxFaCompte("b");
    expect(faux.totpDesactives).toEqual(["b"]);
    expect(faux.sessionsRevoquees).toEqual(["b"]);
  });

  it("et un compte qui n'est pas du bureau n'entre pas par cette porte", async () => {
    // La garde lit `estAdmin`, plus jamais `role === "ADMIN"`.
    faux.cible = { ...adminOrdinaire, estAdmin: false };
    await expect(reinitialiserDeuxFaCompte("b")).rejects.toThrow(/n'est pas administrateur/);
    expect(faux.totpDesactives).toEqual([]);
  });
});

describe("l'écran ne montre pas un bouton qui ne peut que refuser", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/admin/comptes/page.tsx"), "utf8");
  /** Le code sans ses commentaires : un commentaire a le droit de **citer** ce qu'on interdit. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("la cellule « 2FA » distingue le compte permanent avant de rendre « Réinitialiser »", () => {
    // Le bouton existait sur toutes les lignes : le serveur refusait, l'écran promettait.
    const cellule = code.slice(code.indexOf('label="2FA"'), code.indexOf('label="Dernière activité"'));
    expect(cellule).toContain("a.service");
    expect(cellule.indexOf("a.service")).toBeLessThan(cellule.indexOf("reinitialiserDeuxFaCompte"));
  });

  it("et dit à sa place qui peut le faire", () => {
    expect(code).toContain("lui seul la réinitialise");
  });
});
