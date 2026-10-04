import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **On ne fait pas redonner son code à quelqu'un pour une action qu'on va refuser juste après.**
 *
 * `exigerReauth` n'est pas un test : c'est une **redirection** vers `/connexion/verifier`. Un
 * administrateur dont le code 2FA date de plus de dix minutes quitte donc son écran, rouvre son
 * application d'authentification, recopie six chiffres et revient. Posée *avant* les refus qui ne
 * dépendent pas de la fraîcheur du code, cette demande se paie pour rien : la personne prouve son
 * identité, puis se fait refuser l'action, et rien à l'écran ne relie le détour au refus. Ce qu'elle
 * en retient, c'est que la demande de code est arbitraire — et une garde qu'on croit arbitraire est
 * une garde qu'on finit par retirer.
 *
 * Le pire cas trouvé était `envoyerLienMembre` : le code était exigé **en première ligne**, avant
 * même de savoir s'il y avait quelque chose à envoyer. Or le bouton « Envoyer le lien » s'affiche
 * sur des fiches où le geste est voué au refus — compte désactivé, fiche sans adresse email,
 * trimestre clos, compte de connexion du portail. Trois autres chemins du même fichier avaient la
 * même inversion à un degré moindre : la fiche complète (`modifierMembre`) demandait le code, puis
 * refusait une adresse déjà prise par un autre compte ; la liste des sessions (`revoquerSession`)
 * le demandait, puis refusait qu'on coupe la sienne ; le geste de masse (`definirActifTous`) le
 * demandait avant de constater que le lot était vide.
 *
 * **Ce que ce fichier ne dit pas, et ne doit jamais dire** : que le code est devenu optionnel. Chaque
 * refus vérifié ici a son jumeau positif — l'action qui aboutirait, elle, demande toujours le code,
 * et elle le demande **avant** l'écriture. Sans ces jumeaux, « le refus passe avant » se
 * satisferait d'un `exigerReauth` supprimé. L'ordre est la garde : refus d'abord, code ensuite,
 * écriture en dernier.
 *
 * Les **verrous** ne bougent pas et ne sont pas le sujet : `assertPermission`, `canEditUser`,
 * `canAssignRole` et l'intouchabilité du compte du portail restent tous en amont de l'écriture.
 */

type Trace = "reauth" | "ecriture" | "ecriture-masse" | "revocation" | "envoi" | "session-supprimee";

const faux = vi.hoisted(() => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `members.manage` (comme `invitations.manage` et `auth_sessions.revoke`) n'est ouverte à aucun
  // instructeur, donc ce qui aboutit ici ne passe que par `estAdmin`, jamais par le repli `role ===
  // "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true, sessionId: "s-moi" },
  cible: null as Record<string, unknown> | null,
  /** Le compte qui détient déjà l'adresse saisie, quand le scénario en a un. */
  autreCompte: null as { id: string; prenom: string; nom: string; email: string } | null,
  statutPeriode: "ACTIVE" as string,
  /** Ce que rend `findMany` pour le geste de masse : le lot à désactiver. */
  lot: [] as { id: string }[],
  /** L'ordre des effets : c'est lui, et lui seul, qui dit si la garde sert à quelque chose. */
  trace: [] as Trace[],
  reauths: [] as string[],
  journal: [] as string[],
  /** Vrai = le code 2FA de l'acteur est trop vieux : `exigerReauth` redirige (donc lève ici). */
  codePerime: false,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUniqueOrThrow: vi.fn(async () => faux.cible),
      // Recherche d'un homonyme sur l'adresse saisie : c'est elle qui déclenche le refus « déjà utilisé »
      findUnique: vi.fn(async ({ where }: { where: { email?: string } }) =>
        faux.autreCompte && where.email === faux.autreCompte.email ? faux.autreCompte : null,
      ),
      findMany: vi.fn(async () => faux.lot),
      update: vi.fn(async () => {
        faux.trace.push("ecriture");
        return faux.cible;
      }),
      updateMany: vi.fn(async () => {
        faux.trace.push("ecriture-masse");
        return { count: faux.lot.length };
      }),
      delete: vi.fn(async () => faux.cible),
    },
    period: { findUniqueOrThrow: vi.fn(async () => ({ statut: faux.statutPeriode })) },
    periodMember: { findFirst: vi.fn(async () => ({ periodId: "p-active" })) },
    invitation: {
      updateMany: vi.fn(async () => {
        faux.trace.push("revocation");
        return { count: 1 };
      }),
      findMany: vi.fn(async () => []),
    },
    authSession: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(() => ({
        catch: async () => {
          faux.trace.push("session-supprimee");
        },
      })),
    },
  },
}));

