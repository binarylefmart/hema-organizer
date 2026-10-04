import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **La réponse du club à une proposition d'atelier**, depuis les deux écrans qui la donnent.
 *
 * C'était le seul envoi de l'application à s'être écarté des règles du dossier, sur trois points :
 *
 * 1. **`envoiPossible` était contourné** : seul le réglage du club était consulté, jamais l'état réel
 *    du canal. Sans serveur SMTP, l'email partait dans le vide et l'écran annonçait quand même au
 *    bureau « le membre est prévenu par email ».
 * 2. **Rien n'était journalisé** : aucune ligne dans `NotificationLog`, donc aucune protection
 *    contre un double appui et aucune reprise après un échec d'envoi.
 * 3. **La clé du push bloquait un second refus** : elle ne portait que le statut, donc une
 *    proposition refusée, remise en attente, puis refusée de nouveau ne réveillait plus personne.
 */

type LigneLog = { type: string; canal: string; userId: string | null; dedupKey: string; statut: string; erreur: string | null };
type FauxAtelier = {
  id: string;
  titre: string;
  statut: string;
  sessionId: string | null;
  commentaireInstructeur: string | null;
  updatedAt: Date;
  proposePar: { id: string; prenom: string; email: string | null; actif: boolean; rappelEmail: boolean; preferencesNotifications: string | null };
};

const faux = vi.hoisted(() => ({
  acteur: { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", actif: true },
  ateliers: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; ref?: string }>,
  push: [] as Array<{ userId: string; titre: string }>,
  echecEmail: null as Error | null,
  canaux: { email: true, push: true } as Record<string, boolean>,
  /** Chaque écriture avance l'horloge : c'est `updatedAt` qui date la décision. */
  horloge: 1_000_000,
  /** Statut de la période de la séance : une période close ne laisse plus écrire dans son planning. */
  statutPeriode: "ACTIVE",
  /** Ce que la case visée porte déjà — vide par défaut, puisque c'est la seule case où un atelier se pose. */
  case: {} as Record<string, unknown>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: vi.fn(async () => null) },
    atelier: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = faux.ateliers.find((x) => x.id === where.id);
        if (!a) throw new Error("introuvable");
        return { ...a };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = faux.ateliers.find((x) => x.id === where.id);
        return a ? { ...a } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const a = faux.ateliers.find((x) => x.id === where.id);
        if (!a) throw new Error("introuvable");
        faux.horloge += 60_000;
        Object.assign(a, data, { updatedAt: new Date(faux.horloge) });
        return { ...a };
      }),
    },
    session: {
      // `period` est lu par deux chemins : la porte du planning (`partiePourEcriture`) et, celle de
      // la file des propositions — placer un atelier écrit dans le planning.
      findUnique: vi.fn(async () => ({
        id: "s-1",
        date: "2126-10-01",
        heureDebut: "19:30",
        lieu: "Gymnase municipal",
        annulee: false,
        period: { statut: faux.statutPeriode },
      })),
      findUniqueOrThrow: vi.fn(async () => ({ date: "2126-10-01", heureDebut: "19:30", lieu: "Gymnase municipal" })),
    },
    // La partie visée depuis le planning : c'est elle qui porte la séance et sa période, depuis que
    // le nom de la partie n'est plus sa clé. Son **contenu** compte aussi : un atelier ne se pose que
    // dans une case vide.
    sessionPartie: {
      findUnique: vi.fn(async () => ({
        id: "c-2",
        sessionId: "s-1",
        libelle: "Cours 2",
        atelierId: null,
        instructeurId: null,
        instructeurSecondId: null,
        theme: "",
        description: "",
        niveau: "INDIFFERENT",
        ...faux.case,
        session: { id: "s-1", date: "2126-10-01", period: { statut: faux.statutPeriode } },
      })),
    },
    notificationLog: {
      findUnique: vi.fn(async (args: { where: { dedupKey: string } }) => faux.logs.find((l) => l.dedupKey === args.where.dedupKey) ?? null),
      findMany: vi.fn(async (args: { where: { dedupKey: { in: string[] } } }) =>
        faux.logs.filter((l) => args.where.dedupKey.in.includes(l.dedupKey as string)).map((l) => ({ dedupKey: l.dedupKey })),
      ),
      create: vi.fn(async ({ data }: { data: LigneLog }) => {
        if (faux.logs.some((l) => l.dedupKey === data.dedupKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        faux.logs.push({ ...data });
        return data;
      }),
      update: vi.fn(async ({ where, data }: { where: { dedupKey: string }; data: Partial<LigneLog> }) => {
        const ligne = faux.logs.find((l) => l.dedupKey === where.dedupKey);
        if (!ligne) throw new Error("introuvable");
        Object.assign(ligne, data);
        return ligne;
      }),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ assertPermission: vi.fn(async () => faux.acteur), getCurrentUser: vi.fn(async () => faux.acteur) }));
