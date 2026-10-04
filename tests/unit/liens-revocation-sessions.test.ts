import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Révoquer un lien ne ferme rien tout seul.**
 *
 * Défaut, trouvé par relecture adverse. À la 13ᵉ ouverture dans l'heure, un lien est jugé diffusé :
 * `signalerOuverture` le révoque (`SUSPECT`) puis appelle `envoyerInvitation` avec
 * `deconnecterAppareils: "tous"`. Mais la déconnexion est portée par `createInvitation`, tout au
 * bout de `envoyerInvitation` — et `envoyerInvitation` **sort avant** d'y arriver quand le compte
 * n'a pas d'adresse email (un état normal : effacer une adresse ne révoque rien), comme lorsque la
 * période est close. Le lien était donc marqué suspect et **aucune session n'était fermée**. Or
 * `touchSession` est une fenêtre *glissante* de 12 h : un porteur qui ouvre l'application une fois
 * par demi-journée gardait son accès **indéfiniment** sur un lien révoqué pour diffusion — le cas
 * exact pour lequel la règle existe.
 *
 * La jumelle `verifierAppareils` avait déjà le filet (`if (!envoye) await revokeAllSessions(...)`) ;
 * ce fichier l'exige des deux, et exige en plus que l'issue remonte **jusqu'à l'écran** : promettre
 * « un nouveau lien vient d'être envoyé par email » à qui n'en recevra aucun l'envoie attendre devant
 * une boîte vide au lieu d'utiliser la seule porte qui lui reste.
 */

const faux = vi.hoisted(() => ({
  /** Le limiteur a-t-il encore de la place ? `false` = seuil franchi, le lien est jugé diffusé. */
  admis: false,
  periode: { statut: "ACTIVE" } as { statut: string } | null,
  compte: { email: "chloe@club.test" } as { email: string | null },
  revocations: [] as { id: string; motif: string | null }[],
  liensCrees: [] as { userId: string; periodId: string }[],
  envois: [] as { to: string; ref: string }[],
  deconnexions: [] as { userId: string; saufCourante: boolean }[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    authSession: { count: vi.fn(async () => 0) },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, ...faux.compte, passwordHash: null })),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, prenom: "Chloé", email: faux.compte.email, service: false })),
    },
    period: {
      findUnique: vi.fn(async () => faux.periode),
      findUniqueOrThrow: vi.fn(async () => ({ nom: "T4 2026", ...(faux.periode ?? {}) })),
    },
    invitation: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { motifRevocation?: string } }) => {
        faux.revocations.push({ id: where.id, motif: data.motifRevocation ?? null });
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: { userId: string; periodId: string } }) => {
        faux.liensCrees.push({ userId: data.userId, periodId: data.periodId });
        return {};
      }),
    },
    periodMember: { upsert: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/lib/identite", () => ({ identite: vi.fn(async () => ({ nomCourt: "CEA Organizer" })) }));
vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((message: { to: string; ref: string }) => {
    faux.envois.push({ to: message.to, ref: message.ref });
  }),
}));
vi.mock("@/lib/notifications/journal", () => ({ journaliser: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => faux.admis) }));
vi.mock("@/lib/auth/session", () => ({
  revokeAllSessions: vi.fn(async (userId: string, saufCourante = false) => {
    faux.deconnexions.push({ userId, saufCourante });
    return 0;
  }),
}));

const { signalerOuverture, renouvelerLien } = await import("@/lib/invitations");

/** Le lien de Chloé, tel que `checkInvitation` le rend à la page d'entrée. */
const LIEN = { id: "inv-1", userId: "u-chloe", periodId: "p-1", tokenHash: "hash-du-lien" };

beforeEach(() => {
  faux.admis = false;
  faux.periode = { statut: "ACTIVE" };
  faux.compte = { email: "chloe@club.test" };
  faux.revocations.length = 0;
  faux.liensCrees.length = 0;
  faux.envois.length = 0;
  faux.deconnexions.length = 0;
});

