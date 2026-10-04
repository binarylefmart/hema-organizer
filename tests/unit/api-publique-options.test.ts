import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **`OPTIONS` est une porte comme les autres.**
 *
 * Les deux routes publiques annoncent en tête « quatre gardes, dans cet ordre » — mais la requête
 * préalable du navigateur les contournait toutes :
 *
 *  - publication **fermée**, `GET` rendait `503` et `OPTIONS` rendait `204` **avec** l'origine
 *    autorisée du site du club. Un `curl -X OPTIONS` apprenait donc qu'une API vit là et pour qui
 *    elle est ouverte, alors que le bureau venait justement de décocher la case. Un interrupteur qui
 *    ne coupe que la moitié des verbes n'est pas un interrupteur ;
 *  - aucun des deux `OPTIONS` n'entrait dans le seau `public_api_ip`, si bien que les
 *    « 60 appels/min/IP » promis par `docs/SECURITE.md` ne couvraient qu'un verbe sur deux — pour un
 *    coût serveur identique.
 *
 * Ce fichier tourne **deux fois, la même suite sur les deux routes** : la parité n'est pas une
 * intention écrite dans un commentaire, c'est ce qui est éprouvé ici. Et il vérifie le point qui
 * relie les deux routes : **un seul seau**, donc les préalables de l'une épuisent le quota de
 * l'autre.
 */

const faux = vi.hoisted(() => ({ ouverte: true, ip: "203.0.113.7" }));

vi.mock("@/lib/settings", () => ({ isPublicApiEnabled: vi.fn(async () => faux.ouverte) }));
vi.mock("@/lib/request-info", () => ({ clientIp: vi.fn(async () => faux.ip), userAgent: vi.fn(async () => "test") }));
vi.mock("@/lib/identite", () => ({ identite: vi.fn(async () => ({ nomClub: "Mon club d'AMHE" })), imagesIdentite: vi.fn(async () => []) }));
vi.mock("@/lib/partage", () => ({ prochainesSeancesPubliques: vi.fn(async () => []) }));
vi.mock("@/lib/evenements", () => ({ evenementsAVenir: vi.fn(async () => []) }));
vi.mock("@/lib/notifications/canaux", () => ({
  portesExposition: vi.fn(async () => ({})),
  expositionPossible: vi.fn(async () => false),
}));

const seances = await import("@/app/api/public/prochaines-seances/route");
const annonces = await import("@/app/api/public/annonces/route");
const { RATE_LIMITS, utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");

/** Les deux routes, avec un `GET` appelable de la même façon (seule la première lit l'URL). */
const PORTES = [
  { nom: "prochaines-seances", OPTIONS: seances.OPTIONS, GET: () => seances.GET(new Request("https://organizer.exemple.fr/api/public/prochaines-seances")) },
  { nom: "annonces", OPTIONS: annonces.OPTIONS, GET: () => annonces.GET() },
];

beforeEach(() => {
  utiliserMagasinMemoire();
  faux.ouverte = true;
  faux.ip = "203.0.113.7";
});

describe.each(PORTES)("$nom : la requête préalable passe les mêmes gardes que GET", ({ OPTIONS, GET }) => {
  it("publication ouverte : 204 et les en-têtes CORS", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    // `Access-Control-Allow-Origin` n'apparaît que si `PUBLIC_API_ORIGIN` est réglée (elle ne l'est
    // pas en test) ; `Allow-Methods`, lui, est là dès qu'on annonce quelque chose.
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
  });

  it("publication fermée : 503, et pas un mot sur l'origine autorisée", async () => {
    faux.ouverte = false;
    const res = await OPTIONS();
    expect(res.status).toBe(503);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // Le même verdict que GET : c'est tout l'objet de la correction.
    expect((await GET()).status).toBe(503);
  });

  it("entre dans le seau : au-delà du quota, 429 comme GET", async () => {
    const { max } = RATE_LIMITS.public_api_ip;
    for (let i = 0; i < max; i++) expect((await OPTIONS()).status).toBe(204);
    const refus = await OPTIONS();
    expect(refus.status).toBe(429);
    expect(refus.headers.get("Retry-After")).toBe("60");
    expect(refus.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("compte par adresse : le quota d'un robot ne ferme pas la porte aux autres", async () => {
    const { max } = RATE_LIMITS.public_api_ip;
    for (let i = 0; i < max + 1; i++) await OPTIONS();
    faux.ip = "198.51.100.4";
    expect((await OPTIONS()).status).toBe(204);
  });
});

describe("un seul seau pour toute l'API publique", () => {
  it("les préalables d'une route épuisent le quota de l'autre", async () => {
    const { max } = RATE_LIMITS.public_api_ip;
    for (let i = 0; i < max; i++) expect((await seances.OPTIONS()).status).toBe(204);
    expect((await annonces.OPTIONS()).status).toBe(429);
    expect((await annonces.GET()).status).toBe(429);
  });

  it("les préalables et les lectures tirent sur le même budget", async () => {
    const { max } = RATE_LIMITS.public_api_ip;
    for (let i = 0; i < max; i++) await annonces.OPTIONS();
    expect((await seances.GET(new Request("https://organizer.exemple.fr/api/public/prochaines-seances"))).status).toBe(429);
  });
});
