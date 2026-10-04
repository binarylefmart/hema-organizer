import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { masquerEmail } from "@/lib/membres";

/**
 * **L'adresse d'une personne sur la page de son lien d'accès.**
 *
 * `/invitation/<jeton>` s'affiche sur un simple GET : elle s'ouvre donc aussi pour un robot de
 * messagerie qui précharge le lien, et pour qui retrouve l'URL dans un historique ou un partage
 * d'écran. Elle y confirmait le compte en montrant l'adresse **entière**. Le début, la fin et le
 * domaine suffisent à se reconnaître.
 */
describe("adresse masquée à l'affichage", () => {
  /*
   * **Les adresses d'exemple portent des prénoms inventés, et c'est la seule chose qui tient ici.**
   *
   * L'attendu de ce test est la **dérivée** de son entrée : « b…n », ce sont la première et la
   * dernière lettre du prénom de l'exemple. Le calculer dans l'assertion (`local[0]`,
   * `local.at(-1)`) serait réécrire `masquerEmail` juste à côté d'elle — le test ne vérifierait plus
   * que lui-même. On garde donc les deux valeurs écrites, et on fait porter l'exemple par un prénom
   * **inventé**, comme « chloe.durand » juste en dessous : avec le prénom d'un membre du club,
   * l'entrée changeait le jour où ce membre est renommé, et l'attendu ne pouvait pas suivre.
   */
  it("ne garde que la première et la dernière lettre du nom, et le domaine", () => {
    expect(masquerEmail("bastien@exemple.fr")).toBe("b…n@exemple.fr");
    expect(masquerEmail("chloe.durand@club.test")).toBe("c…d@club.test");
  });

  it("ne laisse jamais passer l'adresse en entier", () => {
    for (const adresse of ["bastien@exemple.fr", "a@exemple.fr", "ab@exemple.fr", "jean.pierre+club@exemple.fr"]) {
      expect(masquerEmail(adresse)).not.toBe(adresse);
    }
  });

  it("ne bute ni sur une adresse absente ni sur une valeur qui n'en est pas une", () => {
    expect(masquerEmail(null)).toBe("adresse non renseignée");
    expect(masquerEmail("")).toBe("adresse non renseignée");
    expect(masquerEmail("pas-une-adresse")).toBe("…");
    expect(masquerEmail("@exemple.fr")).toBe("…");
  });

  it("la page du lien d'accès n'affiche plus l'adresse brute", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/(public)/invitation/[token]/page.tsx"), "utf8");
    expect(page).toContain("masquerEmail(user.email)");
    expect(page).not.toContain("{user.email}");
  });
});
