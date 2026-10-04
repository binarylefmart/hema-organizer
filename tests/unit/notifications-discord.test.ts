import { beforeEach, describe, expect, it, vi } from "vitest";
import { chiffrer } from "@/lib/crypto";
import { preferencesDefaut, serialiserPreferences, figerCanauxIndisponibles } from "@/lib/notifications/preferences";

/**
 * **Notifications sur le salon Discord** : annulation d'une séance et alerte « peu de monde »,
 * en plus du récap de la veille. Tout est simulé (base, emails, `fetch`) — aucun message ne part
 * vers un vrai salon.
 *
 * Ce qui est vérifié ici :
 * - canal coupé dans les réglages ⇒ rien ne part, rien n'est journalisé ;
 * - aucun salon branché ⇒ rien ne part, sans erreur, et la case est grisée côté page ;
 * - idempotence (`NotificationLog.dedupKey`) : un rejeu ne double jamais un message ;
 * - l'embed d'annulation est conforme à la charte (rouge #A5472C, date, horaire, lieu, motif) ;
 * - un échec Discord n'empêche ni les emails, ni l'annulation elle-même ;
 * - la limite de débit de Discord (429 + `retry_after`) est respectée ;
 * - **chaque notification part dans son salon** : celui qui lui est dédié, sinon le salon principal ;
 * - **le téléphone suit l'email** : les mêmes messages se journalisent aussi sur le canal PUSH,
 *   personne par personne, et couper l'un des deux canaux ne touche pas l'autre.
 */

type LigneLog = { type: string; canal: string; sessionId: string | null; userId: string | null; dedupKey: string; statut: string; erreur: string | null };

const faux = vi.hoisted(() => ({
  seance: null as Record<string, unknown> | null,
  prochaines: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; sujet: string; ref?: string }>,
  discord: [] as Array<{ url: string; embed: Record<string, unknown> }>,
  prefs: null as string | null,
  /**
   * Toutes les clés pour lesquelles une écriture de journal a été **tentée**, refus d'unicité compris.
   * C'est ce qui distingue deux passages qui se sont vraiment croisés (deux tentatives sur la même
   * clé, l'unicité tranche) de deux passages qui se sont suivis (le second n'aurait rien tenté).
   */
  creations: [] as string[],
  /** Table `Setting` en mémoire : les salons par notification y vivent, chiffrés */
  reglages: new Map<string, string>(),
  webhook: "https://discord.test/webhook",
  discordEchoue: false,
  /**
   * La publication sur le site du club. Fermée dans ce jeu d'essai, comme dans une base neuve : le
   * canal « Site du club » n'est donc pas opérationnel, et `figerCanauxIndisponibles` fige ses
   * cases avec celles des autres canaux non branchés.
   */
  publicationOuverte: false,
}));

vi.mock("@/lib/db", () => ({
  db: {
    // L'état des canaux compte désormais les appareils abonnés au push : sans cette table, la
    // page des réglages ne pourrait plus être rendue du tout.
    // Personne n'a d'appareil abonné dans ce jeu d'essai : le canal push est ouvert, il ne
    // réveille simplement aucun téléphone — mais il journalise, comme l'email.
    pushAbonnement: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    session: {
      findUnique: vi.fn(async () => faux.seance),
      findMany: vi.fn(async () => faux.prochaines),
    },
    notificationLog: {
      findUnique: vi.fn(async (args: { where: { dedupKey: string } }) => faux.logs.find((l) => l.dedupKey === args.where.dedupKey) ?? null),
      findMany: vi.fn(async (args: { where: { dedupKey: { in: string[] } } }) =>
        faux.logs.filter((l) => args.where.dedupKey.in.includes(l.dedupKey as string)).map((l) => ({ dedupKey: l.dedupKey })),
      ),
      create: vi.fn(async ({ data }: { data: LigneLog }) => {
        faux.creations.push(data.dedupKey);
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

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; sujet: string; ref?: string }) => {
    faux.emails.push(mail);
  }),
}));

vi.mock("@/lib/settings", () => ({
  // `identite` en fait partie : le nom du club se lit en base comme les autres réglages, et rien
  // n'étant réglé ici, les envois partent sous le nom livré avec le code.
  CLES: { notifications: "notifications", recapHour: "recapHour", discordWebhookUrl: "discordWebhookUrl", discordWebhooks: "discordWebhooks", identite: "identite" },
  getSetting: vi.fn(async (cle: string) => (cle === "notifications" ? faux.prefs : (faux.reglages.get(cle) ?? null))),
  setSetting: vi.fn(async () => {}),
  getDiscordWebhookUrl: vi.fn(async () => ({ url: faux.webhook, source: faux.webhook ? ("app" as const) : ("aucune" as const) })),
  // L'état des canaux comprend désormais « Site du club », dont l'état **est** cette case.
  isPublicApiEnabled: vi.fn(async () => faux.publicationOuverte),
}));

vi.mock("@/lib/notifications/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/discord")>()),
  posterDiscord: vi.fn(async (url: string, embed: Record<string, unknown>) => {
    if (faux.discordEchoue) throw new Error("Discord : réponse 404 (salon supprimé)");
    faux.discord.push({ url, embed });
  }),
}));