describe("un lien révoqué pour diffusion suspecte ferme toujours ses sessions", () => {
  it("sous le seuil, rien ne bouge", async () => {
    faux.admis = true;
    expect(await signalerOuverture(LIEN)).toBe("rien");
    expect(faux.revocations).toHaveLength(0);
    expect(faux.deconnexions).toHaveLength(0);
  });

  it("avec une adresse email : lien remplacé, email parti, appareils déconnectés", async () => {
    expect(await signalerOuverture(LIEN)).toBe("remplace");
    expect(faux.revocations).toEqual([{ id: "inv-1", motif: "SUSPECT" }]);
    expect(faux.liensCrees).toEqual([{ userId: "u-chloe", periodId: "p-1" }]);
    expect(faux.envois[0]?.to).toBe("chloe@club.test");
    // La déconnexion est portée par `createInvitation` (`deconnecterAppareils: "tous"`).
    expect(faux.deconnexions).toEqual([{ userId: "u-chloe", saufCourante: false }]);
  });

  /** **Le défaut corrigé.** Sans adresse, aucun lien ne part — et pourtant tout doit tomber. */
  it("sans adresse email : aucun lien ne part, mais les appareils tombent quand même", async () => {
    faux.compte = { email: null };
    expect(await signalerOuverture(LIEN)).toBe("remplace-sans-email");
    expect(faux.revocations).toEqual([{ id: "inv-1", motif: "SUSPECT" }]);
    expect(faux.envois).toHaveLength(0);
    expect(faux.liensCrees).toHaveLength(0);
    expect(faux.deconnexions).toEqual([{ userId: "u-chloe", saufCourante: false }]);
  });

  /** Même chose sur une période close : on n'émet pas de lien, on coupe quand même. */
  it("période close : aucun lien ne part, les appareils tombent", async () => {
    faux.periode = { statut: "CLOSE" };
    expect(await signalerOuverture(LIEN)).toBe("remplace-sans-email");
    expect(faux.revocations).toEqual([{ id: "inv-1", motif: "SUSPECT" }]);
    expect(faux.envois).toHaveLength(0);
    expect(faux.deconnexions).toEqual([{ userId: "u-chloe", saufCourante: false }]);
  });
});

/**
 * **Un lien expiré : trois issues, parce que l'écran d'après doit dire laquelle.** L'écran s'appelait
 * « Lien renouvelé » et annonçait un envoi dans tous les cas, y compris sur une période close ou pour
 * une fiche sans adresse, où rien ne pouvait partir.
 */
describe("le renouvellement d'un lien expiré dit ce qui s'est vraiment passé", () => {
  const EXPIRE = { id: "inv-1", userId: "u-chloe", periodId: "p-1" };

  it("un email part : « envoye »", async () => {
    faux.admis = true;
    expect(await renouvelerLien(EXPIRE)).toBe("envoye");
    expect(faux.envois[0]?.to).toBe("chloe@club.test");
  });

  it("période close : « impossible », et rien n'est émis", async () => {
    faux.admis = true;
    faux.periode = { statut: "CLOSE" };
    expect(await renouvelerLien(EXPIRE)).toBe("impossible");
    expect(faux.envois).toHaveLength(0);
    expect(faux.liensCrees).toHaveLength(0);
  });

  it("fiche sans adresse : « impossible » — et le plafond du jour n'est pas consommé pour rien", async () => {
    faux.admis = true;
    faux.compte = { email: null };
    expect(await renouvelerLien(EXPIRE)).toBe("impossible");
    expect(faux.envois).toHaveLength(0);
    // L'adresse est vérifiée **avant** `renouvellement_user` : sinon, retrouver son adresse dans
    // l'heure obligerait à attendre 24 h.
    const { checkRateLimit } = await import("@/lib/auth/rate-limit");
    expect(vi.mocked(checkRateLimit)).not.toHaveBeenCalled();
  });

  it("déjà renouvelé aujourd'hui : « deja-envoye » — un lien neuf est bien parti, l'écran peut le dire", async () => {
    faux.admis = false; // le plafond d'un renouvellement par jour et par personne
    expect(await renouvelerLien(EXPIRE)).toBe("deja-envoye");
    expect(faux.envois).toHaveLength(0);
  });
});

/**
 * L'issue ne sert à rien si elle s'arrête à l'action : ces vérifications lisent le source, comme
 * celles de `liens-appareils.test.ts`, parce que c'est exactement ce qu'on veut figer — **quel écran
 * répond à quelle issue**.
 */
