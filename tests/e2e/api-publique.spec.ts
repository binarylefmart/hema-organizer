import { MEMBRES_CLUB } from "../../prisma/donnees-club";
import { expect, test, type Page } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **L'API publique est fermée tant que personne ne l'a ouverte.**
 *
 * `GET /api/public/prochaines-seances` est la seule route de l'application qui répond **sans
 * compte** : c'est elle que le site WordPress du club interroge. Son interrupteur vit dans l'espace
 * admin (*Notifications → Publication des cours sur le site du club*), et le réglage n'existe pas dans une base neuve —
 * donc la route répond **503**, sans toucher la base. C'est le bon défaut, et il vaut d'être
 * vérifié de bout en bout : une installation fraîche chez un club qui n'a pas de site ne doit pas
 * publier ses lieux, ses thèmes et ses taux à qui passe.
 *
 * Trois choses sont regardées ici, parce que chacune s'est déjà cassée ailleurs dans ce genre de
 * route :
 *
 * 1. **fermée par défaut** — le 503 et son message, plus `Cache-Control: no-store` : un refus mis
 *    en cache par un proxy survivrait à l'ouverture de l'interrupteur ;
 * 2. **ouverte, elle répond** — avec le thème, le niveau et la **description** de chaque partie, et
 *    **aucun nom de membre**, ni dans les séances ni dans le programme (le second instructeur d'une
 *    partie ne sort jamais du club) ;
 * 3. **refermée, elle se retait** — l'interrupteur marche dans les deux sens, et la case voisine
 *    (les alertes de sécurité) n'a pas été emportée au passage par un formulaire qui porte les deux.
 *
 * Le `request` de Playwright est un contexte **sans session** : c'est bien un visiteur anonyme qui
 * appelle, comme le serveur WordPress du club.
 */

const ROUTE = "/api/public/prochaines-seances?limit=3";
const CASE_API = "Publier les prochains cours";
const CASE_ALERTES = "Prévenir les administrateurs, par email et sur le téléphone";

/**
 * **Les noms qui ne doivent jamais sortir, pris dans le jeu d'essai** — et pris en **entier**.
 *
 * Ils étaient écrits à la main, et par nom de famille seul (« 03 », « 02 », « 08 »).
 * Deux défauts, découverts par la campagne de la copie publique :
 *
 *  - **écrits**, ils ne suivaient pas le club : la fabrique du dépôt public renomme les membres, et
 *    ces trois noms-là n'y désignaient plus personne — le test ne gardait donc plus rien ;
 *  - **par nom de famille seul**, l'assertion n'était juste que par chance. Dans le club inventé les
 *    noms de famille sont des nombres (« 03 »), et `2026-10-03` dans une date suffisait à faire
 *    échouer le test sur une fuite qui n'existait pas.
 *
 * On prend donc le **nom complet** et le **prénom** de chaque membre, dérivés de la liste. L'API ne
 * rend jamais un nom de famille seul (elle passe par « Prénom Nom ») : le test garde ses dents, et il
 * les garde dans les deux dépôts.
 */
const NOMS_INTERDITS = [...new Set(MEMBRES_CLUB.flatMap((m) => [`${m.prenom} ${m.nom}`, m.prenom]))];

test("l'API publique est fermée par défaut et répond 503, sans mise en cache du refus", async ({ request }) => {
  const reponse = await request.get(ROUTE);
  expect(reponse.status(), "fermée tant que personne ne l'a ouverte").toBe(503);
  expect(await reponse.json()).toEqual({ erreur: "API publique désactivée" });
  // Un 503 gardé en cache par un proxy survivrait à l'ouverture de l'interrupteur : le site du club
  // continuerait d'afficher « rien » pendant cinq minutes après que le bureau a coché la case.
  expect(reponse.headers()["cache-control"]).toContain("no-store");
});

