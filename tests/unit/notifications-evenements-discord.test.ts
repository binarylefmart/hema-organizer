import { beforeEach, describe, expect, it, vi } from "vitest";
import { chiffrer } from "@/lib/crypto";

/**
 * **Le salon Discord des événements reste à jour** (et pas seulement prévenu une fois).
 *
 * Tout est simulé — la base (une table `Setting` et une table `Evenement` en mémoire), les emails,
 * et `fetch` : aucun message ne part vers un vrai salon. En revanche, `src/lib/notifications/discord.ts`
 * et `src/lib/settings.ts` tournent **pour de vrai**, chiffrement compris : ce sont justement
 * l'adresse appelée (`?wait=true`, `/messages/<id>`), le verbe HTTP et le repli d'un webhook sur
 * l'autre qu'on vient vérifier ici.
 *
 * Ce qui est couvert :
 * - un webhook **par notification**, facultatif, chiffré en base, le repli sur le salon principal,
 *   et la **reprise** de l'ancien réglage `discordWebhookEvenementsUrl` ;
 * - la **publication** : POST avec `?wait=true`, identifiant du message rangé dans `Evenement` ;
 * - la **modification** : PATCH du message existant, jamais un second message ;
 * - la **reprise après 404** : message effacé à la main sur le salon ⇒ annonce reposée proprement ;
 * - la **dépublication et la suppression** : le message est barré « Annulé » ;
 * - une **panne Discord** n'empêche ni les emails, ni l'enregistrement, et la clé est libérée ;
 * - le message est signé du **nom du club tel qu'il est réglé** (`Setting.identite`) : aucun nom
 *   n'est écrit dans le code, une instance neuve part sous le nom livré.
 */

type LigneLog = { type: string; canal: string; sessionId: string | null; userId: string | null; dedupKey: string; statut: string; erreur: string | null };
type Appel = { url: string; methode: string; corps: Record<string, unknown> | null };

const faux = vi.hoisted(() => ({
  reglages: new Map<string, string>(),
  evenement: null as Record<string, unknown> | null,
  membres: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; sujet: string; ref?: string }>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => {
        const value = faux.reglages.get(args.where.key);
        return value === undefined ? null : { key: args.where.key, value };
      }),
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
        faux.reglages.set(where.key, create.value);
        return create;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
        faux.reglages.delete(where.key);
        return { count: 1 };
      }),
    },
    evenement: {
      findUnique: vi.fn(async () => (faux.evenement ? { ...faux.evenement } : null)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!faux.evenement) throw new Error("aucun événement à mettre à jour");
        Object.assign(faux.evenement, data);
        return { ...faux.evenement };
      }),
    },
    user: { findMany: vi.fn(async () => faux.membres) },
    pushAbonnement: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
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

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; sujet: string; ref?: string }) => {
    faux.emails.push(mail);
  }),
}));

// Le téléphone n'a rien à faire ici : aucune clé VAPID à créer, aucun appareil à réveiller.
vi.mock("@/lib/notifications/push", () => ({
  pushConfigure: vi.fn(async () => false),
  notifierPersonnes: vi.fn(async () => new Map()),
}));

const { CLES } = await import("@/lib/settings");
const { salonPour, salonsDiscord, setSalonDiscord } = await import("@/lib/notifications/webhooks");
const { COULEUR_BLEU, COULEUR_ROUGE, urlAvecAttente, urlMessageWebhook } = await import("@/lib/notifications/discord");
const { cleEvenementDiscord, embedEvenementRetire, embedNouvelEvenement, notifierNouvelEvenement, retirerAnnonceDiscord, synchroniserAnnonceDiscord } =
  await import("@/lib/notifications/evenements");

const SALON_COURS = "https://discord.com/api/webhooks/111/jeton-des-cours";
const SALON_EVENEMENTS = "https://discord.com/api/webhooks/222/jeton-des-annonces";
const MAINTENANT = new Date("2026-09-23T10:00:00Z");

/** Le nom du club, passé aux mises en forme : elles sont pures, l'identité se lit chez l'appelant. */
const NOM_CLUB = "Mon club d'AMHE";

