import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Préférences de notifications par personne** (`User.preferencesNotifications`).
 *
 * Deux niveaux : le club décide de ce qu'il envoie (matrice de `/admin/notifications`), la personne
 * décide de ce qu'elle accepte encore. On vérifie ici la règle de composition — on ne peut que
 * **refuser**, jamais s'ajouter ce que le club a coupé —, la reprise de la case historique
 * `rappelEmail`, le fait qu'une valeur abîmée ne casse rien, et que les messages d'accès et de
 * sécurité restent hors de portée des deux réglages.
 *
 * La dernière partie du fichier fait tourner la nouvelle annonce « nouvel événement » avec une base
 * simulée, pour la dédup : jamais deux fois pour le même événement.
 */

type LigneLog = { type: string; canal: string; sessionId: string | null; userId: string | null; dedupKey: string; statut: string; erreur: string | null };

const faux = vi.hoisted(() => ({
  evenement: null as Record<string, unknown> | null,
  membres: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; sujet: string; ref?: string }>,
  discord: [] as Array<{ url: string; embed: Record<string, unknown> }>,
  editions: [] as Array<{ url: string; messageId: string; embed: Record<string, unknown> }>,
  prefs: null as string | null,
  webhook: "https://discord.test/webhook",
}));

vi.mock("@/lib/db", () => ({
  db: {
    evenement: {
      findUnique: vi.fn(async () => faux.evenement),
      // Le salon range l'identifiant du message posté dans la ligne de l'événement : c'est lui qui
      // fera la différence, plus tard, entre annoncer et corriger l'annonce.
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (faux.evenement) Object.assign(faux.evenement, data);
        return faux.evenement;
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
      update: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; sujet: string; ref?: string }) => {
    faux.emails.push(mail);
  }),
}));

vi.mock("@/lib/settings", () => ({
  CLES: { notifications: "notifications", recapHour: "recapHour", discordWebhookUrl: "discordWebhookUrl", discordWebhooks: "discordWebhooks" },
  getSetting: vi.fn(async (cle: string) => (cle === "notifications" ? faux.prefs : null)),
  setSetting: vi.fn(async () => {}),
  getDiscordWebhookUrl: vi.fn(async () => ({ url: faux.webhook, source: "app" as const })),
}));

vi.mock("@/lib/notifications/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/discord")>()),
  posterDiscord: vi.fn(async (url: string, embed: Record<string, unknown>) => {
    faux.discord.push({ url, embed });
  }),
  // L'annonce d'un événement passe par l'envoi qui **garde l'identifiant** du message : c'est ce
  // qui permettra de l'éditer plus tard plutôt que d'en poster un second.
  posterEtRetenirId: vi.fn(async (url: string, embed: Record<string, unknown>) => {
    faux.discord.push({ url, embed });
    return "msg-1";
  }),
  editerMessageDiscord: vi.fn(async (url: string, messageId: string, embed: Record<string, unknown>) => {
    faux.editions.push({ url, messageId, embed });
    return "edite" as const;
  }),
}));

const {
  NOTIFICATIONS_TOUJOURS_ENVOYEES,
  RESPECTE_RAPPEL_EMAIL,
  TYPES_NOTIFICATION,
  TYPES_REFUSABLES,
  accepteNotification,
  destinataireRetenu,
  estTypeNotification,
  lirePreferences,
  lirePreferencesPersonnelles,
  miseAJourPersonnelle,
  preferencesDefaut,
  preferencesPersonnellesDefaut,
  serialiserPreferencesPersonnelles,
} = await import("@/lib/notifications/preferences");
const { cleEvenementDiscord, cleEvenementEmail, notifierNouvelEvenement, quandEvenement } = await import("@/lib/notifications/evenements");

/** Un jeu de préférences club « tout allumé », tel qu'il sort des valeurs par défaut. */
const CLUB = preferencesDefaut();

