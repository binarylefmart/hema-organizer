import { beforeEach, describe, expect, it, vi } from "vitest";
import { chiffrer } from "@/lib/crypto";
import { serialiserPreferences, preferencesDefaut } from "@/lib/notifications/preferences";

/**
 * Envois du soir de bout en bout, avec une base, un envoyeur d'emails, un service de push et un
 * webhook Discord simulés : qui reçoit quoi (récap aux inscrits Présent/Peut-être, rappel aux
 * personnes sans réponse), sur quel canal, idempotence par `NotificationLog.dedupKey`, et canal ou
 * case décochée = rien du tout.
 *
 * Le push **double** l'email : mêmes personnes, mais chacune décide canal par canal, et les deux
 * canaux se journalisent séparément — couper l'un ne doit jamais éteindre l'autre.
 */

type LigneLog = { type: string; canal: string; sessionId: string | null; userId: string | null; dedupKey: string; statut: string; erreur: string | null };
type MembreFaux = {
  id: string;
  prenom: string;
  email: string;
  actif?: boolean;
  rappelEmail?: boolean;
  service?: boolean;
  statut?: string | null;
  /** JSON des choix personnels (`User.preferencesNotifications`) */
  choix?: string | null;
};

const faux = vi.hoisted(() => ({
  seances: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; sujet: string; ref?: string }>,
  push: [] as Array<{ userId: string; titre: string; corps: string; url: string; tag?: string }>,
  discord: [] as Array<{ url: string; embed: Record<string, unknown> }>,
  prefs: null as string | null,
  /** Table `Setting` en mémoire (les salons par notification y vivent, chiffrés) */
  reglages: new Map<string, string>(),
  webhook: "https://discord.test/webhook",
  discordEchoue: false,
  /** Le bouton porteur de jeton qu'on ajoutera un jour, par distraction, à un gabarit collectif. */
  gabaritCollectifAbime: false,
}));

vi.mock("@/lib/db", () => ({
  db: {
    session: {
      findMany: vi.fn(async (args: { where: { date: { in: string[] } } }) => faux.seances.filter((s) => args.where.date.in.includes(s.date as string))),
    },
    notificationLog: {
      findMany: vi.fn(async (args: { where: { dedupKey: { in: string[] } } }) =>
        faux.logs.filter((l) => args.where.dedupKey.in.includes(l.dedupKey as string)).map((l) => ({ dedupKey: l.dedupKey })),
      ),
      create: vi.fn(async ({ data }: { data: LigneLog }) => {
        if (faux.logs.some((l) => l.dedupKey === data.dedupKey)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
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
    // Lu par l'état du canal push (`canaux.ts`) : ce qui compte ici, c'est qu'il soit opérationnel.
    pushAbonnement: { count: vi.fn(async () => 3) },
  },
}));

/**
 * Le transport push. `notifierPersonne` ne lève jamais dans la vraie vie : le faux non plus, il note
 * qui aurait été réveillé et avec quel texte.
 */
vi.mock("@/lib/notifications/push", () => ({
  pushConfigure: vi.fn(async () => true),
  // Les envois groupés passent par `notifierPersonnes` : une seule lecture des appareils pour
  // toute la liste (voir `notifierParPush` dans journal.ts). Le faux garde la trace de chaque
  // personne notifiée, avec le texte qui lui était destiné.
  notifierPersonnes: vi.fn(async (userIds: readonly string[], charge: (userId: string) => { titre: string; corps: string; url: string; tag?: string }) => {
    // Deux nombres : « appareils inscrits » et « appareils atteints ». C'est ce qui permet à
    // `notifierParPush` de distinguer « personne n'a branché de téléphone » (rien à reprendre) de «
    // les téléphones étaient là et l'envoi a échoué » (la clé se libère).
    const atteints = new Map<string, { appareils: number; atteints: number }>();
    for (const userId of userIds) {
      faux.push.push({ userId, ...charge(userId) });
      atteints.set(userId, { appareils: 1, atteints: 1 });
    }
    return atteints;
  }),
  notifierPersonne: vi.fn(async (userId: string, charge: { titre: string; corps: string; url: string; tag?: string }) => {
    faux.push.push({ userId, ...charge });
    return 1;
  }),
}));

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; sujet: string; ref?: string }) => {
    faux.emails.push(mail);
  }),
}));

vi.mock("@/lib/settings", () => ({
  CLES: { notifications: "notifications", recapHour: "recapHour", discordWebhooks: "discordWebhooks", discordWebhookEvenementsUrl: "discordWebhookEvenementsUrl" },
  getSetting: vi.fn(async (cle: string) => (cle === "notifications" ? faux.prefs : (faux.reglages.get(cle) ?? null))),
  setSetting: vi.fn(async (cle: string, valeur: string | null) => {
    if (valeur === null) faux.reglages.delete(cle);
    else faux.reglages.set(cle, valeur);
  }),
  getRecapHour: vi.fn(async () => "18:00"),
  heureRecap: vi.fn(async () => "18:00"),
  getDiscordWebhookUrl: vi.fn(async () => ({ url: faux.webhook, source: "env" as const })),
}));

