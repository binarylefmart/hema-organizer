import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, codeTotp, genererSecretTotp, urlOtpauth, verifierCodeTotp } from "@/lib/auth/totp";

describe("TOTP (RFC 6238)", () => {
  // Vecteur de test RFC 6238 (secret "12345678901234567890", SHA-1, 8 → 6 derniers chiffres)
  const SECRET = base32Encode(Buffer.from("12345678901234567890"));
  it("encode/décode le base32", () => {
    expect(SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(SECRET).toString()).toBe("12345678901234567890");
  });
  it("produit les codes de référence", () => {
    expect(codeTotp(SECRET, 59_000)).toBe("287082");
    expect(codeTotp(SECRET, 1_111_111_109_000)).toBe("081804");
    expect(codeTotp(SECRET, 1_234_567_890_000)).toBe("005924");
  });
  it("accepte le code courant et ses voisins immédiats, refuse le reste", () => {
    const at = 1_234_567_890_000;
    expect(verifierCodeTotp(SECRET, "005924", at)).toBe(true);
    expect(verifierCodeTotp(SECRET, "005 924", at)).toBe(true);
    expect(verifierCodeTotp(SECRET, codeTotp(SECRET, at, -1), at)).toBe(true);
    expect(verifierCodeTotp(SECRET, codeTotp(SECRET, at, 2), at)).toBe(false);
    expect(verifierCodeTotp(SECRET, "abcdef", at)).toBe(false);
  });
  it("génère un secret de 32 caractères base32 et une URL otpauth", () => {
    const s = genererSecretTotp();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    // L'émetteur est le nom du club, passé en argument : c'est lui que l'application
    // d'authentification affiche au-dessus du code.
    expect(urlOtpauth(s, "alix@club.test", "CEA Organizer")).toContain(`otpauth://totp/CEA%20Organizer:alix%40club.test?secret=${s}`);
    // Sans nom fourni, le nom livré avec le code.
    expect(urlOtpauth(s, "alix@club.test")).toContain("otpauth://totp/HEMA%20Organizer:");
  });
});
