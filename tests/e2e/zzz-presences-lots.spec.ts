import { expect, test } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";

/**
 * **Corriger les réponses par lots**.
 *
 * Un soir de cours dans un club qui grandit, la feuille de présence est relevée à la main et
 * l'écran s'ouvre sur quarante-six personnes sans réponse : une liste déroulante par personne
 * n'est pas un geste, c'est une corvée qui finit par ne plus être faite. On coche des lignes, et
 * une seule réponse part pour tout le lot.
 *
 * Ce scénario surveille les quatre promesses du dossier, celles qui ne se voient pas dans une
 * capture d'écran :
 *
 * 1. **la barre d'action est là avant qu'on coche, et inerte** — elle n'existait pas du tout sans
 *    sélection, au motif qu'un club de douze n'en a pas l'usage ; Delta ne l'a donc jamais vue (« il
 *    manque le bouton de sélection de statut pour tous ceux sélectionnés, non ? »). Les cases à cocher
 *    ne disent rien de ce qu'elles permettent : ce qui se vérifie ici, c'est qu'elle est **montrée**
 *    mais que ses quatre réponses ne peuvent **rien écrire** tant que rien n'est coché — montrer n'est
 *    pas permettre ;
 * 2. **la case maîtresse nomme ce qu'elle emporte** (« Sélectionner les 12 personnes ») et le mot
 *    « Tout » ne s'écrit nulle part : il serait faux dès qu'un filtre ou un repli est en jeu ;
 * 3. **la confirmation annonce ce qui sera écrasé**, en séparant ceux qui avaient répondu
 *    eux-mêmes — les confondre gonflerait le chiffre censé faire hésiter — et rappelle le journal ;
 * 4. **une entrée d'audit par personne**, portant la **même action** que le geste unitaire
 *    (`presence.modifiee_par_admin`) : c'est un seul filtre du journal qui doit tout retrouver.
 *    On la compte, plutôt que de croire le message de l'écran.
 *
 * Il passe en fin de campagne (préfixe `zzz`) : il écrase les réponses de tout le club sur une
 * séance, et les scénarios qui lisent des taux ne doivent pas hériter de ce remue-ménage.
 */

/** Ce que le journal doit porter, et le même mot que la correction d'une seule personne. */
const ACTION_AUDIT = "presence.modifiee_par_admin";

/** Le nombre d'entrées du journal pour un filtre donné, lu dans le sous-titre « N entrées ». */
async function entreesDuJournal(page: import("@playwright/test").Page, filtre: string): Promise<number> {
  await page.goto(`/admin/audit?q=${encodeURIComponent(filtre)}`);
  const sousTitre = await page.getByText(/^\d+ entrées? · conservées/).innerText();
  return Number(sousTitre.match(/^(\d+)/)?.[1] ?? "0");
}

