import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, exigeSessionForte } from "@/lib/permissions";
import type { PreferencesNotifications } from "@/lib/notifications/preferences";

/**
 * **Régler les notifications de quelqu'un d'autre** (fiche membre → « Notifications de cette
 * personne »).
 *
 * Le besoin est venu du terrain : « je suis spammé sur mon téléphone », dit à l'entraînement et pas
 * devant un écran. Le bureau règle pour la personne — ce qui demande des garde-fous, puisqu'on
 * touche au choix de quelqu'un d'autre :
 *
 * - c'est **réservé au bureau** : un instructeur gère les fiches, pas ce que les gens acceptent ;
 * - le **compte de connexion du portail** n'est pas une personne : rien à régler pour lui ;
 * - la règle « on ne peut que **retrancher** » vaut aussi pour un administrateur : ce que le club a
 *   coupé ne se rallume pas depuis une fiche — et ne s'éteint pas non plus au passage ;
 * - la trace d'audit dit **qui a changé quoi**, avant et après ;
 * - et surtout : **la personne garde le dernier mot**. Le bureau écrit au même endroit que « Mon
 *   profil » (`User.preferencesNotifications` + la case historique `rappelEmail`), si bien que
 *   l'intéressé retrouve le réglage tel quel et le défait lui-même.
 */

type Compte = {
  id: string;
  prenom: string;
  nom: string;
  email: string | null;
  /** Rôle **de base** : `MEMBRE` ou `INSTRUCTEUR`. Le bureau s'ajoute par-dessus (`estAdmin`). */
  role: string;
  estAdmin: boolean;
  actif: boolean;
  service: boolean;
  rappelEmail: boolean;
  preferencesNotifications: string | null;
};

const faux = vi.hoisted(() => ({
  /** Administrateur connecté par simple lien : régler les notifications d'autrui n'exige pas de 2FA */
  // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
  // `notifications.autrui` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que
  // par `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
  acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true, sessionForte: false },
  connecte: null as { id: string; email: string | null; role: string; actif: boolean } | null,
  comptes: [] as Compte[],
  club: null as PreferencesNotifications | null,
  majs: [] as { id: string; data: Record<string, unknown> }[],
  audits: [] as { acteur: unknown; action: string; cible: string | null; details: unknown }[],
  chemins: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        if (typeof where.id === "string") return faux.comptes.find((c) => c.id === where.id) ?? null;
        if (typeof where.email === "string") return faux.comptes.find((c) => c.email === where.email) ?? null;
        return null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const c = faux.comptes.find((u) => u.id === where.id);
        if (!c) throw new Error("Compte introuvable");
        return c;
      }),
      findMany: vi.fn(async () => faux.comptes),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const c = faux.comptes.find((u) => u.id === where.id);
        if (!c) throw new Error("Compte introuvable");
        faux.majs.push({ id: where.id, data });
        Object.assign(c, data);
        return c;
      }),
    },
    period: { findUnique: vi.fn(async () => null), findUniqueOrThrow: vi.fn(async () => ({ statut: "ACTIVE" })) },
    periodMember: { upsert: vi.fn(async () => ({})) },
    invitation: { create: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    authSession: { delete: vi.fn(async () => ({})) },
    setting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (acteur: unknown, action: string, cible?: string | null, details?: unknown) => {
    faux.audits.push({ acteur, action, cible: cible ?? null, details });
  }),
}));

vi.mock("@/lib/auth/session", () => ({ revokeAllSessions: vi.fn(async () => 0) }));
vi.mock("@/lib/email/mailer", () => ({ enqueueEmail: vi.fn(() => {}), sendEmailNow: vi.fn(async () => ({ mode: "fichier" as const, chemin: "x" })) }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: vi.fn(async () => "hash"), verifyPassword: vi.fn(async () => true) }));

