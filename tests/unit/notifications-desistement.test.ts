import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Désistement de dernière minute** (`desistement_tardif`) : un membre retire sa réponse dans les
 * deux heures qui précèdent le cours, l'encadrement de la séance l'apprend tout de suite.
 *
 * Ce qui se juge ici : la fenêtre (bornes et fuseau du club), les transitions retenues et écartées,
 * le seul déclencheur légitime (le membre lui-même, jamais une correction du bureau), les verrous de
 * séance, le choix des destinataires (équipe joignable, préférences, jamais le membre), les canaux
 * (pas de salon), la clé posée avant l'envoi et libérée sur échec — et la réponse du membre, qui ne
 * dépend jamais de l'envoi.
 *
 * La base, la file d'emails, l'état des canaux et le service de push sont simulés ; les préférences
 * du club sont les vraies valeurs par défaut (aucun réglage en base), sauf quand un test en pose.
 */

type LigneLog = { type: string; canal: string; sessionId: string | null; userId: string | null; dedupKey: string; statut: string; erreur: string | null };
type Personne = { id: string; prenom: string; nom: string; email: string | null; actif: boolean; rappelEmail: boolean; preferencesNotifications: string | null; service: boolean };

const faux = vi.hoisted(() => ({
  seance: null as null | {
    id: string;
    date: string;
    heureDebut: string;
    heureFin: string;
    lieu: string;
    annulee: boolean;
    periodId: string;
    instructeurs: string[];
    period: { statut: string; membres: string[]; instructeurs: string[] };
  },
  personnes: new Map<string, Record<string, unknown>>(),
  /** Les comptes de rôle INSTRUCTEUR du club, hors équipe de la séance (vide par défaut) */
  instructeursClub: [] as string[],
  reponses: new Map<string, string>(),
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; sujet: string; ref?: string; contenu: { paragraphes: string[] } }>,
  push: [] as Array<{ userId: string; titre: string; corps: string; url: string }>,
  echecEmail: null as Error | null,
  canaux: { email: true, push: true, discord: true, telegram: true } as Record<string, boolean>,
  reglages: null as string | null,
  /** `desistement.delaiMinutes` et `desistement.derniereMinuteMinutes`, en minutes (null : défaut). */
  delais: { delai: null as string | null, derniereMinute: null as string | null, actif: null as string | null, derniereMinuteActif: null as string | null },
  /** Toute lecture de séance lève : simule une base qui hoquette juste après l'écriture */
  basePanne: false,
  connecte: null as null | { id: string; role: string; estAdmin?: boolean; actif: boolean; sessionId?: string },
  audits: [] as unknown[][],
}));

function utilisateur(id: string): Record<string, unknown> {
  const p = faux.personnes.get(id);
  if (!p) throw new Error(`personne inconnue ${id}`);
  return p;
}

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const parCle: Record<string, string | null> = {
          "desistement.delaiMinutes": faux.delais.delai,
          "desistement.derniereMinuteMinutes": faux.delais.derniereMinute,
          "desistement.actif": faux.delais.actif,
          "desistement.derniereMinuteActif": faux.delais.derniereMinuteActif,
        };
        const v = where.key in parCle ? parCle[where.key] : faux.reglages;
        return v ? { value: v } : null;
      }),
    },
    session: {
      findUnique: vi.fn(async (args: { where: { id: string }; include?: { period?: { include?: { membres?: { where?: { userId?: string } } } } } }) => {
        if (faux.basePanne) throw new Error("base indisponible");
        const s = faux.seance;
        if (!s || s.id !== args.where.id) return null;
        const filtre = args.include?.period?.include?.membres?.where?.userId;
        const membres = s.period.membres.filter((id) => !filtre || id === filtre).map((userId) => ({ userId }));
        return {
          ...s,
          attendances: [...faux.reponses].map(([userId, statut]) => ({ userId, statut })),
          instructeurs: s.instructeurs.map((id) => ({ user: utilisateur(id) })),
          period: { ...s.period, membres, instructeurs: s.period.instructeurs.map((id) => ({ user: utilisateur(id) })) },
        };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.personnes.get(where.id) ?? null),
      // Le tri « accès actif » (`idsAvecAccesActif`) : tout le monde en a un ici.
      // Deux lectures : les instructeurs du club (`role: "INSTRUCTEUR"`), et le tri « accès actif »
      // (`idsAvecAccesActif`) — tout le monde en a un ici.
      findMany: vi.fn(async (args: { where: { role?: string; AND?: [{ id: { in: string[] } }, unknown] } }) =>
        args.where.role === "INSTRUCTEUR" ? faux.instructeursClub.map(utilisateur) : args.where.AND![0].id.in.map((id) => ({ id })),
      ),
    },
    attendance: {
      findUnique: vi.fn(async ({ where }: { where: { userId_sessionId: { userId: string } } }) => {
        const statut = faux.reponses.get(where.userId_sessionId.userId);
        return statut ? { statut } : null;
      }),
      upsert: vi.fn(async ({ where, update }: { where: { userId_sessionId: { userId: string } }; update: { statut: string } }) => {
        faux.reponses.set(where.userId_sessionId.userId, update.statut);
        return {};
      }),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        faux.reponses.delete(where.userId);
        return { count: 1 };
      }),
    },
    periodMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => (faux.seance?.period.membres.includes(where.userId) ? { userId: where.userId } : null)),
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

