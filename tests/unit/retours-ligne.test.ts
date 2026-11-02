import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { retoursALaLigne } from "@/lib/retours-ligne";
import { renderEmailHtml, type ClubEmail } from "@/lib/email/templates/layout";
import { embedBorne } from "@/lib/notifications/discord";
import { texteTelegram } from "@/lib/notifications/telegram";
import { SEPARATEUR_PARTIE } from "@/components/seances/programme-cours";

/**
 * **Lisibilité** (retours du club d'Arras) : les retours à la ligne d'une description — vrais ou
 * écrits « \n » en toutes lettres — se lisent comme des retours à la ligne partout, et un pointillé
 * sépare les parties du programme.
 */

const CLUB: ClubEmail = { nomClub: "Club", logo: "/logo.png" };

describe("retoursALaLigne", () => {
  it("rend les \\n écrits en toutes lettres et les fins de ligne Windows", () => {
    expect(retoursALaLigne("Garde haute\\nPuis coupe")).toBe("Garde haute\nPuis coupe");
    expect(retoursALaLigne("a\\r\\nb\r\nc\rd")).toBe("a\nb\nc\nd");
    expect(retoursALaLigne("rien à changer")).toBe("rien à changer");
  });
});

describe("les supports", () => {
  it("email : échappé d'abord, puis <br>", () => {
    const html = renderEmailHtml({ titre: "t", paragraphes: ["<b>1</b>\\nligne 2\nligne 3"] }, CLUB);
    expect(html).toContain("&lt;b&gt;1&lt;/b&gt;<br>ligne 2<br>ligne 3");
  });
  it("Discord et Telegram : de vrais retours à la ligne", () => {
    const borne = embedBorne({ title: "t", description: "a\\nb", fields: [{ name: "Programme", value: "c\\nd" }] });
    expect(borne.description).toBe("a\nb");
    expect(borne.fields?.[0].value).toBe("c\nd");
    expect(texteTelegram({ title: "t", description: "a\\nb" })).toContain("a\nb");
  });
});

describe("le programme se lit partie par partie", () => {
  const lire = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  it("la description garde ses retours à la ligne à l'écran et sur la page de partage", () => {
    expect(lire("src/components/seances/ProgrammeCours.tsx")).toMatch(/whitespace-pre-line[^\n]*\n[\s\S]*retoursALaLigne\(texte\)/);
    expect(lire("src/app/(public)/partage/Resume.tsx")).toContain('whitespace-pre-line break-words text-texte-secondaire">{c.description}');
    expect(lire("src/lib/partage.ts")).toContain("retoursALaLigne(c.description)");
  });
  it("un pointillé à chaque changement de partie, partout où les parties s'affichent", () => {
    expect(SEPARATEUR_PARTIE).toContain("border-dashed");
    for (const f of [
      "src/components/seances/ProgrammeCours.tsx",
      "src/app/(public)/partage/Resume.tsx",
      "src/components/planning/ListeParties.tsx",
      "src/components/planning/ListePartiesTelephone.tsx",
    ]) {
      expect(lire(f), f).toMatch(/i > 0 \? `\$\{SEPARATEUR_PARTIE\}/);
    }
  });
});
