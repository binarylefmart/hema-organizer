import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Les thèmes d'échauffement** (avenant 4) : une seconde liste à côté des « Thèmes de
 * cours et options » (la clé `themes` d'avant, valeurs du club gardées).
 *
 * Ce fichier verrouille :
 * - **le défaut propre aux échauffements** (`THEMES_ECHAUFFEMENT_DU_CLUB`, publié aussi dans le dépôt
 *   public) : réglage jamais enregistré, abîmé ou d'un autre type → cette liste-là, jamais les thèmes de
 *   cours par-dessus (une case d'échauffement qui proposerait « Épée longue » se tromperait sans rien dire) ;
 * - **l'action jumelle** : même porte (`themes.manage`), même nettoyage (`nettoyerThemes`), son
 *   propre geste au journal, sa propre clé — et elle ne touche pas à la liste des cours ;
 * - **la liste vide acceptée** ici, quand celle des cours la refuse toujours.
 */
const faux = vi.hoisted(() => ({
  reglages: new Map<string, string>(),
  permissions: [] as string[],
  audits: [] as Array<{ action: string; details: unknown }>,
  refuser: false,
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings", async (original) => ({
  ...(await original<typeof import("@/lib/settings")>()),
  getSetting: vi.fn(async (cle: string) => faux.reglages.get(cle) ?? null),
  setSetting: vi.fn(async (cle: string, valeur: string | null) => {
    if (valeur === null) faux.reglages.delete(cle);
    else faux.reglages.set(cle, valeur);
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({
  assertPermission: vi.fn(async (p: string) => {
    faux.permissions.push(p);
    if (faux.refuser) throw new Error("Accès refusé");
    return { id: "u-admin", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  }),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_u: unknown, action: string, _cible: string | null, details: unknown) => {
    faux.audits.push({ action, details });
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/notifications/ateliers", () => ({ notifierDecisionAtelier: vi.fn(async () => true) }));

const { getThemesEchauffement, getThemes } = await import("@/lib/planning");
const { CLES } = await import("@/lib/settings");
const { THEMES_DU_CLUB, THEMES_ECHAUFFEMENT_DU_CLUB } = await import("@/lib/themes-club");
const { enregistrerThemesEchauffement, enregistrerThemes } = await import("@/actions/planning");
const { revalidatePath } = await import("next/cache");

const formulaire = (texte: string) => {
  const fd = new FormData();
  fd.set("texte", texte);
  return fd;
};

beforeEach(() => {
  faux.reglages.clear();
  faux.permissions = [];
  faux.audits = [];
  faux.refuser = false;
  vi.mocked(revalidatePath).mockClear();
});

describe("getThemesEchauffement — son propre défaut", () => {
  it("réglage jamais enregistré : la liste d'échauffement du club, pas les thèmes de cours", async () => {
    expect(CLES.themesEchauffement).toBe("themesEchauffement");
    expect(await getThemesEchauffement()).toEqual([...THEMES_ECHAUFFEMENT_DU_CLUB]);
    expect(THEMES_ECHAUFFEMENT_DU_CLUB.some((t) => THEMES_DU_CLUB.includes(t))).toBe(false);
    // La liste des cours, elle, garde son défaut du club : les deux réglages sont indépendants.
    expect(await getThemes()).toEqual([...THEMES_DU_CLUB]);
  });

  it("réglage abîmé ou d'un autre type : la liste par défaut", async () => {
    faux.reglages.set(CLES.themesEchauffement, "{pas du json");
    expect(await getThemesEchauffement()).toEqual([...THEMES_ECHAUFFEMENT_DU_CLUB]);
    faux.reglages.set(CLES.themesEchauffement, JSON.stringify([1, 2]));
    expect(await getThemesEchauffement()).toEqual([...THEMES_ECHAUFFEMENT_DU_CLUB]);
  });

  it("réglage enregistré : relu tel quel, ordre compris", async () => {
    faux.reglages.set(CLES.themesEchauffement, JSON.stringify(["Mobilité", "Jeu de jambes"]));
    expect(await getThemesEchauffement()).toEqual(["Mobilité", "Jeu de jambes"]);
  });
});

describe("enregistrerThemesEchauffement — jumelle d'enregistrerThemes", () => {
  it("passe par themes.manage et ne fait rien si la porte refuse", async () => {
    faux.refuser = true;
    await expect(enregistrerThemesEchauffement({}, formulaire("Mobilité"))).rejects.toThrow();
    expect(faux.permissions).toEqual(["themes.manage"]);
    expect(faux.reglages.has(CLES.themesEchauffement)).toBe(false);
    expect(faux.audits).toEqual([]);
  });

  it("nettoie comme les thèmes de cours : coupe, dédoublonne sans casse, ignore les vides", async () => {
    const r = await enregistrerThemesEchauffement({}, formulaire("  Mobilité \n\nmobilité\nJeu de jambes, Gainage\n"));
    expect(r.erreur).toBeUndefined();
    expect(JSON.parse(faux.reglages.get(CLES.themesEchauffement)!)).toEqual(["Mobilité", "Jeu de jambes", "Gainage"]);
    expect(faux.audits).toEqual([{ action: "themes_echauffement.modifies", details: { nombre: 3 } }]);
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toContain("/admin/themes");
    expect(r.succes).toContain("3 thèmes d'échauffement");
  });

  it("n'écrit pas dans la liste des cours et options", async () => {
    faux.reglages.set(CLES.themes, JSON.stringify(["Messer"]));
    await enregistrerThemesEchauffement({}, formulaire("Mobilité"));
    expect(JSON.parse(faux.reglages.get(CLES.themes)!)).toEqual(["Messer"]);
  });

  it("accepte la liste vide (état de départ), quand celle des cours la refuse", async () => {
    faux.reglages.set(CLES.themesEchauffement, JSON.stringify(["Mobilité"]));
    const r = await enregistrerThemesEchauffement({}, formulaire("  \n"));
    expect(r.erreur).toBeUndefined();
    expect(faux.reglages.get(CLES.themesEchauffement)).toBe("[]");
    expect(await getThemesEchauffement()).toEqual([]);

    const cours = await enregistrerThemes({}, formulaire("  \n"));
    expect(cours.erreur).toBeDefined();
  });

  it("refuse une saisie trop longue avant d'écrire", async () => {
    const r = await enregistrerThemesEchauffement({}, formulaire("x".repeat(4001)));
    expect(r.erreur).toBeDefined();
    expect(faux.reglages.has(CLES.themesEchauffement)).toBe(false);
  });
});