vi.mock("@/lib/planning", async () => {
  /*
   * **La règle « case vide » n'est pas recopiée ici** : on lit celle du module pur
   * (`reglagesVides`), exactement celle que le serveur applique et que l'écran applique pour décider
   * s'il propose les ateliers. Un faux garde-fou dans un test vaut moins que pas de test du tout.
   */
  const { reglagesVides } = await import("@/components/planning/options");
  return {
    partieLibre: (p: Record<string, unknown>) =>
      !p.atelierId &&
      reglagesVides({
        instructeur: p.instructeurId as string | null,
        instructeurSecond: p.instructeurSecondId as string | null,
        theme: p.theme as string,
        description: p.description as string,
        niveau: p.niveau as string,
      }),
    placerAtelier: vi.fn(async () => {}),
    retirerAtelier: vi.fn(async () => {}),
    nettoyerThemes: vi.fn(() => []),
    setLieux: vi.fn(async () => {}),
    setThemes: vi.fn(async () => {}),
    synchroniserSeance: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; ref?: string }, onDone?: (err: Error | null) => void) => {
    faux.emails.push(mail);
    onDone?.(faux.echecEmail);
  }),
}));

vi.mock("@/lib/notifications/push", () => ({
  pushConfigure: vi.fn(async () => true),
  notifierPersonnes: vi.fn(async (userIds: readonly string[], charge: (id: string) => { titre: string }) => {
    for (const userId of userIds) faux.push.push({ userId, ...charge(userId) });
    return new Map(userIds.map((id) => [id, { appareils: 1, atteints: 1 }]));
  }),
}));

/** L'état réel des canaux : c'est justement ce que l'ancien code ne regardait pas. */
vi.mock("@/lib/notifications/canaux", () => ({
  envoiPossible: vi.fn(async (_type: string, canal: string) => faux.canaux[canal] === true),
  canalOperationnel: vi.fn(async (canal: string) => faux.canaux[canal] === true),
}));

const { deciderAtelier } = await import("@/actions/ateliers");
const { programmerAtelierDansCase } = await import("@/actions/planning");

const PROPOSEUR = { id: "u-golf", prenom: "Golf", email: "golf@club.test", actif: true, rappelEmail: true, preferencesNotifications: null };

function atelier(statut = "PROPOSE"): FauxAtelier {
  return { id: "at-1", titre: "Échauffement à la corde", statut, sessionId: null, commentaireInstructeur: null, updatedAt: new Date(faux.horloge), proposePar: { ...PROPOSEUR } };
}

function decision(statut: string, commentaire = ""): FormData {
  const fd = new FormData();
  fd.set("atelierId", "at-1");
  fd.set("statut", statut);
  fd.set("commentaire", commentaire);
  fd.set("sessionId", statut === "PLANIFIE" ? "s-1" : "");
  return fd;
}

