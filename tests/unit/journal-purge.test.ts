import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Le journal des notifications a enfin une échéance**.
 *
 * `NotificationLog` garde **qui a reçu quel message et quand**, nommément : rappels, décisions
 * d'atelier, invitations, réinitialisations. Elle n'avait aucune rétention, alors que le journal
 * d'audit en a une depuis toujours — `grep -rn "notificationLog" src/ | grep -i "delete\\|purg"` ne
 * rendait rien, et aucune des étapes d'`entretienQuotidien` n'y touchait. C'est une question de
 * **minimisation des données**, pas de volume.
 *
 * Deux règles à tenir, et ce sont les deux cas de ce fichier : la fenêtre livrée (90 jours), et le
 * fait qu'elle **ne dépasse jamais celle du journal d'audit** — le journal le plus bavard des deux
 * ne doit pas survivre au plus encadré.
 */

const faux = vi.hoisted(() => ({ bornes: [] as Array<Date> }));

vi.mock("@/lib/db", () => ({
  db: {
    notificationLog: {
      deleteMany: vi.fn(async (args: { where: { date: { lt: Date } } }) => {
        faux.bornes.push(args.where.date.lt);
        return { count: 3 };
      }),
    },
  },
}));

const { RETENTION_NOTIFICATIONS_JOURS, purgerNotifications } = await import("@/lib/notifications/journal");

const MAINTENANT = new Date("2026-09-30T07:00:00Z");
const jours = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

beforeEach(() => {
  faux.bornes = [];
});

describe("purgerNotifications", () => {
  it("efface ce qui dépasse la rétention livrée (90 jours) et rend le compte", async () => {
    expect(await purgerNotifications(MAINTENANT)).toBe(3);
    expect(jours(faux.bornes[0], MAINTENANT)).toBe(RETENTION_NOTIFICATIONS_JOURS);
  });

  it("reste strictement plus courte que la rétention par défaut du journal d'audit", () => {
    expect(RETENTION_NOTIFICATIONS_JOURS).toBeLessThan(365);
  });

  it("se laisse borner par la rétention de l'audit quand celle-ci est plus courte", async () => {
    await purgerNotifications(MAINTENANT, 30);
    expect(jours(faux.bornes[0], MAINTENANT)).toBe(30);
  });

  it("ne s'allonge pas quand le club conserve son audit plus longtemps", async () => {
    await purgerNotifications(MAINTENANT, 3650);
    expect(jours(faux.bornes[0], MAINTENANT)).toBe(RETENTION_NOTIFICATIONS_JOURS);
  });

  /**
   * La fenêtre doit couvrir la plus longue clé de déduplication **datée** : le rappel aux personnes
   * sans réponse part J-7 avant la séance, et c'est le jalon le plus lointain de tout le dossier.
   * Une purge plus courte que ça referait partir un message déjà reçu.
   */
  it("couvre largement le jalon le plus lointain (rappel J-7)", () => {
    expect(RETENTION_NOTIFICATIONS_JOURS).toBeGreaterThan(7 * 4);
  });
});
