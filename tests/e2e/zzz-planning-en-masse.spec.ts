import { expect, test, type Page } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Régler plusieurs séances du planning à la fois**, en mode modification.
 *
 * Ce que ce scénario garde :
 *
 * - **éteint, l'interrupteur « Sélection multiple » ne laisse aucune case** sur les cartes ;
 * - allumé, **la case maîtresse nomme sa portée** et **« Sélectionner par jour »** propose un jour par
 *   entrée (« Tous les mardis (N) »…) — choisir une entrée coche ces séances, la choisir de nouveau
 *   (« Retirer les … ») les décoche ;
 * - **« Régler une partie » n'écrit rien** : les cases entrent dans le brouillon, chacune dit
 *   « Modifié — pas encore appliqué », la barre du bas les compte, et **« Annuler » les jette** ;
 * - **« Ajouter dans une partie »** (partie 1, option) part tout de suite ; l'option ajoutée est
 *   retirée depuis sa carte pour rendre le jeu de démonstration tel qu'il était.
 */

const barre = (page: Page) => page.getByRole("group", { name: "Agir sur plusieurs séances à la fois" });

async function choisir(page: Page, liste: string | RegExp, entree: RegExp, dans = page.locator("body")): Promise<void> {
  await dans.getByRole("combobox", { name: liste }).click();
  await page.getByRole("listbox").getByRole("option", { name: entree }).first().click();
}

test("cocher par jour, régler une partie dans le brouillon, puis annuler", async ({ page }) => {
  // Le compte d'administration, qui entre par mot de passe : ce fichier passe après `zz-liens`.
  await connecter(page, COMPTES.admin);
  await page.goto("/planning?modifier=1");
  const interrupteur = page.getByRole("switch", { name: /Sélection multiple/ });
  await expect(interrupteur).toBeVisible();
  await expect(page.getByLabel(/^Sélectionner la séance du/)).toHaveCount(0);

  await interrupteur.check();
  await expect(page.getByText(/^Coche des lignes pour régler une partie/)).toBeVisible();
  await expect(page.getByLabel(/^Sélectionner (les \d+ séances affichées|la séance affichée)$/)).toBeVisible();
  await expect(barre(page)).toHaveCount(0);

  // « Sélectionner par jour » : la première entrée (le premier jour de la semaine présent).
  const parJour = page.getByRole("combobox", { name: "Sélectionner par jour" });
  await expect(parJour).toContainText("Choisir un jour…");
  await parJour.click();
  const entree = page.getByRole("listbox").getByRole("option", { name: /^(Tous les \S+s|Le \S+) \(\d+\)$/ }).first();
  const libelle = (await entree.textContent())!.trim();
  const n = Number(/\((\d+)\)$/.exec(libelle)![1]);
  await entree.click();
  // La liste revient d'elle-même à son entrée vide : elle commande, elle ne mémorise rien.
  await expect(parJour).toContainText("Choisir un jour…");
  await expect(barre(page)).toBeVisible();
  await expect(barre(page).getByText(n === 1 ? "1 séance sélectionnée" : `${n} séances sélectionnées`)).toBeVisible();

  // Choisie de nouveau, l'entrée s'appelle « Retirer … » et décoche ces séances.
  await choisir(page, "Sélectionner par jour", /^Retirer (les|le) /);
  await expect(barre(page)).toHaveCount(0);
  await choisir(page, "Sélectionner par jour", /^(Tous les \S+s|Le \S+) \(\d+\)$/);

  // Régler « Cours » (le cours unique d'une séance au modèle) : un thème libre, rien d'autre.
  await choisir(page, "Que veux-tu faire ?", /^Régler une partie \(/, barre(page));
  await choisir(page, "Partie à régler", /^Cours \(/, barre(page));
  await choisir(page, "Thème", /^Autre…$/, barre(page));
  await barre(page).getByLabel("Thème libre").fill("Thème posé en masse");
  const regler = barre(page).getByRole("button", { name: /^Régler « Cours » sur \d+ séances?$/ });
  await expect(regler).toBeEnabled();
  const poses = Number(/sur (\d+)/.exec((await regler.textContent())!)![1]);
  await regler.click();
  await expect(page.getByText(/réglé sur .*pas encore appliqué/)).toBeVisible();
  await expect(page.getByText("Modifié — pas encore appliqué")).toHaveCount(poses);
  await expect(page.getByText(new RegExp(`^${poses} cases? modifiées?, pas encore appliquées?$`))).toBeVisible();

  // « Annuler » jette le brouillon : rien n'a touché la base.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.waitForURL((url) => !url.search.includes("modifier=1"));
  await expect(page.getByText("Thème posé en masse")).toHaveCount(0);
});

test("ajouter une option dans la partie 1 d'une séance cochée, puis la retirer", async ({ page }) => {
  await connecter(page, COMPTES.admin);
  await page.goto("/planning?modifier=1");
  await page.getByRole("switch", { name: /Sélection multiple/ }).check();
  // La dernière carte cochable affichée, pour ne pas toucher celles que les autres scénarios visent.
  const cases = page.getByLabel(/^Sélectionner la séance du/);
  // La carte de la dernière case : retrouvée depuis la case elle-même (un `filter({ has })` évaluerait
  // `.last()` dans chaque carte, et les désignerait toutes).
  const id = await cases.last().evaluate((el) => el.closest("article")?.id ?? "");
  const carte = page.locator(`article#${id}`);
  // ↑ ↓ Retirer ne se montrent qu'une fois la structure de la carte ouverte (« Modifier »).
  await carte.getByRole("button", { name: "Modifier", exact: true }).click();
  await expect(carte.getByRole("button", { name: "Terminer", exact: true })).toHaveAttribute("aria-pressed", "true");
  const options = carte.getByRole("button", { name: /^Retirer « (Partie 1 · )?Option( \d+)? »$/ });
  const avant = await options.count();
  await cases.last().check();

  await choisir(page, "Que veux-tu faire ?", /^Ajouter dans une partie \(1 séance\)$/, barre(page));
  await choisir(page, "Dans quelle partie", /^Partie 1$/, barre(page));
  await choisir(page, "Ce qu'on ajoute", /^Option$/, barre(page));
  let question = "";
  page.once("dialog", (d) => {
    question = d.message();
    void d.accept();
  });
  await barre(page).getByRole("button", { name: "Ajouter une option dans la partie 1 à 1 séance" }).click();
  await expect(page.getByText("Option ajoutée à 1 séance.")).toBeVisible({ timeout: 30_000 });
  expect(question).toContain("enregistré tout de suite");
  const apres = page.locator(`article#${id}`).getByRole("button", { name: /^Retirer « (Partie 1 · )?Option( \d+)? »$/ });
  await expect(apres).toHaveCount(avant + 1, { timeout: 20_000 });

  // Remise en état : l'option ajoutée est la dernière de sa nature dans la partie.
  page.once("dialog", (d) => void d.accept());
  await apres.last().click();
  await expect(apres).toHaveCount(avant, { timeout: 20_000 });
});
