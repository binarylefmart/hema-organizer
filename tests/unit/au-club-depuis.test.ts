import { beforeEach, describe, expect, it, vi } from "vitest";
import { dateDepuisSaison, anneeDeSaison, saisonEnregistree } from "@/lib/blasons";
import { membreSchema } from "@/lib/validation/gestion";

/**
 * **« Au club depuis » — la date d'adhésion saisie par le bureau**.
 *
 * Les rangs se gagnent à l'ancienneté depuis ce matin, mais elle se comptait sur la création du
 * **compte** : le club existant bien avant l'application, l'écran affichait douze « Recrue », dont
 * des gens qui tirent depuis huit ans. Le bureau choisit désormais la **saison d'arrivée** dans la
 * fiche du membre (« 2023-2024 »), rangée en **date** (son 1er septembre) pour que l'ancienneté
 * grandisse toute seule.
 *
 * Ce fichier éprouve les deux garde-fous de la saisie (bornes, effacement) et le fait que le
 * changement soit **journalisé** comme le reste de la fiche.
 */

const faux = vi.hoisted(() => ({
  cible: null as Record<string, unknown> | null,
  misAJour: [] as Array<{ data: Record<string, unknown> }>,
  journal: [] as Array<{ action: string; cible: unknown; details: unknown }>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUniqueOrThrow: vi.fn(async () => faux.cible),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        faux.misAJour.push(args);
        return faux.cible;
      }),
    },
  },
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, cible: unknown, details: unknown) => {
    faux.journal.push({ action, cible, details });
  }),
}));
vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0) }));
vi.mock("@/lib/auth/current-user", () => ({
  // Rôle de base + `estAdmin` : « ADMIN » n'est plus une valeur de `role`. INSTRUCTEUR exprès —
  // `members.manage` n'est ouverte à aucun instructeur, donc rien ici ne tient au rôle.
  assertPermission: vi.fn(async () => ({ id: "a", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true })),
  exigerReauth: vi.fn(async () => {}),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { modifierMembre } = await import("@/actions/membres");

const MEMBRE = {
  id: "m",
  prenom: "Chloé",
  nom: "Dubois",
  email: "chloe@exemple.fr",
  role: "MEMBRE",
  actif: true,
  service: false,
  auClubDepuis: null as Date | null,
  createdAt: new Date("2026-01-22T10:00:00Z"),
};

/** La fiche telle que le formulaire l'envoie : identité, rôle, et la saison d'arrivée (année de sa rentrée). */
function fiche(saison: string) {
  const fd = new FormData();
  fd.set("prenom", "Chloé");
  fd.set("nom", "Dubois");
  fd.set("email", "chloe@exemple.fr");
  fd.set("role", "MEMBRE");
  fd.set("saisonArrivee", saison);
  return fd;
}

const COURANTE = anneeDeSaison(new Date());

describe("le schéma de la fiche : la saison devient une date", () => {
  const champs = { prenom: "Chloé", nom: "Dubois", email: "chloe@exemple.fr", role: "MEMBRE" };

  it("range le 1er septembre de la saison choisie, et se relit en la même saison", () => {
    const parsed = membreSchema.parse({ ...champs, saisonArrivee: String(COURANTE - 2) });
    const date = parsed.auClubDepuis!;
    expect(date.toISOString()).toBe(`${COURANTE - 2}-09-01T00:00:00.000Z`);
    // Le défaut corrigé : ce qu'on choisit est exactement ce qu'on relit.
    expect(saisonEnregistree(date)).toBe(COURANTE - 2);
    expect(Object.keys(parsed).sort()).toEqual(["auClubDepuis", "email", "nom", "prenom", "role"]);
  });

  it("efface la date pour « Je ne sais pas » (vide) ou un champ absent", () => {
    expect(membreSchema.parse({ ...champs, saisonArrivee: "" }).auClubDepuis).toBeNull();
    expect(membreSchema.parse(champs).auClubDepuis).toBeNull();
  });

  it("refuse une saison à venir, trop ancienne ou qui n'est pas une année", () => {
    for (const saison of [String(COURANTE + 1), "1900", "deux", "2024.5"]) {
      const parsed = membreSchema.safeParse({ ...champs, saisonArrivee: saison });
      expect(parsed.success, saison).toBe(false);
      const chemins = parsed.success ? [] : parsed.error.issues.map((i) => i.path[0]);
      expect(chemins).toContain("saisonArrivee");
    }
  });

  it("ne peut jamais poser une date d'adhésion dans le futur", () => {
    const date = membreSchema.parse({ ...champs, saisonArrivee: String(COURANTE) }).auClubDepuis!;
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("l'enregistrement de la fiche", () => {
  beforeEach(() => {
    faux.cible = { ...MEMBRE };
    faux.misAJour = [];
    faux.journal = [];
  });

  it("enregistre le 1er septembre de la saison choisie", async () => {
    const res = await modifierMembre("m", {}, fiche(String(COURANTE - 3)));
    expect(res.succes).toBeTruthy();
    expect(faux.misAJour).toHaveLength(1);
    expect(faux.misAJour[0].data.auClubDepuis).toEqual(dateDepuisSaison(COURANTE - 3));
  });

  it("efface la date avec « Je ne sais pas » : l'ancienneté repart de la création du compte", async () => {
    faux.cible = { ...MEMBRE, auClubDepuis: new Date("2020-09-01T00:00:00Z") };
    await modifierMembre("m", {}, fiche(""));
    expect(faux.misAJour[0].data.auClubDepuis).toBeNull();
  });

  it("refuse une saison hors liste sans rien enregistrer", async () => {
    const res = await modifierMembre("m", {}, fiche(String(COURANTE + 1)));
    expect(res.erreurs?.saisonArrivee).toBeTruthy();
    expect(faux.misAJour).toEqual([]);
    expect(faux.journal).toEqual([]);
  });

  it("journalise le changement comme le reste de la fiche", async () => {
    await modifierMembre("m", {}, fiche(String(COURANTE - 1)));
    expect(faux.journal).toHaveLength(1);
    expect(faux.journal[0].action).toBe("membre.modifie");
    const details = faux.journal[0].details as { auClubDepuis: Date | null };
    expect(details.auClubDepuis).toEqual(dateDepuisSaison(COURANTE - 1));
  });
});