vi.mock("@/lib/notifications/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/discord")>()),
  posterDiscord: vi.fn(async (url: string, embed: Record<string, unknown>) => {
    if (faux.discordEchoue) throw new Error("Discord : réponse 500");
    faux.discord.push({ url, embed });
  }),
}));

/**
 * Le gabarit collectif du récap, avec un interrupteur : `faux.gabaritCollectifAbime` y ajoute un
 * bouton porteur de jeton personnel. C'est le seul moyen d'éprouver ce que fait le code le jour où
 * quelqu'un ajoute ce bouton pour de bon — `messageCollectif` lève, et la question est de savoir si
 * la clé de déduplication a déjà été posée.
 */
vi.mock("@/lib/email/templates/recap", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/email/templates/recap")>();
  return {
    ...reel,
    emailRecapVeilleListe: (args: Parameters<typeof reel.emailRecapVeilleListe>[0]) => {
      const message = reel.emailRecapVeilleListe(args);
      if (!faux.gabaritCollectifAbime) return message;
      return {
        ...message,
        contenu: { ...message.contenu, boutons: [...(message.contenu.boutons ?? []), { label: "Ne plus recevoir", url: "https://club.fr/desinscription/JETON" }] },
      };
    },
  };
});

const { cleRecapDiscord, cleRecapEmail, cleRecapPush, envoyerRecapVeille } = await import("@/lib/notifications/recap");
const { cleRappel, cleRappelPush, envoyerRappelsSansReponse } = await import("@/lib/notifications/rappels");

type CaseFausse = { libelle: string; ordre: number; theme: string; atelier: { titre: string } | null };

function seanceFausse(id: string, date: string, membres: MembreFaux[], parties: CaseFausse[] = []): Record<string, unknown> {
  return {
    id,
    date,
    heureDebut: "19:30",
    heureFin: "21:30",
    lieu: "Gymnase municipal",
    theme: "Messer",
    alternative: "",
    disciplines: "Messer",
    attendances: membres.filter((m) => m.statut).map((m) => ({ userId: m.id, statut: m.statut })),
    parties,
    period: {
      membres: membres
        .filter((m) => m.service !== true)
        .map((m) => ({
          user: {
            id: m.id,
            prenom: m.prenom,
            email: m.email,
            actif: m.actif ?? true,
            rappelEmail: m.rappelEmail ?? true,
            preferencesNotifications: m.choix ?? null,
            service: false,
          },
        })),
    },
  };
}

const MEMBRES: MembreFaux[] = [
  { id: "u1", prenom: "Chloé", email: "chloe@club.test", statut: "PRESENT" },
  { id: "u2", prenom: "Juliett", email: "juliett@club.test", statut: "PEUT_ETRE" },
  { id: "u3", prenom: "Charlie", email: "charlie@club.test", statut: "ABSENT" },
  { id: "u4", prenom: "Anne", email: "anne@club.test", statut: null },
  { id: "u5", prenom: "Marc", email: "marc@club.test", statut: "PRESENT", rappelEmail: false },
  { id: "u6", prenom: "Jeanne", email: "jeanne@club.test", statut: "PRESENT", actif: false },
];

/**
 * Quatre invités de plus, pour atteindre les dix — de quoi que l'échelle de remplissage ait un
 * sens. Avec les valeurs livrées, « bien rempli » demande sept attendus : en dessous, la séance
 * n'est plus notée du tout.
 */
const INVITES_EN_PLUS: MembreFaux[] = [
  { id: "u7", prenom: "Paul", email: "paul@club.test", statut: "PRESENT" },
  { id: "u8", prenom: "Sonia", email: "sonia@club.test", statut: "PRESENT" },
  { id: "u9", prenom: "Karim", email: "karim@club.test", statut: "PRESENT" },
  { id: "u10", prenom: "Léa", email: "lea@club.test", statut: "PRESENT" },
];

/** 18:00 à Paris le 23 septembre 2026 : la séance de demain est le 24. */
const VEILLE = new Date("2026-09-23T16:00:00Z");

/** Ce que les fonctions de clé attendent : l'identifiant de la séance et son créneau. */
function cle(id: string, date: string, heureDebut = "19:30") {
  return { id, seance: { date, heureDebut } };
}
const CLE_S1 = cle("s1", "2026-09-24");

beforeEach(() => {
  faux.seances = [];
  faux.logs = [];
  faux.emails = [];
  faux.push = [];
  faux.discord = [];
  faux.prefs = null; // réglages par défaut
  faux.reglages = new Map();
  faux.discordEchoue = false;
  faux.gabaritCollectifAbime = false;
});

