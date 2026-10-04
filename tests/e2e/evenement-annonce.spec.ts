import { expect, test } from "@playwright/test";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { COMPTES, connecter } from "./helpers";

/**
 * **Une annonce ne part qu'au moment où l'événement devient public.**
 *
 * `modifierEvenement` n'appelle `notifierNouvelEvenement` que si l'annonce vient de passer en
 * publié (`vientDEtrePublie`). Toute autre écriture — horaire déplacé, lieu confirmé, faute de
 * frappe — ne doit écrire aucun email : corriger une annonce n'est pas l'annoncer une seconde fois,
 * et le club recevrait sinon un message à chaque relecture.
 *
 * On le prouve par le disque : la suite tourne avec `EMAIL_MODE_FICHIER=1` (voir
 * `playwright.config.ts`), donc chaque email part dans `previews/emails/` sous le nom de sa clé de
 * déduplication — `evenement_email_<événement>_<personne>`. La publication doit y écrire un fichier
 * par membre ; la correction qui suit, aucun.
 */

const DOSSIER_EMAILS = path.join(process.cwd(), "previews", "emails");

/** Les emails d'annonce déjà écrits (le dossier n'est jamais vidé entre deux campagnes). */
async function emailsDAnnonce(): Promise<string[]> {
  const fichiers = await readdir(DOSSIER_EMAILS).catch(() => [] as string[]);
  return fichiers.filter((f) => f.includes("evenement_email_") && f.endsWith(".txt")).sort();
}

/** Dans un mois : un événement déjà passé ne s'annonce pas (`evenementTermine`), il ne prouverait rien. */
function dansUnMois(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Le facteur travaille **hors** de l'aller-retour de l'action, un email à la fois : entre le premier
 * fichier d'une annonce et le douzième, il s'écoule plusieurs secondes. Relever la liste trop tôt
 * aurait fait passer la fin de l'envoi précédent pour un envoi de la modification — et relever une
 * seule fois après un geste qui ne doit rien envoyer aurait dit « rien » de ce qui n'était qu'en
 * retard. On attend donc que la file se taise : deux relevés identiques à trois secondes d'écart.
 */
const DELAI_FILE_EMAILS = 3_000;

async function emailsAuRepos(): Promise<string[]> {
  let precedent = await emailsDAnnonce();
  for (let i = 0; i < 12; i++) {
    await new Promise((f) => setTimeout(f, DELAI_FILE_EMAILS));
    const actuel = await emailsDAnnonce();
    if (actuel.length === precedent.length) return actuel;
    precedent = actuel;
  }
  throw new Error("La file d'emails n'arrête plus d'écrire : il se passe autre chose que l'annonce attendue.");
}

test("publier une annonce écrit les emails, la corriger ensuite n'en écrit aucun", async ({ page }) => {
  // Deux attentes de file d'envoi (douze membres, un email à la fois) ne tiennent pas dans la minute
  // habituelle : ce scénario passe son temps à regarder un dossier se remplir, puis se taire.
  test.setTimeout(120_000);
  const nom = `Stage e2e ${Date.now()}`;
  await connecter(page, COMPTES.instructeur, "/evenements/nouveau");

  // 1. La publication annonce — c'est le contrôle positif, sans lequel la suite passerait au vert
  //    sur une sonde qui ne regarde rien.
  await page.getByLabel("Nom de l'événement").fill(nom);
  await page.getByLabel("Date de début").fill(dansUnMois());
  await page.getByRole("button", { name: "Publier l'événement" }).click();
  // **La création dépose sur l'annonce** : le message « Événement créé. » a disparu avec l'écran
  // qu'on quittait — rester dessus laissait un formulaire à moitié vidé sous une alerte verte.
  await page.waitForURL(/\/evenements\/[^/]+$/);

  await page.goto("/gestion/evenements");
  const fiche = await page.getByRole("link", { name: nom }).first().getAttribute("href");
  expect(fiche).toMatch(/^\/evenements\/[A-Za-z0-9_-]+$/);
  const idEvenement = fiche!.split("/").pop()!;
  await expect
    .poll(async () => (await emailsDAnnonce()).filter((f) => f.includes(`evenement_email_${idEvenement}_`)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const apresPublication = await emailsAuRepos();

  // 2. La correction d'après — le lieu confirmé, l'horaire déplacé — ne renvoie rien à personne :
  //    ni au club, ni à qui vient d'être prévenu.
  await page.goto(`${fiche}/modifier`);
  await page.getByLabel("Lieu").fill("Gymnase municipal");
  await page.getByLabel("Nom de l'événement").fill(`${nom} (horaire corrigé)`);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Événement enregistré.")).toBeVisible();
  expect(await emailsAuRepos(), "corriger une annonce publiée ne la réannonce pas").toEqual(apresPublication);
});
