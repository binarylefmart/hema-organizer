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
 * l'identité, la session s'ouvre donc directement. Le mot de passe du seed étant provisoire,
 * l'application impose ensuite d'en choisir un vrai.
 *
 * La double authentification se reconfigure alors depuis « Mon profil → Sécuriser mon compte » :
 * c'est le chemin de ce compte-ci (le parcours `/admin/activer` est réservé aux administrateurs
 * **nominatifs**). La preuve qu'elle est bien active n'est pas une pastille mais un comportement :
 * la connexion suivante redemande un code.
 */
test("le compte d'administration réinitialise son mot de passe par email, puis reconfigure la double authentification", async ({ page }) => {
  // Le parcours le plus long de la suite côté comptes : réinitialisation, mot de passe définitif,
  // QR code, codes de secours, puis une reconnexion complète.
  test.setTimeout(120_000);
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
  /*
   * Aucune double authentification sur ce compte (`etatPremiereConnexion` l'a retirée) : la session
   * s'ouvre sans second facteur. Et **sans passer par « Choisis ton mot de passe »**, bien que le
   * compte soit encore marqué provisoire : celui qu'on vient de choisir **est** le vrai, la
   * réinitialisation lève donc elle-même ce caractère. Sans cela, on renvoyait la personne choisir
   * un mot de passe juste après l'avoir choisi — une boucle absurde, corrigée dans l'action.
   */
  await page.waitForURL((u) => u.pathname === "/" && u.search.includes("mdp=ok"));

  // Le lien de réinitialisation est à usage unique
  await page.goto(lien!);
  await expect(page.getByRole("heading", { name: "Lien expiré" })).toBeVisible();

  // Reconfiguration de la double authentification, depuis « Mon profil »
  await page.goto("/profil#securite");
  await page.getByRole("button", { name: "Activer la double authentification" }).click();
  const aLaMain = page.locator("details", { hasText: "Impossible de scanner" });
  await aLaMain.getByText("Impossible de scanner").click();
  const cle = (await aLaMain.locator("code").textContent())!.replace(/\s+/g, "");
  /*
   * **Le mot de passe courant est redemandé** avec le premier code : sans lui, détenir la session
   * de quelqu'un suffisait à scanner le QR code avec son propre téléphone et à repartir avec ses
   * codes de secours. C'est celui qu'on vient de choisir.
   *
   * On vise le formulaire d'activation lui-même (le seul qui porte un champ « code »), et par le nom
   * du champ plutôt que par son libellé : l'écran « Mon profil » porte **deux** champs `motDePasse`
   * — celui du changement de mot de passe, replié, et celui-ci — et `Champ` tire l'identifiant du
   * nom. Les deux `<label for="motDePasse">` désignent donc le premier, replié : `getByLabel` tombe
   * sur un champ invisible. Défaut d'écran signalé à part ; le test, lui, ne doit pas en dépendre.
   */
  const activation = page.locator("form").filter({ has: page.locator('input[name="code"]') });
  await activation.locator('input[name="motDePasse"]').fill("nouveau-mot-de-passe");
  /*
   * **`codeTotpFrais`, et non `codeTotp`**. Le serveur refuse tout pas de temps inférieur ou égal
   * au dernier accepté, et cette borne vit sur le **compte** (`User.totpDernierPas`), pas sur le
   * secret : la connexion qui précède, quelques secondes plus tôt, vient de consommer le pas
   * courant. Un code calculé naïvement sur la clé **neuve** retombe donc sur un pas déjà brûlé,
   * l'activation est rejetée — à juste titre — et l'écran revient à `/profil` au lieu d'aller aux
   * codes de secours. Le test attendait alors deux minutes une navigation qui ne viendrait jamais.
   *
   * L'outillage des captures a reçu ce correctif le matin même ; cette spec était le dernier endroit
   * à calculer un code à la main.
   */
  await activation.locator('input[name="code"]').fill(await codeTotpFrais(cle));
  await activation.getByRole("button", { name: "Activer la double authentification" }).click();
  // Les 8 codes de secours sont montrés une seule fois
  await page.waitForURL("**/connexion/codes-secours");
  await expect(page.getByRole("list", { name: "Codes de secours" }).getByRole("listitem")).toHaveCount(8);
  await page.getByRole("button", { name: "J'ai noté mes codes" }).click();

  // Elle est bien en place : la connexion suivante redemande un code (et le mot de passe choisi à la
  // réinitialisation sert — c'est le seul qu'on ait posé)
  await page.goto("/profil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL("**/connexion");
  await page.getByLabel("Email", { exact: true }).fill(COMPTES.admin);
  await page.getByLabel("Mot de passe", { exact: true }).fill("nouveau-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/connexion/code");
  await page.getByLabel("Code à 6 chiffres").fill(await codeTotpFrais(cle));
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"));
});

test("une adresse inconnue ou non-admin reçoit la même réponse (pas d'énumération)", async ({ page }) => {
  await page.goto("/mot-de-passe-oublie");
  await page.getByLabel("Email", { exact: true }).fill("personne.inconnue@club.test");
  await page.getByRole("button", { name: "Recevoir le lien" }).click();
  await expect(page.getByText("Email envoyé")).toBeVisible();
});