beforeEach(() => {
  faux.acteur = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", actif: true };
  faux.horloge = 1_000_000;
  faux.ateliers = [atelier()];
  faux.logs = [];
  faux.emails = [];
  faux.push = [];
  faux.echecEmail = null;
  faux.canaux = { email: true, push: true };
  faux.statutPeriode = "ACTIVE";
  faux.case = {};
});

describe("réponse à une proposition : ce qui part, et ce qui en reste au journal", () => {
  it("écrit au membre, le réveille sur son téléphone, et journalise les deux séparément", async () => {
    const res = await deciderAtelier({}, decision("REFUSE", "Pas cette fois."));
    expect(res.succes).toContain("le membre est prévenu par email");
    expect(faux.emails.map((e) => e.to)).toEqual(["golf@club.test"]);
    expect(faux.push.map((p) => p.titre)).toEqual(["Réponse à ta proposition"]);
    expect(faux.logs.map((l) => l.canal).sort()).toEqual(["EMAIL", "PUSH"]);
    expect(faux.logs.every((l) => l.type === "ATELIER" && l.userId === "u-golf")).toBe(true);
  });

  /**
   * Le point 1 : sans serveur d'envoi, plus rien ne doit partir — et surtout, l'écran ne doit plus
   * annoncer au bureau un email qui ne partira jamais.
   */
  it("n'écrit rien, et ne le promet pas, quand le canal email n'est pas branché", async () => {
    faux.canaux = { email: false, push: true };
    const res = await deciderAtelier({}, decision("REFUSE"));
    expect(faux.emails).toEqual([]);
    expect(res.succes).toBe("Atelier refusé.");
    expect(faux.logs.some((l) => l.canal === "EMAIL")).toBe(false);
    // Le téléphone, lui, reste ouvert : les deux canaux se décident séparément.
    expect(faux.push).toHaveLength(1);
  });

  it("ne double pas le message quand la même décision est enregistrée deux fois", async () => {
    await deciderAtelier({}, decision("REFUSE"));
    const cle = String(faux.logs.find((l) => l.canal === "EMAIL")?.dedupKey);
    // Un second appui sur le même bouton : la transition REFUSE → REFUSE est refusée en amont, mais
    // la clé, elle, resterait prise même si l'action était rejouée telle quelle.
    faux.ateliers = [{ ...atelier("PROPOSE"), updatedAt: new Date(faux.horloge) }];
    faux.horloge -= 60_000; // l'écriture retombe sur le même horodatage
    await deciderAtelier({}, decision("REFUSE"));
    expect(faux.emails).toHaveLength(1);
    expect(faux.logs.filter((l) => l.dedupKey === cle)).toHaveLength(1);
  });

  /**
   * Le point 3 : refusé, réexaminé, refusé de nouveau. La seconde réponse est une vraie réponse —
   * elle doit arriver, sur les deux canaux.
   */
  it("reprévient au second refus, après un réexamen", async () => {
    await deciderAtelier({}, decision("REFUSE"));
    faux.ateliers = [{ ...faux.ateliers[0], statut: "REFUSE" }];
    await deciderAtelier({}, decision("PROPOSE")); // réexamen : rien ne part
    expect(faux.emails).toHaveLength(1);
    expect(faux.push).toHaveLength(1);

    await deciderAtelier({}, decision("REFUSE", "Toujours pas, désolé."));
    expect(faux.emails).toHaveLength(2);
    expect(faux.push).toHaveLength(2);
    // Deux clés distinctes : c'est l'horodatage de la décision qui les sépare.
    expect(new Set(faux.logs.filter((l) => l.canal === "PUSH").map((l) => l.dedupKey)).size).toBe(2);
  });

  it("libère la clé quand l'email échoue, sans faire échouer la décision", async () => {
    faux.echecEmail = new Error("SMTP : connexion refusée");
    await expect(deciderAtelier({}, decision("REFUSE"))).resolves.toMatchObject({ succes: expect.stringContaining("Atelier refusé") });
    const ligne = faux.logs.find((l) => l.canal === "EMAIL");
    expect(ligne?.statut).toBe("ECHEC");
    expect(String(ligne?.dedupKey)).toContain("_echec_");
  });

  it("ne dit rien au membre pour un retrait du planning ou un réexamen", async () => {
    faux.ateliers = [atelier("PLANIFIE")];
    await deciderAtelier({}, decision("PROPOSE"));
    expect(faux.emails).toEqual([]);
    expect(faux.push).toEqual([]);
    expect(faux.logs).toEqual([]);
  });

  /**
   * **Deux portes, une seule serrure**. Placer un atelier écrit dans le planning (`placerAtelier`
   * remplit une case, et en crée une s'il n'y a pas la place). La porte de la grille passe par
   * `partiePourEcriture`, qui refuse une période close ; celle-ci ne vérifiait que « à venir et non
   * annulée ». Or une période close **peut** porter des séances à venir — on clôt un trimestre sans
   * attendre son dernier cours —, et le planning y restait modifiable par ce chemin.
   */
  it("refuse de placer un atelier dans le planning d'une période close", async () => {
    faux.statutPeriode = "CLOSE";
    const res = await deciderAtelier({}, decision("PLANIFIE"));
    expect(res.erreur).toMatch(/close/);
    expect(faux.ateliers[0].statut).toBe("PROPOSE");
    expect(faux.emails).toEqual([]);
    expect(faux.logs).toEqual([]);
  });

  it("place l'atelier quand la période est ouverte : le refus ne vient que de la clôture", async () => {
    // Contre-épreuve de la précédente, sur le même chemin et le même formulaire.
    const res = await deciderAtelier({}, decision("PLANIFIE"));
    expect(res.succes).toContain("Atelier placé dans le planning");
    expect(faux.ateliers[0].statut).toBe("PLANIFIE");
  });

  it("écarte en silence une personne sans adresse, mais la réveille sur son téléphone", async () => {
    faux.ateliers = [{ ...atelier(), proposePar: { ...PROPOSEUR, email: null } }];
    const res = await deciderAtelier({}, decision("REFUSE"));
    expect(faux.emails).toEqual([]);
    expect(res.succes).toBe("Atelier refusé.");
    expect(faux.push).toHaveLength(1);
  });
});

