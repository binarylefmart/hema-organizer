import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Deux choses se confondaient dans `touchSession`**.
 *
 * 1. **La durée de la session** vit en base (`AuthSession.expiresAt`) et glisse de douze heures à chaque
 *    geste. Le dossier le promet noir sur blanc : « chaque geste dans l'application repousse l'échéance de
 *    12 h ». Mais le glissement ne vivait que dans `touchSession`, appelée depuis **cinq** server actions
 *    sur toute l'application. Lire des pages, régler le planning, répondre à un atelier ne repoussaient
 *    rien : quelqu'un connecté le matin et revenu le soir était mis dehors **au milieu** de son premier
 *    geste — le seul moment où l'échéance aurait bougé. Il glisse désormais dans `getCurrentUser`, traversée
 *    par toute requête authentifiée.
 * 2. **La persistance du cookie** est un choix de la personne, et l'écran le lui promet : sans « Rester
 *    connecté », la session ne survit pas à la fermeture du navigateur. Or `touchSession` reposait
 *    **toujours** un cookie de douze heures. Sur l'ordinateur d'un ami, deux présences cochées à trente-cinq
 *    minutes d'intervalle suffisaient : la case décochée devenait inopérante, et la session repartait le
 *    lendemain. Le choix est gardé en base (`AuthSession.persistant`), parce qu'un serveur ne peut pas
 *    relire le `maxAge` d'un cookie.
 *
 * Les deux moitiés se tiennent : sans la première, la seconde met les gens dehors ; sans la seconde, la
 * première rend la case inutile.
 */

const faux = vi.hoisted(() => ({
  jeton: "",
  session: null as Record<string, unknown> | null,
  majs: [] as Array<Record<string, unknown>>,
  cookies: [] as Array<{ nom: string; maxAge?: number }>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    authSession: {
      findUnique: vi.fn(async () => faux.session),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.majs.push(data);
        if (faux.session) Object.assign(faux.session, data);
        return faux.session;
      }),
      delete: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) => (nom === "hema_session" ? { name: nom, value: faux.jeton } : undefined),
    set: (nom: string, _valeur: string, opts?: { maxAge?: number }) => {
      faux.cookies.push({ nom, maxAge: opts?.maxAge });
    },
  }),
  headers: async () => new Headers({ "x-chemin": "/" }),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn(() => {}) }));
vi.mock("@/lib/env", () => ({ env: () => ({ SESSION_SECRET: "secret-de-test" }), baseUrl: () => "https://exemple.fr" }));
vi.mock("@/lib/request-info", () => ({ clientIp: vi.fn(async () => "10.0.0.1"), userAgent: vi.fn(async () => "test") }));
// L'élévation a ses propres tests : ici, aucune session n'est élevée.
vi.mock("@/lib/auth/elevation", () => ({
  fermerElevation: vi.fn(async () => {}),
  ouvrirElevation: vi.fn(async () => {}),
  etatElevation: vi.fn(async () => "fermee"),
  ouvertureElevation: vi.fn(async () => null),
  toucherElevation: vi.fn(async () => {}),
  annulerSortieElevation: vi.fn(async () => {}),
  refermerElevationSortie: vi.fn(async () => {}),
}));

const { echeanceProlongee, touchSession } = await import("@/lib/auth/session");
const { getCurrentUser } = await import("@/lib/auth/current-user");
const { generateToken, hashToken } = await import("@/lib/auth/tokens");
const { DUREE_SESSION_LONGUE_MS } = await import("@/lib/constants");

const HEURE = 60 * 60 * 1000;

/** Une session à laquelle il reste une heure : sans glissement, elle s'éteint dans une heure. */
function session(options: { persistant?: boolean; resteMs?: number; vueIlYaMs?: number } = {}) {
  faux.jeton = generateToken();
  faux.session = {
    id: "session-1",
    tokenHash: hashToken(faux.jeton),
    expiresAt: new Date(Date.now() + (options.resteMs ?? HEURE)),
    lastSeenAt: new Date(Date.now() - (options.vueIlYaMs ?? 0)),
    origine: "lien",
    persistant: options.persistant ?? false,
    forte: false,
    elevationVueLe: null,
    elevationSortieLe: null,
    reauthAt: null,
    user: { id: "u-1", prenom: "Chloé", nom: "Durand", email: "chloe@exemple.fr", role: "MEMBRE", actif: true, rappelEmail: true, theme: "hema", createdAt: new Date(), auClubDepuis: null },
  };
  return faux.session;
}