const { canauxOperationnels, envoiPossible, etatsCanaux, raisonCanalIndisponible } = await import("@/lib/notifications/canaux");
const { embedAnnulation, embedEffectifFaible } = await import("@/lib/notifications/contenu");
const { COULEUR_OR, COULEUR_ROUGE, attenteRetry } = await import("@/lib/notifications/discord");
const { alerterEffectifFaible, notifierAnnulation } = await import("@/lib/notifications/seances");

/** Le nom du club, passé aux mises en forme (fonctions pures). */
const NOM_CLUB = "Mon club d'AMHE";

const MEMBRES = [
  { id: "u1", prenom: "Chloé", email: "chloe@club.test", actif: true },
  { id: "u2", prenom: "Juliett", email: "juliett@club.test", actif: true },
];

const MODIFIEE_LE = new Date("2026-09-22T10:00:00Z");

function seanceAnnulee(motif = "Salle indisponible"): Record<string, unknown> {
  return {
    id: "s1",
    date: "2026-09-24",
    heureDebut: "19:30",
    heureFin: "21:30",
    lieu: "Gymnase municipal",
    theme: "Messer",
    alternative: "",
    disciplines: "Messer",
    annulee: true,
    motifAnnulation: motif,
    updatedAt: MODIFIEE_LE,
    period: { membres: MEMBRES.map((u) => ({ user: u })) },
  };
}

/**
 * **Une séance en danger : 25 invités, un seul « Présent », aucun « peut-être ».**
 *
 * Elle n'en comptait que trois, et un seul `attendances: [{ statut: "PRESENT" }]` sans `userId`.
 * Les deux étaient devenus faux le jour où l'alerte a cessé de comparer les seuls confirmés au
 * seuil pour passer par `palierEffectif`, le juge des écrans :
 *
 * - **trois invités** tombent dans la garde `indetermine` (`invites <= seuil`, 3 ≤ 4 à cause du
 *   plancher `SEUIL_PLANCHER`) — le cas où aucun écran n'affiche de couleur, parce qu'aucun effectif
 *   n'atteindra jamais le seuil. La fixture décrivait donc le cours dont l'alerte ne doit rien dire,
 *   pour éprouver les salons de l'alerte qui part ;
 * - une réponse **sans `userId`** n'est plus comptée du tout depuis que les chiffres se dérivent de
 *   la liste des invités (`chiffresEffectif`) : l'embed aurait annoncé « 0 présent » là où la fixture
 *   voulait dire « un seul ».
 *
 * Vingt-cinq invités et 20 % réglés donnent un seuil de 5 (au-dessus du plancher : c'est la part du
 * club qui décide), 25 > 5 donc l'échelle a un sens, et un effectif attendu de 1 — « Peu de monde »
 * sur tous les écrans, alerte sur tous les canaux. Ce que ces tests éprouvent reste **le routage et
 * les clés**, pas le seuil : la fixture doit être un cas en danger que personne ne conteste.
 */
function seanceCreuse(): Record<string, unknown> {
  const instructeur = { user: { id: "i1", prenom: "Charlie", email: "charlie@club.test", actif: true, service: false } };
  const invites = Array.from({ length: 25 }, (_, i) => ({ userId: `u${i + 1}` }));
  return {
    id: "s2",
    date: "2026-09-26",
    heureDebut: "19:00",
    heureFin: "21:00",
    lieu: "Gymnase municipal, Villebourg",
    theme: "Dague",
    alternative: "",
    disciplines: "Dague",
    annulee: false,
    attendances: [{ userId: "u1", statut: "PRESENT" }],
    instructeurs: [instructeur],
    period: { membres: invites, instructeurs: [instructeur] },
  };
}

