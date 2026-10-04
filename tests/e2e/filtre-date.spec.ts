import { expect, test, type Page } from "@playwright/test";
import { connecter, COMPTES } from "./helpers";
import { dateDemo } from "../../prisma/seed-demo";
import { SEANCES_CLUB } from "../../prisma/donnees-club";

/**
 * **Chercher une date précise**, sur les séances et sur le planning.
 *
 * Deux promesses, et la seconde est celle qui peut casser en silence :
 *  - le jour cherché s'affiche **seul**, quels que soient le sens du temps et la fenêtre — on tape
 *    une date passée sans avoir à basculer sur « Passé » ;
 *  - **le trimestre qui contient la date s'ouvre tout seul.** Sans cela, chercher une date d'un
 *    autre trimestre rendrait un écran vide alors que le cours existe, et rien ne dirait qu'il
 *    fallait d'abord changer de trimestre. C'est le piège de cette fonctionnalité, et le champ le
 *    promet noir sur blanc.
 */

/**
 * Une date du jeu de démonstration, **passée** : elle vérifie au passage que le sens du temps ne joue plus.
 *
 * Elle passe par `dateDemo` parce que le jeu de démonstration **recale ses dates sur la semaine en
 * cours** depuis le même jour : écrite en dur, cette date serait devenue une date sans cours à
 * partir, et le scénario aurait échoué sur « aucune séance à cette date » en accusant le filtre —
 * qui n'y serait pour rien. Le jour de semaine, lui, ne change pas : le décalage est un multiple de
 * sept jours, donc ce mardi reste un mardi.
 */
const UN_COURS_PASSE = dateDemo(SEANCES_CLUB[2].date);

/**
 * **Et la date ne s'écrit plus du tout : elle se prend dans le calendrier du club**. Elle était
 * écrite en ISO (`2026-09-08`, le troisième cours du trimestre), ce qui est une **troisième**
 * écriture de la même valeur — après la liste des séances et le libellé en français.
 *
 * Elle a divergé exactement comme le libellé avant elle, et dans la même copie publique : la fabrique
 * ne remappe les dates que dans les trois fichiers où une date **désigne** une séance, et ce fichier
 * n'en fait pas partie. Le 8 septembre du club inventé n'est pas un jour de cours (il donne le
 * mercredi et le samedi) : deux scénarios publics cherchaient donc une carte qui ne pouvait pas
 * exister, et accusaient le filtre.
 *
 * Prise dans `SEANCES_CLUB`, elle est juste des deux côtés, et le nom de la constante ne promet plus
 * un jour de semaine qu'elle ne tient que par hasard.
 */

/** Un jour **sans** cours, dérivé lui aussi : le lendemain d'une séance n'en est jamais un. */
const UN_JOUR_SANS_COURS = (() => {
  const veille = new Date(`${UN_COURS_PASSE}T12:00:00Z`);
  veille.setUTCDate(veille.getUTCDate() + 1);
  return veille.toISOString().slice(0, 10);
})();

/**
 * **La même date, écrite une seule fois.** Les assertions disaient « 8 septembre » en toutes lettres
 * à côté de la constante ISO : deux écritures de la même valeur, qui ne peuvent que diverger.
 *
 * Elles ont divergé, dans la **copie publique**. La fabrique du dépôt public recale le calendrier
 * du club inventé et remappe les dates `AAAA-MM-JJ` qu'elle trouve dans le code — la constante est
 * donc passée, qui est le jour de cours du club inventé. Mais « 8 septembre » écrit en français
 * n'est pas une date pour un remplacement textuel : les deux assertions sont restées sur le 8, et
 * deux tests publics cherchaient une carte qui ne pouvait pas exister.
 *
 * On dérive donc le libellé de la constante. La copie publique hérite de la correction sans que la
 * fabrique ait à comprendre le français.
 */
const [ANNEE] = UN_COURS_PASSE.split("-");
const LIBELLE_JOUR = new Date(`${UN_COURS_PASSE}T12:00:00Z`).toLocaleDateString("fr-FR", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Paris",
});

/** Ouvre le volet de filtres (un `<details>` replié par défaut, sur les séances comme sur le planning). */
async function ouvrirFiltres(page: Page): Promise<void> {
  const volet = page.getByText("Filtrer", { exact: false }).first();
  if (await volet.isVisible().catch(() => false)) await volet.click();
}

test("l'onglet Séances montre le cours d'une date précise, passée comprise", async ({ page }) => {
  await connecter(page, COMPTES.membre, "/seances");
  await ouvrirFiltres(page);

  const champ = page.getByLabel("Une date précise");
  await expect(champ).toBeVisible();
  await champ.fill(UN_COURS_PASSE);

  await expect(page).toHaveURL(new RegExp(`date=${UN_COURS_PASSE}`));
  // Une seule carte, celle du jour visé — et on n'a jamais touché à « À venir / Passé ».
  const cartes = page.getByRole("article");
  await expect(cartes).toHaveCount(1);
  await expect(cartes.first()).toContainText(LIBELLE_JOUR);

  // Effacer rend l'écran à ses filtres habituels : plus de `date` dans l'URL, plus d'un cours.
  await page.getByRole("button", { name: "Effacer" }).click();
  await expect(page).not.toHaveURL(/date=/);
  await expect(cartes.first()).toBeVisible();
});

test("le planning s'ouvre sur la date cherchée, et le dit en toutes lettres", async ({ page }) => {
  await connecter(page, COMPTES.instructeur, "/planning");
  // Depuis les filtres du planning vivent eux aussi dans un volet replié.
  await ouvrirFiltres(page);

  const champ = page.getByLabel("Une date précise");
  await expect(champ).toBeVisible();
  await champ.fill(UN_COURS_PASSE);

  await expect(page).toHaveURL(new RegExp(`date=${UN_COURS_PASSE}`));
  // La date en toutes lettres : sans elle, personne ne comprendrait pourquoi la grille est si courte.
  await expect(page.getByText(new RegExp(`${LIBELLE_JOUR} ${ANNEE}`)).first()).toBeVisible();
  // Une seule séance dans la grille (chaque ligne porte l'ancre `#seance-<id>`).
  await expect(page.locator('[id^="seance-"]')).toHaveCount(1);
});

test("une date qu'aucun cours n'occupe le dit, au lieu d'un écran vide", async ({ page }) => {
  await connecter(page, COMPTES.membre, "/seances");
  await ouvrirFiltres(page);
  // Le lendemain d'un cours : quel que soit le calendrier du club, il n'y en a pas deux de suite.
  await page.getByLabel("Une date précise").fill(UN_JOUR_SANS_COURS);
  await expect(page.getByText(/Aucun cours le/)).toBeVisible();
});
