import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Désactiver, réactiver ou supprimer plusieurs comptes d'un coup**.
 *
 * Demande de Delta : « ajoute une possible selection avec possibilité de desactiver reactiver ou
 * suprimer (comme en bulk action) ». L'annuaire savait cocher des lignes pour nommer sept
 * instructeurs ; il coupe maintenant l'accès d'un groupe et efface les comptes ouverts par erreur —
 * là où c'étaient trente volets à ouvrir un par un.
 *
 * Ce fichier protège **les verrous**, parce qu'un geste de masse les relâche facilement, et parce que
 * deux d'entre eux ici sont irréversibles :
 *
 * - **exactement ceux des gestes unitaires** (`definirActif`, `supprimerMembre`) : la permission de
 *   chaque geste, `canEditUser`, le compte du portail intouchable, personne n'agit sur son propre
 *   compte, et un **code 2FA récent avant toute écriture** ;
 * - **un administrateur passe par ici, et la confirmation le nomme**. Il en était exclu — pas de
 *   case, lot entier refusé s'il en arrivait un — pour une raison qui a cessé d'exister : la
 *   sélection servait d'abord à changer un rôle, ce qui l'aurait **rétrogradé en silence** (les trois
 *   rôles étaient exclusifs). Le bureau est devenu un supplément, et ce qui restait n'était qu'une
 *   règle **plus stricte en masse qu'à l'unité** — sa propre fiche offre « Désactiver le compte » et
 *   « Supprimer définitivement », et le pied de ce même écran propose « Désactiver tous les comptes,
 *   administrateurs compris ». Ce que ce fichier garde désormais : le lot ne touche **jamais**
 *   `estAdmin`, et la confirmation **nomme** les comptes du bureau qu'il emporte ;
 * - **tout ou rien** : une ligne interdite refuse les trente autres, et le message nomme laquelle ;
 * - **une entrée d'audit par personne**, portant la **même action** que le geste unitaire — un seul
 *   filtre du journal doit répondre à « quand le compte de Chloé a-t-il été coupé ? » ;
 * - **aucune notification** : « cinquante-cinq emails partis d'un clic sont un incident ».
 */

/** `estAdmin` en fait partie : c'est ce que `canEditUser` lit pour savoir si la cible est du bureau. */
type Compte = { id: string; prenom: string; nom: string; email: string | null; role: string; estAdmin: boolean; actif: boolean; service: boolean };

const faux = vi.hoisted(() => ({
  /**
   * **L'acteur est décrit dans le nouveau modèle** : un rôle de base, plus le bureau en supplément.
   * Le décrire `role: "ADMIN"` passerait encore (`can` garde cette porte pour une base que la
   * migration n'aurait pas traversée) et ne vérifierait donc rien du chemin réel.
   */
  acteur: { id: "u-admin", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true },
  comptes: [] as Compte[],
  /** Chaque lot passé à `$transaction`, pour vérifier qu'il n'y en a qu'un */
  transactions: [] as string[][],
  misAJour: [] as { ids: string[]; actif: boolean }[],
  supprimes: [] as string[][],
  sessionsCoupees: [] as string[],
  audits: [] as { action: string; cible: string | null; details: unknown }[],
  reauths: [] as string[],
  /** Vrai = code 2FA trop vieux : `exigerReauth` redirige, donc lève. */
  codePerime: false,
}));

/** Ce que la transaction a reçu : une seule opération, et on veut savoir laquelle. */
type Operation = { genre: "updateMany" | "deleteMany"; ids: string[] };

