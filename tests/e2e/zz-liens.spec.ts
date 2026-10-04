import { expect, test } from "@playwright/test";
import { COMPTES, connecter, demoLien } from "./helpers";

/**
 * Ce fichier passe en dernier (préfixe « zz ») : il régénère tous les liens d'accès,
 * ce qui invaliderait les jetons fixes utilisés par les autres tests.
 */
test("renvoyer les liens à tous les membres d'une période", async ({ page }) => {
  /*
   * **Deux minutes, et ce n'est pas du confort**. Ce test enchaîne une connexion d'administrateur
   * avec élévation (deux codes), l'ouverture de l'annuaire — l'écran le plus lourd de
   * l'application, 8 à 9 s en développement —, la régénération des liens de **tout** le club avec
   * l'email qui part pour chacun, puis deux pages de plus. Les soixante secondes par défaut étaient
   * déjà consommées avant le dernier clic, et l'échec se lisait alors sur l'étape en cours — un
   * bouton « Se déconnecter » pourtant bien présent dans la capture d'échec, ce qui envoie chercher
   * un défaut d'écran là où il n'y a qu'un budget épuisé.
   */
  test.setTimeout(120_000);
  await connecter(page, COMPTES.admin);
  await page.goto("/admin/membres");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Renvoyer les liens/ }).first().click();
  // Les liens sont régénérés : les anciens ne fonctionnent plus
  await expect(page.getByRole("button", { name: /Renvoyer les liens/ }).first()).toBeEnabled({ timeout: 20_000 });
  await page.goto("/profil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  /*
   * **Attendre que la déconnexion ait atterri avant de naviguer ailleurs**. « Se déconnecter »
   * déclenche sa propre navigation vers `/connexion` ; un `goto` lancé dans la foulée entre en
   * concurrence avec elle et le perdant rend `net::ERR_ABORTED; maybe frame was detached?`. Le test
   * ne dépendait donc que de la vitesse du serveur — et il a fini par perdre la course.
   */
  await page.waitForURL("**/connexion");
  await page.goto(`/invitation/${demoLien(COMPTES.membre)}`);
  await expect(page.getByText(/Ce lien a été annulé/)).toBeVisible();
});
