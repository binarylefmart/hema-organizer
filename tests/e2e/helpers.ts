import type { BrowserContext, Page } from "@playwright/test";
import { TOTP_PAS_SECONDES } from "../../src/lib/auth/totp";
import { codeTotpFrais, COMPTES, demoLien } from "../../prisma/comptes";

export const MDP = "demo-organizer-2026";
/** Même secret que dans prisma/seed-demo.ts (compte administrateur). */
export const DEMO_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
export { COMPTES, demoLien } from "../../prisma/comptes";


/**
 * **On ne devine pas le verdict du serveur sur un code TOTP : on l'écoute, et on en redonne un.**
 *
 * Le serveur refuse tout pas de temps inférieur ou égal au dernier accepté, et cette borne vit sur
 * le **compte** (`User.totpDernierPas`), partagée par tous les outils. `codeTotpFrais` tient un
 * registre des pas déjà présentés, mais **dans son propre processus** : il ne sait rien de ce que le
 * seed, la campagne de captures ou un lancement précédent ont déjà brûlé. Et même informé, il ne
 * pourrait rien contre le second cas — un code calculé au pas N, posé dans le champ, puis soumis
 * après que l'horloge a tourné deux fois, sort de la tolérance de ±1 pas.
 *
 * Trois codes sur vingt-six ont été refusés pendant la campagne. Le refus ne se voyait pas : la
 * page ne navigue pas, l'attente consomme le budget entier du test, et l'échec s'écrit sur la ligne
 * qui attendait — donc loin de sa cause.
 *
 * **Deux fausses pistes avant la bonne, et elles se ressemblent :** les deux lisaient l'ÉCRAN.
 * D'abord une course entre `waitForURL` et l'apparition du refus, chaque branche avalant son erreur
 * — or `getByText(/Code incorrect/)` désigne **deux** éléments (le message en tête et celui du
 * champ), donc son attente levait une violation de mode strict que l'avaleur rendait invisible.
 * Ensuite une boucle de sondage, honnête celle-là, mais qui voyait le refus de l'essai **précédent**,
 * encore affiché pendant que le nouvel envoi était en vol : elle comptait deux refus là où le serveur
 * venait d'accepter.
 *
 * Le verdict se lit donc sur la **réponse HTTP de cet envoi-là** : 303 quand Next redirige, 200 quand
 * il re-rend le formulaire avec son erreur. C'est daté du bon envoi et insensible à ce que la page
 * montre encore.
 *
 * Trois essais, et pas davantage : au-delà, ce n'est plus un pas manqué mais un secret qui ne
 * correspond pas, et réessayer indéfiniment masquerait une vraie panne derrière une attente.
 */
async function soumettreCodeTotp(page: Page, secretTotp: string, bouton: string, arrivee: (u: URL) => boolean): Promise<void> {
  for (let essai = 1; ; essai++) {
    await page.getByLabel("Code à 6 chiffres").fill(await codeTotpFrais(secretTotp));
    /*
     * **Le verdict se lit sur la réponse, pas sur l'écran.** Une version intermédiaire guettait
     * l'apparition du texte « Code incorrect » : elle voyait celui de l'essai PRÉCÉDENT, encore à
     * l'écran pendant que le nouvel envoi était en vol, et comptait un second refus alors que le
     * serveur venait d'accepter (303). Le troisième tour cherchait alors un champ de code sur une
     * page qui n'en avait plus, et le test mourait sur `locator.fill` — très loin de sa cause.
     *
     * Next répond **303** quand il redirige (code accepté) et **200** quand il re-rend le formulaire
     * avec son erreur : la distinction est nette, datée du bon envoi, et insensible à ce que l'écran
     * montre encore.
     */
    const envoi = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/connexion"));
    await page.getByRole("button", { name: bouton }).click();
    const reponse = await envoi;
    if (reponse.status() !== 200) {
      await page.waitForURL(arrivee);
      return;
    }
    /*
     * **Un refus sous charge n'est pas un secret faux**. Le code est calculé au plus tard — juste
     * avant de remplir —, mais le trajet remplissage → clic → vérification par le serveur peut
     * dépasser les 30 s de la fenêtre quand la machine compile en même temps : le code arrive alors
     * **périmé**, et trois « codes frais » d'affilée peuvent tous arriver trop tard. Le message
     * d'avant concluait « le secret ne correspond pas », ce qui a envoyé chercher une fuite
     * d'anonymisation là où il n'y avait qu'une machine lente.
     *
     * On attend donc le **début de la fenêtre suivante** avant de recommencer : le code suivant a
     * alors trente secondes devant lui, au lieu de ce qui restait de la précédente. Et on laisse cinq
     * essais plutôt que trois — chacun coûte une seconde d'attente, pas plus.
     */
    if (essai >= 5) {
      throw new Error(
        "Cinq codes TOTP refusés d'affilée. Deux causes possibles, dans cet ordre : la machine met " +
          "plus de 30 s entre le calcul du code et sa vérification (campagne lancée en parallèle d'autre " +
          "chose ?), ou le secret du compte ne correspond plus au jeu d'essai (une reconfiguration de " +
          "2FA laissée en place par un scénario précédent — une base vierge le dit tout de suite).",
      );
    }
    const resteDeLaFenetre = TOTP_PAS_SECONDES * 1000 - (Date.now() % (TOTP_PAS_SECONDES * 1000));
    await page.waitForTimeout(resteDeLaFenetre + 500);
  }
}

