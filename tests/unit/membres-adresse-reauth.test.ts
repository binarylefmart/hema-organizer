import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Changer l'adresse de quelqu'un exige un code récent**.
 *
 * C'était le seul geste de l'application qui touche un **compte** sans redemander le code 2FA : le
 * rôle, la désactivation, la suppression et la remise à zéro de l'accès le demandaient tous, pas
 * l'adresse. Or `CLAUDE.md` désigne nommément ce couple — « changer l'adresse de quelqu'un *et* lui
 * renvoyer son lien fait arriver ce lien chez soi, donc permet d'entrer sous son identité » —, et sur
 * ces deux chemins le renvoi est **automatique** : remplacer une adresse renseignée révoque les liens
 * de l'ancienne boîte et fait partir une clé neuve de quatre mois vers la nouvelle
 * (`remplacerLienApresChangementEmail`). Un écran d'administration laissé ouvert sur un poste partagé
 * suffisait, en deux champs, à se fabriquer une clé au nom de quelqu'un.
 *
 * Portée bornée — il faut déjà une session admin élevée pour arriver là : c'est de la défense en
 * profondeur, pas une escalade de rôle. Ce fichier tient les deux chemins :
 *
 * - `definirEmailMembre` (l'adresse seule, depuis le volet d'une ligne de l'annuaire) ;
 * - la branche « adresse » de `modifierMembre` (la fiche complète), qui redemandait déjà un code pour
 *   un changement de **rôle** et laissait passer celui de l'adresse.
 *
 * Et il tient l'**ordre** : le code est redemandé **avant** l'écriture. Demandé après, la clé serait
 * déjà partie — la garde ne protégerait plus rien, elle ferait seulement joli dans le code.
 */

type Trace = "reauth" | "ecriture" | "revocation" | "envoi";

const faux = vi.hoisted(() => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `members.manage` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
  // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true },
  cible: null as Record<string, unknown> | null,
  /** L'ordre des effets, dans l'ordre où ils se produisent : c'est lui qui dit si la garde sert. */
  trace: [] as Trace[],
  misAJour: [] as Record<string, unknown>[],
  journal: [] as { action: string; cible: unknown; details: unknown }[],
  reauths: [] as string[],
  /** Vrai = le code 2FA de l'acteur est trop vieux : `exigerReauth` redirige (donc lève ici). */
  codePerime: false,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUniqueOrThrow: vi.fn(async () => faux.cible),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.trace.push("ecriture");
        faux.misAJour.push(data);
        return faux.cible;
      }),
    },
    invitation: {
      updateMany: vi.fn(async () => {
        faux.trace.push("revocation");
        return { count: 1 };
      }),
    },
    periodMember: {
      findFirst: vi.fn(async () => ({ periodId: "p-active" })),
    },
    period: {
      findUniqueOrThrow: vi.fn(async () => ({ statut: "ACTIVE" })),
    },
  },
}));

vi.mock("@/lib/invitations", () => ({
  conditionLiensARevoquer: vi.fn(() => ({})),
  ERREUR_COMPTE_SERVICE: "Compte de service.",
  ERREUR_COMPTE_INACTIF: "Compte désactivé.",
  messageSansEmail: vi.fn(() => "Pas d'adresse."),
  peutEtreInvite: vi.fn(() => true),
  envoyerInvitation: vi.fn(async () => {
    faux.trace.push("envoi");
    return true;
  }),
  revokeInvitation: vi.fn(async () => {}),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, cible: unknown, details: unknown) => {
    faux.journal.push({ action, cible, details });
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
    // l'action continuer et ce fichier ne prouverait rien.
    if (faux.codePerime) throw new Error(`REDIRECTION:/connexion/verifier?suite=${suite}`);
  }),
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { definirEmailMembre, envoyerLienMembre, modifierMembre } = await import("@/actions/membres");

const MEMBRE = { id: "m", prenom: "Chloé", nom: "Dubois", email: "chloe@exemple.fr", role: "MEMBRE", actif: true, service: false, auClubDepuis: null, createdAt: new Date("2026-01-22T10:00:00Z") };

/** Le formulaire de l'adresse seule, tel que le volet d'une ligne l'envoie. */
function champEmail(email: string) {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

/** La fiche complète, telle que l'écran du membre l'envoie (rôle inchangé : seule l'adresse bouge). */
function fiche(email: string) {
  const fd = new FormData();
  fd.set("prenom", "Chloé");
  fd.set("nom", "Dubois");
  fd.set("email", email);
  fd.set("role", "MEMBRE");
  return fd;
}

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  faux.cible = { ...MEMBRE };
  faux.trace = [];
  faux.misAJour = [];
  faux.journal = [];
  faux.reauths = [];
  faux.codePerime = false;
});

