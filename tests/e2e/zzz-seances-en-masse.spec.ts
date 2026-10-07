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
 * - **au téléphone** (la campagne ne tourne qu'au format « mobile ») : toucher la carte la coche, la
 *   barre sombre du bas porte le compte et « Que faire sur ces 2 séances ? », qui ouvre le volet des
 *   gestes — liste de gros boutons, réglages dans le même volet, bouton qui dit ce qu'il fait ;
 * - **remise en état** : les deux séances annulées sont rétablies par le même geste de masse, pour
 *   que la campagne suivante retrouve le jeu de démonstration.
 */

const barre = (page: Page) => page.getByRole("group", { name: "Agir sur plusieurs séances à la fois" });
const article = (page: Page, id: string) => page.locator("article").filter({ has: page.locator(`[data-geste-seance="${id}"]`) });

const volet = (page: Page) => page.getByRole("dialog", { name: /^Que faire sur / });

/** Ouvre le volet depuis la barre du bas, puis choisit le geste dans sa liste de gros boutons. */
async function choisirGeste(page: Page, n: number, entree: RegExp): Promise<void> {
  await barre(page).getByRole("button", { name: `Que faire sur ces ${n} séances ?` }).click();
  await expect(volet(page)).toBeVisible();
  await volet(page).getByRole("button", { name: entree }).click();
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

  // Éteindre l'interrupteur referme les cases.
  await interrupteur.uncheck();
  await expect(page.getByLabel(/^Sélectionner la séance du/)).toHaveCount(0);
});
