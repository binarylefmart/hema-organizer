import { expect, test, type Page } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Agir sur plusieurs séances à la fois**, depuis l'onglet Séances, par le bouton crayon.
 *
 * Ce que ce scénario garde :
 *
 * - **sélection fermée, aucune case** — les cartes gardent leur allure de lecture ; ouverte, chacune
 *   a sa case et son « Que veux-tu faire ? » au pied ;
 * - **la case maîtresse nomme sa portée** (« Sélectionner les N séances affichées »), jamais « Tout »,
 *   et la phrase d'invite vit sous elle tant que rien n'est coché ;
 * - **la barre n'existe qu'avec une sélection**, et la confirmation d'une annulation annonce
 *   **combien d'annonces partent** — une par séance ;
 * - **au téléphone** (la campagne ne tourne qu'au format « mobile ») : toucher la carte la coche, la
 *   barre du bas porte le compte et « Continuer », qui ouvre le volet des
 *   gestes — liste de gros boutons, réglages dans le même volet, bouton qui dit ce qu'il fait ;
 * - **remise en état** : les deux séances annulées sont rétablies par le même geste de masse, pour
 *   que la campagne suivante retrouve le jeu de démonstration.
 */

const barre = (page: Page) => page.getByRole("group", { name: "Agir sur plusieurs séances à la fois" });
const article = (page: Page, id: string) => page.locator("article").filter({ has: page.locator(`[data-geste-seance="${id}"]`) });

const volet = (page: Page) => page.getByRole("dialog", { name: /séances? sélectionnées?$/ });

/** Ouvre le volet depuis la barre du bas, puis choisit le geste dans sa liste de gros boutons. */
async function choisirGeste(page: Page, n: number, entree: RegExp): Promise<void> {
  await expect(barre(page).getByText(`${n} séances`)).toBeVisible();
  await barre(page).getByRole("button", { name: "Continuer" }).click();
  await expect(volet(page)).toBeVisible();
  await volet(page).getByRole("button", { name: entree }).click();
}

test("annuler puis rétablir deux séances d'un seul geste", async ({ page }) => {
  // Le compte d'administration, qui entre par mot de passe : ce fichier passe après `zz-liens`, qui a
  // régénéré tous les liens personnels de démonstration (celui de l'instructeur ne mène plus nulle part).
  await connecter(page, COMPTES.admin);
  await page.goto("/seances");
  // Le bouton crayon ouvre la sélection ; fermée, aucune case.
  const crayon = page.getByRole("button", { name: "Sélectionner des séances" });
  await expect(crayon).toBeVisible();
  await expect(page.getByLabel(/^Sélectionner la séance du/)).toHaveCount(0);

  await crayon.click();
  await expect(page.getByText("Tout sélectionner")).toBeVisible();
  await expect(page.getByText("Coche des lignes pour agir sur plusieurs séances à la fois.")).toBeVisible();
  await expect(page.getByLabel(/^Sélectionner les \d+ séances affichées$/)).toBeVisible();
  await expect(barre(page)).toHaveCount(0);

  // Deux séances encore annulables parmi les cartes affichées : les dernières, pour ne pas toucher
  // celles que les autres scénarios visent en tête de liste.
  const annulables = page.locator('[data-annulable="true"]');
  const n = await annulables.count();
  expect(n, "le jeu de démonstration affiche au moins deux séances annulables").toBeGreaterThanOrEqual(2);
  const ids = [await annulables.nth(n - 2).getAttribute("data-geste-seance"), await annulables.nth(n - 1).getAttribute("data-geste-seance")] as string[];
  // La première se coche **en touchant sa carte** (sa date), la seconde par sa case : les deux gestes
  // cochent la même case.
  await article(page, ids[0]).getByRole("heading", { level: 2 }).click();
  await expect(article(page, ids[0]).getByLabel(/^Sélectionner la séance du/)).toBeChecked();
  await article(page, ids[1]).getByLabel(/^Sélectionner la séance du/).check();

  await expect(barre(page)).toBeVisible();
  await expect(barre(page).getByText("2 séances sélectionnées")).toBeVisible();
  // Le bouton qui coche ce qui est affiché nomme sa portée — jamais « Tout ».
  await expect(barre(page).getByRole("button", { name: /^Sélectionner les \d+ séances affichées$/ })).toHaveText(/^Les \d+ affichées$/);
  await choisirGeste(page, 2, /^Annuler les séances \(2 séances\)$/);
  await expect(volet(page).getByRole("button", { name: "Retour", exact: true })).toBeVisible();
  await volet(page).getByLabel(/Motif/).fill("Test e2e en masse");
  let question = "";
  page.once("dialog", (d) => {
    question = d.message();
    void d.accept();
  });
  await volet(page).getByRole("button", { name: "Annuler 2 séances" }).click();
  await expect(page.getByText(/2 séances annulées/)).toBeVisible({ timeout: 30_000 });
  expect(question).toContain("2 annonces d'annulation partiront");
  // Le lot est passé : la sélection se vide, la barre et le volet se referment.
  await expect(barre(page)).toHaveCount(0);
  await expect(volet(page)).toHaveCount(0);
  for (const id of ids) await expect(page.locator(`[data-geste-seance="${id}"][data-retablissable="true"]`)).toBeVisible({ timeout: 20_000 });

  // Remise en état, par le geste inverse.
  for (const id of ids) await article(page, id).getByLabel(/^Sélectionner la séance du/).check();
  await choisirGeste(page, 2, /^Rétablir les séances \(2 séances\)$/);
  page.once("dialog", (d) => void d.accept());
  await volet(page).getByRole("button", { name: "Rétablir 2 séances" }).click();
  await expect(page.getByText(/2 séances rétablies/)).toBeVisible({ timeout: 30_000 });
  for (const id of ids) await expect(page.locator(`[data-geste-seance="${id}"][data-annulable="true"]`)).toBeVisible({ timeout: 20_000 });

  // « Terminé » referme les cases.
  await page.getByRole("button", { name: "Terminé" }).click();
  await expect(page.getByLabel(/^Sélectionner la séance du/)).toHaveCount(0);
});