const EVENEMENT = {
  id: "e-1",
  nom: "Stage de messer",
  description: "Deux jours de travail au messer,   avec Hans Talhoffer.",
  dateDebut: "2026-10-10",
  heureDebut: "09:00",
  dateFin: null as string | null,
  heureFin: "18:00",
  lieu: "Gymnase municipal",
  organisateur: "Mon club d'AMHE",
  prix: "25 €",
  prixAdherent: "15 €",
  dureeNombre: 2,
  dureeUnite: "jour",
  lienInscription: "https://exemple.test/inscription",
  imageUrl: "/api/affiche/abc.jpg",
  publie: true,
  discordMessageId: null as string | null,
};

/* ─────────────────────────── `fetch` bouchonné : le salon, sans salon ─────────────────────────── */

const appels: Appel[] = [];
/** Ce que « Discord » répond, remplaçable test par test (statut, corps, ou un jet pur et simple). */
let repondre: (appel: Appel) => { status: number; body?: unknown } = () => ({ status: 200, body: { id: "msg-1" } });

const posts = () => appels.filter((a) => a.methode === "POST");
const patchs = () => appels.filter((a) => a.methode === "PATCH");

beforeEach(() => {
  faux.reglages = new Map([[CLES.discordWebhookUrl, chiffrer(SALON_COURS)]]);
  faux.evenement = { ...EVENEMENT };
  faux.membres = [];
  faux.logs = [];
  faux.emails = [];
  appels.length = 0;
  repondre = () => ({ status: 200, body: { id: "msg-1" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method: string; body?: string }) => {
      const appel: Appel = { url: String(url), methode: init.method, corps: init.body ? JSON.parse(init.body) : null };
      appels.push(appel);
      const r = repondre(appel);
      // `text()` comme sur une vraie `Response` : le code lit le corps d'un refus pour dire
      // *pourquoi* Discord a refusé (« Invalid Form Body » et le champ fautif).
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: new Headers(),
        json: async () => r.body ?? {},
        text: async () => JSON.stringify(r.body ?? {}),
      } as unknown as Response;
    }),
  );
});

const membre = (id: string) => ({ id, prenom: id, email: `${id}@club.test`, actif: true, rappelEmail: true, preferencesNotifications: null, service: false });

describe("adresses de l'API Discord", () => {
  it("ajoute ?wait=true à la création (sans lui, on ne saurait pas quel message on vient d'écrire)", () => {
    expect(urlAvecAttente(SALON_COURS)).toBe(`${SALON_COURS}?wait=true`);
    expect(urlAvecAttente(`${SALON_COURS}?thread_id=9`)).toBe(`${SALON_COURS}?thread_id=9&wait=true`);
  });

  it("construit la route d'édition d'un message, sans traîner les paramètres de la création", () => {
    expect(urlMessageWebhook(SALON_COURS, "42")).toBe(`${SALON_COURS}/messages/42`);
    expect(urlMessageWebhook(`${SALON_COURS}?wait=true`, "42")).toBe(`${SALON_COURS}/messages/42`);
    expect(urlMessageWebhook(`${SALON_COURS}/`, "42")).toBe(`${SALON_COURS}/messages/42`);
  });
});

