import { beforeEach, describe, expect, it, vi } from "vitest";
import { dateDepuisDuree, debutDeSaison, dureeDepuisDate, moisDepuis } from "@/lib/blasons";
import { membreSchema } from "@/lib/validation/gestion";

/**
 * **« Au club depuis » — la date d'adhésion saisie par le bureau**.
 *
 * Les rangs se gagnent à l'ancienneté depuis ce matin, mais elle se comptait sur la création du
 * **compte** : le club existant bien avant l'application, l'écran affichait douze « Recrue », dont
 * des gens qui tirent depuis huit ans. Le bureau saisit désormais une ancienneté dans la fiche du
 * membre — en **durée** (« depuis deux ans »), parce que personne n'a noté le jour d'arrivée de
 * personne, et rangée en **date**, parce qu'une durée figée vieillirait mal.
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

/** La fiche telle que le formulaire l'envoie : identité, rôle, et les deux nombres de la durée. */
function fiche(annees: string, mois: string) {
  const fd = new FormData();
  fd.set("prenom", "Chloé");
  fd.set("nom", "Dubois");
  fd.set("email", "chloe@exemple.fr");
  fd.set("role", "MEMBRE");
  fd.set("anneesAuClub", annees);
  fd.set("moisAuClub", mois);
  return fd;
}

describe("le schéma de la fiche : la durée devient une date", () => {
  const champs = { prenom: "Chloé", nom: "Dubois", email: "chloe@exemple.fr", role: "MEMBRE" };

  it("convertit années et mois en date d'adhésion, toujours posée sur une rentrée", () => {
    const parsed = membreSchema.parse({ ...champs, anneesAuClub: "2", moisAuClub: "6" });
    const date = parsed.auClubDepuis!;
    expect(date).toBeInstanceOf(Date);
    // **Ce qu'on range est toujours un 1er septembre**, celui de la saison où l'on tombe : le club
    // compte en saisons, et tout le monde prend son année à la rentrée.
    expect(date.getUTCMonth()).toBe(8);
    expect(date.getUTCDate()).toBe(1);
    expect(debutDeSaison(date)).toEqual(date);
    // Trente mois en arrière : au moins deux rentrées derrière soi, jamais une de moins que saisi.
    expect(moisDepuis(date)).toBeGreaterThanOrEqual(30);
    // Réenregistrer ce que le formulaire relit ne déplace pas la saison (l'arrondi est stable).
    const relu = dureeDepuisDate(date)!;
    expect(dateDepuisDuree(relu.annees, relu.mois)).toEqual(date);
    // Et la fiche ressort avec les seules colonnes de `User` : les deux nombres n'existent plus.
    expect(Object.keys(parsed).sort()).toEqual(["auClubDepuis", "email", "nom", "prenom", "role"]);
  });

  it("efface la date quand les deux cases sont vides ou à zéro : « je ne sais pas »", () => {
    expect(membreSchema.parse({ ...champs, anneesAuClub: "", moisAuClub: "" }).auClubDepuis).toBeNull();
    expect(membreSchema.parse({ ...champs, anneesAuClub: "0", moisAuClub: "0" }).auClubDepuis).toBeNull();
    // Champs absents du formulaire (création d'un membre) : rien de saisi, donc rien d'enregistré.
    expect(membreSchema.parse(champs).auClubDepuis).toBeNull();
  });

  it("refuse une durée négative, hors bornes ou qui n'est pas un nombre", () => {
    for (const [annees, mois] of [
      ["-1", "0"],
      ["0", "-6"],
      ["41", "0"],
      ["0", "12"],
      ["deux", "0"],
      ["1,5", "0"],
    ]) {
      const parsed = membreSchema.safeParse({ ...champs, anneesAuClub: annees, moisAuClub: mois });
      expect(parsed.success).toBe(false);
      // L'erreur est rattachée au champ fautif : le formulaire la montre sous la bonne case.
      const chemins = parsed.success ? [] : parsed.error.issues.map((i) => i.path[0]);
      expect(chemins.some((c) => c === "anneesAuClub" || c === "moisAuClub")).toBe(true);
    }
  });

  /**
   * Une adhésion à venir n'aurait aucun sens, et donnerait zéro mois d'ancienneté à quelqu'un qui
   * est peut-être là depuis des années. Une durée étant un **recul** dans le temps, le futur est
   * impossible par construction — ce test tient cette promesse au cas où la conversion changerait.
   */
  it("ne peut jamais poser une date d'adhésion dans le futur", () => {
    for (const [annees, mois] of [
      ["0", "0"],
      ["0", "1"],
      ["1", "0"],
      ["40", "11"],
    ]) {
      const date = membreSchema.parse({ ...champs, anneesAuClub: annees, moisAuClub: mois }).auClubDepuis;
      if (date) expect(date.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
});

describe("l'enregistrement de la fiche", () => {
  beforeEach(() => {
    faux.cible = { ...MEMBRE };
    faux.misAJour = [];
    faux.journal = [];
  });

  it("enregistre la date d'adhésion déduite de la durée saisie", async () => {
    const res = await modifierMembre("m", {}, fiche("3", "0"));
    expect(res.succes).toBeTruthy();
    expect(faux.misAJour).toHaveLength(1);
    const enregistre = faux.misAJour[0].data.auClubDepuis as Date;
    expect(enregistre).toEqual(dateDepuisDuree(3, 0));
    expect(enregistre.getUTCMonth()).toBe(8);
    expect(enregistre.getUTCDate()).toBe(1);
  });

  it("efface la date quand la durée est remise à zéro : l'ancienneté repart de la création du compte", async () => {
    faux.cible = { ...MEMBRE, auClubDepuis: new Date("2020-09-01T00:00:00Z") };
    await modifierMembre("m", {}, fiche("", ""));
    expect(faux.misAJour[0].data.auClubDepuis).toBeNull();
  });

  it("refuse une durée hors bornes sans rien enregistrer", async () => {
    const res = await modifierMembre("m", {}, fiche("41", "0"));
    expect(res.erreurs?.anneesAuClub).toBeTruthy();
    expect(faux.misAJour).toEqual([]);
    expect(faux.journal).toEqual([]);
  });

  it("journalise le changement comme le reste de la fiche", async () => {
    await modifierMembre("m", {}, fiche("2", "6"));
    expect(faux.journal).toHaveLength(1);
    expect(faux.journal[0].action).toBe("membre.modifie");
    expect(faux.journal[0].cible).toBe("m");
    const details = faux.journal[0].details as { auClubDepuis: Date | null };
    expect(details.auClubDepuis).toEqual(dateDepuisDuree(2, 6));
  });
});
