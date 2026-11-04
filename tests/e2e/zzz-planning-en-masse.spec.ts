import { expect, test, type Page } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Régler plusieurs séances du planning à la fois**, en mode modification — au téléphone, seul format
 * de la campagne.
 *
 * Ce que ce scénario garde :
 *
 * - **le crayon ouvre les cases d'emblée** (plus d'interrupteur), **la case maîtresse nomme sa portée** et **« Sélectionner par jour »**, une liste dans la barre du bas (« Tous les mardis (N) »…) :
 *   choisir un jour coche ces séances, le choisir de nouveau
 *   (« Retirer les mardis ») les décoche ;
 * - la barre sombre du bas ouvre le volet ; **« Régler des éléments »** y montre les séances cochées
 *   avec leurs éléments, on coche ceux qu'on veut, « Suivant », puis les réglages ;
 * - **ce réglage n'écrit rien** : les cases entrent dans le brouillon, chacune dit « modifié », la
 *   compteur à côté de ✕ et « Appliquer » les compte, et **✕ les jette** (après confirmation) ;
 * - **« Ajouter un élément »** (partie 1, option) part tout de suite ; l'option ajoutée est
 *   retirée depuis sa carte pour rendre le jeu de démonstration tel qu'il était.
 */

const barre = (page: Page) => page.getByRole("group", { name: "Agir sur plusieurs séances à la fois" });
const volet = (page: Page) => page.getByRole("dialog", { name: /^Que faire sur / });

/** L'application retient-elle la fermeture de l'onglet ? (voir `planning-options.spec.ts`) */
const fermetureRetenue = (page: Page) =>
  page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

async function choisir(page: Page, liste: string | RegExp, entree: RegExp, dans = page.locator("body")): Promise<void> {
  await dans.getByRole("combobox", { name: liste }).click();
  await page.getByRole("listbox").getByRole("option", { name: entree }).first().click();
}

/** Ouvre le volet depuis la barre du bas, puis choisit le geste dans sa liste de gros boutons. */
async function ouvrirGeste(page: Page, geste: RegExp): Promise<void> {
  await barre(page).getByRole("button", { name: "Continuer" }).click();
  await expect(volet(page)).toBeVisible();
  await volet(page).getByRole("button", { name: geste }).click();
}

