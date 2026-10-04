import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Un import CSV lisait tout avant de savoir s'il devait lire quoi que ce soit.**
 *
 * L'ordre des gestes était : `arrayBuffer()` sur le fichier entier, décodage entier — **deux fois**
 * quand le repli Windows-1252 se déclenche, puisque le premier décodage échoue au dernier octet —,
 * un objet par ligne, *puis* la coupe à 500 lignes. `bodySizeLimit` laisse entrer 5 Mo : un dépôt
 * répété, c'était autant de mégaoctets matérialisés en mémoire à chaque envoi, sur une instance
 * unique qui sert aussi les réponses de présence du soir. Et rien ne bornait le nombre d'envois.
 *
 * Les dépôts d'images du projet, eux, testent `fichier.size` **avant** `arrayBuffer()`
 * (`src/actions/evenements.ts`). Ce fichier vérifie que l'import fait pareil, et qu'il porte un
 * limiteur comme les autres dépôts.
 */

const faux = vi.hoisted(() => ({
  crees: [] as Record<string, unknown>[],
  audits: [] as string[],
  /** Chaque lecture d'octets est notée : c'est elle qui ne doit PAS avoir lieu. */
  lectures: 0,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.crees.push(data);
        return { id: `u-${faux.crees.length}`, ...data };
      }),
    },
    period: { findUnique: vi.fn(async () => null) },
    periodMember: { upsert: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/lib/couleurs-attribution", () => ({ prochaineCouleurLibre: vi.fn(async () => 1) }));
vi.mock("@/lib/invitations", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/invitations")>("@/lib/invitations");
  return { ...vrai, envoyerInvitation: vi.fn(async () => true) };
});
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string) => {
    faux.audits.push(action);
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `members.create` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  assertPermission: vi.fn(async () => ({ id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true })),
  exigerReauth: vi.fn(async () => {}),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { importerMembres } = await import("@/actions/membres");
const { RATE_LIMITS, utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");

/** Un fichier dont on saurait dire si ses octets ont été lus. */
function fichier(octets: number): File {
  const f = new File(["p;n;a@b.fr;MEMBRE\n".repeat(Math.max(1, Math.ceil(octets / 18)))], "membres.csv", { type: "text/csv" });
  // `File.size` est en lecture seule : on le redéfinit pour simuler un gros fichier sans en fabriquer un.
  Object.defineProperty(f, "size", { value: octets });
  const vraiBuffer = f.arrayBuffer.bind(f);
  Object.defineProperty(f, "arrayBuffer", {
    value: async () => {
      faux.lectures++;
      return vraiBuffer();
    },
  });
  return f;
}

function formulaire(f: File | null, texte = ""): FormData {
  const fd = new FormData();
  if (f) fd.append("fichier", f);
  fd.append("texte", texte);
  return fd;
}

beforeEach(() => {
  utiliserMagasinMemoire();
  faux.crees = [];
  faux.audits = [];
  faux.lectures = 0;
});

describe("plafond de taille d'un import", () => {
  it("refuse un fichier trop gros SANS lire ses octets", async () => {
    const res = await importerMembres({}, formulaire(fichier(2 * 1024 * 1024)));
    expect(res.erreur).toContain("trop gros");
    expect(faux.lectures, "le refus doit tomber avant arrayBuffer(), sinon il ne refuse rien").toBe(0);
    expect(faux.crees).toEqual([]);
    // Rien n'est allé jusqu'au journal : il n'y a pas eu d'import
    expect(faux.audits).toEqual([]);
  });

  it("laisse passer un annuaire ordinaire : 500 lignes pèsent quelques dizaines de ko", async () => {
    const lignes = Array.from({ length: 20 }, (_, i) => `Prenom${i};Nom${i};membre${i}@club.test;MEMBRE`).join("\n");
    const f = new File([lignes], "membres.csv", { type: "text/csv" });
    const res = await importerMembres({}, formulaire(f));
    expect(res.erreur).toBeUndefined();
    expect(faux.crees).toHaveLength(20);
  });

  it("borne aussi la zone de texte collée : c'est le même découpage derrière", async () => {
    const res = await importerMembres({}, formulaire(null, "x;y;z@b.fr;MEMBRE\n".repeat(40_000)));
    expect(res.erreur).toContain("trop gros");
    expect(faux.crees).toEqual([]);
  });
});

describe("limiteur d'imports", () => {
  it("coupe au-delà du quota, comme les autres dépôts", async () => {
    const { max } = RATE_LIMITS.import_csv_user;
    const lignes = "Prenom;Nom;un@club.test;MEMBRE";
    for (let i = 0; i < max; i++) {
      const res = await importerMembres({}, formulaire(null, lignes));
      expect(res.erreur).toBeUndefined();
    }
    const refus = await importerMembres({}, formulaire(null, lignes));
    expect(refus.erreur).toContain("Trop d'imports");
  });

  it("compte par personne, et avant toute lecture de fichier", async () => {
    const { max } = RATE_LIMITS.import_csv_user;
    for (let i = 0; i < max; i++) await importerMembres({}, formulaire(null, "Prenom;Nom;un@club.test;MEMBRE"));
    faux.lectures = 0;
    const refus = await importerMembres({}, formulaire(fichier(1000)));
    expect(refus.erreur).toContain("Trop d'imports");
    expect(faux.lectures).toBe(0);
  });
});
