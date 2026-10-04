import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Une modification n'est pas une publication**.
 *
 * L'enregistrement d'une annonce rappelait `notifierNouvelEvenement` à chaque fois, en s'en remettant
 * à la déduplication par identifiant. Or cette déduplication ne protège **qu'un canal déjà branché au
 * moment de la publication** :
 *
 * - **Telegram** est arrivé en v0.51 : un événement publié avant n'a aucune clé
 *   `evenement_telegram_<id>`, donc la première correction de faute de frappe l'annonçait au groupe ;
 * - **Discord** tombe dans le même piège dès que `discordMessageId` est nul — annonce antérieure au
 *   branchement du salon, ou message effacé à la main ;
 * - l'email et le téléphone, eux, tenaient : leurs clés existent depuis le début. Ils sont vérifiés
 *   ici quand même, pour que le jour où un cinquième canal arrive, la règle soit déjà écrite.
 *
 * La règle, désormais : **une annonce ne part que si l'événement vient d'être publié**. Tout le reste
 * n'est que synchronisation du salon (message édité, jamais posté).
 *
 * Tout est simulé : la base, la file d'emails, le transport push, le webhook Discord et l'API
 * Telegram. Rien ne sort.
 */

type LigneLog = { type: string; canal: string; sessionId: string | null; userId: string | null; dedupKey: string; statut: string; erreur: string | null };

const SALON = "https://discord.test/webhook";

const faux = vi.hoisted(() => ({
  // Rôle de base + `estAdmin` : « ADMIN » n'est plus une valeur de `role`. `MEMBRE` ici, pour que
  // les droits sur une annonce ne puissent venir que du supplément et non du rôle.
  acteur: { id: "u-admin", email: "bureau@club.test", role: "MEMBRE", estAdmin: true, service: false, actif: true },
  evenement: null as Record<string, unknown> | null,
  membres: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; ref?: string }>,
  push: [] as Array<{ userId: string; titre: string }>,
  /** Ce qui est réellement parti sur les salons, geste par geste */
  discord: [] as Array<{ geste: "poste" | "edite"; titre: string }>,
  telegram: [] as string[],
  canaux: { email: true, push: true, discord: true, telegram: true } as Record<string, boolean>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: vi.fn(async () => null) },
    evenement: {
      findUnique: vi.fn(async () => (faux.evenement ? { ...faux.evenement } : null)),
      findUniqueOrThrow: vi.fn(async () => {
        if (!faux.evenement) throw new Error("introuvable");
        return { ...faux.evenement };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        faux.evenement = { ...EVENEMENT, ...data, id: "e-neuf", discordMessageId: null };
        return { ...faux.evenement };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!faux.evenement) throw new Error("aucun événement");
        Object.assign(faux.evenement, data);
        return { ...faux.evenement };
      }),
    },
    user: { findMany: vi.fn(async () => faux.membres) },
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
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  assertPermission: vi.fn(async () => faux.acteur),
  getCurrentUser: vi.fn(async () => faux.acteur),
  AccesRefuse: class extends Error {},
}));

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; ref?: string }) => {
    faux.emails.push(mail);
  }),
}));

vi.mock("@/lib/notifications/push", () => ({
  pushConfigure: vi.fn(async () => true),
  notifierPersonnes: vi.fn(async (userIds: readonly string[], charge: (id: string) => { titre: string }) => {
    for (const userId of userIds) faux.push.push({ userId, ...charge(userId) });
    return new Map(userIds.map((id) => [id, { appareils: 1, atteints: 1 }]));
  }),
}));

/** L'état des canaux se règle test par test : ce qu'on vérifie, c'est *quand* on envoie, pas *si*. */
vi.mock("@/lib/notifications/canaux", () => ({
  envoiPossible: vi.fn(async (_type: string, canal: string) => faux.canaux[canal] === true),
  canalOperationnel: vi.fn(async (canal: string) => faux.canaux[canal] === true),
}));

vi.mock("@/lib/notifications/webhooks", () => ({
  salonPour: vi.fn(async () => ({ url: SALON, source: "herite" as const })),
}));

vi.mock("@/lib/notifications/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/discord")>()),
  posterEtRetenirId: vi.fn(async (_url: string, embed: { title: string }) => {
    faux.discord.push({ geste: "poste", titre: embed.title });
    return "msg-1";
  }),
  editerMessageDiscord: vi.fn(async (_url: string, _id: string, embed: { title: string }) => {
    faux.discord.push({ geste: "edite", titre: embed.title });
    return "edite" as const;
  }),
}));

