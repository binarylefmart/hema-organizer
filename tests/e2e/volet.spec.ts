import { expect, test, type Locator, type Page } from "@playwright/test";
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
 * **les coordonnées réelles du panneau une fois ouvert**, sur les deux écrans qui emploient `Volet`.
 * La suite tourne en format Pixel 7 (`playwright.config.ts`), c'est-à-dire exactement le cas qui a
 * cassé.
 */

/** Ouvre le volet et rend les mesures du panneau, en pixels de la fenêtre. */
async function ouvrirEtMesurer(page: Page, declencheur: Locator) {
  await declencheur.scrollIntoViewIfNeeded();
  // Clic dispatché sur l'élément : la barre de navigation fixe du bas recouvre parfois le bouton
  // visé sur téléphone, et un vrai clic partirait dans le menu.
  await declencheur.evaluate((el: HTMLElement) => el.click());
  const panneau = page.locator("details[open] [data-panneau]");
  await expect(panneau).toBeVisible();
  return panneau.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { gauche: r.left, droite: r.right, haut: r.top, bas: r.bottom, fenetre: { largeur: innerWidth, hauteur: innerHeight } };
  });
}

/** Le panneau est-il entièrement dans la fenêtre ? (1 px de tolérance : les arrondis de rendu.) */
function verifierDansLaFenetre(m: Awaited<ReturnType<typeof ouvrirEtMesurer>>) {
  expect(m.gauche, "le panneau sort à gauche de l'écran").toBeGreaterThanOrEqual(-1);
  expect(m.droite, "le panneau sort à droite de l'écran").toBeLessThanOrEqual(m.fenetre.largeur + 1);
  expect(m.haut, "le panneau sort en haut de l'écran").toBeGreaterThanOrEqual(-1);
  expect(m.bas, "le panneau sort en bas de l'écran").toBeLessThanOrEqual(m.fenetre.hauteur + 1);
}

test("annuler une séance : le volet tient dans l'écran, bouton d'envoi compris", async ({ page }) => {
  // Le compte d'administration plutôt qu'un instructeur : il entre par mot de passe, là où les liens
  // personnels des autres comptes ont pu être régénérés par un scénario précédent de la suite.
  await connecter(page, COMPTES.admin, "/seances");
  const declencheurs = page.locator('details[name="annuler-seance"] > summary');
  const nombre = await declencheurs.count();
  expect(nombre, "aucune séance annulable dans le jeu de démonstration").toBeGreaterThan(0);

  // La première carte et la dernière : c'est en bas de page que le panneau débordait aussi.
  for (const rang of [0, nombre - 1]) {
    verifierDansLaFenetre(await ouvrirEtMesurer(page, declencheurs.nth(rang)));
    await expect(page.getByRole("button", { name: "Annuler la séance" })).toBeInViewport();
    await page.keyboard.press("Escape");
  }
});

/**
 * Le second volet de l'annuaire est celui de **« Gérer »** (`groupe="membre"`) : le panneau qui
 * rassemble le rôle, l'adresse, le lien personnel et l'activation d'une personne. Il s'appelait
 * « email-membre » et ne portait que l'adresse ; le nom du groupe a suivi l'écran. Ce qui est en jeu
 * n'a pas changé d'un mot : sur un téléphone, ce panneau doit tenir dans la fenêtre, **bouton
 * d'envoi compris**.
 */
test("gérer un membre : le volet tient dans l'écran", async ({ page }) => {
  await connecter(page, COMPTES.admin, "/admin/membres");
  const declencheurs = page.locator('details[name="membre"] > summary');
  const nombre = await declencheurs.count();
  expect(nombre, "aucun membre sur lequel l'annuaire propose un geste").toBeGreaterThan(0);

  for (const rang of [0, nombre - 1]) {
    verifierDansLaFenetre(await ouvrirEtMesurer(page, declencheurs.nth(rang)));
    // Le libellé suit l'état de la personne : « Enregistrer l'email » si elle en a une,
    // « Ajouter son email » sinon — l'un ou l'autre, jamais les deux.
    await expect(page.getByRole("button", { name: /^(Enregistrer l'email|Ajouter son email)$/ }).first()).toBeInViewport();
    await page.keyboard.press("Escape");
  }
});
