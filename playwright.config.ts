import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout. Prérequis : base migrée + `npm run db:seed:demo`.
 * Le serveur est démarré automatiquement (npm run dev) s'il ne tourne pas déjà sur le port 3000.
 *
 * **Campagne sur un serveur à soi** : `E2E_NO_WEBSERVER=1` coupe le démarrage automatique, et
 * `E2E_BASE_URL` dit où taper. C'est le seul moyen de lancer la suite pendant qu'une campagne de
 * captures occupe le port 3000 : le serveur visé est alors monté à la main, sur un autre port, avec
 * sa propre base (`DATABASE_URL`) et son propre dossier de compilation (`NEXT_DIST_DIR`) — deux
 * `next dev` sur le même `.next` corrompent la compilation, et la suite crée des comptes et
 * consomme des jetons d'invitation qu'on ne veut pas voir dans la base de démonstration.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  /*
   * **Une minute par scénario, et un cran de plus quand la machine est chargée.**
   *
   * Les écrans sont compilés à la demande par `next dev` : le premier passage sur la fiche d'un
   * membre ou sur celle d'un trimestre coûte plusieurs secondes, et davantage si un second serveur
   * de développement ou une campagne de captures tourne à côté (`GET / 200 in 19s` n'a alors rien
   * d'anormal). `E2E_TIMEOUT=180000` relève le budget sans rien changer à la valeur de référence :
   * ce qui échoue à soixante secondes sur une machine chargée n'est pas une régression, et ce qui
   * échoue à cent quatre-vingts en est une.
   */
  timeout: Number(process.env.E2E_TIMEOUT ?? 60_000),
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: process.env.E2E_NO_WEBSERVER ? undefined : {
    command: "npm run dev",
    // Les tests lisent les emails écrits sur disque : jamais d'envoi réel pendant la suite
    env: { EMAIL_MODE_FICHIER: "1" },
    // `port` (et non `url`) : Playwright réutilise dès que quelque chose écoute sur 3000. Avec `url`, un serveur
    // qui répond mal (404/500) le poussait à en démarrer un second — Next basculait sur 3001 et les deux serveurs
    // se partageaient le même `.next`, ce qui corrompait la compilation. La santé du serveur est vérifiée dans
    // global-setup.ts, qui arrête la suite avec la marche à suivre.
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
