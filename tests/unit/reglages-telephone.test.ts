import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dateEvenementCourte, horaireEvenementCourt, libellePrix } from "@/components/evenements/libelles";
import { idsRangeesNotification, resumeCanaux, STYLE_LIGNES_NOTIFICATION } from "@/app/(app)/admin/notifications/ligne-notification";

/**
 * **Quatre écrans resserrés au téléphone, en version téléphone seulement** : le fil des événements, « Mon
 * profil », la liste des périodes et la matrice des notifications. Ce fichier garde ce qui ne se
 * voit pas sur une capture — que les formulaires postent exactement ce qu'ils postaient, que les
 * ancres ouvrent leur ligne, et que les mots courts disent la même chose que les longs.
 */

const RACINE = process.cwd();
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");
const sansCommentaires = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("la carte resserrée d'un événement", () => {
  it("dit la date en court, l'année seulement quand ce n'est pas celle d'aujourd'hui", () => {
    expect(dateEvenementCourte("2026-10-26", null, "2026-10-07")).toBe("Lun. 26 oct.");
    expect(dateEvenementCourte("2026-10-26", "2026-10-26", "2026-10-07")).toBe("Lun. 26 oct.");
    expect(dateEvenementCourte("2026-11-16", "2026-11-17", "2026-10-07")).toBe("16–17 nov.");
    expect(dateEvenementCourte("2026-10-30", "2026-11-02", "2026-10-07")).toBe("30 oct. – 2 nov.");
    expect(dateEvenementCourte("2025-06-14", null, "2026-10-07")).toBe("Sam. 14 juin 2025");
  });

  it("dit l'horaire en court, et rien quand il n'est pas connu", () => {
    expect(horaireEvenementCourt("10:00", "17:30")).toBe("10h00–17h30");
    expect(horaireEvenementCourt("14:00", null)).toBe("Dès 14h00");
    expect(horaireEvenementCourt(null, "17:00")).toBe("Jusqu'à 17h00");
    expect(horaireEvenementCourt(null, null)).toBeNull();
  });

  it("garde la règle du tarif : seul « pour les » tombe", () => {
    expect(libellePrix("45 €", "35 €", { court: true })).toBe("45 € · 35 € adhérents");
    expect(libellePrix("45 €", "35 €")).toBe("45 € · 35 € pour les adhérents");
    expect(libellePrix("", "35 €", { court: true })).toBe("Gratuit");
  });

  it("ne touche pas la fiche : seule la carte du fil réduit l'affiche", () => {
    expect(lire("src/components/evenements/CarteEvenement.tsx")).toContain("<BandeauEvenement src={e.imageUrl} nom={e.nom} ecu={club.ecu} resserre />");
    expect(lire("src/app/(app)/evenements/[id]/page.tsx")).not.toContain("resserre");
  });
});

describe("« Mon profil » en liste groupée", () => {
  const PAGE = "src/app/(app)/profil/page.tsx";
  const LISTE = "src/components/ui/ListeGroupee.tsx";

  it("range chaque carte de réglages dans une ligne qui porte son ancre", () => {
    const page = lire(PAGE);
    for (const ancre of ["informations", "appareil", "mes-notifications", "apparence", "lien", "securite"]) {
      expect(page, `#${ancre} n'a pas sa ligne`).toContain(`<LigneDepliable ancre="${ancre}"`);
    }
    // L'élévation reste une porte au-dessus de la liste, jamais une ligne repliée.
    expect(page).not.toContain('<LigneDepliable ancre="acces-admin"');
    expect(page.indexOf('<Carte id="acces-admin"')).toBeLessThan(page.indexOf("<ListeGroupee"));
  });

  it("cache une carte repliée sans la démonter, et seulement au téléphone", () => {
    const code = sansCommentaires(lire(LISTE));
    expect(code).toContain('className={ouvert ? "tel:px-2 tel:pb-2" : "tel:hidden"}');
    expect(code).toMatch(/aria-expanded=\{ouvert\}/);
    expect(code).toContain("ordi:hidden");
    expect(code).toContain("ordi:contents");
  });

  it("ouvre la ligne visée par l'ancre, à l'arrivée comme en cours de route", () => {
    const code = sansCommentaires(lire(LISTE));
    expect(code).toContain('closest<HTMLElement>("[data-ligne-depliable]")');
    expect(code).toContain('addEventListener("hashchange"');
    // Les liens internes de Next changent l'ancre sans `hashchange`.
    expect(code).toContain('addEventListener("click"');
  });
});