describe("la même réponse depuis le planning", () => {
  it("emprunte exactement le même chemin : email, téléphone et journal", async () => {
    const res = await programmerAtelierDansCase({ partieId: "c-2", atelierId: "at-1" });
    expect(res.succes).toContain("le membre est prévenu par email");
    expect(faux.emails.map((e) => e.to)).toEqual(["golf@club.test"]);
    expect(faux.push.map((p) => p.titre)).toEqual(["Ton atelier est programmé"]);
    expect(faux.logs.map((l) => l.canal).sort()).toEqual(["EMAIL", "PUSH"]);
  });

  it("ne promet pas d'email quand le canal n'est pas branché", async () => {
    faux.canaux = { email: false, push: false };
    const res = await programmerAtelierDansCase({ partieId: "c-2", atelierId: "at-1" });
    expect(res.succes).toBe("Atelier programmé.");
    expect(faux.emails).toEqual([]);
    expect(faux.logs).toEqual([]);
  });

  /**
   * **Un atelier ne se pose jamais par-dessus le travail de quelqu'un**.
   *
   * Le groupe « Programmer un atelier en attente » vit au bas de la liste **Thème** de la case, et
   * placer un atelier **remplace** les cinq réglages (`placerAtelier` : instructeur = le proposant,
   * second à `null`, thème = le titre, description vidée, niveau ramené à *indifférent*). Le seul
   * garde-fou était « pas d'autre atelier ici » : on ouvrait la liste pour corriger un mot, on
   * descendait, on cliquait — et « Cours 1 » perdait Alice, Charlie, « Messer », son niveau et sa
   * description, sans confirmation. Le journal, lui, ne gardait rien de ce qui partait.
   *
   * C'est l'asymétrie qui se ferme : `enregistrerCase` refuse une case occupée par un atelier,
   * `retirerPartie` refuse la partie qu'un atelier occupe — poser un atelier sur une case remplie
   * était le seul sens resté ouvert.
   */
  it.each([
    ["un instructeur", { instructeurId: "u-alice" }],
    ["un second instructeur", { instructeurSecondId: "u-charlie" }],
    ["un thème", { theme: "Messer" }],
    ["une description", { description: "Garde haute, trois passes lentes." }],
    ["un niveau annoncé", { niveau: "DEBUTANT" }],
  ])("refuse de s'installer sur une case qui porte déjà %s", async (_quoi, contenu) => {
    faux.case = contenu;
    const res = await programmerAtelierDansCase({ partieId: "c-2", atelierId: "at-1" });
    expect(res.erreur).toMatch(/porte déjà un programme/);
    expect(res.erreur).toContain("Cours 2");
    // Rien n'est écrit, rien ne part, et le membre n'apprend pas une décision qui n'a pas eu lieu.
    expect(faux.ateliers[0].statut).toBe("PROPOSE");
    expect(faux.emails).toEqual([]);
    expect(faux.push).toEqual([]);
    expect(faux.logs).toEqual([]);
  });

  it("s'installe en revanche dans une case vide — y compris quand le niveau y vaut « indifférent »", async () => {
    // Contre-épreuve de la précédente : `INDIFFERENT` n'est **pas** un réglage, rien ne s'affiche.
    faux.case = { niveau: "INDIFFERENT", theme: "   " };
    const res = await programmerAtelierDansCase({ partieId: "c-2", atelierId: "at-1" });
    expect(res.succes).toContain("Atelier programmé");
    expect(faux.ateliers[0].statut).toBe("PLANIFIE");
  });
});

