import { expect, test } from "@playwright/test";
import { connecter, deconnecter, COMPTES } from "./helpers";

/** Parcours atelier : proposition (membre, sans champ obligatoire) → placement en un geste (instructeur) → visible sur la carte et dans le planning. */
test("proposition d'atelier → placement dans le planning", async ({ page }) => {
  // Le parcours le plus long de la suite : deux comptes, six écrans, une proposition qui traverse
  // la file de l'équipe puis le planning. Il tient en 50 s à vide, mais frôle la minute quand la
  // suite complète tourne — d'où ce délai propre plutôt qu'un rouge intermittent.
  test.setTimeout(90_000);
  await connecter(page, COMPTES.proposeur);
  await page.goto("/ateliers");
  // Un formulaire vide est refusé gentiment
  await page.getByRole("button", { name: "Envoyer ma proposition" }).click();
  await expect(page.getByText("Écris au moins un titre ou une phrase.")).toBeVisible();
  await page.getByLabel("Titre").fill("Jeu des trois touches");
  await page.getByLabel("En quelques mots").fill("Assauts courts : le premier à trois touches gagne, on tourne toutes les deux minutes.");
  await page.getByLabel("Équipement nécessaire").fill("masques, gants");
  await page.getByRole("button", { name: "Envoyer ma proposition" }).click();
  await page.waitForURL("**/ateliers?propose=ok");
  await expect(page.getByText("Proposition envoyée.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jeu des trois touches" })).toBeVisible();
  await expect(page.getByText("En attente").first()).toBeVisible();
  await deconnecter(page);

  await connecter(page, COMPTES.instructeur);
  await page.goto("/gestion/ateliers");
  const carte = page.locator("section", { hasText: "Jeu des trois touches" }).first();
  await expect(carte).toBeVisible();
  await expect(carte.getByText("masques, gants")).toBeVisible();
  await carte.getByText("Ajouter un mot pour le membre").click();
  await carte.getByLabel(/Commentaire/).fill("Bonne idée, on programme ça vite.");
  /*
   * **On choisit la deuxième séance proposée, pas celle d'office.** La liste de placement part de la
   * prochaine séance *au sens des ateliers* — le cours du soir même en fait partie, on peut encore y
   * caser un jeu à 20 h 05 —, là où le planning ne montre que ce qui n'a pas commencé. Placer sur
   * celle-là faisait donc passer ce test le matin et échouer le soir, pour un atelier pourtant bien
   * rangé en base. La deuxième entrée est un autre jour : elle est visible dans le planning à
   * n'importe quelle heure.
   *
   * On retient son identifiant : c'est la carte du planning (`#seance-<id>`) qu'on ira ouvrir,
   * plutôt qu'un rang dans la grille — une séance n'est pas toujours à la même place.
   */
  const choixSeance = carte.locator('select[name="sessionId"]');
  const sessionId = await choixSeance.locator("option").nth(1).getAttribute("value");
  expect(sessionId, "il faut au moins deux séances à venir pour placer un atelier").toBeTruthy();
  await choixSeance.selectOption(sessionId!);
  await carte.getByRole("button", { name: "Placer dans le planning" }).click();
  // La proposition quitte aussitôt la file « En attente » (la liste est revalidée)
  await expect(page.locator("section", { hasText: "Jeu des trois touches" })).toHaveCount(0, { timeout: 15_000 });
  await page.goto("/gestion/ateliers?statut=PLANIFIE");
  await expect(page.locator("section", { hasText: "Jeu des trois touches" }).first()).toBeVisible();

  /*
   * **Le programme se lit dans le planning, plus sur la carte du cours**. Les tuiles de l'onglet «
   * Séances » ne portent plus thèmes ni options — elles servent à répondre —, et le programme se
   * lit dans le planning, séance par séance.
   */
  await page.goto("/planning");
  // La carte de **cette** séance, désignée par son ancre : le planning a quitté le tableau à quatre
  // colonnes fixes pour une carte par séance (`<article id="seance-…">`) qui liste ses parties
  // (`ListeParties`) — chaque partie est un `<li>`, quel que soit leur nombre.
  const carteSeance = page.locator(`#seance-${sessionId}`);
  await expect(carteSeance).toBeVisible();
  // La case porte l'atelier **et** son animatrice. Le tiret qui les sépare vit dans un `<span>` à lui
  // (précédé d'une espace insécable, typographie française) : aucun élément ne porte la phrase
  // entière, `getByText` ne la trouve donc pas. On filtre sur les deux morceaux, ce qui dit la même
  // chose sans rien supposer du séparateur ni de son balisage.
  const case_ = carteSeance.locator("li").filter({ hasText: "Jeu des trois touches" }).filter({ hasText: "Golf 09" });
  await expect(case_.first()).toBeVisible();
  await deconnecter(page);

  // Le membre voit le statut et le commentaire
  await connecter(page, COMPTES.proposeur);
  await page.goto("/ateliers");
  const mienne = page.locator("section", { hasText: "Jeu des trois touches" }).first();
  await expect(mienne.getByText("Dans le planning", { exact: true })).toBeVisible();
  await expect(mienne.getByText("Bonne idée, on programme ça vite.")).toBeVisible();
  await expect(mienne.getByRole("link", { name: "Modifier" })).toHaveCount(0);
});