describe("la matrice des notifications au téléphone", () => {
  const MATRICE = "src/app/(app)/admin/notifications/MatriceNotifications.tsx";
  const LIGNE = "src/app/(app)/admin/notifications/LigneNotification.tsx";

  it("résume les canaux cochés en un mot, ou en leurs noms", () => {
    expect(resumeCanaux([], 3)).toBe("Aucun");
    expect(resumeCanaux(["Email", "Discord", "Telegram"], 3)).toBe("Tous");
    expect(resumeCanaux(["Email", "Discord"], 3)).toBe("Email\u00a0· Discord");
    expect(resumeCanaux(["Email", "Téléphone", "Discord", "Telegram"], 6)).toBe("4\u00a0canaux");
    // Un seul canal concerné : son nom dit plus que « Tous ».
    expect(resumeCanaux(["Email"], 1)).toBe("Email");
  });

  it("cache les rangées repliées sans les démonter : elles restent dans le formulaire", () => {
    // Une règle CSS, et seulement en version téléphone : le DOM — donc ce que le formulaire poste — est le même.
    expect(STYLE_LIGNES_NOTIFICATION).toContain("@media (width < 48rem), (pointer: coarse)");
    expect(STYLE_LIGNES_NOTIFICATION).toContain("tbody[data-replie] > tr:not(:first-child) { display: none; }");
    const ligne = sansCommentaires(lire(LIGNE));
    expect(ligne).toContain('data-replie={ouvert ? undefined : ""}');
    expect(ligne).toContain("{children}");
    // Le bouton qui déplie ne poste rien.
    expect(ligne).not.toMatch(/\bname=/);
  });

  it("n'écrit les champs qu'une fois : aucun second rendu de la matrice pour le téléphone", () => {
    const matrice = sansCommentaires(lire(MATRICE));
    expect(matrice.match(/champNotification\(/g) ?? []).toHaveLength(1);
    expect(matrice.match(/<CaseCouple/g) ?? []).toHaveLength(1);
    expect(matrice.match(/<LigneNotification/g) ?? []).toHaveLength(1);
    expect(sansCommentaires(lire(LIGNE))).not.toMatch(/champNotification|champMode|CaseCouple/);
  });

  it("le bouton nomme les deux rangées qu'il déplie", () => {
    const [cases, mode] = idsRangeesNotification("recap_veille");
    const matrice = lire(MATRICE);
    expect(cases).not.toBe(mode);
    expect(matrice).toContain("id={idCases}");
    expect(matrice).toContain("id={idMode}");
    expect(lire(LIGNE)).toContain("aria-controls={`${idCases} ${idMode}`}");
  });
});

describe("la liste des périodes au téléphone", () => {
  it("une ligne par période, qui mène à sa page ; le tableau d'hier sur ordinateur", () => {
    const page = sansCommentaires(lire("src/app/(app)/admin/periodes/page.tsx"));
    expect(page).toContain('<div className="flex flex-col gap-5 ordi:hidden" data-liste-periodes>');
    expect(page).toContain("<LigneLien");
    expect(page).toContain("href={`/admin/periodes/${p.id}`}");
    expect(page).toContain('<Carte className="hidden ordi:block">');
    expect(page).toContain('<LienBouton href="/admin/periodes/nouvelle">Nouvelle période</LienBouton>');
  });
});
