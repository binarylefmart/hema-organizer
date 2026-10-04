import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, RATE_LIMITS, utiliserMagasinMemoire } from "@/lib/auth/rate-limit";

describe("limiteur de débit", () => {
  beforeEach(() => utiliserMagasinMemoire());

  it("bloque après le maximum dans la fenêtre puis libère", async () => {
    const { max, windowMs } = RATE_LIMITS.login_email;
    const t0 = 1_000_000;
    for (let i = 0; i < max; i++) expect(await checkRateLimit("login_email", "a@b.fr", t0 + i)).toBe(true);
    expect(await checkRateLimit("login_email", "a@b.fr", t0 + max)).toBe(false);
    expect(await checkRateLimit("login_email", "a@b.fr", t0 + windowMs + max + 1)).toBe(true);
  });

  it("est insensible à la casse de la clé et isole les contextes", async () => {
    const { max } = RATE_LIMITS.reset_email;
    for (let i = 0; i < max; i++) await checkRateLimit("reset_email", "A@B.fr");
    expect(await checkRateLimit("reset_email", "a@b.FR")).toBe(false);
    expect(await checkRateLimit("login_email", "a@b.fr")).toBe(true);
  });
});
