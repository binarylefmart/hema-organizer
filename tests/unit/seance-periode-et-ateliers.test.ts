import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deux trous du cycle de vie d'une séance, tous deux invisibles à l'écran.
 *
 * 1. **La liste déroulante « Période »** du formulaire de séance était lue, validée… puis jetée :
 *    `modifierSeance` déstructurait `periodId` dans une variable inutilisée. Choisir un autre
 *    trimestre et enregistrer affichait « Séance enregistrée » sans rien déplacer.
 * 2. **Supprimer une séance laissait les ateliers `PLANIFIE` orphelins** : la base détache
 *    (`onDelete: SetNull`) mais ne touche pas au statut. La règle est pourtant écrite et appliquée
 *    depuis `supprimerPeriode` — un atelier « planifié » sans date ne veut rien dire, il repasse
 *    « en attente ».
 */

const faux = vi.hoisted(() => ({
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `periods.manage` (l'effacement d'une séance) n'est ouverte à aucun instructeur, donc ce qui
  // aboutit ici ne passe que par `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, service: false, actif: true } as { id: string; email: string; role: string; estAdmin: boolean; actif: boolean },
  seances: [] as Array<{ id: string; date: string; heureDebut: string; periodId: string; statut: string }>,
  reponses: 0,
  /** Les séances dont l'annulation a fait partir des messages (email, Discord, Telegram). */
  prevenus: [] as string[],
  /** Les destinations passées à `exigerReauth` : la preuve que l'élévation est bien redemandée. */
  reauths: [] as string[],
  /** Les `updateMany` d'ateliers, dans l'ordre où la transaction les reçoit. */
  ateliersMaj: [] as Array<{ where: unknown; data: unknown }>,
  misesAJour: [] as Array<{ where: unknown; data: unknown }>,
  supprimees: [] as unknown[],
  transactions: 0,
  audits: [] as Array<{ action: string; cible: string | null; details: unknown }>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    session: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = faux.seances.find((x) => x.id === where.id);
        if (!s) throw new Error("Séance introuvable");
        return s;
      }),
      // La garde de période (`seancePourEcriture`) lit la séance **et** le statut de son trimestre.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = faux.seances.find((x) => x.id === where.id);
        return s ? { ...s, period: { statut: s.statut } } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; periodId: string } }) =>
        faux.seances.filter((s) => where.id.in.includes(s.id) && s.periodId === where.periodId),
      ),
      update: vi.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        faux.misesAJour.push({ where, data });
        return {};
      }),
      delete: vi.fn(async ({ where }: { where: unknown }) => {
        faux.supprimees.push(where);
        return faux.seances[0];
      }),
      deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
        faux.supprimees.push(where);
        return { count: 0 };
      }),
    },
    atelier: {
      updateMany: vi.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        faux.ateliersMaj.push({ where, data });
        return { count: 0 };
      }),
    },
    attendance: { count: vi.fn(async () => faux.reponses) },
    period: {
      findUniqueOrThrow: vi.fn(async () => ({})),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ statut: faux.seances.find((s) => s.periodId === where.id)?.statut ?? "ACTIVE" })),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    invitation: { updateMany: vi.fn(async () => ({ count: 0 })) },
    periodDateExclue: { createMany: vi.fn(async () => ({ count: 0 })), deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => {
      faux.transactions++;
      return Promise.all(operations);
    }),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

vi.mock("@/lib/notifications/seances", () => ({
  notifierAnnulation: vi.fn(async (sessionId: string) => {
    faux.prevenus.push(sessionId);
    return 3;
  }),
  phraseAnnulation: vi.fn(async (n: number) => `${n} membres prévenus`),
  porteurJetonAnnulation: vi.fn(async () => null),
}));

vi.mock("@/lib/invitations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invitations")>()),
  envoyerInvitation: vi.fn(async () => true),
  revokeInvitation: vi.fn(async () => {}),
}));

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
    getCurrentUser: vi.fn(async () => null),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { annulerSeance, enregistrerTheme, modifierSeance, retablirSeance, supprimerSeance } = await import("@/actions/seances");
const { supprimerSeancesPeriode } = await import("@/actions/periodes");

