import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { connecter, COMPTES } from "./helpers";
import { GRACE_SORTIE_ELEVATION_MS } from "../../src/lib/constants";

/**
 * **L'espace admin se referme tout seul.**
 *
 * Il reposait sur un cookie sans échéance, censé mourir avec le navigateur — sauf que Chrome («
 * Continuer là où vous vous êtes arrêté »), Android et les applications installées le
 * **restaurent** au redémarrage : Delta retrouvait son espace admin ouvert après avoir quitté
 * l'application. L'échéance qui compte vit donc côté serveur, et c'est elle que ce test vérifie :
 * le cookie reste intact, seul le dernier geste recule dans le temps.
 */
const db = new PrismaClient();

test.afterAll(async () => {
  await db.$disconnect();
});

test("quitter l'application referme l'espace admin, mais changer de page ne le referme pas", async ({ page }) => {
  /*
   * **Le plus long des trois** : connexion d'administrateur avec élévation — donc deux codes à deux
   * pas de temps différents —, puis **trois** passages par `/admin/comptes` et un par « Mon
   * profil », deux des écrans les plus lourds à construire en développement. Ses deux voisins
   * tiennent en trente secondes, lui frôlait les soixante : il les dépassait dès que la machine
   * était chargée, et l'échec s'écrivait alors sur l'assertion en vol (« Received string: "" », le
   * contexte étant déjà en train de se fermer) — un message qui envoie chercher une régression de
   * redirection là où il n'y a qu'un budget épuisé.
   */
  test.setTimeout(120_000);
  await connecter(page, COMPTES.admin, "/admin/comptes");
  await expect(page.getByRole("heading", { name: "Comptes administrateurs" })).toBeVisible();
  const compte = await db.user.findUniqueOrThrow({ where: { email: COMPTES.admin } });

  // Ce que fait le navigateur quand la page passe en arrière-plan — **et** quand elle change
  // simplement d'adresse : le même signal part dans les deux cas.
  const prevenu = page.waitForResponse((r) => r.url().includes("/api/admin/quitter"));
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await prevenu;

  // L'application revient tout de suite : la sortie est annulée, l'espace admin tient.
  await page.goto("/admin/comptes");
  await expect(page.getByRole("heading", { name: "Comptes administrateurs" })).toBeVisible();
  const apresRetour = await db.authSession.findFirst({ where: { userId: compte.id }, orderBy: { lastSeenAt: "desc" } });
  expect(apresRetour?.elevationSortieLe).toBeNull();

  // Partie pour de bon : la sortie dépasse la grâce (dix minutes depuis `a429ccf`, deux avant — le
  // test en simulait trois), et l'élévation tombe.
  await db.authSession.updateMany({ where: { userId: compte.id }, data: { elevationSortieLe: new Date(Date.now() - GRACE_SORTIE_ELEVATION_MS - 60 * 1000) } });
  await page.goto("/admin/comptes");
  /*
   * **L'accueil, et non `/connexion/admin`**. Une élévation qui tombe toute seule n'est pas
   * quelqu'un qui veut entrer : lui redemander mot de passe et code, c'est le mettre dehors alors
   * qu'il vient seulement de reprendre son téléphone. On le dépose sur ses prochains cours, avec un
   * mot d'explication, et l'espace admin se rouvre quand il le demande.
   */
  await expect(page).toHaveURL(/\/\?admin=expire/);
  // La session ordinaire n'a pas bougé
  await page.goto("/profil");
  await expect(page.getByRole("heading", { name: "Mon profil" })).toBeVisible();
});

test("dix minutes sans rien faire referment l'espace admin, cookie intact", async ({ page }) => {
  await connecter(page, COMPTES.admin, "/admin/comptes");
  await expect(page.getByRole("heading", { name: "Comptes administrateurs" })).toBeVisible();

  const compte = await db.user.findUniqueOrThrow({ where: { email: COMPTES.admin } });
  await db.authSession.updateMany({
    where: { userId: compte.id },
    data: { elevationVueLe: new Date(Date.now() - 11 * 60 * 1000) },
  });

  // Le navigateur n'a rien perdu : le cookie d'élévation est toujours là
  expect((await page.context().cookies()).some((c) => c.name === "hema_admin")).toBe(true);

  await page.goto("/admin/comptes");
  // Même règle que la sortie : elle est tombée, on n'a rien demandé — on repart de l'accueil.
  await expect(page).toHaveURL(/\/\?admin=expire/);
  await expect(page.getByText(/L'espace admin s'est refermé/)).toBeVisible();
  // …et la session, elle, reste ouverte : on redescend au rang de membre, on n'est pas dehors
  await page.goto("/profil");
  await expect(page.getByRole("heading", { name: "Mon profil" })).toBeVisible();
});

test("l'application qui revient après une longue absence referme l'espace admin sur-le-champ", async ({ page }) => {
  await connecter(page, COMPTES.admin, "/admin/comptes");
  await expect(page.getByRole("heading", { name: "Comptes administrateurs" })).toBeVisible();

  /*
   * Le verrou qui manquait. Les deux échéances vivent côté serveur — mais le serveur n'est consulté
   * que si on lui parle, et une application installée qu'on rouvre restaure sa page sans aucune
   * requête. L'espace admin *paraissait* donc rester ouvert. Au retour, l'application déclare
   * désormais son absence, et le serveur referme.
   */
  const reponse = await page.evaluate(async () => {
    const r = await fetch("/api/admin/quitter?parti=1", { method: "POST", cache: "no-store" });
    return r.status;
  });
  expect(reponse).toBe(204);

  // Le cookie d'élévation a été effacé par la réponse : rien ne subsiste côté navigateur non plus.
  expect((await page.context().cookies()).some((c) => c.name === "hema_admin" && c.value)).toBe(false);

  await page.goto("/admin/comptes");
  await expect(page).toHaveURL(/\/connexion\/admin/);
  // La session ordinaire, elle, n'a pas bougé : on redescend au rang de membre, on n'est pas dehors.
  await page.goto("/profil");
  await expect(page.getByRole("heading", { name: "Mon profil" })).toBeVisible();
});
