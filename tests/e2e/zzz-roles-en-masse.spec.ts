import { expect, test } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Changer le rôle de plusieurs comptes d'un coup**.
 *
 * En début de saison, le bureau fait sept instructeurs : c'étaient sept listes déroulantes à
 * retrouver au milieu de l'annuaire. Le geste devient : cocher, puis choisir.
 *
 * Ce que ce scénario garde, et qu'aucune capture d'écran ne montrerait :
 *
 * - **le rôle ADMIN est hors de portée, dans les deux sens** : un administrateur affiché n'a **pas
 *   de case** — et l'écran dit **pourquoi**, plutôt que de le laisser être rétrogradé en silence ou
 *   de proposer une case qui échouerait à l'usage ;
 * - **la sélection ne porte que sur ce qui est affiché** : la recherche en cours, et la case
 *   maîtresse le dit (« Sélectionner les 2 résultats »). Le mot « Tout » ne s'écrit nulle part ;
 * - **la confirmation sépare qui change de qui porte déjà le rôle** : les confondre gonflerait le
 *   chiffre censé faire hésiter ;
 * - **le geste unitaire et le geste de masse partagent leur journal** : `membre.role_modifie`, une
 *   entrée par personne réellement modifiée.
 *
 * Le lot est **volontairement composé par une recherche** (« Foxtrot », trois comptes du jeu de
 * démonstration dont un administrateur) : c'est le cas où un « Tout » mentirait, et c'est aussi ce
 * qui permet de tout remettre en place à la fin — la campagne suivante doit retrouver l'annuaire tel
 * que le seed l'a écrit.
 */

const MAITRESSE_TROIS_RESULTATS = "Sélectionner les 3 résultats";
/**
 * **La phrase qui explique une ligne sans case ne parle plus des administrateurs**.
 *
 * Elle a existé en deux temps. Le 30/09, un administrateur n'avait **pas** de case : changer son rôle
 * l'aurait rétrogradé en silence, les trois rôles étant exclusifs. Le 01/10, « admin » est devenu un
 * **supplément** — changer le rôle de base d'un membre du bureau ne lui retire plus rien —, donc
 * l'exclusion n'a plus d'objet et la case revient. Ce qui reste sans case, c'est **son propre compte**
 * (on n'agit pas sur soi) et un compte du bureau qu'on n'a pas le droit de modifier.
 */
const INVITE_SANS_SELECTION = "Coche des lignes pour agir sur plusieurs personnes à la fois";

/**
 * Choisit un rôle dans le volet de la barre, puis applique — au téléphone, seul format de la campagne.
 *
 * La barre sombre du bas ouvre le volet « Que faire sur ces N comptes ? » ; on y choisit « Changer le
 * rôle… », puis le rôle **en deux boutons** (Membre, Instructeur), puis on appuie sur le bouton du bas
 * — **le seul qui écrit**. Choisir le rôle n'applique rien : un rôle effleuré écrirait sur tout le lot.
 * Tant qu'aucun rôle n'est choisi, ce bouton dit « Appliquer le rôle » et reste inerte.
 */
async function appliquerRole(page: import("@playwright/test").Page, libelle: string): Promise<void> {
  const barre = barreRoles(page);
  await barre.getByRole("button", { name: /^Que faire sur ces \d+ comptes \?$/ }).click();
  const volet = page.getByRole("dialog", { name: /^Que faire sur / });
  await expect(volet).toBeVisible();
  await volet.getByRole("button", { name: /^Changer le rôle/ }).click();
  await expect(volet.getByRole("button", { name: "Appliquer le rôle" })).toBeDisabled();
  const role = volet.getByRole("button", { name: libelle, exact: true });
  await role.click();
  await expect(role).toHaveAttribute("aria-pressed", "true");
  await volet.getByRole("button", { name: /^Passer \d+ comptes? en/ }).click();
}

/** La barre d'action de l'annuaire (la jumelle de celle des présences). */
function barreRoles(page: import("@playwright/test").Page) {
  return page.getByRole("group", { name: "Agir sur plusieurs comptes à la fois" });
}

/**
 * La ligne d'un compte dans l'annuaire.
 *
 * **C'était une liste de `<li>` ; c'est un tableau** (cinq colonnes : case, nom et pastilles,
 * email, état du lien, « Gérer »), et ce scénario est tombé là-dessus — `locator("li")` résolvait
 * zéro élément, sur une assertion dont le message disait pourtant « il a bien changé de rôle en
 * base ». La leçon n'est pas la ligne corrigée, c'est le **choix du sélecteur** : on désigne la
 * ligne par sa balise de rangée (`tr`) et non par son rôle d'accessibilité (`row`), parce que un
 * locator CSS ne dépend d'aucun rendu. **Et la raison que j'avais d'abord écrite était fausse** :
 * je prétendais qu'un `<tr>` en `display: block` perd son rôle `row`, ce que deux relectures ont
 * mesuré faux — le moteur de rôles de Playwright se calcule sur le DOM et **ignore le CSS** (`row =
 * 12` à 390 px). Ce qui disparaît au doigt, c'est `columnheader`, et parce que le `<thead>` est
 * `hidden`. Le choix du locator reste le bon ; sa justification, elle, aurait envoyé le prochain
 * lecteur sur une fausse piste — et une raison fausse dans un commentaire finit par servir
 * d'argument à quelqu'un.
 *
 * Le rôle, lui, se lit toujours sur une **pastille** (« Instructeur », « admin »), et **un membre
 * n'en porte aucune** : c'est le rôle ordinaire, l'écrire sur chaque ligne ne dirait rien. La liste
 * déroulante de rôle vit dans le volet « Gérer » de la ligne, donc replié.
 */