test("corriger les réponses par lots : une seule réponse, une entrée de journal par personne", async ({ page }) => {
  // Deux écrans lourds (le registre d'une séance, puis le journal d'audit) rencontrés pour la
  // première fois par la campagne : la minute par défaut ne couvre pas leur compilation.
  test.setTimeout(180_000);
  await connecter(page, COMPTES.admin);

  const avant = await entreesDuJournal(page, ACTION_AUDIT);

  await page.goto("/admin/presences");
  // Le panneau est déplié d'emblée sur cet écran : corriger est la seule chose qu'on y vient faire.
  const poignee = page.getByText(/^Modifier les réponses \(\d+\)$/);
  await expect(poignee).toBeVisible();
  const invites = Number((await poignee.innerText()).match(/\((\d+)\)/)?.[1] ?? "0");
  expect(invites, "le jeu de démonstration invite tout le club sur la période").toBeGreaterThan(1);

  /*
   * 1. Rien n'est coché : **la barre n'est pas là**, et la phrase qui dit ce que les cases permettent
   *    vit à côté d'elles.
   *
   * C'est le second temps d'une décision qui en compte deux, et les deux tiennent. Le, la barre a
   * été montée **toujours**, sobre et inerte, parce que « des cases à cocher ne disent rien de ce
   * qu'elles permettent ». Le 01/10, capture en main : « rends cette tuile visible uniquement si
   * quelqu'un est coché » — sur 390 px, la barre inerte mangeait trois lignes de la liste qu'on
   * vient lire, pour des boutons qui ne peuvent rien écrire. Ce que la veille résolvait n'a pas
   * disparu : la phrase est descendue sous la case maîtresse. Ce scénario gardait la première
   * décision seule, et il est resté rouge une soirée — la campagne n'avait pas tourné entre les
   * deux.
   */
  const barre = page.getByRole("group", { name: "Modifier la réponse de plusieurs personnes à la fois" });
  await expect(barre).toHaveCount(0);
  // Les cases n'existent qu'interrupteur « Sélection multiple » allumé : éteint, ni case ni phrase.
  await expect(page.getByLabel(`Sélectionner les ${invites} personnes`)).toHaveCount(0);
  await page.getByRole("switch", { name: /Sélection multiple/ }).check();
  await expect(page.getByText("Coche des lignes pour corriger plusieurs réponses à la fois")).toBeVisible();

  // 2. La case maîtresse **dit** ce qu'elle prend. Sous le seuil du repli et sans recherche, c'est
  //    « les N personnes » — et jamais « Tout ».
  const caseMaitresse = page.getByLabel(`Sélectionner les ${invites} personnes`);
  await expect(caseMaitresse).toBeVisible();
  await expect(page.getByText(/^Sélectionner tout/)).toHaveCount(0);
  await caseMaitresse.check();

  await expect(barre).toBeVisible();
  await expect(barre.getByText(`${invites} personnes sélectionnées`)).toBeVisible();

  // 3. La confirmation, interceptée pour être **lue** : c'est elle qui doit annoncer l'écrasement.
  let question = "";
  page.once("dialog", (d) => {
    question = d.message();
    void d.accept();
  });
  await barre.getByRole("button", { name: "Absent", exact: true }).click();

  const message = page.getByText(/réponses? enregistrées?|Rien à changer/);
  await expect(message).toBeVisible({ timeout: 30_000 });
  expect(question, "la question dit combien de personnes et ce qu'on leur écrit").toContain(
    `Passer ${invites} personnes à « Absent » ?`,
  );
  expect(question, "et elle rappelle le journal, nom par nom").toContain(
    "Chaque changement est inscrit au journal, personne par personne.",
  );
  // Ceux qui avaient répondu eux-mêmes sont comptés à part de ceux qui y sont déjà : deux
  // populations, deux phrases. Le jeu de démonstration a des présents et des peut-être, donc au
  // moins une réponse est écrasée.
  expect(question).toMatch(/avai(t|ent) déjà répondu/);

  // Le lot est passé : la sélection se vide (laisser les cases cochées invite à recliquer), donc
  // **la barre disparaît** — elle n'existe qu'avec une sélection — et la phrase qui dit ce que les
  // cases permettent reprend sa place à côté d'elles.
  await expect(barre).toHaveCount(0);
  await expect(page.getByText("Coche des lignes pour corriger plusieurs réponses à la fois")).toBeVisible();
  const modifiees = Number((await message.innerText()).match(/^(\d+) réponses?/)?.[1] ?? "0");
  expect(modifiees, "la moitié du club au moins n'était pas déjà « Absent »").toBeGreaterThan(0);

  // Toutes les lignes affichées portent la réponse du lot. La liste de chaque ligne est celle du
  // dépôt (`ListeDeroulante`) : un bouton `combobox` qui **écrit** la réponse choisie, pas un
  // `<select>` dont on lirait `value` — on lit donc ce qu'il affiche, c'est-à-dire ce qu'on voit.
  const reponses = page.locator('button[role="combobox"][id^="presence-"]');
  await expect(reponses).toHaveCount(invites);
  await expect(reponses).toHaveText(Array<string>(invites).fill("Absent"));
  // Et elles y sont **en base** : le rechargement complet est la seule preuve qui compte, l'écran
  // affichant d'abord ses corrections optimistes.
  await page.reload();
  const apresRechargement = page.locator('button[role="combobox"][id^="presence-"]');
  await expect(apresRechargement).toHaveCount(invites);
  await expect(apresRechargement).toHaveText(Array<string>(invites).fill("Absent"));

  // 4. Une entrée de journal par personne réellement modifiée — ni une pour tout le lot, ni une par
  //    ligne cochée. Et sous le **même** mot que le geste unitaire.
  expect(await entreesDuJournal(page, ACTION_AUDIT)).toBe(avant + modifiees);
});