describe("un salon par notification, facultatif", () => {
  it("retombe sur le salon principal tant qu'aucun salon dédié n'est branché", async () => {
    expect(await salonPour("evenement_nouveau")).toEqual({ url: SALON_COURS, source: "herite" });
    await notifierNouvelEvenement("e-1", MAINTENANT);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toBe(`${SALON_COURS}?wait=true`);
  });

  it("envoie sur le salon dédié dès qu'il est branché, et jamais sur le principal", async () => {
    await setSalonDiscord("evenement_nouveau", SALON_EVENEMENTS);
    expect(await salonPour("evenement_nouveau")).toEqual({ url: SALON_EVENEMENTS, source: "dedie" });
    await notifierNouvelEvenement("e-1", MAINTENANT);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toBe(`${SALON_EVENEMENTS}?wait=true`);
    expect(appels.every((a) => !a.url.startsWith(SALON_COURS))).toBe(true);
  });

  it("ne déplace que la notification réglée : le salon d'une autre ne déborde pas", async () => {
    await setSalonDiscord("recap_veille", SALON_EVENEMENTS);
    expect(await salonPour("evenement_nouveau")).toEqual({ url: SALON_COURS, source: "herite" });
    expect(await salonPour("recap_veille")).toEqual({ url: SALON_EVENEMENTS, source: "dedie" });
  });

  it("garde les webhooks chiffrés en base : aucune URL n'y figure en clair", async () => {
    await setSalonDiscord("evenement_nouveau", SALON_EVENEMENTS);
    for (const stocke of faux.reglages.values()) {
      expect(stocke).not.toContain("discord.com");
      expect(stocke).not.toContain("jeton");
    }
  });

  it("reprend tout seul l'ancien réglage du salon des événements, puis oublie l'ancienne clé", async () => {
    // Le réglage d'avant (une clé à lui) : sa valeur doit se retrouver sur `evenement_nouveau`.
    faux.reglages.set(CLES.discordWebhookEvenementsUrl, chiffrer(SALON_EVENEMENTS));
    expect(await salonPour("evenement_nouveau")).toEqual({ url: SALON_EVENEMENTS, source: "dedie" });
    expect(await salonsDiscord()).toEqual({ evenement_nouveau: SALON_EVENEMENTS });
    // Un secret ne se garde pas en double : l'ancienne clé a disparu une fois la reprise faite.
    expect(faux.reglages.has(CLES.discordWebhookEvenementsUrl)).toBe(false);
    await notifierNouvelEvenement("e-1", MAINTENANT);
    expect(posts()[0].url).toBe(`${SALON_EVENEMENTS}?wait=true`);
  });

  it("ne ressuscite pas un salon repris puis effacé à la main", async () => {
    faux.reglages.set(CLES.discordWebhookEvenementsUrl, chiffrer(SALON_EVENEMENTS));
    await salonPour("evenement_nouveau"); // la reprise se joue ici
    await setSalonDiscord("evenement_nouveau", null);
    expect(await salonPour("evenement_nouveau")).toEqual({ url: SALON_COURS, source: "herite" });
  });

  /**
   * **Une table illisible se dégrade en LECTURE, et interdit l'ÉCRITURE**. Ce test se contentait de
   * la première moitié — « se comporte comme un réglage absent » — et c'était précisément le
   * défaut : `setSalonDiscord` est un lire-modifier-écrire, donc le prochain salon réglé par le
   * bureau écrasait la table avec une table d'un seul élément, et les autres salons, encore là sous
   * forme chiffrée, disparaissaient pour de bon. Scénario : rotation de `SESSION_SECRET`, plus rien
   * ne part, le bureau recolle une URL, et trois réglages sont détruits.
   *
   * La lecture, elle, continue de retomber sur le salon du club : son URL peut venir de la variable
   * d'environnement, donc les envois partent encore quelque part. On ne casse pas ce qui marche.
   */
  it("se dégrade en lecture quand la table est illisible, mais refuse de l'écraser", async () => {
    faux.reglages.set(CLES.discordWebhooks, "v1.abimé.abimé.abimé");
    expect(await salonPour("evenement_nouveau")).toEqual({ url: SALON_COURS, source: "herite" });
    await expect(setSalonDiscord("evenement_nouveau", SALON_EVENEMENTS)).rejects.toThrow(/illisible/i);
    // Et surtout : la table n'a pas bougé. C'est elle qui redeviendra lisible.
    expect(faux.reglages.get(CLES.discordWebhooks)).toBe("v1.abimé.abimé.abimé");
  });

  it("ignore une entrée qui ne désigne aucune notification connue", async () => {
    faux.reglages.set(CLES.discordWebhooks, chiffrer(JSON.stringify({ rappel_sans_reponse: SALON_EVENEMENTS, inconnu: SALON_EVENEMENTS })));
    expect(await salonsDiscord()).toEqual({});
  });

  it("ne peut rien envoyer quand aucun salon n'est branché, et ne lève pas", async () => {
    faux.reglages.clear();
    expect(await salonPour("evenement_nouveau")).toEqual({ url: "", source: "aucune" });
    await expect(notifierNouvelEvenement("e-1", MAINTENANT)).resolves.toEqual({ emails: 0, discord: false, telegram: false });
    expect(appels).toHaveLength(0);
  });
});

