import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **L'espace admin se refermait plus tôt qu'annoncé.**
 *
 * La sortie de l'application est *notée* (`AuthSession.elevationSortieLe`) et ne referme qu'au bout
 * de la grâce « sans nouvelle de l'application ». Mais le serveur ne voit l'application que
 * lorsqu'elle lui parle : une page lue trois minutes et un téléphone posé trois minutes se
 * ressemblent trait pour trait. La note vieillissait donc toute seule, et mesurait **l'âge du signal
 * de sortie** au lieu de la durée de l'absence — or le même `visibilitychange` part quand on bascule
 * d'onglet cinq secondes. Le clic suivant, trois minutes plus tard sur un formulaire qu'on
 * remplissait, refermait l'espace admin de quelqu'un qui n'avait jamais quitté son bureau.
 *
 * Seule l'application connaît la durée de son absence : elle la compte. Elle la **déclare** donc,
 * dans les deux sens — revenue à temps, la sortie n'a pas eu lieu ; revenue trop tard, on referme
 * pour de bon. Et rien de tout cela ne desserre les deux échéances qui, elles, se mesurent sans
 * rien deviner : 10 min d'inactivité dans l'espace admin, 12 h de plafond.
 */

const cookiesFaux: Record<string, string> = {};
/** La ligne `AuthSession`, telle que les écritures de l'élévation la laissent. */
const session = { id: "session-1", forte: true, reauthAt: new Date() as Date | null, elevationVueLe: null as Date | null, elevationSortieLe: null as Date | null };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) => (nom in cookiesFaux ? { name: nom, value: cookiesFaux[nom] } : undefined),
    set: (nom: string, valeur: string, opts?: { maxAge?: number }) => {
      if (opts?.maxAge === 0) delete cookiesFaux[nom];
      else cookiesFaux[nom] = valeur;
    },
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    authSession: {
      update: vi.fn(async ({ data }: { data: Partial<typeof session> }) => {
        Object.assign(session, data);
        return session;
      }),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ SESSION_SECRET: "secret-de-test-pour-l-elevation" }),
  baseUrl: () => "https://organizer.mon-club.fr",
}));

const { absenceDepasseLaGrace, etatElevation, ouvrirElevation, signalerRetourElevation, signalerSortieElevation } = await import("@/lib/auth/elevation");
const { DUREE_ELEVATION_MS, DUREE_INACTIVITE_ELEVATION_MS, GRACE_SORTIE_ELEVATION_MS } = await import("@/lib/constants");

/** L'état de l'élévation, lu comme `getCurrentUser` le lit : sur la ligne de session. */
const etat = () => etatElevation(session.id, session.elevationVueLe, session.elevationSortieLe);

/** Avance l'horloge (minuteurs simulés déjà en place). */
const avancerDe = (ms: number) => vi.setSystemTime(Date.now() + ms);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
  for (const cle of Object.keys(cookiesFaux)) delete cookiesFaux[cle];
  Object.assign(session, { forte: true, reauthAt: new Date(), elevationVueLe: null, elevationSortieLe: null });
  // Mot de passe et code redonnés : l'espace admin s'ouvre, et le geste est daté.
  await ouvrirElevation(session.id);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("l'absence se mesure, elle ne se déduit pas de l'âge du signal", () => {
  it("l'application qui bascule d'onglet cinq secondes garde son espace admin, même sans rien faire ensuite", async () => {
    // Le navigateur passe en arrière-plan : le même signal part que pour un vrai départ.
    await signalerSortieElevation(session.id);
    avancerDe(5_000);
    // Elle revient tout de suite et le dit : la sortie n'a pas eu lieu.
    await signalerRetourElevation(session.id, 5_000);
    expect(session.elevationSortieLe).toBeNull();
    // Puis trois minutes de lecture, sans une requête : c'est ce silence-là qui refermait tout.
    avancerDe(3 * 60_000);
    expect(await etat()).toBe("ouverte");
  });

  it("l'application vraiment partie referme pour de bon, comme le bouton « Quitter »", async () => {
    await signalerSortieElevation(session.id);
    avancerDe(5 * 60_000);
    await signalerRetourElevation(session.id, 5 * 60_000);
    // Même remise à plat que `refermerElevationSortie` : la session ordinaire, elle, n'est pas touchée.
    expect(session).toMatchObject({ forte: false, reauthAt: null, elevationVueLe: null, elevationSortieLe: null });
    expect(await etat()).toBe("aucune");
  });

  it("le seuil est le même des deux côtés : au-delà de la grâce, l'absence compte", () => {
    expect(absenceDepasseLaGrace(0)).toBe(false);
    expect(absenceDepasseLaGrace(GRACE_SORTIE_ELEVATION_MS)).toBe(false);
    expect(absenceDepasseLaGrace(GRACE_SORTIE_ELEVATION_MS + 1)).toBe(true);
  });
});

/**
 * L'autre sens : rien de ce qui précède ne doit permettre à une élévation de **durer plus
 * longtemps qu'annoncé**. Les trois échéances vérifiées en base restent au-dessus de la parole du
 * navigateur.
 */
describe("les échéances annoncées ne bougent pas", () => {
  it("une sortie que personne ne contredit referme encore", async () => {
    await signalerSortieElevation(session.id);
    avancerDe(GRACE_SORTIE_ELEVATION_MS + 1_000);
    expect(await etat()).toBe("retombee");
  });

  it("dix minutes sans rien faire dans l'espace admin referment, retour déclaré ou non", async () => {
    await signalerSortieElevation(session.id);
    avancerDe(60_000);
    await signalerRetourElevation(session.id, 60_000);
    avancerDe(DUREE_INACTIVITE_ELEVATION_MS + 1_000);
    expect(await etat()).toBe("retombee");
  });

  it("le plafond de douze heures tient, même à coups de retours déclarés", async () => {
    for (let i = 0; i < 20; i++) {
      avancerDe(DUREE_ELEVATION_MS / 20);
      await signalerSortieElevation(session.id);
      await signalerRetourElevation(session.id, 1_000);
    }
    avancerDe(1_000);
    expect(await etat()).toBe("retombee");
  });

  it("un retour déclaré ne rouvre pas un espace admin qui n'était pas ouvert", async () => {
    // Le cookie est le second facteur : sans lui, aucune déclaration ne vaut élévation.
    delete cookiesFaux["hema_admin"];
    await signalerRetourElevation(session.id, 0);
    expect(await etat()).toBe("aucune");
  });
});
