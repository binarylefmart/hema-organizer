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
 * lieu (les liens en cours sont révoqués, donc la carte de remise à zéro disparaît une fois la
 * page rechargée — il n'y a plus rien à effacer).
 */
test("le bouton rend la main dès que le serveur a répondu", async ({ page }) => {
  await connecter(page, COMPTES.admin, "/admin/membres");
  const fiche = await page.getByRole("link", { name: "Charlie 03" }).first().getAttribute("href");
  await page.goto(`${fiche}`);
  page.on("dialog", (d) => d.accept());

  const bouton = page.getByRole("button", { name: "Réinitialiser l'accès" });
  await expect(bouton).toBeVisible();
  await bouton.click();

  // Cinq secondes : le geste tient en une poignée d'écritures ; au-delà, c'est l'attente qui est
  // restée collée, pas le serveur qui travaille.
  await expect(page.getByRole("button", { name: "Réinitialiser l'accès" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: /Un instant/ })).toHaveCount(0);
});