test("ouverte depuis l'espace admin, elle répond sans jamais nommer personne — et se referme", async ({ page, request }) => {
  // L'écran des notifications monte la matrice entière (canaux × notifications) : première
  // compilation coûteuse, la minute par défaut n'y suffit pas.
  test.setTimeout(120_000);
  await connecter(page, COMPTES.admin, "/admin/notifications");

  // `.last()` : la carte est un `<section>`, et un `<section>` englobant la page entière
  // satisferait le même filtre — on veut la plus intérieure.
  const carte = page.locator("section").filter({ has: page.getByLabel(CASE_API) }).last();
  await expect(carte.getByRole("heading", { name: "Publication des cours sur le site du club" })).toBeVisible();
  /*
   * **Les alertes de sécurité ont leur propre carte**, et c'est tout l'objet de ce relevé : les
   * deux réglages partageaient un formulaire et un bouton « Enregistrer », si bien qu'ouvrir la
   * publication des cours et éteindre les alertes d'accès volé étaient un seul geste. On relève
   * donc l'état de la case voisine **hors** de la carte de publication, et on vérifie à la fin
   * qu'aucun des deux enregistrements ne l'a touchée.
   */
  const carteAlertes = page.locator("section").filter({ has: page.getByLabel(CASE_ALERTES) }).last();
  await expect(carteAlertes.getByRole("heading", { name: "Alertes de sécurité" })).toBeVisible();
  const alertesAvant = await carteAlertes.getByLabel(CASE_ALERTES).isChecked();

  await carte.getByLabel(CASE_API).check();
  await carte.getByRole("button", { name: "Enregistrer" }).click();
  await expect(carte.getByText("Les prochains cours sont publiés.")).toBeVisible();

  /*
   * **On interroge la route jusqu'à ce qu'elle change d'avis, plutôt que le message de l'écran.**
   * « Enregistré. » reste affiché après le premier enregistrement : le relire ne prouverait rien du
   * second. Et c'est la route elle-même qui est le sujet du test.
   */
  await expect.poll(async () => (await request.get(ROUTE)).status(), { timeout: 15_000 }).toBe(200);
  const ouverte = await request.get(ROUTE);
  const corps = await ouverte.json();
  expect(typeof corps.club).toBe("string");
  expect(Array.isArray(corps.seances)).toBe(true);
  expect(corps.seances.length).toBeGreaterThan(0);
  // Une séance publiable : ce qui s'affiche sur un site, et rien de plus.
  expect(corps.seances[0]).toMatchObject({
    date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    lieu: expect.any(String),
    taux: expect.any(Number),
    annulee: expect.any(Boolean),
  });
  // Pas d'identifiant de séance : il distribuait l'adresse des pages de partage, qui affichent
  // l'effectif exact.
  expect(corps.seances[0]).not.toHaveProperty("id");
  // Et aucun nom, nulle part dans la réponse : ni un présent, ni un instructeur, ni un animateur.
  const texte = await ouverte.text();
  for (const nom of NOMS_INTERDITS) expect(texte, `« ${nom} » ne doit pas sortir du club`).not.toContain(nom);

  /*
   * **La description d'une partie sort par cette porte, et elle seule**. C'est du texte sur le
   * contenu du cours, de la même nature que le thème. Ce qu'on vérifie ici de bout en bout : elle
   * est bien là quand l'interrupteur est ouvert — donc le chemin complet base → `partage.ts` →
   * liste blanche de `versSeancePublique` la porte —, et **aucun nom ne l'accompagne** (la boucle
   * juste au-dessus couvre le texte entier de la réponse, description comprise).
   *
   * Le jeu de démonstration en pose deux (`PROGRAMME`, prisma/seed-demo.ts) : une sur la reprise
   * d'épée longue du 1er septembre, une sur l'initiation à la hache du 29. `limit=3` ne ramène que les
   * séances **à venir**, donc on ne cherche pas une phrase précise — on vérifie que la clé existe sur
   * chaque case, avec le bon type, et qu'un texte vide reste une chaîne vide plutôt qu'un `null`.
   */
  const cases = corps.seances.flatMap((s: { programme: unknown[] }) => s.programme);
  for (const c of cases as Array<Record<string, unknown>>) {
    expect(typeof c.description, "chaque case publiée porte sa description, vide ou non").toBe("string");
    // Et surtout : rien qui nomme quelqu'un n'accompagne le programme.
    for (const interdit of ["instructeur", "instructeurSecond", "instructeurId", "animateur"]) {
      expect(Object.keys(c), `« ${interdit} » ne sort pas du club`).not.toContain(interdit);
    }
  }

  // On referme : l'interrupteur doit marcher dans les deux sens, et l'état d'avant est celui du jeu
  // de démonstration — la campagne suivante doit le retrouver tel quel.
  await carte.getByLabel(CASE_API).uncheck();
  await carte.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(async () => (await request.get(ROUTE)).status(), { timeout: 15_000 }).toBe(503);
  // La case de l'autre carte n'a pas bougé sous l'effet des deux enregistrements.
  await page.reload();
  expect(await page.getByLabel(CASE_ALERTES).isChecked()).toBe(alertesAvant);
});