describe("valeur par défaut : personne n'a rien réglé", () => {
  it("reçoit tout ce que le club envoie", () => {
    const defaut = preferencesPersonnellesDefaut();
    // Un choix par canal personnel depuis que le téléphone existe : par défaut, tout arrive
    // par les deux (voir `CANAUX_PERSONNELS`).
    for (const type of TYPES_NOTIFICATION) expect(defaut[type]).toEqual({ email: true, push: true });
  });

  it("laisse passer un destinataire dont la colonne est vide (null, undefined, chaîne vide)", () => {
    for (const brut of [null, undefined, ""]) {
      const personne = { actif: true, email: "chloe@club.test", rappelEmail: true, preferencesNotifications: brut };
      for (const type of TYPES_NOTIFICATION) {
        if (!CLUB.notifications[type].email) continue;
        expect(destinataireRetenu(CLUB, type, "email", personne)).toBe(true);
      }
    }
  });

  it("annonce les nouveaux événements par défaut, des deux côtés", () => {
    // `api` (« Site du club ») a sa case, mais **décochée** : une annonce ne se republie sur le site
    // que si le bureau l'a décidé, et une mise à jour ne publie rien de plus qu'avant.
    expect(CLUB.notifications.evenement_nouveau).toEqual({ email: true, push: true, discord: true, telegram: true, api: false });
    expect(preferencesPersonnellesDefaut().evenement_nouveau).toEqual({ email: true, push: true });
  });
});

describe("refus personnel", () => {
  const refuse = (types: Record<string, boolean>) => ({
    actif: true,
    email: "charlie@club.test",
    rappelEmail: true,
    preferencesNotifications: JSON.stringify(types),
  });

  it("est respecté, type par type, sans toucher aux autres", () => {
    const personne = refuse({ recap_veille: false, evenement_nouveau: false });
    expect(destinataireRetenu(CLUB, "recap_veille", "email", personne)).toBe(false);
    expect(destinataireRetenu(CLUB, "evenement_nouveau", "email", personne)).toBe(false);
    // les autres types continuent de lui parvenir
    expect(destinataireRetenu(CLUB, "rappel_sans_reponse", "email", personne)).toBe(true);
    expect(destinataireRetenu(CLUB, "seance_annulee", "email", personne)).toBe(true);
    expect(destinataireRetenu(CLUB, "atelier_statut", "email", personne)).toBe(true);
  });

  it("vaut pour chaque canal qui s'adresse à la personne", () => {
    // Un refus posé sans préciser le canal (ancien format, ou case unique de la fiche du bureau)
    // coupe les deux canaux personnels : l'email et le téléphone.
    const personne = refuse({ evenement_nouveau: false });
    expect(accepteNotification(personne, "evenement_nouveau", "email")).toBe(false);
    expect(accepteNotification(personne, "evenement_nouveau", "push")).toBe(false);
    expect(destinataireRetenu(CLUB, "evenement_nouveau", "email", personne)).toBe(false);
    expect(destinataireRetenu(CLUB, "evenement_nouveau", "push", personne)).toBe(false);
  });

  it("ne s'applique pas aux canaux de salon : personne ne se désabonne d'un message au groupe", () => {
    // Discord (et demain WhatsApp) parlent au club, pas à quelqu'un : il n'y a rien d'individuel à
    // y refuser, c'est le bureau qui décide d'y publier ou non. C'est déjà la règle du module
    // (aucun envoi de salon n'appelle `destinataireRetenu`), elle est maintenant explicite.
    const personne = refuse({ evenement_nouveau: false });
    expect(destinataireRetenu(CLUB, "evenement_nouveau", "discord", personne)).toBe(true);
  });

  it("porte sur tous les types de la matrice : rien d'autre n'est refusable", () => {
    expect([...TYPES_REFUSABLES]).toEqual([...TYPES_NOTIFICATION]);
  });

  it("n'écrit en base que des types connus et des booléens", () => {
    const ecrit = JSON.parse(serialiserPreferencesPersonnelles(preferencesPersonnellesDefaut(false))) as Record<string, unknown>;
    expect(Object.keys(ecrit).sort()).toEqual([...TYPES_NOTIFICATION].sort());
    // Une ligne par type, et dans chaque ligne un booléen par canal personnel : rien d'autre
    for (const valeur of Object.values(ecrit)) {
      expect(Object.keys(valeur as Record<string, unknown>).sort()).toEqual(["email", "push"]);
      for (const v of Object.values(valeur as Record<string, unknown>)) expect(typeof v).toBe("boolean");
    }
    expect(estTypeNotification("evenement_nouveau")).toBe(true);
    expect(estTypeNotification("pigeon")).toBe(false);
  });
});

