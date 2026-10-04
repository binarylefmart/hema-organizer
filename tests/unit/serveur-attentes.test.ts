import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * **Ce qui peut faire attendre une action côté serveur.**
 *
 * 1. Le journal de la base : en WAL, une lecture n'empêche plus une écriture de valider. Le réglage
 *    est vérifié sur une vraie base SQLite jetable, jamais sur celle du dépôt.
 * 2. Le dépôt d'une notification chez le service de push : il part avec un délai, comme Discord,
 *    Telegram et SMTP — sans lui, un service muet tenait l'action ouverte indéfiniment.
 */

const faux = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    generateVAPIDKeys: vi.fn(() => ({ publicKey: "pub", privateKey: "priv" })),
    sendNotification: vi.fn(async (_abonnement: unknown, _charge: string, options: unknown) => {
      faux.options.push(options);
      return { statusCode: 201 };
    }),
  },
}));

vi.mock("@/lib/settings", () => ({
  CLES: { vapid: "vapid" },
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
}));

describe("journal de la base", () => {
  const dossier = mkdtempSync(path.join(tmpdir(), "hema-wal-"));
  const client = new PrismaClient({ datasourceUrl: `file:${path.join(dossier, "essai.db")}` });

  afterAll(async () => {
    await client.$disconnect();
    rmSync(dossier, { recursive: true, force: true });
  });

  it("passe la base en WAL, et le redemander ne change rien", async () => {
    const { activerJournalWal } = await import("@/lib/db");
    expect(await activerJournalWal(client)).toBe("wal");
    expect(await activerJournalWal(client)).toBe("wal");
    const lignes = await client.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode");
    expect(lignes[0]?.journal_mode).toBe("wal");
  });

  it("ne lève jamais : un échec laisse la base telle quelle", async () => {
    const { activerJournalWal } = await import("@/lib/db");
    const enPanne = { $queryRawUnsafe: vi.fn(async () => { throw new Error("base illisible"); }) } as unknown as PrismaClient;
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await activerJournalWal(enPanne)).toBeNull();
    erreur.mockRestore();
  });
});

describe("dépôt d'une notification push", () => {
  it("part avec un délai", async () => {
    const { db } = await import("@/lib/db");
    vi.spyOn(db.pushAbonnement, "update").mockResolvedValue({} as never);
    const { envoyerPush, DELAI_PUSH_MS } = await import("@/lib/notifications/push");
    const parti = await envoyerPush(
      { id: "a1", endpoint: "https://push.example/abc", p256dh: "p", auth: "a" },
      { titre: "Essai", corps: "Corps", url: "/" },
    );
    expect(parti).toBe(true);
    expect(DELAI_PUSH_MS).toBeGreaterThan(0);
    expect(DELAI_PUSH_MS).toBeLessThanOrEqual(15_000);
    expect(faux.options).toEqual([expect.objectContaining({ timeout: DELAI_PUSH_MS })]);
  });
});