/**
 * **Les annonces du club sur son site**.
 *
 * Demande de Delta : « donne la possibilitée d'exposer les notifications concernant les cours aussi
 * via api (comme pour la selection discord telegram etc) pour publier les infos si besoins sur un
 * site ». D'où un canal de plus dans la matrice — **« Site du club »** — et cette route pour aller le
 * lire. Rien n'y est envoyé : le site vient lire l'état actuel de la base.
 *
 * **Deux portes, et il faut les deux.** C'est tout l'objet de ce parcours, fait de bout en bout parce
 * qu'aucun test unitaire ne peut le prouver : l'interrupteur de publication, la case de la
 * notification, et le chemin complet base → matrice → liste blanche → JSON.
 *
 * Quatre états, chacun la contre-épreuve du suivant :
 *
 * 1. **fermé** (l'état livré) : `503`, sans mise en cache du refus ;
 * 2. **publication ouverte, aucune case cochée** : `200` et `annonces: []`. Ce n'est pas une erreur —
 *    le club publie son calendrier, il n'a simplement autorisé aucune republication ;
 * 3. **la case cochée** : l'annonce sort, et **elle seule** (les deux autres cases restent décochées),
 *    sans aucun nom, sans identifiant interne, et sans le brouillon d'annonce du jeu d'essai ;
 * 4. **la case décochée, puis la publication refermée** : elle ne sort plus, puis `503`.
 *
 * L'état de départ est rendu à la fin (publication fermée, case décochée) : la campagne de captures
 * doit retrouver le jeu de démonstration tel quel.
 */

const ROUTE_ANNONCES = "/api/public/annonces";
/** Le libellé de la colonne dans la matrice (`LIBELLES_CANAUX.api`). */
const CASE_SITE = "Site du club";
/** La ligne de la matrice sur laquelle on coche : celle du nouvel événement (`DESCRIPTIONS`). */
const LIGNE_EVENEMENT = "Nouvel événement";

/**
 * **La ligne d'une notification dans la matrice** — un `tbody`, et non plus un `<li>` : la matrice
 * est un vrai tableau (`MatriceNotifications`).
 *
 * On la désigne par le **texte de son intitulé** et par la balise : un locator CSS ne dépend d'aucun
 * rendu, et il n'y a qu'un seul tableau sur cette page. La cellule, elle, se trouve par le **libellé
 * de sa case** (`getByLabel`), qui reste son nom accessible une fois le nom du canal passé en
 * `lg:sr-only`.
 *
 * **La première version de ce commentaire donnait une autre raison, et elle était fausse** : elle
 * affirmait que `display: block` retire à un `<tr>` son rôle `row`, donc qu'un `getByRole("row")`
 * « passerait sur un écran de bureau et échouerait ici ». Deux relectures l'ont mesuré, dont une dans
 * l'arbre d'accessibilité **réel** de Chromium : à 390 px, `row = 16`, `rowheader = 8`, `table = 1`,
 * et `LayoutTable = 0` — le tableau replié ne perd **pas** ses rôles. La seule rangée qui disparaît
 * est celle du `<thead>`, parce qu'il est `hidden` (d'où `columnheader = 0`). Le locator retenu
 * reste le bon ; la raison, elle, aurait envoyé le prochain lecteur sur une fausse piste — et une
 * raison fausse dans un commentaire finit par servir d'argument à quelqu'un.
 */
function ligneMatrice(page: Page, intitule: string) {
  return page.locator("tbody").filter({ hasText: intitule });
}

/** Les annonces rendues par la route, à l'instant où on la lit. */
type Annonce = { type: string; titre: string; picto: string; evenement?: Record<string, unknown> };
const annoncesDe = (corps: unknown): Annonce[] => (corps as { annonces?: Annonce[] }).annonces ?? [];