describe("règle de composition : on ne peut que refuser", () => {
  const gourmand = {
    actif: true,
    email: "anne@club.test",
    rappelEmail: true,
    // Cette personne « accepte » tout : cela ne peut rien rallumer.
    preferencesNotifications: JSON.stringify(Object.fromEntries(TYPES_NOTIFICATION.map((t) => [t, true]))),
  };

  it("ne rallume pas un canal que le club a coupé", () => {
    const clubSansEmail = lirePreferences(JSON.stringify({ canaux: { email: false } }));
    for (const type of TYPES_NOTIFICATION) expect(destinataireRetenu(clubSansEmail, type, "email", gourmand)).toBe(false);
  });

  it("ne rallume pas une case que le club a décochée", () => {
    const clubSansEvenement = lirePreferences(JSON.stringify({ notifications: { evenement_nouveau: { email: false, discord: false } } }));
    expect(destinataireRetenu(clubSansEvenement, "evenement_nouveau", "email", gourmand)).toBe(false);
    expect(destinataireRetenu(clubSansEvenement, "evenement_nouveau", "discord", gourmand)).toBe(false);
    // …et ce que le club laisse passer reste accepté
    expect(destinataireRetenu(clubSansEvenement, "recap_veille", "email", gourmand)).toBe(true);
  });

  it("ne rallume pas un couple qui n'a pas de sens (un message personnel sur le salon public)", () => {
    expect(destinataireRetenu(CLUB, "atelier_statut", "discord", gourmand)).toBe(false);
  });

  it("n'écarte ni les comptes actifs sans réglage, ni ne retient les comptes désactivés", () => {
    expect(destinataireRetenu(CLUB, "seance_annulee", "email", { actif: false, email: "x@club.test" })).toBe(false);
    expect(destinataireRetenu(CLUB, "seance_annulee", "email", { actif: true, email: null })).toBe(false);
  });
});

describe("messages non refusables (accès et sécurité)", () => {
  it("n'ont aucun type dans la matrice : ni le club ni la personne ne peuvent les couper", () => {
    const titres = NOTIFICATIONS_TOUJOURS_ENVOYEES.map((n) => n.titre);
    expect(titres).toContain("Alertes de sécurité");
    expect(titres).toContain("Lien d'accès personnel");
    expect(titres).toContain("Nouvel appareil");
    expect(titres).toContain("Mot de passe oublié");
    for (const titre of titres) {
      expect([...TYPES_NOTIFICATION]).not.toContain(titre);
      expect(estTypeNotification(titre)).toBe(false);
    }
  });

  it("partent quoi qu'il arrive : leurs envois ne consultent aucune préférence", () => {
    for (const fichier of ["src/lib/alertes.ts", "src/lib/invitations.ts", "src/actions/auth.ts"]) {
      const source = readFileSync(path.join(process.cwd(), fichier), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/notificationActive|canalActif|destinataireRetenu|accepteNotification|preferencesNotifications/);
    }
  });

  it("ne sont pas atteignables en bricolant le JSON du profil", () => {
    const bricoleur = { actif: true, email: "x@club.test", preferencesNotifications: JSON.stringify({ "Lien d'accès personnel": false, alerte_securite: false }) };
    // Rien n'a changé pour les types connus : les clés inconnues sont ignorées.
    for (const type of TYPES_NOTIFICATION) expect(accepteNotification(bricoleur, type, "email")).toBe(true);
  });
});

