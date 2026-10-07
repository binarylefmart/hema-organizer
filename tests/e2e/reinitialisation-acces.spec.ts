import { expect, test } from "@playwright/test";
import { connecter, COMPTES } from "./helpers";

/**
 * **Remettre l'accès à zéro rend la main.**
 *
 * Le bouton restait sur « Un instant… » alors que le geste était fait et l'email déjà parti :
 * l'attente affichée suivait la transition React, qui comprend le re-rendu déclenché par les
 * `revalidatePath` de l'action. On ne savait plus s'il fallait recliquer — et recliquer, ici,
 * renvoie un second lien.
 *
 * Ce test tient la promesse dans les deux sens : le bouton revient vite, et le geste a bien eu
 * lieu — l'écran le dit, et le choix revient à « Choisir une action… ».
 *
 * Le geste se choisit dans « Que veux-tu faire ? » (la forme commune de l'administration) : au
 * téléphone, dans le volet « ⋯ » de la fiche, où chaque geste est un gros bouton.
 */
test("le bouton rend la main dès que le serveur a répondu", async ({ page }) => {
  await connecter(page, COMPTES.admin, "/admin/membres");
  const fiche = await page.getByRole("link", { name: "Charlie 03" }).first().getAttribute("href");
  await page.goto(`${fiche}`);
  page.on("dialog", (d) => d.accept());

  // Au téléphone, « Que veux-tu faire ? » est rangé derrière « ⋯ » (« Autres gestes ») : le volet du
  // bas liste les gestes en gros boutons, et le geste choisi montre son unique bouton.
  await page.getByRole("button", { name: "Autres gestes" }).click();
  const volet = page.getByRole("dialog");
  await volet.getByRole("button", { name: "Réinitialiser l'accès", exact: true }).click();
  const bouton = volet.getByRole("button", { name: /^Réinitialiser l'accès de / });
  await expect(bouton).toBeVisible();
  await bouton.click();

  // Cinq secondes : le geste tient en une poignée d'écritures ; au-delà, c'est l'attente qui est
  // restée collée, pas le serveur qui travaille.
  await expect(volet.getByText("L'accès est remis à zéro.")).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: /Un instant/ })).toHaveCount(0);
});