/** La vraie file rappelle son appelant quand l'envoi a échoué : le faux fait pareil, à la demande. */
vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; sujet: string; ref?: string; contenu: { paragraphes: string[] } }, onDone?: (err: Error | null) => void) => {
    // Ce qui compte : la clé doit déjà être posée quand le message entre dans la file.
    if (!faux.logs.some((l) => l.dedupKey === mail.ref && l.statut === "ENVOYE")) throw new Error(`email mis en file avant sa clé : ${mail.ref}`);
    faux.emails.push(mail);
    onDone?.(faux.echecEmail);
  }),
}));

vi.mock("@/lib/notifications/canaux", () => ({
  envoiPossible: vi.fn(async (_type: string, canal: string) => faux.canaux[canal] === true),
}));

vi.mock("@/lib/notifications/push", () => ({
  notifierPersonnes: vi.fn(async (ids: string[], charge: (id: string) => { titre: string; corps: string; url: string }) => {
    for (const id of ids) faux.push.push({ userId: id, ...charge(id) });
    return new Map(ids.map((id) => [id, { appareils: 1, atteints: 1 }]));
  }),
}));

vi.mock("@/lib/auth/current-user", () => ({
  AccesRefuse: class AccesRefuse extends Error {},
  getCurrentUser: vi.fn(async () => faux.connecte),
  assertPermission: vi.fn(async () => faux.connecte),
}));
vi.mock("@/lib/auth/session", () => ({ touchSession: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/elevation", () => ({ toucherElevation: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (...args: unknown[]) => faux.audits.push(args)) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(() => {}) }));

const { cleDesistement, dansFenetreDesistementTardif, desistementRecouvert, estDesistement, fenetreDesistement, signalerDesistementTardif } = await import("@/lib/notifications/desistement");
const { CANAUX_PAR_NOTIFICATION, COUPLES_EMIS, DESCRIPTIONS, RAISON_API_EXCLUE, RAISON_ROUTAGE_FIXE, TYPES_NOTIFICATION, estRoutable, preferencesDefaut, serialiserPreferences } = await import(
  "@/lib/notifications/preferences"
);
const { DELAI_DESISTEMENT_TARDIF_MIN } = await import("@/lib/constants");
const { contenuDesistementTardif } = await import("@/lib/notifications/contenu");
const { indiquerPresence, modifierPresenceMembre, modifierPresencesEnMasse } = await import("@/actions/presences");

/** Jeudi 8 octobre 2026, 20h00 à Paris (heure d'été, UTC+2) : le début est à 18:00 UTC. */
const DEBUT = new Date("2026-10-08T18:00:00Z");
const minutesAvant = (m: number) => new Date(DEBUT.getTime() - m * 60_000);
/**
 * 18h30 à Paris : une heure et demie avant le cours — dans le délai du désistement (2 h), hors de la
 * fenêtre de dernière minute que les tests règlent à 1 h (`faux.delais`).
 */
const PEU_AVANT = minutesAvant(90);
/** 19h30 : une demi-heure avant, dans la fenêtre de dernière minute. */
const TRES_PEU_AVANT = minutesAvant(30);

function personne(id: string, prenom: string, nom: string, extra: Partial<Personne> = {}): Personne {
  return { id, prenom, nom, email: `${id}@club.fr`, actif: true, rappelEmail: true, preferencesNotifications: null, service: false, ...extra };
}

beforeEach(() => {
  faux.personnes = new Map(
    [personne("charlie", "Charlie", "Lefèvre"), personne("chloe", "Chloé", "Delta"), personne("alix", "Alix", "Durand"), personne("m1", "Echo", "Petit"), personne("m2", "Golf", "Roux")].map((p) => [p.id, p]),
  );
  faux.seance = {
    id: "s1",
    date: "2026-10-08",
    heureDebut: "20:00",
    heureFin: "22:00",
    lieu: "Gymnase municipal",
    annulee: false,
    periodId: "p1",
    instructeurs: ["charlie", "alix"],
    period: { statut: "ACTIVE", membres: ["chloe", "m1", "m2", "alix"], instructeurs: [] },
  };
  faux.reponses = new Map([
    ["chloe", "PRESENT"],
    ["m1", "PRESENT"],
    ["m2", "PEUT_ETRE"],
  ]);
  faux.logs = [];
  faux.emails = [];
  faux.push = [];
  faux.echecEmail = null;
  faux.canaux = { email: true, push: true, discord: true, telegram: true };
  faux.reglages = null;
  faux.delais = { delai: "120", derniereMinute: "60", actif: null, derniereMinuteActif: null };
  faux.instructeursClub = [];
  faux.basePanne = false;
  faux.connecte = { id: "chloe", role: "MEMBRE", actif: true, sessionId: "sess" };
  faux.audits = [];
  globalThis.__fuseauClub = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.__fuseauClub = undefined;
});

/** Le membre vient de changer sa réponse en base (c'est l'état que voit le module après l'écriture). */
async function desister(userId: string, avant: string | null, apres: string, now = PEU_AVANT): Promise<number> {
  faux.reponses.set(userId, apres);
  return signalerDesistementTardif({ sessionId: "s1", userId, avant, apres, now });
}

/* ------------------------------------------------------------------ */

describe("registre : le patron de l'alerte « peu de monde », sans les salons", () => {
  it("est déclaré partout où le registre l'attend", () => {
    expect(TYPES_NOTIFICATION).toContain("desistement_tardif");
    expect(DESCRIPTIONS.desistement_tardif.titre).toBe("Désistement avant un cours");
    expect(DESCRIPTIONS.desistement_tardif.quand).toContain("2 jours");
    expect(DESCRIPTIONS.desistement_derniere_minute.quand).toContain("4 heures");
    // Personnel : il nomme quelqu'un. Ni salon, ni site du club, ni liste.
    expect(CANAUX_PAR_NOTIFICATION.desistement_tardif).toEqual(["email", "push"]);
    expect(COUPLES_EMIS.desistement_tardif).toEqual(["email", "push"]);
    expect(RAISON_API_EXCLUE.desistement_tardif).toBeTruthy();
    expect(estRoutable("desistement_tardif")).toBe(false);
    expect(RAISON_ROUTAGE_FIXE.desistement_tardif).toBeTruthy();
    expect(preferencesDefaut().notifications.desistement_tardif).toEqual({ email: true, push: true });
  });

  it("a sa constante, et le délai vaut deux jours", () => {
    expect(DELAI_DESISTEMENT_TARDIF_MIN).toBe(2880);
  });

  it("met en forme une seule fois : nom, nouvelle réponse, heure, lieu, effectif", () => {
    const c = contenuDesistementTardif({
      membre: "Chloé Delta",
      statut: "ABSENT",
      seance: { id: "s1", date: "2026-10-08", heureDebut: "20:00", lieu: "Gymnase municipal" },
      chiffres: { presents: 1, invites: 4 },
      aujourdHui: "2026-10-08",
    });
    expect(c.ligne).toBe("⚠️ Désistement — Chloé Delta ne vient plus (Absent) au cours de ce soir 20h00 — Gymnase municipal");
    expect(c.chiffres).toBe("✅ 1 présent / 4 — 25 %");
    expect(c.chemin).toBe("/seances/s1");
  });
  it("un cours dans plusieurs jours (délai réglé en jours) : la date en toutes lettres, pas « dernière minute »", () => {
    const c = contenuDesistementTardif({
      membre: "Chloé Delta",
      statut: "PEUT_ETRE",
      seance: { id: "s1", date: "2026-10-15", heureDebut: "20:00", lieu: "Gymnase municipal" },
      chiffres: { presents: 1, invites: 4 },
      aujourdHui: "2026-10-08",
    });
    expect(c.titre).toBe("⚠️ Désistement");
    expect(c.phrase).toMatch(/^Chloé Delta ne vient plus \(Peut-être\) au cours du \S+ 15 octobre/);
    expect(c.ligne).not.toContain("dernière minute");
  });
});

describe("transitions", () => {
  it.each([
    ["PRESENT", "ABSENT", "ABSENT"],
    ["PRESENT", "PEUT_ETRE", "PEUT_ETRE"],
    ["PEUT_ETRE", "ABSENT", "ABSENT"],
  ])("retient %s → %s", (avant, apres, vise) => {
    expect(estDesistement(avant, apres)).toBe(vise);
  });

  it.each([
    [null, "ABSENT"],
    [null, "PEUT_ETRE"],
    [null, "PRESENT"],
    ["ABSENT", "PRESENT"],
    ["PEUT_ETRE", "PRESENT"],
    ["ABSENT", "PEUT_ETRE"],
    ["PRESENT", "PRESENT"],
    ["ABSENT", "ABSENT"],
  ])("écarte %s → %s", async (avant, apres) => {
    expect(estDesistement(avant, apres)).toBeNull();
    expect(await desister("chloe", avant, apres)).toBe(0);
    expect(faux.emails).toHaveLength(0);
    expect(faux.push).toHaveLength(0);
    expect(faux.logs).toHaveLength(0);
  });
});

describe("la fenêtre des deux heures, dans le fuseau du club", () => {
  it("part pile à la borne, pas une milliseconde avant", () => {
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", minutesAvant(120), 120)).toBe(true);
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", new Date(minutesAvant(120).getTime() - 1), 120)).toBe(false);
  });

  it("ne part plus une fois le cours commencé", () => {
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", DEBUT)).toBe(false);
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", minutesAvant(-10))).toBe(false);
  });

  it("lit l'heure du cours dans le fuseau du club, pas dans un fuseau écrit en dur", () => {
    // 20h00 à Montréal (UTC-4 en octobre) = 00:00 UTC le lendemain : 18:30 UTC n'y est pas dans la fenêtre.
    globalThis.__fuseauClub = "America/Montreal";
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", PEU_AVANT, 120)).toBe(false);
    expect(dansFenetreDesistementTardif("2026-10-08", "20:00", new Date("2026-10-08T23:30:00Z"), 120)).toBe(true);
  });

  it("juste avant la borne : rien ne part ; juste après : l'alerte part", async () => {
    expect(await desister("chloe", "PRESENT", "ABSENT", new Date(minutesAvant(120).getTime() - 1))).toBe(0);
    expect(faux.emails).toHaveLength(0);
    expect(await desister("chloe", "PRESENT", "ABSENT", minutesAvant(119))).toBeGreaterThan(0);
    expect(faux.emails.length).toBeGreaterThan(0);
  });

  it("après le début du cours : rien", async () => {
    expect(await desister("chloe", "PRESENT", "ABSENT", minutesAvant(-1))).toBe(0);
    expect(faux.logs).toHaveLength(0);
  });
});

describe("verrous de séance", () => {
  it("ignore une séance annulée", async () => {
    faux.seance!.annulee = true;
    expect(await desister("chloe", "PRESENT", "ABSENT")).toBe(0);
    expect(faux.emails).toHaveLength(0);
  });

  it("ignore une période close", async () => {
    faux.seance!.period.statut = "CLOSE";
    expect(await desister("chloe", "PRESENT", "ABSENT")).toBe(0);
    expect(faux.emails).toHaveLength(0);
  });
});

describe("destinataires et canaux", () => {
  it("prévient chaque instructeur de la séance, un email chacun, avec le nom et l'effectif à jour", async () => {
    await desister("chloe", "PRESENT", "ABSENT");
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["alix@club.fr", "charlie@club.fr"]);
    const email = faux.emails[0];
    expect(email.sujet).toBe("⚠️ Désistement — Chloé Delta ne vient plus (Absent) au cours de ce soir 20h00 — Gymnase municipal");
    // Chloé est passée Absent : il reste m1 Présent, sur quatre invités.
    expect(email.contenu.paragraphes.join("\n")).toContain("✅ 1 présent / 4 — 25 %");
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["alix", "charlie"]);
    expect(faux.push[0]).toMatchObject({ titre: "Désistement", url: "/seances/s1" });
  });

  it("retombe sur l'équipe de la période quand la séance n'a pas d'instructeur", async () => {
    faux.seance!.instructeurs = [];
    faux.seance!.period.instructeurs = ["charlie"];
    await desister("chloe", "PRESENT", "PEUT_ETRE");
    expect(faux.emails.map((e) => e.to)).toEqual(["charlie@club.fr"]);
    expect(faux.emails[0].sujet).toContain("(Peut-être)");
  });

  it("prévient tous les instructeurs du club, pas seulement ceux de la séance, sans doublon", async () => {
    faux.personnes.set("dana", personne("dana", "Dana", "Roche"));
    faux.instructeursClub = ["dana", "charlie"];
    await desister("chloe", "PRESENT", "ABSENT");
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["alix@club.fr", "charlie@club.fr", "dana@club.fr"]);
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["alix", "charlie", "dana"]);
  });

  it("ne prévient pas un instructeur qui a lui-même répondu Absent ou Peut-être à la séance", async () => {
    faux.personnes.set("dana", personne("dana", "Dana", "Roche"));
    faux.instructeursClub = ["dana"];
    faux.reponses.set("alix", "ABSENT");
    faux.reponses.set("dana", "PEUT_ETRE");
    await desister("chloe", "PRESENT", "ABSENT");
    expect(faux.emails.map((e) => e.to)).toEqual(["charlie@club.fr"]);
    expect(faux.push.map((p) => p.userId)).toEqual(["charlie"]);
  });

  it("ne prévient jamais le membre lui-même, s'il encadre la séance", async () => {
    faux.reponses.set("alix", "PRESENT");
    await desister("alix", "PRESENT", "ABSENT");
    expect(faux.emails.map((e) => e.to)).toEqual(["charlie@club.fr"]);
    expect(faux.push.map((p) => p.userId)).toEqual(["charlie"]);
  });

  it("respecte les préférences de chacun, canal par canal", async () => {
    faux.personnes.get("charlie")!.preferencesNotifications = JSON.stringify({ desistement_tardif: { email: false, push: true } });
    faux.personnes.get("alix")!.preferencesNotifications = JSON.stringify({ desistement_tardif: false });
    await desister("chloe", "PRESENT", "ABSENT");
    expect(faux.emails).toHaveLength(0);
    expect(faux.push.map((p) => p.userId)).toEqual(["charlie"]);
  });

  it("respecte la matrice du club", async () => {
    const prefs = preferencesDefaut();
    prefs.notifications.desistement_tardif = { email: false, push: true };
    faux.reglages = serialiserPreferences(prefs);
    faux.canaux.email = false; // ce que `envoiPossible` répondrait avec ce réglage
    await desister("chloe", "PRESENT", "ABSENT");
    expect(faux.emails).toHaveLength(0);
    expect(faux.push).toHaveLength(2);
  });

  it("n'écrit jamais sur un salon : le module ne connaît ni Discord ni Telegram", () => {
    const code = readFileSync(path.join(process.cwd(), "src/lib/notifications/desistement.ts"), "utf8");
    expect(code).not.toMatch(/publierSurSalon|publierSurTelegram|"discord"|"telegram"/);
  });
});