describe("aucun écran ne promet un email qui n'est pas parti", () => {
  const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

  it("la page de connexion a un message par issue, et celui « sans email » ne parle pas de boîte mail", () => {
    const page = lire("src/app/(public)/connexion/page.tsx");
    for (const cle of ['"suspect-sans-email"', '"appareils-sans-email"']) expect(page).toContain(cle);
    const sansEmail = /"(suspect|appareils)-sans-email":\s*\n?\s*"([^"]+)"/g;
    const messages = [...page.matchAll(sansEmail)].map((m) => m[2]);
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      // Ni « vient d'être envoyé », ni « regarde ta boîte mail » : rien n'est parti.
      expect(message).not.toMatch(/vient d'être envoyé|viens de partir|boîte mail/);
      expect(message).toContain("mot de passe");
    }
  });

  it("l'ouverture d'un lien aiguille vers le bon message", () => {
    const actions = lire("src/actions/auth.ts");
    expect(actions).toContain('redirect(suspect === "remplace" ? "/connexion?erreur=suspect" : "/connexion?erreur=suspect-sans-email");');
    expect(actions).toContain('redirect(appareils === "remplace" ? "/connexion?erreur=appareils" : "/connexion?erreur=appareils-sans-email");');
  });

  /**
   * **La garantie n'a pas bougé, son point d'application oui**.
   *
   * L'écran ne doit jamais annoncer un email qui n'est pas parti — c'est le défaut d'origine : il
   * s'intitulait « Lien renouvelé » dans tous les cas, y compris quand rien ne pouvait partir (période
   * close, fiche sans adresse). La page tranchait alors elle-même, sur l'issue de l'écriture qu'elle
   * faisait **au rendu d'un GET**.
   *
   * Cette écriture-là est partie dans une action (POST) : la page ne peut donc plus rien promettre, et
   * c'est la réponse de l'action qui parle. Ce qui se vérifie ici, désormais : la page **n'écrit pas**,
   * et l'action distingue les trois issues au lieu d'en annoncer une seule.
   */
  it("l'écran du lien expiré n'annonce un envoi que si un lien est parti", () => {
    const page = lire("src/app/(public)/invitation/[token]/page.tsx");
    expect(page).not.toContain("renouvelerLien(");
    expect(page).toContain('titre="Lien expiré"');

    const actions = lire("src/actions/auth.ts");
    const corps = actions.slice(actions.indexOf("export async function renvoyerLienExpire"));
    const action = corps.slice(0, corps.indexOf("\n}\n"));
    // Les trois issues de `renouvelerLien`, chacune avec son mot : rien n'est promis à tort.
    expect(action).toContain('if (issue === "impossible")');
    expect(action).toContain('issue === "deja-envoye"');
    expect(action).toMatch(/succes:/);
    // Et un lien qui n'est pas expiré ne se fait pas remplacer par cette porte.
    expect(action).toContain('check.raison !== "expiree"');
  });

  /**
   * **Coller son lien ou l'ouvrir revient exactement au même** — ce que le docstring de
   * `ouvrirParLienColle` affirmait sans que ce soit vrai : un lien expiré collé sortait en message de
   * refus, sans jamais déclencher le renouvellement que la page déclenche. Or ce champ existe pour qui
   * **ne peut pas** ouvrir l'URL (application installée sur iPhone, pas de barre d'adresse).
   */
  it("un lien expiré collé déclenche le même renouvellement que la page", () => {
    const actions = lire("src/actions/auth.ts");
    const corps = actions.slice(actions.indexOf("export async function ouvrirParLienColle"));
    const action = corps.slice(0, corps.indexOf("\n}\n"));
    expect(action).toContain('check?.raison === "expiree"');
    expect(action).toContain("await renouvelerLien(check.invitation)");
    // Et le message reste muet sur la saisie, comme tous les autres de cette action.
    expect(action).not.toMatch(/erreur:.*\btoken\b/);
  });
});

/**
 * **Les trois portes du lien personnel comptent la même chose.**
 *
 * Un jeton inconnu est compté par IP (`invitation_inconnue_ip`, 8 par heure), journalisé
 * (`invitation.lien_inconnu`) et surveillé (`surveillerLiensInconnus`) — sinon la porte devient le
 * guichet tranquille où un robot essaie des jetons. La page du lien le faisait sur son GET, le
 * champ « colle ton lien ici » aussi ; **le bouton de la page, qui est une requête à part, ne le
 * faisait pas**.
 */
describe("aucune porte n'est un guichet tranquille", () => {
  const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

  /** Le corps d'une fonction exportée de `src/actions/auth.ts`. */
  function corpsDe(nom: string): string {
    const actions = lire("src/actions/auth.ts");
    const depuis = actions.slice(actions.indexOf(`export async function ${nom}`));
    return depuis.slice(0, depuis.indexOf("\n}\n"));
  }

  it("les trois comptent, journalisent et surveillent un jeton inconnu", () => {
    const portes = [corpsDe("connexionParInvitation"), corpsDe("ouvrirParLienColle"), lire("src/app/(public)/invitation/[token]/page.tsx")];
    for (const porte of portes) {
      expect(porte).toContain('checkRateLimit("invitation_inconnue_ip"');
      expect(porte).toContain('"invitation.lien_inconnu"');
      expect(porte).toContain("surveillerLiensInconnus()");
    }
  });

  it("et aucune ne recopie le jeton dans son journal", () => {
    for (const nom of ["connexionParInvitation", "ouvrirParLienColle"]) {
      expect(corpsDe(nom), nom).not.toMatch(/audit\([^)]*\btoken\b/);
    }
  });
});