/** Le vrai contrôle d'accès (rôle **et** session forte), avec l'acteur du test. */
vi.mock("@/lib/auth/current-user", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    AccesRefuse: class AccesRefuse extends Error {},
    assertPermission: vi.fn(async (permission: Parameters<typeof vrai.can>[1]) => {
      if (!vrai.can(faux.acteur, permission)) throw new Error("Accès refusé");
      if (vrai.exigeSessionForte(permission) && !faux.acteur.sessionForte) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async () => {}),
    getCurrentUser: vi.fn(async () => faux.connecte),
  };
});

// Seul le réglage **du club** est simulé : toutes les fonctions pures restent les vraies, c'est
// justement leur composition qu'on vérifie ici.
vi.mock("@/lib/notifications/preferences", async (importOriginal) => {
  const vrai = await importOriginal<typeof import("@/lib/notifications/preferences")>();
  return { ...vrai, getPreferencesNotifications: vi.fn(async () => faux.club ?? vrai.preferencesDefaut()) };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((chemin: string) => {
    faux.chemins.push(chemin);
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { TYPES_REFUSABLES, preferencesDefaut, preferencesPersonnellesDe, serialiserPreferencesPersonnelles } = await import("@/lib/notifications/preferences");
const { definirNotificationsMembre } = await import("@/actions/membres");
const { definirPreferenceNotification } = await import("@/actions/profil");
const { lignesNotificationsMembre, typesVisiblesPour } = await import("@/lib/notifications/membre");

const CHLOE = "u-chloe";

function compte(options: Partial<Compte> = {}): Compte {
  return {
    id: CHLOE,
    prenom: "Chloé",
    nom: "Marchand",
    email: "chloe@club.test",
    role: "MEMBRE",
    estAdmin: false,
    actif: true,
    service: false,
    rappelEmail: true,
    preferencesNotifications: null,
    ...options,
  };
}

/** Le formulaire de la carte : une case par type refusable, absente quand elle est décochée. */
function cases(coches: Partial<Record<string, boolean>>): FormData {
  const fd = new FormData();
  for (const type of TYPES_REFUSABLES) if (coches[type]) fd.append(type, "on");
  return fd;
}

/**
 * Depuis que les choix personnels se règlent **canal par canal**, « reçoit ce message » veut dire
 * « au moins un de ses canaux personnels lui parvient encore ». C'est exactement la lecture que
 * fait la fiche du bureau, où il n'y a qu'une case par message.
 */
function recoitType(type: string): boolean {
  const c = choixEnregistres()[type as keyof ReturnType<typeof choixEnregistres>];
  return Boolean(c?.email || c?.push);
}

const recoitLigne = (l: { choix: { email: boolean; push: boolean } }) => l.choix.email || l.choix.push;
const envoyeLigne = (l: { club: { email: boolean; push: boolean } }) => l.club.email || l.club.push;

/** Ce qui est réellement enregistré pour la personne, relu comme le font les envois. */
function choixEnregistres(id = CHLOE) {
  const c = faux.comptes.find((u) => u.id === id);
  if (!c) throw new Error("Compte absent du test");
  return preferencesPersonnellesDe(c);
}

beforeEach(() => {
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true, sessionForte: false };
  faux.connecte = null;
  faux.comptes = [compte()];
  faux.club = preferencesDefaut();
  faux.majs = [];
  faux.audits = [];
  faux.chemins = [];
});

/* ------------------------------------------------------------------ */
/* 1. Qui a le droit                                                   */
/* ------------------------------------------------------------------ */

describe("qui peut régler les notifications de quelqu'un d'autre", () => {
  it("le bureau, et lui seul (matrice de permissions)", () => {
    expect(can({ role: "INSTRUCTEUR", estAdmin: true, actif: true }, "notifications.autrui")).toBe(true);
    expect(can({ role: "INSTRUCTEUR", actif: true }, "notifications.autrui")).toBe(false);
    expect(can({ role: "MEMBRE", actif: true }, "notifications.autrui")).toBe(false);
    expect(can({ role: "INSTRUCTEUR", estAdmin: true, actif: false }, "notifications.autrui")).toBe(false);
  });

  it("sans exiger un code de double authentification (ce n'est ni destructeur, ni technique)", () => {
    expect(exigeSessionForte("notifications.autrui")).toBe(false);
    expect(exigeSessionForte("members.delete")).toBe(true);
  });

  it("refuse un instructeur, sans rien écrire", async () => {
    faux.acteur = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true, sessionForte: false };
    await expect(definirNotificationsMembre(CHLOE, {}, cases({}))).rejects.toThrow();
    expect(faux.majs).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("refuse un membre, sans rien écrire", async () => {
    faux.acteur = { id: "u-charlie", email: "charlie@club.test", role: "MEMBRE", estAdmin: false, actif: true, sessionForte: false };
    await expect(definirNotificationsMembre(CHLOE, {}, cases({}))).rejects.toThrow();
    expect(faux.majs).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("laisse passer un administrateur entré par son lien personnel (session non forte)", async () => {
    const res = await definirNotificationsMembre(CHLOE, {}, cases({ recap_veille: true }));
    expect(res.erreur).toBeUndefined();
    expect(res.succes).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* 2. Le compte de connexion du portail                                */
/* ------------------------------------------------------------------ */

describe("compte de connexion du portail", () => {
  it("n'a rien à régler : refusé, rien n'est écrit ni journalisé", async () => {
    // Rôle de base neutre pour le compte du portail : il est du bureau (`estAdmin`), il n'enseigne pas.
    faux.comptes = [compte({ id: "u-portail", prenom: "Portail", nom: "HEMA", role: "MEMBRE", estAdmin: true, service: true })];
    const res = await definirNotificationsMembre("u-portail", {}, cases({}));
    expect(res.erreur).toContain("portail");
    expect(res.succes).toBeUndefined();
    expect(faux.majs).toEqual([]);
    expect(faux.audits).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Ce qui est enregistré                                            */
/* ------------------------------------------------------------------ */

describe("enregistrement", () => {
  it("écrit exactement les cases cochées, type par type", async () => {
    const res = await definirNotificationsMembre(CHLOE, {}, cases({ recap_veille: true, seance_annulee: true, atelier_statut: true }));
    expect(res.succes).toBeTruthy();
    // Une case du bureau règle les deux canaux d'un coup : cet écran-là n'arbitre pas entre
    // l'email et le téléphone à la place de la personne (voir `definirNotificationsMembre`).
    expect(choixEnregistres().recap_veille).toEqual({ email: true, push: true });
    expect(recoitType("seance_annulee")).toBe(true);
    expect(recoitType("atelier_statut")).toBe(true);
    expect(recoitType("rappel_sans_reponse")).toBe(false);
    expect(recoitType("effectif_faible")).toBe(false);
    expect(recoitType("evenement_nouveau")).toBe(false);
  });

  it("tient la case historique « rappel la veille » en miroir : plus aucun rappel ⇒ rappelEmail faux", async () => {
    await definirNotificationsMembre(CHLOE, {}, cases({ seance_annulee: true, evenement_nouveau: true }));
    expect(faux.majs.at(-1)?.data.rappelEmail).toBe(false);
    expect(faux.comptes[0].rappelEmail).toBe(false);
  });

  it("… et la remet à vrai dès qu'un seul des deux rappels est accepté", async () => {
    faux.comptes = [compte({ rappelEmail: false, preferencesNotifications: JSON.stringify({ recap_veille: false, rappel_sans_reponse: false }) })];
    await definirNotificationsMembre(CHLOE, {}, cases({ recap_veille: true }));
    expect(faux.comptes[0].rappelEmail).toBe(true);
    expect(recoitType("rappel_sans_reponse")).toBe(false);
  });

  it("ne touche pas aux autres comptes, et rafraîchit la fiche", async () => {
    faux.comptes.push(compte({ id: "u-charlie", prenom: "Charlie", nom: "Ledoux", email: "charlie@club.test" }));
    await definirNotificationsMembre(CHLOE, {}, cases({}));
    expect(choixEnregistres("u-charlie").recap_veille).toEqual({ email: true, push: true });
    expect(faux.chemins).toContain(`/admin/membres/${CHLOE}`);
  });

  it("ne réécrit rien quand rien n'a changé (et ne salit pas le journal)", async () => {
    const tout = Object.fromEntries(TYPES_REFUSABLES.map((t) => [t, true]));
    const res = await definirNotificationsMembre(CHLOE, {}, cases(tout));
    expect(res.succes).toContain("Rien n'a changé");
    expect(faux.majs).toEqual([]);
    expect(faux.audits).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 4. La trace : qui a changé quoi                                     */
/* ------------------------------------------------------------------ */

describe("journal d'audit", () => {
  it("garde l'acteur, la cible, l'état avant et l'état après", async () => {
    await definirNotificationsMembre(CHLOE, {}, cases({ recap_veille: true, rappel_sans_reponse: true, seance_annulee: true, effectif_faible: true, desistement_tardif: true, atelier_statut: true, periode_suivante: true, periode_non_activee: true }));
    expect(faux.audits).toHaveLength(1);
    const trace = faux.audits[0];
    expect(trace.action).toBe("membre.notifications_reglees");
    expect(trace.cible).toBe(CHLOE);
    expect(trace.acteur).toMatchObject({ id: "u-admin", email: "delta@club.test" });
    const details = trace.details as {
      membre: string;
      avant: Record<string, boolean>;
      apres: Record<string, boolean>;
      changements: { type: string; titre: string; avant: boolean; apres: boolean }[];
      rappelEmail: { avant: boolean; apres: boolean };
    };
    expect(details.membre).toBe("Chloé Marchand");
    // Avant / après : tous les types, pour lire la trace sans connaître l'état du moment
    for (const type of TYPES_REFUSABLES) {
      expect(details.avant[type]).toBe(true);
      expect(details.apres[type]).toBe(type !== "evenement_nouveau");
    }
    // … et la liste de ce qui a bougé, en toutes lettres
    expect(details.changements).toEqual([{ type: "evenement_nouveau", titre: "Nouvel événement", avant: true, apres: false }]);
    expect(details.rappelEmail).toEqual({ avant: true, apres: true });
  });

  it("dit aussi la bascule de la case historique quand elle suit", async () => {
    await definirNotificationsMembre(CHLOE, {}, cases({ seance_annulee: true }));
    const details = faux.audits[0].details as { rappelEmail: { avant: boolean; apres: boolean }; changements: { type: string }[] };
    expect(details.rappelEmail).toEqual({ avant: true, apres: false });
    expect(details.changements.map((c) => c.type)).toEqual(["recap_veille", "rappel_sans_reponse", "effectif_faible", "desistement_tardif", "atelier_statut", "evenement_nouveau", "periode_suivante", "periode_non_activee"]);
  });
});

/* ------------------------------------------------------------------ */
/* 5. On ne peut que retrancher — un admin non plus                    */
/* ------------------------------------------------------------------ */

describe("ce que le club a coupé", () => {
  /**
   * Le bureau a coupé « nouvel événement » pour tout le monde — sur **les deux canaux
   * personnels**. Couper le seul email ne suffirait plus : le message continuerait de partir sur
   * les téléphones, et la ligne resterait donc réglable, ce qui est le comportement voulu.
   */
  function clubSansEvenements() {
    const club = preferencesDefaut();
    club.notifications.evenement_nouveau = { ...club.notifications.evenement_nouveau, email: false, push: false };
    faux.club = club;
  }

  it("ne se rallume pas depuis une fiche, même cochée à la main", async () => {
    clubSansEvenements();
    faux.comptes = [compte({ preferencesNotifications: serialiserPreferencesPersonnelles({ ...preferencesPersonnellesDe(compte()), evenement_nouveau: { email: false, push: false } }) })];
    await definirNotificationsMembre(CHLOE, {}, cases({ recap_veille: true, rappel_sans_reponse: true, seance_annulee: true, effectif_faible: true, desistement_tardif: true, atelier_statut: true, evenement_nouveau: true, periode_suivante: true, periode_non_activee: true }));
    expect(recoitType("evenement_nouveau")).toBe(false);
  });

  it("n'est pas éteint en passant non plus : la ligne est en lecture seule, son choix est conservé", async () => {
    clubSansEvenements();
    // Chloé acceptait ces annonces avant que le bureau ne les coupe : son choix doit survivre
    expect(recoitType("evenement_nouveau")).toBe(true);
    await definirNotificationsMembre(CHLOE, {}, cases({ recap_veille: true, rappel_sans_reponse: true, seance_annulee: true, effectif_faible: true, desistement_tardif: true, atelier_statut: true, periode_suivante: true, periode_non_activee: true }));
    expect(recoitType("evenement_nouveau")).toBe(true);
    expect(faux.audits[0]).toBeUndefined();
  });

  it("apparaît en lecture seule dans la carte (même source que le profil)", async () => {
    clubSansEvenements();
    const { lignes } = await lignesNotificationsMembre({ id: CHLOE });
    const ligne = lignes.find((l) => l.type === "evenement_nouveau");
    expect(ligne && envoyeLigne(ligne)).toBe(false);
    // Chloé est membre : elle ne voit que les lignes qui peuvent lui arriver (`typesVisiblesPour`).
    expect(lignes.filter(envoyeLigne)).toHaveLength(typesVisiblesPour({ role: "MEMBRE", estAdmin: false }).length - 1);
  });
});

/* ------------------------------------------------------------------ */
/* 6. La personne garde le dernier mot                                 */
/* ------------------------------------------------------------------ */

describe("lecture et retour en arrière côté profil", () => {
  it("montre exactement ce que le bureau vient de régler", async () => {
    await definirNotificationsMembre(CHLOE, {}, cases({ seance_annulee: true, atelier_statut: true }));
    const { lignes, obligatoires } = await lignesNotificationsMembre({ id: CHLOE });
    expect(lignes.map((l) => [l.type, recoitLigne(l)])).toEqual([
      ["recap_veille", false],
      ["rappel_sans_reponse", false],
      ["seance_annulee", true],
      ["atelier_statut", true],
      ["evenement_nouveau", false],
    ]);
    // Les messages d'accès et de sécurité restent hors de portée des deux écrans
    expect(obligatoires.length).toBeGreaterThan(0);
    expect(lignes.map((l) => l.titre)).not.toContain("Lien d'accès personnel");
  });

  it("laisse la personne revenir sur le réglage depuis son profil (même stockage, aucun écrasement)", async () => {
    await definirNotificationsMembre(CHLOE, {}, cases({ seance_annulee: true }));
    expect(recoitType("recap_veille")).toBe(false);

    // Chloé rouvre « Mon profil » et reprend son récap : l'écriture du bureau n'a rien verrouillé
    faux.connecte = { id: CHLOE, email: "chloe@club.test", role: "MEMBRE", actif: true };
    const res = await definirPreferenceNotification("recap_veille", "email", true);
    expect(res.succes).toBeTruthy();
    expect(recoitType("recap_veille")).toBe(true);
    // … sans réveiller ce que le bureau avait coupé à côté
    expect(recoitType("evenement_nouveau")).toBe(false);
    expect(recoitType("seance_annulee")).toBe(true);
    expect(faux.comptes[0].rappelEmail).toBe(true);

    // et le bureau relit bien le nouveau choix de Chloé
    const { lignes } = await lignesNotificationsMembre({ id: CHLOE });
    expect(lignes.find((l) => l.type === "recap_veille")).toSatisfy(recoitLigne);
  });
});
