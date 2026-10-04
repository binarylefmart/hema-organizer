import { describe, expect, it, vi } from "vitest";
import { decisionSeed, seedAdmin, type ClientSeed, type CompteExistant, type VariablesSeed } from "../../prisma/seed";

/**
 * **Le seed du compte d'administration ne touche jamais un compte existant** (`prisma/seed.ts`).
 *
 * Il promouvait le compte trouvé à l'adresse d'`ADMIN_EMAIL` — `role: "ADMIN"`, `actif: true`,
 * `service: true` — alors que sa propre docstring, `.env.example`, `docs/DEPLOIEMENT.md` § 2 et
 * CLAUDE.md promettaient un seed idempotent. Et il tourne **à chaque démarrage du conteneur**
 * (`docker/entrypoint.sh`, étape 3) : chaque *Update the stack*, chaque *Re-pull image*, chaque
 * reboot rejouait la promotion.
 *
 * Les trois scénarios réels, qui sont les trois cas de ce fichier :
 *
 * 1. l'adresse du club est aussi celle d'une personne de l'annuaire → elle devenait ADMIN **et
 *    compte de service** (donc hors des listes nominatives, des effectifs, des liens personnels, et
 *    plus modifiable depuis l'interface) ;
 * 2. un administrateur déchu dans « Comptes admin » était re-promu au redémarrage suivant ;
 * 3. un compte désactivé exprès était réactivé.
 *
 * Le test porte sur les deux niveaux : la **décision** (fonction pure) et le **client** — parce que
 * ce qui doit rester vrai, c'est qu'il n'existe qu'une seule écriture possible, `create`.
 */

/*
 * **Le bureau se lit sur `estAdmin`** : `role` ne vaut plus jamais « ADMIN », et un administrateur
 * déchu n'est plus celui dont le rôle a changé mais celui dont le supplément est tombé — son rôle
 * de base, lui, n'a jamais bougé.
 */
const NON_ADMIN: CompteExistant = { role: "MEMBRE", estAdmin: false, actif: true, service: false };
const ADMIN_DECHU: CompteExistant = { role: "INSTRUCTEUR", estAdmin: false, actif: true, service: false };
const DESACTIVE: CompteExistant = { role: "MEMBRE", estAdmin: true, actif: false, service: true };

const CONFIG = { email: "contact@mon-club.fr", password: "provisoire-a-changer-42" };

/** Un faux client Prisma : il note ce qu'on lui demande, et n'a aucune méthode d'écriture de trop. */
function fauxClient(existant: CompteExistant | null) {
  const cree: Array<Record<string, unknown>> = [];
  const client: ClientSeed = {
    user: {
      findUnique: vi.fn(async () => existant),
      create: vi.fn(async ({ data }) => {
        cree.push(data);
        return data;
      }),
    },
  };
  return { client, cree };
}

describe("decisionSeed — un compte existant n'est jamais modifié", () => {
  it("laisse un compte non-admin tel quel (l'adresse du club est aussi celle d'un membre)", () => {
    const d = decisionSeed(CONFIG, NON_ADMIN);
    expect(d.action).toBe("laisser");
    expect(d.message).toContain("rien n'est modifié");
    expect(d.message).toContain("Comptes admin");
  });

  it("ne re-promeut pas un administrateur déchu", () => {
    expect(decisionSeed(CONFIG, ADMIN_DECHU).action).toBe("laisser");
  });

  it("ne réactive pas un compte désactivé exprès", () => {
    const d = decisionSeed(CONFIG, DESACTIVE);
    expect(d.action).toBe("laisser");
    expect(d.message).toContain("désactivé");
  });

  it("crée le compte quand l'adresse est libre", () => {
    expect(decisionSeed(CONFIG, null)).toMatchObject({ action: "creer", email: CONFIG.email });
  });

  it("ne crée rien sans adresse, sans mot de passe, ou avec un mot de passe trop court", () => {
    expect(decisionSeed({ password: CONFIG.password }, null).action).toBe("rien");
    expect(decisionSeed({ email: CONFIG.email }, null).action).toBe("rien");
    expect(decisionSeed({ email: CONFIG.email, password: "court" }, null).action).toBe("rien");
  });

  it("normalise l'adresse (espaces, majuscules) comme la connexion", () => {
    expect(decisionSeed({ email: "  Contact@Mon-Club.FR ", password: CONFIG.password }, null)).toMatchObject({ email: "contact@mon-club.fr" });
  });
});

describe("seedAdmin — une seule écriture possible, et seulement sur une adresse libre", () => {
  const variables: VariablesSeed = { ADMIN_EMAIL: CONFIG.email, ADMIN_PASSWORD: CONFIG.password };

  it("n'écrit rien du tout quand un compte existe, quel que soit son état", async () => {
    for (const existant of [NON_ADMIN, ADMIN_DECHU, DESACTIVE, { role: "MEMBRE", estAdmin: true, actif: true, service: true }]) {
      const { client, cree } = fauxClient(existant);
      const d = await seedAdmin(client, variables);
      expect(d.action).toBe("laisser");
      expect(cree).toHaveLength(0);
      expect(client.user.create).not.toHaveBeenCalled();
    }
  });

  it("crée le compte de service, mot de passe provisoire à changer, quand l'adresse est libre", async () => {
    const { client, cree } = fauxClient(null);
    expect((await seedAdmin(client, variables)).action).toBe("creer");
    expect(cree).toHaveLength(1);
    // **Le compte du portail naît `estAdmin`, avec un rôle de base neutre** : écrit `role: "ADMIN"`,
    // il n'aurait plus aucun droit par la matrice — et c'est la seule porte de l'administration
    // technique sur une installation neuve.
    expect(cree[0]).toMatchObject({ email: CONFIG.email, role: "MEMBRE", estAdmin: true, service: true, doitChangerMotDePasse: true });
    // Le mot de passe n'est jamais rangé en clair.
    expect(cree[0].passwordHash).not.toBe(CONFIG.password);
    expect(String(cree[0].passwordHash)).toMatch(/^\$argon2/);
  });

  it("ne consulte même pas la base quand la configuration est absente", async () => {
    const { client } = fauxClient(null);
    expect((await seedAdmin(client, {})).action).toBe("rien");
    expect(client.user.findUnique).not.toHaveBeenCalled();
  });
});