test("cocher par jour, régler des éléments dans le brouillon, puis annuler", async ({ page }) => {
  // Le compte d'administration, qui entre par mot de passe : ce fichier passe après `zz-liens`.
  await connecter(page, COMPTES.admin);
  await page.goto("/planning?modifier=1");
  // Le crayon a ouvert les cases : plus d'interrupteur.
  await expect(page.getByRole("switch", { name: /Sélection multiple/ })).toHaveCount(0);
  await expect(page.getByText(/^Coche des lignes pour régler des éléments/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Sélectionner (les \d+ séances affichées|la séance affichée)$/ })).toBeVisible();
  await expect(barre(page).getByText(/^0 séance/)).toBeVisible(); // la barre reste là tout le mode

  // Toucher la poignée ⋮⋮ d'une ligne ne coche pas sa séance : la poignée déplace, elle ne coche pas.
  const premiereCase = page.getByRole("checkbox", { name: /^Sélectionner la séance du/ }).first();
  const idCarte = await premiereCase.evaluate((el) => el.closest("article")?.id ?? "");
  await page.locator(`article#${idCarte} [title="Tenir puis glisser pour déplacer"]`).first().click();
  await expect(premiereCase).not.toBeChecked();
  await expect(barre(page).getByText(/^0 séance/)).toBeVisible(); // la barre reste là tout le mode

  // « Sélectionner par jour » : une liste déroulante dans la barre du bas (« Tous les mardis (4) »).
  const choisirJour = async (motif: RegExp) => {
    await barre(page).getByRole("combobox", { name: "Sélectionner par jour" }).click();
    const option = page.getByRole("listbox").getByRole("option", { name: motif }).first();
    const texte = (await option.textContent())!.trim();
    await option.click();
    return texte;
  };
  const premier = await choisirJour(/^(Tous les \S+s|Le \S+) \(\d+\)$/);
  const n = Number(/\((\d+)\)$/.exec(premier)![1]);
  await expect(barre(page).getByText(n === 1 ? "1 séance sélectionnée" : `${n} séances sélectionnées`)).toBeVisible();

  // Choisi de nouveau (« Retirer les mardis »), le jour décoche ces séances.
  await choisirJour(/^Retirer (les \S+s|le \S+) \(\d+\)$/);
  await expect(barre(page).getByText(/^0 séance/)).toBeVisible(); // la barre reste là tout le mode
  await choisirJour(/^(Tous les \S+s|Le \S+) \(\d+\)$/);
  await expect(barre(page).getByText(n === 1 ? "1 séance sélectionnée" : `${n} séances sélectionnées`)).toBeVisible();

  // Une seule barre en bas : ✕ et « Appliquer » y sont, à côté de « Continuer ».
  await expect(page.locator('[data-barre-basse="edition"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Annuler les modifications" })).toBeVisible();

  // « Régler des éléments » : les séances cochées et leurs éléments. On coche le cours de chacune
  // (une séance au modèle en porte un), sans toucher aux autres éléments.
  await ouvrirGeste(page, /^Régler des éléments \(/);
  const cours = volet(page).getByRole("checkbox", { name: /^(Partie \d+ · )?Cours( \d+)?\b/ });
  const nbCours = await cours.count();
  expect(nbCours, "chaque séance cochée porte au moins un cours").toBeGreaterThanOrEqual(n);
  for (let i = 0; i < nbCours; i++) if (await cours.nth(i).isEnabled()) await cours.nth(i).check();
  const suivant = volet(page).getByRole("button", { name: /^Suivant : \d+ éléments?$/ });
  await expect(suivant).toBeEnabled();
  await suivant.click();

  // Les réglages : un thème libre, rien d'autre. Le niveau se règle en quatre boutons, « ne pas
  // changer » par défaut ; en appuyer un puis l'appuyer de nouveau y revient.
  const avance = volet(page).getByRole("button", { name: "Avancé" });
  await expect(avance).toHaveAttribute("aria-pressed", "false");
  await avance.click();
  await expect(avance).toHaveAttribute("aria-pressed", "true");
  await avance.click();
  await expect(volet(page).getByText("Niveau : ne pas changer")).toBeVisible();
  await choisir(page, "Thème", /^Autre…$/, volet(page));
  await volet(page).getByLabel("Thème libre").fill("Thème posé en masse");
  const regler = volet(page).getByRole("button", { name: /^Régler \d+ éléments?$/ });
  await expect(regler).toBeEnabled();
  const poses = Number(/Régler (\d+)/.exec((await regler.textContent())!)![1]);
  await regler.click();
  await expect(volet(page).getByText(/réglés?, pas encore appliqués?/)).toBeVisible();
  await volet(page).getByRole("button", { name: "Fermer" }).click();
  await expect(volet(page)).toHaveCount(0);

  // Aucune de ces lignes n'a été dépliée, aucune case n'est montée : c'est le brouillon, et lui seul,
  // qui retient la fermeture de l'onglet.
  expect(await fermetureRetenue(page)).toBe(true);

  // Chaque case réglée le dit : sur PC dans ses réglages ; sur téléphone, les réglages sont repliés et
  // c'est le résumé de la ligne qui porte « · modifié ».
  const telephone = (page.viewportSize()?.width ?? 1280) < 768;
  await expect(telephone ? page.getByText(/^\s*·\s*modifié$/) : page.getByText("Modifié — pas encore appliqué")).toHaveCount(poses);
  // Le compteur, sous ✕ et « Appliquer ».
  await expect(page.getByText(new RegExp(`^${poses} modifications? non appliquées?$`))).toBeVisible();

  // ✕ jette le brouillon, après confirmation : rien n'a touché la base.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Annuler les modifications" }).click();
  await page.waitForURL((url) => !url.search.includes("modifier=1"));
  await expect(page.getByText("Thème posé en masse")).toHaveCount(0);
});

test("ajouter une option dans la partie 1 d'une séance cochée, puis la retirer", async ({ page }) => {
  await connecter(page, COMPTES.admin);
  await page.goto("/planning?modifier=1");
  // La dernière carte cochable affichée, pour ne pas toucher celles que les autres scénarios visent.
  const cases = page.getByRole("checkbox", { name: /^Sélectionner la séance du/ });
  // La carte de la dernière case : retrouvée depuis la case elle-même (un `filter({ has })` évaluerait
  // `.last()` dans chaque carte, et les désignerait toutes).
  const id = await cases.last().evaluate((el) => el.closest("article")?.id ?? "");
  const carte = page.locator(`article#${id}`);
  // ↑ ↓ Retirer sont là dès le mode modification : aucun second bouton par carte.
  await expect(carte.getByRole("button", { name: "Modifier", exact: true })).toHaveCount(0);
  const options = carte.getByRole("button", { name: /^Retirer « (Partie 1 · )?Option( \d+)? »$/ });
  const avant = await options.count();
  await cases.last().check();

  await ouvrirGeste(page, /^Ajouter un élément \(1 séance\)$/);
  await choisir(page, "Où le placer", /^Partie 1$/, volet(page));
  await choisir(page, "Quoi ajouter", /^Option$/, volet(page));
  let question = "";
  page.once("dialog", (d) => {
    question = d.message();
    void d.accept();
  });
  await volet(page).getByRole("button", { name: "Ajouter une option dans la partie 1 à 1 séance" }).click();
  await expect(page.getByText("Option ajoutée à 1 séance.").first()).toBeVisible({ timeout: 30_000 });
  expect(question).toContain("enregistré tout de suite");
  // Le geste fait, le volet revient à la liste des gestes ; on le referme, et on vide la sélection.
  await volet(page).getByRole("button", { name: "Fermer" }).click();
  await cases.last().uncheck();
  await expect(barre(page).getByText(/^0 séance/)).toBeVisible(); // la barre reste là tout le mode
  const apres = page.locator(`article#${id}`).getByRole("button", { name: /^Retirer « (Partie 1 · )?Option( \d+)? »$/ });
  await expect(apres).toHaveCount(avant + 1, { timeout: 20_000 });

  // Remise en état : l'option ajoutée est la dernière de sa nature dans la partie. Sur téléphone, le
  // bouton « Retirer » dort sous la ligne : le focus le révèle, comme le glissé vers la gauche.
  page.once("dialog", (d) => void d.accept());
  if ((page.viewportSize()?.width ?? 1280) < 768) await apres.last().focus();
  await apres.last().click();
  await expect(apres).toHaveCount(avant, { timeout: 20_000 });
});