/** Réglages complets avec Discord allumé partout (l'alerte « peu de monde » est décochée par défaut). */
function prefsToutDiscord(): string {
  const p = preferencesDefaut();
  p.notifications.effectif_faible = { email: true, discord: true, whatsapp: false };
  return serialiserPreferences(p);
}

beforeEach(() => {
  faux.seance = seanceAnnulee();
  faux.prochaines = [seanceCreuse()];
  faux.logs = [];
  faux.emails = [];
  faux.discord = [];
  faux.creations = [];
  faux.prefs = prefsToutDiscord();
  faux.reglages = new Map();
  faux.webhook = "https://discord.test/webhook";
  faux.discordEchoue = false;
});

describe("un salon par notification", () => {
  it("poste l'annulation dans le salon des annulations, s'il en existe un", async () => {
    faux.reglages.set("discordWebhooks", chiffrer(JSON.stringify({ seance_annulee: "https://discord.test/salon-des-annulations" })));
    await notifierAnnulation("s1");
    expect(faux.discord.map((d) => d.url)).toEqual(["https://discord.test/salon-des-annulations"]);
  });

  it("laisse l'alerte « peu de monde » sur le salon principal tant qu'elle n'a pas le sien", async () => {
    faux.reglages.set("discordWebhooks", chiffrer(JSON.stringify({ seance_annulee: "https://discord.test/salon-des-annulations" })));
    await alerterEffectifFaible(new Date("2026-09-25T05:00:00Z"));
    expect(faux.discord.map((d) => d.url)).toEqual(["https://discord.test/webhook"]);
  });

  it("envoie encore quand SEUL un salon dédié est branché (aucun salon principal)", async () => {
    // Sans cette règle, un club qui n'aurait réglé que le salon des annulations ne verrait rien partir.
    faux.webhook = "";
    faux.reglages.set("discordWebhooks", chiffrer(JSON.stringify({ seance_annulee: "https://discord.test/salon-des-annulations" })));
    await notifierAnnulation("s1");
    expect(faux.discord.map((d) => d.url)).toEqual(["https://discord.test/salon-des-annulations"]);
  });
});

describe("embed d'annulation", () => {
  it("porte le rouge de la charte, la date, l'horaire, le lieu et le motif", () => {
    const embed = embedAnnulation(
      { date: "2026-09-24", heureDebut: "19:30", heureFin: "21:30", lieu: "Gymnase municipal", theme: "Messer" },
      "Salle indisponible",
      NOM_CLUB,
    );
    expect(embed.title).toBe("❌ Cours annulé");
    expect(embed.color).toBe(0xe50d30);
    expect(embed.color).toBe(COULEUR_ROUGE);
    const champs = Object.fromEntries((embed.fields ?? []).map((f) => [f.name, f.value]));
    expect(champs["📅 Quand"]).toBe("Jeudi 24 septembre 2026 — 19h30 à 21h30");
    expect(champs["📍 Où"]).toBe("Gymnase municipal");
    expect(champs["💬 Motif"]).toBe("Salle indisponible");
    expect(embed.description).toContain("Messer");
  });

  it("ne nomme jamais personne dans l'alerte « peu de monde »", () => {
    const embed = embedEffectifFaible({ date: "2026-09-26", heureDebut: "19:00", heureFin: "21:00", lieu: "Villebourg" }, { presents: 1, invites: 3 }, 2, NOM_CLUB);
    expect(embed.color).toBe(COULEUR_OR);
    const champs = Object.fromEntries((embed.fields ?? []).map((f) => [f.name, f.value]));
    expect(champs["Réponses"]).toBe("✅ 1 présent / 3 — 33 %");
    expect(champs["Sans réponse"]).toBe("2");
    expect(JSON.stringify(embed)).not.toContain("Chloé");
  });
});

