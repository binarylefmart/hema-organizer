import { expect, test } from "@playwright/test";
import { COMPTES } from "./helpers";
import { codeTotpFrais } from "../../prisma/comptes";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { etatPremiereConnexion, restaurerCompteAdministration } from "../../prisma/compte-administration";

/**
 * Parcours « mot de passe oublié » : demande → email (écrit dans previews/emails en dev) → nouveau mot de passe → connexion.
 *
 * Ce test change le mot de passe et la 2FA du **seul compte à mot de passe** de l'application :
 * il le remet donc dans l'état du seed à la fin, sinon plus personne ne peut se connecter ensuite
 * (ni les tests suivants, ni la personne qui utilise l'application de développement).
 */
const DOSSIER_EMAILS = path.join(process.cwd(), "previews", "emails");

async function dernierEmailReset(): Promise<string> {
  const fichiers = (await readdir(DOSSIER_EMAILS)).filter((f) => f.includes("reset_") && f.endsWith(".txt")).sort();
  return readFile(path.join(DOSSIER_EMAILS, fichiers.at(-1)!), "utf8");
}

// Le parcours attendu est celui d'un compte neuf : mot de passe provisoire, 2FA à configurer.
test.beforeAll(etatPremiereConnexion);
test.afterAll(restaurerCompteAdministration);

/**
 * **Le code n'est demandé qu'à qui l'a configuré** : ce compte, remis à l'état de première
 * connexion, n'a pas encore de double authentification — le lien reçu par email a déjà prouvé
 * l'identité, la session s'ouvre donc directement.
 *
 * Il est du bureau : son réglage est obligatoire, et il passe par le parcours `/admin/activer`
 * (mot de passe → QR code → codes de secours), le seul endroit où une double authentification
 * s'active — « Mon profil » n'en montre plus que l'état. On y va explicitement : selon la règle
 * d'entrée, la réinitialisation y dépose déjà, ou pas encore.
 *
 * Puis la gestion **dans l'espace admin** (« Comptes admin » → « Ma double authentification ») :
 * régénérer ses codes de secours, et réinitialiser sa double authentification — qui ramène au
 * parcours avec un nouveau QR code.
 */
