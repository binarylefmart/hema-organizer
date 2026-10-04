import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANAUX_PERSONNELS,
  accepteNotification,
  destinataireRetenu,
  lirePreferencesPersonnelles,
  miseAJourPersonnelle,
  preferencesDefaut,
  preferencesPersonnellesDe,
  serialiserPreferencesPersonnelles,
} from "@/lib/notifications/preferences";


/**
 * **Notifications sur le téléphone** — la moitié qui se raisonne sans navigateur :
 *
 * 1. les **préférences personnelles par canal** : « le rappel sur le téléphone, mais plus par
 *    email » doit être un réglage possible, et l'ancien format (un booléen par message) doit
 *    continuer de se lire sans que personne n'ait rien à re-régler ;
 * 2. la **paire de clés VAPID**, engendrée une seule fois puis relue — la regénérer invaliderait
 *    tous les abonnements déjà pris ;
 * 3. le **nom d'appareil** montré dans la liste du profil ;
 * 4. le **titre** de la notification d'essai : il vient de l'identité du club, et **doit** toujours
 *    partir dans la charge utile — le service worker est un fichier statique, il ne peut rien lire
 *    en base et son repli est volontairement neutre.
 */

const faux = vi.hoisted(() => ({
  reglages: new Map<string, string>(),
  /** Les charges utiles réellement remises au service de push. */
  envois: [] as Array<{ titre: string; corps: string; url: string; tag?: string }>,
  /** Table `PushAbonnement` simulée (clé unique : `endpoint`). */
  abonnements: [] as { endpoint: string; userId: string; p256dh: string; auth: string; appareil: string }[],
  /** Personne connectée qui appelle l'action d'abonnement. */
  connecte: { id: "u-delta" } as { id: string } | null,
}));

vi.mock("@/lib/settings", () => ({
  // `identite` comprise : le nom du club est un réglage comme les autres.
  CLES: { vapid: "vapid", notifications: "notifications", identite: "identite" },
  getSetting: vi.fn(async (cle: string) => faux.reglages.get(cle) ?? null),
  setSetting: vi.fn(async (cle: string, valeur: string | null) => {
    if (valeur === null) faux.reglages.delete(cle);
    else faux.reglages.set(cle, valeur);
  }),
  getDiscordWebhookUrl: vi.fn(async () => ({ url: "", source: "aucune" as const })),
}));

type LigneAbonnement = (typeof faux.abonnements)[number];

vi.mock("@/lib/db", () => ({
  db: {
    pushAbonnement: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async ({ where }: { where: { endpoint: string } }) => faux.abonnements.find((a) => a.endpoint === where.endpoint) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { endpoint: string }; create: LigneAbonnement; update: Partial<LigneAbonnement> }) => {
        const ligne = faux.abonnements.find((a) => a.endpoint === where.endpoint);
        if (ligne) return Object.assign(ligne, update);
        const neuve = { ...create };
        faux.abonnements.push(neuve);
        return neuve;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => faux.connecte) }));
vi.mock("@/lib/request-info", () => ({ userAgent: vi.fn(async () => "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1") }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Seul l'envoi est bouchonné (rien ne doit partir chez Firebase ou Apple) : le reste du module —
 * clés VAPID, nom d'appareil — tourne pour de vrai.
 */
vi.mock("@/lib/notifications/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/push")>()),
  notifierPersonne: vi.fn(async (_userId: string, charge: { titre: string; corps: string; url: string; tag?: string }) => {
    faux.envois.push(charge);
    return 1;
  }),
}));

const { clesVapid, clePubliqueVapid, nommerAppareil } = await import("@/lib/notifications/push");
const { enregistrerAbonnementPush, testerPush } = await import("@/actions/push");

beforeEach(() => {
  faux.reglages.clear();
  faux.abonnements = [];
  faux.envois = [];
  faux.connecte = { id: "u-delta" };
});

/* ------------------------------------------------------------------ */
/* Préférences personnelles, canal par canal                           */
/* ------------------------------------------------------------------ */