/** Le formulaire de séance, tel que `FormulaireSeance` l'envoie. */
function formulaireSeance(periodId: string): FormData {
  const fd = new FormData();
  for (const [nom, valeur] of Object.entries({
    periodId,
    date: "2026-10-06",
    heureDebut: "20:00",
    heureFin: "22:00",
    lieu: "Villebourg",
    adresse: "",
    theme: "Garde haute",
  })) {
    fd.append(nom, valeur);
  }
  return fd;
}

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  faux.seances = [
    // Dates lointaines : annuler et rétablir refusent un cours commencé (`seanceAnnulable`), et ces
    // séances doivent rester à venir quel que soit le jour où les tests tournent.
    { id: "s1", date: "2099-10-06", heureDebut: "20:00", periodId: "p1", statut: "ACTIVE" },
    { id: "s2", date: "2099-10-13", heureDebut: "20:00", periodId: "p1", statut: "ACTIVE" },
  ];
  faux.reponses = 0;
  faux.reauths = [];
  faux.prevenus = [];
  faux.ateliersMaj = [];
  faux.misesAJour = [];
  faux.supprimees = [];
  faux.transactions = 0;
  faux.audits = [];
});

describe("modifier une séance : la liste déroulante « Période »", () => {
  it("enregistre normalement quand la période affichée n'a pas changé", async () => {
    const etat = await modifierSeance("s1", {}, formulaireSeance("p1"));
    expect(etat.succes).toBe("Séance enregistrée.");
    expect(faux.misesAJour).toHaveLength(1);
    expect(faux.misesAJour[0].data).toMatchObject({ date: "2026-10-06", lieu: "Villebourg", theme: "Garde haute" });
    // Le trimestre n'est pas réécrit : il n'a pas bougé, et cette action ne le déplace pas.
    expect(faux.misesAJour[0].data).not.toHaveProperty("periodId");
  });

  it("refuse le déplacement vers un autre trimestre, et le dit au lieu de l'ignorer", async () => {
    const etat = await modifierSeance("s1", {}, formulaireSeance("p2"));
    expect(etat.succes).toBeUndefined();
    expect(etat.erreur).toMatch(/trimestre/i);
    // Rien n'est enregistré : ni le déplacement, ni les autres champs du formulaire.
    expect(faux.misesAJour).toEqual([]);
    expect(faux.audits).toEqual([]);
  });
});

describe("supprimer une séance : les ateliers ne restent pas orphelins", () => {
  it("repasse « en attente » les ateliers planifiés, détache les autres, puis efface", async () => {
    await expect(supprimerSeance("s1")).rejects.toThrow("REDIRECTION:/seances");
    expect(faux.ateliersMaj).toEqual([
      { where: { sessionId: "s1", statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } },
      { where: { sessionId: "s1" }, data: { sessionId: null } },
    ]);
    expect(faux.supprimees).toEqual([{ id: "s1" }]);
  });

  it("fait les trois gestes dans une seule transaction", async () => {
    await expect(supprimerSeance("s1")).rejects.toThrow("REDIRECTION:");
    expect(faux.transactions).toBe(1);
  });

  it("journalise la date de la séance effacée", async () => {
    await expect(supprimerSeance("s1")).rejects.toThrow("REDIRECTION:");
    expect(faux.audits).toEqual([{ action: "seance.supprimee", cible: "s1", details: { date: "2099-10-06", reponses: 0 } }]);
  });
});

describe("retirer des séances depuis l'écran de la période : même règle", () => {
  it("détache les ateliers des séances retirées avant de les effacer", async () => {
    const fd = new FormData();
    fd.append("supprimer", "s1");
    fd.append("supprimer", "s2");
    const etat = await supprimerSeancesPeriode("p1", {}, fd);
    expect(etat.succes).toBeDefined();
    expect(faux.ateliersMaj).toEqual([
      { where: { sessionId: { in: ["s1", "s2"] }, statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } },
      { where: { sessionId: { in: ["s1", "s2"] } }, data: { sessionId: null } },
    ]);
    expect(faux.transactions).toBe(1);
  });
});