describe("reprise de la case historique « rappel la veille »", () => {
  it("sert de valeur par défaut aux deux types de rappel, et à eux seuls", () => {
    expect([...RESPECTE_RAPPEL_EMAIL]).toEqual(["recap_veille", "rappel_sans_reponse"]);
    const coupe = preferencesPersonnellesDefaut(false);
    // La case historique coupe les rappels **sur les deux canaux** : brancher son téléphone ne
    // doit pas rendre à quelqu'un des rappels qu'il avait justement coupés.
    expect(coupe.recap_veille).toEqual({ email: false, push: false });
    expect(coupe.rappel_sans_reponse).toEqual({ email: false, push: false });
    expect(coupe.seance_annulee).toEqual({ email: true, push: true });
    expect(coupe.evenement_nouveau).toEqual({ email: true, push: true });
  });

  it("ne perd pas le réglage de qui avait coupé ses rappels avant la migration", () => {
    const desinscrit = { actif: true, email: "marc@club.test", rappelEmail: false, preferencesNotifications: null };
    expect(destinataireRetenu(CLUB, "recap_veille", "email", desinscrit)).toBe(false);
    expect(destinataireRetenu(CLUB, "rappel_sans_reponse", "email", desinscrit)).toBe(false);
    // …sans pour autant le couper de ce qui n'est pas un rappel
    expect(destinataireRetenu(CLUB, "seance_annulee", "email", desinscrit)).toBe(true);
    expect(destinataireRetenu(CLUB, "evenement_nouveau", "email", desinscrit)).toBe(true);
  });

  it("s'efface devant un choix explicite, type par type", () => {
    const personne = { actif: true, email: "marc@club.test", rappelEmail: false, preferencesNotifications: JSON.stringify({ recap_veille: true }) };
    expect(destinataireRetenu(CLUB, "recap_veille", "email", personne)).toBe(true);
    expect(destinataireRetenu(CLUB, "rappel_sans_reponse", "email", personne)).toBe(false); // rien de choisi : la case historique décide encore
  });

  it("reste en miroir à chaque enregistrement (elle est vraie tant qu'un rappel est accepté)", () => {
    const vierge = { rappelEmail: true, preferencesNotifications: null };
    const sansRecap = miseAJourPersonnelle(vierge, { recap_veille: false });
    expect(sansRecap.rappelEmail).toBe(true); // le rappel sans réponse continue
    const sansRien = miseAJourPersonnelle({ rappelEmail: true, preferencesNotifications: sansRecap.preferencesNotifications }, { rappel_sans_reponse: false });
    expect(sansRien.rappelEmail).toBe(false);
    expect(JSON.parse(sansRien.preferencesNotifications)).toMatchObject({
      recap_veille: { email: false, push: false },
      rappel_sans_reponse: { email: false, push: false },
      seance_annulee: { email: true, push: true },
    });
  });

  it("ne touche pas aux autres choix quand on n'en règle qu'un", () => {
    const depart = { rappelEmail: true, preferencesNotifications: JSON.stringify({ evenement_nouveau: false }) };
    const apres = JSON.parse(miseAJourPersonnelle(depart, { recap_veille: false }).preferencesNotifications) as Record<string, Record<string, boolean>>;
    expect(apres.evenement_nouveau).toEqual({ email: false, push: false });
    expect(apres.recap_veille).toEqual({ email: false, push: false });
    expect(apres.seance_annulee).toEqual({ email: true, push: true });
  });
});

describe("JSON illisible ou abîmé", () => {
  const ABIMES = ["pas du json", "{", "[]", '"texte"', "42", "null", "{}", '{"recap_veille":"oui"}', '{"inconnu":true}'];

  it("retombe sur les valeurs par défaut, sans jamais lever", () => {
    for (const brut of ABIMES) {
      expect(() => lirePreferencesPersonnelles(brut)).not.toThrow();
      expect(lirePreferencesPersonnelles(brut)).toEqual(preferencesPersonnellesDefaut());
      expect(lirePreferencesPersonnelles(brut, false)).toEqual(preferencesPersonnellesDefaut(false));
    }
  });

  it("ne coupe rien de ce qui partait : un profil abîmé reçoit comme avant", () => {
    for (const brut of ABIMES) {
      const personne = { actif: true, email: "chloe@club.test", rappelEmail: true, preferencesNotifications: brut };
      expect(destinataireRetenu(CLUB, "recap_veille", "email", personne)).toBe(true);
      expect(destinataireRetenu(CLUB, "evenement_nouveau", "email", personne)).toBe(true);
    }
  });

  it("garde les clés valides d'un JSON à moitié abîmé", () => {
    const prefs = lirePreferencesPersonnelles('{"recap_veille":false,"seance_annulee":"peut-être","pigeon":true}');
    expect(prefs.recap_veille).toEqual({ email: false, push: false });
    expect(prefs.seance_annulee).toEqual({ email: true, push: true });
  });
});

