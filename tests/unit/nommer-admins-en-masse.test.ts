import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Nommer plusieurs administrateurs d'un coup**.
 *
 * C'est le geste le plus sensible de l'application : il donne les pleins pouvoirs techniques. Ce
 * fichier protège donc d'abord **les verrous**, parce qu'un second chemin d'écriture les relâche
 * facilement — « deux chemins d'écriture aux règles différentes, c'est une porte dérobée d'un côté ou
 * une fonctionnalité morte de l'autre » (CLAUDE.md) :
 *
 * - **exactement les gardes du geste unitaire** (`nommerAdministrateur`, `src/actions/membres.ts`) :
 *   permission `admins.manage`, déjà administrateur refusé (c'est aussi ce qui empêche de se nommer
 *   soi-même), compte désactivé refusé, `canEditUser`, compte du portail intouchable ;
 * - **`exigerReauth` est bien appelé**, après les refus et avant l'écriture, avec `/admin/comptes`
 *   pour suite : on ne renvoie personne chercher six chiffres pour un lot voué à être refusé ;
 * - **tout ou rien** : une seule personne interdite refuse le lot entier, et le message la nomme ;
 * - **une entrée d'audit par personne**, portant la **même action** que le geste unitaire — c'est un
 *   seul filtre du journal qui doit retrouver « qui a reçu les clés, et quand ».
 */

/* `estAdmin` dit du bureau ; `role` reste le rôle de base, que la nomination ne touche pas. */
type Compte = { id: string; prenom: string; nom: string; email: string | null; role: string; estAdmin: boolean; actif: boolean; service: boolean };

const faux = vi.hoisted(() => ({
  acteur: { id: "u-admin", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true },
  comptes: [] as Compte[],
  /** Chaque lot passé à `$transaction`, pour vérifier qu'il n'y en a qu'un */
  transactions: [] as string[][],
  ecritures: [] as { id: string; estAdmin: boolean }[],
  audits: [] as { action: string; cible: string | null; details: unknown }[],
  reauths: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(async ({ where, orderBy }: { where?: { id?: { in?: string[] } }; orderBy?: Record<string, "asc" | "desc">[] }) => {
        const ids = where?.id?.in ?? [];
        const trouves = faux.comptes.filter((c) => ids.includes(c.id));
        // Le tri est appliqué pour de vrai : sinon aucun test ne distinguerait « l'action a trié » de
        // « l'ordre de `faux.comptes` est tombé juste ».
        for (const critere of [...(orderBy ?? [])].reverse()) {
          for (const [champ, sens] of Object.entries(critere)) {
            trouves.sort((a, b) => {
              const cmp = String(a[champ as keyof Compte]).localeCompare(String(b[champ as keyof Compte]), "fr");
              return sens === "desc" ? -cmp : cmp;
            });
          }
        }
        return trouves;
      }),
      // Ce qui est écrit est **relevé tel quel** : un `role` qui reviendrait ici serait une
      // rétrogradation silencieuse, et le test ci-dessous le verrait.
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        faux.ecritures.push({ id: where.id, ...(data as { estAdmin: boolean }) });
        return { id: where.id };
      }),
    },
    $transaction: vi.fn(async (operations: Promise<{ id: string }>[]) => {
      const resultats = await Promise.all(operations);
      faux.transactions.push(resultats.map((r) => r.id));
      return resultats;
    }),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