describe("le message de l'annonce", () => {
  it("porte tout ce qui peut changer : date, durée, lieu, organisateur, prix, description, affiche, lien", () => {
    const embed = embedNouvelEvenement(EVENEMENT, NOM_CLUB);
    expect(embed.color).toBe(COULEUR_BLEU);
    expect(embed.title).toContain("Stage de messer");
    expect(embed.url).toContain("/evenements/e-1");
    expect(embed.description).toContain("Samedi 10 octobre 2026 — 09h00 à 18h00");
    expect(embed.description).toContain("Durée : 2 jours");
    expect(embed.description).toContain("Gymnase municipal");
    expect(embed.description).toContain("25 € · 15 € pour les adhérents");
    // Les espaces multiples de la saisie sont resserrés : l'embed se lit sur une largeur de salon.
    expect(embed.description).toContain("Deux jours de travail au messer, avec Hans Talhoffer.");
    expect(embed.description).toContain("https://exemple.test/inscription");
    // L'affiche est rendue **absolue** : Discord va la chercher depuis ses serveurs.
    expect(embed.image?.url).toBe("https://organizer.mon-club.fr/api/affiche/abc.jpg");
  });

  it("dit « Gratuit » quand le prix est vide, et tait la durée non renseignée", () => {
    const embed = embedNouvelEvenement({ ...EVENEMENT, prix: "", prixAdherent: "", dureeNombre: null }, NOM_CLUB);
    expect(embed.description).toContain("🏷️ Gratuit");
    expect(embed.description).not.toContain("Durée");
  });

  it("nomme le club dans le pied de l'embed, et ce nom vient du réglage", () => {
    expect(embedNouvelEvenement(EVENEMENT, NOM_CLUB).footer?.text).toBe(NOM_CLUB);
    expect(embedNouvelEvenement(EVENEMENT, "Cercle d'escrime ancienne").footer?.text).toBe("Cercle d'escrime ancienne");
  });

  it("barre l'annonce retirée, en rouge, et retire l'affiche", () => {
    const embed = embedEvenementRetire(EVENEMENT, NOM_CLUB);
    expect(embed.title).toBe("❌ Annulé — Stage de messer");
    expect(embed.color).toBe(COULEUR_ROUGE);
    expect(embed.description).toContain("~~📍 Gymnase municipal~~");
    // Une image en grand continue d'annoncer, quoi que dise le texte au-dessus.
    expect(embed.image).toBeUndefined();
  });
});

describe("publication", () => {
  it("signe le message du nom du club réglé en base (rien n'est écrit dans le code)", async () => {
    faux.reglages.set(CLES.identite, JSON.stringify({ club: "Cercle d'escrime ancienne" }));
    await notifierNouvelEvenement("e-1", MAINTENANT);
    expect(posts()[0].corps?.username).toBe("Cercle d'escrime ancienne");
    expect((posts()[0].corps?.embeds as Array<{ footer?: { text: string } }>)[0].footer?.text).toBe("Cercle d'escrime ancienne");
  });

  it("part sous le nom livré tant que le club ne s'est pas nommé", async () => {
    // Une instance qui vient d'être installée : aucun réglage d'identité, aucun nom de club en dur.
    await notifierNouvelEvenement("e-1", MAINTENANT);
    expect(posts()[0].corps?.username).toBe("HEMA Organizer");
  });

  it("poste le message et garde son identifiant dans l'événement", async () => {
    repondre = () => ({ status: 200, body: { id: "1418" } });
    expect(await notifierNouvelEvenement("e-1", MAINTENANT)).toEqual({ emails: 0, discord: true, telegram: false });
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toContain("wait=true");
    expect((posts()[0].corps?.embeds as Array<{ title: string }>)[0].title).toContain("Stage de messer");
    expect(faux.evenement?.discordMessageId).toBe("1418");
    expect(faux.logs.map((l) => l.dedupKey)).toEqual([cleEvenementDiscord("e-1")]);
  });

  it("n'annonce ni un brouillon, ni un événement déjà passé", async () => {
    faux.evenement = { ...EVENEMENT, publie: false };
    expect(await synchroniserAnnonceDiscord("e-1", MAINTENANT)).toBe("rien");
    faux.evenement = { ...EVENEMENT, dateDebut: "2026-09-01", dateFin: null, heureFin: null };
    expect(await synchroniserAnnonceDiscord("e-1", MAINTENANT)).toBe("rien");
    expect(appels).toHaveLength(0);
  });

  it("ne poste rien si le club a décoché « Nouvel événement » sur le salon", async () => {
    faux.reglages.set(CLES.notifications, JSON.stringify({ canaux: { discord: true }, notifications: { evenement_nouveau: { discord: false } } }));
    expect(await synchroniserAnnonceDiscord("e-1", MAINTENANT)).toBe("rien");
    expect(appels).toHaveLength(0);
  });
});

