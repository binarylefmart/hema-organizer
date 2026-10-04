import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Un CSV exporté par Excel FR ne doit plus abîmer les noms, ni rien perdre en silence.**
 *
 * Deux défauts tenaient dans deux lignes de `importerMembres` :
 *
 * 1. `File.text()` décode **toujours** en UTF-8. Or « CSV séparateur point-virgule », le format que
 *    propose Excel sur un poste Windows français — donc celui qu'un bureau d'association utilise —,
 *    s'écrit en **Windows-1252** : « 04 » entrait en base en « Lefran<?>ois », sans un mot.
 * 2. `.slice(0, 500)` jetait tout ce qui dépassait : 620 lignes donnaient « 500 membres importés »
 *    et 120 personnes manquaient à l'appel, sans une ligne pour le dire.
 */

const faux = vi.hoisted(() => ({
  crees: [] as { prenom: string; nom: string; email: string | null }[],
  audits: [] as { action: string; details: Record<string, unknown> }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { prenom: string; nom: string; email: string | null } }) => {
        faux.crees.push({ prenom: data.prenom, nom: data.nom, email: data.email });
        return { id: `u-${faux.crees.length}` };
      }),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, _cible: unknown, details: Record<string, unknown>) => {
    faux.audits.push({ action, details });
  }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `members.create` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  assertPermission: vi.fn(async () => ({ id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true })),
  exigerReauth: vi.fn(async () => {}),
  getCurrentUser: vi.fn(async () => ({ id: "u-admin", role: "INSTRUCTEUR", estAdmin: true })),
}));

vi.mock("@/lib/couleurs-attribution", () => ({ prochaineCouleurLibre: vi.fn(async () => "#123456") }));

const { importerMembres } = await import("@/actions/membres");

/** Ce que dépose un tableur : des octets, dans l'encodage qu'il a choisi. */
function fichier(texte: string, encodage: "utf-8" | "windows-1252"): File {
  const octets = encodage === "utf-8" ? new TextEncoder().encode(texte) : Uint8Array.from(Buffer.from(texte, "latin1"));
  return new File([octets], "membres.csv", { type: "text/csv" });
}

function formulaire(f: File | null, texte = ""): FormData {
  const fd = new FormData();
  if (f) fd.set("fichier", f);
  fd.set("texte", texte);
  return fd;
}

const EN_TETE = "Prénom;Nom;Email;Rôle";

beforeEach(() => {
  faux.crees.length = 0;
  faux.audits.length = 0;
});

describe("import CSV : l'encodage du tableur", () => {
  it("rétablit les accents d'un fichier Windows-1252 (Excel FR) et le dit", async () => {
    const csv = `${EN_TETE}\nDelta;04;delta@club.test;MEMBRE\nChloé;Noël;chloe@club.test;MEMBRE`;
    const etat = await importerMembres({}, formulaire(fichier(csv, "windows-1252")));

    expect(faux.crees).toEqual([
      { prenom: "Delta", nom: "04", email: "delta@club.test" },
      { prenom: "Chloé", nom: "Noël", email: "chloe@club.test" },
    ]);
    // Aucun « � » n'est entré en base…
    expect(faux.crees.some((c) => `${c.prenom}${c.nom}`.includes("�"))).toBe(false);
    // …et le rattrapage est annoncé, parce qu'un fichier mal étiqueté reste à réenregistrer.
    expect(etat.ignores?.some((l) => l.includes("UTF-8"))).toBe(true);
    expect(faux.audits[0]?.details.encodage).toBe("windows-1252");
  });

  it("lit un fichier UTF-8 sans rien annoncer", async () => {
    const csv = `${EN_TETE}\nDelta;04;delta@club.test;MEMBRE`;
    const etat = await importerMembres({}, formulaire(fichier(csv, "utf-8")));

    expect(faux.crees).toEqual([{ prenom: "Delta", nom: "04", email: "delta@club.test" }]);
    expect(etat.ignores).toEqual([]);
    expect(faux.audits[0]?.details.encodage).toBe("utf-8");
  });

  it("garde la préférence pour le texte collé quand aucun fichier n'est choisi", async () => {
    const etat = await importerMembres({}, formulaire(new File([], ""), "Hotel;10;hotel@club.test;MEMBRE"));
    expect(etat.importes).toBe(1);
    expect(faux.crees[0]?.nom).toBe("10");
  });
});

describe("import CSV : ce qui dépasse le plafond", () => {
  /** Un fichier de `n` membres, en-tête comprise. */
  const gros = (n: number) => [EN_TETE, ...Array.from({ length: n }, (_, i) => `Membre${i};Nom${i};membre${i}@club.test;MEMBRE`)].join("\n");

  it("annonce les lignes laissées de côté au lieu de les avaler", async () => {
    const etat = await importerMembres({}, formulaire(fichier(gros(620), "utf-8")));

    expect(etat.importes).toBe(500);
    const laissees = etat.ignores?.find((l) => l.includes("500"));
    expect(laissees).toBeDefined();
    // Le compte y est, et la marche à suivre avec.
    expect(laissees).toContain("120");
    expect(laissees).toContain("relance l'import");
    expect(faux.audits[0]?.details).toMatchObject({ lignesRecues: 620, lignesLues: 500 });
  });

  it("ne dit rien quand tout tient dans un envoi", async () => {
    const etat = await importerMembres({}, formulaire(fichier(gros(3), "utf-8")));
    expect(etat.importes).toBe(3);
    expect(etat.ignores).toEqual([]);
  });
});