// La matrice réelle des permissions tranche : l'acteur simulé change simplement de rôle.
vi.mock("@/lib/auth/current-user", async () => {
  const { can } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof can>[1]) => {
      if (!can(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async (_u: unknown, suite: string) => {
      faux.reauths.push(suite);
    }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { nommerAdministrateurs } = await import("@/app/(app)/admin/comptes/actions");
const { cherchable, coches, filtrerCandidats, libelleBouton, texteConfirmation, texteHorsRecherche } = await import(
  "@/app/(app)/admin/comptes/selection-nomination"
);

const compte = (id: string, options: Partial<Compte> = {}): Compte => ({
  id,
  prenom: id.toUpperCase(),
  nom: "Test",
  email: `${id}@club.test`,
  role: "MEMBRE",
  estAdmin: false,
  actif: true,
  service: false,
  ...options,
});

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true };
  faux.comptes = [];
  faux.transactions = [];
  faux.ecritures = [];
  faux.audits = [];
  faux.reauths = [];
});

describe("nommer plusieurs administrateurs d'un coup", () => {
  it("ajoute le bureau à tout le lot, sans toucher aux rôles de base, en une seule transaction", async () => {
    faux.comptes = [compte("a"), compte("b"), compte("c", { role: "INSTRUCTEUR" })];
    const res = await nommerAdministrateurs({ userIds: ["a", "b", "c"] });
    expect(res.erreur).toBeUndefined();
    expect(faux.transactions).toHaveLength(1);
    expect(faux.transactions[0]).toEqual(["a", "b", "c"]);
    // **`estAdmin` et rien d'autre** : l'instructeur du lot reste instructeur, ce qui est toute la
    // raison d'être du supplément. `role: "ADMIN"` le lui retirait, et ne donnait plus aucun droit.
    expect(faux.ecritures).toEqual([
      { id: "a", estAdmin: true },
      { id: "b", estAdmin: true },
      { id: "c", estAdmin: true },
    ]);
  });

  it("journalise personne par personne, sous l'action du geste unitaire", async () => {
    faux.comptes = [compte("a"), compte("b", { role: "INSTRUCTEUR" })];
    await nommerAdministrateurs({ userIds: ["a", "b"] });
    expect(faux.audits).toEqual([
      { action: "admin.droits_donnes", cible: "a", details: { email: "a@club.test", roleDeBase: "MEMBRE", enMasse: true } },
      { action: "admin.droits_donnes", cible: "b", details: { email: "b@club.test", roleDeBase: "INSTRUCTEUR", enMasse: true } },
    ]);
  });

  it("redemande le code récent avant d'écrire, et ramène à l'écran du clic", async () => {
    faux.comptes = [compte("a")];
    await nommerAdministrateurs({ userIds: ["a"] });
    expect(faux.reauths).toEqual(["/admin/comptes"]);
  });

  it("exige la permission des comptes admin : un instructeur est refusé", async () => {
    faux.acteur = { id: "u-i", email: "i@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    faux.comptes = [compte("a")];
    await expect(nommerAdministrateurs({ userIds: ["a"] })).rejects.toThrow("Accès refusé");
    expect(faux.ecritures).toEqual([]);
  });
});

describe("le lot entier est refusé plutôt qu'écrit à moitié", () => {
  const rienEcrit = () => {
    expect(faux.ecritures).toEqual([]);
    expect(faux.transactions).toEqual([]);
    expect(faux.audits).toEqual([]);
    // Et surtout : personne n'a été envoyé recopier six chiffres pour un geste voué à être refusé.
    expect(faux.reauths).toEqual([]);
  };

  it("refuse le lot si quelqu'un est déjà administrateur, en le nommant", async () => {
    faux.comptes = [compte("a"), compte("deja", { prenom: "Chloé", nom: "Durand", estAdmin: true })];
    const res = await nommerAdministrateurs({ userIds: ["a", "deja"] });
    expect(res.erreur).toContain("le lot entier est refusé");
    expect(res.erreur).toContain("Chloé Durand est déjà administrateur");
    rienEcrit();
  });

  it("refuse le lot si quelqu'un est désactivé", async () => {
    faux.comptes = [compte("a"), compte("off", { prenom: "Léa", nom: "P.", actif: false })];
    const res = await nommerAdministrateurs({ userIds: ["a", "off"] });
    expect(res.erreur).toMatch(/Léa P\..*désactivé/);
    rienEcrit();
  });

  it("refuse le lot si le compte du portail s'y trouve", async () => {
    // Il est administrateur à demeure : le refus le nomme comme tel plutôt que par ricochet.
    // `estAdmin: false` sur un compte de service est un état impossible en vrai : c'est ce qui rend
    // le verrou nommé observable, au lieu de le laisser couvert par le refus « déjà administrateur ».
    faux.comptes = [compte("a"), compte("portail", { prenom: "Bureau", nom: "HEMA", service: true })];
    const res = await nommerAdministrateurs({ userIds: ["a", "portail"] });
    expect(res.erreur).toContain("portail");
    rienEcrit();
  });

  it("refuse le lot si un compte a quitté l'annuaire depuis l'affichage", async () => {
    faux.comptes = [compte("a")];
    const res = await nommerAdministrateurs({ userIds: ["a", "disparu"] });
    expect(res.erreur).toContain("introuvable");
    rienEcrit();
  });

  it("refuse une sélection vide ou démesurée sans rien dire de plus", async () => {
    expect((await nommerAdministrateurs({ userIds: [] })).erreur).toContain("Sélection invalide");
    expect((await nommerAdministrateurs({ userIds: Array.from({ length: 501 }, (_, i) => `u${i}`) })).erreur).toContain("Sélection invalide");
    rienEcrit();
  });
});

describe("nommer une seule personne reste le geste d'avant", () => {
  it("rend mot pour mot la phrase du geste unitaire", async () => {
    faux.comptes = [compte("a", { prenom: "Chloé", nom: "Durand" })];
    const res = await nommerAdministrateurs({ userIds: ["a"] });
    expect(res.succes).toBe(
      "Chloé Durand est administrateur. Mot de passe et double authentification lui seront demandés avant que l'administration s'ouvre.",
    );
  });

  it("laisse dans le journal l'entrée qu'il y laissait avant, sans mention de masse", async () => {
    faux.comptes = [compte("a")];
    await nommerAdministrateurs({ userIds: ["a"] });
    expect(faux.audits).toEqual([{ action: "admin.droits_donnes", cible: "a", details: { email: "a@club.test", roleDeBase: "MEMBRE" } }]);
  });

  it("n'ouvre pas de boîte de confirmation : une case, un bouton", () => {
    const composant = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/admin/comptes/SelectionNomination.tsx"), "utf8");
    expect(composant).toContain("lot.length > 1 && !window.confirm(texteConfirmation(lot))");
  });
});

describe("ce que la carte annonce avant d'écrire", () => {
  const gens = [
    { id: "a", prenom: "Chloé", nom: "Durand", email: "chloe@exemple.fr" },
    { id: "b", prenom: "Léa", nom: "Péron", email: null },
    { id: "c", prenom: "Foxtrot", nom: "Marchand", email: "nico@exemple.fr" },
  ];

  it("la confirmation dit le nombre, les noms, et ce que le rôle emporte", () => {
    const texte = texteConfirmation(gens);
    expect(texte).toContain("3 personnes");
    for (const g of gens) expect(texte).toContain(`${g.prenom} ${g.nom}`);
    expect(texte).toContain("nommer d'autres administrateurs");
  });

  it("au-delà de cinq noms, elle donne le nombre plutôt qu'une liste illisible", () => {
    const lot = Array.from({ length: 9 }, (_, i) => ({ id: `u${i}`, prenom: `P${i}`, nom: "T", email: null }));
    expect(texteConfirmation(lot)).toContain("9 personnes (les noms sont dans la liste cochée)");
  });

  it("le lot part dans l'ordre de la liste, jamais dans celui des clics", () => {
    expect(coches(gens, new Set(["c", "a"])).map((g) => g.id)).toEqual(["a", "c"]);
  });

  it("compte et dit ce que la recherche cache de coché", () => {
    expect(texteHorsRecherche(0)).toBeNull();
    expect(texteHorsRecherche(2)).toContain("2 personnes cochées");
  });

  it("cherche sans accents ni casse, les mots dans n'importe quel ordre", () => {
    expect(filtrerCandidats(gens, "peron").map((g) => g.id)).toEqual(["b"]);
    expect(filtrerCandidats(gens, "durand chloe").map((g) => g.id)).toEqual(["a"]);
    expect(filtrerCandidats(gens, "exemple.fr").map((g) => g.id)).toEqual(["a", "c"]);
  });

  it("n'offre la recherche qu'au-delà du seuil du projet, et n'écrit jamais « Tout »", () => {
    const vingt = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, prenom: "P", nom: "T", email: null }));
    expect(cherchable(vingt)).toBe(false);
    expect(cherchable([...vingt, { id: "u20", prenom: "P", nom: "T", email: null }])).toBe(true);
    expect(libelleBouton(1)).toBe("Donner les droits admin");
    expect(libelleBouton(3)).toBe("Donner les droits admin à 3 personnes");
    expect(libelleBouton(3)).not.toContain("Tout");
  });
});

describe("la carte « Nommer un administrateur »", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/admin/comptes/page.tsx"), "utf8");

  it("ne nomme plus personne par une liste à choix unique", () => {
    expect(page).toContain("<SelectionNomination candidats={candidats} />");
    expect(page).not.toContain("Choisir…");
  });

  it("dit pourquoi des gens n'y sont pas : déjà administrateurs, ou désactivés", () => {
    expect(page).toContain("administrateurs actuels");
    expect(page).toContain("compte du portail");
    expect(page).toContain("comptes désactivés");
  });
});