test("le compte d'administration réinitialise son mot de passe par email, règle sa double authentification, puis la gère dans l'espace admin", async ({ page }) => {
  // Le parcours le plus long de la suite côté comptes : réinitialisation, QR code, codes de secours,
  // reconnexion, élévation, régénération des codes, réinitialisation de la 2FA.
  test.setTimeout(180_000);
  await page.goto("/mot-de-passe-oublie");
  await page.getByLabel("Email", { exact: true }).fill(COMPTES.admin);
  await page.getByRole("button", { name: "Recevoir le lien" }).click();
  await expect(page.getByText("Email envoyé")).toBeVisible();

  // L'email est écrit sur disque avec un léger délai (file d'envoi)
  let lien: string | undefined;
  await expect
    .poll(
      async () => {
        const texte = await dernierEmailReset().catch(() => "");
        lien = texte.match(/https?:\/\/\S+\/reinitialiser\/\S+/)?.[0];
        return lien && texte.includes(`À : ${COMPTES.admin}`) ? lien : undefined;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();

  await page.goto(lien!);
  await expect(page.getByRole("heading", { name: "Nouveau mot de passe" })).toBeVisible();
  await page.getByLabel("Mot de passe", { exact: true }).fill("nouveau-mot-de-passe");
  await page.getByLabel("Le même mot de passe, une deuxième fois").fill("nouveau-mot-de-passe");
  await page.getByRole("button", { name: "Enregistrer et me connecter" }).click();
  // Aucune double authentification (`etatPremiereConnexion` l'a retirée) : la session s'ouvre sans
  // second facteur, sans repasser par « Choisis ton mot de passe ».
  await page.waitForURL((u) => !u.pathname.startsWith("/reinitialiser") && !u.pathname.startsWith("/connexion"));

  // Le lien de réinitialisation est à usage unique
  await page.goto(lien!);
  await expect(page.getByRole("heading", { name: "Lien expiré" })).toBeVisible();

  // « Mon profil » ne propose plus d'activer une double authentification : il renvoie au parcours
  await page.goto("/profil#securite");
  await expect(page.getByRole("button", { name: "Activer la double authentification" })).toHaveCount(0);

  // Le parcours imposé : étape 2, le QR code
  await page.goto("/admin/activer");
  await page.getByRole("button", { name: "Afficher mon QR code" }).click();
  const aLaMain = page.locator("details", { hasText: "Impossible de scanner" });
  await aLaMain.getByText("Impossible de scanner").click();
  const cle = (await aLaMain.locator("code").textContent())!.replace(/\s+/g, "");
  // **Le mot de passe courant est redemandé** avec le premier code, et le code est calculé par
  // `codeTotpFrais` : la borne anti-rejeu vit sur le compte, et la connexion qui précède a pu brûler
  // le pas courant.
  await page.getByLabel("Mon mot de passe").fill("nouveau-mot-de-passe");
  await page.getByLabel("Code à 6 chiffres").fill(await codeTotpFrais(cle));
  await page.getByRole("button", { name: "Activer la double authentification" }).click();
  // Étape 3 : les 8 codes de secours, montrés une seule fois
  await expect(page.getByRole("list", { name: "Codes de secours" }).getByRole("listitem")).toHaveCount(8);
  await page.getByRole("button", { name: "J'ai noté mes codes" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/admin") && !u.pathname.startsWith("/admin/activer"));

  // Elle est bien en place : la connexion suivante n'en demande pas, mais l'espace admin l'exige
  await page.goto("/profil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL("**/connexion");
  await page.getByLabel("Email", { exact: true }).fill(COMPTES.admin);
  await page.getByLabel("Mot de passe", { exact: true }).fill("nouveau-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"));
  // « Mon profil » montre le bouton de qui n'entrerait plus dans l'espace admin
  await page.goto("/profil#securite");
  await expect(page.getByRole("button", { name: "Demander la réinitialisation de ma double authentification" })).toBeVisible();
  await page.goto("/connexion/admin?suite=%2Fadmin%2Fcomptes");
  await page.getByLabel("Mon mot de passe").fill("nouveau-mot-de-passe");
  await page.getByLabel("Code à 6 chiffres").fill(await codeTotpFrais(cle));
  await page.getByRole("button", { name: "Ouvrir l'espace admin" }).click();
  await page.waitForURL("**/admin/comptes**");

  // Dans l'espace admin : régénérer ses codes de secours (mot de passe redemandé)
  const rubrique = page.locator("#ma-deux-fa");
  await expect(rubrique.getByRole("heading", { name: "Ma double authentification" })).toBeVisible();
  await rubrique.locator("#codes-motDePasse").fill("nouveau-mot-de-passe");
  await rubrique.getByRole("button", { name: "Régénérer mes codes de secours" }).click();
  await page.waitForURL("**/connexion/codes-secours");
  await expect(page.getByRole("list", { name: "Codes de secours" }).getByRole("listitem")).toHaveCount(8);
  await page.getByRole("button", { name: "J'ai noté mes codes" }).click();
  await page.waitForURL("**/admin/comptes**");

  // Nouveau téléphone : réinitialiser sa double authentification ramène au parcours, étape 2
  await page.locator("#ma-deux-fa #deuxfa-motDePasse").fill("nouveau-mot-de-passe");
  // La confirmation dit ce que la réinitialisation entraîne : on l'accepte (Playwright la refuse par défaut)
  page.once("dialog", (d) => void d.accept());
  await page.locator("#ma-deux-fa").getByRole("button", { name: "Réinitialiser ma double authentification" }).click();
  await page.waitForURL("**/admin/activer**");
  // Le nouveau QR code est prêt tout de suite, et ce compte (le portail) n'a pas de code d'activation
  // à présenter — personne d'autre que lui ne touche à sa double authentification.
  await expect(page.getByRole("img", { name: "QR code à scanner avec l'application d'authentification" })).toBeVisible();
  await expect(page.getByLabel("Code d'activation (remis par un membre du bureau)")).toHaveCount(0);
});

test("une adresse inconnue ou non-admin reçoit la même réponse (pas d'énumération)", async ({ page }) => {
  await page.goto("/mot-de-passe-oublie");
  await page.getByLabel("Email", { exact: true }).fill("personne.inconnue@club.test");
  await page.getByRole("button", { name: "Recevoir le lien" }).click();
  await expect(page.getByText("Email envoyé")).toBeVisible();
});
