import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Une liste de personnes se découvre vingt par vingt**.
 *
 * Le repli dépliait d'un seul appui **tout** ce qu'il cachait : « Afficher les 60 autres »
 * échangeait un écran trop court contre soixante lignes d'un coup, et l'on ne savait plus où l'on
 * en était — sur l'écran même où l'on coche des noms. La règle est désormais : une tranche de vingt
 * par appui, le bouton **annonce ce qu'il va montrer**, un compteur dit où l'on en est, et
 * « Replier » ramène à la première tranche.
 *
 * **Pourquoi ce fichier reseme la base.** L'invariant du dossier est qu'un club de douze ne voit
 * **aucun** bouton, aucun compteur, aucune différence : le jeu de démonstration ordinaire ne peut
 * donc pas montrer le dévoilement — c'est justement ce qu'on lui demande. On charge le jeu
 * « grand club » (quatre-vingts comptes, `SEED_DEMO_TAILLE=grand`), on regarde, puis on remet le jeu
 * ordinaire. Les douze personnes du club et leurs jetons d'accès sont les mêmes dans les deux jeux —
 * le grand les garde en tête de liste et ajoute les siennes **à la suite** —, si bien que le retour
 * en arrière est complet (le seed efface les comptes qu'il ne décrit pas).
 *
 * D'où le préfixe `zzzz` : c'est le dernier fichier de la campagne. Rien ne doit hériter d'un club
 * de quatre-vingts, et la remise en place se fait dans `afterAll` plutôt que d'être laissée au
 * `globalSetup` de la campagne suivante.
 *
 * L'écran choisi est `/admin/presences` : c'était **le dernier** à déplier tout d'un coup, et c'est
 * celui où le repli croise la sélection en masse — la case maîtresse ne prend que les vingt lignes
 * affichées, et le dit.
 */

function semer(taille?: "grand"): void {
  execSync("npm run db:seed:demo", {
    stdio: "inherit",
    env: { ...process.env, SEED_DEMO_RESET_ADMIN: "1", ...(taille ? { SEED_DEMO_TAILLE: taille } : {}) },
  });
}

test.beforeAll(() => semer("grand"));
// Remise en place : la base doit repartir telle que le `globalSetup` l'écrit.
test.afterAll(() => semer());

test("une longue liste de personnes se dévoile vingt par vingt, avec son compteur", async ({ page }) => {
  // Reseme + première compilation de l'écran avec quatre-vingts lignes.
  test.setTimeout(180_000);
  await connecter(page, COMPTES.admin, "/admin/presences");

  const poignee = page.getByText(/^Modifier les réponses \(\d+\)$/);
  await expect(poignee).toBeVisible();
  const total = Number((await poignee.innerText()).match(/\((\d+)\)/)?.[1] ?? "0");
  expect(total, "le jeu « grand club » invite bien plus de vingt personnes").toBeGreaterThan(20);

  // Une ligne = une liste de réponse (`ListeDeroulante`, un bouton `combobox`, plus un `<select>`).
  const lignes = page.locator('button[role="combobox"][id^="presence-"]');
  const compteur = page.getByText(new RegExp(`^\\d+ sur ${total}$`));

  // ---- À l'ouverture : vingt lignes, un compteur, et un bouton qui annonce la tranche suivante.
  await expect(lignes).toHaveCount(20);
  await expect(compteur).toHaveText(`20 sur ${total}`);
  // « Replier » n'existe pas avant le premier appui : il n'y a rien à replier.
  await expect(page.getByRole("button", { name: "Replier" })).toHaveCount(0);

  // Le bouton annonce **ce qu'il va montrer**, et pas « voir plus » : vingt, ou ce qu'il reste.
  const attendu1 = Math.min(20, total - 20);
  const suivantes = page.getByRole("button", { name: `Afficher les ${attendu1} suivantes` });
  await expect(suivantes).toBeVisible();

  // ---- Un appui : une tranche de plus, pas tout le reste.
  await suivantes.click();
  await expect(lignes).toHaveCount(20 + attendu1);
  await expect(compteur).toHaveText(`${20 + attendu1} sur ${total}`);
  await expect(page.getByRole("button", { name: "Replier" })).toBeVisible();

  // ---- « Replier » ramène à la **première** tranche, et non à la précédente.
  await page.getByRole("button", { name: "Replier" }).click();
  await expect(lignes).toHaveCount(20);
  await expect(compteur).toHaveText(`20 sur ${total}`);
  await expect(page.getByRole("button", { name: "Replier" })).toHaveCount(0);

  /*
   * ---- Le croisement du repli et de la sélection en masse, qui est le vrai piège de cet écran.
   *
   * La case maîtresse ne prend que **les vingt lignes affichées**, et son libellé le dit : « Tout »
   * serait faux dans un sens ou dans l'autre. Ce qui reste dehors est compté et dit, et un second
   * bouton propose le geste qu'on voulait vraiment faire.
   */
  // Les cases n'apparaissent qu'interrupteur « Sélection multiple » allumé.
  await page.getByRole("switch", { name: /Sélection multiple/ }).check();
  await expect(page.getByLabel("Sélectionner les 20 lignes affichées")).toBeVisible();
  await expect(page.getByText(`${total - 20} autres lignes sont repliées : elles ne sont pas sélectionnées.`)).toBeVisible();
  const deplierEtSelectionner = page.getByRole("button", { name: `Afficher et sélectionner les ${total} personnes` });
  await expect(deplierEtSelectionner).toBeVisible();

  // Ce bouton-là est le seul qui sorte du pas de vingt, et son libellé annonce les quatre-vingts lignes.
  await deplierEtSelectionner.click();
  await expect(lignes).toHaveCount(total);
  await expect(compteur).toHaveText(`${total} sur ${total}`);
  await expect(page.getByRole("group", { name: "Modifier la réponse de plusieurs personnes à la fois" }).getByText(`${total} personnes sélectionnées`)).toBeVisible();
  // Tout est dévoilé : plus rien à afficher.
  await expect(page.getByRole("button", { name: /^Afficher les \d+ suivantes$/ })).toHaveCount(0);

  /*
   * ---- Et la recherche, qui **remplace** le repli plutôt que de s'y ajouter : quatre résultats se
   * montrent d'un coup, le compteur parle du résultat de la recherche, et aucun bouton ne reste à
   * appuyer. C'est la borne posée par `devoilement` : `demandees` ne dépasse jamais le total affiché.
   */
  await page.getByPlaceholder("Chercher un nom").fill("Foxtrot");
  // On attend le résumé de la recherche **avant** de compter les lignes : le filtrage se fait dans
  // le navigateur, à la frappe, et compter tout de suite reviendrait à compter la liste d'avant.
  const resume = page.getByText(new RegExp(`^\\d+ personnes? sur ${total}$`));
  await expect(resume).toBeVisible();
  const trouves = Number((await resume.innerText()).match(/^(\d+)/)?.[1] ?? "0");
  expect(trouves, "« Foxtrot » ne ramène qu'une poignée de noms").toBeGreaterThan(0);
  expect(trouves).toBeLessThan(20);
  await expect(lignes).toHaveCount(trouves);
  await expect(page.getByRole("button", { name: /^Afficher les \d+ suivantes$/ })).toHaveCount(0);
  // Et plus de compteur non plus : sous vingt lignes, il n'y a plus rien à repérer.
  await expect(compteur).toHaveCount(0);
});