beforeEach(() => {
  faux.jeton = "";
  faux.session = null;
  faux.majs = [];
  faux.cookies = [];
});

describe("la règle de glissement, en un seul endroit", () => {
  it("rend une échéance à douze heures quand le gain vaut une écriture", () => {
    const echeance = echeanceProlongee({ expiresAt: new Date(Date.now() + HEURE), origine: "lien" });
    expect(echeance?.getTime()).toBeGreaterThan(Date.now() + DUREE_SESSION_LONGUE_MS - 60_000);
  });

  it("ne rend rien sous la marge : une session touchée à l'instant ne se réécrit pas à chaque clic", () => {
    expect(echeanceProlongee({ expiresAt: new Date(Date.now() + DUREE_SESSION_LONGUE_MS - 60_000), origine: "lien" })).toBeNull();
  });

  /** Même exemption que dans `touchSession` : voir `tests/unit/session-origine-inconnue.test.ts`. */
  it("ne rend rien pour une session d'avant la migration (origine inconnue)", () => {
    expect(echeanceProlongee({ expiresAt: new Date(Date.now() + HEURE), origine: null })).toBeNull();
  });
});

describe("la fenêtre glisse à chaque requête, pas seulement sur cinq actions", () => {
  it("ouvrir une page repousse l'échéance de douze heures", async () => {
    session();
    expect(await getCurrentUser()).not.toBeNull();
    expect(faux.majs).toHaveLength(1);
    expect((faux.majs[0].expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + DUREE_SESSION_LONGUE_MS - 60_000);
  });

  /**
   * Le scénario même du défaut : onze heures de lecture, puis un geste. Avant, les onze heures ne
   * repoussaient rien et le geste arrivait sur une session morte.
   */
  it("une session lue une heure avant son terme survit à la lecture seule", async () => {
    const s = session({ resteMs: HEURE });
    await getCurrentUser();
    expect((s.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 11 * HEURE);
  });

  it("n'écrit rien quand ni l'échéance ni la dernière vue ne le méritent", async () => {
    session({ resteMs: DUREE_SESSION_LONGUE_MS - 60_000 });
    await getCurrentUser();
    expect(faux.majs).toEqual([]);
  });

  it("échéance et dernière vue partent dans la même écriture", async () => {
    session({ vueIlYaMs: 2 * HEURE });
    await getCurrentUser();
    expect(faux.majs).toHaveLength(1);
    expect(Object.keys(faux.majs[0]).sort()).toEqual(["expiresAt", "lastSeenAt"]);
  });

  /** Un composant serveur ne peut pas poser de cookie : la base est l'autorité sur la durée. */
  it("ne pose aucun cookie au passage", async () => {
    session({ persistant: true });
    await getCurrentUser();
    expect(faux.cookies).toEqual([]);
  });

  it("ne prolonge pas une session déjà expirée : elle est supprimée", async () => {
    session({ resteMs: -1000 });
    expect(await getCurrentUser()).toBeNull();
    expect(faux.majs).toEqual([]);
  });
});

describe("« Rester connecté » décide seul de la survie du cookie", () => {
  it("case décochée : aucun cookie reposé, même après deux gestes espacés", async () => {
    session();
    await touchSession();
    // Trente-cinq minutes plus tard, l'échéance mérite une écriture — et c'est exactement là que le
    // cookie repartait persistant.
    (faux.session as { expiresAt: Date }).expiresAt = new Date(Date.now() + HEURE);
    await touchSession();
    expect(faux.cookies).toEqual([]);
  });

  it("case cochée : le cookie est reposé avec son échéance de douze heures", async () => {
    session({ persistant: true });
    await touchSession();
    expect(faux.cookies).toEqual([{ nom: "hema_session", maxAge: DUREE_SESSION_LONGUE_MS / 1000 }]);
  });

  it("une session expirée ne repose rien, même cochée", async () => {
    session({ persistant: true, resteMs: -1000 });
    await touchSession();
    expect(faux.cookies).toEqual([]);
    expect(faux.majs).toEqual([]);
  });
});