describe("clé de déduplication", () => {
  it("porte type, canal, destinataire, membre, séance, créneau et statut visé", () => {
    expect(cleDesistement({ canal: "email", destinataireId: "charlie", membreId: "chloe", seance: { id: "s1", date: "2026-10-08", heureDebut: "20:00" }, statut: "ABSENT" })).toBe(
      "desistement_email_s1_2026-10-08-2000_chloe_ABSENT_charlie",
    );
  });

  it("est posée avant l'envoi, une ligne par destinataire et par canal", async () => {
    await desister("chloe", "PRESENT", "ABSENT");
    const cles = faux.logs.map((l) => l.dedupKey).sort();
    expect(cles).toEqual([
      "desistement_email_s1_2026-10-08-2000_chloe_ABSENT_alix",
      "desistement_email_s1_2026-10-08-2000_chloe_ABSENT_charlie",
      "desistement_push_s1_2026-10-08-2000_chloe_ABSENT_alix",
      "desistement_push_s1_2026-10-08-2000_chloe_ABSENT_charlie",
    ]);
    expect(faux.logs.every((l) => l.type === "DESISTEMENT" && l.statut === "ENVOYE")).toBe(true);
    // (Le faux `enqueueEmail` lève si la clé n'est pas déjà en base au moment de la mise en file.)
  });

  it("au plus une alerte par membre, séance et statut : Présent → Absent → Présent → Absent n'en fait qu'une", async () => {
    await desister("chloe", "PRESENT", "ABSENT");
    await desister("chloe", "ABSENT", "PRESENT");
    await desister("chloe", "PRESENT", "ABSENT");
    expect(faux.emails).toHaveLength(2);
    expect(faux.push).toHaveLength(2);
  });

  it("Présent → Peut-être puis Peut-être → Absent : deux nouvelles distinctes", async () => {
    await desister("chloe", "PRESENT", "PEUT_ETRE");
    await desister("chloe", "PEUT_ETRE", "ABSENT");
    expect(faux.emails).toHaveLength(4);
  });

  it("est libérée quand l'envoi échoue, et l'alerte peut repartir", async () => {
    faux.echecEmail = new Error("SMTP indisponible");
    await desister("chloe", "PRESENT", "ABSENT");
    const emailsLibres = faux.logs.filter((l) => String(l.dedupKey).startsWith("desistement_email_"));
    expect(emailsLibres.every((l) => l.statut === "ECHEC" && String(l.dedupKey).includes("_echec_"))).toBe(true);
    faux.echecEmail = null;
    await desister("chloe", "ABSENT", "PRESENT");
    await desister("chloe", "PRESENT", "ABSENT");
    expect(faux.emails).toHaveLength(4);
  });
});