vi.mock("@/lib/notifications/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/telegram")>()),
  envoyerTelegram: vi.fn(async (texte: string) => {
    faux.telegram.push(texte);
  }),
}));

vi.mock("@/lib/identite", () => ({
  identite: vi.fn(async () => ({ nomClub: "Cercle d'escrime ancienne", nomCourt: "Cercle Organizer", partEffectifMin: 20 })),
}));

const { creerEvenement, modifierEvenement, publierEvenement } = await import("@/actions/evenements");

const EVENEMENT = {
  id: "e-1",
  nom: "Stage de messer",
  description: "Deux jours de travail au messer.",
  dateDebut: "2126-10-10",
  heureDebut: "09:00",
  dateFin: null as string | null,
  heureFin: "18:00",
  lieu: "Gymnase municipal",
  adresse: "",
  organisateur: "Le club voisin",
  prix: "25 €",
  prixAdherent: "15 €",
  dureeNombre: 2,
  dureeUnite: "jour",
  lienInscription: "",
  lienSource: "",
  imageUrl: "",
  publie: true,
  publieAt: new Date("2126-09-01T10:00:00Z"),
  discordMessageId: null as string | null,
};

const membre = (id: string) => ({ id, prenom: id, email: `${id}@club.test`, actif: true, rappelEmail: true, preferencesNotifications: null, service: false });

/** Le formulaire de l'écran, tel qu'il arrive : tous les champs, `publie` explicite. */
function formulaire(valeurs: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    nom: "Stage de messer",
    description: "Deux jours de travail au messer.",
    dateDebut: "2126-10-10",
    heureDebut: "09:00",
    dateFin: "",
    heureFin: "18:00",
    lieu: "Gymnase municipal",
    adresse: "",
    organisateur: "Le club voisin",
    prix: "25 €",
    prixAdherent: "15 €",
    dureeNombre: "2",
    dureeUnite: "jour",
    lienInscription: "",
    lienSource: "",
    imageUrl: "",
    publie: "on",
  };
  for (const [cle, valeur] of Object.entries({ ...base, ...valeurs })) fd.set(cle, valeur);
  return fd;
}

beforeEach(() => {
  faux.evenement = { ...EVENEMENT };
  faux.membres = [membre("chloe"), membre("charlie")];
  faux.logs = [];
  faux.emails = [];
  faux.push = [];
  faux.discord = [];
  faux.telegram = [];
  faux.canaux = { email: true, push: true, discord: true, telegram: true };
});

/** L'état d'un événement publié **avant** l'arrivée de Telegram : email, push et Discord journalisés. */
function annonceDejaFaite() {
  faux.evenement = { ...EVENEMENT, discordMessageId: "msg-0" };
  faux.logs = [
    { type: "EVENEMENT", canal: "EMAIL", dedupKey: "evenement_email_e-1_chloe", statut: "ENVOYE" },
    { type: "EVENEMENT", canal: "EMAIL", dedupKey: "evenement_email_e-1_charlie", statut: "ENVOYE" },
    { type: "EVENEMENT", canal: "PUSH", dedupKey: "evenement_push_e-1_chloe", statut: "ENVOYE" },
    { type: "EVENEMENT", canal: "PUSH", dedupKey: "evenement_push_e-1_charlie", statut: "ENVOYE" },
    { type: "EVENEMENT", canal: "DISCORD", dedupKey: "evenement_discord_e-1", statut: "ENVOYE" },
  ];
}

/**
 * **`creerEvenement` redirige vers l'annonce créée** : une server action signale sa redirection en
 * **levant**, ce qui est un succès et non une erreur. On lit donc la destination au lieu d'un
 * `FormState` — le même patron que `tests/unit/admin-activation.test.ts`.
 */
