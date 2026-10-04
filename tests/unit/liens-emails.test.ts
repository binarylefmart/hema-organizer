import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Les deux liens du pied des emails de rappel, côté serveur :
 *
 * - `/desinscription/<jeton>` — jeton signé, aucune connexion, et rien d'autre que `User.rappelEmail`.
 *   **Ouvrir le lien n'écrit rien** : la page pose la question, le bouton (POST) écrit — sans quoi
 *   une messagerie qui précharge les liens désinscrit des gens qui n'ont rien cliqué. Les deux
 *   bascules sont journalisées avec, comme acteur, la personne du jeton ;
 * - « Je viens » / « Je ne viens plus » (`/seances?seance=…&reponse=…`) — **ouvrir le lien n'écrit
 *   rien non plus,** : la page montrait la même famille de défaut que la désinscription juste
 *   au-dessus, en pire, puisque ce qu'un antivirus de messagerie « ouvrait » était une **réponse de
 *   présence donnée à la place du membre**, et que ce chiffre nourrit les taux du club. La page
 *   montre désormais ce qui sera enregistré, et c'est le bouton (`repondreDepuisLien`, POST) qui
 *   appelle `indiquerPresence` — laquelle revérifie tout : c'est moi, ma période, mon cours, avant
 *   qu'il commence.
 *
 * Le rendu des deux pages est vérifié dans un vrai navigateur ; ici, les cas limites.
 */

const faux = vi.hoisted(() => ({
  membres: [] as Array<{ id: string; prenom: string; email: string | null; rappelEmail: boolean }>,
  seances: [] as Array<Record<string, unknown>>,
  /** Écritures réellement demandées à la base (c'est là que se juge « rien de plus qu'un clic ») */
  ecritures: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  connecte: null as { id: string; role: string; actif: boolean } | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.membres.find((m) => m.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        faux.ecritures.push({ table: "user", id: where.id, data });
        const m = faux.membres.find((x) => x.id === where.id);
        if (!m) throw new Error("introuvable");
        Object.assign(m, data);
        return m;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        faux.ecritures.push({ table: "user", id: where.id, data });
        const m = faux.membres.find((x) => x.id === where.id);
        if (m) Object.assign(m, data);
        return { count: m ? 1 : 0 };
      }),
    },
    session: {
      // Reproduit le filtre du `include` de l'action : la liste des membres ne contient
      // que la personne connectée, c'est ce qui prouve qu'elle est invitée sur la période.
      findUnique: vi.fn(async (args: { where: { id: string }; include?: Record<string, unknown> }) => {
        const s = faux.seances.find((x) => x.id === args.where.id);
        if (!s) return null;
        const moi = (args.include as { period: { include: { membres: { where: { userId: string } } } } } | undefined)?.period.include.membres.where.userId;
        const period = s.period as { statut: string; membres: Array<{ userId: string }> };
        return { ...s, period: { ...period, membres: moi ? period.membres.filter((m) => m.userId === moi) : period.membres } };
      }),
    },
    attendance: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        faux.ecritures.push({ table: "attendance", ...args });
        return args;
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => faux.audits.push(data)) },
  },
}));

vi.mock("@/lib/request-info", () => ({ clientIp: vi.fn(async () => "10.0.0.1") }));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => faux.connecte),
  // `repondreDepuisLien` la demande : la session peut être tombée entre l'écran de confirmation et
  // l'appui, et on repart alors sur la connexion avec la même adresse.
  requireUser: vi.fn(async () => {
    if (!faux.connecte) throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/connexion" });
    return faux.connecte;
  }),
  assertPermission: vi.fn(async () => faux.connecte),
  exigerReauth: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/session", () => ({ touchSession: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(() => {}) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