describe("le déclencheur : le membre lui-même, et sa réponse avant tout", () => {
  it("indiquerPresence fait partir l'alerte quand le membre se désiste dans la fenêtre", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PEU_AVANT);
    expect(await indiquerPresence({ sessionId: "s1", statut: "ABSENT" })).toEqual({ ok: true, statut: "ABSENT" });
    expect(faux.reponses.get("chloe")).toBe("ABSENT");
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["alix@club.fr", "charlie@club.fr"]);
  });

  it("ne fait rien partir pour une réponse donnée la veille", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(minutesAvant(24 * 60));
    expect(await indiquerPresence({ sessionId: "s1", statut: "ABSENT" })).toEqual({ ok: true, statut: "ABSENT" });
    expect(faux.emails).toHaveLength(0);
  });

  it("la réponse du membre n'est jamais bloquée par un échec d'envoi", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PEU_AVANT);
    const { enqueueEmail } = await import("@/lib/email/mailer");
    vi.mocked(enqueueEmail).mockImplementationOnce(() => {
      throw new Error("file d'envoi arrêtée");
    });
    expect(await indiquerPresence({ sessionId: "s1", statut: "ABSENT" })).toEqual({ ok: true, statut: "ABSENT" });
    expect(faux.reponses.get("chloe")).toBe("ABSENT");
  });

  it("ne lève jamais, même si la base tombe après l'écriture", async () => {
    faux.basePanne = true;
    await expect(signalerDesistementTardif({ sessionId: "s1", userId: "chloe", avant: "PRESENT", apres: "ABSENT", now: PEU_AVANT })).resolves.toBe(0);
  });

  it("une correction du bureau, unitaire ou en masse, n'annonce rien", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PEU_AVANT);
    faux.connecte = { id: "charlie", role: "INSTRUCTEUR", estAdmin: true, actif: true, sessionId: "sess" };
    expect((await modifierPresenceMembre({ sessionId: "s1", userId: "chloe", statut: "ABSENT" })).ok).toBe(true);
    expect(faux.reponses.get("chloe")).toBe("ABSENT");
    expect(faux.emails).toHaveLength(0);
    expect(faux.push).toHaveLength(0);
    expect(faux.logs).toHaveLength(0);
    // Les corrections du bureau ne passent pas par ce module, et la source le dit : deux appels, tous
    // deux dans les actions du membre qui répond pour lui-même — sa réponse à une séance
    // (`indiquerPresence`) et sa réponse à toute une période (`repondrePourLaPeriode`).
    expect(typeof modifierPresencesEnMasse).toBe("function");
    const source = readFileSync(path.join(process.cwd(), "src/actions/presences.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const appels = [...source.matchAll(/signalerDesistementTardif\(/g)].map((m) => m.index ?? -1);
    expect(appels).toHaveLength(2);
    const [unitaire, periode] = appels;
    expect(unitaire).toBeGreaterThan(source.indexOf("export async function indiquerPresence("));
    expect(periode).toBeGreaterThan(source.indexOf("export async function repondrePourLaPeriode("));
    for (const appel of appels) expect(appel).toBeLessThan(source.indexOf("export async function modifierPresenceMembre("));
    // Et après l'écriture de la réponse.
    expect(unitaire).toBeGreaterThan(source.indexOf("db.attendance.upsert("));
    expect(periode).toBeGreaterThan(source.indexOf("db.attendance.upsert(", source.indexOf("export async function repondrePourLaPeriode(")));
  });
});

