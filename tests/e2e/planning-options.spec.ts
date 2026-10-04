import { expect, test, type Locator, type Page } from "@playwright/test";
import { connecter, COMPTES } from "./helpers";

/**
 * Planning — les cases « Option » restent réglables pendant l'enregistrement.
 *
 * Le bug corrigé : la case était rendue inerte (listes désactivées) pendant tout l'aller-retour de
 * l'action serveur — aller-retour qui comprend le `revalidatePath`, donc le re-rendu de toute la
 * grille. On posait une option et on ne pouvait plus régler ni le thème ni l'instructeur. Pire, un
 * échec de l'action (session expirée, coupure, serveur redémarré) n'était pas rattrapé : React
 * relançait l'erreur et, faute de frontière d'erreur, la page entière disparaissait — il fallait
 * recharger. Ces deux tests tiennent les deux bouts.
 *
 * **Réécrit** : les deux champs d'une case ne sont plus des `<select>` natifs mais des
 * `ListeDeroulante` (un bouton et un `role="listbox"`), parce qu'un menu natif s'ouvrait vers le
 * haut et sortait de l'écran. Les tests parlent donc désormais en **rôles et en libellés** — ce que
 * voit la personne — plutôt qu'en `value` d'`<option>`, ce qui les rendra indifférents à la
 * prochaine refonte du champ.
 *
 * **Libellés remis à jour, puis le 30** : le planning n'est plus un tableau à quatre colonnes
 * figées mais une carte par séance, dont les parties portent un nom **calculé** depuis leur rang
 * dans leur nature (`libellePartie`, `PARTIES_MODELE`) — « Cours 1 », « Cours 2 », « Option 1 », «
 * Option 2 ». Il ne se saisit plus du tout : les anciens mots de `PARTIE_LABELS`, puis « 1ère
 * partie », puis « Cours n°1 » et « 1ère option » ont tous disparu.
 *
 * On vise donc le libellé, et jamais un **rang** dans la liste : une partie se déplace, se retire et
 * change de nature. Attention toutefois à ce que ce nom promet désormais — il **suit la place** : ces
 * scénarios ne déplacent aucune partie, sinon « Option 1 » désignerait une autre ligne après coup.
 */

/** Les deux listes d'une même case, et la boîte qui porte l'état d'enregistrement. */
async function caseDe(page: Page, partie: string): Promise<{ theme: Locator; instructeur: Locator; boite: Locator }> {
  const libelle = page.locator(`label:text-is("Thème — ${partie}")`).first();
  await expect(libelle).toBeAttached();
  const id = (await libelle.getAttribute("for"))!;
  const theme = page.locator(`#${id}`);
  await expect(theme).toBeVisible();
  return {
    theme,
    instructeur: page.locator(`#${id.replace(/-theme$/, "-instructeur")}`),
    boite: page.locator("div[data-enregistrement]").filter({ has: page.locator(`#${id}`) }).last(),
  };
}

/**
 * Déplie une liste et rend ses entrées, dans l'ordre où elles s'affichent.
 *
 * Les entrées sont cherchées **dans le panneau** et non dans la page : les `<select>` natifs qui
 * restent ailleurs sur l'écran (le choix de la période, la fenêtre de temps) portent eux aussi des
 * `option`, et un `getByRole("option")` global tombait sur « Rentrée 2026 ».
 */
async function entrees(page: Page, controle: Locator): Promise<Locator> {
  await controle.click();
  const panneau = page.getByRole("listbox");
  await expect(panneau).toBeVisible();
  return panneau.getByRole("option");
}

/** Choisit la n-ième entrée d'une liste et rend son libellé, pour pouvoir le revérifier ensuite. */
async function choisir(page: Page, controle: Locator, rang: number): Promise<string> {
  const options = await entrees(page, controle);
  const entree = options.nth(rang);
  const libelle = (await entree.textContent())!.trim();
  await entree.click();
  return libelle;
}