describe("annonce d'un nouvel événement", () => {
  const EVENEMENT = {
    id: "e-1",
    nom: "Stage de messer",
    dateDebut: "2026-10-10",
    heureDebut: "09:00",
    dateFin: null,
    heureFin: "18:00",
    lieu: "Gymnase municipal",
    organisateur: "Mon club d'AMHE",
    publie: true,
  };
  const MAINTENANT = new Date("2026-09-23T10:00:00Z");

  const membre = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    prenom: id,
    email: `${id}@club.test`,
    actif: true,
    rappelEmail: true,
    preferencesNotifications: null,
    service: false,
    ...extra,
  });

  beforeEach(() => {
    faux.evenement = { ...EVENEMENT };
    faux.membres = [membre("chloe"), membre("charlie")];
    faux.logs = [];
    faux.emails = [];
    faux.discord = [];
    faux.editions = [];
    faux.prefs = null;
  });

  it("part une fois : un email par membre des périodes actives et un message sur le salon", async () => {
    const bilan = await notifierNouvelEvenement("e-1", MAINTENANT);
    expect(bilan).toEqual({ emails: 2, discord: true, telegram: false });
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["charlie@club.test", "chloe@club.test"]);
    expect(faux.emails[0].sujet).toContain("Stage de messer");
    // Le contenu commun : date en toutes lettres, horaire, lieu, organisateur, lien vers l'app.
    const embed = faux.discord[0].embed as { title: string; description: string };
    expect(embed.title).toContain("Stage de messer");
    expect(embed.description).toContain("Samedi 10 octobre 2026 — 09h00 à 18h00");
    expect(embed.description).toContain("Gymnase municipal");
    expect(embed.description).toContain("Mon club d'AMHE");
    expect(embed.description).toContain("/evenements/e-1");
  });

  it("ne repart jamais pour le même événement (dédup par NotificationLog)", async () => {
    await notifierNouvelEvenement("e-1", MAINTENANT);
    faux.emails = [];
    faux.discord = [];
    // Deuxième publication (rejeu d'une action, enregistrement du formulaire, deux instances…)
    expect(await notifierNouvelEvenement("e-1", MAINTENANT)).toEqual({ emails: 0, discord: false, telegram: false });
    expect(faux.emails).toEqual([]);
    // Aucun second message sur le salon : celui qui existe est simplement **mis à jour** sur place.
    expect(faux.discord).toEqual([]);
    expect(faux.editions.map((e) => e.messageId)).toEqual(["msg-1"]);
    // Une clé par personne, plus celle du salon : sans horodatage, donc jamais rejouées.
    expect(faux.logs.map((l) => l.dedupKey).sort()).toEqual([cleEvenementDiscord("e-1"), cleEvenementEmail("e-1", "charlie"), cleEvenementEmail("e-1", "chloe")].sort());
  });

  it("saute qui a refusé les nouveaux événements dans son profil", async () => {
    faux.membres = [membre("chloe"), membre("charlie", { preferencesNotifications: JSON.stringify({ evenement_nouveau: false }) })];
    const bilan = await notifierNouvelEvenement("e-1", MAINTENANT);
    expect(bilan.emails).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual(["chloe@club.test"]);
  });

  it("ne part pas du tout si le club a coupé la notification, même pour qui l'accepte", async () => {
    faux.prefs = JSON.stringify({ canaux: { email: true, discord: true }, notifications: { evenement_nouveau: { email: false, discord: false } } });
    faux.membres = [membre("chloe", { preferencesNotifications: JSON.stringify({ evenement_nouveau: true }) })];
    expect(await notifierNouvelEvenement("e-1", MAINTENANT)).toEqual({ emails: 0, discord: false, telegram: false });
    expect(faux.logs).toEqual([]);
  });

  it("n'annonce pas un brouillon, ni un événement déjà passé, et ne lève jamais", async () => {
    faux.evenement = { ...EVENEMENT, publie: false };
    expect(await notifierNouvelEvenement("e-1", MAINTENANT)).toEqual({ emails: 0, discord: false, telegram: false });
    faux.evenement = { ...EVENEMENT, dateDebut: "2026-09-01" };
    expect(await notifierNouvelEvenement("e-1", MAINTENANT)).toEqual({ emails: 0, discord: false, telegram: false });
    faux.evenement = null;
    await expect(notifierNouvelEvenement("inconnu", MAINTENANT)).resolves.toEqual({ emails: 0, discord: false, telegram: false });
    expect(faux.emails).toEqual([]);
  });

  it("dit le « quand » en toutes lettres, avec ou sans horaire", () => {
    const base = { id: "e", nom: "x", lieu: "", organisateur: "", dateFin: null, heureFin: null };
    expect(quandEvenement({ ...base, dateDebut: "2026-10-10", heureDebut: "09:00", heureFin: "18:00" })).toBe("Samedi 10 octobre 2026 — 09h00 à 18h00");
    expect(quandEvenement({ ...base, dateDebut: "2026-10-10", heureDebut: "09:00" })).toBe("Samedi 10 octobre 2026 — à partir de 09h00");
    expect(quandEvenement({ ...base, dateDebut: "2026-10-10", heureDebut: null })).toBe("Samedi 10 octobre 2026 — toute la journée");
    expect(quandEvenement({ ...base, dateDebut: "2026-10-10", heureDebut: "09:00", dateFin: "2026-10-11", heureFin: "17:00" })).toBe(
      "Du samedi 10 octobre 2026 à 09h00 au dimanche 11 octobre 2026 à 17h00",
    );
  });
});