describe("invariant du dossier, relu dans la source", () => {
  const code = readFileSync(path.join(process.cwd(), "src/lib/notifications/desistement.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("pose la clé avant l'email, libère sur échec, et passe le téléphone par notifierParPush", () => {
    expect(code.indexOf("journaliser({")).toBeGreaterThan(-1);
    expect(code.indexOf("enqueueEmail(")).toBeGreaterThan(code.indexOf("journaliser({"));
    expect(code).toMatch(/marquerEchec\(dedupKey/);
    expect(code).toMatch(/notifierParPush\(\{/);
    expect(code).toMatch(/destinataireRetenu\(prefs, type, "email"/);
    expect(code).toMatch(/destinataireRetenu\(prefs, type, "push"/);
    expect(code).toMatch(/envoiPossible\(type, "email"\)/);
    expect(code).toMatch(/pushPossible\(type\)/);
  });
});

/* ------------------------------------------------------------------ */

describe("désistement de dernière minute : la seconde fenêtre prend le pas", () => {
  const delais = { delaiMin: 120, derniereMinuteMin: 60 };

  it("dernière minute d'abord, puis désistement, sinon rien", () => {
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(30), delais)).toBe("derniere_minute");
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(60), delais)).toBe("derniere_minute");
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(61), delais)).toBe("desistement");
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(121), delais)).toBeNull();
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(-1), delais)).toBeNull();
  });

  it("les deux fenêtres sont indépendantes : une dernière minute plus longue que le désistement l'emporte quand même", () => {
    const inverses = { delaiMin: 120, derniereMinuteMin: 240 };
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(180), inverses)).toBe("derniere_minute");
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(241), inverses)).toBeNull();
  });

  it("les défauts du produit : désistement 2 jours, dernière minute 4 heures", () => {
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(240))).toBe("derniere_minute");
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(241))).toBe("desistement");
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(2880))).toBe("desistement");
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(2881))).toBeNull();
  });

  it("dans la fenêtre : titre, objet, téléphone, clés et journal propres à la dernière minute", async () => {
    await desister("chloe", "PRESENT", "ABSENT", TRES_PEU_AVANT);
    expect(faux.emails[0].sujet).toBe("🚨 Désistement de dernière minute — Chloé Delta ne vient plus (Absent) au cours de ce soir 20h00 — Gymnase municipal");
    expect(faux.push[0]).toMatchObject({ titre: "Désistement de dernière minute" });
    expect(faux.logs.every((l) => l.type === "DESISTEMENT_DERNIERE_MINUTE")).toBe(true);
    expect(faux.logs.map((l) => l.dedupKey).sort()[0]).toBe("desistement_dm_email_s1_2026-10-08-2000_chloe_ABSENT_alix");
  });

  it("hors de la fenêtre courte : le désistement classique, sans « dernière minute »", async () => {
    await desister("chloe", "PRESENT", "ABSENT", PEU_AVANT);
    expect(faux.emails[0].sujet.startsWith("⚠️ Désistement — ")).toBe(true);
    expect(faux.logs.every((l) => l.type === "DESISTEMENT")).toBe(true);
  });

  it("un désistement classique, puis un retour, puis un retrait de dernière minute : deux nouvelles", async () => {
    await desister("chloe", "PRESENT", "ABSENT", PEU_AVANT);
    await desister("chloe", "ABSENT", "PRESENT", minutesAvant(45));
    await desister("chloe", "PRESENT", "ABSENT", TRES_PEU_AVANT);
    expect(faux.emails.map((e) => e.sujet.slice(0, 6))).toEqual(["⚠️ Dés", "⚠️ Dés", "🚨 Dés", "🚨 Dés"]);
  });

  it("se coupe séparément : couper la dernière minute ne coupe pas le désistement, et inversement", async () => {
    faux.personnes.get("charlie")!.preferencesNotifications = JSON.stringify({ desistement_derniere_minute: { email: false, push: false } });
    await desister("chloe", "PRESENT", "ABSENT", TRES_PEU_AVANT);
    expect(faux.emails.map((e) => e.to)).toEqual(["alix@club.fr"]);
    faux.emails = [];
    faux.reponses.set("m1", "PRESENT");
    await desister("m1", "PRESENT", "ABSENT", PEU_AVANT);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["alix@club.fr", "charlie@club.fr"]);
  });

  it("le réglage du club décide de la fenêtre", async () => {
    faux.delais = { ...faux.delais, delai: "120", derniereMinute: "120" };
    await desister("chloe", "PRESENT", "ABSENT", PEU_AVANT);
    expect(faux.logs.every((l) => l.type === "DESISTEMENT_DERNIERE_MINUTE")).toBe(true);
  });
});