describe("modification", () => {
  it("édite le message existant au lieu d'en poster un second", async () => {
    await notifierNouvelEvenement("e-1", MAINTENANT);
    (faux.evenement as Record<string, unknown>).lieu = "Gymnase municipal, Villebourg";
    (faux.evenement as Record<string, unknown>).prix = "30 €";

    expect(await synchroniserAnnonceDiscord("e-1", MAINTENANT)).toBe("edite");
    expect(posts()).toHaveLength(1); // toujours un seul message sur le salon
    expect(patchs()).toHaveLength(1);
    expect(patchs()[0].url).toBe(`${SALON_COURS}/messages/msg-1`);
    const embed = (patchs()[0].corps?.embeds as Array<{ description: string }>)[0];
    expect(embed.description).toContain("Gymnase municipal, Villebourg");
    expect(embed.description).toContain("30 €");
    // Une édition ne peut pas changer l'auteur du message : Discord refuserait la requête.
    expect(patchs()[0].corps).not.toHaveProperty("username");
    expect(patchs()[0].corps).not.toHaveProperty("avatar_url");
    // Une correction n'est pas une nouvelle annonce : rien de plus au journal.
    expect(faux.logs.map((l) => l.dedupKey)).toEqual([cleEvenementDiscord("e-1")]);
  });

  it("garde la version précédente si Discord ne répond pas, sans jamais poster de doublon", async () => {
    await notifierNouvelEvenement("e-1", MAINTENANT);
    repondre = () => {
      throw new Error("réseau injoignable");
    };
    expect(await synchroniserAnnonceDiscord("e-1", MAINTENANT)).toBe("rien");
    expect(posts()).toHaveLength(1);
    expect(faux.evenement?.discordMessageId).toBe("msg-1"); // on n'oublie surtout pas le message
  });
});

describe("message effacé à la main sur le salon (404)", () => {
  it("oublie l'identifiant et repose une annonce propre", async () => {
    await notifierNouvelEvenement("e-1", MAINTENANT);
    repondre = (a) => (a.methode === "PATCH" ? { status: 404 } : { status: 200, body: { id: "msg-2" } });

    expect(await synchroniserAnnonceDiscord("e-1", MAINTENANT)).toBe("repose");
    expect(patchs()).toHaveLength(1);
    expect(posts()).toHaveLength(2);
    expect(faux.evenement?.discordMessageId).toBe("msg-2");
    // La clé nominale a été libérée (horodatée) puis reprise par la nouvelle annonce.
    expect(faux.logs.filter((l) => l.dedupKey === cleEvenementDiscord("e-1"))).toHaveLength(1);
    expect(faux.logs.some((l) => String(l.dedupKey).includes("_retire_"))).toBe(true);
  });
});