describe("annulation d'une séance", () => {
  it("prévient les invités par email et poste l'embed sur le salon", async () => {
    const prevenus = await notifierAnnulation("s1");
    expect(prevenus).toBe(2);
    expect(faux.emails.map((e) => e.to)).toEqual(["chloe@club.test", "juliett@club.test"]);
    expect(faux.discord).toHaveLength(1);
    expect(faux.discord[0].url).toBe("https://discord.test/webhook");
    expect(faux.discord[0].embed.color).toBe(0xe50d30);
    // Une clé par canal : l'email (une pour tout l'envoi), le salon, et le push (une par personne,
    // pour pouvoir reprendre si quelqu'un branche un téléphone entre deux passages).
    expect(faux.logs.map((l) => l.dedupKey).sort()).toEqual([
      `annulation_discord_s1_${MODIFIEE_LE.getTime()}`,
      `annulation_push_s1_${MODIFIEE_LE.getTime()}_u1`,
      `annulation_push_s1_${MODIFIEE_LE.getTime()}_u2`,
      `annulation_s1_${MODIFIEE_LE.getTime()}`,
    ]);
  });

  /**
   * **Deux annulations concurrentes — le défaut que la clé posée après l'envoi laissait passer.**
   *
   * Vécu possible : l'alerte « peu de monde » porte un lien d'annulation en un clic. Deux instructeurs
   * annulent à quelques centaines de millisecondes d'écart — l'un dans l'application
   * (`annulerSeance`), l'autre depuis l'email (`annulerDepuisEmail`, dont la garde `if
   * (!seance.annulee)` lit avant que l'autre écriture n'ait atterri). Les deux appellent
   * `notifierAnnulation`, qui relit la séance : même `updatedAt`, donc **même `dedupKey`**, donc les
   * deux passaient `dejaEnvoye` (aucune ligne encore écrite) et parcouraient la boucle d'envoi.
   *
   * Ce que ça donnait : **chaque invité recevait deux fois « Cours annulé »**, puis le
   * `db.notificationLog.create` brut du perdant levait une P2002 que `notifierAnnulation`
   * n'attrapait pas. Elle remontait hors de la server action, et l'instructeur voyait une erreur pour
   * une séance bel et bien annulée dont tout le club venait d'être prévenu deux fois.
   *
   * Désormais `journaliser` est appelé **avant** la boucle : c'est la contrainte d'unicité de la
   * colonne qui tranche, elle avale la P2002 et rend `false`. Les deux appels aboutissent, un seul
   * écrit — sur les trois canaux, chacun avec sa clé.
   */
  it("ne prévient chaque invité qu'une fois quand deux instructeurs annulent en même temps", async () => {
    // `Promise.all` : si l'un des deux levait — la P2002 d'avant —, ce test échouerait ici même.
    const [premier, second] = await Promise.all([notifierAnnulation("s1"), notifierAnnulation("s1")]);
    // Un passage annonce les deux invités, l'autre renonce : le perdant rend 0, il ne lève pas.
    expect([premier, second].sort()).toEqual([0, 2]);
    // Deux emails, pas quatre : personne n'apprend deux fois que son cours est annulé.
    expect(faux.emails.map((e) => e.to)).toEqual(["chloe@club.test", "juliett@club.test"]);
    // Une seule ligne d'email pour tout l'envoi, un seul message sur le salon, un push par personne.
    expect(faux.logs.filter((l) => l.canal === "EMAIL")).toHaveLength(1);
    expect(faux.discord).toHaveLength(1);
    expect(faux.logs.filter((l) => l.canal === "PUSH")).toHaveLength(MEMBRES.length);
    // **La preuve que les deux passages se sont bien croisés** : la clé de l'email a été tentée
    // deux fois, et c'est l'unicité de la colonne qui a départagé. Si l'un s'était simplement
    // exécuté après l'autre, le second se serait arrêté sur `dejaEnvoye` sans rien tenter — le test
    // ne dirait alors rien de la concurrence qu'il prétend reproduire.
    const cleEmail = `annulation_s1_${MODIFIEE_LE.getTime()}`;
    expect(faux.creations.filter((k) => k === cleEmail)).toHaveLength(2);
  });

  it("ne poste rien deux fois, même rejouée", async () => {
    await notifierAnnulation("s1");
    expect(await notifierAnnulation("s1")).toBe(0);
    expect(faux.emails).toHaveLength(2);
    expect(faux.discord).toHaveLength(1);
  });

  it("ne part pas sur Discord quand le canal est coupé, et pas du tout si les deux le sont", async () => {
    const sansDiscord = preferencesDefaut();
    sansDiscord.canaux.discord = false;
    faux.prefs = serialiserPreferences(sansDiscord);
    await notifierAnnulation("s1");
    expect(faux.discord).toHaveLength(0);
    expect(faux.emails).toHaveLength(2);
    // Plus rien sur le salon : ne restent que les canaux personnels (email et téléphone)
    expect(faux.logs.every((l) => l.canal === "EMAIL" || l.canal === "PUSH")).toBe(true);
    expect(faux.logs.some((l) => l.canal === "DISCORD")).toBe(false);

    faux.logs = [];
    faux.emails = [];
    const rien = preferencesDefaut();
    rien.notifications.seance_annulee = { email: false, discord: false, whatsapp: false };
    faux.prefs = serialiserPreferences(rien);
    expect(await notifierAnnulation("s1")).toBe(0);
    expect(faux.emails).toHaveLength(0);
    expect(faux.discord).toHaveLength(0);
    expect(faux.logs).toHaveLength(0);
  });

  it("n'envoie rien sur Discord, et sans erreur, quand aucun salon n'est branché", async () => {
    faux.webhook = "";
    const prevenus = await notifierAnnulation("s1");
    expect(prevenus).toBe(2); // les emails, eux, partent
    expect(faux.discord).toHaveLength(0);
    expect(faux.logs.some((l) => l.canal === "DISCORD")).toBe(false);
  });

  it("laisse l'annulation réussir quand le salon est supprimé, et libère la clé pour réessayer", async () => {
    faux.discordEchoue = true;
    await expect(notifierAnnulation("s1")).resolves.toBe(2);
    expect(faux.emails).toHaveLength(2); // l'email n'est pas empêché par l'échec Discord
    const echec = faux.logs.find((l) => l.canal === "DISCORD");
    expect(echec?.statut).toBe("ECHEC");
    expect(String(echec?.dedupKey)).toContain("_echec_");
    expect(String(echec?.erreur)).toContain("404");

    // Au passage suivant, le message Discord repart (la clé nominale est libre) sans redoubler les emails.
    faux.discordEchoue = false;
    await notifierAnnulation("s1");
    expect(faux.discord).toHaveLength(1);
    expect(faux.emails).toHaveLength(2);
  });
});

