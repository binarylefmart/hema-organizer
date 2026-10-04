import { expect, test } from "@playwright/test";
import { signPayload } from "@/lib/auth/tokens";
import { COMPTES, connecter } from "./helpers";

/**
 * **Le lien de désinscription coupe l'email *et* le téléphone, et il le dit.**
 *
 * Ce module a longtemps prétendu ne toucher qu'à l'email alors que `reglerRappels` écrit un booléen
 * par type de notification, donc les deux canaux personnels d'un coup. De deux corrections
 * possibles — restreindre le lien à l'email, ou l'annoncer franchement —, c'est la seconde qui a
 * été retenue : quelqu'un qui clique « ne plus recevoir ces rappels » depuis son téléphone veut la
 * paix, pas un canal sur deux. Mais alors il faut le **dire**, partout où le lien se présente — un
 * lien qui disait « par email » et coupait aussi le téléphone était un piège dont on ne
 * s'apercevait qu'en ratant un cours.
 *
 * Les deux écrans publics portent la phrase : la question, puis « c'est fait ». Le scénario les
 * traverse et remet les rappels en service derrière lui, pour rendre le jeu de démonstration tel
 * qu'il l'a trouvé.
 */

// Playwright ne charge pas `.env` (c'est Next qui le fait, pour le serveur) : sans lui, le jeton
// serait signé avec un secret vide et la page répondrait « Lien non valide ».
if (!process.env.SESSION_SECRET) process.loadEnvFile();

/** Le jeton du pied des emails de rappel : un `{uid, exp}` signé (voir src/lib/notifications/desinscription.ts). */
function jetonDesinscription(userId: string): string {
  return signPayload({ uid: userId, exp: Date.now() + 3_600_000 }, process.env.SESSION_SECRET!, "desinscription");
}

/** La promesse en toutes lettres, la même des deux côtés (`PHRASE_DESINSCRIPTION`). */
const LES_DEUX_CANAUX = /ni email de rappel, ni notification sur le téléphone/;

test("la désinscription annonce qu'elle coupe l'email et le téléphone", async ({ page }) => {
  // Le lien ne connaît qu'un identifiant : on va le chercher là où l'application le montre.
  await connecter(page, COMPTES.admin, "/admin/membres");
  const fiche = await page.getByRole("link", { name: "Charlie 03" }).first().getAttribute("href");
  const userId = fiche!.split("/").pop()!;
  expect(userId).toBeTruthy();

  // 1. L'écran d'arrivée : la question, et ce qu'elle emporte.
  await page.goto(`/desinscription/${jetonDesinscription(userId)}`);
  await expect(page.getByRole("heading", { name: /Ne plus recevoir les rappels/ })).toBeVisible();
  await expect(page.getByText(LES_DEUX_CANAUX)).toBeVisible();

  // 2. « C'est fait » : la même phrase, parce que c'est là qu'on relit ce qu'on vient de faire.
  await page.getByRole("button", { name: "Ne plus recevoir les rappels" }).click();
  await page.waitForURL(/etat=inactif/);
  await expect(page.getByText("Tu ne recevras plus les rappels.")).toBeVisible();
  await expect(page.getByText(LES_DEUX_CANAUX)).toBeVisible();

  // 3. Le retour en arrière existe, et il nomme lui aussi les deux canaux.
  await page.getByRole("button", { name: "Réactiver les rappels" }).click();
  await page.waitForURL(/etat=actif/);
  await expect(page.getByText(/par email et sur ton téléphone/)).toBeVisible();
});