describe("récap de la veille", () => {
  beforeEach(() => {
    faux.seances = [seanceFausse("s1", "2026-09-24", MEMBRES), seanceFausse("s9", "2026-09-30", MEMBRES)];
  });

  it("n'écrit qu'aux membres inscrits Présent ou Peut-être, un email chacun", async () => {
    const bilan = await envoyerRecapVeille(VEILLE);
    expect(bilan).toEqual({ seances: 1, emails: 2, discord: 1, telegram: 0 });
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["chloe@club.test", "juliett@club.test"]);
    expect(faux.emails[0].sujet).toBe("🗡️ Rappel : cours demain à 19h30 — Messer");
  });

  it("respecte la case « Recevoir le rappel par email » et les comptes désactivés", async () => {
    await envoyerRecapVeille(VEILLE);
    const destinataires = faux.emails.map((e) => e.to);
    expect(destinataires).not.toContain("marc@club.test"); // rappelEmail = false
    expect(destinataires).not.toContain("jeanne@club.test"); // compte inactif
    expect(destinataires).not.toContain("charlie@club.test"); // absent
    expect(destinataires).not.toContain("anne@club.test"); // sans réponse
  });

  it("poste un embed Discord aux couleurs du club, sans nommer personne", async () => {
    await envoyerRecapVeille(VEILLE);
    expect(faux.discord).toHaveLength(1);
    const { url, embed } = faux.discord[0];
    expect(url).toBe("https://discord.test/webhook");
    expect(embed.title).toBe("🗡️ Cours de demain");
    expect(embed.color).toBe(0x074d95);
    expect(embed.description).toContain("✅ 3 présents / 6 — 50 %"); // les chiffres comptent tous les invités, pas les seuls destinataires
    expect(JSON.stringify(embed)).not.toContain("Chloé");
  });

  it("dit le statut de la séance : répartition complète, effectif attendu et palier en toutes lettres", async () => {
    await envoyerRecapVeille(VEILLE);
    const champs = faux.discord[0].embed.fields as Array<{ name: string; value: string }>;
    // 3 Présent, 1 Peut-être, 1 Absent, 1 sans réponse sur 6 invités (Jeanne est inactive mais reste invitée).
    expect(champs.find((c) => c.name === "Réponses")?.value).toBe("✅ 3 Présent\n🤔 1 Peut-être\n❌ 1 Absent\n⏳ 1 sans réponse");
    /*
     * 3 confirmés + la moitié d'un « Peut-être » : une estimation, jamais un chiffre ferme.
     *
     * **Et aucun palier pour six invités**. Ce test attendait « Effectif juste » écrit sous
     * l'estimation. Avec les valeurs livrées, le confort vaut sept : un groupe de six ne pouvait
     * donc **jamais** être « bien rempli », même au complet — la carte annonçait « 6 présents / 6 —
     * 100 % » et, juste à côté, « Effectif juste ». Le mot contredisait le pourcentage posé à côté
     * de lui. Un groupe trop petit pour que l'échelle ait un sens n'est donc plus noté du tout,
     * comme un groupe plus petit que le seuil ne l'était déjà pas : le chiffre se lit seul.
     */
    expect(champs.find((c) => c.name === "Effectif attendu")?.value).toBe("~4 attendus");
  });

  /** Le cas voisin : dès que l'échelle a un sens, le palier revient — sans quoi ce serait une perte. */
  it("écrit le palier dès que le groupe est assez grand pour que « bien » soit atteignable", async () => {
    faux.seances = [seanceFausse("s1", "2026-09-24", [...MEMBRES, ...INVITES_EN_PLUS])];
    await envoyerRecapVeille(VEILLE);
    const champs = faux.discord[0].embed.fields as Array<{ name: string; value: string }>;
    // Dix invités dont huit attendus : au-dessus du confort, donc « Bien rempli » — et le mot est
    // d'accord avec le chiffre, ce qui est tout l'objet de la borne.
    expect(champs.find((c) => c.name === "Effectif attendu")?.value).toBe("~8 attendus\n**Bien rempli**");
  });

  it("porte le programme du cours, ateliers compris, et jamais le nom de qui l'anime", async () => {
    faux.seances = [
      seanceFausse("s1", "2026-09-24", MEMBRES, [
        { libelle: "Cours 1", ordre: 0, theme: "Messer — garde haute", atelier: null },
        { libelle: "Option 2", ordre: 3, theme: "", atelier: { titre: "Nœuds de corde" } },
      ]),
    ];
    await envoyerRecapVeille(VEILLE);
    const champs = faux.discord[0].embed.fields as Array<{ name: string; value: string }>;
    expect(champs.find((c) => c.name === "📖 Programme")?.value).toBe("• Cours 1 — Messer — garde haute\n• Option 2 — Nœuds de corde (atelier)");
    expect(JSON.stringify(faux.discord[0].embed)).not.toContain("Chloé");
  });

  it("n'affiche pas de champ Programme quand aucune case du planning n'est remplie", async () => {
    await envoyerRecapVeille(VEILLE);
    const champs = faux.discord[0].embed.fields as Array<{ name: string }>;
    expect(champs.map((c) => c.name)).toEqual(["Réponses", "Effectif attendu"]);
  });

  it("part sur le salon dédié au récap quand il y en a un, sans toucher au salon principal", async () => {
    faux.reglages.set("discordWebhooks", chiffrer(JSON.stringify({ recap_veille: "https://discord.test/salon-des-cours" })));
    await envoyerRecapVeille(VEILLE);
    expect(faux.discord.map((d) => d.url)).toEqual(["https://discord.test/salon-des-cours"]);
  });

  it("retombe sur le salon principal pour une notification sans salon dédié", async () => {
    // Un salon dédié aux annulations ne déplace pas le récap de la veille.
    faux.reglages.set("discordWebhooks", chiffrer(JSON.stringify({ seance_annulee: "https://discord.test/salon-des-annulations" })));
    await envoyerRecapVeille(VEILLE);
    expect(faux.discord.map((d) => d.url)).toEqual(["https://discord.test/webhook"]);
  });

  it("ne renvoie rien si le cron rejoue (dedupKey)", async () => {
    await envoyerRecapVeille(VEILLE);
    const apresPremier = faux.logs.length;
    const bilan = await envoyerRecapVeille(VEILLE);
    expect(bilan).toEqual({ seances: 1, emails: 0, discord: 0, telegram: 0 });
    expect(faux.emails).toHaveLength(2);
    expect(faux.discord).toHaveLength(1);
    expect(faux.logs).toHaveLength(apresPremier);
  });

  it("journalise une clé par séance, par créneau, par membre et par canal", async () => {
    await envoyerRecapVeille(VEILLE);
    expect(faux.logs.map((l) => l.dedupKey).sort()).toEqual([
      "recap_discord_s1_2026-09-24-1930",
      "recap_email_s1_2026-09-24-1930_u1",
      "recap_email_s1_2026-09-24-1930_u2",
      "recap_push_s1_2026-09-24-1930_u1",
      "recap_push_s1_2026-09-24-1930_u2",
    ]);
    expect(cleRecapEmail(CLE_S1, "u1")).toBe("recap_email_s1_2026-09-24-1930_u1");
    expect(cleRecapPush(CLE_S1, "u1")).toBe("recap_push_s1_2026-09-24-1930_u1");
    expect(cleRecapDiscord(CLE_S1)).toBe("recap_discord_s1_2026-09-24-1930");
    expect(faux.logs.every((l) => l.type === "RECAP" && l.statut === "ENVOYE")).toBe(true);
    // Le canal est écrit noir sur blanc : c'est lui qui distingue les deux envois d'une même personne.
    expect(faux.logs.filter((l) => l.canal === "PUSH").map((l) => l.userId)).toEqual(["u1", "u2"]);
  });

  it("réveille les mêmes personnes sur leur téléphone, avec un texte court et le lien des présences", async () => {
    await envoyerRecapVeille(VEILLE);
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["u1", "u2"]);
    expect(faux.push.map((p) => p.userId)).toEqual(faux.emails.map((e) => e.ref?.replace("recap_email_s1_2026-09-24-1930_", "")));
    const chloe = faux.push.find((p) => p.userId === "u1");
    expect(chloe?.titre).toBe("Cours demain à 19h30");
    expect(chloe?.corps).toBe("Gymnase municipal · Messer · Tu es inscrit(e) : Présent");
    expect(chloe?.url).toBe("/seances");
    expect(chloe?.tag).toBe("recap-s1");
    // Pas d'emoji dans le titre : le système en met déjà une icône, et l'écran verrouillé est étroit.
    expect(chloe?.titre).toMatch(/^[\wÀ-ÿ' .:—-]+$/u);
  });

  it("respecte un refus du push qui n'est pas un refus de l'email", async () => {
    // Juliett ne veut plus le récap sur son téléphone, mais le garde dans sa boîte mail.
    faux.seances = [
      seanceFausse("s1", "2026-09-24", [
        { id: "u1", prenom: "Chloé", email: "chloe@club.test", statut: "PRESENT" },
        { id: "u2", prenom: "Juliett", email: "juliett@club.test", statut: "PEUT_ETRE", choix: JSON.stringify({ recap_veille: { email: true, push: false } }) },
      ]),
    ];
    await envoyerRecapVeille(VEILLE);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["chloe@club.test", "juliett@club.test"]);
    expect(faux.push.map((p) => p.userId)).toEqual(["u1"]);
  });

  it("ne réveille pas deux fois le même téléphone si le cron rejoue", async () => {
    await envoyerRecapVeille(VEILLE);
    await envoyerRecapVeille(VEILLE);
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["u1", "u2"]);
  });

  /**
   * **Le canal du téléphone libère sa clé quand l'envoi échoue**.
   *
   * C'était le seul canal à ne pas tenir l'invariant du dossier (« tout envoi libère sa clé en cas
   * d'échec »), et le dossier affirmait pourtant qu'un test le vérifiait module par module. Le résultat
   * de `notifierPersonnes` était jeté : la clé, posée avant l'envoi, restait `ENVOYE` quoi qu'il arrive.
   * Une panne du service de push — FCM qui répond 503 quatre minutes — et les bulles ne partaient
   * **jamais** : les repassages de 18 h 15 à 19 h 30, prévus exactement pour ça, voyaient les clés et ne
   * faisaient rien, pendant que l'espace admin affichait « envoyé ».
   *
   * Les deux zéros se distinguent, et c'est le cœur du correctif : **aucun appareil inscrit** n'est pas
   * un échec (il n'y avait rien à envoyer), **des appareils inscrits et aucun atteint** en est un.
   */
  it("libère la clé du téléphone quand aucun appareil n'est atteint, et rejoue au passage suivant", async () => {
    const push = await import("@/lib/notifications/push");
    const vrai = vi.mocked(push.notifierPersonnes).getMockImplementation()!;
    // Panne du service : les appareils sont bien inscrits, aucun n'est atteint.
    vi.mocked(push.notifierPersonnes).mockImplementation(async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, { appareils: 1, atteints: 0 }])),
    );
    await envoyerRecapVeille(VEILLE);
    const echecs = faux.logs.filter((l) => l.canal === "PUSH" && l.statut === "ECHEC");
    expect(echecs.length).toBeGreaterThan(0);
    // Et aucune clé nominale ne reste en « envoyé » : sinon la reprise n'aurait pas lieu.
    expect(faux.logs.filter((l) => l.canal === "PUSH" && l.statut === "ENVOYE")).toHaveLength(0);

    // Le service revient : le passage suivant réveille vraiment les téléphones.
    vi.mocked(push.notifierPersonnes).mockImplementation(vrai);
    faux.push = [];
    await envoyerRecapVeille(VEILLE);
    expect(faux.push.length).toBeGreaterThan(0);
  });

  it("garde l'email quand le club coupe le canal push, et l'inverse", async () => {
    const sansPush = preferencesDefaut();
    sansPush.canaux.push = false;
    faux.prefs = serialiserPreferences(sansPush);
    const bilan = await envoyerRecapVeille(VEILLE);
    expect(bilan).toEqual({ seances: 1, emails: 2, discord: 1, telegram: 0 });
    expect(faux.push).toHaveLength(0);
    expect(faux.logs.some((l) => l.canal === "PUSH")).toBe(false);

    // L'inverse : plus d'email, mais les téléphones sonnent toujours.
    faux.logs = [];
    faux.emails = [];
    const sansEmail = preferencesDefaut();
    sansEmail.canaux.email = false;
    faux.prefs = serialiserPreferences(sansEmail);
    await envoyerRecapVeille(VEILLE);
    expect(faux.emails).toHaveLength(0);
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["u1", "u2"]);
  });

  it("libère la clé quand Discord échoue, pour réessayer au passage suivant", async () => {
    faux.discordEchoue = true;
    expect((await envoyerRecapVeille(VEILLE)).discord).toBe(0);
    expect(faux.logs.some((l) => l.statut === "ECHEC" && String(l.dedupKey).startsWith("recap_discord_s1_2026-09-24-1930_echec_"))).toBe(true);
    faux.discordEchoue = false;
    faux.emails = [];
    expect((await envoyerRecapVeille(VEILLE)).discord).toBe(1);
    expect(faux.emails).toHaveLength(0); // les emails, eux, ne repartent pas
  });

  it("ne dit rien quand le canal email est coupé, et rien du tout si les deux le sont", async () => {
    const sansEmail = preferencesDefaut();
    sansEmail.canaux.email = false;
    faux.prefs = serialiserPreferences(sansEmail);
    const bilan = await envoyerRecapVeille(VEILLE);
    expect(bilan).toEqual({ seances: 1, emails: 0, discord: 1, telegram: 0 });
    expect(faux.emails).toHaveLength(0);

    faux.logs = [];
    faux.discord = [];
    const rien = preferencesDefaut();
    rien.notifications.recap_veille = { email: false, discord: false, whatsapp: false };
    faux.prefs = serialiserPreferences(rien);
    expect(await envoyerRecapVeille(VEILLE)).toEqual({ seances: 0, emails: 0, discord: 0, telegram: 0 });
    expect(faux.emails).toHaveLength(0);
    expect(faux.discord).toHaveLength(0);
    expect(faux.logs).toHaveLength(0);
  });
});

