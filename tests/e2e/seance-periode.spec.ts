import { expect, test } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Le trimestre d'une séance se choisit à la création, et plus après**.
 *
 * La liste déroulante « Période » était offerte aussi en modification. Déplacer une séance d'un
 * trimestre à l'autre emportait avec elle les réponses de gens qui ne sont pas invités dans celui
 * d'arrivée : le numérateur des taux comptait des personnes absentes du dénominateur — exactement
 * la maladie soignée le même jour du côté du retrait d'un membre. L'action serveur refuse
 * désormais le changement, et l'écran ne propose plus le geste.
 *
 * Le test regarde les deux écrans du même formulaire : à la création, la liste est là ; en
 * modification, elle a disparu **sans** que la période cesse d'être lisible ni d'être envoyée
 * (champ caché) — un formulaire qui perdrait la période ne vaudrait pas mieux.
 */

test("la période se choisit à la création d'une séance, et ne se change plus ensuite", async ({ page }) => {
  // Les deux écrans visés — la création d'une séance et sa fiche — montent le formulaire *et* le
  // programme du cours : ce sont deux des pages les plus lourdes à compiler, et la minute par
  // défaut n'y suffit pas quand la campagne les rencontre pour la première fois.
  test.setTimeout(120_000);
  // Le compte d'administration plutôt qu'un instructeur : il entre par mot de passe, là où le lien
  // personnel de Charlie 03 a été révoqué un peu plus tôt dans la campagne
  // (`reinitialisation-acces`, qui passe juste avant ce fichier). Même précaution que `volet.spec.ts`.
  await connecter(page, COMPTES.admin, "/seances/nouvelle");
  // La liste du dépôt (`ChampListe`) : un déclencheur nommé « Période », la valeur dans un champ caché.
  const liste = page.getByRole("combobox", { name: "Période" });
  await expect(liste, "à la création, le trimestre se choisit").toHaveCount(1);
  await expect(liste).toBeEnabled();

  // La liste s'ouvre en lecture seule : la fiche s'ouvre en modification depuis « Que veux-tu faire ? ».
  await page.goto("/seances?modifier=1");
  const gestes = page.locator("[data-geste-seance]").first();
  await gestes.getByRole("combobox", { name: "Que veux-tu faire ?" }).click();
  await page.getByRole("option", { name: "Modifier la séance" }).click();
  await gestes.getByRole("button", { name: "Ouvrir la séance" }).click();
  await page.waitForURL(/\/seances\/[A-Za-z0-9_-]+\?modifier=1$/);

  const formulaire = page.locator("form").filter({ has: page.locator('[name="periodId"]') });
  await expect(page.getByRole("combobox", { name: "Période" }), "en modification, plus de liste déroulante").toHaveCount(0);
  // La période reste lue à l'écran, et repart avec le formulaire : rien n'est perdu, seul le geste l'est.
  await expect(formulaire.locator('input[type="hidden"][name="periodId"]')).toHaveCount(1);
  await expect(formulaire.getByText("Rentrée 2026")).toBeVisible();
});
