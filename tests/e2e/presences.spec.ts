import { expect, test } from "@playwright/test";
import { connecter, COMPTES } from "./helpers";

/**
 * Séances annulées et historique personnel.
 *
 * La liste des cours et ses trois boutons de réponse vivent sur `/seances` depuis que l'accueil
 * est devenu un compte rendu sans action : chaque test part donc de cet onglet-là.
 */
test.beforeEach(async ({ page }) => {
  await connecter(page, COMPTES.membre);
  await page.goto("/seances");
});

test("une séance annulée est signalée, avec son motif, sans boutons de réponse", async ({ page }) => {
  const annulee = page.getByRole("article").filter({ hasText: "Annulée" }).first();
  await expect(annulee).toBeVisible();
  await expect(annulee.getByText(/Motif :/)).toBeVisible();
  await expect(annulee.getByRole("button", { name: "Présent" })).toHaveCount(0);
});

test("le volet « Mon historique » de l'onglet Séances affiche toutes les périodes avec un taux", async ({ page }) => {
  await page.getByRole("link", { name: "Historique" }).first().click();
  await page.waitForURL("**/seances?vue=historique");
  await expect(page.getByRole("heading", { name: "Mon historique" })).toBeVisible();
  const periodes = page.getByRole("main").locator("section:has(> header)");
  await expect(periodes).toHaveCount(1); // la période en cours (« Rentrée 2026 »)
  await expect(periodes.first().getByText(/\d+\s%\s·\s\d+\sprésences? sur \d+ cours/)).toBeVisible();
  // La liste nominative est visible pour tous
  await periodes.first().getByText(/Qui était là \?/).first().click();
  await expect(periodes.first().getByText(/Présents\s·\s\d+/).first()).toBeVisible();
});

/**
 * **Le programme a quitté les tuiles, ce bouton doit vraiment mener quelque part.**
 *
 * Retiré des cartes, le programme se lit désormais dans le planning — à condition que le lien
 * tombe sur la bonne séance. Deux choses peuvent le faire échouer en silence, et c'est ce qu'on
 * vérifie ici : la séance peut appartenir à un autre trimestre que celui affiché par défaut (d'où
 * `?periode=`), et le planning ne montre que l'avenir tant qu'on ne lui dit rien. Une ancre qui ne
 * désigne rien ne se voit pas : la page s'ouvre, simplement elle ne bouge pas.
 */
test("le bouton « Programme de la séance » ouvre le planning sur cette séance", async ({ page }) => {
  await connecter(page, COMPTES.membre, "/seances");

  // La **dernière** carte visible, et non la première : la séance la plus proche occupe déjà le haut
  // du planning, si bien qu'un test posé sur elle passerait au vert même sans défilement du tout.
  //
  // Sur téléphone, la carte resserrée remplace le bouton plein par un lien court « Programme › »
  // (le bouton existe encore, caché : il n'est pas dans l'arbre d'accessibilité). Même adresse,
  // même ancre : c'est la même promesse, on la vérifie sur le geste qu'on a sous le doigt.
  const telephone = (page.viewportSize()?.width ?? 1280) < 768;
  const bouton = page.getByRole("link", { name: telephone ? "Programme" : "Programme de la séance", exact: true }).last();
  await expect(bouton).toBeVisible();
  const href = await bouton.getAttribute("href");
  const ancre = href?.split("#")[1];
  expect(ancre).toMatch(/^seance-/);

  await bouton.click();
  /*
   * `waitForURL` et non `expect(page).toHaveURL` : cette assertion n'a que cinq secondes, or
   * `/planning` est **compilé à la demande** par `next dev`. Quand ce fichier tourne seul, aucun
   * test ne l'a encore ouvert : la compilation prend à elle seule près de cinq secondes, la
   * navigation douce est abandonnée en cours de route et la page reste sur `/seances`. L'attente de
   * navigation, elle, dispose du budget du scénario — le même choix que partout ailleurs dans la
   * suite. Rien à voir avec l'écran : le lien porte la bonne adresse, il est simplement plus lent
   * que l'assertion à froid.
   */
  await page.waitForURL(/\/planning\?periode=/);
  // L'ancre existe **dans la page**…
  const cible = page.locator(`#${ancre}`);
  await expect(cible).toHaveCount(1);
  /*
   * …et on y est vraiment. C'est la moitié qui manquait : l'ancre était bien là, mais la grille
   * arrive dans un `<Suspense>`, donc **après** la navigation — le navigateur cherchait l'ancre
   * dans un squelette, ne la trouvait pas, et ne réessayait jamais. On atterrissait en haut du
   * planning. `AllerALAncre`, monté avec la grille, fait le défilement que le navigateur n'a pas pu
   * faire ; sans cette assertion, le test repasserait au vert le jour où il retomberait en panne.
   */
  await expect(cible).toBeInViewport();
});