const { apercuDesinscription, appliquerDesinscription, jetonDesinscription, lireJetonDesinscription, urlDesinscription } = await import("@/lib/notifications/desinscription");
const { confirmerDesinscription, reactiverRappels } = await import("@/app/(public)/desinscription/actions");
const { utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");
const { indiquerPresence } = await import("@/actions/presences");
const { repondreDepuisLien } = await import("@/actions/seances");
const { signPayload } = await import("@/lib/auth/tokens");

const SECRET = process.env.SESSION_SECRET!;
const MOI = "u-moi";
const AUTRE = "u-autre";

beforeEach(() => {
  utiliserMagasinMemoire();
  faux.membres = [
    { id: MOI, prenom: "Chloé", email: "chloe@exemple.fr", rappelEmail: true },
    { id: AUTRE, prenom: "Charlie", email: "charlie@exemple.fr", rappelEmail: true },
  ];
  faux.ecritures = [];
  faux.audits = [];
  faux.connecte = { id: MOI, role: "MEMBRE", actif: true };
  faux.seances = [];
});

/* ------------------------------------------------------------------ */
/* Lien de désinscription                                              */
/* ------------------------------------------------------------------ */

describe("lien de désinscription", () => {
  it("coupe les rappels de la personne du jeton, et d'elle seule", async () => {
    expect(await appliquerDesinscription(jetonDesinscription(MOI))).toEqual({ ok: true, prenom: "Chloé", email: "chloe@exemple.fr", userId: MOI });
    expect(faux.membres).toEqual([
      { id: MOI, prenom: "Chloé", email: "chloe@exemple.fr", rappelEmail: false },
      { id: AUTRE, prenom: "Charlie", email: "charlie@exemple.fr", rappelEmail: true },
    ]);
    // Une seule écriture, un seul champ : le lien ne peut rien faire d'autre
    expect(faux.ecritures).toEqual([{ table: "user", id: MOI, data: { rappelEmail: false } }]);
  });

  it("reste idempotent : deux clics sur le même lien disent la même chose", async () => {
    const jeton = jetonDesinscription(MOI);
    const attendu = { ok: true, prenom: "Chloé", email: "chloe@exemple.fr", userId: MOI };
    expect(await appliquerDesinscription(jeton)).toEqual(attendu);
    expect(await appliquerDesinscription(jeton)).toEqual(attendu);
  });

  it("refuse un jeton trafiqué : charge utile réécrite, signature d'origine", async () => {
    const [, signature] = jetonDesinscription(MOI).split(".");
    const charge = Buffer.from(JSON.stringify({ uid: AUTRE, exp: Date.now() + 1000 })).toString("base64url");
    const trafique = `${charge}.${signature}`;
    expect(lireJetonDesinscription(trafique)).toBeNull();
    expect(await appliquerDesinscription(trafique)).toEqual({ ok: false });
    expect(faux.ecritures).toEqual([]);
  });

  it("refuse une signature rognée, un jeton d'un autre secret et n'importe quoi", async () => {
    const jeton = jetonDesinscription(MOI);
    expect(lireJetonDesinscription(jeton.slice(0, -3))).toBeNull();
    expect(lireJetonDesinscription(signPayload({ uid: MOI, exp: Date.now() + 1000 }, "un-autre-secret-de-32-caracteres!!", "desinscription"))).toBeNull();
    expect(lireJetonDesinscription("n'importe quoi")).toBeNull();
    expect(lireJetonDesinscription("")).toBeNull();
    // Une charge utile sans « exp » ne passe pas non plus
    expect(lireJetonDesinscription(signPayload({ uid: MOI }, SECRET, "desinscription"))).toBeNull();
    expect(faux.ecritures).toEqual([]);
  });

  it("refuse un jeton de plus d'un an, accepte encore celui de la veille de l'échéance", () => {
    const naissance = new Date("2026-01-01T12:00:00Z");
    const jeton = jetonDesinscription(MOI, naissance);
    expect(lireJetonDesinscription(jeton, new Date("2026-12-30T12:00:00Z"))).toBe(MOI);
    expect(lireJetonDesinscription(jeton, new Date("2027-01-02T12:00:00Z"))).toBeNull();
  });

  it("ne distingue pas un compte inconnu d'un jeton invalide, et n'écrit rien", async () => {
    expect(await appliquerDesinscription(jetonDesinscription("u-supprime"))).toEqual({ ok: false });
    expect(faux.ecritures).toEqual([]);
  });

  it("construit une URL absolue sur le chemin public attendu", () => {
    const url = urlDesinscription(MOI);
    expect(url.startsWith("https://organizer.mon-club.fr/desinscription/")).toBe(true);
    expect(lireJetonDesinscription(url.split("/desinscription/")[1])).toBe(MOI);
  });
});

const redirection = async (promesse: Promise<unknown>): Promise<string> => {
  try {
    await promesse;
  } catch (e) {
    return (e as { url: string }).url;
  }
  throw new Error("aucune redirection");
};

/*
 * L'ouverture du lien écrivait : un préchargement de messagerie (Safe Links, antivirus, générateur
 * d'aperçu) désinscrivait quelqu'un qui n'avait rien cliqué, pour un an. La page ne fait plus que
 * lire ; c'est le POST qui écrit.
 */
describe("ouvrir le lien ne désinscrit personne", () => {
  const pageDesinscription = readFileSync(path.join(process.cwd(), "src/app/(public)/desinscription/[token]/page.tsx"), "utf8");

  it("la page (GET) ne lit que l'aperçu : aucun geste d'écriture", () => {
    expect(pageDesinscription).toContain("apercuDesinscription");
    expect(pageDesinscription).not.toContain("appliquerDesinscription(");
    expect(pageDesinscription).not.toContain("annulerDesinscription(");
    // Les deux bascules passent par un formulaire (POST), jamais par le rendu
    expect(pageDesinscription).toContain("confirmerDesinscription.bind(null, token)");
    expect(pageDesinscription).toContain("reactiverRappels.bind(null, token)");
  });

  it("l'aperçu n'écrit rien et ne dit rien d'un jeton invalide", async () => {
    expect(await apercuDesinscription(jetonDesinscription(MOI))).toEqual({ ok: true, prenom: "Chloé", email: "chloe@exemple.fr", userId: MOI });
    expect(await apercuDesinscription(signPayload({ uid: MOI, exp: Date.now() - 1 }, SECRET, "desinscription"))).toEqual({ ok: false });
    expect(await apercuDesinscription(jetonDesinscription("u-supprime"))).toEqual({ ok: false });
    expect(faux.ecritures).toEqual([]);
    expect(faux.membres[0].rappelEmail).toBe(true);
  });
});

describe("bouton « Ne plus recevoir les rappels »", () => {
  it("coupe les rappels et journalise la personne du jeton comme acteur", async () => {
    const jeton = jetonDesinscription(MOI);
    expect(await redirection(confirmerDesinscription(jeton))).toBe(`/desinscription/${jeton}?etat=inactif`);
    expect(faux.membres[0].rappelEmail).toBe(false);
    expect(faux.ecritures).toEqual([{ table: "user", id: MOI, data: { rappelEmail: false } }]);
    expect(faux.audits).toEqual([
      expect.objectContaining({ acteurId: MOI, acteurEmail: "chloe@exemple.fr", action: "rappels.desinscrit", cible: MOI }),
    ]);
  });

  it("n'écrit ni ne journalise rien pour un jeton trafiqué ou périmé", async () => {
    await redirection(confirmerDesinscription(signPayload({ uid: MOI, exp: Date.now() - 1 }, SECRET, "desinscription")));
    await redirection(confirmerDesinscription("charge.signature"));
    expect(faux.ecritures).toEqual([]);
    expect(faux.audits).toEqual([]);
    expect(faux.membres[0].rappelEmail).toBe(true);
  });
});

describe("bouton « Réactiver les rappels »", () => {
  it("remet les rappels de la personne du jeton, et rien d'autre", async () => {
    faux.membres[0].rappelEmail = false;
    const jeton = jetonDesinscription(MOI);
    expect(await redirection(reactiverRappels(jeton))).toBe(`/desinscription/${jeton}?etat=actif`);
    expect(faux.membres[0].rappelEmail).toBe(true);
    expect(faux.ecritures).toEqual([{ table: "user", id: MOI, data: { rappelEmail: true } }]);
    // Cette écriture ne laissait aucune trace au journal
    expect(faux.audits).toEqual([
      expect.objectContaining({ acteurId: MOI, acteurEmail: "chloe@exemple.fr", action: "rappels.reactives", cible: MOI }),
    ]);
  });

  it("n'écrit rien pour un jeton trafiqué ou périmé", async () => {
    faux.membres[0].rappelEmail = false;
    const perime = signPayload({ uid: MOI, exp: Date.now() - 1 }, SECRET, "desinscription");
    await redirection(reactiverRappels(perime));
    await redirection(reactiverRappels("charge.signature"));
    expect(faux.ecritures).toEqual([]);
    expect(faux.audits).toEqual([]);
    expect(faux.membres[0].rappelEmail).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Réponse « Je viens » / « Je ne viens plus » depuis l'email          */
/* ------------------------------------------------------------------ */

/** Séance de la période de MOI, le cours ne commence que dans longtemps. */
function seance(over: Record<string, unknown> = {}, membres: string[] = [MOI]) {
  return {
    id: "s-1",
    date: "2099-09-29",
    heureDebut: "20:00",
    annulee: false,
    period: { statut: "ACTIVE", membres: membres.map((userId) => ({ userId })) },
    ...over,
  };
}

describe("réponse en un clic depuis le récap", () => {
  it("enregistre la réponse du membre connecté sur une séance de sa période", async () => {
    faux.seances = [seance()];
    expect(await indiquerPresence({ sessionId: "s-1", statut: "PRESENT" })).toEqual({ ok: true, statut: "PRESENT" });
    expect(faux.ecritures).toEqual([
      {
        table: "attendance",
        where: { userId_sessionId: { userId: MOI, sessionId: "s-1" } },
        create: { userId: MOI, sessionId: "s-1", statut: "PRESENT" },
        update: { statut: "PRESENT" },
      },
    ]);
  });

  it("écrit toujours pour la personne connectée, jamais pour un identifiant venu de l'URL", async () => {
    faux.seances = [seance({}, [MOI, AUTRE])];
    await indiquerPresence({ sessionId: "s-1", statut: "ABSENT" });
    expect(faux.ecritures[0].create).toEqual({ userId: MOI, sessionId: "s-1", statut: "ABSENT" });
  });

  it("refuse une séance d'une autre période (la personne n'y est pas invitée)", async () => {
    faux.seances = [seance({}, [AUTRE])];
    expect(await indiquerPresence({ sessionId: "s-1", statut: "PRESENT" })).toEqual({ ok: false, erreur: "Cette séance n'est pas disponible." });
    expect(faux.ecritures).toEqual([]);
  });

  it("refuse une période qui n'est plus active, et une séance inconnue", async () => {
    faux.seances = [seance({ period: { statut: "CLOSE", membres: [{ userId: MOI }] } })];
    expect(await indiquerPresence({ sessionId: "s-1", statut: "PRESENT" })).toEqual({ ok: false, erreur: "Cette séance n'est pas disponible." });
    expect(await indiquerPresence({ sessionId: "s-inconnue", statut: "PRESENT" })).toEqual({ ok: false, erreur: "Cette séance n'est pas disponible." });
    expect(faux.ecritures).toEqual([]);
  });

  it("refuse une séance annulée", async () => {
    faux.seances = [seance({ annulee: true })];
    expect(await indiquerPresence({ sessionId: "s-1", statut: "ABSENT" })).toEqual({ ok: false, erreur: "Cette séance est annulée." });
    expect(faux.ecritures).toEqual([]);
  });

  it("refuse une séance déjà commencée", async () => {
    faux.seances = [seance({ date: "2020-01-01", heureDebut: "19:30" })];
    expect(await indiquerPresence({ sessionId: "s-1", statut: "ABSENT" })).toEqual({
      ok: false,
      erreur: "Le cours a déjà commencé : la réponse n'est plus modifiable.",
    });
    expect(faux.ecritures).toEqual([]);
  });

  it("refuse sans session ouverte : le lien de l'email n'ouvre aucun droit", async () => {
    faux.connecte = null;
    faux.seances = [seance()];
    expect(await indiquerPresence({ sessionId: "s-1", statut: "PRESENT" })).toEqual({ ok: false, erreur: "Ta session a expiré. Reconnecte-toi." });
    expect(faux.ecritures).toEqual([]);
  });

  it("refuse un compte désactivé", async () => {
    faux.connecte = { id: MOI, role: "MEMBRE", actif: false };
    faux.seances = [seance()];
    expect(await indiquerPresence({ sessionId: "s-1", statut: "PRESENT" })).toEqual({ ok: false, erreur: "Ta session a expiré. Reconnecte-toi." });
    expect(faux.ecritures).toEqual([]);
  });

  it("refuse un statut inventé ou un identifiant de séance hors gabarit", async () => {
    faux.seances = [seance()];
    expect(await indiquerPresence({ sessionId: "s-1", statut: "PEUT-ETRE-BIEN" })).toEqual({ ok: false, erreur: "Réponse non reconnue." });
    expect(await indiquerPresence({ sessionId: "", statut: "PRESENT" })).toEqual({ ok: false, erreur: "Réponse non reconnue." });
    expect(await indiquerPresence({ sessionId: "x".repeat(65), statut: "PRESENT" })).toEqual({ ok: false, erreur: "Réponse non reconnue." });
    expect(faux.ecritures).toEqual([]);
  });
});

/*
 * Même défaut que la désinscription, même correction — et la conséquence était pire : le lien
 * `/seances?seance=…&reponse=present` écrivait la réponse **pendant le rendu de la page**, donc sur un
 * simple GET. Une messagerie qui précharge les liens (Safe Links, antivirus) répondait à la place du
 * membre, et le club comptait un présent qui n'avait pas lu son email. Le parcours reste à deux taps :
 * le lien de l'email, puis le bouton.
 */
/** Le formulaire de l'écran de confirmation, tel que ses deux champs cachés l'envoient. */
function formulaireReponse(sessionId: string, statut: string): FormData {
  const fd = new FormData();
  fd.set("sessionId", sessionId);
  fd.set("statut", statut);
  return fd;
}

describe("ouvrir le lien de réponse n'enregistre aucune présence", () => {
  const pageSeances = readFileSync(path.join(process.cwd(), "src/app/(app)/seances/page.tsx"), "utf8");

  it("la page (GET) n'appelle plus l'écriture : elle rend un écran de confirmation", () => {
    // Aucune écriture pendant le rendu, et plus aucune importation de l'action qui écrit.
    expect(pageSeances).not.toContain("indiquerPresence(");
    expect(pageSeances).not.toContain('from "@/actions/presences"');
    // Le bouton, lui, est un formulaire (POST) branché sur l'action dédiée.
    expect(pageSeances).toContain("action={repondreDepuisLien}");
    expect(pageSeances).toContain("<FormulaireAction");
    // La séance et la réponse voyagent en champs cachés du formulaire, pas dans l'URL de la page.
    expect(pageSeances).toContain('<input type="hidden" name="sessionId" value={seance.id} />');
    expect(pageSeances).toContain('<input type="hidden" name="statut" value={statut} />');
  });

  it("le bouton enregistre la réponse, puis renvoie sur une URL qui ne rejoue rien", async () => {
    faux.seances = [seance()];
    expect(await redirection(repondreDepuisLien({}, formulaireReponse("s-1", "PRESENT")))).toBe("/seances?note=present&s=s-1");
    expect(faux.ecritures).toEqual([
      {
        table: "attendance",
        where: { userId_sessionId: { userId: MOI, sessionId: "s-1" } },
        create: { userId: MOI, sessionId: "s-1", statut: "PRESENT" },
        update: { statut: "PRESENT" },
      },
    ]);
  });

  it("rend le refus du serveur à l'écran plutôt que de rediriger sur une confirmation fausse", async () => {
    faux.seances = [seance({ annulee: true })];
    expect(await repondreDepuisLien({}, formulaireReponse("s-1", "ABSENT"))).toEqual({ erreur: "Cette séance est annulée." });
    expect(faux.ecritures).toEqual([]);
  });

  it("n'écrit rien pour une séance dont la personne n'est pas invitée, même en appuyant sur le bouton", async () => {
    faux.seances = [seance({}, [AUTRE])];
    expect(await repondreDepuisLien({}, formulaireReponse("s-1", "PRESENT"))).toEqual({ erreur: "Cette séance n'est pas disponible." });
    expect(faux.ecritures).toEqual([]);
  });
});
