import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **`/api/affiche/<sha256>.<ext>` est une porte publique qui lit le disque.**
 *
 * Elle sert les affiches d'événements aux pages de partage et aux aperçus Open Graph : pas de
 * session, pas de jeton, et jusqu'à 4 Mo rendus à chaque appel (`AFFICHE_TAILLE_MAX`). Aucun secret
 * n'y fuit — une affiche est faite pour être vue — mais une boucle dessus, c'est du débit et des
 * entrées/sorties gratuits pris sur une instance unique qui sert aussi les réponses de présence du
 * soir. Les autres portes publiques du projet (API publique, pages de partage, liens inconnus) ont
 * toutes leur contexte de limitation ; celle-ci n'en avait aucun.
 *
 * Le plafond est volontairement large : une page d'événements affiche plusieurs images, et le cache
 * « immutable » d'un an fait qu'un même visiteur ne redemande pas la même. Ce qui est écarté, c'est
 * la boucle — pas la consultation.
 */

const faux = vi.hoisted(() => ({ ip: "203.0.113.7", lectures: 0 }));

vi.mock("@/lib/affiches", () => ({
  lireAffiche: vi.fn(async () => {
    faux.lectures++;
    return { octets: new Uint8Array([1, 2, 3]), type: "image/png" };
  }),
}));

vi.mock("@/lib/request-info", () => ({ clientIp: vi.fn(async () => faux.ip), userAgent: vi.fn(async () => "test") }));

const { GET } = await import("@/app/api/affiche/[fichier]/route");
const { RATE_LIMITS, utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");

const NOM = `${"a".repeat(64)}.png`;

function demander() {
  return GET(new Request(`https://exemple.fr/api/affiche/${NOM}`), { params: Promise.resolve({ fichier: NOM }) });
}

beforeEach(() => {
  utiliserMagasinMemoire();
  faux.ip = "203.0.113.7";
  faux.lectures = 0;
});

describe("limiteur de débit sur les affiches", () => {
  it("sert normalement tant que le quota tient", async () => {
    const res = await demander();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("immutable");
  });

  it("répond 429 au-delà du quota, et ne touche plus au disque", async () => {
    const { max } = RATE_LIMITS.affiche_ip;
    for (let i = 0; i < max; i++) expect((await demander()).status).toBe(200);
    faux.lectures = 0;
    const refus = await demander();
    expect(refus.status).toBe(429);
    expect(refus.headers.get("Retry-After")).toBe("60");
    // Le refus tombe avant la lecture : sinon le limiteur ne protégerait pas ce qu'il coûte
    expect(faux.lectures).toBe(0);
  });

  it("compte par adresse : le quota d'un robot ne ferme pas la porte aux autres", async () => {
    const { max } = RATE_LIMITS.affiche_ip;
    for (let i = 0; i < max + 1; i++) await demander();
    faux.ip = "198.51.100.4";
    expect((await demander()).status).toBe(200);
  });
});