/** Choisit l'entrée qui porte exactement ce libellé — pour revenir à la valeur d'avant. */
async function choisirLibelle(page: Page, controle: Locator, libelle: string): Promise<void> {
  const options = await entrees(page, controle);
  await options.filter({ hasText: new RegExp(`^${libelle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first().click();
}

/*
 * **`?modifier=1` : le planning s'ouvre en lecture seule**, même pour l'encadrement — aucune case
 * n'est réglable avant d'avoir appuyé sur « Modifier le planning ». Ces scénarios parlent des
 * cases : ils entrent donc dans le mode, comme on y entre à la main.
 *
 * Et ce qu'ils vérifient a changé de nature avec lui : une case ne s'enregistre plus toute seule, elle
 * s'accumule dans un brouillon que « Appliquer les modifications » écrit d'un coup. Les trois
 * promesses tenues ici sont donc celles du **brouillon** : régler une case n'en bloque aucune autre,
 * une application qui échoue le dit sans rien perdre, et fermer l'onglet sur des cases pas appliquées
 * pose une question.
 */
test.beforeEach(async ({ page }) => {
  await connecter(page, COMPTES.instructeur, "/planning?modifier=1");
  await expect(page.getByRole("heading", { name: "Planning de cours" })).toBeVisible();
  // Les listes déroulantes sont complétées en arrière-plan (voir ContexteOptions) : on attend que la
  // liste des thèmes contienne autre chose que « aucun thème » avant de commencer à cliquer.
  const { theme } = await caseDe(page, "Cours 1");
  await expect.poll(async () => (await entrees(page, theme)).count()).toBeGreaterThan(3);
  await page.keyboard.press("Escape");
});

test("une case que l'on vient de remplir reste réglable, et c'est le dernier réglage qui part", async ({ page }) => {
  const { theme, instructeur } = await caseDe(page, "Cours 1");

  const premier = await choisir(page, theme, 1);
  await expect(theme).toContainText(premier);
  // Sans rien attendre : les deux listes de la case doivent rester réglables tout de suite
  await expect(instructeur).toBeEnabled();
  await expect(theme).toBeEnabled();
  const personne = await choisir(page, instructeur, 1);
  const second = await choisir(page, theme, 2);

  // **Rien n'est parti**, et l'écran le dit : la case se marque, la barre compte. Le silence
  // d'avant voudrait maintenant dire « enregistré », ce qui serait faux.
  await expect(page.getByText("Modifié — pas encore appliqué").first()).toBeVisible();
  await expect(page.getByText(/1 case modifiée, pas encore appliquée/)).toBeVisible();

  await page.getByRole("button", { name: "Appliquer les modifications" }).click();
  await page.waitForURL((u) => !u.searchParams.has("modifier"), { timeout: 30_000 });

  // Et le serveur a reçu le **dernier** réglage, pas les intermédiaires : on le relit du serveur.
  await page.goto("/planning?modifier=1");
  const apres = await caseDe(page, "Cours 1");
  await expect(apres.theme).toContainText(second);
  await expect(apres.instructeur).toContainText(personne);
});

test("une application qui échoue le dit, sans emporter la page ni le brouillon", async ({ page }) => {
  const { theme, instructeur } = await caseDe(page, "Cours 2");
  const choix = await choisir(page, theme, 1);

  // Le serveur ne répond plus (coupure, session expirée, redémarrage) — au moment de l'application,
  // qui est désormais le seul moment où quelque chose part.
  await page.route("**/planning**", (route) => {
    const r = route.request();
    return r.method() === "POST" && r.headers()["next-action"] ? route.abort("failed") : route.continue();
  });
  await page.getByRole("button", { name: "Appliquer les modifications" }).click();

  await expect(page.getByText(/Impossible d'appliquer les modifications/)).toBeVisible();
  // La page est toujours là, les cases toujours réglables…
  await expect(page.getByRole("heading", { name: "Planning de cours" })).toBeVisible();
  await expect(theme).toBeEnabled();
  await expect(instructeur).toBeEnabled();
  // …et surtout **le brouillon n'est pas perdu** : un refus ne doit rien coûter, on corrige et on
  // réessaie. Le vider sur échec serait la pire des réponses.
  await expect(page.getByText(/1 case modifiée, pas encore appliquée/)).toBeVisible();

  // Le serveur revient : le même geste passe, toujours sans recharger.
  await page.unroute("**/planning**");
  await page.getByRole("button", { name: "Appliquer les modifications" }).click();
  await page.waitForURL((u) => !u.searchParams.has("modifier"), { timeout: 30_000 });
  expect(choix).not.toHaveLength(0);
});

/**
 * **Fermer l'onglet sur un réglage pas encore écrit doit poser une question.**
 *
 * C'est le dernier trou laissé par la file d'envoi : entre le clic et l'écriture, il s'écoule un
 * aller-retour, et le partir emportait le réglage sans un mot. Le test n'ouvre pas la boîte de
 * dialogue du navigateur — elle appartient au navigateur et Playwright la renvoie sans la montrer
 * —, il vérifie la seule chose qui compte : **l'application s'oppose-t-elle à la fermeture au bon
 * moment, et seulement à ce moment-là ?**
 */
const fermetureRetenue = (page: Page) =>
  page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

test("fermer l'onglet sur des cases pas appliquées pose une question, et pas autrement", async ({ page }) => {
  const { theme } = await caseDe(page, "Cours 1");

  // Au repos, rien à perdre : la fermeture ne doit surtout pas être retenue, sinon on apprend à
  // cliquer « Quitter » sans lire et l'avertissement ne vaut plus rien le jour où il compte.
  expect(await fermetureRetenue(page)).toBe(false);

  /*
   * **Et c'est le brouillon qui la retient, maintenant**. La garde ne connaissait que les envois
   * **en vol** ; en mode modification il n'y en a plus un seul, si bien que fermer l'onglet sur des
   * cases réglées les perdait sans un mot — alors que le lien « quitter sans appliquer » posait la
   * question. Deux sorties pour le même risque, une seule qui prévenait.
   */
  const avant = ((await theme.textContent()) ?? "").trim();
  await choisir(page, theme, 1);
  expect(await fermetureRetenue(page)).toBe(true);

  // Reposée sur la valeur du serveur, la case **sort** du brouillon : plus rien à perdre, et le
  // compteur ne doit pas garder une modification nulle.
  await choisirLibelle(page, theme, avant);
  await expect(page.getByText(/case modifiée, pas encore appliquée/)).toHaveCount(0);
  expect(await fermetureRetenue(page)).toBe(false);

  // Et après une application, la question ne se pose plus non plus.
  await choisir(page, theme, 1);
  await page.getByRole("button", { name: "Appliquer les modifications" }).click();
  await page.waitForURL((u) => !u.searchParams.has("modifier"), { timeout: 30_000 });
  expect(await fermetureRetenue(page)).toBe(false);
});
