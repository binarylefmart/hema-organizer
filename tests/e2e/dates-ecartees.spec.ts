import { expect, test } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Une date décochée ne revient pas — et « Reproposer » la fait revenir.**
 *
 * C'était le trou du geste : l'écran de génération reproposait à chaque visite tout ce que les
 * créneaux donnent et que la période n'a pas encore. Les vacances et les jours fériés décochés la
 * fois d'avant revenaient donc cochés, à redécocher de mémoire — et une séance créée par mégarde un
 * 25 décembre ne se voit qu'après coup. `PeriodDateExclue` les retient désormais en base, et
 * `reproposerDatesExclues` est la porte de sortie, sans laquelle décocher serait sans retour.
 *
 * Le scénario travaille sur **une période à lui**, créée puis effacée : générer des séances dans le
 * trimestre de démonstration déplacerait les listes de toute la campagne. Ses dates sont passées,
 * pour qu'elle ne puisse pas devenir le trimestre proposé par défaut tant qu'elle existe.
 */

/** Un lundi d'il y a quatre mois : le début d'un bloc de quatre semaines pleines. */
function lundiPasse(): string {
  const d = new Date(Date.now() - 120 * 86_400_000);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function plusDeJours(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test("les dates décochées ne sont plus proposées, et « Reproposer » les rend toutes", async ({ page }) => {
  // Créer une période, générer, revenir, reproposer, effacer : cinq allers-retours serveur, dont
  // plusieurs sur des écrans que la campagne n'a pas encore compilés. La minute par défaut suffit
  // à peine.
  test.setTimeout(120_000);
  await connecter(page, COMPTES.admin, "/admin/periodes/nouvelle");
  const debut = lundiPasse();
  const nom = `Période e2e ${Date.now()}`;

  // L'onglet « Période personnalisée » : des dates libres, donc un nombre de candidates connu
  // (quatre semaines pleines = quatre fois chaque créneau hebdomadaire du club).
  await page.getByRole("button", { name: "Période personnalisée" }).click();
  await page.getByLabel("Nom", { exact: true }).fill(nom);
  await page.getByLabel("Début", { exact: true }).fill(debut);
  await page.getByLabel("Fin", { exact: true }).fill(plusDeJours(debut, 27));
  await page.getByRole("button", { name: "Créer la période" }).click();
  // « nouvelle » est une adresse comme une autre pour une expression régulière : on attend la fiche
  // de la période, pas l'écran de création qu'on n'a pas encore quitté.
  await page.waitForURL((u) => /^\/admin\/periodes\/[A-Za-z0-9_-]+$/.test(u.pathname) && !u.pathname.endsWith("/nouvelle"));
  const fiche = page.url();

  const dates = page.locator('input[name="dates"]');
  const total = await dates.count();
  expect(total, "les créneaux du club doivent proposer plusieurs dates").toBeGreaterThan(2);

  // On ne garde que la première : tout le reste est écarté, comme on écarte des vacances.
  for (let i = 1; i < total; i++) await dates.nth(i).uncheck();
  const ecartees = total - 1;
  await expect(page.getByRole("button", { name: `Créer 1 séance et écarter ${ecartees} dates` })).toBeVisible();
  await page.getByRole("button", { name: /^Créer \d+ séance/ }).click();
  await expect(page.getByRole("button", { name: `Reproposer les ${ecartees} dates écartées` })).toBeVisible({ timeout: 20_000 });

  // **Le cœur du test** : on revient sur l'écran, comme on y revient une semaine plus tard. Les
  // dates écartées ne doivent pas être reproposées — avant le correctif, elles étaient toutes là,
  // cochées.
  await page.goto(fiche);
  await expect(page.locator('input[name="dates"]')).toHaveCount(0);
  await expect(page.getByText("Toutes les séances des créneaux sont déjà créées.")).toBeVisible();
  await expect(page.getByRole("button", { name: `Reproposer les ${ecartees} dates écartées` })).toBeVisible();

  // La porte de sortie : elles reviennent toutes, et le bouton n'a plus lieu d'être.
  await page.getByRole("button", { name: `Reproposer les ${ecartees} dates écartées` }).click();
  await expect(page.locator('input[name="dates"]')).toHaveCount(ecartees, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Reproposer/ })).toHaveCount(0);
  // Et c'est bien la base qui s'en souvient, pas l'écran.
  await page.goto(fiche);
  await expect(page.locator('input[name="dates"]')).toHaveCount(ecartees);

  // Ménage : la période d'essai ne survit pas au scénario. En cas d'échec plus haut elle resterait,
  // mais le global-setup de la campagne suivante efface toutes les périodes avant de reseeder.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Supprimer la période" }).click();
  await page.waitForURL(/\/admin\/periodes(\?|$)/, { timeout: 20_000 });
});