test("les annonces ne sortent que derrière les deux portes, et se retirent dans les deux sens", async ({ page, request }) => {
  // Même raison que le test voisin : la matrice entière (notifications × canaux) est un écran coûteux
  // à compiler, et ce parcours l'enregistre deux fois.
  test.setTimeout(150_000);

  // ---- 1. Fermé, comme dans une base neuve.
  const ferme = await request.get(ROUTE_ANNONCES);
  expect(ferme.status(), "fermée tant que personne ne l'a ouverte").toBe(503);
  expect(await ferme.json()).toEqual({ erreur: "API publique désactivée" });
  expect(ferme.headers()["cache-control"]).toContain("no-store");

  await connecter(page, COMPTES.admin, "/admin/notifications");
  const carte = page.locator("section").filter({ has: page.getByLabel(CASE_API) }).last();

  // ---- 2. Publication ouverte, mais aucune case cochée : la porte est ouverte, rien ne la franchit.
  await carte.getByLabel(CASE_API).check();
  await carte.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(async () => (await request.get(ROUTE_ANNONCES)).status(), { timeout: 15_000 }).toBe(200);
  const sansCase = await (await request.get(ROUTE_ANNONCES)).json();
  expect(typeof sansCase.club).toBe("string");
  expect(sansCase.annonces, "ouvrir la publication ne republie aucune annonce à votre place").toEqual([]);

  // ---- 3. La case de la notification : c'est la matrice qui décide du détail.
  await page.reload();
  const ligne = ligneMatrice(page, LIGNE_EVENEMENT);
  // La colonne était grisée et non tapable tant que la publication n'était pas ouverte : elle ne
  // s'active que maintenant, et c'est exactement ce que « deux portes » veut dire.
  await expect(ligne.getByLabel(CASE_SITE)).toBeEnabled({ timeout: 20_000 });
  await ligne.getByLabel(CASE_SITE).check();
  await page.getByRole("button", { name: "Enregistrer les notifications" }).click();
  await expect.poll(async () => annoncesDe(await (await request.get(ROUTE_ANNONCES)).json()).length, { timeout: 15_000 }).toBeGreaterThan(0);

  const ouverte = await request.get(ROUTE_ANNONCES);
  const corps = await ouverte.json();
  const annonces = annoncesDe(corps);
  // **Elle seule** : les cases du récap et de l'annulation sont restées décochées.
  expect([...new Set(annonces.map((a) => a.type))]).toEqual(["evenement_nouveau"]);
  // Le titre est celui des autres canaux (`TITRE_EVENEMENT`), pictogramme rendu à part pour que le
  // site mette l'icône qu'il veut.
  expect(annonces[0].titre).toBe(LIGNE_EVENEMENT);
  expect(annonces[0].picto).toBe("📣");
  const noms = annonces.map((a) => String(a.evenement?.nom ?? ""));
  expect(noms.join(" | ")).toContain("Stage d'épée longue");
  /*
   * **Un brouillon ne sort jamais.** Le jeu de démonstration en pose un (« Démonstration au marché de
   * Noël », `publie: false`) : la route interroge les événements en **lecteur anonyme explicite**, qui
   * ne voit que les annonces publiées. Cocher la case n'ouvre pas les brouillons de l'équipe.
   */
  expect(noms.join(" | "), "un brouillon d'annonce ne se republie pas").not.toContain("marché de Noël");
  // Aucun identifiant interne : la règle qui a fait retirer celui des séances.
  expect(Object.keys(annonces[0].evenement ?? {})).not.toContain("id");
  // Et aucun nom, nulle part dans la réponse : ni membre, ni instructeur, ni qui a saisi l'annonce.
  const texte = await ouverte.text();
  for (const nom of NOMS_INTERDITS) expect(texte, `« ${nom} » ne doit pas sortir du club`).not.toContain(nom);

  // ---- 4a. Contre-épreuve : la case décochée, l'annonce ne sort plus — la route répond toujours.
  await ligne.getByLabel(CASE_SITE).uncheck();
  await page.getByRole("button", { name: "Enregistrer les notifications" }).click();
  await expect.poll(async () => annoncesDe(await (await request.get(ROUTE_ANNONCES)).json()).length, { timeout: 15_000 }).toBe(0);
  expect((await request.get(ROUTE_ANNONCES)).status(), "décocher une case ne casse pas la route").toBe(200);

  // ---- 4b. Et la publication refermée coupe tout, d'un seul geste.
  await carte.getByLabel(CASE_API).uncheck();
  await carte.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(async () => (await request.get(ROUTE_ANNONCES)).status(), { timeout: 15_000 }).toBe(503);
  // L'autre porte du même interrupteur s'est refermée avec : une seule case pour « le club publie-t-il ? ».
  expect((await request.get(ROUTE)).status()).toBe(503);
});