function ligneCompte(page: import("@playwright/test").Page, nom: string) {
  return page.locator("tr").filter({ hasText: nom }).first();
}

/**
 * La pastille de rôle **visible** sur une ligne. Le filtre de visibilité n'est pas une précaution
 * d'écriture : le volet « Gérer » de la ligne est un `<details>` replié, et le déclencheur de sa
 * liste déroulante de rôle (`SelecteurRole`, un bouton `combobox`) affiche lui aussi « Membre » ou
 * « Instructeur ». Sans lui, « aucune pastille » serait toujours faux.
 */
function pastilleRole(page: import("@playwright/test").Page, nom: string, role: string | RegExp) {
  return ligneCompte(page, nom)
    .getByText(role, { exact: typeof role === "string" })
    .filter({ visible: true });
}

test("changer le rôle par lots : un compte du bureau garde sa case, et son bureau", async ({ page }) => {
  // L'annuaire et sa zone de sélection : première compilation de l'écran le plus lourd de l'espace admin.
  test.setTimeout(180_000);
  await connecter(page, COMPTES.admin);

  // Trois « Foxtrot » dans le jeu de démonstration : 06 (administrateur), 07 (instructeur),
  // 08 (membre). Deux sont réglables, un ne l'est pas — exactement la situation à décrire.
  await page.goto("/admin/membres?q=Foxtrot");
  // Le lien de la ligne, et non le texte : le nom est écrit trois fois par ligne (le lien, le titre
  // du volet « Gérer », le libellé du champ email qu'il contient).
  await expect(page.getByRole("link", { name: "Foxtrot 06" })).toBeVisible({ timeout: 30_000 });

  /*
   * Rien n'est coché : **la barre n'est pas là**, et c'est la phrase posée à côté des cases qui dit ce
   * qu'elles permettent. Deux décisions successives, et les deux tiennent : le 30/09 la barre a été
   * montée toujours, inerte, parce que « des cases à cocher ne disent rien de ce qu'elles
   * permettent » ; le 01/10, capture en main, elle ne se montre plus qu'avec une sélection — sur
   * 390 px, inerte, elle mangeait trois lignes de la liste qu'on vient lire. La phrase, elle, est
   * restée : elle a juste changé de place.
   */
  await expect(barreRoles(page)).toHaveCount(0);
  // Éteint, l'interrupteur « Sélection multiple » cache cases, case maîtresse et phrase d'invite.
  await expect(page.getByLabel(MAITRESSE_TROIS_RESULTATS)).toHaveCount(0);
  await expect(page.getByLabel("Sélectionner Foxtrot 08")).toHaveCount(0);
  await page.getByRole("switch", { name: /Sélection multiple/ }).check();
  await expect(page.getByText(INVITE_SANS_SELECTION)).toBeVisible();

  // La case maîtresse nomme ce qu'elle emporte : les **résultats** de la recherche, et leur nombre.
  const maitresse = page.getByLabel(MAITRESSE_TROIS_RESULTATS);
  await expect(maitresse).toBeVisible();
  await expect(page.getByText(/Sélectionner tout/)).toHaveCount(0);
  /*
   * **Les trois ont une case, le compte du bureau compris**. C'est l'inverse de la veille, et ce
   * n'est pas un relâchement : le motif de l'exclusion était la rétrogradation silencieuse —
   * changer le rôle retirait le bureau —, et « admin » est devenu un supplément que
   * `definirRolesEnMasse` ne touche jamais (il écrit `data: { role }`, et rien d'autre).
   * L'exclusion était d'ailleurs plus stricte en masse qu'à l'unité, la fiche offrant les mêmes
   * gestes.
   */
  for (const nom of ["Foxtrot 06", "Foxtrot 07", "Foxtrot 08"]) {
    await expect(page.getByLabel(`Sélectionner ${nom}`), nom).toHaveCount(1);
  }

  await maitresse.check();
  const barre = barreRoles(page);
  await expect(barre).toBeVisible();
  await expect(barre.getByText("3 comptes sélectionnés")).toBeVisible();

  // La confirmation, lue : 07 est déjà instructeur, 08 non. Les deux populations sont
  // comptées à part, et le journal est rappelé.
  let question = "";
  page.once("dialog", (d) => {
    question = d.message();
    void d.accept();
  });
  /*
   * **Le rôle se choisit dans une liste, et c'est un bouton qui écrit**. C'étaient deux boutons,
   * donc un clic par rôle — mais un rôle simplement **effleuré** dans une liste écrirait sur tout
   * le lot, et cela ne se rattrape pas ligne par ligne. La liste n'applique donc rien au `change`.
   */
  await appliquerRole(page, "Instructeur");

  await expect(page.getByText("2 comptes passés instructeur.")).toBeVisible({ timeout: 30_000 });
  expect(question).toContain("Passer 3 comptes en « Instructeur » ?");
  expect(question).toContain("2 changeront de rôle, 1 l'est déjà.");
  expect(question).toContain("Chaque changement est inscrit au journal, nom par nom.");
  // Le lot est passé : la sélection se vide, donc **la barre disparaît** — elle n'existe qu'avec
  // une sélection.
  await expect(barre).toHaveCount(0);

  await page.reload();
  await expect(pastilleRole(page, "Foxtrot 08", "Instructeur"), "il a bien changé de rôle en base").toHaveCount(1);
  await expect(pastilleRole(page, "Foxtrot 07", "Instructeur"), "et celui qui l'était déjà n'a pas bougé").toHaveCount(1);
  /*
   * **Et le compte du bureau a changé de rôle de base en gardant son bureau** : c'est toute la
   * demande vérifiée de bout en bout. Avant, ce lot l'aurait rétrogradé en silence — raison pour
   * laquelle on lui refusait sa case.
   */
  await expect(pastilleRole(page, "Foxtrot 06", "Instructeur"), "son rôle de base a suivi le lot").toHaveCount(1);
  await expect(pastilleRole(page, "Foxtrot 06", "admin"), "et il est toujours du bureau").toHaveCount(1);

  /*
   * ---- Remise en état : l'annuaire doit repartir tel que le seed l'écrit.
   *
   * **Deux comptes à remettre, et non un** : le lot a emporté 08 *et* 06, dont le rôle de
   * base a suivi (c'est précisément ce qu'on vient de vérifier). Les scénarios suivants de la
   * campagne lisent cet annuaire — celui de 08 régénère son lien — et un état laissé de
   * travers se paie plus loin, sur un autre fichier, ce qui est le plus coûteux des échecs à
   * instruire.
   */
  await page.goto("/admin/membres?q=Foxtrot");
  await expect(page.getByRole("link", { name: "Foxtrot 06" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("switch", { name: /Sélection multiple/ }).check();
  await page.getByLabel("Sélectionner Foxtrot 08").check();
  await page.getByLabel("Sélectionner Foxtrot 06").check();
  page.once("dialog", (d) => void d.accept());
  await appliquerRole(page, "Membre");
  await expect(page.getByText("2 comptes passés membre.")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  // Plus aucune pastille de rôle de base sur leurs lignes : ils sont redevenus des membres ordinaires.
  await expect(pastilleRole(page, "Foxtrot 08", "Instructeur")).toHaveCount(0);
  await expect(pastilleRole(page, "Foxtrot 06", "Instructeur")).toHaveCount(0);
  // Son bureau, lui, n'a jamais bougé : aucun geste de l'annuaire ne le touche.
  await expect(pastilleRole(page, "Foxtrot 06", "admin")).toHaveCount(1);
});

/**
 * **La fiche au téléphone : le rôle de base en curseur à deux positions**, posé sur le rôle actuel.
 * Même action que celle de l'annuaire (`definirRoleMembre`), donc même journal et mêmes refus ;
 * toucher l'autre côté l'applique, et la pastille de la tête de fiche suit. On remet le rôle du seed
 * en sortant.
 */
test("la fiche règle le rôle de base au curseur", async ({ page }) => {
  test.setTimeout(120_000);
  await connecter(page, COMPTES.admin, "/admin/membres?q=Foxtrot");
  // Toute la ligne mène à la fiche : on la touche au bout, pas sur le nom.
  const ligne = ligneCompte(page, "Foxtrot 08");
  const boite = (await ligne.boundingBox())!;
  await ligne.click({ position: { x: boite.width - 24, y: boite.height / 2 } });
  await expect(page.getByRole("heading", { level: 1, name: /Foxtrot 08/ })).toBeVisible({ timeout: 30_000 });

  const curseur = page.getByRole("radiogroup", { name: "Rôle de Foxtrot 08" });
  const position = (role: string) => curseur.getByRole("radio", { name: role, exact: true });
  const choisirRole = (role: string) => position(role).click();
  await expect(position("Membre"), "le curseur part du rôle actuel").toBeChecked();
  await choisirRole("Instructeur");
  // La tête de fiche est relue : sa pastille dit le nouveau rôle.
  await expect(page.getByRole("heading", { level: 1 }).getByText("Instructeur", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(position("Instructeur"), "le rôle est bien écrit en base").toBeChecked();

  // Remise en état.
  await choisirRole("Membre");
  await expect(page.getByRole("heading", { level: 1 }).getByText("Membre", { exact: true })).toBeVisible({ timeout: 30_000 });
});