describe("alerte « peu de monde »", () => {
  it("prévient l'équipe par email et poste l'alerte sur le salon, une seule fois", async () => {
    expect(await alerterEffectifFaible(new Date("2026-09-25T05:00:00Z"))).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual(["charlie@club.test"]);
    expect(faux.discord).toHaveLength(1);
    expect(faux.discord[0].embed.title).toBe("⚠️ Peu de monde annoncé");
    expect(faux.logs.map((l) => l.dedupKey).sort()).toEqual(["effectif_discord_s2_2026-09-26-1900", "effectif_s2_2026-09-26-1900"]);
    expect(await alerterEffectifFaible(new Date("2026-09-25T05:00:00Z"))).toBe(0);
    expect(faux.discord).toHaveLength(1);
  });

  /**
   * Vécu : deux alertes le même matin, pour les cours du 6 et. Un cours lointain n'a rien à
   * signaler — personne n'a encore répondu, et il n'y a rien à décider.
   */
  it("laisse tranquille un cours au-delà de trois jours", async () => {
    faux.prochaines = [{ ...seanceCreuse(), id: "s9", date: "2026-10-06" }];
    expect(await alerterEffectifFaible(new Date("2026-09-29T05:00:00Z"))).toBe(0);
    expect(faux.emails).toHaveLength(0);
    expect(faux.discord).toHaveLength(0);
    expect(faux.logs).toHaveLength(0);
  });

  it("reste éteinte sur Discord tant que la case n'est pas cochée (réglages par défaut)", async () => {
    faux.prefs = serialiserPreferences(preferencesDefaut());
    await alerterEffectifFaible(new Date("2026-09-25T05:00:00Z"));
    expect(faux.emails).toHaveLength(1);
    expect(faux.discord).toHaveLength(0);
  });

  /**
   * L'alerte part aussi sur le téléphone des instructeurs, et se journalise **par personne** :
   * c'est ce qui permet de la reprendre pour quelqu'un qui branche un appareil entre deux matins,
   * alors que l'email, lui, n'écrit qu'une ligne pour toute l'équipe.
   */
  it("réveille aussi l'équipe sur son téléphone, avec une clé de journal par instructeur", async () => {
    const avecTelephone = preferencesDefaut();
    avecTelephone.notifications.effectif_faible = { email: true, push: true, discord: true, whatsapp: false };
    faux.prefs = serialiserPreferences(avecTelephone);
    expect(await alerterEffectifFaible(new Date("2026-09-25T05:00:00Z"))).toBe(1);
    expect(faux.logs.map((l) => l.dedupKey).sort()).toEqual(["effectif_discord_s2_2026-09-26-1900", "effectif_push_s2_2026-09-26-1900_i1", "effectif_s2_2026-09-26-1900"]);
    expect(faux.logs.find((l) => l.canal === "PUSH")?.userId).toBe("i1");
    // Rejoué le lendemain matin : ni second email, ni seconde notification.
    expect(await alerterEffectifFaible(new Date("2026-09-25T05:00:00Z"))).toBe(0);
    expect(faux.logs.filter((l) => l.canal === "PUSH")).toHaveLength(1);
  });

  it("garde le téléphone quand le club coupe l'email, et l'inverse", async () => {
    const pushSeul = preferencesDefaut();
    pushSeul.notifications.effectif_faible = { email: false, push: true, discord: false, whatsapp: false };
    faux.prefs = serialiserPreferences(pushSeul);
    await alerterEffectifFaible(new Date("2026-09-25T05:00:00Z"));
    expect(faux.emails).toHaveLength(0);
    expect(faux.logs.map((l) => l.dedupKey)).toEqual(["effectif_push_s2_2026-09-26-1900_i1"]);
  });

  it("ne publie aucun lien d'annulation sur le salon", async () => {
    await alerterEffectifFaible(new Date("2026-09-25T05:00:00Z"));
    expect(JSON.stringify(faux.discord[0].embed)).not.toContain("/annuler/");
  });
});

