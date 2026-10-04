import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { USAGES_JETON, generateToken, hashToken, isValidTokenFormat, signPayload, verifySignedPayload } from "@/lib/auth/tokens";

describe("jetons opaques", () => {
  it("génère 32 octets en base64url (43 caractères, alphabet sûr pour les URL)", () => {
    const t = generateToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(isValidTokenFormat(t)).toBe(true);
  });

  it("produit des jetons différents à chaque appel", () => {
    const vus = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(vus.size).toBe(100);
  });

  it("hache en SHA-256 hexadécimal, de façon déterministe", () => {
    const t = generateToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
    // Le hash ne doit pas révéler le jeton
    expect(hashToken(t)).not.toContain(t);
  });

  it("rejette les formats invalides", () => {
    expect(isValidTokenFormat("")).toBe(false);
    expect(isValidTokenFormat("court")).toBe(false);
    expect(isValidTokenFormat("a".repeat(43) + "/")).toBe(false);
    expect(isValidTokenFormat(42)).toBe(false);
    expect(isValidTokenFormat(null)).toBe(false);
  });
});

describe("jetons signés (HMAC)", () => {
  const secret = "s".repeat(32);
  it("vérifie une charge utile signée, et lui rend son usage", () => {
    const t = signPayload({ userId: "u1" }, secret, "desinscription");
    expect(verifySignedPayload(t, secret, "desinscription")).toEqual({ userId: "u1", u: "desinscription" });
  });
  it("refuse une signature altérée ou un autre secret", () => {
    const t = signPayload({ userId: "u1" }, secret, "desinscription");
    expect(verifySignedPayload(t.slice(0, -2) + "zz", secret, "desinscription")).toBeNull();
    expect(verifySignedPayload(t, "autre".repeat(8), "desinscription")).toBeNull();
    expect(verifySignedPayload("n-importe-quoi", secret, "desinscription")).toBeNull();
  });

  /**
   * **Aucun jeton ne doit valoir pour une autre famille que la sienne.**
   *
   * Un seul secret signe tout ce que l'application frappe : deux familles de même forme seraient donc
   * interchangeables si l'usage n'entrait pas dans la signature — et certaines dorment en clair dans
   * le pied d'un email, pour un an.
   *
   * Ce test n'énumère donc pas deux ou trois couples : il **croise tous les usages déclarés**. Un
   * usage ajouté un jour sans être nommé à la lecture échouera ici, et pas dans six mois.
   */
  it("refuse un jeton d'un autre usage, dans les deux sens et pour tous les couples", () => {
    for (const emis of USAGES_JETON) {
      const t = signPayload({ uid: "u-chloe", exp: Date.now() + 60_000 }, secret, emis);
      for (const attendu of USAGES_JETON) {
        expect(verifySignedPayload(t, secret, attendu), `${emis} présenté comme ${attendu}`).toEqual(
          attendu === emis ? { uid: "u-chloe", exp: expect.any(Number), u: emis } : null,
        );
      }
    }
  });

  /** L'usage entre dans le HMAC : le retoucher dans la charge invalide la signature, il ne la contourne pas. */
  it("ne se laisse pas retoucher : changer l'usage dans la charge casse la signature", () => {
    const t = signPayload({ uid: "u-chloe" }, secret, "desinscription");
    const [data] = t.split(".");
    const charge = JSON.parse(Buffer.from(data, "base64url").toString());
    expect(charge.u).toBe("desinscription");
    const forge = Buffer.from(JSON.stringify({ ...charge, u: "attente-2fa" })).toString("base64url");
    expect(verifySignedPayload(`${forge}.${t.split(".")[1]}`, secret, "attente-2fa")).toBeNull();
  });

  /**
   * Les jetons frappés n'ont pas de champ d'usage. Ils sont refusés **partout** — le bon
   * comportement : un lien de désinscription périmé renvoie à l'écran qui en propose un neuf, et
   * les cookies concernés se rejouent en se reconnectant.
   */
  it("refuse un jeton d'avant la portée, faute d'usage", () => {
    const data = Buffer.from(JSON.stringify({ uid: "u-chloe", exp: Date.now() + 60_000 })).toString("base64url");
    const sig = createHmac("sha256", secret).update(data).digest("base64url");
    for (const usage of USAGES_JETON) expect(verifySignedPayload(`${data}.${sig}`, secret, usage)).toBeNull();
  });
});

/**
 * **Un jeton n'a qu'une forme**.
 *
 * Le découpage ignorait tout ce qui suivait la deuxième partie :
 * `<charge>.<signature>.nimportequoi` se vérifiait **exactement** comme `<charge>.<signature>`,
 * accepté sur les sept usages. Ça ne donnait aucun droit de plus — le HMAC ne couvre que la charge,
 * et l'usage doit toujours correspondre —, mais un jeton cessait d'avoir une forme **canonique** :
 * un journal, une clé de cache ou une table de jeton à usage unique indexée sur la chaîne peut alors
 * compter deux fois le même jeton, ou en laisser passer une seconde variante.
 */
describe("la forme canonique d'un jeton signé", () => {
  const SECRET = "un-secret-de-test-assez-long-pour-passer-la-validation";

  it("refuse une troisième partie, même si la signature est bonne", () => {
    const jeton = signPayload({ uid: "u1" }, SECRET, "desinscription");
    expect(verifySignedPayload(jeton, SECRET, "desinscription")).toEqual({ uid: "u1", u: "desinscription" });
    for (const suffixe of [".nimportequoi", ".", ".AAAA.BBBB"]) {
      expect(verifySignedPayload(`${jeton}${suffixe}`, SECRET, "desinscription"), suffixe).toBeNull();
    }
  });

  it("refuse une seule partie", () => {
    expect(verifySignedPayload("charge-sans-signature", SECRET, "desinscription")).toBeNull();
    expect(verifySignedPayload("", SECRET, "desinscription")).toBeNull();
  });
});