/**
 * **Fermer la publication puis enregistrer la matrice ne doit rien effacer**.
 *
 * La page du canal le promet noir sur blanc : « les cases ne sont pas touchées : elles reprennent
 * effet si la publication est réouverte ». Ce n'était pas vrai, et **seul un vrai navigateur peut le
 * prouver** : publication fermée, les cellules de la colonne sont rendues `disabled`, et une case
 * `disabled` **n'est pas envoyée** dans le formulaire. L'action reconstruisant la matrice entière
 * depuis ce qu'elle reçoit, elle écrivait `false` en base — en silence, puisque le message de succès
 * n'avait rien d'anormal à signaler. Au retour, le bureau devait se souvenir de ce qu'il avait coché.
 *
 * Le parcours reproduit exactement ce geste — routinier et réversible, l'état « non opérationnel » de
 * ce canal se pilotant par une case cochable **sur le même écran, deux cartes plus bas** — et exige
 * que la réouverture retrouve la décision. L'état de départ est rendu à la fin.
 */
test("fermer la publication puis enregistrer la matrice ne vide pas les cases du site du club", async ({ page, request }) => {
  test.setTimeout(180_000);
  await connecter(page, COMPTES.admin, "/admin/notifications");
  const carte = page.locator("section").filter({ has: page.getByLabel(CASE_API) }).last();
  const ligne = () => ligneMatrice(page, LIGNE_EVENEMENT);

  // ---- 1. L'état que le bureau veut garder : publication ouverte, une annonce cochée.
  await carte.getByLabel(CASE_API).check();
  await carte.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(async () => (await request.get(ROUTE_ANNONCES)).status(), { timeout: 15_000 }).toBe(200);
  await page.reload();
  await expect(ligne().getByLabel(CASE_SITE)).toBeEnabled({ timeout: 20_000 });
  await ligne().getByLabel(CASE_SITE).check();
  await page.getByRole("button", { name: "Enregistrer les notifications" }).click();
  await expect.poll(async () => annoncesDe(await (await request.get(ROUTE_ANNONCES)).json()).length, { timeout: 15_000 }).toBeGreaterThan(0);

  // ---- 2. Le geste qui effaçait tout : fermer la publication, puis enregistrer la matrice.
  await page.reload();
  await carte.getByLabel(CASE_API).uncheck();
  await carte.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(async () => (await request.get(ROUTE_ANNONCES)).status(), { timeout: 15_000 }).toBe(503);
  await page.reload();
  // La colonne est grisée **et** `disabled` : c'est là que le navigateur cesse d'envoyer la case.
  await expect(ligne().getByLabel(CASE_SITE)).toBeDisabled({ timeout: 20_000 });
  await page.getByRole("button", { name: "Enregistrer les notifications" }).click();
  await expect(page.getByText(/Notifications enregistrées/)).toBeVisible({ timeout: 20_000 });

  // ---- 3. Réouvrir suffit : la décision d'avant est retrouvée, sans avoir rien à recocher.
  await page.reload();
  await carte.getByLabel(CASE_API).check();
  await carte.getByRole("button", { name: "Enregistrer" }).click();
  await expect
    .poll(async () => annoncesDe(await (await request.get(ROUTE_ANNONCES)).json()).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await page.reload();
  await expect(ligne().getByLabel(CASE_SITE), "la case cochée avant la fermeture doit être retrouvée").toBeChecked();

  // ---- 4. L'état de départ est rendu : case décochée, publication fermée.
  await ligne().getByLabel(CASE_SITE).uncheck();
  await page.getByRole("button", { name: "Enregistrer les notifications" }).click();
  await expect.poll(async () => annoncesDe(await (await request.get(ROUTE_ANNONCES)).json()).length, { timeout: 15_000 }).toBe(0);
  await page.reload();
  await carte.getByLabel(CASE_API).uncheck();
  await carte.getByRole("button", { name: "Enregistrer" }).click();
  await expect.poll(async () => (await request.get(ROUTE_ANNONCES)).status(), { timeout: 15_000 }).toBe(503);
});
