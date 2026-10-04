/**
 * **La route qui referme l'espace admin quand l'application est quittée**
 * (`src/app/api/admin/quitter/route.ts`), éprouvée sur ce qu'elle fait — pas sur ce qu'elle dit.
 *
 * `tests/unit/elevation-admin.test.ts` lit déjà le source de cette route pour vérifier qu'elle ne
 * sait que *fermer*. Ce qui manquait, c'est la lecture du paramètre `?retour=`, la seule valeur de
 * la route qui vienne du navigateur : elle décide si la sortie notée est effacée (retour immédiat)
 * ou si l'élévation est refermée pour de bon (longue absence).
 *
 * **Le sens de la lecture était à l'envers** : `Math.max(0, Number(retour) || 0)` rendait `0` pour
 * `NaN`, `"abc"`, une valeur vide ou négative — donc « revenu tout de suite », donc la sortie notée
 * effacée. Ce n'est pas exploitable (la route est gardée par `Sec-Fetch-Site` / `Origin`, elle ne
 * sait que fermer, et les échéances d'inactivité et de durée restent vérifiées en base), mais une
 * durée qu'on ne sait pas lire doit être traitée comme **une longue absence** : dans le doute, on
 * referme, on n'annule pas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const signalerRetourElevation = vi.fn<(sessionId: string, absenceMs: number) => Promise<void>>(async () => {});
const signalerSortieElevation = vi.fn<(sessionId: string) => Promise<void>>(async () => {});
const refermerElevationSortie = vi.fn<(sessionId: string) => Promise<void>>(async () => {});
const fermerElevation = vi.fn(async () => {});
const getCurrentUser = vi.fn(async () => ({ sessionId: "sess-1", sessionForte: true }));

vi.mock("next/headers", () => ({
  // Requête émise par l'application elle-même : c'est le cas nominal, la garde d'origine passe.
  headers: async () => new Map([["sec-fetch-site", "same-origin"]]),
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: () => getCurrentUser() }));

vi.mock("@/lib/auth/elevation", () => ({
  signalerRetourElevation: (sessionId: string, absenceMs: number) => signalerRetourElevation(sessionId, absenceMs),
  signalerSortieElevation: (sessionId: string) => signalerSortieElevation(sessionId),
  refermerElevationSortie: (sessionId: string) => refermerElevationSortie(sessionId),
  fermerElevation: () => fermerElevation(),
}));

const { POST } = await import("@/app/api/admin/quitter/route");

/** L'absence déclarée au serveur pour ce `?retour=`, telle que la route la transmet. */
async function absenceTransmise(retour: string): Promise<number> {
  const reponse = await POST(new Request(`https://exemple.test/api/admin/quitter?retour=${retour}`, { method: "POST" }));
  expect(reponse.status).toBe(204);
  expect(signalerRetourElevation).toHaveBeenCalledTimes(1);
  return signalerRetourElevation.mock.calls[0][1];
}

/** Le seuil de grâce, celui-là même que `signalerRetourElevation` applique côté serveur. */
const { GRACE_SORTIE_ELEVATION_MS } = await import("@/lib/constants");

describe("?retour= : la durée d'absence déclarée par le navigateur", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ sessionId: "sess-1", sessionForte: true });
  });

  it("une durée lisible est transmise telle quelle", async () => {
    expect(await absenceTransmise("1500")).toBe(1500);
  });

  it("zéro reste zéro : revenir tout de suite est un cas normal", async () => {
    expect(await absenceTransmise("0")).toBe(0);
  });

  it("une durée illisible vaut une longue absence, jamais un retour immédiat", async () => {
    // C'est le sens du correctif : dans le doute on referme l'espace admin, on n'efface pas la
    // sortie notée. Au pire, quelqu'un redonne mot de passe et code ; au mieux, on ne laisse pas
    // une valeur qu'on ne comprend pas décider de garder l'administration ouverte.
    for (const valeur of ["abc", "", "%20", "-1", "-99999", "NaN", "Infinity", "1e400"]) {
      vi.clearAllMocks();
      expect(await absenceTransmise(valeur)).toBeGreaterThan(GRACE_SORTIE_ELEVATION_MS);
    }
  });

  it("sans `?retour=`, c'est le départ : on note, on ne ferme pas", async () => {
    const reponse = await POST(new Request("https://exemple.test/api/admin/quitter", { method: "POST" }));
    expect(reponse.status).toBe(204);
    expect(signalerSortieElevation).toHaveBeenCalledWith("sess-1");
    expect(signalerRetourElevation).not.toHaveBeenCalled();
    expect(fermerElevation).not.toHaveBeenCalled();
  });

  it("`?parti=1` referme pour de bon, sans passer par la durée", async () => {
    const reponse = await POST(new Request("https://exemple.test/api/admin/quitter?parti=1", { method: "POST" }));
    expect(reponse.status).toBe(204);
    expect(refermerElevationSortie).toHaveBeenCalledWith("sess-1");
    expect(fermerElevation).toHaveBeenCalled();
    expect(signalerRetourElevation).not.toHaveBeenCalled();
  });

  it("sans élévation, rien n'est touché — et la réponse reste un 204", async () => {
    // Une page qui se ferme n'a que faire d'une erreur.
    getCurrentUser.mockResolvedValue({ sessionId: "sess-1", sessionForte: false });
    const reponse = await POST(new Request("https://exemple.test/api/admin/quitter?retour=abc", { method: "POST" }));
    expect(reponse.status).toBe(204);
    expect(signalerRetourElevation).not.toHaveBeenCalled();
  });
});