async function redirectionDe(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    const m = /^REDIRECTION:(.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("aucune redirection");
}

describe("publier une annonce : tout part, une fois", () => {
  it("une annonce créée déjà publiée part sur les quatre canaux", async () => {
    faux.evenement = null;
    await redirectionDe(creerEvenement({}, formulaire()));
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["charlie@club.test", "chloe@club.test"]);
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["charlie", "chloe"]);
    expect(faux.discord).toEqual([{ geste: "poste", titre: "📣 Nouvel événement — Stage de messer" }]);
    expect(faux.telegram).toHaveLength(1);
  });

  it("un brouillon qui passe en publié part, lui aussi, sur les quatre canaux", async () => {
    faux.evenement = { ...EVENEMENT, publie: false, publieAt: null, discordMessageId: null };
    await modifierEvenement("e-1", {}, formulaire({ publie: "on" }));
    expect(faux.emails).toHaveLength(2);
    expect(faux.push).toHaveLength(2);
    expect(faux.discord.map((d) => d.geste)).toEqual(["poste"]);
    expect(faux.telegram).toHaveLength(1);
  });

  it("publier un brouillon depuis le bouton part aussi", async () => {
    faux.evenement = { ...EVENEMENT, publie: false, publieAt: null, discordMessageId: null };
    await publierEvenement("e-1", true);
    expect(faux.telegram).toHaveLength(1);
    expect(faux.discord.map((d) => d.geste)).toEqual(["poste"]);
  });
});

describe("modifier une annonce déjà publiée : rien ne s'annonce", () => {
  /** Le bug de Delta, canal par canal. */
  it("ne réannonce rien sur Telegram, même si le canal est arrivé après la publication", async () => {
    annonceDejaFaite(); // aucune clé `evenement_telegram_e-1` : le canal n'existait pas alors
    await modifierEvenement("e-1", {}, formulaire({ lieu: "Gymnase municipal, Villebourg" }));
    expect(faux.telegram).toEqual([]);
    expect(faux.logs.some((l) => l.canal === "TELEGRAM")).toBe(false);
  });

  it("ne repose rien sur Discord quand le message a disparu de la base (annonce antérieure au salon)", async () => {
    annonceDejaFaite();
    (faux.evenement as Record<string, unknown>).discordMessageId = null;
    faux.logs = faux.logs.filter((l) => l.canal !== "DISCORD"); // jamais annoncé sur le salon
    await modifierEvenement("e-1", {}, formulaire({ prix: "30 €" }));
    expect(faux.discord).toEqual([]);
  });

  it("corrige le message du salon quand il existe, sans jamais en poster un second", async () => {
    annonceDejaFaite();
    await modifierEvenement("e-1", {}, formulaire({ lieu: "Gymnase municipal, Villebourg" }));
    expect(faux.discord).toEqual([{ geste: "edite", titre: "📣 Nouvel événement — Stage de messer" }]);
  });

  it("ne réécrit ni aux boîtes mail ni aux téléphones", async () => {
    annonceDejaFaite();
    await modifierEvenement("e-1", {}, formulaire({ nom: "Stage de messer et de dague" }));
    expect(faux.emails).toEqual([]);
    expect(faux.push).toEqual([]);
  });

  /**
   * Le cas qui piégeait vraiment : une instance où l'email et le push sont coupés, et où seul
   * Telegram est branché. Rien ne garde alors la moindre trace de l'annonce d'origine.
   */
  it("reste muet même quand aucun canal n'avait journalisé l'annonce d'origine", async () => {
    faux.evenement = { ...EVENEMENT, discordMessageId: null };
    faux.logs = [];
    faux.canaux = { email: false, push: false, discord: false, telegram: true };
    await modifierEvenement("e-1", {}, formulaire({ prix: "30 €" }));
    expect(faux.telegram).toEqual([]);
    expect(faux.logs).toEqual([]);
  });

  it("« publier » ce qui est déjà publié ne réannonce rien non plus", async () => {
    annonceDejaFaite();
    await publierEvenement("e-1", true);
    expect(faux.telegram).toEqual([]);
    expect(faux.emails).toEqual([]);
    expect(faux.discord.map((d) => d.geste)).toEqual(["edite"]);
  });
});

describe("dépublier, puis republier", () => {
  it("barre le message du salon, sans rien annoncer", async () => {
    annonceDejaFaite();
    await publierEvenement("e-1", false);
    expect(faux.discord).toEqual([{ geste: "edite", titre: "❌ Annulé — Stage de messer" }]);
    expect(faux.telegram).toEqual([]);
  });

  it("republier est une publication : le salon reçoit une annonce neuve", async () => {
    annonceDejaFaite();
    await publierEvenement("e-1", false);
    faux.discord = [];
    await publierEvenement("e-1", true);
    expect(faux.discord.map((d) => d.geste)).toEqual(["poste"]);
  });
});