describe("journal d'audit des alertes", () => {
  it("une ligne par alerte envoyée : le membre en acteur, le nombre d'emails et de téléphones", async () => {
    await desister("chloe", "PRESENT", "ABSENT", TRES_PEU_AVANT);
    const ligne = faux.audits.find((a) => a[1] === "notification.desistement_derniere_minute");
    expect(ligne).toBeDefined();
    expect((ligne![0] as { id: string }).id).toBe("chloe");
    expect(ligne![3]).toMatchObject({ sessionId: "s1", nouvelleReponse: "ABSENT", emails: 2, telephones: 2, delaiMin: 60 });
  });

  it("le désistement classique a la sienne", async () => {
    await desister("chloe", "PRESENT", "ABSENT", PEU_AVANT);
    expect(faux.audits.some((a) => a[1] === "notification.desistement")).toBe(true);
    expect(faux.audits.some((a) => a[1] === "notification.desistement_derniere_minute")).toBe(false);
  });

  it("un email non remis est noté, destinataire en cible", async () => {
    faux.echecEmail = new Error("SMTP indisponible");
    await desister("chloe", "PRESENT", "ABSENT", PEU_AVANT);
    const echecs = faux.audits.filter((a) => a[1] === "notification.desistement_echec");
    expect(echecs.map((a) => a[2]).sort()).toEqual(["alix", "charlie"]);
    expect(echecs[0][3]).toMatchObject({ canal: "email", erreur: "SMTP indisponible" });
  });

  it("rien n'est noté quand rien ne part", async () => {
    await desister("chloe", "PRESENT", "ABSENT", minutesAvant(600));
    expect(faux.audits.filter((a) => String(a[1]).startsWith("notification."))).toHaveLength(0);
  });
});