describe("l'adresse seule, depuis la liste (`definirEmailMembre`)", () => {
  it("redemande le code avant d'écrire, puis seulement révoque et renvoie la clé", async () => {
    const res = await definirEmailMembre("m", undefined, {}, champEmail("attaquant@ailleurs.fr"));
    expect(res.succes).toBeTruthy();
    // L'ordre est la garde : le code d'abord, l'écriture ensuite, la clé neuve en dernier.
    expect(faux.trace).toEqual(["reauth", "ecriture", "revocation", "envoi"]);
    expect(faux.reauths).toEqual(["/admin/membres"]);
  });

  it("n'écrit rien et n'envoie aucune clé quand le code est trop vieux", async () => {
    faux.codePerime = true;
    await expect(definirEmailMembre("m", undefined, {}, champEmail("attaquant@ailleurs.fr"))).rejects.toThrow(/REDIRECTION/);
    expect(faux.trace).toEqual(["reauth"]);
    expect(faux.misAJour).toEqual([]);
    expect(faux.journal).toEqual([]);
  });

  it("le demande aussi pour une adresse ajoutée : elle arme le bouton « Envoyer le lien » d'à côté", async () => {
    faux.cible = { ...MEMBRE, email: null };
    await definirEmailMembre("m", undefined, {}, champEmail("chloe@exemple.fr"));
    expect(faux.reauths).toHaveLength(1);
    expect(faux.trace[0]).toBe("reauth");
  });

  it("le demande aussi pour une adresse retirée : c'est couper les messages de quelqu'un", async () => {
    await definirEmailMembre("m", undefined, {}, champEmail(""));
    expect(faux.reauths).toHaveLength(1);
    expect(faux.trace[0]).toBe("reauth");
  });

  it("ne le demande pas pour un enregistrement à blanc : rien ne change, rien à protéger", async () => {
    const res = await definirEmailMembre("m", undefined, {}, champEmail("chloe@exemple.fr"));
    expect(res.succes).toMatch(/inchangée/i);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual([]);
  });
});

describe("la fiche complète (`modifierMembre`), branche adresse", () => {
  it("redemande le code avant d'écrire quand l'adresse change", async () => {
    const res = await modifierMembre("m", {}, fiche("attaquant@ailleurs.fr"));
    expect(res.succes).toBeTruthy();
    expect(faux.trace).toEqual(["reauth", "ecriture", "revocation", "envoi"]);
    expect(faux.reauths).toEqual(["/admin/membres/m"]);
  });

  it("n'écrit rien quand le code est trop vieux", async () => {
    faux.codePerime = true;
    await expect(modifierMembre("m", {}, fiche("attaquant@ailleurs.fr"))).rejects.toThrow(/REDIRECTION/);
    expect(faux.trace).toEqual(["reauth"]);
    expect(faux.misAJour).toEqual([]);
    expect(faux.journal).toEqual([]);
  });

  /**
   * La contre-épreuve : enregistrer une fiche sans toucher ni au rôle ni à l'adresse ne redemande
   * rien. Sans elle, « la garde est là » se satisferait d'un `exigerReauth` posé en tête de fonction,
   * qui réclamerait un code à chaque correction de faute de frappe dans un nom — et qu'on finirait par
   * retirer pour cette raison.
   */
  it("ne le demande pas quand seul le nom change", async () => {
    const fd = fiche("chloe@exemple.fr");
    fd.set("nom", "Dubois-Delta");
    await modifierMembre("m", {}, fd);
    expect(faux.reauths).toEqual([]);
    expect(faux.trace).toEqual(["ecriture"]);
  });
});

/**
 * **L'autre moitié du couple** que CLAUDE.md nomme : « changer l'adresse de quelqu'un *et* lui
 * renvoyer son lien fait arriver ce lien chez soi ». Corriger la première moitié sans la seconde
 * aurait laissé la paire à moitié ouverte — et c'est **ce geste-ci** qui fait réellement partir la
 * clé, valable quatre mois.
 */
describe("renvoyer le lien de quelqu'un (`envoyerLienMembre`)", () => {
  it("redemande le code avant de faire partir la clé", async () => {
    await envoyerLienMembre("m", "p-active");
    expect(faux.trace).toEqual(["reauth", "envoi"]);
    expect(faux.reauths).toEqual(["/admin/membres"]);
    expect(faux.journal.map((j) => j.action)).toEqual(["invitation.renvoyee"]);
  });

  it("n'envoie aucune clé quand le code est trop vieux", async () => {
    faux.codePerime = true;
    await expect(envoyerLienMembre("m", "p-active")).rejects.toThrow(/REDIRECTION/);
    expect(faux.trace).toEqual(["reauth"]);
    expect(faux.journal).toEqual([]);
  });
});
