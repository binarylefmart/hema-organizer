import { expect, test } from "@playwright/test";
import { COMPTES, demoLien } from "./helpers";

/*
 * **Le nom du fichier compte, et il n'est pas décoratif.** Playwright exécute les scénarios dans
 * l'ordre des noms de fichiers, et `zz-liens.spec.ts` **régénère tous les liens personnels** d'une
 * période — ce qui révoque le jeton de démonstration que ce scénario-ci ouvre. Nommé `zzz-…`, il
 * passait après : la page du lien ne portait plus de bouton, et le scénario échouait dans la campagne
 * complète tout en passant seul. Il se nomme donc comme son voisin de sujet, `invitation.spec.ts`,
 * et s'exécute avec lui.
 */
/**
 * **Le lien personnel ouvre la session même sans JavaScript** — et ce scénario existe à cause d'un
 * défaut vécu, pas par principe.
 *
 * Le, une relecture de sécurité a posé `Referrer-Policy: no-referrer` sur toute réponse, pour que
 * le jeton d'un lien personnel ne parte plus dans le référent des sous-ressources de
 * `/invitation/<jeton>`. L'argument tenait pour tout lecteur de `Referer`… sauf un : **le
 * navigateur lui-même**. Avec `no-referrer`, Chrome envoie `Origin: null` sur un **POST de
 * formulaire**, et le contrôle anti-CSRF de Next.js ouvre par `new URL(req.headers['origin'])` —
 * `TypeError: Invalid URL`, **500**. Delta, le soir : « des fois le changement ne se fait pas ».
 *
 * Pourquoi « des fois » : une fois la page hydratée, React envoie l'action en `fetch` et tout passe. Le
 * POST natif — celui de l'amélioration progressive, donc **un téléphone lent ou un doigt rapide** — est
 * le seul chemin touché. Un scénario qui clique « vite » serait une loterie ; on coupe donc JavaScript,
 * ce qui rend ce chemin **déterministe** : c'est exactement celui du bouton avant hydratation.
 *
 * Ce que ce test garde, au fond : la porte d'entrée de tout le club ne dépend pas de l'arrivée du
 * JavaScript. Et il échoue si quelqu'un remet `no-referrer` (que `tests/unit/entetes-securite.test.ts`
 * interdit par ailleurs).
 */
test.use({ javaScriptEnabled: false });

test("l'appui sur « Ouvrir l'application » connecte sans JavaScript", async ({ page }) => {
  await page.goto(`/invitation/${demoLien(COMPTES.instructeur)}`);
  const bouton = page.getByRole("button", { name: "Ouvrir l'application" });
  await expect(bouton, "la page du lien se rend côté serveur").toBeVisible();

  await bouton.click();
  await page.waitForURL((u) => !u.pathname.startsWith("/invitation"));

  // On est entré : plus sur la page du lien, et pas renvoyé à la connexion.
  expect(new URL(page.url()).pathname).not.toMatch(/^\/(invitation|connexion)/);
  // Et surtout pas la page d'erreur de Next, qui était la vraie réponse avant la correction.
  await expect(page.locator("body")).not.toContainText("Application error");
});
