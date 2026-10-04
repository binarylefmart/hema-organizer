import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **L'avatar du webhook, et le 400 qu'il provoquait.**
 *
 * Discord valide `avatar_url` à la réception et **refuse tout le message** si l'adresse ne lui
 * convient pas — une URL en clair, un `localhost`, une IP de réseau local. Or `DOMAIN` peut
 * légitimement valoir `localhost:3000` en développement, ou une IP privée quand le club sert
 * l'application sur son réseau : chaque envoi partait alors avec une image que Discord ne pouvait
 * pas aller chercher, et **tous les salons** rendaient « réponse 400 » sans autre explication.
 *
 * Ce test fige la règle : l'avatar n'accompagne le message que s'il est joignable depuis
 * l'extérieur. Sans lui, Discord affiche l'avatar réglé dans le salon — on perd une image, jamais
 * un message.
 *
 * Le **nom** et l'**écu** ne sont plus écrits dans le code : ils viennent de l'identité du club
 * (`src/lib/identite.ts`) et arrivent ici en argument — c'est pourquoi la fonction se teste avec un
 * club d'essai, sans base.
 */

/** Un club quelconque, avec l'écu livré : ce que `identite()` rendrait à une instance neuve. */
const CLUB = { nomClub: "Mon club d'AMHE", ecu: "/logo-ecu.png" };

async function payloadAvec(domaine: string, club = CLUB) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    baseUrl: () => (domaine.startsWith("http") ? domaine : `https://${domaine}`),
    env: () => ({ DISCORD_WEBHOOK_URL: "" }),
    isProduction: () => false,
  }));
  const { payloadDiscord } = await import("@/lib/notifications/discord");
  return payloadDiscord({ title: "Essai", description: "…", color: 1 }, club) as { avatar_url?: string; username: string };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/env");
});

describe("avatar du webhook Discord", () => {
  it("n'est pas envoyé depuis une adresse que Discord ne peut pas atteindre", async () => {
    for (const domaine of ["http://localhost:3000", "http://127.0.0.1:3000", "http://192.168.1.20:3000", "http://192.168.1.20", "http://10.0.0.5:3000"]) {
      const charge = await payloadAvec(domaine);
      expect(charge.avatar_url, `${domaine} ne doit pas partir comme avatar`).toBeUndefined();
      // Le message, lui, part quand même : c'est tout l'objet du repli
      expect(charge.username).toBeTruthy();
    }
  });

  it("accompagne le message depuis un domaine public en HTTPS", async () => {
    const charge = await payloadAvec("https://organizer.mon-club.fr");
    expect(charge.avatar_url).toBe("https://organizer.mon-club.fr/logo-ecu.png");
  });

  it("suit l'écu déposé dans l'espace admin, et pas un fichier livré", async () => {
    // Un club qui a déposé son écu : le chemin est adressé par contenu, l'avatar doit le reprendre.
    const depose = `/api/affiche/${"a".repeat(64)}.png`;
    const charge = await payloadAvec("https://organizer.exemple.fr", { nomClub: "Cercle d'escrime ancienne", ecu: depose });
    expect(charge.avatar_url).toBe(`https://organizer.exemple.fr${depose}`);
  });

  it("annonce le message sous le nom du club, tel qu'il est réglé", async () => {
    const charge = await payloadAvec("https://organizer.exemple.fr", { nomClub: "Cercle d'escrime ancienne", ecu: "/logo-ecu.png" });
    expect(charge.username).toBe("Cercle d'escrime ancienne");
  });

  it("refuse aussi le HTTP sur un vrai domaine : Discord exige une adresse sûre", async () => {
    const charge = await payloadAvec("http://organizer.mon-club.fr");
    expect(charge.avatar_url).toBeUndefined();
  });
});