/**
 * **Un cours déplacé, pas annulé.** L'équipe corrige la date d'une séance plutôt que de l'annuler et
 * d'en créer une autre : la ligne garde son identifiant. Tant que la clé de déduplication ne portait
 * que cet identifiant, l'annonce déjà partie pour l'ancienne date interdisait celle de la nouvelle —
 * les membres avaient été convoqués le mauvais jour, et ne l'étaient jamais du bon.
 */
describe("séance déplacée", () => {
  it("réannonce le récap à la nouvelle date, après l'avoir annoncé à l'ancienne", async () => {
    // Le 23 au soir, le cours est prévu le 24 : le récap part.
    faux.seances = [seanceFausse("s1", "2026-09-24", MEMBRES)];
    expect((await envoyerRecapVeille(VEILLE)).emails).toBe(2);
    expect(faux.discord).toHaveLength(1);

    // L'équipe déplace le cours d'une semaine. Le 30 au soir, il faut reprévenir tout le monde.
    faux.emails = [];
    faux.discord = [];
    faux.push = [];
    faux.seances = [seanceFausse("s1", "2026-10-01", MEMBRES)];
    const bilan = await envoyerRecapVeille(new Date("2026-09-30T16:00:00Z"));
    expect(bilan).toEqual({ seances: 1, emails: 2, discord: 1, telegram: 0 });
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["chloe@club.test", "juliett@club.test"]);
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["u1", "u2"]);
    expect(faux.logs.map((l) => l.dedupKey)).toContain("recap_email_s1_2026-10-01-1930_u1");
  });

  it("réannonce aussi un cours décalé d'une heure le même jour", async () => {
    faux.seances = [seanceFausse("s1", "2026-09-24", MEMBRES)];
    await envoyerRecapVeille(VEILLE);
    faux.emails = [];
    const decale = seanceFausse("s1", "2026-09-24", MEMBRES);
    decale.heureDebut = "20:30";
    faux.seances = [decale];
    expect((await envoyerRecapVeille(VEILLE)).emails).toBe(2);
    expect(faux.emails[0].sujet).toContain("20h30");
  });

  it("ne renvoie toujours rien quand rien n'a bougé du créneau (thème corrigé, par exemple)", async () => {
    faux.seances = [seanceFausse("s1", "2026-09-24", MEMBRES)];
    await envoyerRecapVeille(VEILLE);
    faux.emails = [];
    const corrigee = seanceFausse("s1", "2026-09-24", MEMBRES);
    corrigee.theme = "Épée longue — Zornhau";
    corrigee.lieu = "Gymnase municipal, Villebourg";
    faux.seances = [corrigee];
    expect((await envoyerRecapVeille(VEILLE)).emails).toBe(0);
    expect(faux.emails).toHaveLength(0);
  });

  it("refait partir le rappel du même jalon quand la séance change de date", async () => {
    // Le 24, la séance du 1er octobre est à J-7 : le rappel part à Anne.
    faux.seances = [seanceFausse("sx", "2026-10-01", MEMBRES)];
    expect((await envoyerRappelsSansReponse(new Date("2026-09-24T16:00:00Z"))).emails).toBe(1);

    // La séance est repoussée au 8 : le 1er octobre, elle est de nouveau à J-7.
    faux.emails = [];
    faux.push = [];
    faux.seances = [seanceFausse("sx", "2026-10-08", MEMBRES)];
    expect((await envoyerRappelsSansReponse(new Date("2026-10-01T16:00:00Z"))).emails).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual(["anne@club.test"]);
    expect(faux.push.map((p) => p.userId)).toEqual(["u4"]);
  });
});

