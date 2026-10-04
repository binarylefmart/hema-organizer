import { describe, expect, it } from "vitest";
import { baseUrl } from "@/lib/env";
import { escapeHtml, renderEmailHtml, renderEmailTexte, type ClubEmail } from "@/lib/email/templates/layout";
import { emailInvitation, emailReset } from "@/lib/email/templates/auth";
import { emailEssai } from "@/lib/email/templates/essai";

/**
 * Le club qui a installé l'outil, tel que le facteur le lit en base avant de rendre l'HTML : un nom
 * quelconque, choisi **différent** du nom livré avec le code, pour qu'un gabarit qui retomberait sur
 * une constante se fasse voir tout de suite.
 */
const CLUB: ClubEmail = { nomClub: "Les Compagnons d'Armes", logo: "/logo.png" };
const NOM_APP = "Compagnons Organizer";

describe("gabarit d'email", () => {
  it("échappe le HTML dans les contenus", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
    const html = renderEmailHtml({ titre: "<script>", paragraphes: ["a<b"], boutons: [{ label: "<x>", url: "https://a.fr/?a=1&b=2" }] }, CLUB);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://a.fr/?a=1&amp;b=2"');
  });

  it("inclut le logo en URL absolue avec texte alternatif et une version texte", () => {
    const { sujet, contenu } = emailInvitation({ prenom: "Chloé", periodeNom: "T4 2026", url: "https://x.fr/invitation/abc", nomApp: NOM_APP });
    const html = renderEmailHtml(contenu, CLUB);
    expect(sujet).toContain("T4 2026");
    expect(html).toContain(`src="${baseUrl()}/logo.png"`);
    /*
     * **Le chemin du logo est échappé comme le reste** : c'était la seule valeur du gabarit à
     * entrer dans un attribut sans passer par `escapeHtml`, alors que le nom du club dans l'`alt`
     * de la même balise l'était. Le chemin est aujourd'hui dérivé, rien ne s'y injecte — mais une
     * exception silencieuse dans un gabarit qui échappe partout ailleurs finit recopiée, et un
     * guillemet fermant ouvrirait un attribut dans un email qui part à tout le club.
     */
    const forge = renderEmailHtml(contenu, { nomClub: "Club", logo: `/x.png" onerror="alert(1)` });
    expect(forge).not.toContain('onerror="alert(1)"');
    expect(forge).toContain("&quot; onerror=&quot;");
    expect(html).toContain(`alt="Les Compagnons d&#39;Armes"`);
    expect(html).toContain("Ouvrir l&#39;application");
    const texte = renderEmailTexte(contenu, CLUB);
    expect(texte).toContain("https://x.fr/invitation/abc");
    expect(texte).not.toContain("<");
  });

  /**
   * Le nom et le logo viennent de l'identité du club, réglable dans l'espace admin : un logo déposé
   * est servi par `/api/affiche/…`, chemin **relatif**, et un email n'a pas de page de référence —
   * c'est le gabarit qui le rend absolu.
   */
  it("nomme le club et sert le logo déposé, sans rien écrire en dur", () => {
    const depose = `/api/affiche/${"a".repeat(64)}.png`;
    const html = renderEmailHtml({ titre: "Bonjour", paragraphes: ["…"] }, { nomClub: "Les Compagnons d'Armes", logo: depose });
    expect(html).toContain(`src="${baseUrl()}${depose}"`);
    expect(html).toContain("Les Compagnons d&#39;Armes");
    const texte = renderEmailTexte({ titre: "Bonjour", paragraphes: ["…"] }, CLUB);
    expect(texte.split("\n")[0]).toBe("Les Compagnons d'Armes");
  });

  it("le mail de réinitialisation mentionne la durée de 30 minutes et le nom de l'application", () => {
    const { contenu } = emailReset({ prenom: "Hugo", url: "https://x.fr/reinitialiser/abc", nomApp: NOM_APP });
    expect(contenu.paragraphes.join(" ")).toContain("30 minutes");
    expect(contenu.paragraphes.join(" ")).toContain(NOM_APP);
  });
});

describe("email d'essai (« tester mes notifications »)", () => {
  it("dit ce qu'il est, et rien d'autre", () => {
    const { sujet, contenu } = emailEssai({ prenom: "Chloé", nomApp: NOM_APP });
    expect(sujet).toContain("Essai");
    expect(sujet).toContain(NOM_APP);
    expect(contenu.titre).toContain("Chloé");
    expect(contenu.paragraphes.join(" ")).toContain("essai");
    // Aucune promesse de cours, aucune date : ce message ne parle que de lui-même
    expect(contenu.paragraphes.join(" ")).not.toMatch(/\d{1,2}h\d{2}/);
  });

  it("emmène vers le réglage des notifications, et prévient qui n'en serait pas l'auteur", () => {
    const { contenu } = emailEssai({ prenom: "Chloé", nomApp: NOM_APP });
    expect(contenu.boutons?.[0].url).toMatch(/\/profil$/);
    expect(contenu.piedDePage?.join(" ")).toContain("administrateur");
  });
});