describe("état des canaux (ce que reçoit la page des réglages)", () => {
  it("grise Discord tant qu'aucun salon n'est branché, et WhatsApp toujours", async () => {
    faux.webhook = "";
    const etats = await etatsCanaux();
    expect(etats.discord.operationnel).toBe(false);
    expect(etats.discord.resume).toBe("Aucun salon branché");
    expect(etats.discord.lienConfig).toBe("/admin/notifications/discord");
    expect(raisonCanalIndisponible(etats.discord)).toBe("Discord n'est pas configuré");
    expect(etats.whatsapp.operationnel).toBe(false);
    expect(etats.whatsapp.lienConfig).toBe("/admin/notifications/whatsapp");
    /*
     * **« Site du club » : « non configuré » ne voudrait rien dire.** Il n'y a rien à y brancher — ce
     * qui manque, c'est une décision du bureau. Sa phrase doit donc nommer la case et l'endroit où
     * on la coche, sans quoi personne ne trouve pourquoi la colonne est grisée.
     */
    expect(etats.api.operationnel).toBe(false);
    expect(etats.api.lienConfig).toBe("/admin/notifications/api");
    expect(raisonCanalIndisponible(etats.api)).toContain("Publication des cours sur le site du club");
    expect(raisonCanalIndisponible(etats.api)).not.toContain("n'est pas configuré");
    // Le téléphone, lui, n'a rien à brancher : ses clés se créent toutes seules. Ce qui peut
    // manquer, ce sont des appareils abonnés — et le résumé le dit plutôt que de griser le canal.
    expect(etats.push.operationnel).toBe(true);
    expect(etats.push.resume).toContain("Aucun appareil abonné");
    expect(etats.push.lienConfig).toBe("/admin/notifications/push");
  });

  it("ne montre jamais l'URL du webhook en clair", async () => {
    const etats = await etatsCanaux();
    expect(etats.discord.operationnel).toBe(true);
    expect(etats.discord.detail).toContain("•");
    expect(etats.discord.detail).not.toContain("/webhook");
  });

  /**
   * **Un canal non configuré n'est pas réglable du tout** : le formulaire ne l'allume pas (c'était
   * déjà vrai), et il ne l'éteint pas non plus — les cellules `disabled` que l'écran affiche ne
   * sont pas envoyées par le navigateur, elles n'expriment donc aucune décision.
   */
  it("ne laisse le formulaire ni allumer un canal non configuré, ni effacer ses cases", async () => {
    faux.webhook = "";
    // En base : personne n'a rien coché du côté de Discord ; l'annulation, elle, est cochée sur Telegram.
    const avant = preferencesDefaut();
    avant.canaux.discord = false;
    avant.notifications.recap_veille.discord = false;
    avant.notifications.seance_annulee.discord = false;
    avant.notifications.evenement_nouveau.discord = false;
    // Ce que le formulaire renvoie : Discord et WhatsApp cochés de force, et la ligne Telegram vidée.
    const force = preferencesDefaut();
    force.canaux.discord = true;
    force.canaux.whatsapp = true;
    force.notifications.seance_annulee = { email: true, discord: true, telegram: false, whatsapp: true };
    force.notifications.recap_veille.email = false;
    const { prefs, figes } = figerCanauxIndisponibles(avant, force, canauxOperationnels(await etatsCanaux()));
    // Aucun salon branché, aucun service WhatsApp : le formulaire n'allume rien de ce côté…
    expect(prefs.canaux.discord).toBe(false);
    expect(prefs.notifications.seance_annulee.discord).toBe(false);
    expect(prefs.canaux.whatsapp).toBe(false);
    expect(prefs.notifications.seance_annulee.whatsapp).toBe(false);
    // … et il n'éteint rien non plus : la case Telegram d'avant survit, grisée mais intacte.
    expect(avant.notifications.seance_annulee.telegram).toBe(true);
    expect(prefs.notifications.seance_annulee.telegram).toBe(true);
    // Telegram est donc le seul dont il y a quelque chose à dire à l'écran : des cases cochées qui ne
    // peuvent rien faire. Discord et WhatsApp sont éteints de partout, « Site du club » aussi (aucune
    // de ses trois cases n'est cochée dans une base neuve) — rien à signaler pour eux.
    expect(figes).toEqual(["telegram"]);
    // Contre-épreuve : l'email est branché, c'est donc le formulaire qui décide, dans les deux sens.
    expect(prefs.notifications.seance_annulee.email).toBe(true);
    expect(avant.notifications.recap_veille.email).toBe(true);
    expect(prefs.notifications.recap_veille.email).toBe(false);
  });

  it("bloque l'envoi sur un canal non branché même si la case est restée cochée en base", async () => {
    faux.webhook = "";
    faux.prefs = prefsToutDiscord(); // toutes les cases Discord cochées
    expect(await envoiPossible("seance_annulee", "discord")).toBe(false);
    expect(await envoiPossible("seance_annulee", "email")).toBe(true);
  });
});

