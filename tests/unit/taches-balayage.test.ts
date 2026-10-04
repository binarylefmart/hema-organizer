import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Le balayage nocturne et les envois du soir** (`src/lib/taches.ts`).
 *
 * Trois choses n'allaient pas, et toutes se manifestaient par une absence — le genre de panne
 * qu'on ne voit pas :
 *
 * 1. **`entretienQuotidien` n'avait aucune garde par étape.** Dix appels à la suite : la première
 *    exception — base verrouillée par la sauvegarde, réglage illisible, SMTP qui lève — emportait
 *    tout ce qui venait après. Une alerte « peu de monde » en panne faisait sauter le rappel de la
 *    période suivante, la purge d'audit et le ménage des affiches, chaque nuit.
 * 2. **`tickEnvois` ne partait qu'à la minute exacte de l'heure réglée.** Un redémarrage pile à
 *    18:00, un cron en retard, une heure avalée par le changement d'horaire, et le récap sautait
 *    pour la journée. Et la reprise après échec promise par `journal.ts` n'avait jamais lieu : une
 *    clé libérée n'était rejouée que le lendemain, c'est-à-dire trop tard pour un cours du lendemain.
 * 3. **L'alerte « peu de monde » n'était appelée que par le balayage de 07:00**, alors que sa propre
 *    docstring promettait la fenêtre de rattrapage du point 2. Sa fenêtre allant de J-3 au jour même,
 *    une séance du jour n'avait qu'un seul passage : un SMTP fâché à 07:00 libérait proprement la clé,
 *    et rien ne la rejouait jamais. Elle a rejoint `envoisDuSoir`.
 *
 * Toutes les dépendances sont simulées : ce fichier ne teste que l'ordonnancement.
 */

const faux = vi.hoisted(() => ({
  /** Les étapes réellement exécutées, dans l'ordre */
  etapes: [] as string[],
  /** Les étapes qui doivent lever */
  cassees: new Set<string>(),
  heureReglee: "18:00" as string | Error,
  envois: 0,
  /** Rétention réglée pour le journal d'audit, telle que la lit `entretienQuotidien` */
  retentionAudit: 365 as number,
  /** Rétention que le balayage a réellement passée à la purge des notifications */
  retentionVue: undefined as number | undefined,
}));

/** Une étape simulée : elle note son passage, ou lève si le test l'a cassée. */
function etape<T>(nom: string, valeur: T) {
  return vi.fn(async () => {
    faux.etapes.push(nom);
    if (faux.cassees.has(nom)) throw new Error(`${nom} : panne simulée`);
    return valeur;
  });
}

vi.mock("@/lib/affiches", () => ({ purgerAffichesOrphelines: etape("affiches", 1) }));
vi.mock("@/lib/evenements", () => ({ purgerEvenementsAnciens: etape("evenements", 2) }));
vi.mock("@/lib/auth/rate-limit", () => ({ purgerRateLimits: etape("limiteurs", 3) }));
vi.mock("@/lib/auth/session", () => ({ purgeExpiredSessions: etape("sessions", 4) }));
vi.mock("@/lib/invitations", () => ({
  envoyerLiensDesTrimestresQuiCommencent: etape("liens-trimestre", 5),
  renouvelerLiensExpirants: etape("liens-renouveles", 6),
}));
vi.mock("@/lib/alertes", () => ({ purgerAudit: etape("audit", 7), getRetentionAuditJours: vi.fn(async () => faux.retentionAudit) }));
vi.mock("@/lib/notifications/journal", () => ({
  purgerNotifications: vi.fn(async (_now: Date, retentionAudit?: number) => {
    faux.etapes.push("notifications");
    if (faux.cassees.has("notifications")) throw new Error("notifications : panne simulée");
    faux.retentionVue = retentionAudit;
    return 11;
  }),
}));
vi.mock("@/lib/env", () => ({ bequilleDevActive: vi.fn(() => true) }));
vi.mock("@/lib/notifications/seances", () => ({ alerterEffectifFaible: etape("effectif", 8) }));
vi.mock("@/lib/notifications/fin-periode", () => ({ rappelerPeriodeSuivante: etape("fin-periode", 9) }));
vi.mock("@/lib/notifications/periode-non-activee", () => ({ alerterPeriodeNonActivee: etape("activation", 10) }));
vi.mock("@/lib/sauvegarde", () => ({ sauvegarderBase: vi.fn(async () => ({ fichier: "x", octets: 0, supprimees: 0 })) }));