describe("rappels aux personnes sans réponse", () => {
  /** 24 septembre 2026 : J-7 = 1er octobre, J-2 = 26 septembre. */
  const JOUR = new Date("2026-09-24T16:00:00Z");

  beforeEach(() => {
    faux.seances = [
      seanceFausse("sj7", "2026-10-01", MEMBRES),
      seanceFausse("sj2", "2026-09-26", MEMBRES),
      seanceFausse("sj3", "2026-09-27", MEMBRES), // J-3 : aucun jalon
    ];
  });

  it("n'écrit qu'aux invités sans réponse, aux deux jalons du jour", async () => {
    const bilan = await envoyerRappelsSansReponse(JOUR);
    expect(bilan).toEqual({ seances: 2, emails: 2 });
    expect(faux.emails.map((e) => e.to)).toEqual(["anne@club.test", "anne@club.test"]);
    expect(faux.emails.map((e) => e.sujet)).toEqual([
      "🗡️ Cours dans une semaine (jeudi 1 oct.) — tu viens ?",
      "🗡️ Cours dans deux jours (samedi 26 sept.) — tu viens ?",
    ]);
    expect(faux.logs.map((l) => l.dedupKey).sort()).toEqual([
      "rappel_j2_sj2_2026-09-26-1930_u4",
      "rappel_j7_sj7_2026-10-01-1930_u4",
      "rappel_push_j2_sj2_2026-09-26-1930_u4",
      "rappel_push_j7_sj7_2026-10-01-1930_u4",
    ]);
    expect(cleRappel(cle("sj7", "2026-10-01"), "u4", 7)).toBe("rappel_j7_sj7_2026-10-01-1930_u4");
    expect(cleRappelPush(cle("sj7", "2026-10-01"), "u4", 7)).toBe("rappel_push_j7_sj7_2026-10-01-1930_u4");
  });

  it("pose la même question sur le téléphone, aux mêmes personnes", async () => {
    await envoyerRappelsSansReponse(JOUR);
    expect(faux.push.map((p) => p.userId)).toEqual(["u4", "u4"]);
    expect(faux.push.map((p) => p.titre)).toEqual(["Cours dans une semaine", "Cours dans deux jours"]);
    expect(faux.push[0].corps).toBe("Jeudi 1 oct. à 19h30, Gymnase municipal — tu viens ?");
    expect(faux.push.every((p) => p.url === "/seances")).toBe(true);
    // Deux jalons, deux clés : le second rappel n'est pas avalé par le premier.
    expect(faux.push.map((p) => p.tag)).toEqual(["rappel-sj7", "rappel-sj2"]);
  });

  it("n'insiste pas sur le téléphone de qui n'en veut pas, et n'y renvoie rien au passage suivant", async () => {
    faux.seances = [
      seanceFausse("sx", "2026-10-01", [
        { id: "a", prenom: "Anne", email: "anne@club.test", statut: null },
        { id: "b", prenom: "Charlie", email: "charlie@club.test", statut: null, choix: JSON.stringify({ rappel_sans_reponse: { email: true, push: false } }) },
      ]),
    ];
    await envoyerRappelsSansReponse(JOUR);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["anne@club.test", "charlie@club.test"]);
    expect(faux.push.map((p) => p.userId)).toEqual(["a"]);
    await envoyerRappelsSansReponse(JOUR);
    expect(faux.push.map((p) => p.userId)).toEqual(["a"]);
  });

  it("continue d'écrire quand le club coupe le canal push", async () => {
    const sansPush = preferencesDefaut();
    sansPush.canaux.push = false;
    faux.prefs = serialiserPreferences(sansPush);
    expect(await envoyerRappelsSansReponse(JOUR)).toEqual({ seances: 2, emails: 2 });
    expect(faux.push).toHaveLength(0);
  });

  it("ne renvoie rien au passage suivant, mais le jalon J-2 part bien après le J-7", async () => {
    await envoyerRappelsSansReponse(JOUR);
    expect(await envoyerRappelsSansReponse(JOUR)).toEqual({ seances: 2, emails: 0 });
    expect(faux.emails).toHaveLength(2);
    // cinq jours plus tard, la même séance du 1er octobre est à J-2 : nouvelle clé, nouvel envoi
    const bilan = await envoyerRappelsSansReponse(new Date("2026-09-29T16:00:00Z"));
    expect(bilan.emails).toBe(1);
    expect(faux.logs.map((l) => l.dedupKey)).toContain("rappel_j2_sj7_2026-10-01-1930_u4");
  });

  it("saute les comptes inactifs et ceux qui ont coupé leurs rappels", async () => {
    faux.seances = [
      seanceFausse("sx", "2026-10-01", [
        { id: "a", prenom: "Anne", email: "anne@club.test", statut: null },
        { id: "b", prenom: "Marc", email: "marc@club.test", statut: null, rappelEmail: false },
        { id: "c", prenom: "Jeanne", email: "jeanne@club.test", statut: null, actif: false },
      ]),
    ];
    await envoyerRappelsSansReponse(JOUR);
    expect(faux.emails.map((e) => e.to)).toEqual(["anne@club.test"]);
  });

  it("ne part pas si la case du panneau Notifications est décochée", async () => {
    const coupe = preferencesDefaut();
    coupe.notifications.rappel_sans_reponse = { email: false };
    faux.prefs = serialiserPreferences(coupe);
    expect(await envoyerRappelsSansReponse(JOUR)).toEqual({ seances: 0, emails: 0 });
    expect(faux.emails).toHaveLength(0);
    expect(faux.logs).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* « La liste » : un message au lieu de N                              */
/* ------------------------------------------------------------------ */

/**
 * Le club règle le récap et les rappels sur l'adresse de distribution. Ce qu'on vérifie ici est
 * exactement ce qui fait la valeur du chantier — et ce qui la rendrait dangereuse si c'était faux :
 *
 * - **un** email part, sur **une** adresse ;
 * - **une** ligne de journal, sans identifiant de personne : le journal ne doit pas faire croire
 *   que chacun a été servi ;
 * - le **téléphone ne change pas** : mêmes personnes, mêmes notifications, hors quota ;
 * - le contenu perd tout ce qui est personnel.
 */
const ADRESSE_LISTE = "membres@club.test";

function prefsAvecListe(...types: Array<"recap_veille" | "rappel_sans_reponse">): string {
  const p = preferencesDefaut();
  p.adresseListe = ADRESSE_LISTE;
  for (const type of types) p.modes[type] = "liste";
  return serialiserPreferences(p);
}

describe("récap sur la liste de distribution", () => {
  beforeEach(() => {
    faux.seances = [seanceFausse("s1", "2026-09-24", MEMBRES)];
    faux.prefs = prefsAvecListe("recap_veille");
  });

  it("envoie un seul email, à la liste, et écrit une seule ligne de journal sans personne", async () => {
    const bilan = await envoyerRecapVeille(VEILLE);
    expect(bilan.emails).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual([ADRESSE_LISTE]);
    const lignesEmail = faux.logs.filter((l) => l.canal === "EMAIL");
    expect(lignesEmail).toHaveLength(1);
    expect(lignesEmail[0].userId).toBeNull();
    expect(lignesEmail[0].dedupKey).toBe("recap_liste_s1_2026-09-24-1930");
  });

  it("laisse le téléphone strictement inchangé : chacun le sien, et ses refus respectés", async () => {
    await envoyerRecapVeille(VEILLE);
    // Les mêmes que dans l'envoi individuel : inscrits Présent/Peut-être, compte actif, rappels non coupés.
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["u1", "u2"]);
    expect(faux.logs.filter((l) => l.canal === "PUSH").map((l) => l.userId).sort()).toEqual(["u1", "u2"]);
  });

  it("ne renvoie rien au passage suivant", async () => {
    await envoyerRecapVeille(VEILLE);
    expect((await envoyerRecapVeille(VEILLE)).emails).toBe(0);
    expect(faux.emails).toHaveLength(1);
  });

  it("part quand même si des clés individuelles existent déjà : la bascule n'est pas avalée", async () => {
    // Le club a basculé entre deux passages : les clés de l'envoi individuel sont déjà posées.
    faux.logs.push({ dedupKey: cleRecapEmail(CLE_S1, "u1"), canal: "EMAIL", userId: "u1" });
    faux.logs.push({ dedupKey: cleRecapEmail(CLE_S1, "u2"), canal: "EMAIL", userId: "u2" });
    expect((await envoyerRecapVeille(VEILLE)).emails).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual([ADRESSE_LISTE]);
  });

  it("n'envoie plus rien de personnel : ni prénom, ni réponse, ni lien de désinscription", async () => {
    await envoyerRecapVeille(VEILLE);
    const contenu = JSON.stringify(faux.emails[0]);
    expect(contenu).not.toMatch(/Chloé|Juliett/);
    expect(contenu).not.toMatch(/desinscription/);
  });
});

describe("rappels sur la liste de distribution", () => {
  /** Même repère que les rappels individuels : le 24 septembre, la séance du 1er octobre est à J-7. */
  const JOUR = new Date("2026-09-24T16:00:00Z");
  beforeEach(() => {
    faux.prefs = prefsAvecListe("rappel_sans_reponse");
  });

  it("envoie un compteur, une fois, sans nommer les retardataires", async () => {
    faux.seances = [
      seanceFausse("sj7", "2026-10-01", [
        { id: "a", prenom: "Anne", email: "anne@club.test", statut: null },
        { id: "b", prenom: "Charlie", email: "charlie@club.test", statut: null },
        { id: "c", prenom: "Chloé", email: "chloe@club.test", statut: "PRESENT" },
      ]),
    ];
    const bilan = await envoyerRappelsSansReponse(JOUR);
    expect(bilan.emails).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual([ADRESSE_LISTE]);
    const contenu = JSON.stringify(faux.emails[0]);
    expect(contenu).not.toMatch(/Anne|Charlie/);
    expect(faux.emails[0].sujet).toContain("2 réponses manquantes");
    const lignesEmail = faux.logs.filter((l) => l.canal === "EMAIL");
    expect(lignesEmail).toHaveLength(1);
    expect(lignesEmail[0].userId).toBeNull();
  });

  it("ne dit rien quand tout le monde a répondu : un rappel de zéro personne ne rappelle rien", async () => {
    faux.seances = [seanceFausse("sj7", "2026-10-01", [{ id: "c", prenom: "Chloé", email: "chloe@club.test", statut: "PRESENT" }])];
    expect((await envoyerRappelsSansReponse(JOUR)).emails).toBe(0);
    expect(faux.emails).toHaveLength(0);
    expect(faux.logs.filter((l) => l.canal === "EMAIL")).toHaveLength(0);
  });
});

/**
 * **La clé de journal ne se pose qu'une fois le message fabriqué.**
 *
 * `messageCollectif` lève quand un gabarit collectif porte un lien personnel : c'est tout son
 * intérêt. Si la clé a déjà été écrite quand la levée arrive, le passage suivant voit une clé prise,
 * `journaliser` rend `false`, et l'on repart sans rien envoyer : la notification est éteinte pour
 * toujours, sans un mot. L'ordre correct rend l'échec **bruyant et rejouable**.
 */
describe("un gabarit collectif qui lève ne consomme pas sa clé", () => {
  beforeEach(() => {
    faux.seances = [seanceFausse("s1", "2026-09-24", MEMBRES)];
    faux.prefs = prefsAvecListe("recap_veille");
  });

  it("laisse le journal vide, et le passage suivant envoie une fois le gabarit réparé", async () => {
    faux.gabaritCollectifAbime = true;
    await expect(envoyerRecapVeille(VEILLE)).rejects.toThrow(/adresse de liste/i);
    // Rien d'envoyé, et surtout : aucune clé posée.
    expect(faux.emails).toHaveLength(0);
    expect(faux.logs.filter((l) => l.canal === "EMAIL")).toHaveLength(0);

    // Le gabarit réparé, le récap repart : l'incident n'a rien éteint.
    faux.gabaritCollectifAbime = false;
    expect((await envoyerRecapVeille(VEILLE)).emails).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual([ADRESSE_LISTE]);
  });
});
