import { expect, test, type Locator } from "@playwright/test";
import { COMPTES, connecter } from "./helpers";
import { dateDemo } from "../../prisma/seed-demo";
import { SEANCES_CLUB } from "../../prisma/donnees-club";

/**
 * **Retirer quelqu'un d'une période efface ses réponses**.
 *
 * C'est le défaut le plus grave de la série : `retirerMembrePeriode` ne supprimait que le
 * rattachement. Les présences de la personne restaient en base, donc comptées au numérateur des
 * séances — pendant que le dénominateur, lui, suivait la liste nominative. On lisait « 12 présents
 * sur 11 », et la liste des présents nommait quelqu'un qui n'était plus invité. Le geste était
 * banal (retirer puis ré-ajouter est une manœuvre courante), la conséquence invisible : personne ne
 * remet en cause un compteur.
 *
 * Le test tient les deux bouts du même geste :
 *  - **avant**, la confirmation annonce ce qu'elle emporte (« N réponses de … seront effacées ») —
 *    sans quoi la perte de données serait silencieuse ;
 *  - **après**, les deux chiffres de la séance ont bougé *ensemble*, d'un cran chacun, et le nom a
 *    disparu de la liste. Vérifier le seul dénominateur laisserait repasser le bug au vert.
 *
 * **Pourquoi « zy » :** ce scénario retire pour de bon une personne du trimestre de démonstration,
 * ce qui déplace tous les décomptes de l'application. Il passe donc en fin de campagne, juste avant
 * `zz-liens`, comme lui pour ne pas gêner les autres (le global-setup reseede à la campagne
 * suivante).
 */

/** Une personne du jeu de démonstration qu'aucun autre scénario ne vise, présente le 22 septembre. */
const MEMBRE = { prenom: "Alpha", nom: "01" };
const NOM_COMPLET = `${MEMBRE.prenom} ${MEMBRE.nom}`;
/**
 * Une séance **passée** : les annulations des autres scénarios ne portent que sur l'avenir.
 *
 * Passée par `dateDemo` : le jeu de démonstration recale ses dates sur la semaine en cours depuis
 * le même jour, et cette date en dur aurait désigné un jour sans cours à partir — le scénario
 * aurait alors échoué sur l'absence de carte, en accusant le retrait de membre.
 */
/*
 * **La séance se prend dans le calendrier du club, elle ne s'écrit pas**. Écrite (`2026-09-22`),
 * elle ne désignait aucun cours dans la copie publique — dont le club inventé donne le mercredi et
 * le samedi — et le scénario cherchait une carte qui ne pouvait pas exister. C'est la troisième
 * fois que ce motif casse quelque chose : une valeur écrite deux fois finit par diverger. Le rang,
 * lui, dit ce qu'on veut vraiment : **une séance franchement passée**.
 */
const SEANCE = dateDemo(SEANCES_CLUB[6].date);
/**
 * **« Qui était là ? » et non « Qui vient ? »** : la carte d'un cours **déjà commencé** ouvre sa
 * liste nominative sur les présents, pas sur les sans-réponse (`s.commencee`, `CarteSeance`). La
 * séance visée ici est volontairement passée — c'est la seule qu'aucune annulation ne vient
 * déplacer —, elle porte donc les mots du registre et non ceux de l'appel. Le libellé est **écrit
 * en dur** plutôt que rendu permissif : si un cours de septembre se remettait à demander « qui
 * vient ? », ce serait la régression qu'on veut voir.
 */
const LISTE_NOMINATIVE = "Qui était là ?";

/** Les deux chiffres de la jauge d'une carte de séance : « 9 présents sur 12 ». */
async function compteurs(carte: Locator): Promise<{ presents: number; invites: number }> {
  const texte = await carte.innerText();
  const m = texte.match(/(\d+)\s*présents? sur (\d+)/);
  expect(m, `la carte n'affiche pas « N présents sur M » :\n${texte}`).not.toBeNull();
  return { presents: Number(m![1]), invites: Number(m![2]) };
}

test("retirer un membre d'une période efface ses réponses et remet le compteur d'accord avec la liste", async ({ page }) => {
  // L'onglet Séances filtré sur une date, puis la fiche d'un trimestre (séances, membres, dates
  // candidates) : deux des écrans les plus lourds à compiler, et une server action qui re-rend le
  // second. La minute par défaut n'y suffit pas à froid.
  test.setTimeout(180_000);
  await connecter(page, COMPTES.admin, `/seances?date=${SEANCE}`);
  const carte = page.getByRole("article");
  await expect(carte).toHaveCount(1);

  const avant = await compteurs(carte);
  expect(avant.presents, "la personne retirée doit compter parmi les présents de cette séance").toBeGreaterThan(0);
  // La liste nominative est repliée : on la déplie pour y lire le nom, qui doit en sortir plus tard.
  await carte.getByText(LISTE_NOMINATIVE).click();
  await expect(carte.getByText(NOM_COMPLET)).toBeVisible();

  // Le geste, depuis la fiche du trimestre — et la confirmation, qui doit annoncer ce qu'il emporte.
  await page.goto("/admin/periodes");
  await page.getByRole("link", { name: "Rentrée 2026" }).click();
  // La fiche d'un trimestre est un gros écran (séances, membres, dates candidates) : la navigation
  // côté client ne rend la main qu'une fois la charge arrivée. On l'attend explicitement, sinon les
  // recherches qui suivent se font encore sur la liste des périodes.
  await expect(page.getByRole("heading", { name: /Membres invités/ })).toBeVisible({ timeout: 30_000 });
  const ligne = page.locator("li").filter({ has: page.getByRole("link", { name: NOM_COMPLET }) });
  await expect(ligne).toHaveCount(1);
  let confirmation = "";
  page.once("dialog", (d) => {
    confirmation = d.message();
    return d.accept();
  });
  await ligne.getByRole("button", { name: "Retirer" }).click();
  await expect(ligne).toHaveCount(0, { timeout: 20_000 });
  const annonce = confirmation.match(new RegExp(`(\\d+) réponses? de ${MEMBRE.prenom} ser(?:a|ont) effacées?`));
  expect(annonce, `la confirmation n'annonce pas les réponses effacées : « ${confirmation} »`).not.toBeNull();
  expect(Number(annonce![1]), "une personne qui a répondu doit voir ses réponses annoncées").toBeGreaterThan(0);

  // Ce que voit le club après le geste : les deux chiffres ont bougé ensemble, et le nom n'est plus là.
  await page.goto(`/seances?date=${SEANCE}`);
  const apres = await compteurs(carte);
  expect(apres.invites, "la personne retirée ne compte plus parmi les invités").toBe(avant.invites - 1);
  expect(apres.presents, "sa réponse « présent » est effacée avec elle").toBe(avant.presents - 1);
  expect(apres.presents, "jamais plus de présents que d'invités").toBeLessThanOrEqual(apres.invites);
  await carte.getByText(LISTE_NOMINATIVE).click();
  await expect(carte.getByText(NOM_COMPLET)).toHaveCount(0);
});