vi.mock("@/lib/notifications/recap", () => ({
  envoyerRecapVeille: vi.fn(async () => {
    faux.envois++;
    return { seances: 1, emails: 2, discord: 1, telegram: 0 };
  }),
}));
vi.mock("@/lib/notifications/rappels", () => ({ envoyerRappelsSansReponse: vi.fn(async () => ({ seances: 0, emails: 0 })) }));

vi.mock("@/lib/settings", () => ({
  heureRecap: vi.fn(async () => {
    if (faux.heureReglee instanceof Error) throw faux.heureReglee;
    return faux.heureReglee;
  }),
}));

const { entretienQuotidien, envoisDuSoir, tickEnvois } = await import("@/lib/taches");
const { FENETRE_RATTRAPAGE_MIN, PAS_RATTRAPAGE_MIN } = await import("@/lib/notifications/planification");

/**
 * Les étapes du balayage, dans l'ordre où `entretienQuotidien` les enchaîne. La **purge du journal
 * des notifications** suit immédiatement celle de l'audit : c'est la rétention de l'audit qui la
 * borne, et elle vient d'être lue.
 */
const TOUTES = ["sessions", "liens-trimestre", "liens-renouveles", "limiteurs", "audit", "notifications", "effectif", "fin-periode", "activation", "evenements", "affiches"];

