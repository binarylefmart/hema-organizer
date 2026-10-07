import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COOKIE_ECRAN, cookieFormatEcran, lireFormatEcran, REQUETE_TELEPHONE } from "@/components/ui/ecran";

const lire = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

/**
 * La bascule téléphone / ordinateur s'écrit trois fois — variante CSS, requête du navigateur, cookie
 * — et ces trois écritures doivent dire la même règle : au doigt, ou sous 768 px.
 */
describe("la bascule téléphone / ordinateur", () => {
  const css = lire("src/app/globals.css");

  it("a la même requête en CSS et dans le navigateur", () => {
    expect(REQUETE_TELEPHONE).toBe("(width < 48rem), (pointer: coarse)");
    expect(css).toMatch(/@custom-variant tel \{\s*@media \(width < 48rem\), \(pointer: coarse\) \{/);
    // `ordi:` est le complément exact de `tel:`.
    expect(css).toMatch(/@custom-variant ordi \{\s*@media \(width >= 48rem\) and \(not \(pointer: coarse\)\) \{/);
  });

  it("réserve les paliers larges à l'ordinateur", () => {
    for (const [palier, largeur] of [["lg", "64rem"], ["xl", "80rem"], ["2xl", "96rem"]]) {
      expect(css).toContain(`@custom-variant ${palier} {\n  @media (min-width: ${largeur}) and (not (pointer: coarse)) {`);
    }
  });

  it("ne lit dans le cookie que les deux formats connus", () => {
    expect(lireFormatEcran("tel")).toBe("tel");
    expect(lireFormatEcran("ordi")).toBe("ordi");
    expect(lireFormatEcran(undefined)).toBeNull();
    expect(lireFormatEcran("")).toBeNull();
    expect(lireFormatEcran("<script>")).toBeNull();
  });

  it("pose un cookie de site, sans donnée personnelle, sécurisé en https", () => {
    expect(COOKIE_ECRAN).toBe("ecran");
    const https = cookieFormatEcran("tel", true);
    expect(https).toMatch(/^ecran=tel; Path=\/; Max-Age=\d+; SameSite=Lax; Secure$/);
    expect(cookieFormatEcran("ordi", false)).not.toContain("Secure");
  });

  it("est lu par la mise en page racine et posé par le navigateur", () => {
    const racine = lire("src/app/layout.tsx");
    expect(racine).toContain("lireFormatEcran(jar.get(COOKIE_ECRAN)?.value)");
    expect(racine).toContain("<FormatEcranConnu format={format}>");
    expect(racine).toContain("<MemoireEcran />");
    // Sans cookie, le crochet part de l'ordinateur ; avec, du format retenu.
    expect(lire("src/components/ui/useEcranTelephone.ts")).toContain('() => formatServeur === "tel"');
  });

  it("n'a plus de bascule sur `md:` dans les écrans du téléphone", () => {
    for (const f of [
      "src/components/layout/Navigation.tsx",
      "src/components/seances/CarteSeance.tsx",
      "src/app/(app)/admin/page.tsx",
      "src/app/(app)/admin/layout.tsx",
      "src/components/planning/BarreEdition.tsx",
    ]) {
      expect(lire(f), f).not.toMatch(/(^|[^\w@-])(max-)?md:/m);
    }
  });
});