vi.mock("@/lib/db", () => {
  const db = {
    user: {
      findMany: vi.fn(async ({ where, orderBy }: { where?: { id?: { in?: string[] } }; orderBy?: Record<string, "asc" | "desc">[] }) => {
        const ids = where?.id?.in ?? [];
        const trouves = faux.comptes.filter((c) => ids.includes(c.id));
        // **Le tri est appliqué pour de vrai** : un faux qui l'ignore rendrait toujours l'ordre de
        // `faux.comptes`, et aucun test ne pourrait distinguer « l'action a trié » de « le hasard est
        // tombé juste » (même précaution que le fichier du rôle en masse).
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
      // Les écritures groupées ne sont pas exécutées ici : elles sont **décrites** et remises à
      // `$transaction`, exactement comme Prisma le fait. C'est ce qui permet de vérifier qu'il n'y a
      // qu'un seul aller-retour.
      updateMany: vi.fn(({ where, data }: { where: { id: { in: string[] } }; data: { actif: boolean } }) => ({
        genre: "updateMany" as const,
        ids: where.id.in,
        actif: data.actif,
      })),
      deleteMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) => ({ genre: "deleteMany" as const, ids: where.id.in })),
    },
    $transaction: vi.fn(async (operations: Operation[]) => {
      faux.transactions.push(operations.map((o) => o.genre));
      for (const op of operations) {
        if (op.genre === "deleteMany") {
          faux.supprimes.push(op.ids);
          faux.comptes = faux.comptes.filter((c) => !op.ids.includes(c.id));
        } else {
          const actif = (op as Operation & { actif: boolean }).actif;
          faux.misAJour.push({ ids: op.ids, actif });
          for (const c of faux.comptes) if (op.ids.includes(c.id)) c.actif = actif;
        }
      }
      return operations;
    }),
  };
  return { db };
});

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  revokeAllSessions: vi.fn(async (userId: string) => {
    faux.sessionsCoupees.push(userId);
    return 1;
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
      if (faux.codePerime) throw new Error(`REDIRECTION:/connexion/verifier?suite=${suite}`);
    }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { appliquerGesteEnMasse } = await import("@/app/(app)/admin/membres/actions");

const compte = (id: string, options: Partial<Compte> = {}): Compte => ({
  id,
  prenom: id,
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
  faux.misAJour = [];
  faux.supprimes = [];
  faux.sessionsCoupees = [];
  faux.audits = [];
  faux.reauths = [];
  faux.codePerime = false;
});

describe("les trois gestes, quand tout est permis", () => {
  it("désactive le lot en une seule écriture, coupe les sessions et journalise nom par nom", async () => {
    faux.comptes = Array.from({ length: 5 }, (_, i) => compte(`u-${i}`));
    const res = await appliquerGesteEnMasse({ geste: "desactiver", userIds: faux.comptes.map((c) => c.id) });
    expect(res.erreur).toBeUndefined();
    expect(faux.transactions).toEqual([["updateMany"]]);
    expect(faux.misAJour).toEqual([{ ids: ["u-0", "u-1", "u-2", "u-3", "u-4"], actif: false }]);
    // Comme à l'unité : les appareils déjà connectés tombent, sinon la désactivation est décorative.
    expect(faux.sessionsCoupees).toEqual(["u-0", "u-1", "u-2", "u-3", "u-4"]);
    // **La même action que le geste unitaire** : un seul filtre du journal retrouve tout.
    expect(faux.audits.map((a) => a.action)).toEqual(Array(5).fill("membre.desactive"));
    expect(faux.audits.map((a) => a.cible)).toEqual(["u-0", "u-1", "u-2", "u-3", "u-4"]);
  });

  it("réactive le lot sans toucher aux sessions : rendre l'accès n'est pas le couper", async () => {
    faux.comptes = [compte("u-1", { actif: false }), compte("u-2", { actif: false })];
    const res = await appliquerGesteEnMasse({ geste: "reactiver", userIds: ["u-1", "u-2"] });
    expect(res.succes).toMatch(/2 comptes réactivés/);
    expect(faux.misAJour).toEqual([{ ids: ["u-1", "u-2"], actif: true }]);
    expect(faux.sessionsCoupees).toEqual([]);
    expect(faux.audits.map((a) => a.action)).toEqual(["membre.reactive", "membre.reactive"]);
  });

  it("supprime le lot en un seul `deleteMany`, et garde l'adresse au journal comme à l'unité", async () => {
    faux.comptes = [compte("u-1"), compte("u-2")];
    const res = await appliquerGesteEnMasse({ geste: "supprimer", userIds: ["u-1", "u-2"] });
    expect(res.succes).toMatch(/2 comptes supprimés définitivement/);
    expect(faux.transactions).toEqual([["deleteMany"]]);
    expect(faux.supprimes).toEqual([["u-1", "u-2"]]);
    expect(faux.audits).toEqual([
      { action: "membre.supprime", cible: "u-1", details: { email: "u-1@club.test", enMasse: true } },
      { action: "membre.supprime", cible: "u-2", details: { email: "u-2@club.test", enMasse: true } },
    ]);
  });

  /**
   * **« L'ordre rendu est celui de la liste, jamais celui des clics »** (`CLAUDE.md`). C'est le
   * journal qui tranchera le désaccord d'après : il doit se lire dans l'ordre de l'annuaire
   * (« Prénom Nom »), pas dans l'ordre d'inscription des comptes en base ni dans celui des cases
   * cochées.
   */
  it("journalise dans l'ordre de l'annuaire, ni celui de la base ni celui des clics", async () => {
    faux.comptes = [
      compte("u-chloe", { prenom: "Chloé", nom: "Dupont" }),
      compte("u-bravo", { prenom: "Bravo", nom: "02" }),
      compte("u-bastien", { prenom: "Bastien", nom: "Roy" }),
    ];
    await appliquerGesteEnMasse({ geste: "desactiver", userIds: ["u-bastien", "u-chloe", "u-bravo"] });
    /*
     * L'ordre de l'annuaire, « Prénom Nom », **calculé sur le jeu d'essai** au lieu d'être recopié
     * dessous : recopié, c'était une seconde écriture du même ordre, et renommer un de ces comptes la
     * rendait fausse sans qu'aucune règle n'ait bougé. Le faux `findMany` n'applique que le `orderBy`
     * qu'il reçoit : sans tri (l'ordre d'inscription, ci-dessus), avec un tri sur le nom (02,
     * Dupont, Roy) ou à l'envers, le résultat diffère de celui-ci — le test vérifie donc la même
     * chose qu'avant.
     */
    const annuaire = [...faux.comptes].sort((a, b) => a.prenom.localeCompare(b.prenom, "fr") || a.nom.localeCompare(b.nom, "fr")).map((c) => c.id);
    expect(faux.audits.map((a) => a.cible)).toEqual(annuaire);
  });

  /** Seules les lignes **réellement modifiées** sont écrites et journalisées (`CLAUDE.md`). */
  it("n'écrit ni ne journalise ceux qui portent déjà la valeur visée, et les dit à part", async () => {
    faux.comptes = [compte("u-1"), compte("u-2", { actif: false })];
    const res = await appliquerGesteEnMasse({ geste: "desactiver", userIds: ["u-1", "u-2"] });
    expect(faux.misAJour).toEqual([{ ids: ["u-1"], actif: false }]);
    expect(faux.audits.map((a) => a.cible)).toEqual(["u-1"]);
    expect(res.succes).toMatch(/1 compte désactivé/);
    expect(res.succes).toMatch(/1 compte était déjà désactivé/);
  });

  it("n'écrit rien, et ne réclame aucun code, quand tout le lot porte déjà la valeur visée", async () => {
    faux.comptes = [compte("u-1", { actif: false })];
    const res = await appliquerGesteEnMasse({ geste: "desactiver", userIds: ["u-1"] });
    expect(res.succes).toMatch(/déjà désactivée/);
    expect(faux.transactions).toEqual([]);
    expect(faux.audits).toEqual([]);
    // Réclamer un code 2FA pour un enregistrement à blanc apprendrait à en donner un pour rien.
    expect(faux.reauths).toEqual([]);
  });
});

describe("un code 2FA récent, avant toute écriture", () => {
  it("le demande pour les trois gestes", async () => {
    for (const geste of ["desactiver", "reactiver", "supprimer"] as const) {
      faux.reauths = [];
      faux.comptes = [compte("u-1", { actif: geste !== "reactiver" })];
      await appliquerGesteEnMasse({ geste, userIds: ["u-1"] });
      expect(faux.reauths, geste).toEqual(["/admin/membres"]);
    }
  });

  it("n'écrit rien quand le code est trop vieux : la garde tombe avant la base", async () => {
    faux.codePerime = true;
    faux.comptes = [compte("u-1"), compte("u-2")];
    await expect(appliquerGesteEnMasse({ geste: "supprimer", userIds: ["u-1", "u-2"] })).rejects.toThrow(/REDIRECTION/);
    expect(faux.transactions).toEqual([]);
    expect(faux.supprimes).toEqual([]);
    expect(faux.audits).toEqual([]);
  });
});

/**
 * **Le renversement** : un membre du bureau traverse ces trois gestes comme les autres.
 *
 * Il en était exclu — pas de case, lot entier refusé —, et la raison tenait à l'ancien modèle de
 * rôles. Depuis que le bureau est un supplément, la règle n'était plus que **plus stricte en masse
 * qu'à l'unité** : la fiche d'un administrateur offre les deux mêmes boutons, avec les mêmes verrous,
 * et le pied de cet écran désactive tout le club « administrateurs compris ». Ce qui est gardé ici,
 * c'est que le lot ne touche **que** l'accès (ou efface la ligne) : jamais `estAdmin`.
 */
describe("un membre du bureau passe comme les autres, et son bureau n'est pas touché", () => {
  it("se désactive dans le lot, et l'écriture ne porte que `actif`", async () => {
    faux.comptes = [compte("u-1"), compte("u-sophie", { prenom: "Sophie", nom: "Delta", estAdmin: true })];
    const res = await appliquerGesteEnMasse({ geste: "desactiver", userIds: ["u-1", "u-sophie"] });
    expect(res.erreur).toBeUndefined();
    // L'ordre est celui de l'annuaire (« Prénom Nom ») : Sophie avant u-1, jamais l'ordre des clics.
    expect(faux.misAJour).toEqual([{ ids: ["u-sophie", "u-1"], actif: false }]);
    // Une entrée d'audit par personne, sous l'action du geste unitaire.
    expect(faux.audits.map((a) => a.cible)).toEqual(["u-sophie", "u-1"]);
    // **La frontière** : l'action ne décrit jamais d'écriture sur `estAdmin`.
    const code = readFileSync(path.join(process.cwd(), "src/app/(app)/admin/membres/actions.ts"), "utf8");
    expect(code).not.toMatch(/data: \{[^}]*estAdmin/);
  });

  it("se supprime dans le lot : la cascade emporte le compte, le bureau avec", async () => {
    faux.comptes = [compte("u-sophie", { prenom: "Sophie", nom: "Delta", estAdmin: true })];
    const res = await appliquerGesteEnMasse({ geste: "supprimer", userIds: ["u-sophie"] });
    expect(res.erreur).toBeUndefined();
    expect(faux.supprimes).toEqual([["u-sophie"]]);
  });
});

describe("tout ou rien : une ligne interdite refuse le lot entier, et le message dit laquelle", () => {
  it("refuse tout le lot si le compte de connexion du portail s'y trouve, et le nomme", async () => {
    faux.comptes = [compte("u-1"), compte("u-portail", { prenom: "Portail", nom: "HEMA", service: true, estAdmin: true })];
    const res = await appliquerGesteEnMasse({ geste: "desactiver", userIds: ["u-1", "u-portail"] });
    expect(res.erreur).toMatch(/Portail HEMA/);
    expect(res.erreur).toMatch(/portail/);
    expect(faux.transactions).toEqual([]);
  });

  it("refuse tout le lot si l'acteur s'y est mis lui-même : on ne ferme pas la porte de l'intérieur", async () => {
    faux.comptes = [compte("u-1"), compte("u-admin", { prenom: "Delta", nom: "Lefebvre", role: "INSTRUCTEUR", estAdmin: true })];
    const res = await appliquerGesteEnMasse({ geste: "desactiver", userIds: ["u-1", "u-admin"] });
    expect(res.erreur).toMatch(/Delta Lefebvre/);
    expect(res.erreur).toMatch(/ton propre compte/);
    expect(faux.transactions).toEqual([]);
  });

  /**
   * Un écran en retard sur la base n'est pas une base de décision pour un geste destructeur : le lot
   * est refusé, et on dit quoi faire (recharger). Le rôle en masse, lui, écrit ce qui est écrivable et
   * compte les introuvables — il ne détruit rien.
   */
  it("refuse tout le lot si un compte a quitté l'annuaire depuis l'affichage", async () => {
    faux.comptes = [compte("u-1")];
    const res = await appliquerGesteEnMasse({ geste: "supprimer", userIds: ["u-1", "u-efface"] });
    expect(res.erreur).toMatch(/introuvable/i);
    expect(res.erreur).toMatch(/Recharge l'écran/);
    expect(faux.supprimes).toEqual([]);
  });
});

describe("les permissions, exactement celles des boutons d'une ligne", () => {
  it("refuse les trois gestes à un instructeur : les comptes ne sont pas son métier", async () => {
    faux.acteur = { id: "u-inst", email: "inst@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    faux.comptes = [compte("u-1")];
    for (const geste of ["desactiver", "reactiver", "supprimer"] as const) {
      await expect(appliquerGesteEnMasse({ geste, userIds: ["u-1"] }), geste).rejects.toThrow();
    }
    expect(faux.transactions).toEqual([]);
  });

  it("refuse une sélection vide, trafiquée ou plus grosse que le plafond partagé", async () => {
    faux.comptes = [compte("u-1")];
    const trop = Array.from({ length: 501 }, (_, i) => `u-${i}`);
    for (const entree of [
      { geste: "desactiver", userIds: [] },
      { geste: "desactiver", userIds: ["u-1", 3] },
      { geste: "effacer", userIds: ["u-1"] },
      { geste: "desactiver", userIds: trop },
      {},
      null,
    ]) {
      const res = await appliquerGesteEnMasse(entree);
      expect(res.erreur, JSON.stringify(entree).slice(0, 40)).toBeTruthy();
    }
    expect(faux.transactions).toEqual([]);
  });
});

/**
 * **Aucune notification, et pas une de plus que les gestes unitaires.**
 *
 * Ni `definirActif` ni `supprimerMembre` n'écrivent à qui que ce soit : la désactivation coupe les
 * sessions, la suppression emporte tout par cascade. Un lot ne doit donc rien envoyer non plus —
 * « cinquante-cinq emails partis d'un clic sont un incident, pas une notification ». La garde se pose
 * sur le **texte du module** : c'est le seul endroit où l'on voie qu'un canal n'a pas été branché
 * discrètement, et c'est la forme qu'ont déjà les gardes d'envoi du dossier.
 */
describe("aucune notification", () => {
  /**
   * **La garde porte sur les gestes, plus sur le fichier**. Elle lisait le module entier et
   * exigeait qu'aucun nom de canal n'y apparaisse — ce qui a cessé d'être tenable le jour où
   * l'annuaire a reçu « Renvoyer le lien » en masse (`renvoyerLiensEnMasse`), dont l'envoi **est**
   * le geste demandé. Supprimer la garde aurait été le mauvais réflexe : ce qu'elle protège —
   * désactiver, réactiver, supprimer et changer un rôle n'écrivent à personne — reste vrai et
   * compte toujours autant (« cinquante-cinq emails partis d'un clic sont un incident »). On la
   * resserre donc sur **le corps des quatre gestes muets**, et on vérifie à côté que le cinquième
   * est bien le seul à envoyer.
   */
  const CANAUX = ["enqueueEmail", "sendEmailNow", "envoyerInvitation", "notifierPersonnes", "publierSurSalon", "journaliser"];

  /**
   * Le corps d'un export, **sans les commentaires** : la docstring du geste suivant parle justement des
   * canaux d'envoi, et un nom cité dans une phrase ne vaut pas un appel.
   */
  function corps(nom: string): string {
    const code = readFileSync(path.join(process.cwd(), "src/app/(app)/admin/membres/actions.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const debut = code.indexOf(`export async function ${nom}(`);
    expect(debut, `${nom} a disparu du module`).toBeGreaterThan(-1);
    const suivant = code.indexOf("export async function ", debut + 1);
    return code.slice(debut, suivant === -1 ? undefined : suivant);
  }

  it("les quatre gestes qui écrivent en base n'écrivent à personne", () => {
    for (const geste of ["definirRolesEnMasse", "appliquerGesteEnMasse"]) {
      const code = corps(geste);
      for (const canal of CANAUX) expect(code, `${geste} / ${canal}`).not.toContain(canal);
    }
  });

  it("le renvoi des liens est le seul geste de l'annuaire qui parle au monde extérieur", () => {
    const code = corps("renvoyerLiensEnMasse");
    expect(code).toContain("envoyerInvitation(");
    // Et il ne double pas l'envoi d'une notification : un email par personne, celui du lien, point.
    for (const canal of ["notifierPersonnes", "publierSurSalon", "sendEmailNow"]) expect(code, canal).not.toContain(canal);
  });
});

const { resumeGeste, texteConfirmationGeste } = await import("@/app/(app)/admin/membres/selection-gestes");

/**
 * **Ce que la confirmation annonce**, seule partie du geste qui ne touche ni à React ni à la base.
 * `CLAUDE.md` : elle dit ce qui sera écrasé, en séparant ceux qui portent déjà la valeur visée de ceux
 * qui changent vraiment — « les confondre gonfle le chiffre censé faire hésiter ».
 */
describe("ce que la confirmation annonce", () => {
  const lignes = [
    { id: "a", nom: "Bravo 02", role: "MEMBRE", actif: true, reponses: 6, estAdmin: false },
    { id: "b", nom: "Bastien Roy", role: "MEMBRE", actif: true, reponses: 0, estAdmin: false },
    { id: "c", nom: "Chloé Dupont", role: "MEMBRE", actif: false, reponses: 8, estAdmin: false },
  ];

  it("sépare ceux qui changent de ceux qui portent déjà la valeur visée", () => {
    expect(resumeGeste(lignes, "desactiver")).toMatchObject({ total: 3, changent: 2, inchanges: 1 });
    expect(resumeGeste(lignes, "reactiver")).toMatchObject({ total: 3, changent: 1, inchanges: 2 });
    // Une suppression n'a pas de « déjà fait » : chaque ligne du lot disparaît.
    expect(resumeGeste(lignes, "supprimer")).toMatchObject({ total: 3, changent: 3, inchanges: 0 });
  });

  it("dit ce qui change, ce qui ne bouge pas, et la conséquence du bouton de la ligne", () => {
    const texte = texteConfirmationGeste(resumeGeste(lignes, "desactiver"), "desactiver");
    expect(texte).toContain("Désactiver 3 comptes ?");
    expect(texte).toMatch(/2 comptes changeront/);
    expect(texte).toMatch(/1 est déjà désactivé/);
    // La même promesse que le bouton d'une ligne : l'accès tombe tout de suite.
    expect(texte).toMatch(/lien personnel/);
    expect(texte).toMatch(/journal/);
  });

  it("annonce franchement qu'il n'y a rien à faire", () => {
    const texte = texteConfirmationGeste(resumeGeste([lignes[2]], "desactiver"), "desactiver");
    expect(texte).toMatch(/rien ne changera/i);
    expect(texte).not.toMatch(/journal/);
  });

  /**
   * **Les réponses de présence perdues, personne par personne.** C'est la seule donnée qu'une
   * suppression détruit et qu'on ne peut pas ressaisir : un total seul (« 14 réponses ») ne dit pas
   * qu'on est en train d'effacer la saison entière de quelqu'un.
   */
  it("compte les réponses de présence perdues par personne, et leur total", () => {
    const resume = resumeGeste(lignes, "supprimer");
    expect(resume.reponsesPerdues).toBe(14);
    const texte = texteConfirmationGeste(resume, "supprimer");
    expect(texte).toContain("Supprimer définitivement 3 comptes ?");
    expect(texte).toMatch(/irréversible/);
    expect(texte).toContain("14 réponses de présence seront perdues");
    expect(texte).toContain("Bravo 02 : 6 réponses");
    expect(texte).toContain("Chloé Dupont : 8 réponses");
    // « 0 réponse » se lit mal : on écrit « aucune ».
    expect(texte).toContain("Bastien Roy : aucune réponse");
    expect(texte).toMatch(/journal/);
  });

  /**
   * **Ce qui reste dû au bureau : être dit avant.** Un administrateur a une case comme les autres,
   * mais couper son accès referme l'administration du club, et l'effacer emporte ses droits avec le
   * compte. La confirmation le **nomme** — pas « 2 administrateurs », qui laisserait chercher
   * lesquels au moment précis où l'on hésite.
   */
  it("nomme les comptes du bureau que le lot emporte", () => {
    const avecBureau = [lignes[0], { ...lignes[1], estAdmin: true }];
    const desactiver = texteConfirmationGeste(resumeGeste(avecBureau, "desactiver"), "desactiver");
    expect(desactiver).toContain("Bastien Roy est du bureau");
    expect(desactiver).toMatch(/administration du club se referme/);
    const supprimer = texteConfirmationGeste(resumeGeste(avecBureau, "supprimer"), "supprimer");
    expect(supprimer).toContain("Bastien Roy est du bureau");
    expect(supprimer).toMatch(/droits d'administrateur partent avec le compte/);
  });

  it("ne dit rien du bureau quand il n'y en a pas dans le lot, ni pour une réactivation", () => {
    expect(texteConfirmationGeste(resumeGeste(lignes, "desactiver"), "desactiver")).not.toMatch(/du bureau/);
    // Réactiver ne prive personne de ses droits : il les rend. Rien à annoncer.
    const bureauInactif = [{ ...lignes[2], estAdmin: true }];
    expect(texteConfirmationGeste(resumeGeste(bureauInactif, "reactiver"), "reactiver")).not.toMatch(/du bureau/);
  });

  /**
   * **Un administrateur déjà désactivé n'a pas de droits à perdre une seconde fois.** Le nommer
   * gonflerait le chiffre censé faire hésiter — c'est la règle d'`inchanges`, appliquée à cette
   * phrase-là.
   */
  it("ne nomme que les comptes du bureau que le geste change vraiment", () => {
    const dejaCoupe = [lignes[0], { ...lignes[2], estAdmin: true }];
    expect(resumeGeste(dejaCoupe, "desactiver").bureau).toEqual([]);
    expect(texteConfirmationGeste(resumeGeste(dejaCoupe, "desactiver"), "desactiver")).not.toMatch(/du bureau/);
  });

  it("dit qu'il n'y a rien à perdre quand personne n'a répondu", () => {
    const texte = texteConfirmationGeste(resumeGeste([lignes[1]], "supprimer"), "supprimer");
    expect(texte).toMatch(/Aucune réponse de présence ne sera perdue/);
  });

  /**
   * Un lot peut porter cinq cents comptes, et une fenêtre de confirmation de cinq cents lignes ne se
   * lit pas : elle se clique. Au-delà de douze noms, le reste est **compté et dit** — jamais avalé —,
   * et le total reste juste.
   */
  it("détaille douze noms au plus, puis compte le reste sans l'avaler", () => {
    const vingt = Array.from({ length: 20 }, (_, i) => ({ id: `u-${i}`, nom: `Personne ${i}`, role: "MEMBRE", actif: true, reponses: 2, estAdmin: false }));
    const resume = resumeGeste(vingt, "supprimer");
    expect(resume.reponsesPerdues).toBe(40);
    const texte = texteConfirmationGeste(resume, "supprimer");
    expect(texte).toContain("40 réponses de présence seront perdues");
    expect(texte).toContain("Personne 11 : 2 réponses");
    expect(texte).not.toContain("Personne 12 :");
    expect(texte).toContain("et 8 autres comptes (16 réponses)");
  });
});
