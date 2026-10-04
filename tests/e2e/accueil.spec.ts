import { expect, test } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **La vue Admin de l'accueil n'existe pas pour qui n'y a pas droit.**
 *
 * Ce n'est pas une affaire d'affichage : le bloc réservé (pilotage du trimestre, ateliers en
 * attente, invités à relancer) ne doit ni apparaître, ni descendre jusqu'au navigateur. Un test
 * unitaire vérifie déjà que le serveur ne le calcule pas ; celui-ci regarde **ce que reçoit
 * vraiment le navigateur**, payload de streaming compris — c'est la seule façon d'attraper une
 * régression où l'on masquerait en CSS ce qu'on a envoyé quand même.
 *
 * Le contrôle positif (l'administrateur) est indispensable : sans lui, une sonde cassée
 * déclarerait « rien trouvé » sur une page vide et le test passerait au vert pour rien. C'est
 * exactement le piège rencontré en écrivant cette vérification à la main.
 */

const MOTS_RESERVES = ["Pour l'encadrement", "Taux moyen", "Participation moyenne", "ateliersEnAttente", "invitesSansReponse"];

/** Tout ce que le navigateur télécharge de l'application pendant la visite : HTML, RSC, scripts. */
async function visiterAccueil(page: import("@playwright/test").Page) {
  const recu: string[] = [];
  page.on("response", async (r) => {
    const type = r.headers()["content-type"] ?? "";
    if (!/html|text|rsc|javascript/.test(type)) return;
    try {
      recu.push(await r.text());
    } catch {
      /* réponse illisible : sans intérêt ici */
    }
  });
  await page.goto("/", { waitUntil: "networkidle" });
  expect(page.url()).not.toContain("/connexion");
  return [await page.content(), ...recu].join("\n");
}

const bascule = (page: import("@playwright/test").Page) => page.locator('[aria-label="Ce que montre l\'accueil"] button');

test("un membre n'a aucune bascule (une seule vue), et rien du bloc réservé ne lui est envoyé", async ({ page }) => {
  await connecter(page, COMPTES.membre);
  const recu = await visiterAccueil(page);
  // Un membre n'a qu'une vue — « Personnel » — et la bascule ne s'affiche donc pas du tout
  // (`FournisseurVue` : un groupe de boutons à une position occuperait une ligne sans rien proposer).
  // Ce qui est en jeu reste le même : aucune position « Admin », et pas un mot du bloc réservé.
  await expect(bascule(page)).toHaveCount(0);
  // Contrôle positif : la vue personnelle est bien rendue, sinon les absences ci-dessous ne prouveraient rien
  await expect(page.getByText("Ma présence").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
  for (const mot of MOTS_RESERVES) expect(recu, `« ${mot} » ne doit pas parvenir à un membre`).not.toContain(mot);
});

test("un instructeur non plus : la vue Admin tient au bureau, pas à l'encadrement", async ({ page }) => {
  await connecter(page, COMPTES.instructeur);
  const recu = await visiterAccueil(page);
  await expect(bascule(page)).toHaveText(["Club", "Personnel"]);
  await expect(page.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
  for (const mot of MOTS_RESERVES) expect(recu, `« ${mot} » ne doit pas parvenir à un instructeur`).not.toContain(mot);
});

/**
 * **Et « Club » ne suit pas le bureau : elle suit le rôle de base**.
 *
 * **Et le compte global du déploiement a tous les rôles** (précision de Delta le même jour) : c'est
 * le compte d'administration de l'installation, créé au déploiement, immuable dans ses rôles et
 * qu'aucun autre compte ne supprime. Son rôle de base est `MEMBRE` et il n'enseigne pas, mais la
 * question n'est pas « enseigne-t-il ? » : c'est « lui ouvre-t-on la vue de l'encadrement ? ». Pour
 * lui, oui — il a donc bien les **trois** positions. C'est ce que ce scénario tient.
 *
 * Ce qui a changé, et que l'unitaire garde sur les cinq cas (`tests/unit/accueil-vues.test.ts`) :
 * un administrateur **nominatif** dont le rôle de base est *membre* n'a, lui, que « Personnel » et
 * « Admin » — il pilote le club sans l'encadrer.
 *
 * Avant, la position était gardée par la **permission** `sessions.manage`, que `can()` accorde à tout
 * administrateur : la vue de l'encadrement s'ouvrait donc à qui n'encadre pas.
 */
test("le compte global du déploiement a les trois positions et ses chiffres (contrôle positif)", async ({ page }) => {
  await connecter(page, COMPTES.admin);
  const recu = await visiterAccueil(page);
  await expect(bascule(page)).toHaveText(["Club", "Personnel", "Admin"]);
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await expect(page.getByText(/Pour l'encadrement/i)).toBeVisible();
  // Sans cette assertion, les deux tests précédents pourraient passer sur une sonde qui ne trouve rien
  expect(MOTS_RESERVES.some((m) => recu.includes(m))).toBe(true);
});