describe("limite de débit de Discord (429)", () => {
  it("lit retry_after du corps, sinon l'en-tête, et plafonne l'attente", () => {
    expect(attenteRetry(1.5, null)).toBe(1500);
    expect(attenteRetry(undefined, "2")).toBe(2000);
    expect(attenteRetry(undefined, null)).toBe(1000);
    expect(attenteRetry(120, null)).toBe(30_000);
  });

  it("attend puis réessaie après un 429, et n'insiste pas sur un webhook invalide", async () => {
    const reel = await vi.importActual<typeof import("@/lib/notifications/discord")>("@/lib/notifications/discord");
    const reponses = [
      { ok: false, status: 429, headers: new Headers({ "retry-after": "0" }), json: async () => ({ retry_after: 0 }), text: async () => "" },
      { ok: true, status: 204, headers: new Headers(), json: async () => ({}) },
    ];
    const fetchBouchon = vi.fn(async () => reponses.shift() as unknown as Response);
    vi.stubGlobal("fetch", fetchBouchon);
    await expect(reel.posterDiscord("https://discord.test/webhook", { title: "Test" })).resolves.toBeUndefined();
    expect(fetchBouchon).toHaveBeenCalledTimes(2);

    const refus = vi.fn(async () => ({ ok: false, status: 404, headers: new Headers(), json: async () => ({}), text: async () => '{"message":"Unknown Webhook"}' }) as unknown as Response);
    vi.stubGlobal("fetch", refus);
    await expect(reel.posterDiscord("https://discord.test/webhook", { title: "Test" })).rejects.toThrow("404");
    expect(refus).toHaveBeenCalledTimes(1); // un webhook supprimé : inutile d'insister
    vi.unstubAllGlobals();
  });
});
