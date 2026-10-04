import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Nommer plusieurs instructeurs d'un coup**.
 *
 * En début de saison, le bureau fait sept instructeurs : c'étaient sept allers-retours dans autant
 * de listes déroulantes, au milieu de quatre-vingts lignes. Le geste devient donc : cocher, puis
 * choisir le rôle une fois.
 *
 * Ce que ce fichier protège, ce sont les **gardes**, parce qu'une action de masse les relâche
 * facilement :
 *
 * - **exactement celles du geste unitaire** (`definirRoleMembre`) : permission `members.manage`,
 *   compte du portail intouchable, personne ne change son propre rôle ;
 * - **le lot n'écrit qu'un rôle de base, et ne touche jamais `estAdmin`.** C'est la condition à
 *   laquelle un administrateur a retrouvé sa case : il en était exclu parce que les trois rôles
 *   étaient **exclusifs** et qu'écrire un rôle l'aurait **rétrogradé en silence**. Le bureau est
 *   devenu un supplément, ce risque a disparu — mais seulement tant que l'écriture reste `data: {
 *   role }`. C'est donc ce que ce fichier vérifie, en plus du refus de `"ADMIN"` comme valeur reçue
 *   (il n'est pas dans `ROLES_DE_BASE` : la validation l'écarte avant toute lecture) ;
 * - **une entrée d'audit par personne.** C'est le journal qui tranche un désaccord six mois plus
 *   tard : « qui est devenu instructeur, et quand » doit s'y lire nom par nom, pas en « 7 comptes
 *   modifiés » ;
 * - **une seule écriture groupée** : sept mises à jour qui échouent à la quatrième laisseraient un
 *   bureau à moitié nommé, sans que rien ne le dise.
 */

/** `estAdmin` en fait partie : c'est ce que `canEditUser` lit pour savoir si la cible est du bureau. */
type Compte = { id: string; prenom: string; nom: string; email: string; role: string; estAdmin: boolean; actif: boolean; service: boolean };

const faux = vi.hoisted(() => ({
  /**
   * **L'acteur est décrit dans le nouveau modèle** : un rôle de base, plus le bureau en supplément.
   * Le décrire `role: "ADMIN"` continuerait de passer (`can` garde cette porte pour une base que la
   * migration n'aurait pas traversée) et ne vérifierait donc **rien** du chemin que l'application
   * emprunte vraiment.
   */
  acteur: { id: "u-admin", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true },
  comptes: [] as Compte[],
  /** Chaque lot passé à `$transaction`, pour vérifier qu'il n'y en a qu'un */
  transactions: [] as string[][],
  ecritures: [] as { id: string; role: string; champs: string[] }[],
  audits: [] as { action: string; cible: string | null; details: unknown }[],
  reauths: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(async ({ where, orderBy }: { where?: { id?: { in?: string[] } }; orderBy?: Record<string, "asc" | "desc">[] }) => {
        const ids = where?.id?.in ?? [];
        const trouves = faux.comptes.filter((c) => ids.includes(c.id));
        // **Le tri est appliqué pour de vrai.** Un faux qui l'ignore rendrait toujours l'ordre de
        // `faux.comptes` — c'est-à-dire l'ordre des lignes en base —, et aucun test ne pourrait
        // alors distinguer « l'action a trié » de « le hasard est tombé juste ».
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
      /**
       * **Le faux garde les champs reçus, pas seulement le rôle** : c'est le seul moyen de vérifier
       * que le lot n'écrit **rien d'autre** — et notamment pas `estAdmin`, dont une écriture ici
       * ferait du geste le plus courant de l'annuaire une destitution de masse sans confirmation.
       */
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        faux.ecritures.push({ id: where.id, role: String(data.role), champs: Object.keys(data) });
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

const { definirRolesEnMasse } = await import("@/app/(app)/admin/membres/actions");

const compte = (id: string, role: string, options: Partial<Compte> = {}): Compte => ({
  id,
  prenom: id,
  nom: "Test",
  email: `${id}@club.test`,
  role,
  estAdmin: false,
  actif: true,
  service: false,
  ...options,
});

/** Un membre du bureau : un rôle de base **plus** `estAdmin`, comme la migration les a laissés. */
const duBureau = (id: string, role = "MEMBRE", options: Partial<Compte> = {}): Compte => compte(id, role, { estAdmin: true, ...options });

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true };
  faux.comptes = [];
  faux.transactions = [];
  faux.ecritures = [];
  faux.audits = [];
  faux.reauths = [];
});

describe("nommer plusieurs instructeurs d'un coup", () => {
  it("écrit les sept rôles en une seule transaction", async () => {
    faux.comptes = Array.from({ length: 7 }, (_, i) => compte(`u-${i}`, "MEMBRE"));
    const res = await definirRolesEnMasse({ role: "INSTRUCTEUR", userIds: faux.comptes.map((c) => c.id) });
    expect(res.erreur).toBeUndefined();
    expect(faux.transactions).toHaveLength(1);
    expect(faux.transactions[0]).toHaveLength(7);
    expect(faux.ecritures.every((e) => e.role === "INSTRUCTEUR")).toBe(true);
  });

  it("journalise personne par personne, avec l'ancien et le nouveau rôle", async () => {
    faux.comptes = [compte("u-1", "MEMBRE"), compte("u-2", "INSTRUCTEUR")];
    await definirRolesEnMasse({ role: "INSTRUCTEUR", userIds: ["u-1", "u-2"] });
    // `u-2` était déjà instructeur : rien à écrire, donc rien à journaliser
    expect(faux.audits).toEqual([{ action: "membre.role_modifie", cible: "u-1", details: { ancien: "MEMBRE", nouveau: "INSTRUCTEUR", enMasse: true } }]);
  });

  /**
   * **« L'ordre rendu est celui de la liste, jamais celui des clics »** (CLAUDE.md) — et sans
   * `orderBy`, ce n'était ni l'un ni l'autre : le `findMany` rendait les comptes dans l'ordre des
   * lignes en base, c'est-à-dire l'ordre d'inscription, qui n'apparaît sur aucun écran. Le journal
   * du lot se lisait donc dans un ordre que personne ne peut retrouver, alors que c'est lui qui
   * tranchera le désaccord d'après. L'action jumelle des présences journalise dans l'ordre de la
   * liste qu'elle reçoit, et `definirActifTous` prend déjà la peine d'un `orderBy`.
   */
  it("journalise dans l'ordre de l'annuaire, ni celui de la base ni celui des clics", async () => {
    // En base, les trois comptes sont dans leur ordre d'inscription…
    faux.comptes = [
      compte("u-chloe", "MEMBRE", { prenom: "Chloé", nom: "Dupont" }),
      compte("u-bravo", "MEMBRE", { prenom: "Bravo", nom: "02" }),
      compte("u-bastien", "MEMBRE", { prenom: "Bastien", nom: "Roy" }),
    ];
    // … et l'écran les envoie dans un troisième ordre encore (celui où les cases ont été cochées).
    await definirRolesEnMasse({ role: "INSTRUCTEUR", userIds: ["u-bastien", "u-chloe", "u-bravo"] });
    /*
     * Reste l'ordre de l'annuaire, « Prénom Nom » — et il se **calcule** sur le jeu d'essai au lieu
     * d'être recopié dessous. Recopié (« u-bravo, u-bastien, u-chloe »), c'était une **seconde
     * écriture** du même ordre : renommer un de ces comptes rendait la liste écrite fausse alors que
     * rien, dans l'action, n'avait bougé. Rien n'est relâché pour autant — le faux `findMany`
     * n'applique que le `orderBy` qu'il reçoit, donc sans tri (l'ordre d'inscription, ci-dessus),
     * avec un tri sur le nom (02, Dupont, Roy) ou à l'envers, le résultat diffère de celui-ci.
     */
    const annuaire = [...faux.comptes].sort((a, b) => a.prenom.localeCompare(b.prenom, "fr") || a.nom.localeCompare(b.nom, "fr")).map((c) => c.id);
    expect(faux.audits.map((a) => a.cible)).toEqual(annuaire);
    expect(faux.ecritures.map((e) => e.id)).toEqual(annuaire);
  });

  it("dit combien de comptes ont changé", async () => {
    faux.comptes = [compte("u-1", "MEMBRE"), compte("u-2", "MEMBRE")];
    const res = await definirRolesEnMasse({ role: "INSTRUCTEUR", userIds: ["u-1", "u-2"] });
    expect(res.succes).toMatch(/2/);
  });
});

describe("les gardes du geste unitaire, tenues en masse", () => {
  /**
   * **Le renversement, et son unique condition.**
   *
   * Un administrateur était **écarté du lot et annoncé** — « 1 administrateur écarté, les droits se
   * règlent dans Comptes admin » —, et c'était la bonne décision tant que les trois rôles étaient
   * exclusifs : lui écrire un rôle l'aurait **rétrogradé en silence**. Le bureau est maintenant un
   * supplément, le lot n'écrit que `role`, et il ne lui retire donc plus rien : il passe comme les
   * autres, exactement comme son propre volet le lui propose déjà un par un.
   *
   * **Toute la sûreté du geste tient à l'écriture**, d'où la seconde attente : `data` ne porte que
   * `role`. Le jour où quelqu'un y ajoutera un champ touchant aux droits, ce test tombera.
   */
  it("change le rôle de base d'un membre du bureau, sans toucher à son bureau", async () => {
    faux.comptes = [compte("u-1", "MEMBRE"), duBureau("u-admin2")];
    const res = await definirRolesEnMasse({ role: "INSTRUCTEUR", userIds: ["u-1", "u-admin2"] });
    expect(faux.ecritures.map((e) => e.id)).toEqual(["u-1", "u-admin2"]);
    expect(faux.audits.map((a) => a.cible)).toEqual(["u-1", "u-admin2"]);
    // Plus aucun renvoi vers « Comptes admin » : il n'y a plus rien à y faire pour un rôle de base.
    expect(res.succes).not.toMatch(/Comptes admin/);
    // **La frontière** : le lot n'écrit que le rôle de base, jamais le bureau.
    for (const e of faux.ecritures) expect(e.champs, e.id).toEqual(["role"]);
  });

  /**
   * **Et la frontière tient aussi côté entrée** : `"ADMIN"` n'est pas dans `ROLES_DE_BASE`, donc la
   * validation le refuse **avant** toute lecture de base. C'est ce qui empêche une requête forgée de
   * se donner le bureau par l'annuaire, maintenant qu'aucune garde ne regarde plus la cible.
   */
  it("refuse « ADMIN » comme rôle reçu : l'annuaire ne donne pas le bureau", async () => {
    faux.comptes = [compte("u-1", "MEMBRE")];
    const res = await definirRolesEnMasse({ role: "ADMIN", userIds: ["u-1"] });
    expect(res.erreur).toBeTruthy();
    expect(faux.ecritures).toEqual([]);
  });

  /**
   * **La frontière du bureau reste tenue, par `canEditUser` et par lui seul** — plus aucune garde ne
   * regarde le rôle de la cible. Et `canEditUser` lit **`estAdmin`** : un `select` Prisma qui
   * prendrait `role` sans lui passerait `undefined`, donc « pas du bureau », et la frontière se
   * **tairait** au lieu de refuser. C'est le piège nommé dans le dossier de ce changement, et il ne
   * se voit ni au typage ni à l'exécution d'un test ordinaire — d'où cette relecture de la source.
   *
   * Les trois gestes de masse de l'annuaire lisent leurs cibles pour les passer à `canEditUser` :
   * les trois doivent donc porter `estAdmin: true`.
   */
  it("chaque lecture de cibles emporte `estAdmin`, sans quoi `canEditUser` se tairait", () => {
    const code = readFileSync(path.join(process.cwd(), "src/app/(app)/admin/membres/actions.ts"), "utf8");
    const selects = code.match(/select: \{[^}]*\}/g) ?? [];
    expect(selects.length, "les trois gestes de masse lisent leurs cibles").toBeGreaterThanOrEqual(3);
    for (const select of selects) {
      // Seuls les `select` qui lisent un rôle nourrissent `canEditUser` : les autres (une période,
      // un agrégat) n'ont rien à voir avec la frontière du bureau.
      if (!select.includes("role: true")) continue;
      expect(select, "un select qui lit `role` doit lire `estAdmin`").toContain("estAdmin: true");
    }
  });

  it("laisse le compte de connexion du portail où il est", async () => {
    faux.comptes = [duBureau("u-portail", "MEMBRE", { service: true }), compte("u-1", "MEMBRE")];
    await definirRolesEnMasse({ role: "MEMBRE", userIds: ["u-portail", "u-1"] });
    expect(faux.ecritures.map((e) => e.id)).not.toContain("u-portail");
  });

  it("ne laisse personne changer son propre rôle", async () => {
    // Le compte de l'acteur est présent dans le lot, du bureau comme il l'est vraiment : c'est bien
    // la garde « soi-même » qui l'écarte, plus aucune autre ne le ferait avant.
    faux.comptes = [duBureau("u-admin", "INSTRUCTEUR"), compte("u-1", "MEMBRE")];
    await definirRolesEnMasse({ role: "INSTRUCTEUR", userIds: ["u-admin", "u-1"] });
    expect(faux.ecritures.map((e) => e.id)).toEqual(["u-1"]);
  });

  it("refuse tout à un instructeur : les comptes ne sont pas son métier", async () => {
    faux.acteur = { id: "u-inst", email: "inst@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    faux.comptes = [compte("u-1", "MEMBRE")];
    await expect(definirRolesEnMasse({ role: "INSTRUCTEUR", userIds: ["u-1"] })).rejects.toThrow();
    expect(faux.ecritures).toEqual([]);
  });

  it("refuse une sélection vide ou trafiquée, sans rien écrire", async () => {
    faux.comptes = [compte("u-1", "MEMBRE")];
    for (const entree of [{ role: "MEMBRE", userIds: [] }, { role: "MEMBRE", userIds: ["u-1", 3] }, {}, null]) {
      const res = await definirRolesEnMasse(entree);
      expect(res.erreur).toBeTruthy();
    }
    expect(faux.ecritures).toEqual([]);
  });

  it("n'écrit rien quand tout le monde est déjà au bon rôle", async () => {
    faux.comptes = [compte("u-1", "INSTRUCTEUR")];
    const res = await definirRolesEnMasse({ role: "INSTRUCTEUR", userIds: ["u-1"] });
    expect(faux.transactions).toEqual([]);
    expect(faux.audits).toEqual([]);
    // Rien d'écarté, rien d'introuvable : la phrase la plus simple reste la bonne.
    expect(res.succes).toMatch(/la sélection était déjà instructeur/);
  });
});

/**
 * **Le message ne laisse tomber personne, et ne se contredit pas.**
 *
 * Le bureau coche quatorze noms et lit une phrase. Si elle annonce treize comptes, le quatorzième
 * n'a pas disparu : il n'a simplement pas été raconté — et personne ne saura jamais qu'il manque.
 * C'est la doctrine de l'action jumelle des présences (`modifierPresencesEnMasse`), qui refuse le
 * lot entier plutôt que d'en écrire treize sur quatorze en silence : ici on écrit ce qui est
 * écrivable, mais on **compte et on dit** tout ce qui est resté dehors.
 */
describe("le message raconte le lot en entier, et une seule histoire", () => {
  it("compte les identifiants sans compte en base, au lieu de les perdre en route", async () => {
    faux.comptes = [compte("u-1", "MEMBRE")];
    const res = await definirRolesEnMasse({ role: "INSTRUCTEUR", userIds: ["u-1", "u-efface"] });
    expect(faux.ecritures.map((e) => e.id)).toEqual(["u-1"]);
    expect(res.succes).toMatch(/1 compte passé instructeur/);
    expect(res.succes).toMatch(/introuvable/i);
  });

  it("ne dit pas « la sélection était déjà membre » quand une ligne a été écartée", async () => {
    // Les deux phrases ne peuvent pas être vraies ensemble : la sélection portait aussi le compte
    // du portail, qui n'était pas « déjà membre » — il n'a pas été regardé du tout.
    faux.comptes = [compte("u-1", "MEMBRE"), duBureau("u-portail", "MEMBRE", { service: true })];
    const res = await definirRolesEnMasse({ role: "MEMBRE", userIds: ["u-1", "u-portail"] });
    expect(faux.ecritures).toEqual([]);
    expect(res.succes).not.toMatch(/la sélection était déjà/);
    expect(res.succes).toMatch(/Aucun compte modifié/);
    expect(res.succes).toMatch(/1 compte était déjà membre/);
    expect(res.succes).toMatch(/écarté/);
  });

  it("dit sobrement qu'aucun compte n'a bougé quand tout le lot est introuvable", async () => {
    faux.comptes = [];
    const res = await definirRolesEnMasse({ role: "MEMBRE", userIds: ["u-efface"] });
    expect(res.succes).toMatch(/Aucun compte modifié/);
    expect(res.succes).not.toMatch(/déjà/);
    expect(res.succes).toMatch(/introuvable/i);
  });
});

const { resumeRoles, texteConfirmationRoles, texteHorsPage, texteSansCase } = await import("@/app/(app)/admin/membres/selection-roles");

/**
 * **Les mots de la confirmation**, seule partie du geste qui ne touche ni à React ni à la base.
 * Ils comptent : « Passer 7 comptes en instructeur » alors que deux le sont déjà annoncerait sept
 * là où le journal n'en garderait que cinq — deux chiffres qui ne s'accordent pas, c'est un doute
 * qu'on ne lève plus.
 */
describe("ce que la confirmation annonce", () => {
  const lignes = [
    { id: "a", role: "MEMBRE" },
    { id: "b", role: "MEMBRE" },
    { id: "c", role: "INSTRUCTEUR" },
  ];

  it("sépare ceux qui changent de ceux qui portent déjà le rôle visé", () => {
    expect(resumeRoles(lignes, "INSTRUCTEUR")).toEqual({ total: 3, changent: 2, inchanges: 1 });
    expect(resumeRoles(lignes, "MEMBRE")).toEqual({ total: 3, changent: 1, inchanges: 2 });
  });

  it("dit le rôle visé, ce qui change et ce qui ne bouge pas", () => {
    const texte = texteConfirmationRoles(resumeRoles(lignes, "INSTRUCTEUR"), "Instructeur");
    expect(texte).toContain("3 comptes");
    expect(texte).toContain("Instructeur");
    expect(texte).toMatch(/2 changeront/);
    expect(texte).toMatch(/1 l'est déjà/);
    // Le rappel du journal n'est pas décoratif : c'est lui qui tranchera le désaccord d'après
    expect(texte).toMatch(/journal/);
  });

  it("annonce franchement qu'il n'y a rien à faire", () => {
    const texte = texteConfirmationRoles(resumeRoles([{ id: "c", role: "INSTRUCTEUR" }], "INSTRUCTEUR"), "Instructeur");
    expect(texte).toMatch(/rien ne changera/i);
    expect(texte).not.toMatch(/journal/);
  });

  it("dit ce qui reste en dehors — sur la page suivante, pas « replié »", () => {
    expect(texteHorsPage(0, 0)).toBeNull();
    expect(texteHorsPage(1, 0)).toMatch(/1 autre compte/);
    expect(texteHorsPage(30, 0)).toMatch(/30 autres comptes/);
    expect(texteHorsPage(30, 0)).not.toMatch(/repli/i);
  });

  /**
   * **Une phrase ne doit pas pouvoir mentir depuis son appelant.** « Ils ne sont pas sélectionnés »
   * n'était vrai que tant que l'écran rabotait la sélection sur la page affichée ; depuis qu'elle
   * survit au changement de page, une seule case cochée suffirait à la rendre fausse. La fonction se
   * taise donc d'elle-même, et c'est `texteHorsAffichage` qui prend le relais.
   */
  it("se taise dès qu'une case est cochée, au lieu d'affirmer le contraire", () => {
    expect(texteHorsPage(30, 1)).toBeNull();
    expect(texteHorsPage(30, 12)).toBeNull();
    // Et l'écran n'a plus à connaître la précaution : il appelle, la fonction tranche.
    const code = readFileSync(path.join(process.cwd(), "src/app/(app)/admin/membres/SelectionRoles.tsx"), "utf8");
    expect(code).toMatch(/texteHorsPage\(restants, selection\.size\)/);
  });

  /**
   * **La phrase a changé d'objet** : elle expliquait l'absence de case des administrateurs, qui en
   * ont désormais une. Elle explique maintenant les deux seules lignes qui n'en ont pas — son
   * propre compte, et un compte du bureau que l'acteur ne peut pas modifier (le jour où l'annuaire
   * se rouvrira à l'encadrement). **Elle ne renvoie plus vers « Comptes admin »** : il n'y a plus
   * rien à y faire pour une case manquante, et un renvoi faux coûte un aller-retour.
   */
  it("dit pourquoi certaines lignes n'ont pas de case, et ne renvoie plus vers Comptes admin", () => {
    expect(texteSansCase({ soiMeme: false, bureau: 0 })).toBeNull();
    const sien = texteSansCase({ soiMeme: true, bureau: 0 });
    expect(sien).toMatch(/Ton compte/);
    expect(sien).not.toMatch(/Comptes admin/);
    expect(texteSansCase({ soiMeme: false, bureau: 2 })).toMatch(/2 comptes du bureau/);
    // Les deux cas peuvent coexister : la phrase les porte tous les deux, sans en avaler un.
    const deux = texteSansCase({ soiMeme: true, bureau: 1 });
    expect(deux).toMatch(/1 compte du bureau/);
    expect(deux).toMatch(/Ton compte/);
  });
});