vi.mock("@/lib/invitations", () => ({
  conditionLiensARevoquer: vi.fn(() => ({})),
  ERREUR_COMPTE_SERVICE: "Le compte de connexion du portail ne reçoit pas de lien personnel.",
  envoyerInvitation: vi.fn(async () => {
    faux.trace.push("envoi");
    return true;
  }),
  revokeInvitation: vi.fn(async () => {}),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string) => {
    faux.journal.push(action);
  }),
}));

vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0) }));

vi.mock("@/lib/auth/current-user", () => ({
  assertPermission: vi.fn(async () => faux.acteur),
  exigerReauth: vi.fn(async (_u: unknown, suite: string) => {
    faux.trace.push("reauth");
    faux.reauths.push(suite);
    // La vraie fonction appelle `redirect()`, qui lève : un code trop vieux n'est pas une valeur de
    // retour, c'est un détournement vers `/connexion/verifier`. Le simuler autrement laisserait
    // l'action continuer, et ce fichier ne prouverait plus rien.
    if (faux.codePerime) throw new Error(`REDIRECTION:/connexion/verifier?suite=${suite}`);
  }),
  getCurrentUser: vi.fn(async () => faux.acteur),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { definirActifTous, envoyerLienMembre, modifierMembre, retirerDroitsAdmin, revoquerSession } = await import("@/actions/membres");

const MEMBRE = {
  id: "m",
  prenom: "Chloé",
  nom: "Dubois",
  email: "chloe@exemple.fr",
  role: "MEMBRE",
  actif: true,
  service: false,
  auClubDepuis: null,
  createdAt: new Date("2026-01-22T10:00:00Z"),
};

/** La fiche complète, telle que l'écran d'un membre l'envoie. */
function fiche(champs: { email?: string; role?: string; nom?: string } = {}) {
  const fd = new FormData();
  fd.set("prenom", "Chloé");
  fd.set("nom", champs.nom ?? "Dubois");
  fd.set("email", champs.email ?? "chloe@exemple.fr");
  fd.set("role", champs.role ?? "MEMBRE");
  return fd;
}

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true, sessionId: "s-moi" };
  faux.cible = { ...MEMBRE };
  faux.autreCompte = null;
  faux.statutPeriode = "ACTIVE";
  faux.lot = [];
  faux.trace = [];
  faux.reauths = [];
  faux.journal = [];
  faux.codePerime = false;
});

/**
 * **Le pire cas** : quatre refus, et le code était demandé avant les quatre. Ce sont précisément les
 * états dans lesquels l'annuaire **affiche quand même** le bouton « Envoyer le lien ».
 */
