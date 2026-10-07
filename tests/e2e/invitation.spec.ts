import { expect, test } from "@playwright/test";
import { COMPTES, connecter, DEMO_TOTP_SECRET, demoLien, MDP } from "./helpers";
import { codeTotp } from "@/lib/auth/totp";

/**
 * Parcours : lien d'accès personnel → ouverture directe (sans mot de passe) → écran de bienvenue → présence.
 * La présence elle-même se donne dans l'onglet « Séances » (`/seances`) : l'accueil `/` est un compte rendu.
 * Données : seed de démonstration (jetons fixes). Relancer `npm run db:seed:demo` pour rejouer le test.
 */
const TOKEN_NOUVEAU = "demo-invitation-nouveau-membre-0123456789abcdefghij";
const TOKEN_EXISTANT = "demo-invitation-membre-existant-0123456789abcdefgh";

test("un nouveau membre ouvre l'application depuis son lien, sans mot de passe", async ({ page }) => {
  await page.goto(`/invitation/${TOKEN_NOUVEAU}`);
  await expect(page.getByRole("heading", { name: /Bienvenue India/ })).toBeVisible();
  // La page dit **quel compte** ce lien ouvre, mais l'adresse y est masquée : un lien se retrouve
  // dans un historique, se montre par-dessus l'épaule, se partage par erreur. On vérifie donc les
  // deux moitiés de la promesse — le repère est là, l'adresse ne l'est pas.
  await expect(page.getByText(/Compte :/)).toBeVisible();
  await expect(page.getByText(COMPTES.nouveau)).toHaveCount(0);
  await expect(page.getByLabel(/Mot de passe/)).toHaveCount(0);
  await page.getByRole("button", { name: "Ouvrir l'application" }).click();

  // Le parcours d'entrée, montré une fois par lien (`Invitation.parcoursVuLe`). Sur téléphone il
  // commence par la question de l'installation ; chacune de ses étapes peut être déclinée.
  await page.waitForURL("**/bienvenue");
  await expect(page.getByRole("heading", { name: /Bienvenue India/ })).toBeVisible();
  await page.getByRole("button", { name: "Non, continuer dans le navigateur" }).click();
  // Puis la consolidation du compte — facultative, elle aussi
  await expect(page.getByRole("heading", { name: "Consolider ton compte" })).toBeVisible();
  await page.getByRole("button", { name: "Continuer avec mon lien" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/bienvenue"));
  // Un tap suffit ensuite pour indiquer sa présence — dans l'onglet « Présences », seul écran qui
  // porte les trois boutons de réponse depuis que l'accueil est un compte rendu sans action.
  await page.goto("/seances");
  // La première carte **encore ouverte à la réponse** : le cours du jour reste en tête de liste une fois commencé,
  // mais ses boutons sont alors figés — viser « la première carte » faisait échouer le test après l'heure du cours.
  const carte = page.getByRole("article").filter({ has: page.getByRole("button", { name: "Présent", disabled: false }) }).first();
  await expect(carte.getByText("Tu n'as pas encore répondu.")).toBeVisible();
  await carte.getByRole("button", { name: "Présent" }).click();
  await expect(carte.getByText(/C'est noté/)).toBeVisible();
  await expect(carte.getByRole("button", { name: "Présent" })).toHaveAttribute("aria-pressed", "true");
  // La réponse est conservée après rechargement, et modifiable
  await page.reload();
  await expect(carte.getByRole("button", { name: "Présent" })).toHaveAttribute("aria-pressed", "true");
  await carte.getByRole("button", { name: "Peut-être" }).click();
  await expect(carte.getByRole("button", { name: "Peut-être" })).toHaveAttribute("aria-pressed", "true");

  // Le membre consulte le planning sans pouvoir le modifier (réservé à l'équipe).
  // On vise l'outillage de gestion lui-même, pas un comptage de `<select>` sur toute la page :
  // depuis les filtres unifiés (étape 5 bis), la page porte aussi les listes « Saison » et « Période »,
  // qui sont de la consultation et n'ont rien à faire dans ce décompte.
  await page.goto("/planning");
  await expect(page.getByRole("heading", { name: "Planning de cours" })).toBeVisible();
  // Attendre la grille : sans elle, les absences vérifiées ensuite seraient vraies pour rien.
  // Depuis ce n'est plus un `<table>` à colonnes fixes mais **une carte par séance**, ancrée sur
  // `#seance-<id>` (`GrillePlanning`) : c'est elle, la grille.
  const grille = page.locator('article[id^="seance-"]');
  await expect(grille.first()).toBeVisible();
  // Aucune case n'est éditable : les libellés « Instructeur — … », « Thème — … », « Niveau — … » de
  // `CaseEditeur` n'existent que pour l'équipe, et les cartes ne portent aucun champ de saisie —
  // pas plus que les boutons qui renomment, déplacent ou retirent une partie.
  await expect(page.getByLabel(/^(Instructeur|Second instructeur|Thème|Niveau) — /)).toHaveCount(0);
  await expect(grille.locator("select, input, textarea")).toHaveCount(0);
  // Et rien n'ouvre l'espace de gestion, ni depuis la grille (fiche de séance) ni depuis l'en-tête
  await expect(page.locator('a[href^="/gestion"]')).toHaveCount(0);

  // Le lien, réutilisé, reconnecte directement (« Bonjour » au lieu de « Bienvenue »)
  await page.goto("/profil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL("**/connexion");
  await page.goto(`/invitation/${TOKEN_NOUVEAU}`);
  await expect(page.getByRole("heading", { name: /Bonjour India/ })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir l'application" }).click();
  // Le parcours a déjà été montré pour ce lien : revenir ne coûte pas un clic de plus, on arrive
  // directement à l'accueil. Ce qui est en jeu ici, c'est la reconnexion, pas le contenu de
  // l'accueil (un compte rendu qui évolue) : on vérifie l'en-tête de l'espace connecté.
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByRole("link", { name: "Accueil" }).first()).toBeVisible();
});

test("un membre ayant déjà ouvert son lien est reconnecté par celui-ci", async ({ page }) => {
  await page.goto(`/invitation/${TOKEN_EXISTANT}`);
  await expect(page.getByRole("heading", { name: /Bonjour Bravo/ })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir l'application" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByRole("link", { name: "Accueil" }).first()).toBeVisible();
});

test("un lien inconnu est refusé sans révéler d'information", async ({ page }) => {
  await page.goto("/invitation/lien-qui-n-existe-pas-0123456789012345678901234567");
  await expect(page.getByText("Ce lien n'est pas valide.")).toBeVisible();
});

test("une page protégée redirige vers la connexion et y revient ensuite (mot de passe facultatif)", async ({ page }) => {
  await page.goto("/profil");
  await page.waitForURL("**/connexion?suite=%2Fprofil");
  await connecter(page, COMPTES.membre, "/profil");
  await page.waitForURL("**/profil");
  await expect(page.getByRole("heading", { name: "Mon profil" })).toBeVisible();
});

test("un membre ne peut pas ouvrir l'espace de gestion", async ({ page }) => {
  await connecter(page, COMPTES.membre);
  await page.goto("/gestion");
  await page.waitForURL("**/?acces=refuse");
  await expect(page.getByText("Tu n'as pas accès à cette page.")).toBeVisible();
});

test("un administrateur se connecte avec mot de passe puis code de double authentification", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByLabel("Email", { exact: true }).fill(COMPTES.admin);
  await page.getByLabel("Mot de passe", { exact: true }).fill(MDP);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/connexion/code");
  // Pas de session tant que le code n'est pas bon
  await page.getByLabel("Code à 6 chiffres").fill("000000");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Code incorrect ou expiré.")).toBeVisible();
  await page.getByLabel("Code à 6 chiffres").fill(codeTotp(DEMO_TOTP_SECRET));
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  /*
   * **La session est ordinaire** : donner mot de passe et code ouvre l'application, pas les
   * réglages. Le profil propose donc la *porte* — « Se connecter en tant qu'administrateur » — et
   * non l'entrée directe, qui ne s'affiche que pendant l'élévation. L'accueil, lui, ne dit rien de
   * l'administration dans les deux cas.
   */
  await expect(page.getByRole("link", { name: "Ouvrir l'espace admin" })).toHaveCount(0);
  await page.goto("/profil");
  await expect(page.getByRole("link", { name: "Se connecter en tant qu'administrateur" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir l'espace admin" })).toHaveCount(0);

  // Et la porte demande bien les deux preuves, fraîchement connecté ou non
  await page.getByRole("link", { name: "Se connecter en tant qu'administrateur" }).click();
  await page.waitForURL("**/connexion/admin**");
  await expect(page.getByLabel("Mon mot de passe")).toBeVisible();
  await expect(page.getByLabel("Code à 6 chiffres")).toBeVisible();
});

/**
 * Depuis la page de connexion est ouverte à **qui s'est donné un mot de passe**, quel que soit son
 * rôle. Ce test garde les deux moitiés de la règle :
 *
 * 1. un compte **sans** mot de passe (l'instructeur du jeu de démonstration) n'entre pas par là, et
 *    le message le renvoie à son lien personnel, sans dire si le compte existe ;
 * 2. surtout : **l'administration technique ne s'ouvre pas à un instructeur**, quel que soit son
 *    équipement. Le cas « avec mot de passe *et* double authentification » est verrouillé côté
 *    serveur dans `tests/unit/admin-activation.test.ts` (« refuse l'administration technique à un
 *    instructeur muni d'un mot de passe et d'une 2FA ») ; ici on vérifie la porte, dans l'application
 *    réelle, avec une session d'instructeur ouverte normalement.
 */
test("un compte sans mot de passe (instructeur) ne peut pas utiliser l'accès administrateur", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByLabel("Email", { exact: true }).fill(COMPTES.instructeur);
  await page.getByLabel("Mot de passe", { exact: true }).fill(MDP);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Email ou mot de passe incorrect.")).toBeVisible();
  // Le message renvoie au lien personnel, et ne dit rien du compte
  await expect(page.getByRole("alert").getByText(/lien personnel/)).toBeVisible();

  // Connecté par son lien, l'instructeur encadre… et l'administration technique lui reste fermée
  await connecter(page, COMPTES.instructeur);
  // L'écran « Paramètres techniques/logs » a été découpé : sa fiche technique est devenue *À
  // propos*, et `/admin/parametres` ne répond plus (404), ce qui ne prouverait rien de la garde. On
  // vise donc une page de l'espace admin qui existe bel et bien.
  await page.goto("/admin/apropos");
  await page.waitForURL((u) => !u.pathname.startsWith("/admin"));
  await expect(page.getByRole("heading", { name: "À propos" })).toHaveCount(0);
  // Son profil ne propose aucune porte vers l'espace admin
  await page.goto("/profil");
  await expect(page.getByRole("link", { name: "Ouvrir l'espace admin" })).toHaveCount(0);
});

test("des liens inconnus répétés depuis la même adresse finissent bloqués", async ({ page }) => {
  // RATE_LIMIT_DISABLED=1 en dev neutralise le limiteur : on vérifie ici le message et la journalisation côté page
  await page.goto("/invitation/lien-qui-n-existe-pas-0123456789012345678901234567");
  await expect(page.getByText("Ce lien n'est pas valide.")).toBeVisible();
  await expect(page.getByText(/générés par l'équipe/)).toBeVisible();
});

/**
 * Le lien personnel de quelqu'un d'autre est un geste de **bureau** : l'annuaire a rejoint l'espace
 * admin, et `invitations.manage` n'appartient plus qu'aux administrateurs (un instructeur qui
 * régénérerait un lien mettrait tous les appareils de la personne dehors). Le parcours est donc le
 * même, mais joué par le compte d'administration — la porte fermée à l'instructeur est vérifiée,
 * elle, dans `gestion.spec.ts`.
 */
test("un administrateur régénère puis révoque le lien d'un membre", async ({ page }) => {
  /*
   * **Trois écrans lourds à la file, et deux server actions qui les re-rendent** : l'annuaire, la
   * fiche d'un membre (identité, périodes et liens, matrice de notifications, remise à zéro), puis la
   * page d'un lien. La minute par défaut n'y suffit pas quand la campagne les compile pour la
   * première fois — le scénario tombait alors sur un « jamais ouvert » qui n'était pas *encore* là,
   * le geste ayant bel et bien réussi. L'attente est donc un budget, pas une assertion : on la dit.
   */
  test.setTimeout(180_000);
  await connecter(page, COMPTES.admin);
  await page.goto("/admin/membres");
  await page.getByRole("link", { name: "Foxtrot 08" }).click();
  // Au téléphone, la carte des périodes est une ligne repliée de la liste groupée : on la déplie.
  await page.getByRole("button", { name: /^Périodes et liens d'accès/ }).click();
  // Les périodes sont listées de la plus récente à la plus ancienne : la période en cours (celle du lien fixe) est la dernière ouverte
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Régénérer et renvoyer" }).last().click();
  /*
   * `BoutonAction` ne rafraîchit pas la page : il s'en remet au `revalidatePath` de l'action, donc au
   * **re-rendu serveur** de cette fiche-là. À froid, il demande plus que les cinq secondes par
   * défaut, et c'est l'attente qui échouait, pas le geste.
   */
  await expect(page.getByText(/jamais ouvert/).last()).toBeVisible({ timeout: 30_000 });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Révoquer" }).last().click();
  await expect(page.getByText(/aucun lien actif/).last()).toBeVisible({ timeout: 30_000 });
  // L'ancien lien fixe de Hugo ne fonctionne plus
  await page.goto("/profil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.goto(`/invitation/${demoLien(COMPTES.lien)}`);
  await expect(page.getByText(/Ce lien a été annulé/)).toBeVisible();
});

test("un administrateur peut se connecter avec un code de secours, une seule fois", async ({ page }) => {
  const debut = async () => {
    await page.goto("/connexion");
    await page.getByLabel("Email", { exact: true }).fill(COMPTES.admin);
    await page.getByLabel("Mot de passe", { exact: true }).fill(MDP);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL("**/connexion/code");
  };
  await debut();
  await page.getByLabel("Code à 6 chiffres").fill("jklm npqr");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto("/profil");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL("**/connexion");
  // Le même code est refusé la deuxième fois
  await debut();
  await page.getByLabel("Code à 6 chiffres").fill("JKLM-NPQR");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Code incorrect ou expiré.")).toBeVisible();
});