describe("choix personnels par canal", () => {
  it("lit l'ancien format : un booléen valait pour tout, il vaut donc pour les deux canaux", () => {
    const prefs = lirePreferencesPersonnelles(JSON.stringify({ recap_veille: false, seance_annulee: true }));
    expect(prefs.recap_veille).toEqual({ email: false, push: false });
    expect(prefs.seance_annulee).toEqual({ email: true, push: true });
  });

  it("lit le format par canal, et ignore ce qu'il ne connaît pas", () => {
    const prefs = lirePreferencesPersonnelles(JSON.stringify({ recap_veille: { email: false, push: true, pigeon: true }, inconnu: { email: false } }));
    expect(prefs.recap_veille).toEqual({ email: false, push: true });
    // Un type inconnu ne crée rien ; les autres gardent leur valeur par défaut
    expect(prefs.seance_annulee).toEqual({ email: true, push: true });
  });

  it("ne lève jamais sur un JSON abîmé : on retombe sur les valeurs par défaut", () => {
    for (const brut of ["{", "null", "[]", '"oui"', ""]) {
      expect(lirePreferencesPersonnelles(brut).recap_veille).toEqual({ email: true, push: true });
    }
  });

  it("la case historique des rappels vaut pour les deux canaux", () => {
    // Quelqu'un qui avait coupé ses rappels ne doit pas les retrouver en branchant son téléphone
    const prefs = lirePreferencesPersonnelles(null, false);
    expect(prefs.recap_veille).toEqual({ email: false, push: false });
    expect(prefs.rappel_sans_reponse).toEqual({ email: false, push: false });
    expect(prefs.seance_annulee).toEqual({ email: true, push: true });
  });

  it("écrit une forme canonique : tous les types, tous les canaux personnels", () => {
    const ecrit = JSON.parse(serialiserPreferencesPersonnelles(lirePreferencesPersonnelles(null)));
    for (const valeur of Object.values(ecrit) as Array<Record<string, boolean>>) {
      expect(Object.keys(valeur).sort()).toEqual([...CANAUX_PERSONNELS].sort());
    }
  });

  it("règle un seul canal sans toucher à l'autre", () => {
    const personne = { preferencesNotifications: null, rappelEmail: true, email: "chloe@club.test" };
    const maj = miseAJourPersonnelle(personne, { recap_veille: { email: false } });
    const apres = preferencesPersonnellesDe({ ...personne, ...maj });
    expect(apres.recap_veille).toEqual({ email: false, push: true });
    // La case historique ne parle que d'email : elle suit l'email, pas le téléphone
    expect(maj.rappelEmail).toBe(true); // rappel_sans_reponse est encore accepté par email
  });

  it("un booléen règle les deux canaux d'un coup (la fiche du bureau n'a qu'une case)", () => {
    const personne = { preferencesNotifications: null, rappelEmail: true, email: "chloe@club.test" };
    const maj = miseAJourPersonnelle(personne, { recap_veille: false, rappel_sans_reponse: false });
    const apres = preferencesPersonnellesDe({ ...personne, ...maj });
    expect(apres.recap_veille).toEqual({ email: false, push: false });
    expect(maj.rappelEmail).toBe(false);
  });

  it("refuser le téléphone ne coupe pas l'email, et réciproquement", () => {
    const club = preferencesDefaut();
    const personne = {
      actif: true,
      email: "chloe@club.test",
      rappelEmail: true,
      preferencesNotifications: JSON.stringify({ recap_veille: { email: true, push: false } }),
    };
    expect(accepteNotification(personne, "recap_veille", "email")).toBe(true);
    expect(accepteNotification(personne, "recap_veille", "push")).toBe(false);
    expect(destinataireRetenu(club, "recap_veille", "email", personne)).toBe(true);
    expect(destinataireRetenu(club, "recap_veille", "push", personne)).toBe(false);
  });

  it("sans adresse email, le téléphone reste possible", () => {
    const club = preferencesDefaut();
    const personne = { actif: true, email: null, rappelEmail: true, preferencesNotifications: null };
    expect(destinataireRetenu(club, "recap_veille", "email", personne)).toBe(false);
    expect(destinataireRetenu(club, "recap_veille", "push", personne)).toBe(true);
  });

  it("le club garde le dernier mot : canal coupé, rien ne part, même accepté personnellement", () => {
    const club = preferencesDefaut();
    club.canaux.push = false;
    const personne = { actif: true, email: "chloe@club.test", rappelEmail: true, preferencesNotifications: null };
    expect(destinataireRetenu(club, "recap_veille", "push", personne)).toBe(false);
    expect(destinataireRetenu(club, "recap_veille", "email", personne)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Les clés du serveur                                                 */
/* ------------------------------------------------------------------ */

describe("clés VAPID", () => {
  it("sont engendrées au premier besoin, puis relues à l'identique", async () => {
    const premieres = await clesVapid();
    expect(premieres.publicKey).toBeTruthy();
    expect(premieres.privateKey).toBeTruthy();
    // Deuxième appel : la même paire, sinon tous les abonnements déjà pris seraient invalidés
    expect(await clesVapid()).toEqual(premieres);
    expect(await clePubliqueVapid()).toBe(premieres.publicKey);
  });

  it("ne rangent jamais la clé privée en clair", async () => {
    const cles = await clesVapid();
    const stocke = faux.reglages.get("vapid") ?? "";
    expect(stocke).not.toContain(cles.privateKey);
  });

  it("repartent d'une paire neuve si la valeur en base est abîmée", async () => {
    faux.reglages.set("vapid", "n'importe quoi");
    const cles = await clesVapid();
    expect(cles.publicKey).toBeTruthy();
    expect(await clesVapid()).toEqual(cles);
  });
});

/* ------------------------------------------------------------------ */
/* Le nom de l'appareil                                                */
/* ------------------------------------------------------------------ */

describe("nom d'appareil", () => {
  it("dit le navigateur et le système, pour s'y retrouver dans la liste", () => {
    expect(nommerAppareil("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36")).toBe("Chrome sur Android");
    expect(nommerAppareil("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari sur iPhone");
    expect(nommerAppareil("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0")).toBe("Edge sur Windows");
    expect(nommerAppareil("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Firefox sur Linux");
  });

  it("ne reste jamais sans réponse", () => {
    expect(nommerAppareil("")).toBe("Navigateur");
  });
});

/* ------------------------------------------------------------------ */
/* À qui appartient un abonnement                                      */
/* ------------------------------------------------------------------ */

/**
 * L'`endpoint` est une adresse donnée par le navigateur, pas un secret : elle voyage, elle se
 * recopie, elle se retrouve dans un journal. Tant que l'enregistrement réassignait `userId` à
 * l'appelant, il suffisait de connaître celui de quelqu'un pour s'attribuer sa ligne — et lui
 * couper ses notifications sans qu'il en sache jamais rien.
 */
describe("enregistrement d'un appareil", () => {
  const ABONNEMENT = { endpoint: "https://push.example/abcdef", p256dh: "cle-publique", auth: "secret" };

  it("range l'appareil au nom de la personne connectée", async () => {
    const r = await enregistrerAbonnementPush(ABONNEMENT);
    expect(r.succes).toBeTruthy();
    expect(faux.abonnements).toEqual([{ ...ABONNEMENT, userId: "u-delta", appareil: "Safari sur iPhone" }]);
  });

  it("met à jour les clés de son propre appareil sans empiler de seconde ligne", async () => {
    await enregistrerAbonnementPush(ABONNEMENT);
    const r = await enregistrerAbonnementPush({ ...ABONNEMENT, p256dh: "cle-neuve", auth: "secret-neuf" });
    expect(r.succes).toBeTruthy();
    expect(faux.abonnements).toHaveLength(1);
    expect(faux.abonnements[0]).toMatchObject({ userId: "u-delta", p256dh: "cle-neuve", auth: "secret-neuf" });
  });

  it("refuse de reprendre l'abonnement de quelqu'un d'autre, et ne touche à rien", async () => {
    faux.abonnements = [{ ...ABONNEMENT, userId: "u-echo", appareil: "Chrome sur Android" }];
    const r = await enregistrerAbonnementPush(ABONNEMENT);
    expect(r.erreur).toBeTruthy();
    expect(r.succes).toBeUndefined();
    // La victime garde sa ligne, ses clés et son nom d'appareil : rien n'a bougé
    expect(faux.abonnements).toEqual([{ ...ABONNEMENT, userId: "u-echo", appareil: "Chrome sur Android" }]);
  });

  it("ne dit rien de plus que le refus (pas de nom, pas d'identifiant de l'autre compte)", async () => {
    faux.abonnements = [{ ...ABONNEMENT, userId: "u-echo", appareil: "Chrome sur Android" }];
    const r = await enregistrerAbonnementPush(ABONNEMENT);
    expect(r.erreur).not.toContain("u-echo");
  });

  it("n'enregistre rien sans session", async () => {
    faux.connecte = null;
    const r = await enregistrerAbonnementPush(ABONNEMENT);
    expect(r.erreur).toBeTruthy();
    expect(faux.abonnements).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Le titre de la notification                                         */
/* ------------------------------------------------------------------ */

/**
 * **Le titre part toujours du serveur.** `public/sw.js` est servi tel quel, sans build et sans accès
 * à la base : il ne peut pas connaître le nom du club, et son repli est neutre (« Organizer »). Si le
 * serveur oubliait le titre, tout le monde verrait ce repli — d'où ces deux vérifications.
 */
describe("titre des notifications", () => {
  it("prend le nom court du club tel qu'il est réglé", async () => {
    faux.reglages.set("identite", JSON.stringify({ club: "Cercle d'escrime ancienne", sigle: "CEA" }));
    expect(await testerPush()).toEqual({ succes: "Notification envoyée à 1 appareil." });
    expect(faux.envois.map((e) => e.titre)).toEqual(["CEA Organizer"]);
  });

  it("part sous le nom livré tant que le club ne s'est pas nommé, jamais sous un nom en dur", async () => {
    await testerPush();
    expect(faux.envois[0].titre).toBe("HEMA Organizer");
    // La charge utile porte toujours un titre : le repli du service worker ne doit jamais servir.
    expect(faux.envois.every((e) => Boolean(e.titre))).toBe(true);
  });
});