describe("envoyer le lien de quelqu'un (`envoyerLienMembre`)", () => {
  it("refuse un compte désactivé sans avoir fait redonner le code", async () => {
    faux.cible = { ...MEMBRE, actif: false };
    await expect(envoyerLienMembre("m", "p-active")).rejects.toThrow(/désactivé/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });

  it("refuse une fiche sans adresse email sans avoir fait redonner le code", async () => {
    faux.cible = { ...MEMBRE, email: null };
    await expect(envoyerLienMembre("m", "p-active")).rejects.toThrow(/pas d'adresse email/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });

  it("refuse le compte de connexion du portail sans avoir fait redonner le code", async () => {
    faux.cible = { ...MEMBRE, service: true };
    await expect(envoyerLienMembre("m", "p-active")).rejects.toThrow(/portail/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });

  it("refuse un trimestre clos sans avoir fait redonner le code", async () => {
    faux.statutPeriode = "CLOSE";
    await expect(envoyerLienMembre("m", "p-close")).rejects.toThrow(/close/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });

  /**
   * Le jumeau positif, sans lequel tout ce qui précède se satisferait d'un `exigerReauth` supprimé :
   * quand l'envoi peut aboutir, le code est exigé — et **avant** que la clé de quatre mois ne parte.
   */
  it("exige le code quand l'envoi aboutirait, et avant que la clé ne parte", async () => {
    await envoyerLienMembre("m", "p-active");
    expect(faux.trace).toEqual(["reauth", "envoi"]);
    expect(faux.reauths).toEqual(["/admin/membres"]);
  });

  /**
   * **Le code redonné ramène à l'écran du clic**. La suite était écrite en dur sur la liste, alors
   * que le bouton « Envoyer le lien » vit sur **deux** écrans : le volet « Gérer » d'une ligne de
   * l'annuaire, et la carte « Lien d'accès » d'une fiche. Depuis la fiche, le détour par
   * `/connexion/verifier` déposait donc sur la liste, fiche refermée, sans dire si le lien était
   * parti — et l'action n'est pas rejouée après une ré-authentification : il fallait retrouver la
   * ligne et recliquer. Depuis la liste dépliée ou filtrée, c'est la recherche et l'étendue qui se
   * perdaient.
   *
   * Le repli reste la liste : un appel sans `retour` ne doit pas mener nulle part.
   */
  it("revient à l'écran du clic, et à la liste quand personne ne le précise", async () => {
    await envoyerLienMembre("m", "p-active", "/admin/membres/m");
    expect(faux.reauths).toEqual(["/admin/membres/m"]);
    faux.reauths = [];
    await envoyerLienMembre("m", "p-active", "/admin/membres?q=durand&tout=1");
    expect(faux.reauths).toEqual(["/admin/membres?q=durand&tout=1"]);
    faux.reauths = [];
    await envoyerLienMembre("m", "p-active");
    expect(faux.reauths).toEqual(["/admin/membres"]);
  });

  it("ne fait partir aucune clé quand le code est trop vieux", async () => {
    faux.codePerime = true;
    await expect(envoyerLienMembre("m", "p-active")).rejects.toThrow(/REDIRECTION/);
    expect(faux.trace).toEqual(["reauth"]);
    expect(faux.journal).toEqual([]);
  });
});

/**
 * La fiche complète porte **deux** gestes qui exigent un code — le rôle et l'adresse — et un refus
 * qui n'en dépend pas : l'adresse déjà prise par un autre compte. Le refus passait en dernier.
 */
describe("la fiche complète (`modifierMembre`)", () => {
  it("refuse une adresse déjà prise sans avoir fait redonner le code", async () => {
    faux.autreCompte = { id: "autre", prenom: "Camille", nom: "Roy", email: "pris@exemple.fr" };
    const res = await modifierMembre("m", {}, fiche({ email: "pris@exemple.fr" }));
    expect(res.erreur).toMatch(/déjà utilisé/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });

  /**
   * Le cas qui prouve que les deux demandes ont bien été réunies **après** les refus : celle du rôle
   * vivait plus haut dans la fonction, elle partait donc avant que l'adresse ne soit examinée.
   */
  it("refuse une adresse déjà prise même quand le rôle change aussi", async () => {
    faux.autreCompte = { id: "autre", prenom: "Camille", nom: "Roy", email: "pris@exemple.fr" };
    const res = await modifierMembre("m", {}, fiche({ email: "pris@exemple.fr", role: "INSTRUCTEUR" }));
    expect(res.erreur).toMatch(/déjà utilisé/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });

  /**
   * **Régler son propre rôle de base est permis**, et le refus qui vivait ici a disparu.
   *
   * Le raisonnement, à garder : le refus datait du temps où un rôle **donnait** des droits — « se
   * nommer ADMIN » était l'escalade qu'il empêchait. Depuis que le bureau est un **supplément**, le
   * rôle de base n'ouvre rien, et seul un administrateur peut le changer : quelqu'un qui a déjà tout.
   *
   * Ce que ce test garde donc, et c'est l'essentiel pour ce fichier-ci : le geste **demande bien un
   * code récent**, comme tout changement de rôle, et il l'obtient **avant** d'écrire.
   */
  it("laisse régler son propre rôle de base, et redemande le code comme pour un autre", async () => {
    faux.cible = { ...MEMBRE, id: "u-admin", role: "MEMBRE" };
    const res = await modifierMembre("u-admin", {}, fiche({ role: "INSTRUCTEUR" }));
    expect(res.erreur).toBeUndefined();
    expect(faux.reauths).toEqual(["/admin/membres/u-admin"]);
  });

  /**
   * **Ce qui reste refusé sur son propre compte n'a pas bougé** : se retirer le bureau, se désactiver,
   * se supprimer. Les trois enferment dehors, et aucune ne relève du rôle de base.
   */
  it("refuse toujours de se retirer son propre bureau", async () => {
    faux.cible = { ...MEMBRE, id: "u-admin", role: "INSTRUCTEUR", estAdmin: true };
    await expect(retirerDroitsAdmin("u-admin")).rejects.toThrow(/propres droits/i);
  });

  // Ici « ADMIN » est **l'entrée du formulaire**, pas l'état d'un compte : c'est précisément la
  // valeur que l'annuaire ne doit plus accepter (`canAssignRole` ne connaît que les rôles de base).
  it("refuse le rôle d'administrateur depuis l'annuaire sans avoir fait redonner le code", async () => {
    const res = await modifierMembre("m", {}, fiche({ role: "ADMIN" }));
    expect(res.erreur).toMatch(/Comptes admin/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });

  /**
   * Le jumeau positif, et la contrepartie de la réunion des deux demandes : une fiche qui change
   * **à la fois** le rôle et l'adresse ne fait redonner le code **qu'une fois**, avant l'écriture —
   * là où deux appels se seraient succédé, et où le second aurait redirigé une seconde fois si le
   * code venait à peine d'être redonné.
   */
  it("exige le code une seule fois, avant l'écriture, quand rôle et adresse changent ensemble", async () => {
    const res = await modifierMembre("m", {}, fiche({ email: "chloe.dubois@exemple.fr", role: "INSTRUCTEUR" }));
    expect(res.succes).toBeTruthy();
    expect(faux.trace).toEqual(["reauth", "ecriture", "revocation", "envoi"]);
    expect(faux.reauths).toEqual(["/admin/membres/m"]);
  });

  it("n'écrit rien quand le code est trop vieux", async () => {
    faux.codePerime = true;
    await expect(modifierMembre("m", {}, fiche({ email: "chloe.dubois@exemple.fr" }))).rejects.toThrow(/REDIRECTION/);
    expect(faux.trace).toEqual(["reauth"]);
    expect(faux.journal).toEqual([]);
  });
});

/**
 * La liste des sessions montre **aussi la ligne de l'administrateur qui la regarde**, avec son
 * bouton « Déconnecter » : c'est celui qu'on clique par mégarde. Le code était demandé avant le
 * refus, donc on redonnait six chiffres pour s'entendre dire que ce bouton-là ne marche pas.
 */
describe("révoquer une session depuis la liste (`revoquerSession`)", () => {
  it("refuse sa propre session sans avoir fait redonner le code", async () => {
    await expect(revoquerSession("s-moi")).rejects.toThrow(/propre session/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });

  it("exige le code pour la session de quelqu'un d'autre, et avant de la couper", async () => {
    await revoquerSession("s-autre");
    expect(faux.trace).toEqual(["reauth", "session-supprimee"]);
    expect(faux.reauths).toEqual(["/admin/sessions"]);
  });
});

/**
 * Même règle pour un geste à blanc, comme dans `definirEmailMembre` (« inutile de réclamer un code
 * pour un enregistrement à blanc ») : deux appuis de suite sur « Tout désactiver », le second sur
 * une liste déjà vidée, suffisaient à déclencher le détour par `/connexion/verifier`.
 */
describe("désactiver tout le monde (`definirActifTous`)", () => {
  it("ne demande rien quand il n'y a aucun compte à désactiver", async () => {
    faux.lot = [];
    await expect(definirActifTous(false)).resolves.toMatch(/aucun compte à désactiver/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });

  it("exige le code dès que le lot n'est pas vide, et avant l'écriture", async () => {
    faux.lot = [{ id: "a" }, { id: "b" }];
    await definirActifTous(false);
    expect(faux.trace).toEqual(["reauth", "ecriture-masse"]);
    expect(faux.reauths).toEqual(["/admin/membres"]);
  });
});
