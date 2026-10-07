import { expect, test } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Un volet qui s'ouvre doit tenir dans l'écran du téléphone.**
 *
 * Le, annuler une séance depuis un téléphone ouvrait un panneau dont le bord gauche était à **−60
 * px** : « Motif » et la moitié du bouton « Annuler la séance » étaient hors de l'écran, sans barre
 * de défilement pour aller les chercher. La cause tenait à une seule classe — `absolute right-0`,
 * qui désigne le bord droit du conteneur des boutons et non celui de la fenêtre.
 *
 * Une classe se remet aussi vite qu'elle s'enlève : ce test regarde donc la seule chose qui compte,
 * **les coordonnées réelles du panneau une fois ouvert**.
 * La suite tourne en format Pixel 7 (`playwright.config.ts`), c'est-à-dire exactement le cas qui a
 * cassé.
 */

/** Les mesures d'un panneau ouvert, en pixels de la fenêtre. */
type Mesure = { gauche: number; droite: number; haut: number; bas: number; fenetre: { largeur: number; hauteur: number } };

/** Le panneau est-il entièrement dans la fenêtre ? (1 px de tolérance : les arrondis de rendu.) */
function verifierDansLaFenetre(m: Mesure) {
  expect(m.gauche, "le panneau sort à gauche de l'écran").toBeGreaterThanOrEqual(-1);
  expect(m.droite, "le panneau sort à droite de l'écran").toBeLessThanOrEqual(m.fenetre.largeur + 1);
  expect(m.haut, "le panneau sort en haut de l'écran").toBeGreaterThanOrEqual(-1);
  expect(m.bas, "le panneau sort en bas de l'écran").toBeLessThanOrEqual(m.fenetre.hauteur + 1);
}

/*
 * Le volet d'annulation d'une séance n'existe plus : annuler se choisit dans
 * « Que veux-tu faire ? », au pied de la carte, en mode modification — le motif s'y saisit dans le
 * flux de la carte, sans panneau flottant. Reste le volet de l'annuaire.
 */

/**
 * **Gérer un membre, au téléphone : le volet « ⋯ » de sa fiche.** Le volet « Gérer » de chaque ligne
 * de l'annuaire (`groupe="membre"`) ne se montre plus sous 768 px : la ligne entière mène à la fiche,
 * et c'est la fiche qui range l'adresse, le bureau et « Que veux-tu faire ? » derrière « ⋯ », dans un
 * volet du bas (`VoletBas`). Ce qui est en jeu n'a pas changé d'un mot : sur un téléphone, ce panneau
 * doit tenir dans la fenêtre, **bouton d'envoi compris**.
 */
test("gérer un membre : le volet tient dans l'écran", async ({ page }) => {
  await connecter(page, COMPTES.admin, "/admin/membres");
  // Plus de « Gérer » sur les lignes au téléphone : le volet de l'ordinateur est là, mais caché.
  await expect(page.locator('details[name="membre"] > summary').filter({ hasText: "Gérer" }).filter({ visible: true })).toHaveCount(0);
  const lignes = page.locator("tbody tr").filter({ has: page.locator('a[href^="/admin/membres/"]') });
  const nombre = await lignes.count();
  expect(nombre, "aucun membre dans l'annuaire").toBeGreaterThan(0);

  for (const rang of [0, nombre - 1]) {
    await page.goto("/admin/membres");
    const ligne = lignes.nth(rang);
    await ligne.scrollIntoViewIfNeeded();
    // Toute la ligne mène à la fiche : on la touche à son bout droit (le chevron), pas sur le nom.
    const href = await ligne.locator('a[href^="/admin/membres/"]').first().getAttribute("href");
    const boite = (await ligne.boundingBox())!;
    await ligne.click({ position: { x: boite.width - 24, y: boite.height / 2 } });
    await page.waitForURL(`**${href}`);
    await page.getByRole("button", { name: "Autres gestes" }).click();
    const volet = page.getByRole("dialog");
    await expect(volet).toBeVisible();
    await volet.getByRole("button", { name: "Modifier le nom ou l'email" }).click();
    const m: Mesure = await volet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { gauche: r.left, droite: r.right, haut: r.top, bas: r.bottom, fenetre: { largeur: innerWidth, hauteur: innerHeight } };
    });
    verifierDansLaFenetre(m);
    const envoi = volet.getByRole("button", { name: "Enregistrer", exact: true });
    await envoi.scrollIntoViewIfNeeded();
    await expect(envoi).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(volet).toHaveCount(0);
  }
});
