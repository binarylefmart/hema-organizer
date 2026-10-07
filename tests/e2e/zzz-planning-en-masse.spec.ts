import { expect, test, type Page } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Régler plusieurs séances du planning à la fois**, en mode modification — au téléphone, seul format
 * de la campagne.
 *
 * Ce que ce scénario garde :
 *
 * - **éteint, l'interrupteur « Sélection multiple » ne laisse aucune case** sur les cartes ;
 * - allumé, **la case maîtresse nomme sa portée** et **une puce par jour** (« Les mardis (N) »…)
 *   remplace la liste « Sélectionner par jour » : l'appuyer coche ces séances, l'appuyer de nouveau
 *   (puce enfoncée) les décoche ;
 * - la barre sombre du bas ouvre le volet ; **« Régler des éléments »** y montre les séances cochées
 *   avec leurs éléments, on coche ceux qu'on veut, « Suivant », puis les réglages ;
 * - **ce réglage n'écrit rien** : les cases entrent dans le brouillon, chacune dit « modifié », la
 *   barre du bas les compte, et **« Annuler » les jette** ;
 * - **« Ajouter dans une partie »** (partie 1, option) part tout de suite ; l'option ajoutée est
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
  await barre(page).getByRole("button", { name: /^Que faire sur (ces \d+ séances|cette séance) \?$/ }).click();
  await expect(volet(page)).toBeVisible();
  await volet(page).getByRole("button", { name: geste }).click();
}

test("cocher par jour, régler des éléments dans le brouillon, puis annuler", async ({ page }) => {
  // Le compte d'administration, qui entre par mot de passe : ce fichier passe après `zz-liens`.
  await connecter(page, COMPTES.admin);
  await page.goto("/planning?modifier=1");
  const interrupteur = page.getByRole("switch", { name: /Sélection multiple/ });
  await expect(interrupteur).toBeVisible();
  await expect(page.getByLabel(/^Sélectionner la séance du/)).toHaveCount(0);

  await interrupteur.check();
  await expect(page.getByText(/^Coche des lignes pour régler une partie/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Sélectionner (les \d+ séances affichées|la séance affichée)$/ })).toBeVisible();
  await expect(barre(page)).toHaveCount(0);

  // Toucher la poignée ⋮⋮ d'une ligne ne coche pas sa séance : la poignée déplace, elle ne coche pas.
  const premiereCase = page.getByRole("checkbox", { name: /^Sélectionner la séance du/ }).first();
  const idCarte = await premiereCase.evaluate((el) => el.closest("article")?.id ?? "");
  await page.locator(`article#${idCarte} [title="Tenir puis glisser pour déplacer"]`).first().click();
  await expect(premiereCase).not.toBeChecked();
  await expect(barre(page)).toHaveCount(0);

  // Les puces des jours : la première (le premier jour de la semaine présent).
  const jours = page.getByRole("group", { name: "Sélectionner par jour" });
  const puce = jours.getByRole("button", { name: /^(Les \S+s|Le \S+) \(\d+\)$/ }).first();
  await expect(puce).toHaveAttribute("aria-pressed", "false");
  const n = Number(/\((\d+)\)$/.exec((await puce.textContent())!.trim())![1]);
  await puce.click();
  await expect(puce).toHaveAttribute("aria-pressed", "true");
  await expect(barre(page)).toBeVisible();
  await expect(barre(page).getByText(n === 1 ? "1 séance sélectionnée" : `${n} séances sélectionnées`)).toBeVisible();

  // Appuyée de nouveau, la puce décoche ces séances.
  await puce.click();
  await expect(barre(page)).toHaveCount(0);
  await puce.click();
  await expect(barre(page)).toBeVisible();

  // Les deux barres du bas s'empilent sans se chevaucher, même quand la barre d'édition grandit
  // (l'aide « i » ouverte) : la barre de sélection se cale sur sa hauteur réelle.
  const edition = page.locator('[data-barre-basse="edition"]');
  const aide = page.getByRole("button", { name: "Ce qui s'enregistre tout de suite" });
  for (const ouverte of [false, true]) {
    if (ouverte) await aide.click();
    await expect(aide).toHaveAttribute("aria-expanded", String(ouverte));
    await expect
      .poll(async () => {
        const b = (await barre(page).boundingBox())!;
        const e = (await edition.boundingBox())!;
        return b.y + b.height <= e.y + 0.5;
      })
      .toBe(true);
  }
  await aide.click();

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
  // La barre du bas compte : la phrase entière sur PC, « · N modifiées » sur téléphone.
  await expect(
    page.getByText(telephone ? new RegExp(`^\\s*·\\s*${poses}\\s*modifiées?$`) : new RegExp(`^${poses} cases? modifiées?, pas encore appliquées?$`)),
  ).toBeVisible();

  // « Annuler » jette le brouillon : rien n'a touché la base. La barre de sélection est posée au-dessus
  // d'« Annuler · Appliquer », qui reste à portée pendant qu'on coche.
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

  await ouvrirGeste(page, /^Ajouter dans une partie \(1 séance\)$/);
  await choisir(page, "Dans quelle partie", /^Partie 1$/, volet(page));
  await choisir(page, "Ce qu'on ajoute", /^Option$/, volet(page));
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
  await barre(page).getByRole("button", { name: "Annuler la sélection" }).click();
  await expect(barre(page)).toHaveCount(0);
  const apres = page.locator(`article#${id}`).getByRole("button", { name: /^Retirer « (Partie 1 · )?Option( \d+)? »$/ });
  await expect(apres).toHaveCount(avant + 1, { timeout: 20_000 });

  // Remise en état : l'option ajoutée est la dernière de sa nature dans la partie. Sur téléphone, le
  // bouton « Retirer » dort sous la ligne : le focus le révèle, comme le glissé vers la gauche.
  page.once("dialog", (d) => void d.accept());
  if ((page.viewportSize()?.width ?? 1280) < 768) await apres.last().focus();
  await apres.last().click();
  await expect(apres).toHaveCount(avant, { timeout: 20_000 });
});
