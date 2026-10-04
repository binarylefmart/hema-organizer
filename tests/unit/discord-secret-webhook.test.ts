import { afterEach, describe, expect, it, vi } from "vitest";
import { ERREUR_DISCORD_INCONNUE, messageErreurDiscord, posterDiscord } from "@/lib/notifications/discord";
// La forme vit dans `constants.ts` : le champ de l'espace admin et la variable de la stack lisent
// la même, un seul endroit à changer.
import { FORME_WEBHOOK_DISCORD } from "@/lib/constants";
import { normaliserWebhookDiscord } from "@/lib/env";

/**
 * **L'URL d'un webhook Discord est un secret, et elle ne doit apparaître dans aucun message
 * d'erreur**.
 *
 * Deux moitiés d'un même trou :
 *
 * 1. `DISCORD_WEBHOOK_URL` n'était **pas validée du tout** (`z.string().default("")`), alors que la
 *    même valeur saisie dans l'application passe par `webhookDiscordSchema`. Une URL mal recopiée
 *    dans Portainer — le projet a déjà vécu ça avec les guillemets conservés sur `SMTP_FROM` —
 *    arrivait telle quelle dans `fetch()` ;
 * 2. le `TypeError` que lève alors Node **reprend l'entrée fautive, jeton porteur compris**
 *    (`Failed to parse URL from "https://discord.com/api/webhooks/123/SECRET"`), et cette erreur
 *    était recopiée sans filtre : `NotificationLog.erreur` (affiché dans l'espace admin),
 *    `AuditLog.details` (365 jours, exporté en CSV), l'écran du test de salon, le journal du
 *    conteneur. Le jumeau Telegram (`messageErreurTelegram`) avait été écrit exactement pour éviter
 *    ça — **l'asymétrie était le défaut**.
 *
 * Le jeton de test ci-dessous est inventé : il n'a jamais existé.
 */

// L'identité vit en base et `posterDiscord` la lit au plus près de l'envoi : ce fichier ne teste
// que le transport, il n'a pas de base.
vi.mock("@/lib/identite", () => ({ identite: vi.fn(async () => ({ nomClub: "Club de test", ecu: "/logo-ecu.png" })) }));

const JETON = "ZZZ-jeton-invente-pour-le-test";
const WEBHOOK = `https://discord.com/api/webhooks/123456789/${JETON}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normaliserWebhookDiscord", () => {
  it("accepte un webhook bien formé, des deux domaines de Discord", () => {
    expect(normaliserWebhookDiscord(WEBHOOK)).toBe(WEBHOOK);
    expect(normaliserWebhookDiscord(`https://discordapp.com/api/webhooks/1/${JETON}`)).toBe(`https://discordapp.com/api/webhooks/1/${JETON}`);
    expect(FORME_WEBHOOK_DISCORD.test(WEBHOOK)).toBe(true);
  });

  it("retire les guillemets que Portainer garde, au lieu de perdre un webhook juste", () => {
    expect(normaliserWebhookDiscord(`  "${WEBHOOK}" `)).toBe(WEBHOOK);
    expect(normaliserWebhookDiscord(`'${WEBHOOK}'`)).toBe(WEBHOOK);
  });

  it("oublie une valeur inutilisable — sans jamais la recopier dans l'avertissement", () => {
    const dits: string[] = [];
    for (const mauvais of ["pas-une-url", `http://discord.com/api/webhooks/1/${JETON}`, `https://exemple.net/api/webhooks/1/${JETON}`, `https://discord.com/api/webhooks/${JETON}`]) {
      expect(normaliserWebhookDiscord(mauvais, (m) => dits.push(m))).toBe("");
    }
    expect(dits).toHaveLength(4);
    for (const m of dits) expect(m).not.toContain(JETON);
  });

  it("n'arrête pas l'application : le canal reste muet, il ne fait pas tomber le club", () => {
    // La valeur fautive est ramenée à la chaîne vide (le comportement de « aucun webhook réglé »),
    // et non transformée en erreur de configuration : `env()` lève, et lever ici couperait tout.
    expect(() => normaliserWebhookDiscord("n'importe quoi")).not.toThrow();
  });
});

describe("messageErreurDiscord", () => {
  it("ne dit jamais l'adresse appelée sur un échec réseau", () => {
    const vrai = new TypeError(`Failed to parse URL from "${WEBHOOK}"`);
    const message = messageErreurDiscord(null, vrai);
    expect(message).not.toContain(JETON);
    expect(message).not.toContain("discord.com/api/webhooks");
    // Ce qui reste est ce qui aide à comprendre : le nom de l'erreur.
    expect(message).toContain("TypeError");
  });

  it("garde le code de la cause, qui nomme la panne sans rien révéler", () => {
    const coupe = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    expect(messageErreurDiscord(null, coupe)).toContain("ENOTFOUND");
  });

  it("garde statut et corps tronqué pour une réponse HTTP, comme le jumeau Telegram", () => {
    expect(messageErreurDiscord(400, '{"message":"Invalid Form Body"}')).toBe('Discord : réponse 400 — {"message":"Invalid Form Body"}');
    expect(messageErreurDiscord(500, "x".repeat(500))).toHaveLength("Discord : réponse 500 — ".length + 200);
    expect(messageErreurDiscord(404, "")).toBe("Discord : réponse 404");
  });

  it("ne recopie rien d'un objet levé qui n'est pas une Error", () => {
    expect(messageErreurDiscord(null, { url: WEBHOOK })).not.toContain(JETON);
    expect(ERREUR_DISCORD_INCONNUE).not.toContain("http");
  });
});

describe("posterDiscord — ce que l'appelant reçoit vraiment", () => {
  it("lève un message qui ne porte pas l'URL quand fetch refuse l'adresse", async () => {
    // Exactement ce que fait Node : le message de l'erreur porte l'entrée fautive.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError(`Failed to parse URL from "${WEBHOOK}"`);
      }),
    );
    await expect(posterDiscord(WEBHOOK, { title: "Message de test" })).rejects.toThrow(/appel impossible/);
    await expect(posterDiscord(WEBHOOK, { title: "Message de test" })).rejects.not.toThrow(new RegExp(JETON));
  });
});