/**
 * **On ne se reconnecte pas vingt et une fois — mais on repasse la porte de l'espace admin à chaque
 * fois.**
 *
 * Mesuré sur la campagne : vingt et une connexions d'administrateur, douze à vingt secondes chacune
 * — quatre à sept minutes sur vingt-deux, rien que pour entrer. On garde donc les cookies de la
 * première et on les repose dans le contexte suivant, comme le fait déjà le script de captures
 * (`etatConnecte`).
 *
 * **Ce qui se garde est la session ORDINAIRE, jamais l'élévation.** La première version gardait les
 * deux, et `gestion.spec.ts` l'a démentie aussitôt : le journal d'audit se chargeait, puis la page
 * repartait sur l'accueil au milieu de l'assertion. Ce n'était pas un défaut du cache, c'était
 * l'application qui tenait parole. Playwright **ferme un contexte par test** ; la page se décharge,
 * et le `sendBeacon` de « j'ai quitté l'application » part (`/api/admin/quitter`). Une élévation qui
 * survivrait à ce geste serait une élévation que l'application promet de refermer — autant dire que
 * le raccourci aurait commencé par désarmer la fonctionnalité qu'il traverse. On repasse donc
 * `/connexion/admin` à chaque scénario d'administration : un code au lieu de deux, et la porte reste
 * une porte.
 *
 * **On demande à l'application, on ne suppose pas.** Les sessions tombent d'elles-mêmes (douze
 * heures) et plusieurs tests les révoquent exprès — `zz-liens` régénère tous les liens. Un appel sur
 * « Mon profil » dit en un coup si l'état vaut encore quelque chose ; sinon on se reconnecte pour de
 * bon et on remplace le cache. Le raccourci se répare tout seul au lieu de propager une session morte.
 */
let sessionAdmin: { cookies: Awaited<ReturnType<BrowserContext["cookies"]>> } | null = null;

async function reprendreSessionAdmin(page: Page): Promise<boolean> {
  if (!sessionAdmin) return false;
  await page.context().addCookies(sessionAdmin.cookies);
  const reponse = await page.request.get("/profil", { maxRedirects: 0 }).catch(() => null);
  if (reponse?.status() === 200) return true;
  await page.context().clearCookies();
  sessionAdmin = null;
  return false;
}

/**
 * Connexion d'un compte de démo : par lien personnel (membres, instructeurs),
 * ou par mot de passe + code de double authentification (compte administrateur).
 */
export async function connecter(page: Page, email: string, suite?: string, elever = true): Promise<void> {
  if (email === COMPTES.admin) {
    await connecterAdmin(page, email, MDP, DEMO_TOTP_SECRET, suite, elever);
    return;
  }
  await page.goto(`/invitation/${demoLien(email)}`);
  await page.getByRole("button", { name: "Ouvrir l'application" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/invitation"));
  if (suite) await page.goto(suite);
}

/** Connexion administrateur en deux temps (le code est calculé à partir du secret connu). */
export async function connecterAdmin(page: Page, email: string, mdp: string, secretTotp: string, suite?: string, elever = true): Promise<void> {
  if (await reprendreSessionAdmin(page)) {
    if (elever) await elevationAdmin(page, mdp, secretTotp);
    await page.goto(suite ?? "/");
    return;
  }
  await page.goto(suite ? `/connexion?suite=${encodeURIComponent(suite)}` : "/connexion");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(mdp);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/connexion/code");
  await soumettreCodeTotp(page, secretTotp, "Se connecter", (u) => u.pathname === "/connexion/admin" || !u.pathname.startsWith("/connexion"));
  /*
   * **La connexion n'ouvre plus l'espace admin** : on passe donc la porte tout de suite, comme le
   * fait Delta. Sans cela, chaque scénario d'administration se retrouverait déposé sur
   * `/connexion/admin` au premier écran visé.
   *
   * Le parcours de réglage (`/admin/activer`) fait exception : il *sert* à obtenir l'élévation, et
   * `elever` y serait renvoyé en boucle. Les scénarios qui le visent passent `elever: false`.
   */
  // Photographiée AVANT l'élévation : c'est la session ordinaire que l'on garde (voir plus haut).
  sessionAdmin = { cookies: await page.context().cookies() };
  if (elever) await elevationAdmin(page, mdp, secretTotp);
  if (suite && new URL(page.url()).pathname !== suite) await page.goto(suite);
}

/**
 * Passe la porte de l'espace admin : mot de passe et code redonnés sur `/connexion/admin`. Déjà
 * élevé, l'écran renvoie ailleurs — l'appel est alors sans effet.
 */
export async function elevationAdmin(page: Page, mdp: string, secretTotp: string): Promise<void> {
  await page.goto("/connexion/admin");
  if (new URL(page.url()).pathname !== "/connexion/admin") return;
  await page.getByLabel("Mon mot de passe").fill(mdp);
  await soumettreCodeTotp(page, secretTotp, "Ouvrir l'espace admin", (u) => !u.pathname.startsWith("/connexion"));
}

export async function deconnecter(page: Page): Promise<void> {
  await page.goto("/profil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL("**/connexion");
}