beforeEach(() => {
  faux.etapes = [];
  faux.cassees = new Set();
  faux.heureReglee = "18:00";
  faux.envois = 0;
  faux.retentionAudit = 365;
  faux.retentionVue = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("entretien quotidien : une étape en panne n'emporte pas les autres", () => {
  it("enchaîne toutes les étapes dans l'ordre quand tout va bien", async () => {
    const bilan = await entretienQuotidien();
    expect(faux.etapes).toEqual(TOUTES);
    expect(bilan.sessionsPurgees).toBe(4);
    expect(bilan.alertesEffectif).toBe(8);
  });

  it("purge le journal des notifications, en lui passant la rétention de l'audit", async () => {
    faux.retentionAudit = 30;
    const bilan = await entretienQuotidien();
    expect(faux.etapes).toContain("notifications");
    expect(bilan.notificationsPurgees).toBe(11);
    // C'est la rétention de l'audit qui borne celle des notifications, pas l'inverse.
    expect(faux.retentionVue).toBe(30);
  });

  it("purge quand même les notifications si la rétention de l'audit est illisible", async () => {
    const { getRetentionAuditJours } = await import("@/lib/alertes");
    vi.mocked(getRetentionAuditJours).mockRejectedValueOnce(new Error("réglage illisible"));
    const bilan = await entretienQuotidien();
    expect(bilan.notificationsPurgees).toBe(11);
    expect(faux.retentionVue).toBeUndefined();
  });

  it("va au bout du balayage quand l'alerte « peu de monde » lève", async () => {
    faux.cassees.add("effectif");
    const bilan = await entretienQuotidien();
    expect(faux.etapes).toEqual(TOUTES);
    // L'étape cassée rend une valeur neutre, les suivantes rendent la leur.
    expect(bilan.alertesEffectif).toBe(0);
    expect(bilan.rappelsPeriode).toBe(9);
    expect(bilan.affichesPurgees).toBe(1);
  });

  it("survit à une panne de la toute première étape", async () => {
    faux.cassees.add("sessions");
    const bilan = await entretienQuotidien();
    expect(faux.etapes).toEqual(TOUTES);
    expect(bilan.sessionsPurgees).toBe(0);
  });

  it("ne lève jamais, même si tout est en panne", async () => {
    faux.cassees = new Set(TOUTES);
    await expect(entretienQuotidien()).resolves.toMatchObject({ sessionsPurgees: 0, auditPurge: 0, affichesPurgees: 0 });
    expect(faux.etapes).toEqual(TOUTES);
  });
});

describe("envois du soir : la minute réglée, et ce qui la rattrape", () => {
  /** L'instant, en heure de Paris le 23 septembre 2026 (heure d'été : UTC+2). */
  const aParis = (heure: number, minute: number) => new Date(Date.UTC(2026, 8, 23, heure - 2, minute));

  it("part à l'heure réglée", async () => {
    expect(await tickEnvois(aParis(18, 0))).toBe(true);
    expect(faux.envois).toBe(1);
  });

  it("ne part pas avant l'heure, ni une minute quelconque après", async () => {
    expect(await tickEnvois(aParis(17, 59))).toBe(false);
    expect(await tickEnvois(aParis(18, 1))).toBe(false);
    expect(faux.envois).toBe(0);
  });

  /**
   * Le cœur du correctif : la minute de 18:00 a été manquée (serveur redémarré, cron en retard).
   * Le passage suivant rattrape — et comme tout est idempotent, il ne double rien.
   */
  it("rattrape une minute manquée au passage suivant", async () => {
    expect(await tickEnvois(aParis(18, PAS_RATTRAPAGE_MIN))).toBe(true);
    expect(faux.envois).toBe(1);
  });

  it("repasse plusieurs fois derrière l'heure, le temps qu'un envoi en échec soit rejoué", async () => {
    for (let m = 0; m <= FENETRE_RATTRAPAGE_MIN; m += PAS_RATTRAPAGE_MIN) {
      expect(await tickEnvois(aParis(18, m))).toBe(true);
    }
    expect(faux.envois).toBe(1 + FENETRE_RATTRAPAGE_MIN / PAS_RATTRAPAGE_MIN);
  });

  it("s'arrête au bout de la fenêtre : le soir n'est pas un envoi permanent", async () => {
    expect(await tickEnvois(aParis(18, FENETRE_RATTRAPAGE_MIN + PAS_RATTRAPAGE_MIN))).toBe(false);
    expect(await tickEnvois(aParis(23, 0))).toBe(false);
    expect(faux.envois).toBe(0);
  });

  it("n'envoie rien quand l'heure réglée est illisible", async () => {
    faux.heureReglee = new Error("réglages illisibles");
    expect(await tickEnvois(aParis(18, 0))).toBe(false);
    expect(faux.envois).toBe(0);
  });

  /**
   * **La fenêtre de rattrapage que l'alerte « peu de monde » promettait, et qui n'existait pas.**
   *
   * `alerterEquipeParEmail` justifie son compromis sur `journaliser` par « le passage suivant du
   * balayage (toutes les 15 min pendant la fenêtre de rattrapage, puis le lendemain) refait partir
   * l'alerte entière ». Or l'alerte n'était appelée que par `entretienQuotidien`, planifié
   * `0 7 * * *` : **un seul passage par jour, sans fenêtre** — `estPassageEnvois` et
   * `FENETRE_RATTRAPAGE_MIN` ne gouvernaient que `tickEnvois`, qui n'appelait qu'`envoisDuSoir`.
   *
   * Et la fenêtre de l'alerte va de J-3 **au jour même** : pour une séance du jour, le passage de
   * 07:00 était le premier *et* le dernier. Trois minutes de SMTP fâché, `marquerEchec` libérait bien
   * la clé — et rien ne la rejouait. L'équipe ouvrait la salle pour personne, sans avoir jamais été
   * prévenue. C'est le câblage qui manquait, pas la promesse : l'alerte est idempotente
   * (`effectif_<id>`), elle rejoint donc les envois du soir.
   */
  it("fait aussi repartir l'alerte « peu de monde », et rend son compte", async () => {
    const bilan = await envoisDuSoir(aParis(18, 0));
    expect(faux.etapes).toContain("effectif");
    expect(bilan.alertesEffectif).toBe(8);
  });

  it("rejoue l'alerte à chaque repassage : c'est là toute la reprise pour une séance du jour même", async () => {
    for (let m = 0; m <= FENETRE_RATTRAPAGE_MIN; m += PAS_RATTRAPAGE_MIN) {
      expect(await tickEnvois(aParis(18, m))).toBe(true);
    }
    // Un passage par repassage, exactement comme le récap : une clé libérée par `marquerEchec` a
    // désormais des occasions d'être reprise le soir même.
    expect(faux.etapes.filter((e) => e === "effectif")).toHaveLength(1 + FENETRE_RATTRAPAGE_MIN / PAS_RATTRAPAGE_MIN);
  });

  it("n'empêche ni le récap ni les rappels quand l'alerte du soir lève", async () => {
    faux.cassees.add("effectif");
    const bilan = await envoisDuSoir(aParis(18, 0));
    // L'alerte est la dernière des trois, mais sa panne reste rattrapée sur place : le récap est parti,
    // et le compte rendu dit simplement qu'il ne s'est rien passé de ce côté-là.
    expect(faux.envois).toBe(1);
    expect(bilan.recap.emails).toBe(2);
    expect(bilan.alertesEffectif).toBe(0);
  });
});