/**
 * **Deux appuis *simultanés* sur « Refuser »** — le quatrième point, relevé.
 *
 * La clé porte l'horodatage de la décision pour qu'un second refus (après « réexaminer ») reparte.
 * Prise à la milliseconde, elle rouvrait la porte qu'elle devait fermer : deux requêtes qui se
 * croisent lisent toutes les deux un atelier encore `PROPOSE`, écrivent toutes les deux la ligne, et
 * en ressortent avec deux `updatedAt` différents — donc deux clés, donc **deux emails identiques**
 * au membre. L'horodatage est donc ramené à sa fenêtre.
 */
describe("fenêtre d'une même décision", () => {
  it("deux écritures qui se croisent retombent sur la même clé", async () => {
    const { fenetreDecision, cleDecisionAtelierEmail } = await import("@/lib/notifications/ateliers");
    // Quelques millisecondes d'écart : le temps d'un UPDATE entre deux requêtes concurrentes.
    const cle = (t: number) => cleDecisionAtelierEmail("a1", "REFUSE", fenetreDecision(t), "u1");
    expect(cle(1_790_420_718_149)).toBe(cle(1_790_420_718_152));
  });

  it("deux décisions séparées par le temps d'un humain restent deux messages", async () => {
    const { fenetreDecision, cleDecisionAtelierEmail } = await import("@/lib/notifications/ateliers");
    const cle = (t: number) => cleDecisionAtelierEmail("a1", "REFUSE", fenetreDecision(t), "u1");
    // Refuser, rouvrir, refuser de nouveau : une minute plus tard au mieux.
    expect(cle(1_790_420_718_149)).not.toBe(cle(1_790_420_778_149));
  });

  it("la fenêtre reste très en deçà du temps d'une décision humaine", async () => {
    const { FENETRE_DECISION_MS } = await import("@/lib/notifications/ateliers");
    expect(FENETRE_DECISION_MS).toBeLessThanOrEqual(30_000);
  });
});
