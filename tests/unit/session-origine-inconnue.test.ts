import { beforeEach, describe, expect, it, vi } from "vitest";
import { DUREE_SESSION_LONGUE_MS } from "@/lib/constants";
import { generateToken, hashToken } from "@/lib/auth/tokens";

/**
 * **Une exemption sans borne n'est plus une exemption, c'est une porte.**
 *
 * `AuthSession.origine` dit par où une session est entrée (`"lien"` ou `"mot-de-passe"`). Le
 * plafond de 3 appareils du lien personnel ne compte que les sessions d'origine « lien » — sans
 * cette distinction, trois connexions au mot de passe dans la journée faisaient révoquer le lien à
 * la première ouverture d'email.
 *
 * La migration `20260929180000_origine_session` n'a **rien rempli**, et c'est le bon choix : on ne
 * sait pas par où sont entrées les sessions d'avant. Elles restent valables et ne comptent nulle
 * part — le schéma, le code et les tests disent tous « pendant leurs dernières heures ».
 *
 * Sauf que `touchSession` repoussait l'échéance de 12 h à chaque geste **sans jamais écrire
 * `origine`**. Une session ouverte la veille du déploiement, utilisée une fois par jour, ne mourait
 * donc jamais : un appareil vivant, invisible du plafond, **indéfiniment**. « Dernières heures »
 * devenait faux, et la garde qui protège les liens personnels comptait à côté d'un appareil réel.
 *
 * Ce fichier tient la promesse : une session sans origine ne se prolonge pas.
 */

const faux = vi.hoisted(() => ({
  session: null as { tokenHash: string; expiresAt: Date; origine: string | null; persistant: boolean } | null,
  majs: [] as Array<{ tokenHash: string; expiresAt: Date }>,
  cookiesPoses: [] as string[],
  jeton: "",
}));

vi.mock("@/lib/db", () => ({
  db: {
    authSession: {
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) =>
        faux.session && faux.session.tokenHash === where.tokenHash ? faux.session : null,
      ),
      update: vi.fn(async ({ where, data }: { where: { tokenHash: string }; data: { expiresAt: Date } }) => {
        faux.majs.push({ tokenHash: where.tokenHash, expiresAt: data.expiresAt });
        if (faux.session) faux.session.expiresAt = data.expiresAt;
        return faux.session;
      }),
    },
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (nom: string) => (nom === "hema_session" ? { value: faux.jeton } : undefined),
    set: (nom: string) => {
      faux.cookiesPoses.push(nom);
    },
  })),
}));

vi.mock("@/lib/auth/elevation", () => ({ fermerElevation: vi.fn(async () => {}), ouvrirElevation: vi.fn(async () => {}) }));
vi.mock("@/lib/request-info", () => ({ clientIp: vi.fn(async () => "10.0.0.1"), userAgent: vi.fn(async () => "test") }));

const { touchSession } = await import("@/lib/auth/session");

/**
 * Une session à laquelle il reste peu de temps : sans prolongation, elle s'éteindra.
 *
 * `persistant` vaut vrai (« Rester connecté » coché) parce que, `touchSession` ne repose un cookie
 * — et donc ne fait glisser quoi que ce soit — que dans ce cas ; c'est `getCurrentUser` qui porte
 * le glissement ordinaire. Les deux moitiés sont couvertes par
 * `tests/unit/session-fenetre-glissante.test.ts` ; ici, seule l'exemption d'origine est en jeu, et
 * elle doit valoir même sur le chemin le plus permissif.
 */
function sessionQuiExpireBientot(origine: string | null) {
  faux.jeton = generateToken();
  faux.session = { tokenHash: hashToken(faux.jeton), expiresAt: new Date(Date.now() + 60 * 60 * 1000), origine, persistant: true };
}

beforeEach(() => {
  faux.session = null;
  faux.majs = [];
  faux.cookiesPoses = [];
  faux.jeton = "";
});

describe("prolongation d'une session (fenêtre glissante de 12 h)", () => {
  it("prolonge une session ouverte par lien personnel", async () => {
    sessionQuiExpireBientot("lien");
    await touchSession();
    expect(faux.majs).toHaveLength(1);
    // L'échéance repart pour douze heures pleines
    expect(faux.majs[0].expiresAt.getTime()).toBeGreaterThan(Date.now() + DUREE_SESSION_LONGUE_MS - 60_000);
  });

  it("prolonge une session ouverte au mot de passe", async () => {
    sessionQuiExpireBientot("mot-de-passe");
    await touchSession();
    expect(faux.majs).toHaveLength(1);
  });

  it("ne prolonge JAMAIS une session d'avant la migration (origine inconnue)", async () => {
    sessionQuiExpireBientot(null);
    // Dix gestes dans l'application : l'échéance ne bouge pas d'une minute
    for (let i = 0; i < 10; i++) await touchSession();
    expect(faux.majs, "une session invisible du plafond d'appareils ne doit pas survivre indéfiniment").toEqual([]);
    expect(faux.cookiesPoses).toEqual([]);
    // Elle reste valable jusqu'à son terme : on ne met personne dehors pour une colonne ajoutée
    expect(faux.session?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("n'écrit surtout pas une origine au passage : ce serait compter les sessions de mot de passe", async () => {
    sessionQuiExpireBientot(null);
    await touchSession();
    expect(faux.session?.origine).toBeNull();
  });
});