/**
 * **Effacer une séance efface les réponses des membres : même serrure que le geste jumeau.**
 *
 * `supprimerSeancesPeriode`, qui retire les mêmes séances depuis l'écran de la période, exige
 * `periods.manage` **et** dit pourquoi dans son propre commentaire : « le geste efface les réponses
 * des membres pour ces dates […] il est donc réservé au bureau ». `supprimerSeance` se contentait de
 * `sessions.manage` : un instructeur vidait donc un trimestre séance par séance, depuis un bouton
 * qu'on lui affichait, alors que la même destruction en un clic lui était refusée deux écrans plus
 * loin. Deux portes vers la même destruction ne peuvent pas avoir deux serrures.
 */
describe("supprimer une séance : la serrure du bureau", () => {
  it("refuse un instructeur, qui n'a pas `periods.manage`", async () => {
    faux.acteur = { id: "u-charlie", email: "charlie@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    await expect(supprimerSeance("s1")).rejects.toThrow("Accès refusé");
    // Rien n'a bougé : ni les ateliers, ni la ligne, ni le journal.
    expect(faux.supprimees).toEqual([]);
    expect(faux.ateliersMaj).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("redemande l'élévation à l'administrateur, et le ramène sur la séance", async () => {
    await expect(supprimerSeance("s1")).rejects.toThrow("REDIRECTION:");
    expect(faux.reauths).toEqual(["/seances/s1"]);
  });

  it("journalise le nombre de réponses perdues — la seule trace qui restera", async () => {
    faux.reponses = 14;
    await expect(supprimerSeance("s1")).rejects.toThrow("REDIRECTION:");
    expect(faux.audits).toEqual([{ action: "seance.supprimee", cible: "s1", details: { date: "2099-10-06", reponses: 14 } }]);
  });
});

/**
 * **Une période close verrouille aussi ses séances.**
 *
 * Le planning refusait déjà toute écriture sur un trimestre clos ; la séance, non. Le cas le plus
 * lourd est l'**annulation** : elle fait partir un email à tous les invités, une annonce sur le salon
 * Discord et sur Telegram — à propos d'un cours d'un trimestre terminé, que plus personne n'attend.
 *
 * Le verrou ne se déduit pas de la date : on clôt un trimestre sans attendre son dernier cours, une
 * période close porte donc des séances à venir.
 */
describe("période close : la séance se verrouille avec son trimestre", () => {
  beforeEach(() => {
    for (const s of faux.seances) s.statut = "CLOSE";
  });

  it("l'annulation est refusée, et rien ne part", async () => {
    const fd = new FormData();
    fd.append("sessionId", "s1");
    fd.append("motif", "Salle indisponible");
    const etat = await annulerSeance({}, fd);
    expect(etat.erreur).toMatch(/clos/i);
    expect(faux.prevenus).toEqual([]);
    expect(faux.misesAJour).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("l'autosave du thème est refusée — le chemin le plus discret vers la base", async () => {
    const etat = await enregistrerTheme({ sessionId: "s1", theme: "Garde haute" });
    expect(etat.erreur).toMatch(/clos/i);
    expect(faux.misesAJour).toEqual([]);
  });

  it("l'enregistrement du formulaire de séance est refusé", async () => {
    const etat = await modifierSeance("s1", {}, formulaireSeance("p1"));
    expect(etat.erreur).toMatch(/clos/i);
    expect(faux.misesAJour).toEqual([]);
  });

  it("la suppression est refusée, avant même l'élévation", async () => {
    await expect(supprimerSeance("s1")).rejects.toThrow(/clos/i);
    expect(faux.supprimees).toEqual([]);
    expect(faux.reauths).toEqual([]);
  });

  it("le rétablissement est refusé : un trimestre clos est de l'histoire", async () => {
    await expect(retablirSeance("s1")).rejects.toThrow(/clos/i);
    expect(faux.misesAJour).toEqual([]);
  });

  it("mais un trimestre ouvert laisse passer l'annulation, et les messages partent", async () => {
    for (const s of faux.seances) s.statut = "ACTIVE";
    const fd = new FormData();
    fd.append("sessionId", "s1");
    fd.append("motif", "Salle indisponible");
    const etat = await annulerSeance({}, fd);
    expect(etat.succes).toContain("3 membres prévenus");
    expect(faux.prevenus).toEqual(["s1"]);
  });
});