describe("dépublication et suppression", () => {
  it("barre le message quand l'annonce repasse en brouillon, et oublie son identifiant", async () => {
    await notifierNouvelEvenement("e-1", MAINTENANT);
    (faux.evenement as Record<string, unknown>).publie = false;

    expect(await synchroniserAnnonceDiscord("e-1", MAINTENANT)).toBe("retire");
    expect(patchs()).toHaveLength(1);
    const embed = (patchs()[0].corps?.embeds as Array<{ title: string; color: number }>)[0];
    expect(embed.title).toBe("❌ Annulé — Stage de messer");
    expect(embed.color).toBe(COULEUR_ROUGE);
    expect(faux.evenement?.discordMessageId).toBeNull();
  });

  /**
   * Republier est une **publication** : c'est `notifierNouvelEvenement` qui passe, pas la simple
   * synchronisation. La distinction n'est pas cosmétique —, `synchroniser…` ne pose plus jamais une
   * *première* annonce, sans quoi une modification suffisait à annoncer comme neuf un événement
   * publié avant que le salon (ou Telegram) n'existe.
   */
  it("repose une annonce neuve si l'événement est republié (personne ne relit un vieux message)", async () => {
    await notifierNouvelEvenement("e-1", MAINTENANT);
    (faux.evenement as Record<string, unknown>).publie = false;
    await synchroniserAnnonceDiscord("e-1", MAINTENANT);

    repondre = () => ({ status: 200, body: { id: "msg-3" } });
    (faux.evenement as Record<string, unknown>).publie = true;
    // La synchronisation seule ne repose rien : le salon n'a plus de message, et ce n'est pas elle
    // qui décide d'en refaire un.
    expect(await synchroniserAnnonceDiscord("e-1", MAINTENANT)).toBe("rien");
    expect(posts()).toHaveLength(1);
    // La publication, elle, repose une annonce entière.
    expect((await notifierNouvelEvenement("e-1", MAINTENANT)).discord).toBe(true);
    expect(posts()).toHaveLength(2);
    expect(faux.evenement?.discordMessageId).toBe("msg-3");
  });

  it("barre aussi le message à la suppression de l'annonce, ligne déjà effacée en base", async () => {
    await notifierNouvelEvenement("e-1", MAINTENANT);
    const supprime = { ...(faux.evenement as Record<string, unknown>) } as unknown as Parameters<typeof retirerAnnonceDiscord>[0];
    faux.evenement = null; // la ligne n'existe plus : on ne travaille que sur ce que delete a rendu

    expect(await retirerAnnonceDiscord(supprime, MAINTENANT)).toBe("retire");
    expect(patchs()).toHaveLength(1);
    expect((patchs()[0].corps?.embeds as Array<{ title: string }>)[0].title).toContain("Annulé");
  });

  it("ne marque pas « annulé » un événement déjà passé (le ménage des vieilles annonces en efface)", async () => {
    const vieux = { ...EVENEMENT, dateDebut: "2026-01-10", dateFin: null, heureFin: null, discordMessageId: "msg-1" };
    expect(await retirerAnnonceDiscord(vieux, MAINTENANT)).toBe("rien");
    expect(appels).toHaveLength(0);
  });

  it("ne touche à rien quand l'annonce n'a jamais été postée sur le salon", async () => {
    expect(await retirerAnnonceDiscord({ ...EVENEMENT, discordMessageId: null }, MAINTENANT)).toBe("rien");
    expect(appels).toHaveLength(0);
  });
});

describe("une panne de Discord n'empêche pas d'enregistrer un événement", () => {
  it("laisse partir les emails, ne lève jamais, et libère la clé pour réessayer", async () => {
    faux.membres = [membre("chloe"), membre("charlie")];
    repondre = () => {
      throw new Error("Discord injoignable");
    };

    await expect(notifierNouvelEvenement("e-1", MAINTENANT)).resolves.toEqual({ emails: 2, discord: false, telegram: false });
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["charlie@club.test", "chloe@club.test"]);
    expect(faux.evenement?.discordMessageId).toBeNull();
    const echec = faux.logs.find((l) => l.canal === "DISCORD");
    expect(echec?.statut).toBe("ECHEC");
    expect(String(echec?.dedupKey)).toContain("_echec_");

    // Passage suivant, Discord répondant de nouveau : l'annonce part, sans redoubler les emails.
    repondre = () => ({ status: 200, body: { id: "msg-9" } });
    faux.emails = [];
    expect(await notifierNouvelEvenement("e-1", MAINTENANT)).toEqual({ emails: 0, discord: true, telegram: false });
    expect(faux.evenement?.discordMessageId).toBe("msg-9");
    expect(faux.emails).toEqual([]);
  });

  it("ne lève pas non plus quand la base refuse de rendre l'événement", async () => {
    faux.evenement = null;
    await expect(synchroniserAnnonceDiscord("inconnu", MAINTENANT)).resolves.toBe("rien");
    await expect(notifierNouvelEvenement("inconnu", MAINTENANT)).resolves.toEqual({ emails: 0, discord: false, telegram: false });
  });
});
