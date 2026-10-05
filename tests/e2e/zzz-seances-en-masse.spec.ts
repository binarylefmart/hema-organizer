import { expect, test, type Page } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Agir sur plusieurs séances à la fois**, depuis l'onglet Séances en mode modification.
 *
 * Ce que ce scénario garde :
 *
 * - **éteint, l'interrupteur « Sélection multiple » ne laisse aucune case** — les cartes gardent
 *   leur allure, chacune son « Que veux-tu faire ? » au pied ;
 * - **la case maîtresse nomme sa portée** (« Sélectionner les N séances affichées »), jamais « Tout »,
 *   et la phrase d'invite vit sous elle tant que rien n'est coché ;
 * - **la barre n'existe qu'avec une sélection**, et la confirmation d'une annulation annonce
 *   **combien d'annonces partent** — une par séance ;
 * - **remise en état** : les deux séances annulées sont rétablies par le même geste de masse, pour
 *   que la campagne suivante retrouve le jeu de démonstration.
 */

const barre = (page: Page) => page.getByRole("group", { name: "Agir sur plusieurs séances à la fois" });
const article = (page: Page, id: string) => page.locator("article").filter({ has: page.locator(`[data-geste-seance="${id}"]`) });

async function choisirGeste(page: Page, entree: RegExp): Promise<void> {
  await barre(page).getByRole("combobox", { name: "Que veux-tu faire ?" }).click();
  await page.getByRole("listbox").getByRole("option", { name: entree }).click();
}

test("annuler puis rétablir deux séances d'un seul geste", async ({ page }) => {
  // Le compte d'administration, qui entre par mot de passe : ce fichier passe après `zz-liens`, qui a
  // régénéré tous les liens personnels de démonstration (celui de l'instructeur ne mène plus nulle part).
  await connecter(page, COMPTES.admin);
  await page.goto("/seances?modifier=1");
  const interrupteur = page.getByRole("switch", { name: /Sélection multiple/ });
  await expect(interrupteur).toBeVisible();
  await expect(page.getByLabel(/^Sélectionner la séance du/)).toHaveCount(0);

  await interrupteur.check();
  await expect(page.getByText("Coche des lignes pour agir sur plusieurs séances à la fois.")).toBeVisible();
  await expect(page.getByLabel(/^Sélectionner les \d+ séances affichées$/)).toBeVisible();
  await expect(page.getByText(/Sélectionner tout/)).toHaveCount(0);
  await expect(barre(page)).toHaveCount(0);

  // Deux séances encore annulables parmi les cartes affichées : les dernières, pour ne pas toucher
  // celles que les autres scénarios visent en tête de liste.
  const annulables = page.locator('[data-annulable="true"]');
  const n = await annulables.count();
  expect(n, "le jeu de démonstration affiche au moins deux séances annulables").toBeGreaterThanOrEqual(2);
  const ids = [await annulables.nth(n - 2).getAttribute("data-geste-seance"), await annulables.nth(n - 1).getAttribute("data-geste-seance")] as string[];
  for (const id of ids) await article(page, id).getByLabel(/^Sélectionner la séance du/).check();

  await expect(barre(page)).toBeVisible();
  await expect(barre(page).getByText("2 séances sélectionnées")).toBeVisible();
  await choisirGeste(page, /^Annuler les séances \(2 séances\)$/);
  await barre(page).getByLabel(/Motif/).fill("Test e2e en masse");
  let question = "";
  page.once("dialog", (d) => {
    question = d.message();
    void d.accept();
  });
  await barre(page).getByRole("button", { name: "Annuler 2 séances" }).click();
  await expect(page.getByText(/2 séances annulées/)).toBeVisible({ timeout: 30_000 });
  expect(question).toContain("2 annonces d'annulation partiront");
  await expect(barre(page)).toHaveCount(0);
  for (const id of ids) await expect(page.locator(`[data-geste-seance="${id}"][data-retablissable="true"]`)).toBeVisible({ timeout: 20_000 });

  // Remise en état, par le geste inverse.
  for (const id of ids) await article(page, id).getByLabel(/^Sélectionner la séance du/).check();
  await choisirGeste(page, /^Rétablir les séances \(2 séances\)$/);
  page.once("dialog", (d) => void d.accept());
  await barre(page).getByRole("button", { name: "Rétablir 2 séances" }).click();
  await expect(page.getByText(/2 séances rétablies/)).toBeVisible({ timeout: 30_000 });
  for (const id of ids) await expect(page.locator(`[data-geste-seance="${id}"][data-annulable="true"]`)).toBeVisible({ timeout: 20_000 });

  // Éteindre l'interrupteur referme les cases.
  await interrupteur.uncheck();
  await expect(page.getByLabel(/^Sélectionner la séance du/)).toHaveCount(0);
});
