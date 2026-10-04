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
 * Deux pièges déjà rencontrés : le jeu de démonstration contient déjà une séance annulée (un « Rétablir »
 * quelconque était donc visible tout de suite, l'attente ne prouvait rien), et la navigation suivante
 * interrompait l'action serveur avant qu'elle n'aboutisse. On retrouve la carte par le lien de la séance,
 * qui ne bouge pas, plutôt que par son rang, qui change dès que la séance sort de la liste des annulables.
 */
async function annulerNiemeSeance(page: Page, rang: number, motif: string): Promise<void> {
  // L'onglet Séances n'affiche que les cinq premières cartes : on déplie d'abord, sinon les
  // suivantes ne sont pas dans la page du tout (repli côté client, `ListeSeances`).
  const suite = page.getByRole("button", { name: /Afficher les .* cours suivants/ });
  if (await suite.isVisible().catch(() => false)) await suite.click();
  const annulables = page.locator("article").filter({ has: page.getByText("Annuler", { exact: true }) });
  const carte = annulables.nth(rang);
  await expect(carte).toBeVisible();
  const lien = await carte.getByRole("link", { name: "Modifier" }).getAttribute("href");
  await carte.getByText("Annuler", { exact: true }).click();
  await carte.getByLabel(/Motif/).fill(motif);
  await carte.getByRole("button", { name: "Annuler la séance" }).click();
  await expect(page.locator(`article:has(a[href="${lien}"])`).getByRole("button", { name: "Rétablir" })).toBeVisible({ timeout: 20_000 });
}

/** Gestion : ajout d'une personne (lien envoyé), annulation d'une séance, accès admin réservé. */
test.describe("gestion", () => {
  test("ajouter une personne envoie immédiatement son lien d'accès", async ({ page }) => {
    await connecter(page, COMPTES.admin);
    await page.goto("/admin/membres");
    const email = `nouvelle.${Date.now()}@club.test`;
    // Le formulaire d'ajout, et lui seul : chaque ligne de la liste cache aussi un champ « Email de
    // … ». Les libellés y suivent les réglages (l'adresse est facultative depuis l'étape 5 bis, le
    // libellé le dit) : on vise le début du libellé et le verbe du bouton, pas leur formulation du
    // jour. **« Ajouter un membre »** (« remplace ajouter une personne par ajouter un membre ») :
    // le titre de la carte a changé, et ce scénario le visait encore par l'ancien mot — il est
    // resté rouge une soirée, la campagne n'ayant pas tourné entre les deux.
    const ajout = page.locator("section").filter({ has: page.getByRole("heading", { name: "Ajouter un membre" }) }).last();
    await ajout.getByLabel("Prénom").fill("Nadia");
    await ajout.getByLabel("Nom", { exact: true }).fill("Test");
    await ajout.getByLabel(/^Email/).fill(email);
    await ajout.getByRole("button", { name: /^Ajouter/ }).click();
    await expect(page.getByText(/Nadia Test ajouté\(e\) : son lien d'accès vient de partir/)).toBeVisible();

    await expect
      .poll(
        async () => {
          const fichiers = (await readdir(DOSSIER_EMAILS).catch(() => [])).filter((f) => f.includes("invitation_") && f.endsWith(".txt")).sort();
          for (const f of fichiers.reverse().slice(0, 5)) {
            const t = await readFile(path.join(DOSSIER_EMAILS, f), "utf8");
            if (t.includes(`À : ${email}`) && /\/invitation\/[A-Za-z0-9_-]{43}/.test(t)) return true;
          }
          return false;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("annuler une séance avec un motif la barre dans l'onglet Séances", async ({ page }) => {
    await connecter(page, COMPTES.instructeur);
    await page.goto("/seances");
    // Annulation depuis la liste : la 3e séance annulable (les deux premières servent aux autres tests)
    await annulerNiemeSeance(page, 2, "Test d'annulation e2e");
    // Le motif est visible sur la carte, dans ce même écran : c'est désormais la seule liste
    await expect(page.getByText("Test d'annulation e2e")).toBeVisible();
  });

  test("l'autosave du thème enregistre sans bouton", async ({ page }) => {
    await connecter(page, COMPTES.instructeur);
    await page.goto("/seances");
    await page.getByRole("link", { name: "Modifier" }).first().click();
    await page.locator("#theme").fill("Thème autosave e2e");
    await page.locator("#theme").blur();
    await expect(page.getByText("Enregistré automatiquement.")).toBeVisible();
    await page.reload();
    await expect(page.locator("#theme")).toHaveValue("Thème autosave e2e");
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
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "Journal d'audit" })).toBeVisible();
    await expect(page.getByText("connexion.succes").first()).toBeVisible();
  });
});

test("annuler une séance prévient les invités par email", async ({ page }) => {
  await connecter(page, COMPTES.instructeur);
  await page.goto("/seances");
  // Les emails des campagnes précédentes sont encore là : on compte l'avant pour n'observer que les nouveaux
  const avant = await compterEmails("annulation_");
  await annulerNiemeSeance(page, 3, "Test notification annulation");
  // La séance passe « annulée » et un email par invité est écrit dans previews/emails
  await expect.poll(() => compterEmails("annulation_"), { timeout: 20_000 }).toBeGreaterThan(avant);
});
