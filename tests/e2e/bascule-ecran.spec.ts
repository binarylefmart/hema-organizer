import { expect, test, type Page } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **La bascule téléphone / ordinateur suit le pilotage, pas seulement la largeur**
 * (`src/components/ui/ecran.ts`) : une tablette couchée de 1 180 px, au doigt, reçoit la version
 * téléphone dans sa colonne de 40 rem ; un ordinateur de 1 280 px sans écran tactile reçoit la version
 * ordinateur. Playwright émule `(pointer: coarse)` dès que le contexte a `hasTouch`.
 *
 * Le cookie `ecran` est vérifié au passage : posé par le navigateur, il fait rendre au **serveur** la
 * bonne version d'un écran qui bascule par `useEcranTelephone` (ici l'onglet Atelier, dont la version
 * téléphone porte « + Proposer un atelier »). On le lit dans le HTML brut, avant toute hydratation.
 */

const barreDuBas = (page: Page) => page.locator('nav[aria-label="Menu principal"]');
const ongletEntete = (page: Page) => page.locator('header nav[aria-label="Menu"] a[href="/seances"]');

async function formatRetenu(page: Page): Promise<string | undefined> {
  return (await page.context().cookies()).find((c) => c.name === "ecran")?.value;
}

async function htmlServeur(page: Page, chemin: string): Promise<string> {
  const reponse = await page.request.get(chemin);
  expect(reponse.ok()).toBe(true);
  return reponse.text();
}

test.describe("tablette couchée, au doigt", () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

  test("reçoit la version téléphone, dans une colonne de 40 rem, et le serveur s'en souvient", async ({ page }) => {
    await connecter(page, COMPTES.membre, "/seances");
    await expect(barreDuBas(page)).toBeVisible();
    await expect(ongletEntete(page)).toBeHidden();
    const largeur = (await page.locator("main").boundingBox())?.width ?? 0;
    expect(largeur, "la colonne du téléphone, pas la page entière").toBeLessThanOrEqual(640.5);
    await expect.poll(() => formatRetenu(page)).toBe("tel");

    // Avec le cookie, le premier rendu du serveur est déjà celui du téléphone.
    expect(await htmlServeur(page, "/ateliers")).toContain("data-proposer-atelier");

    // Sans lui (première visite), le serveur part de l'ordinateur, et le navigateur corrige au montage.
    await page.context().clearCookies({ name: "ecran" });
    expect(await htmlServeur(page, "/ateliers")).not.toContain("data-proposer-atelier");
    await page.goto("/ateliers");
    await expect(page.locator("[data-proposer-atelier]")).toBeVisible();
    await expect.poll(() => formatRetenu(page)).toBe("tel");
  });
});

test.describe("ordinateur, sans écran tactile", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test("reçoit la version ordinateur, et `/admin` ouvre les périodes côté serveur", async ({ page }) => {
    await connecter(page, COMPTES.admin, "/seances");
    await expect(ongletEntete(page)).toBeVisible();
    await expect(barreDuBas(page)).toBeHidden();
    await expect.poll(() => formatRetenu(page)).toBe("ordi");
    expect(await htmlServeur(page, "/ateliers")).not.toContain("data-proposer-atelier");

    const reponse = await page.request.get("/admin", { maxRedirects: 0 });
    expect(reponse.status()).toBeGreaterThanOrEqual(300);
    expect(reponse.headers().location ?? "").toContain("/admin/periodes");
  });
});
