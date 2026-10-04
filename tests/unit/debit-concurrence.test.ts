import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, RATE_LIMITS, utiliserMagasinMemoire } from "@/lib/auth/rate-limit";

/** La liste des codes de secours rangée en base, telle quelle : une chaîne JSON, ou rien. */
const codes = vi.hoisted(() => ({ valeur: null as string | null }));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => ({ codesSecours: codes.valeur })),
      // `updateMany` porte la valeur attendue dans son `where` : c'est l'écriture conditionnelle.
      // Comparaison et écriture sans `await` entre les deux, comme SQLite sérialise ses écritures.
      updateMany: vi.fn(async ({ where, data }: { where: { codesSecours: string | null }; data: { codesSecours: string } }) => {
        if (codes.valeur !== where.codesSecours) return { count: 0 };
        codes.valeur = data.codesSecours;
        return { count: 1 };
      }),
    },
  },
}));

/**
 * **Un plafond qui se lit puis s'écrit n'est pas un plafond.**
 *
 * Défaut, trouvé par relecture adverse. `checkRateLimit` faisait deux requêtes indépendantes — lire
 * la fenêtre, puis l'écrire —, sans transaction ni incrément atomique. Cent tentatives simultanées
 * lisaient toutes la même fenêtre vide, étaient toutes admises, et leurs écritures s'écrasaient
 * l'une l'autre : **un passage enregistré pour cent essais**. Le plafond n'était pas « 8 par quart
 * d'heure » mais « 8 vagues séquentielles », ce qui ne freine aucun robot. Et cela valait pour le
 * second facteur (`totp_user`), pour la recherche de jetons (`invitation_inconnue_ip`) et pour le
 * compteur qui décide de la révocation d'un lien diffusé (`invitation_token`).
 *
 * **Ces tests ne trichent pas** : le magasin en mémoire est asynchrone comme celui de la base, et
 * `Promise.all` sur des appels entrelacés reproduit exactement la course — c'est ainsi que le défaut
 * se voit, et qu'on vérifie qu'il ne revient pas.
 */

/** Lance `n` vérifications **en parallèle** et compte celles qui ont été admises. */
async function enParallele(contexte: keyof typeof RATE_LIMITS, cle: string, n: number, now = 1_000_000): Promise<number> {
  const issues = await Promise.all(Array.from({ length: n }, () => checkRateLimit(contexte, cle, now)));
  return issues.filter(Boolean).length;
}

describe("le limiteur de débit décide de façon atomique", () => {
  beforeEach(() => utiliserMagasinMemoire());

  it("cent tentatives de connexion simultanées n'en font pas passer plus que le plafond", async () => {
    const { max } = RATE_LIMITS.login_email;
    expect(await enParallele("login_email", "chloe@club.test", 100)).toBe(max);
    // Et la fenêtre est bien pleine : la suivante est refusée, même seule.
    expect(await checkRateLimit("login_email", "chloe@club.test", 1_000_000)).toBe(false);
  });

  it("vaut pour le second facteur, la recherche de jetons et le compteur d'un lien", async () => {
    for (const contexte of ["totp_user", "invitation_inconnue_ip", "invitation_token"] as const) {
      utiliserMagasinMemoire();
      expect(await enParallele(contexte, "cible", 60), contexte).toBe(RATE_LIMITS[contexte].max);
    }
  });

  /**
   * Le plafond d'un renouvellement par jour est le cas le plus serré : deux ouvertures simultanées
   * d'un lien expiré ne doivent pas faire partir deux emails.
   */
  it("un plafond à un seul passage n'en laisse passer qu'un", async () => {
    expect(await enParallele("renouvellement_user", "u-chloe", 25)).toBe(1);
  });

  it("chaque clé garde sa propre fenêtre, et la casse ne les sépare pas", async () => {
    const { max } = RATE_LIMITS.login_email;
    expect(await enParallele("login_email", "A@B.fr", 50)).toBe(max);
    expect(await checkRateLimit("login_email", "a@b.FR", 1_000_000)).toBe(false);
    expect(await checkRateLimit("login_email", "hotel@club.test", 1_000_000)).toBe(true);
  });

  /** Une tentative refusée n'écrit rien : un robot qui insiste n'enferme pas dehors le titulaire. */
  it("insister ne prolonge pas la fenêtre", async () => {
    const { max, windowMs } = RATE_LIMITS.login_email;
    const t0 = 1_000_000;
    for (let i = 0; i < max; i++) expect(await checkRateLimit("login_email", "chloe@club.test", t0 + i)).toBe(true);
    // Le robot martèle pendant toute la fenêtre…
    for (let i = 0; i < 200; i++) await checkRateLimit("login_email", "chloe@club.test", t0 + 1000 + i);
    // …et la personne retrouve sa porte dès la fenêtre écoulée, pas plus tard.
    expect(await checkRateLimit("login_email", "chloe@club.test", t0 + windowMs + max + 1)).toBe(true);
  });
});

/**
 * **Même famille, plus petit : un code de secours « à usage unique ».**
 *
 * Il se lisait, se retirait de la liste, puis la liste se réécrivait. Deux envois simultanés du même
 * code lisaient tous deux une liste où il figurait encore : le code servait **deux fois**, sur la
 * porte qui remplace le second facteur d'un administrateur.
 */
describe("un code de secours ne sert qu'une fois, même sous concurrence", () => {
  it("deux envois simultanés du même code : un seul est accepté", async () => {
    const { consommerCodeSecours, hacherCodeSecours } = await import("@/lib/auth/codes-secours");
    const restants = ["AAAA-2222", "BBBB-3333", "CCCC-4444"];
    codes.valeur = JSON.stringify(restants.map(hacherCodeSecours));
    const issues = await Promise.all([consommerCodeSecours("u-admin", "AAAA-2222"), consommerCodeSecours("u-admin", "AAAA-2222")]);
    expect(issues.filter((r) => r !== null)).toHaveLength(1);
    // Et un seul code a disparu de la liste.
    expect(JSON.parse(codes.valeur!)).toHaveLength(restants.length - 1);
  });

  it("deux codes différents envoyés ensemble sont tous deux consommés", async () => {
    const { consommerCodeSecours, hacherCodeSecours } = await import("@/lib/auth/codes-secours");
    codes.valeur = JSON.stringify(["AAAA-2222", "BBBB-3333", "CCCC-4444"].map(hacherCodeSecours));
    const issues = await Promise.all([consommerCodeSecours("u-admin", "AAAA-2222"), consommerCodeSecours("u-admin", "BBBB-3333")]);
    expect(issues.filter((r) => r !== null)).toHaveLength(2);
    expect(JSON.parse(codes.valeur!)).toHaveLength(1);
  });
});
