import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Le cookie qui porte un lien personnel en clair est rattaché à son propriétaire.**
 *
 * Défaut, trouvé par relecture adverse. L'ouverture d'un lien posait `hema_lien_perso` = **le jeton
 * brut**, 15 minutes, `path=/bienvenue`, pour que l'écran de bienvenue offre « Copier mon lien »
 * (la base ne garde que le SHA-256 : c'est le seul instant où l'application connaît le lien en
 * clair). La lecture n'en vérifiait que la **forme**, jamais le propriétaire, et `destroySession`
 * ne l'effaçait pas.
 *
 * Le scénario : tablette partagée du club. Alice ouvre son lien, se déconnecte ; dans les quinze
 * minutes Bob se connecte et passe par `/bienvenue` → « Copier mon lien » lui donne **la clé
 * d'Alice**, valable quatre mois. Le cookie voisin, celui des codes de secours
 * (`lireAffichageCodes`, src/lib/auth/deux-fa.ts), faisait déjà exactement le contrôle qui manquait
 * ici : `if (p.uid !== userId) return null`.
 */

const SECRET = "secret-de-test-pour-le-lien-personnel";

/** Faux magasin de cookies : `next/headers` n'existe qu'en contexte de requête. */
const jar = vi.hoisted(() => {
  const valeurs = new Map<string, string>();
  return {
    valeurs,
    boite: {
      get: (nom: string) => (valeurs.has(nom) ? { name: nom, value: valeurs.get(nom)! } : undefined),
      set: (nom: string, valeur: string, options?: { maxAge?: number }) => {
        if (options?.maxAge === 0) valeurs.delete(nom);
        else valeurs.set(nom, valeur);
      },
    },
  };
});

vi.mock("next/headers", () => ({ cookies: async () => jar.boite }));
vi.mock("@/lib/env", () => ({
  env: () => ({ SESSION_SECRET: SECRET, DOMAIN: "organizer.test" }),
  baseUrl: () => "https://organizer.test",
  bequilleDev: () => undefined,
  bequilleDevActive: () => false,
}));

const { LIEN_PERSO_COOKIE, lienPersonnelDeLOuverture, oublierLienPersonnel, poserLienPersonnel } = await import("@/lib/lien-personnel");

/** Un jeton à la bonne forme : 32 octets en base64url, comme `generateToken` en produit. */
const JETON_ALICE = "a".repeat(43);
const JETON_BOB = "b".repeat(43);

beforeEach(() => jar.valeurs.clear());

describe("le lien personnel de passage n'est rendu qu'à son propriétaire", () => {
  it("rend le lien à qui vient de l'ouvrir", async () => {
    await poserLienPersonnel("u-alice", JETON_ALICE);
    expect(await lienPersonnelDeLOuverture("u-alice")).toBe(`https://organizer.test/invitation/${JETON_ALICE}`);
  });

  /** **Le défaut corrigé** : la tablette partagée du club. */
  it("ne rend rien à quelqu'un d'autre sur le même appareil", async () => {
    await poserLienPersonnel("u-alice", JETON_ALICE);
    // Bob se connecte dans les 15 minutes et passe par l'écran de bienvenue.
    expect(await lienPersonnelDeLOuverture("u-bob")).toBeNull();
    // Le cookie n'est toujours lisible que par Alice : rien n'a été consommé au passage.
    expect(await lienPersonnelDeLOuverture("u-alice")).not.toBeNull();
  });

  it("le jeton ne se lit pas dans le cookie, et ne se recopie pas ailleurs", async () => {
    await poserLienPersonnel("u-alice", JETON_ALICE);
    const brut = jar.valeurs.get(LIEN_PERSO_COOKIE)!;
    // Chiffré : le jeton n'apparaît pas en clair dans ce que porte le navigateur.
    expect(brut).not.toContain(JETON_ALICE);
    // Et signé : le contenu ne se rebricole pas à la main pour changer de destinataire.
    const [charge, signature] = brut.split(".");
    const falsifie = `${Buffer.from(JSON.stringify({ uid: "u-bob", exp: Date.now() + 60_000, jeton: "v1.x.y.z" })).toString("base64url")}.${signature}`;
    jar.valeurs.set(LIEN_PERSO_COOKIE, falsifie);
    expect(charge).toBeTruthy();
    expect(await lienPersonnelDeLOuverture("u-bob")).toBeNull();
  });

  it("un cookie périmé ne rend rien, même à son propriétaire", async () => {
    vi.useFakeTimers();
    try {
      await poserLienPersonnel("u-alice", JETON_ALICE);
      vi.advanceTimersByTime(16 * 60 * 1000); // le cookie vaut 15 min
      expect(await lienPersonnelDeLOuverture("u-alice")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("un dernier lien posé remplace le précédent, et l'oubli n'en laisse aucun", async () => {
    await poserLienPersonnel("u-alice", JETON_ALICE);
    await poserLienPersonnel("u-bob", JETON_BOB);
    expect(await lienPersonnelDeLOuverture("u-alice")).toBeNull();
    expect(await lienPersonnelDeLOuverture("u-bob")).toBe(`https://organizer.test/invitation/${JETON_BOB}`);
    await oublierLienPersonnel();
    expect(await lienPersonnelDeLOuverture("u-bob")).toBeNull();
  });
});

/**
 * Se déconnecter emporte la clé de passage : sur un appareil partagé, la laisser vivre ses quinze
 * minutes après un départ n'a aucun intérêt et tend une clé au suivant.
 */
describe("la déconnexion efface le cookie de passage", () => {
  const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

  it("`destroySession` appelle `oublierLienPersonnel`", () => {
    const session = lire("src/lib/auth/session.ts");
    const corps = /export async function destroySession[\s\S]*?\n}/.exec(session)?.[0] ?? "";
    expect(corps).toContain("oublierLienPersonnel");
  });

  it("l'écran de bienvenue demande le lien **au nom de qui regarde**", () => {
    const page = lire("src/app/(app)/bienvenue/page.tsx");
    expect(page).toContain("lienPersonnelDeLOuverture(user.id)");
  });

  it("l'ouverture d'un lien passe par le poseur, jamais par un `cookies().set` à la main", () => {
    const actions = lire("src/actions/auth.ts");
    expect(actions).toContain("await poserLienPersonnel(userId, token);");
    expect(actions).not.toContain("LIEN_PERSO_COOKIE");
  });
});
