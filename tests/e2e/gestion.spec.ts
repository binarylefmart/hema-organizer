import { expect, test, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { COMPTES, connecter } from "./helpers";

const DOSSIER_EMAILS = path.join(process.cwd(), "previews", "emails");

/** Nombre d'emails déjà écrits sur disque pour un type donné (le dossier n'est jamais vidé entre deux campagnes). */
async function compterEmails(type: string): Promise<number> {
  return (await readdir(DOSSIER_EMAILS).catch(() => [] as string[])).filter((f) => f.includes(type)).length;
}

/**
 * Annule la n-ième séance encore annulable de la liste, puis attend que **cette carte-là** propose « Rétablir ».
 *
 * La liste s'ouvre en lecture seule : les gestes d'organisation n'apparaissent qu'en mode modification
 * (`?modifier=1`), au pied de chaque carte, dans « Que veux-tu faire ? ». La carte se retrouve par
 * l'identifiant de sa séance (`data-geste-seance`), qui ne bouge pas, plutôt que par son rang, qui change
 * dès que la séance sort des annulables — et le jeu de démonstration contient déjà une séance annulée.
 */
async function annulerNiemeSeance(page: Page, rang: number, motif: string): Promise<string> {
  await page.goto("/seances?modifier=1");
  // L'onglet Séances n'affiche que les cinq premières cartes : on déplie d'abord, sinon les
  // suivantes ne sont pas dans la page du tout (repli côté client, `ListeSeances`).
  const suite = page.getByRole("button", { name: /Afficher les .* cours suivants/ });
  if (await suite.isVisible().catch(() => false)) await suite.click();
  const gestes = page.locator('[data-annulable="true"]').nth(rang);
  await expect(gestes).toBeVisible();
  const id = await gestes.getAttribute("data-geste-seance");
  await gestes.getByRole("combobox", { name: "Que veux-tu faire ?" }).click();
  await page.getByRole("option", { name: "Annuler la séance" }).click();
  await gestes.getByLabel(/Motif/).fill(motif);
  page.once("dialog", (d) => d.accept());
  await gestes.getByRole("button", { name: "Annuler la séance" }).click();
  await expect(page.locator(`[data-geste-seance="${id}"][data-retablissable="true"]`)).toBeVisible({ timeout: 20_000 });
  annulees.push(id!);
  return id!;
}

/**
 * **Les séances annulées ici sont rétablies à la fin de chaque scénario.** Elles restaient annulées
 * jusqu'au resemage de la campagne suivante, et les fichiers qui passent après en héritaient : le
 * planning ne montre que cinq séances, une séance annulée n'y a pas de case, si bien que « Tous les
 * mardis » de `zzz-planning-en-masse` ne cochait plus, selon le jour de la semaine, que la séance du
 * jeu d'essai à deux parties — et la partie « Cours » seule disparaissait des parties à régler. Un
 * scénario rend la base telle qu'il l'a trouvée.
 */
const annulees: string[] = [];

async function retablirSeance(page: Page, id: string): Promise<void> {
  await page.goto("/seances?modifier=1");
  const suite = page.getByRole("button", { name: /Afficher les .* cours suivants/ });
  if (await suite.isVisible().catch(() => false)) await suite.click();
  const gestes = page.locator(`[data-geste-seance="${id}"][data-retablissable="true"]`);
  await expect(gestes).toBeVisible();
  await gestes.getByRole("combobox", { name: "Que veux-tu faire ?" }).click();
  await page.getByRole("option", { name: "Rétablir la séance" }).click();
  page.once("dialog", (d) => d.accept());
  await gestes.getByRole("button", { name: "Rétablir la séance" }).click();
  await expect(page.locator(`[data-geste-seance="${id}"][data-annulable="true"]`)).toBeVisible({ timeout: 20_000 });
}

test.afterEach(async ({ page }) => {
  while (annulees.length) await retablirSeance(page, annulees.shift()!);
});

/** Gestion : ajout d'une personne (lien envoyé), annulation d'une séance, accès admin réservé. */
test.describe("gestion", () => {
  /*
   * **Ajouter une personne n'envoie plus rien** (`dcb431b`) : le lien part avec le trimestre (trois
   * jours avant son début) ou quand le bureau l'envoie depuis la liste ou la fiche. Ce scénario
   * attendait encore l'ancien « son lien d'accès vient de partir » ; il vérifie maintenant l'inverse —
   * le message le dit, et aucun email d'invitation n'est écrit pour cette adresse.
   */
  test("ajouter une personne n'envoie aucun email", async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await page.goto("/admin/membres");
    const email = `nouvelle.${Date.now()}@club.test`;
    // Au téléphone, le formulaire d'ajout vit dans le volet « + Ajouter », derrière « Une personne » :
    // le même formulaire que la carte de l'ordinateur. On vise le début du libellé et le verbe du
    // bouton, pas leur formulation du jour.
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const ajout = page.getByRole("dialog", { name: "Ajouter" });
    await ajout.getByRole("button", { name: "Une personne" }).click();
    await ajout.getByLabel("Prénom").fill("Nadia");
    await ajout.getByLabel("Nom", { exact: true }).fill("Test");
    await ajout.getByLabel(/^Email/).fill(email);
    await ajout.getByRole("button", { name: /^Ajouter/ }).click();
    await expect(ajout.getByText(/Nadia Test ajouté\(e\)\. Aucun email n'est parti/)).toBeVisible();

    // Laisser à un envoi éventuel le temps d'arriver sur disque, puis vérifier qu'il n'existe pas.
    await page.waitForTimeout(2_000);
    const fichiers = (await readdir(DOSSIER_EMAILS).catch(() => [] as string[])).filter((f) => f.includes("invitation_") && f.endsWith(".txt"));
    for (const f of fichiers) {
      expect(await readFile(path.join(DOSSIER_EMAILS, f), "utf8"), `un lien est parti à ${email}`).not.toContain(`À : ${email}`);
    }
  });

  test("annuler une séance avec un motif la barre dans l'onglet Séances", async ({ page }) => {
    await connecter(page, COMPTES.instructeur);
    // Annulation depuis la liste : la 3e séance annulable (les deux premières servent aux autres tests)
    await annulerNiemeSeance(page, 2, "Test d'annulation e2e");
    // Le motif est visible sur la carte, dans ce même écran : c'est désormais la seule liste
    await expect(page.getByText("Test d'annulation e2e")).toBeVisible();
  });

  test("un instructeur n'accède pas à l'administration technique", async ({ page }) => {
    await connecter(page, COMPTES.instructeur);
    await page.goto("/gestion");
    await page.waitForURL("**/gestion/ateliers"); // les séances ont leur onglet, l&apos;aperçu a rejoint l&apos;accueil
    // Plus personne n'a d'entrée vers l'administration depuis la gestion — un instructeur moins que tout autre
    await expect(page.getByRole("link", { name: "Espace admin" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Périodes" })).toHaveCount(0);
    // `/admin/apropos` et non plus `/admin/parametres` : l'écran « Paramètres techniques/logs » a
    // été découpé (les réglages d'envoi sont partis dans *Notifications*, la fiche technique est
    // devenue *À propos*), et son ancienne adresse ne répond plus du tout. Un 404 ne prouverait
    // rien de la garde : on vise une page de l'espace admin qui existe.
    await page.goto("/admin/apropos");
    await page.waitForURL("**/?acces=refuse");
    // L'annuaire et les trimestres ont rejoint l'espace admin : fermés à l'encadrement, y compris
    // par leur ancienne adresse, qui ne fait que réécrire l'URL (pages « fossiles »).
    await page.goto("/admin/membres");
    await page.waitForURL("**/?acces=refuse");
    await page.goto("/gestion/periodes");
    await page.waitForURL("**/?acces=refuse");
  });

  test("un admin voit l'administration et le journal d'audit", async ({ page }) => {
    await connecter(page, COMPTES.admin);
    // Filtré sur l'action : en fin de campagne, la connexion de l'admin peut être sortie des
    // cinquante dernières entrées, et la première page ne la montrait plus.
    await page.goto("/admin/audit?q=connexion.succes");
    await expect(page.getByRole("heading", { name: "Journal d'audit" })).toBeVisible();
    await expect(page.getByText("connexion.succes").first()).toBeVisible();
  });
});

test("annuler une séance prévient les invités par email", async ({ page }) => {
  await connecter(page, COMPTES.instructeur);
  // Les emails des campagnes précédentes sont encore là : on compte l'avant pour n'observer que les nouveaux
  const avant = await compterEmails("annulation_");
  await annulerNiemeSeance(page, 3, "Test notification annulation");
  // La séance passe « annulée » et un email par invité est écrit dans previews/emails
  await expect.poll(() => compterEmails("annulation_"), { timeout: 20_000 }).toBeGreaterThan(avant);
});
