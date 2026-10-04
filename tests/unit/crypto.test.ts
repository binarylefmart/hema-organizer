import { describe, expect, it } from "vitest";
import { chiffrer, dechiffrer, masquer } from "@/lib/crypto";

describe("chiffrement des paramètres", () => {
  it("chiffre et déchiffre une URL de webhook", () => {
    const url = "https://discord.com/api/webhooks/123/abc";
    const c = chiffrer(url);
    expect(c).not.toContain("discord");
    expect(dechiffrer(c)).toBe(url);
    expect(chiffrer(url)).not.toBe(c); // IV aléatoire
  });
  it("refuse une valeur altérée", () => {
    const c = chiffrer("secret");
    expect(dechiffrer(c.slice(0, -3) + "AAA")).toBeNull();
    expect(dechiffrer("n'importe quoi")).toBeNull();
  });
  it("masque les secrets à l'affichage, **fin comprise**", () => {
    // Le début suffit à reconnaître la forme de la valeur ; la fin, elle, est le bout du jeton —
    // elle n'a rien à faire dans une page, une capture d'écran ou un partage d'écran.
    expect(masquer("https://discord.com/api/webhooks/123/abcdef", 8)).toBe("https://••••••••••••");
    expect(masquer("https://discord.com/api/webhooks/123/abcdef", 8)).not.toContain("abcdef");
    expect(masquer("court")).toBe("•••••");
  });
});