describe("chaque alerte s'active à part, et la dernière minute peut recouvrir le désistement", () => {
  it("une dernière minute au moins aussi longue recouvre le désistement : il ne part plus jamais", () => {
    const d = { delaiMin: 240, derniereMinuteMin: 240 };
    expect(desistementRecouvert(d)).toBe(true);
    expect(desistementRecouvert({ delaiMin: 240, derniereMinuteMin: 300 })).toBe(true);
    expect(desistementRecouvert({ delaiMin: 2880, derniereMinuteMin: 240 })).toBe(false);
    for (const m of [1, 60, 239, 240]) expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(m), d)).toBe("derniere_minute");
  });

  it("une dernière minute coupée ne recouvre rien, et rend sa fenêtre au désistement", () => {
    const d = { delaiMin: 120, derniereMinuteMin: 60, derniereMinuteActif: false };
    expect(desistementRecouvert({ ...d, derniereMinuteMin: 600 })).toBe(false);
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(30), d)).toBe("desistement");
  });

  it("un désistement coupé : seule la dernière minute part", () => {
    const d = { delaiMin: 120, derniereMinuteMin: 60, actif: false };
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(30), d)).toBe("derniere_minute");
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(90), d)).toBeNull();
  });

  it("les deux coupées : rien ne part", () => {
    expect(fenetreDesistement("2026-10-08", "20:00", minutesAvant(30), { delaiMin: 120, derniereMinuteMin: 60, actif: false, derniereMinuteActif: false })).toBeNull();
  });

  it("le réglage du bureau est lu : désistement coupé, aucun envoi hors dernière minute", async () => {
    faux.delais = { ...faux.delais, actif: "0" };
    expect(await desister("chloe", "PRESENT", "ABSENT", PEU_AVANT)).toBe(0);
    expect(faux.emails).toHaveLength(0);
    faux.reponses.set("m1", "PRESENT");
    expect(await desister("m1", "PRESENT", "ABSENT", TRES_PEU_AVANT)).toBeGreaterThan(0);
  });

  it("le réglage du bureau est lu : dernière minute coupée, le désistement classique part à sa place", async () => {
    faux.delais = { ...faux.delais, derniereMinuteActif: "0" };
    await desister("chloe", "PRESENT", "ABSENT", TRES_PEU_AVANT);
    expect(faux.emails[0].sujet.startsWith("⚠️ Désistement — ")).toBe(true);
  });
});
