"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPermission, exigerReauth, getCurrentUser } from "@/lib/auth/current-user";
import { can, canAssignRole, canEditUser, estCompteDeService, peutEtreInvite } from "@/lib/permissions";
import { conditionLiensARevoquer, ERREUR_COMPTE_SERVICE, envoyerInvitation } from "@/lib/invitations";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { analyserCsvMembres } from "@/lib/periodes";
import { aDejaUnAcces, CHAMPS_TEMOINS_ACCES, messageSansEmail, temoinsAcces } from "@/lib/membres";
import { remettreAccesAZero } from "@/lib/reinitialisation-acces";
import { revokeAllSessions } from "@/lib/auth/session";
import { prochaineCouleurLibre } from "@/lib/couleurs-attribution";
import { caseCochee, champ, zodToFormState, type FormState } from "@/lib/form";
import {
  DESCRIPTIONS,
  TYPES_REFUSABLES,
  getPreferencesNotifications,
  miseAJourPersonnelle,
  notificationActiveDans,
  preferencesPersonnellesDe,
  type TypeNotification,
} from "@/lib/notifications/preferences";
import { emailFacultatifSchema, ligneCsvSchema, membreSchema, saisonArrivee } from "@/lib/validation/gestion";
import { dateDepuisSaison } from "@/lib/blasons";

/** Le compte de connexion du portail n'est pas une personne du club : il ne se désactive ni ne se supprime. */
const ERREUR_PORTAIL_COMPTE = "Le compte de connexion du portail ne peut pas être désactivé ni supprimé.";
const ERREUR_PORTAIL_ROLE = "Le compte de connexion du portail doit rester administrateur.";
/**
 * **Son rôle de base, lui, ne se règle pas depuis l'annuaire**. Ce n'est pas la même phrase que
 * celle du dessus et ce n'est pas le même refus : le portail garde son bureau (`estAdmin`) à
 * demeure — c'est `ERREUR_PORTAIL_ROLE`, dans « Comptes admin » —, et « membre ou instructeur » ne
 * veut rien dire pour un compte qui n'est pas une personne du club. Une seule phrase pour les deux
 * aurait annoncé une perte de droits là où il n'y en a aucune.
 */
const ERREUR_PORTAIL_ROLE_DE_BASE = "Le compte de connexion du portail n'est pas une personne du club : son rôle ne se règle pas ici.";
/**
 * **L'identité du compte global ne se corrige que par lui-même**.
 *
 * Son adresse est celle par laquelle le club reçoit les **alertes de sécurité** (`src/lib/alertes.ts`
 * le sélectionne exprès, sans l'exclure comme le font les envois ordinaires), et c'est **sa seule
 * porte** : il n'a pas de lien personnel. Un autre administrateur qui la réécrit déplace donc la
 * porte du compte le plus fort de l'installation, et les alertes avec elle.
 */
const ERREUR_PORTAIL_IDENTITE =
  "L'identité du compte d'administration ne se modifie que depuis son propre profil : c'est sa seule porte, personne ne la déplace pour lui.";
/**
 * **Le rôle d'administrateur ne se règle que dans l'onglet « Comptes admin »**. L'annuaire sert à
 * tenir le club : on y fait un instructeur, on n'y donne pas les clés de l'administration. Les deux
 * gestes du bureau — nommer, retirer — vivent au même endroit, avec la liste de ceux qui les ont,
 * la double authentification de chacun et le journal.
 */
/**
 * **Ni le mot de passe ni la double authentification du compte permanent ne se remettent à zéro
 * depuis un autre compte**.
 *
 * Le refus existait déjà ici — mais avec le message des **invitations**
 * (`ERREUR_COMPTE_SERVICE`, « ne peut pas être invité à une période »), qui ne décrit pas du tout le
 * geste refusé. Un refus qui nomme la mauvaise règle envoie chercher la solution au mauvais endroit,
 * et finit par passer pour un bug qu'on « corrige ».
 *
 * **Pourquoi le refus, et pas seulement l'absence de bouton** : ce compte est le seul à pouvoir
 * rouvrir l'administration quand plus personne n'y entre. Lui effacer son mot de passe et son second
 * facteur, c'est le fermer dehors ; les lui **remplacer** serait en prendre la place — et il porte
 * tous les droits, l'adresse des alertes de sécurité comprise. Sa voie de secours est sa propre boîte
 * email (le lien de réinitialisation ordinaire, qui exige donc l'accès à cette boîte) et, à défaut,
 * le redéploiement avec un nouveau `ADMIN_PASSWORD`.
 */
const ERREUR_PORTAIL_ACCES =
  "L'accès du compte d'administration ne se remet pas à zéro depuis un autre compte : c'est le seul qui puisse rouvrir l'administration.";
const ERREUR_ROLE_ADMIN = "Les droits d'administrateur se règlent dans l'onglet « Comptes admin ».";
/**
 * Un administrateur ne **naît** plus : il se **nomme** parmi les personnes que l'annuaire connaît
 * déjà. Créer un compte administrateur de zéro doublait le formulaire de l'annuaire et ouvrait la
 * porte à un second compte pour quelqu'un de déjà inscrit. Le chemin est donc : ajouter la personne
 * dans « Membres », puis la nommer dans « Comptes admin ».
 */
const ERREUR_ADMIN_A_CREER = "Un administrateur se nomme parmi les personnes de l'annuaire : ajoute d'abord la personne dans « Membres », puis nomme-la dans « Comptes admin ».";
const ERREUR_COMPTE_INACTIF = "Ce compte est désactivé : réactive-le avant de lui envoyer son lien.";

function rafraichir() {
  revalidatePath("/admin/membres");
  revalidatePath("/admin/periodes");
  revalidatePath("/admin/comptes");
}

/**
 * Inscrit un nouveau membre aux périodes cochées (closes exceptées). **Aucun lien ne part** : ajouter
 * quelqu'un à l'annuaire et lui ouvrir l'application sont deux gestes, et le second se fait d'un bouton
 * (« Envoyer l'invitation »), quand l'équipe le décide — souvent après avoir saisi tout le monde.
 */
async function inscrireAuxPeriodes(userId: string, periodIds: string[]): Promise<void> {
  for (const periodId of periodIds) {
    const period = await db.period.findUnique({ where: { id: periodId } });
    if (!period || period.statut === "CLOSE") continue;
    await db.periodMember.upsert({ where: { periodId_userId: { periodId, userId } }, create: { periodId, userId }, update: {} });
  }
}

/** Ajout d'une personne : compte créé et inscrit aux périodes cochées, sans aucun email. */
export async function creerMembre(_prev: FormState, fd: FormData): Promise<FormState> {
  // Ouvrir un compte est réservé au bureau (un instructeur modifie les fiches existantes, mais n'en crée pas)
  const acteur = await assertPermission("members.create");
  // « Au club depuis » ne figure pas sur le formulaire de création : une personne qu'on ajoute
  // aujourd'hui arrive aujourd'hui, et le repli sur la date de création dit exactement cela. Le
  // bureau la corrige d'un geste depuis la fiche si elle pratiquait déjà avant l'application.
  const parsed = membreSchema.safeParse({ prenom: champ(fd, "prenom"), nom: champ(fd, "nom"), email: champ(fd, "email"), role: champ(fd, "role") || "MEMBRE" });
  if (!parsed.success) return zodToFormState(parsed.error);
  /*
   * **Le refus qui nomme le chemin passe AVANT le refus générique**. Depuis que le bureau est un
   * supplément, `canAssignRole` ne connaît plus que les **rôles de base** : il refuse donc «
   * administrateur » lui aussi, mais par un « Tu ne peux pas attribuer ce rôle » qui se lit comme
   * un manque de droits — alors que personne, bureau compris, ne crée un administrateur ici. Dans
   * cet ordre-là, la phrase qui dit où aller (« Comptes admin ») était devenue inatteignable.
   */
  if (parsed.data.role === "ADMIN") return { erreur: ERREUR_ADMIN_A_CREER, erreurs: { role: "Onglet « Comptes admin »." } };
  if (!canAssignRole(acteur, parsed.data.role)) return { erreur: "Tu ne peux pas attribuer ce rôle." };
  // L'adresse est facultative : sans adresse, rien à vérifier (plusieurs comptes sans email cohabitent)
  if (parsed.data.email) {
    const existant = await db.user.findUnique({ where: { email: parsed.data.email } });
    if (existant) return { erreur: "Un compte existe déjà avec cet email.", erreurs: { email: "Déjà utilisé." } };
  }
  const user = await db.user.create({ data: { ...parsed.data, couleur: await prochaineCouleurLibre() } });
  const periodIds = fd.getAll("periodIds").filter((v): v is string => typeof v === "string");
  await inscrireAuxPeriodes(user.id, periodIds);
  await audit(acteur, "membre.cree", user.id, { email: user.email, role: user.role });
  rafraichir();
  if (!user.email) {
    return { succes: `${user.prenom} ${user.nom} ajouté(e), sans adresse email : la personne compte dans l'effectif, l'équipe coche sa présence pour elle. Renseigne une adresse pour lui envoyer son lien.` };
  }
  return { succes: `${user.prenom} ${user.nom} ajouté(e). Aucun email n'est parti : envoie-lui son invitation depuis la liste ou sa fiche, quand tu veux.` };
}

export async function modifierMembre(userId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const acteur = await assertPermission("members.manage");
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!canEditUser(acteur, cible)) return { erreur: "Tu ne peux pas modifier ce compte." };
  const parsed = membreSchema.safeParse({
    prenom: champ(fd, "prenom"),
    nom: champ(fd, "nom"),
    email: champ(fd, "email"),
    role: champ(fd, "role"),
    // « Au club depuis », choisi en saison d'arrivée et converti en date par le schéma.
    // « Je ne sais pas » (vide) efface la date : l'ancienneté repart de la création du compte.
    saisonArrivee: champ(fd, "saisonArrivee"),
  });
  if (!parsed.success) return zodToFormState(parsed.error);
  const changeDeRole = parsed.data.role !== cible.role;
  /*
   * **Le compte du portail garde son rôle tel quel — et le reste de sa fiche s'enregistre**. La
   * garde comparait le rôle demandé à `"ADMIN"` : le portail portant désormais un rôle de base
   * comme tout le monde, elle ne pouvait plus être satisfaite et refusait **tout** enregistrement
   * de cette fiche, le nom et l'adresse compris. Son bureau, lui, n'a jamais été en jeu ici :
   * `parsed.data` ne porte pas `estAdmin`, et le retrait a son écran (`retirerDroitsAdmin`).
   */
  if (estCompteDeService(cible) && changeDeRole) return { erreur: ERREUR_PORTAIL_ROLE_DE_BASE, erreurs: { role: "Rôle verrouillé." } };
  // Son identité, elle, ne se corrige que par lui-même : voir `ERREUR_PORTAIL_IDENTITE` et sa raison.
  if (estCompteDeService(cible) && acteur.id !== cible.id) return { erreur: ERREUR_PORTAIL_IDENTITE };
  if (changeDeRole) {
    /*
     * **« Administrateur » ne s'attribue toujours pas ici**, et ce refus-ci garde tout son sens : un
     * module `"use server"` est une porte sur le réseau, et `membreSchema` accepte encore les trois
     * noms de la matrice. Ce qui a disparu, c'est le refus **symétrique** (« la cible est
     * administratrice ») : le bureau est un supplément, le rôle de base d'un administrateur se règle
     * donc comme celui de n'importe qui — c'est précisément ce que ce changement rend possible, dire
     * qu'un membre du bureau enseigne. Écrit `cible.role === "ADMIN"`, il ne levait de toute façon
     * plus jamais : il ne refusait plus rien, sans rien dire.
     */
    if (parsed.data.role === "ADMIN") return { erreur: ERREUR_ROLE_ADMIN, erreurs: { role: "Onglet « Comptes admin »." } };
    if (!canAssignRole(acteur, parsed.data.role) || !can(acteur, cible.estAdmin ? "admins.manage" : "members.manage")) {
      return { erreur: "Tu ne peux pas attribuer ce rôle." };
    }
    /*
     * **On règle son propre rôle de base, et c'est devenu juste**.
     *
     * Le refus datait du temps où un rôle **donnait** des droits : « se nommer ADMIN » était
     * l'escalade qu'il empêchait. Depuis que le bureau est un **supplément** (`estAdmin`), le rôle de
     * base n'ouvre plus rien — et seul un administrateur peut le changer (`members.manage`), c'est-
     * à-dire quelqu'un qui a déjà tous les droits. Se mettre « instructeur » ne lui en donne aucun ;
     * se remettre « membre » ne lui en retire aucun. Un membre du bureau qui enseigne doit pouvoir le
     * dire de lui-même, sans demander à un autre administrateur.
     *
     * **Ce qui reste refusé sur son propre compte, et pour une raison qui n'a pas bougé** : se
     * désactiver, se supprimer (on s'enfermerait dehors) et se retirer le bureau.
     */
  }
  /*
   * **Changer l'adresse de quelqu'un exige un code récent**.
   *
   * C'était le seul geste de l'application qui touche un **compte** sans redemander le code : le
   * rôle, la désactivation, la suppression et la remise à zéro de l'accès le demandaient tous, pas
   * l'adresse — alors que CLAUDE.md désigne nommément ce couple, « changer l'adresse de quelqu'un
   * *et* lui renvoyer son lien fait arriver ce lien chez soi ». Remplacer une adresse renseignée
   * révoque les liens de l'ancienne boîte (`revoquerLiensApresChangementEmail`), et arme le bouton
   * « Envoyer le lien » vers la nouvelle : un écran d'administration laissé ouvert sur un poste
   * partagé suffisait, en deux champs et un clic, à se fabriquer une clé au nom de quelqu'un.
   *
   * La portée est bornée — il faut déjà une session admin élevée pour arriver jusqu'ici, ce n'est
   * donc pas une élévation de rôle mais de la défense en profondeur, la même que celle des autres
   * gestes qui touchent un compte.
   *
   * **Le test porte sur tout changement d'adresse, pas seulement sur un remplacement** : ajouter une
   * adresse à quelqu'un qui n'en avait pas n'envoie rien tout de suite, mais arme le bouton
   * « Envoyer le lien » juste à côté — et l'effacer coupe les messages de quelqu'un. Les trois cas
   * valent un code. Il est redemandé **avant** l'écriture : après, la clé serait déjà partie.
   */
  const changeDAdresse = (cible.email ?? null) !== parsed.data.email;
  /*
   * **Un refus qui ne dépend pas de la fraîcheur du code passe AVANT la demande de code**. Cet
   * enregistrement-ci demandait le code juste après avoir constaté un changement d'adresse, *puis*
   * vérifiait que l'adresse n'était pas déjà celle de quelqu'un d'autre — et le refusait. Le bureau
   * qui corrige « delta@ » en l'adresse d'un homonyme déjà inscrit était donc envoyé sur
   * `/connexion/verifier`, ressortait son téléphone, recopiait six chiffres… pour lire « cet email
   * est déjà utilisé » en revenant. Une preuve d'identité donnée pour rien, suivie d'un refus : on
   * ne comprend pas ce qu'on a payé, et la fois suivante on se méfie de la demande de code.
   *
   * Même remarque pour le changement de rôle, dont la demande de code se trouvait plus haut : les
   * deux gestes vivent dans **le même formulaire**, et une seule fiche enregistrée peut les porter
   * tous les deux. Les deux demandes sont donc réunies ici, **après tous les refus** et **avant**
   * l'écriture — une seule interruption pour un seul enregistrement, au même endroit que celle de
   * `definirEmailMembre`. Les verrous ne bougent pas : `assertPermission`, `canEditUser`,
   * `canAssignRole` et le compte du portail restent tous en amont.
   */
  if (parsed.data.email) {
    const autre = await db.user.findUnique({ where: { email: parsed.data.email } });
    if (autre && autre.id !== userId) return { erreur: "Cet email est déjà utilisé par un autre compte.", erreurs: { email: "Déjà utilisé." } };
  }
  if (changeDeRole || changeDAdresse) await exigerReauth(acteur, `/admin/membres/${userId}`);
  await db.user.update({ where: { id: userId }, data: parsed.data });
  // Même règle que sur la liste (`definirEmailMembre`) : remplacer une adresse **renseignée** par
  // une autre tue la clé restée dans l'ancienne boîte. Rien ne part vers la nouvelle : l'équipe
  // envoie le lien d'un bouton, quand elle le décide.
  const remplacement = Boolean(cible.email && parsed.data.email && cible.email !== parsed.data.email);
  const acces = remplacement ? await revoquerLiensApresChangementEmail(cible) : { liensRevoques: 0 };
  // Le journal garde la fiche telle qu'enregistrée, « Au club depuis » compris : c'est un champ qui
  // décide d'un rang, et qui l'a changé fait partie de ce qu'on veut pouvoir relire.
  await audit(acteur, "membre.modifie", userId, { ...parsed.data, ...(remplacement ? { ancienEmail: cible.email, ...acces } : {}) });
  rafraichir();
  // La fiche elle-même, que `rafraichir()` ne couvre pas (il ne connaît que les listes) : sans cette
  // ligne, l'écran d'où l'on vient d'enregistrer se relit dans son état d'avant — et un second clic
  // sur « Enregistrer » renverrait l'ancienne valeur. Même geste que `definirEmailMembre`.
  revalidatePath(`/admin/membres/${userId}`);
  if (!remplacement) return { succes: "Membre enregistré." };
  return { succes: messageChangementAdresse("Membre enregistré.", acces) };
}

/**
 * **Ce que l'écran annonce après un changement d'adresse — et rien de plus.**
 *
 * « Le lien personnel de l'ancienne adresse a été annulé » s'écrivait **inconditionnellement**, y
 * compris quand `revoquerLiensApresChangementEmail` n'avait trouvé aucun lien à fermer. La phrase
 * était donc parfois fausse, et fausse dans le sens le plus coûteux : le bureau repartait convaincu
 * que la boîte d'avant ne pouvait plus rien ouvrir. On ne l'écrit plus que lorsqu'un lien a
 * réellement été révoqué, et on dit sobrement le contraire sinon.
 */
function messageChangementAdresse(prefixe: string, acces: { liensRevoques: number }): string {
  const annulation =
    acces.liensRevoques > 0 ? "Le lien personnel de l'ancienne adresse a été annulé" : "Aucun lien ne restait à annuler dans l'ancienne boîte";
  return `${prefixe} ${annulation}. Aucun email n'est parti : envoie-lui son lien avec « Envoyer le lien » quand tu veux.`;
}

/**
 * **Remplacer l'adresse de quelqu'un révoque sa clé — sans en envoyer une autre.**
 *
 * Le lien personnel *est* le mot de passe du projet : quatre mois de validité, connexion directe,
 * et il vit dans une boîte mail. Tant que l'ancienne adresse gardait un lien vivant, corriger une
 * adresse laissait une porte ouverte dans la boîte d'avant — celle qu'on quitte parce qu'elle a
 * fuité, celle d'un conjoint, celle d'un homonyme à qui l'adresse appartenait vraiment.
 *
 * **Toutes** les invitations encore valables de la personne sont donc révoquées, trimestres confondus
 * et qu'elles soient déjà fermées ou non (motif `REMPLACE` : c'est une révocation de sécurité, la page
 * du lien le dira) — même s'il n'y a aucun trimestre ouvert.
 *
 * **Rien ne part vers la nouvelle adresse.** Corriger une adresse est un geste de fichier, envoyer
 * une clé en est un autre : le bureau corrige souvent plusieurs adresses avant de prévenir qui que ce
 * soit, et un email « Ton lien pour les cours » arrivant à chaque faute de frappe corrigée surprenait.
 * Le lien part d'un bouton (« Envoyer le lien », à l'unité ou pour une sélection), avec ses propres
 * verrous.
 *
 * **Les sessions ouvertes ne sont pas fermées** : le danger corrigé ici dort dans une boîte mail, pas
 * sur le téléphone du membre. Mettre dehors quelqu'un dont on vient de corriger une faute de frappe
 * dans l'adresse serait une panne, pas une protection.
 *
 * Retourne ce que le journal d'audit doit garder.
 */
async function revoquerLiensApresChangementEmail(cible: { id: string }): Promise<{ liensRevoques: number }> {
  const maintenant = new Date();
  const { count } = await db.invitation.updateMany({
    where: { userId: cible.id, ...conditionLiensARevoquer(maintenant) },
    data: { revokedAt: maintenant, motifRevocation: "REMPLACE" },
  });
  return { liensRevoques: count };
}

/**
 * Adresse email seule, depuis la liste des membres (sans ouvrir la fiche) : on l'ajoute, on la
 * corrige ou on l'efface. `modifierMembre` ne convient pas ici, il exige prénom, nom et rôle.
 *
 * Les trois cas ne se valent pas, parce que ce qui est en jeu est la boîte mail où **vit la clé** :
 *
 * - **ajouter** une adresse à quelqu'un qui n'en avait pas : rien à révoquer, il n'avait aucun
 *   lien. L'équipe lui en envoie un d'un bouton, depuis sa fiche ou la liste ;
 * - **remplacer** une adresse renseignée par une autre : les liens vivants sont révoqués
 *   (`revoquerLiensApresChangementEmail` ci-dessus) — sans quoi l'ancienne boîte gardait une porte
 *   ouverte pendant quatre mois — et **rien ne part** vers la nouvelle : l'équipe envoie le lien
 *   d'un bouton ;
 * - **effacer** l'adresse **ne révoque rien** : les liens déjà envoyés restent valables et les
 *   sessions ouvertes ne sont pas fermées. La personne qui est déjà entrée reste chez elle, elle ne
 *   recevra simplement plus aucun message (et l'équipe ne pourra plus lui envoyer de lien). C'est
 *   le geste du membre sans email qu'on pointe à sa place, pas celui d'une exclusion.
 */
/*
 * `retour` se lie **avant** les deux arguments de formulaire (`_prev`, `fd`), qui sont ceux que React
 * fournit : c'est la seule position où `bind` peut le poser. Sans lui, corriger une adresse depuis la
 * liste dépliée (`?tout=1`) ou filtrée renvoyait sur la liste nue après le code redonné.
 */
export async function definirEmailMembre(userId: string, retour: string | undefined, _prev: FormState, fd: FormData): Promise<FormState> {
  const acteur = await assertPermission("members.manage");
  // `estAdmin` fait partie de ce que `canEditUser` lit : sans lui, un compte du bureau se présente
  // comme un compte ordinaire et la garde ne refuse plus rien.
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true } });
  if (!canEditUser(acteur, cible)) return { erreur: "Tu ne peux pas modifier ce compte." };
  // Le compte de connexion du portail se connecte par email + mot de passe : son adresse n'est pas un détail de liste
  if (estCompteDeService(cible)) return { erreur: "L'adresse du compte de connexion du portail se modifie depuis sa fiche." };
  const parsed = emailFacultatifSchema.safeParse(champ(fd, "email"));
  if (!parsed.success) return { erreur: parsed.error.issues[0]?.message ?? "Adresse invalide.", erreurs: { email: parsed.error.issues[0]?.message ?? "Adresse invalide." } };
  const email = parsed.data;
  if (email) {
    const autre = await db.user.findUnique({ where: { email } });
    if (autre && autre.id !== userId) return { erreur: `Cette adresse est déjà celle de ${autre.prenom} ${autre.nom}.`, erreurs: { email: "Déjà utilisée." } };
  }
  const ancienne = cible.email;
  if (ancienne === email) return { succes: email ? "Adresse inchangée." : "Toujours aucune adresse pour cette personne." };
  /*
   * **Un code récent avant de toucher l'adresse** — même raison qu'au même endroit de
   * `modifierMembre`, dont le commentaire détaille le scénario : remplacer une adresse renseignée
   * révoque la clé de l'ancienne boîte et en fait partir une neuve de quatre mois vers la nouvelle,
   * ce qui suffit à entrer sous l'identité de quelqu'un. C'était le seul geste touchant un compte à
   * passer sans code, là où le rôle, la désactivation, la suppression et la remise à zéro de
   * l'accès le demandent tous.
   *
   * Demandé **après** le test « rien ne change » (inutile de réclamer un code pour un enregistrement
   * à blanc) et **avant** l'écriture (après, la clé serait déjà partie). La suite vient de l'écran :
   * ce formulaire-ci ne vit que dans le volet d'une ligne de liste, mais la liste porte une recherche,
   * un filtre « comptes désactivés » et une étendue dans son URL — la suite en dur les perdait tous,
   * et l'administrateur revenait du code sur une liste nue où il devait retrouver sa ligne.
   */
  await exigerReauth(acteur, retour ?? "/admin/membres");
  await db.user.update({ where: { id: userId }, data: { email } });
  // Adresse renseignée remplacée par une autre : la clé de l'ancienne boîte meurt ici (voir
  // `revoquerLiensApresChangementEmail`), et rien ne part vers la nouvelle. Un ajout ou un
  // effacement ne déclenche rien.
  const remplacement = Boolean(ancienne && email);
  const acces = remplacement ? await revoquerLiensApresChangementEmail(cible) : { liensRevoques: 0 };
  const action = !ancienne ? "membre.email_ajoute" : !email ? "membre.email_retire" : "membre.email_modifie";
  await audit(acteur, action, userId, { ancienne, nouvelle: email, ...(remplacement ? acces : {}) });
  rafraichir();
  revalidatePath(`/admin/membres/${userId}`);
  if (!email) return { succes: "Adresse retirée : plus de lien personnel possible." };
  if (!remplacement) return { succes: "Adresse enregistrée." };
  return { succes: messageChangementAdresse("Adresse enregistrée.", acces) };
}

/** Active ou désactive un compte. `retour` = page où revenir si une ré-authentification est demandée. */
export async function definirActif(userId: string, actif: boolean, retour?: string): Promise<void> {
  // Réservé aux administrateurs : un instructeur gère les membres mais ne coupe l'accès de personne
  const acteur = await assertPermission("members.activate");
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!canEditUser(acteur, cible) || acteur.id === userId) throw new Error("Action non autorisée.");
  if (estCompteDeService(cible)) throw new Error(ERREUR_PORTAIL_COMPTE);
  if (!actif) await exigerReauth(acteur, retour ?? `/admin/membres/${userId}`);
  await db.user.update({ where: { id: userId }, data: { actif } });
  if (!actif) await revokeAllSessions(userId);
  await audit(acteur, actif ? "membre.reactive" : "membre.desactive", userId);
  rafraichir();
}

/**
 * Désactive (ou réactive) tous les comptes d'un coup : fin de saison, incident de sécurité.
 * Deux comptes ne sont jamais touchés, et ils sont écartés **en base**, pas seulement à l'affichage :
 * - le compte de connexion du portail, filet de sécurité qui permet toujours de tout rouvrir ;
 * - le compte de l'administrateur qui agit, pour qu'il ne se coupe pas l'accès en pleine opération.
 * Les autres administrateurs, eux, font partie du lot.
 * Une seule entrée d'audit pour toute l'opération (nombre + identifiants des comptes touchés).
 */
export async function definirActifTous(actif: boolean, retour?: string): Promise<string> {
  // Couper l'accès est réservé au bureau, à l'unité comme en masse…
  await assertPermission("members.activate");
  // …et « admins.manage » ajoute, pour une action de masse, une session forte (mot de passe + 2FA)
  const acteur = await assertPermission("admins.manage");
  const cibles = await db.user.findMany({
    where: { service: false, id: { not: acteur.id }, actif: !actif },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const identifiants = cibles.map((c) => c.id);
  if (identifiants.length === 0) return actif ? "aucun compte à réactiver" : "aucun compte à désactiver";
  // Action de masse : le code 2FA doit avoir moins de dix minutes. **Demandé après le relevé du
  // lot**, pour la même raison que dans `definirEmailMembre` : un lot vide n'écrit rien, et
  // réclamer un code pour s'entendre répondre « aucun compte à désactiver » fait payer une preuve
  // d'identité à un geste à blanc. Deux clics de suite sur « Tout désactiver » — le second sur une
  // liste déjà vidée — suffisaient à déclencher ce détour. Et la suite vient de l'écran, comme pour
  // les autres gestes de cette page : la recherche, le filtre et l'étendue vivent dans l'URL de la
  // liste, et un retour en dur les jetait.
  await exigerReauth(acteur, retour ?? "/admin/membres");
  await db.user.updateMany({ where: { id: { in: identifiants } }, data: { actif } });
  // Comme pour une désactivation à l'unité : les sessions ouvertes tombent tout de suite
  if (!actif) for (const id of identifiants) await revokeAllSessions(id);
  await audit(acteur, actif ? "membres.reactives_en_masse" : "membres.desactives_en_masse", null, {
    nombre: identifiants.length,
    identifiants,
  });
  rafraichir();
  const pluriel = identifiants.length > 1 ? "s" : "";
  return `${identifiants.length} compte${pluriel} ${actif ? "réactivé" : "désactivé"}${pluriel}.`;
}

/**
 * **Retirer les droits d'administrateur**, depuis la liste des comptes admin. Le compte n'est pas
 * supprimé et **la personne garde son rôle de base** — membre ou instructeur —, ses présences et
 * son historique : c'est le supplément `estAdmin` qu'on enlève, et rien d'autre.
 *
 * **Elle ne « redevient » plus membre** : elle ne l'a jamais cessé. Le geste écrivait `role =
 * "MEMBRE"`, ce qui était juste quand les trois rôles étaient exclusifs et ne l'est plus — retirer
 * le bureau d'un instructeur lui aurait fait perdre l'instruction au passage, sans que personne
 * l'ait demandé ni le voie.
 *
 * Trois refus, tous côté serveur :
 *  - **soi-même** : se retirer ses propres droits, c'est fermer la porte de l'intérieur ;
 *  - **le compte du portail** (`service`) : seul compte à mot de passe et double authentification,
 *    il doit rester administrateur, sinon plus personne n'ouvre l'administration technique ;
 *  - un compte qui n'est **pas** administrateur : rien à retirer.
 *
 * L'effet est immédiat : le rôle est relu à chaque requête, donc une session ouverte ailleurs perd
 * l'espace admin dès la page suivante. Les colonnes `forte` et `elevationVueLe` de ses sessions
 * sont remises à plat dans la foulée, pour que la liste des sessions dise la vérité.
 */
export async function retirerDroitsAdmin(userId: string, retour?: string): Promise<void> {
  const acteur = await assertPermission("admins.manage");
  // `estAdmin` est **lu**, et il le faut deux fois : c'est lui qui dit du bureau (le rôle ne vaut
  // plus jamais « ADMIN »), et c'est lui que `canEditUser` regarde — un objet sans ce champ se
  // présenterait comme « pas du bureau », et la garde se serait tue.
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true } });
  if (!cible.estAdmin) throw new Error("Ce compte n'est pas administrateur.");
  if (acteur.id === userId) throw new Error("Tu ne peux pas retirer tes propres droits d'administrateur.");
  if (estCompteDeService(cible)) throw new Error(ERREUR_PORTAIL_ROLE);
  if (!canEditUser(acteur, cible)) throw new Error("Action non autorisée.");
  /*
   * **Le code redemandé dépose là où l'on était**. Les deux gestes du bureau se font désormais
   * depuis **trois** écrans — « Comptes admin », l'annuaire et la fiche d'une personne — depuis que
   * le second menu déroulant existe. Codée en dur, la destination renvoyait sur « Comptes admin »
   * quelqu'un qui réglait une fiche : il devait retrouver son chemin, et le geste qu'il venait de
   * demander était perdu. Même paramètre que `definirActif` et `definirEmailMembre`.
   */
  await exigerReauth(acteur, retour ?? "/admin/comptes");
  await db.user.update({ where: { id: userId }, data: { estAdmin: false } });
  await db.authSession.updateMany({ where: { userId }, data: { forte: false, elevationVueLe: null } });
  // Le journal garde **le rôle de base que la personne conserve** : « nouveauRole: MEMBRE » racontait
  // une rétrogradation qui n'a plus lieu, et c'est le genre de phrase qu'une relecture croit.
  await audit(acteur, "admin.droits_retires", userId, { email: cible.email, roleDeBase: cible.role });
  rafraichir();
}

/**
 * **La saison d'arrivée seule**, choisie dans sa liste sur la fiche d'un membre au téléphone. Mêmes
 * verrous que `modifierMembre` pour ce champ (`members.manage`, `canEditUser`, identité du portail
 * intouchable sauf par lui-même), même conversion (`saisonArrivee`, vide = « je ne sais pas »), même
 * entrée de journal. Pas de code redemandé : comme le formulaire complet quand ni l'adresse ni le
 * rôle ne bougent.
 */
export async function definirSaisonMembre(userId: string, saison: string): Promise<{ erreur?: string }> {
  const acteur = await assertPermission("members.manage");
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true, estAdmin: true, service: true, auClubDepuis: true } });
  if (!canEditUser(acteur, cible)) return { erreur: "Tu ne peux pas modifier ce compte." };
  if (estCompteDeService(cible) && acteur.id !== cible.id) return { erreur: ERREUR_PORTAIL_IDENTITE };
  const parsed = saisonArrivee.safeParse(saison);
  if (!parsed.success) return { erreur: "Choisis une saison dans la liste." };
  const auClubDepuis = dateDepuisSaison(parsed.data);
  if ((cible.auClubDepuis?.getTime() ?? null) === (auClubDepuis?.getTime() ?? null)) return {};
  await db.user.update({ where: { id: userId }, data: { auClubDepuis } });
  await audit(acteur, "membre.modifie", userId, { auClubDepuis });
  rafraichir();
  revalidatePath(`/admin/membres/${userId}`);
  return {};
}

/**
 * **Changer le rôle depuis la liste des membres** : membre ↔ instructeur, et rien d'autre (le
 * sélecteur de la liste ne propose que ces deux-là, et le serveur le tient aussi).
 *
 * Renvoie une erreur plutôt que de lever : le sélecteur vit dans une ligne de liste, il affiche le
 * refus sous lui sans emporter l'écran.
 */
export async function definirRoleMembre(userId: string, role: string): Promise<{ erreur?: string }> {
  /*
   * **Pas de `exigerReauth` ici, et c'est délibéré**. `modifierMembre` en demande une parce que ce
   * formulaire-là touche aussi l'**adresse email** : changer l'adresse de quelqu'un puis lui
   * renvoyer son lien fait arriver ce lien chez soi. Ici, le seul effet possible est membre ↔
   * instructeur — « administrateur » est refusé quatre lignes plus bas, et le bureau (`estAdmin`)
   * n'est pas touché par ce geste : il se donne et se retire dans « Comptes admin ». Un
   * instructeur, lui, ne touche ni aux comptes ni aux accès. Redemander un code à chaque bascule
   * dans une liste déroulante coûterait à chaque usage pour un geste qui n'ouvre aucune porte.
   */
  const acteur = await assertPermission("members.manage");
  // `estAdmin` lu avec le reste : c'est le champ que `canEditUser` regarde pour protéger un compte
  // du bureau, et un `select` qui l'oublie le ferait passer pour un compte ordinaire.
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true } });
  // Son propre rôle de base se règle : voir `modifierMembre` pour le raisonnement — le rôle de base
  // n'ouvre plus aucun droit, seul le bureau en ouvre, et il ne se touche pas ici.
  if (!canEditUser(acteur, cible)) return { erreur: "Tu ne peux pas changer ce rôle." };
  if (estCompteDeService(cible)) return { erreur: ERREUR_PORTAIL_ROLE_DE_BASE };
  // Reçu du réseau : « administrateur » n'est pas un rôle de base, et ce geste-ci n'écrit que celui-là.
  // (Rien à refuser du côté de la cible : le rôle de base d'un membre du bureau se règle comme un autre.)
  if (role === "ADMIN") return { erreur: ERREUR_ROLE_ADMIN };
  if (role !== "MEMBRE" && role !== "INSTRUCTEUR") return { erreur: "Rôle inconnu." };
  if (role === cible.role) return {};
  await db.user.update({ where: { id: userId }, data: { role } });
  await audit(acteur, "membre.role_modifie", userId, { ancien: cible.role, nouveau: role });
  rafraichir();
  return {};
}

/**
 * **Nommer un administrateur** parmi les personnes déjà dans l'annuaire, depuis l'onglet
 * « Comptes admin » — le pendant de `retirerDroitsAdmin`. Créer un compte tout neuf reste possible
 * juste à côté ; c'est ici qu'on passe quand la personne existe déjà.
 *
 * Elle devra régler mot de passe et double authentification (`/admin/activer`) avant que
 * l'administration s'ouvre à elle : le bureau ouvre la porte, il ne dispense pas du second facteur.
 *
 * **Le bureau s'ajoute à son rôle de base** : son rôle n'est pas remplacé, et un instructeur nommé
 * au bureau reste instructeur.
 */
export async function nommerAdministrateur(_prev: FormState, fd: FormData): Promise<FormState> {
  const acteur = await assertPermission("admins.manage");
  const userId = champ(fd, "userId");
  if (!userId) return { erreur: "Choisis la personne à nommer." };
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true } });
  if (cible.estAdmin) return { erreur: `${cible.prenom} ${cible.nom} est déjà administrateur.` };
  if (!cible.actif) return { erreur: "Ce compte est désactivé : réactive-le d'abord." };
  if (!canEditUser(acteur, cible)) return { erreur: "Tu ne peux pas modifier ce compte." };
  // La destination voyage dans le formulaire (voir `retirerDroitsAdmin` pour le pourquoi) : cette
  // action-ci est une action de **formulaire**, lui ajouter un argument aurait cassé sa signature.
  await exigerReauth(acteur, champ(fd, "retour") || "/admin/comptes");
  // **On AJOUTE le bureau, on ne remplace pas le rôle** : la personne garde celui qu'elle avait, et
  // un instructeur nommé au bureau continue d'enseigner — c'est la demande même qui a fait naître
  // `estAdmin`. Écrire `role: "ADMIN"` lui retirait l'instruction en silence et, depuis la
  // migration, ne lui aurait plus donné **aucun droit** par la matrice.
  await db.user.update({ where: { id: userId }, data: { estAdmin: true } });
  await audit(acteur, "admin.droits_donnes", userId, { email: cible.email, roleDeBase: cible.role });
  rafraichir();
  return { succes: `${cible.prenom} ${cible.nom} est administrateur. Mot de passe et double authentification lui seront demandés avant que l'administration s'ouvre.` };
}

export async function supprimerMembre(userId: string, retour?: string): Promise<void> {
  // Suppression définitive (compte + historique) : réservée au bureau, comme la désactivation
  const acteur = await assertPermission("members.delete");
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!canEditUser(acteur, cible) || acteur.id === userId) throw new Error("Action non autorisée.");
  if (estCompteDeService(cible)) throw new Error(ERREUR_PORTAIL_COMPTE);
  // La suite vient de l'écran du clic (la fiche, ou la ligne de l'annuaire) : voir `envoyerLienMembre`.
  await exigerReauth(acteur, retour ?? `/admin/membres/${userId}`);
  await db.user.delete({ where: { id: userId } });
  await audit(acteur, "membre.supprime", userId, { email: cible.email });
  rafraichir();
  redirect("/admin/membres");
}


/**
 * Envoie (ou régénère) le lien d'accès d'un membre pour une période : depuis sa fiche ou la liste.
 *
 * **Code récent exigé**, et c'est la seconde moitié d'une paire. CLAUDE.md nomme le couple : «
 * changer l'adresse de quelqu'un *et* lui renvoyer son lien fait arriver ce lien chez soi, donc
 * permet d'entrer sous son identité — deux gestes anodins qui, ensemble, valent un mot de passe ».
 * La relecture de sécurité de ce jour a trouvé que **ni l'une ni l'autre** moitié ne redemandait de
 * preuve fraîche ; `definirEmailMembre` et `modifierMembre` viennent d'être corrigées, et laisser
 * celle-ci de côté aurait gardé la paire à moitié ouverte — c'est bien ce geste-ci qui **fait
 * partir la clé**, et elle vaut quatre mois.
 *
 * Portée bornée, et il faut le dire : il faut déjà une session admin élevée pour atteindre cet écran.
 * C'est de la défense en profondeur contre un écran laissé ouvert sur un poste partagé, pas une
 * escalade de rôle. Chacun se renvoie **le sien** sans rien redonner, depuis « Mon profil »
 * (`renvoyerMonLien`, src/actions/profil.ts) : la clé part alors à sa propre adresse, il n'y a pas de
 * détournement possible.
 */
export async function envoyerLienMembre(userId: string, periodId: string, retour?: string): Promise<void> {
  const acteur = await assertPermission("invitations.manage");
  // Le compte de connexion du portail se connecte par mot de passe + 2FA : jamais de lien personnel
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { prenom: true, nom: true, email: true, service: true, actif: true } });
  if (!peutEtreInvite(cible)) throw new Error(ERREUR_COMPTE_SERVICE);
  // Un compte désactivé ne peut plus ouvrir son lien : ne rien envoyer plutôt qu'un lien mort
  if (!cible.actif) throw new Error(ERREUR_COMPTE_INACTIF);
  // Sans adresse email, il n'y a nulle part où envoyer le lien : on le dit, on n'envoie rien
  if (!cible.email) throw new Error(messageSansEmail(cible));
  const periode = await db.period.findUniqueOrThrow({ where: { id: periodId }, select: { statut: true } });
  if (periode.statut === "CLOSE") throw new Error("Période close : les liens ne sont plus valables.");
  /*
   * **Le code est redemandé ici, après les quatre refus**. Il l'était en toute première ligne,
   * avant même de savoir s'il y avait quoi que ce soit à envoyer : c'était de loin le pire cas de
   * l'annuaire. Le bouton « Envoyer le lien » s'affiche en effet sur des fiches où le geste est
   * **voué à être refusé** — compte désactivé, fiche sans adresse email, trimestre clos, compte de
   * connexion du portail. Un administrateur dont le code datait de plus de dix minutes était donc
   * envoyé sur `/connexion/verifier`, rouvrait son application d'authentification, recopiait six
   * chiffres, revenait… et récoltait « Ce compte est désactivé : réactive-le avant de lui envoyer
   * son lien. » Il avait prouvé son identité pour rien, et rien à l'écran ne reliait le détour au
   * refus.
   *
   * L'ordre juste est celui-ci, et il ne relâche aucun verrou : `assertPermission` reste en tête, le
   * code reste exigé **avant** l'envoi (c'est ce geste-ci qui fait partir une clé de quatre mois —
   * voir le docstring), et seuls des **refus** ont été remontés devant lui.
   *
   * **Et le code redonné ramène à l'écran du clic** (corrigé dans la foulée). La suite était écrite en
   * dur sur la liste, alors que le bouton vit sur **deux** écrans — le volet « Gérer » d'une ligne de
   * l'annuaire et la carte « Lien d'accès » d'une fiche (`/admin/membres/<id>`). Depuis la fiche, le
   * détour par `/connexion/verifier` déposait donc sur la liste, fiche refermée, sans dire si le lien
   * était parti : l'action n'est pas rejouée après une ré-authentification, il fallait retrouver la
   * ligne et recliquer. Depuis la liste dépliée (`?tout=1`), le filtre et l'étendue étaient perdus par
   * la même occasion. Chaque écran passe donc sa propre destination, comme `definirActif` le fait
   * déjà ; le repli reste la liste, pour qu'un appel sans `retour` ne mène nulle part d'absurde.
   */
  await exigerReauth(acteur, retour ?? "/admin/membres");
  // **Régénération décidée par l'équipe** : le lien précédent meurt, et les sessions qu'il a
  // ouvertes avec lui. C'est le geste que l'on fait quand un lien a pu fuiter — le vider de cet
  // effet le rendrait décoratif (voir `OptionsEnvoi`, src/lib/invitations.ts).
  //
  // **Sauf sur sa propre fiche** : un administrateur qui régénère son lien depuis la liste ou sa
  // fiche est devant son écran — le mettre dehors dans la foulée ressemblerait à une panne, et il
  // lui faudrait rouvrir un email pour rentrer. Ses **autres** appareils tombent quand même :
  // c'est exactement ce que fait déjà « Renvoyer mon lien » (`renvoyerMonLien`, src/actions/profil.ts).
  await envoyerInvitation(userId, periodId, "invitation", { deconnecterAppareils: userId === acteur.id ? "autres" : "tous" });
  await audit(acteur, "invitation.renvoyee", periodId, { userId, appareilsDeconnectes: true });
  rafraichir();
}

/**
 * **Régler les notifications de quelqu'un d'autre**, depuis sa fiche (Gestion → Membres).
 *
 * Le cas réel : « je suis spammé sur mon téléphone » — dit à l'entraînement, pas devant un écran.
 * Plutôt que de renvoyer la personne vers son profil, le bureau le fait pour elle. Trois garde-fous,
 * parce qu'on touche au choix de quelqu'un d'autre :
 *
 * 1. **réservé au bureau** (`notifications.autrui`) : un instructeur gère les fiches, pas ce que
 *    les gens acceptent de recevoir ;
 * 2. **on ne peut que retrancher**, ici comme ailleurs : les types que le club n'envoie plus ne sont
 *    même pas lus dans le formulaire, donc ni allumés, ni éteints en passant — leur case n'existe
 *    pas à l'écran, et une case fabriquée à la main ne changerait rien ;
 * 3. **la trace dit qui a changé quoi** : le journal d'audit garde l'état avant et après, et la
 *    liste des types qui ont bougé.
 *
 * Le stockage est **exactement** celui du profil (`User.preferencesNotifications` + la case
 * historique `rappelEmail`, tenue en miroir par `miseAJourPersonnelle`) : la personne retrouve le
 * réglage dans « Mon profil », tel que le bureau l'a laissé, et le défait quand elle veut.
 */
/** « Cette personne reçoit ce message » : au moins un de ses canaux personnels est ouvert. */
function recoit(prefs: ReturnType<typeof preferencesPersonnellesDe>, type: TypeNotification): boolean {
  return prefs[type].email || prefs[type].push;
}

export async function definirNotificationsMembre(userId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const acteur = await assertPermission("notifications.autrui");
  const cible = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, prenom: true, nom: true, email: true, rappelEmail: true, preferencesNotifications: true, service: true },
  });
  // Le compte de connexion du portail n'est pas une personne du club : il ne reçoit que les alertes
  // de sécurité, qui ne se refusent d'aucun côté. Il n'y a rien à régler pour lui.
  if (estCompteDeService(cible)) return { erreur: "Le compte de connexion du portail ne reçoit que les alertes de sécurité : il n'y a rien à régler ici." };

  const club = await getPreferencesNotifications();
  // Seuls les types que le club envoie encore par email sont réglables : un type coupé par le bureau
  // n'est pas touché (ni activé — la règle « on ne peut que retrancher » vaut aussi pour un admin —,
  // ni éteint au passage parce que sa case manquait dans le formulaire).
  // Un type reste réglable tant que **l'un** de ses canaux personnels part encore (email ou
  // téléphone) : un message coupé partout par le bureau n'est pas touché ici — ni activé (la règle
  // « on ne peut que retrancher » vaut aussi pour un admin), ni éteint au passage parce que sa
  // case manquait dans le formulaire.
  const reglables = TYPES_REFUSABLES.filter((type) => notificationActiveDans(club, type, "email") || notificationActiveDans(club, type, "push"));
  const choix: Partial<Record<TypeNotification, boolean>> = {};
  for (const type of reglables) choix[type] = caseCochee(fd, type);

  // **Une case par message, pas par canal**, sur cet écran-ci : le bureau règle « untel ne veut
  // plus être dérangé par ça », il n'arbitre pas à sa place entre l'email et le téléphone. Le
  // réglage fin, canal par canal, appartient à la personne, dans son profil.
  const avantPrefs = preferencesPersonnellesDe(cible);
  const maj = miseAJourPersonnelle(cible, choix);
  const apresPrefs = preferencesPersonnellesDe({ ...cible, ...maj });
  const avant = Object.fromEntries(TYPES_REFUSABLES.map((type) => [type, recoit(avantPrefs, type)])) as Record<TypeNotification, boolean>;
  const apres = Object.fromEntries(TYPES_REFUSABLES.map((type) => [type, recoit(apresPrefs, type)])) as Record<TypeNotification, boolean>;
  const changements = TYPES_REFUSABLES.filter((type) => avant[type] !== apres[type]);
  const nom = `${cible.prenom} ${cible.nom}`;
  // Relevé avant l'écriture : c'est ce que le journal appellera « avant »
  const rappelEmailAvant = cible.rappelEmail;
  if (changements.length === 0 && rappelEmailAvant === maj.rappelEmail) {
    return { succes: `Rien n'a changé : les réglages de ${cible.prenom} étaient déjà ceux-là.` };
  }

  await db.user.update({ where: { id: userId }, data: maj });
  // Avant / après en toutes lettres : on modifie le choix de quelqu'un d'autre, le journal doit
  // pouvoir répondre « qui a coupé quoi, et à quelle personne ».
  await audit(acteur, "membre.notifications_reglees", userId, {
    membre: nom,
    avant: Object.fromEntries(TYPES_REFUSABLES.map((type) => [type, avant[type]])),
    apres: Object.fromEntries(TYPES_REFUSABLES.map((type) => [type, apres[type]])),
    changements: changements.map((type) => ({ type, titre: DESCRIPTIONS[type].titre, avant: avant[type], apres: apres[type] })),
    rappelEmail: { avant: rappelEmailAvant, apres: maj.rappelEmail },
  });
  revalidatePath(`/admin/membres/${userId}`);
  revalidatePath("/profil");

  const recus = reglables.filter((type) => apres[type]).length;
  return {
    succes:
      recus === 0
        ? `C'est enregistré : ${cible.prenom} ne recevra plus aucun de ces messages. ${cible.prenom} peut revenir dessus depuis « Mon profil ».`
        : `C'est enregistré : ${cible.prenom} recevra ${recus} sorte${recus > 1 ? "s" : ""} de message sur ${reglables.length}. ${cible.prenom} peut revenir dessus depuis « Mon profil ».`,
  };
}

export type ResultatImport = FormState & { importes?: number; ignores?: string[] };

/**
 * **Combien de lignes un envoi traite au plus.** Le plafond existe pour qu'un fichier collé de
 * travers ne crée pas dix mille comptes ; il ne doit pas **avaler** ce qui dépasse en silence — ce
 * qui est laissé de côté est annoncé, avec la marche à suivre.
 */
const MAX_LIGNES_IMPORT = 500;

/**
 * **Ce qu'un import accepte de lire, vérifié AVANT de lire.**
 *
 * L'ordre comptait : le fichier était lu en entier (`arrayBuffer`), décodé en entier — **deux
 * fois** quand le repli Windows-1252 se déclenche —, découpé en un objet par ligne, et le plafond
 * de 500 lignes ne tombait qu'après. Un fichier de 5 Mo (le plafond de `bodySizeLimit`, voir
 * `next.config.ts`) déposé en boucle, c'était autant de mégaoctets matérialisés en mémoire à chaque
 * envoi, sur une instance unique qui sert aussi les cours du soir. Les dépôts d'images du projet,
 * eux, testent déjà `fichier.size` avant `arrayBuffer()` (`src/actions/evenements.ts`) : on fait
 * pareil ici.
 *
 * 512 ko : 500 lignes « prénom;nom;email;rôle » pèsent quelques dizaines de kilo-octets. Le plafond
 * est donc dix fois au-dessus de ce que l'écran promet d'importer, et il n'écarte que des fichiers
 * qui ne sont de toute façon pas un annuaire de club.
 */
const IMPORT_CSV_TAILLE_MAX = 512 * 1024;

/** Refus commun au fichier et au texte collé : même plafond, même phrase. */
const ERREUR_IMPORT_TROP_GROS = `Ce fichier est trop gros (plus de ${Math.round(IMPORT_CSV_TAILLE_MAX / 1024)} ko) : un import traite ${MAX_LIGNES_IMPORT} lignes au plus. Découpe-le et relance l'import fichier par fichier.`;

/** Message rendu quand le fichier n'est ni de l'UTF-8 ni du Windows-1252 lisible (voir `lireFichierCsv`). */
const ERREUR_ENCODAGE_CSV = "Ton fichier n'est pas en UTF-8 : réenregistre-le depuis ton tableur en « CSV UTF-8 », puis réessaie.";

/**
 * **Le texte d'un CSV déposé, dans l'encodage que le tableur a choisi — pas dans celui qu'on espère.**
 *
 * `File.text()` décode **toujours** en UTF-8. Or « CSV séparateur point-virgule », le format que
 * propose Excel sur un poste Windows français — donc le plus courant dans un bureau d'association —,
 * s'écrit en **Windows-1252** : chaque accent y tient sur un octet que l'UTF-8 déclare invalide, et
 * le décodage le remplace par « � » sans rien dire. Résultat : des noms abîmés en base
 * (« Lefran�ois »), et une ligne d'en-tête devenue « Pr�nom » que l'analyse ne reconnaît plus —
 * elle partait donc comme un membre et se faisait rejeter avec un message incompréhensible.
 *
 * On décode donc en UTF-8 **strict** (`fatal: true`) : au premier octet impossible, la seule autre
 * hypothèse réaliste est Windows-1252, et on retente avec — mieux vaut rattraper que refuser un
 * fichier que la personne a exporté de bonne foi. Le rattrapage est **dit** à l'écran : un CSV mal
 * étiqueté reste un CSV à réenregistrer.
 *
 * Le BOM est retiré par `TextDecoder` comme il l'était par `File.text()` : rien à faire de ce côté.
 * Un texte collé dans la zone, lui, arrive déjà décodé par le navigateur.
 */
async function lireFichierCsv(fichier: File): Promise<{ texte: string; rattrape: boolean } | { erreur: string }> {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  try {
    return { texte: new TextDecoder("utf-8", { fatal: true }).decode(octets), rattrape: false };
  } catch {
    try {
      return { texte: new TextDecoder("windows-1252").decode(octets), rattrape: true };
    } catch {
      // Environnement sans ICU complet : on préfère refuser que d'importer des noms abîmés.
      return { erreur: ERREUR_ENCODAGE_CSV };
    }
  }
}

/** Import CSV : prénom;nom;email;rôle (MEMBRE ou INSTRUCTEUR). Les emails déjà connus sont ignorés. */
export async function importerMembres(_prev: ResultatImport, fd: FormData): Promise<ResultatImport> {
  // Même règle que la création à l'unité : l'import ouvre des comptes
  const acteur = await assertPermission("members.create");
  /*
   * **Un limiteur, comme sur les autres dépôts.** Un import lit un fichier, décode, découpe, puis
   * crée des comptes un par un — c'est le geste le plus coûteux de l'annuaire, et il n'avait aucune
   * borne : rien n'empêchait de le rejouer en boucle. Le rythme retenu est celui du dépôt d'affiche
   * (`affiche_televersement_user`) : un import est un geste de rentrée, pas une action d'écran.
   */
  if (!(await checkRateLimit("import_csv_user", acteur.id))) {
    return { erreur: "Trop d'imports lancés d'un coup. Réessaie dans quelques minutes." };
  }
  // Un <input type="file"> vide envoie quand même un File de taille nulle : sans le test sur la
  // taille, on lisait ce fichier vide et le texte collé n'était jamais pris en compte.
  const fichier = fd.get("fichier");
  let depuisFichier = "";
  let encodageRattrape = false;
  if (fichier instanceof File && fichier.size > 0) {
    // **Avant `arrayBuffer()`** : refuser après avoir tout chargé en mémoire ne refuse rien du tout.
    if (fichier.size > IMPORT_CSV_TAILLE_MAX) return { erreur: ERREUR_IMPORT_TROP_GROS };
    const lu = await lireFichierCsv(fichier);
    if ("erreur" in lu) return { erreur: lu.erreur };
    depuisFichier = lu.texte;
    encodageRattrape = lu.rattrape;
  }
  const texte = depuisFichier.trim() ? depuisFichier : champ(fd, "texte");
  if (!texte.trim()) return { erreur: "Choisis un fichier CSV ou colle des lignes." };
  // Le même plafond pour la zone de texte : coller un annuaire entier passe par le même découpage
  // qu'un fichier, et `bodySizeLimit` laisse entrer 5 Mo. (Le texte est déjà décodé par le
  // navigateur : on borne ici en caractères, l'ordre de grandeur est le même.)
  if (texte.length > IMPORT_CSV_TAILLE_MAX) return { erreur: ERREUR_IMPORT_TROP_GROS };
  const periodIds = fd.getAll("periodIds").filter((v): v is string => typeof v === "string");
  const recues = analyserCsvMembres(texte);
  const lignes = recues.slice(0, MAX_LIGNES_IMPORT);
  const ignores: string[] = [];
  if (encodageRattrape) {
    ignores.push(
      "Ton fichier n'était pas en UTF-8 : il a été lu comme un CSV Windows (Excel FR) et les accents ont été rétablis. Si un nom paraît abîmé dans la liste, réenregistre le fichier en « CSV UTF-8 » et recommence.",
    );
  }
  // Ce qui dépasse du plafond ne disparaît plus sans un mot : 620 lignes annonçaient « 500 membres
  // importés » et 120 personnes manquaient à l'appel, sans rien pour le raconter.
  const enTrop = recues.length - lignes.length;
  if (enTrop > 0) {
    ignores.push(
      `${enTrop} ligne${enTrop > 1 ? "s" : ""} au-delà de la ${MAX_LIGNES_IMPORT}e ${enTrop > 1 ? "n'ont" : "n'a"} pas été lue${enTrop > 1 ? "s" : ""} : un envoi traite ${MAX_LIGNES_IMPORT} lignes au plus. Retire du fichier les lignes déjà importées, puis relance l'import pour la suite.`,
    );
  }
  let importes = 0;
  for (const l of lignes) {
    // Le copier-coller ne fait pas naître un administrateur non plus (voir `ERREUR_ADMIN_A_CREER`) :
    // la ligne est importée comme membre serait trompeur, on l'écarte en le disant.
    // **Ce `"ADMIN"`-là n'est pas une valeur de base mais le mot écrit dans le fichier** (colonne 4,
    // mise en capitales par `analyserCsvMembres`) : le refus reste atteignable, et il le reste tant
    // que `ligneCsvSchema` accepte les trois noms de la matrice.
    if (l.role === "ADMIN") {
      ignores.push(`ligne ${l.ligne} : un administrateur se nomme dans « Comptes admin », il ne s'importe pas.`);
      continue;
    }
    const parsed = ligneCsvSchema.safeParse(l);
    if (!parsed.success) {
      ignores.push(`ligne ${l.ligne} : ${parsed.error.issues[0]?.message ?? "invalide"}`);
      continue;
    }
    // Colonne email vide : la ligne passe, le compte est créé sans adresse (email `null`).
    // Le doublon ne se vérifie que sur une adresse renseignée — plusieurs `null` cohabitent.
    if (parsed.data.email && (await db.user.findUnique({ where: { email: parsed.data.email } }))) {
      ignores.push(`ligne ${l.ligne} : ${parsed.data.email} existe déjà`);
      continue;
    }
    const user = await db.user.create({ data: { ...parsed.data, couleur: await prochaineCouleurLibre() } });
    await inscrireAuxPeriodes(user.id, periodIds);
    importes++;
  }
  // Le journal garde de quoi expliquer un écart : ce qui a été reçu, ce qui a été lu, et si
  // l'encodage a dû être rattrapé.
  await audit(acteur, "membre.import_csv", null, {
    importes,
    ignores: ignores.length,
    lignesRecues: recues.length,
    lignesLues: lignes.length,
    encodage: encodageRattrape ? "windows-1252" : "utf-8",
  });
  rafraichir();
  return { succes: `${importes} membre${importes > 1 ? "s" : ""} importé${importes > 1 ? "s" : ""}.`, importes, ignores };
}

/**
 * **Envoyer l'invitation à quelqu'un qui n'est jamais entré** — la première clé, avec le parcours
 * d'entrée complet, comme à la création du compte.
 *
 * C'est le pendant de « Réinitialiser les accès » (`reinitialiserAccesMembre`, juste en dessous), et
 * la frontière entre les deux est une seule fonction (`aDejaUnAcces`, src/lib/membres.ts) : jamais
 * entré → l'invitation, qui **n'efface rien** ; déjà entré → la réinitialisation, qui efface. Le
 * refus d'un compte déjà entré est une **garde serveur**, pas seulement un bouton masqué : une
 * « bienvenue » envoyée à quelqu'un d'installé lui ferait rejouer l'installation pour rien.
 *
 * **Verrous de « Envoyer le lien »** (`envoyerLienMembre`), puisqu'une clé de quatre mois part :
 * `invitations.manage`, le compte du portail exclu, compte actif, adresse, période ouverte, et le
 * **code récent après les refus**. Plus `canEditUser`, comme les gestes de masse de l'annuaire.
 * Pas de déconnexion : il n'y a, par définition, aucune session à fermer.
 */
export async function envoyerInvitationMembre(userId: string, periodId: string, retour?: string): Promise<void> {
  const acteur = await assertPermission("invitations.manage");
  const cible = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true, ...CHAMPS_TEMOINS_ACCES },
  });
  if (!peutEtreInvite(cible)) throw new Error(ERREUR_COMPTE_SERVICE);
  if (!canEditUser(acteur, cible)) throw new Error("Accès refusé");
  if (aDejaUnAcces(temoinsAcces(cible))) {
    throw new Error(`${cible.prenom} ${cible.nom} est déjà entré : l'invitation n'a plus de sens. Renvoie-lui son lien, ou réinitialise ses accès.`);
  }
  if (!cible.actif) throw new Error(ERREUR_COMPTE_INACTIF);
  if (!cible.email) throw new Error(messageSansEmail(cible));
  const periode = await db.period.findUniqueOrThrow({ where: { id: periodId }, select: { statut: true } });
  if (periode.statut === "CLOSE") throw new Error("Période close : les liens ne sont plus valables.");
  await exigerReauth(acteur, retour ?? "/admin/membres");
  // `parcours: "force"` : le parcours d'entrée complet, même si un lien jamais utilisé l'avait déjà marqué vu.
  const parti = await envoyerInvitation(userId, periodId, "invitation", { parcours: "force" });
  await audit(acteur, "invitation.envoyee", periodId, { userId, parti });
  rafraichir();
}

/**
 * **Repartir de zéro sur le compte de quelqu'un** : mot de passe effacé, double authentification
 * retirée, codes de secours jetés, liens en cours révoqués, appareils déconnectés.
 *
 * À quoi ça sert, très concrètement : quelqu'un a perdu son téléphone *et* oublié son mot de passe,
 * ou a quitté le club puis revient, ou son compte a pu être compromis. Sans ce geste, le bureau
 * n'avait aucun moyen de le remettre à neuf — on pouvait lui renvoyer un lien, mais son ancien mot
 * de passe et son ancienne 2FA restaient en place, donc l'ancienne porte aussi.
 *
 * **Le compte n'est pas supprimé, et rien de son histoire ne l'est** : ses présences, ses ateliers,
 * ses réponses restent. C'est l'*accès* qui est remis à zéro, pas la personne. Après ça, elle est
 * exactement dans l'état d'un nouveau membre : plus aucune façon d'entrer tant qu'on ne lui a pas
 * envoyé un lien — d'où le bouton « Envoyer le lien » juste à côté, qui est la suite normale.
 *
 * Droits : `members.manage`, donc le bureau, en session élevée (voir la matrice). Plus un code 2FA
 * récent (`exigerReauth`) : c'est un geste qui coupe l'accès de quelqu'un, au même titre qu'une
 * désactivation. Et `canEditUser`, pour qu'on ne puisse pas remettre à zéro un administrateur sans
 * en être un soi-même.
 */
export async function reinitialiserAccesMembre(userId: string, retour?: string): Promise<void> {
  const acteur = await assertPermission("members.manage");
  const cible = await db.user.findUniqueOrThrow({
    where: { id: userId },
    // `estAdmin` compris : c'est lui qui dit « compte du bureau » à `canEditUser` (voir plus bas).
    select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true, totpSecret: true, ...CHAMPS_TEMOINS_ACCES },
  });
  if (!canEditUser(acteur, cible)) throw new Error("Accès refusé");
  // Le compte du portail est la porte de secours du club : la vider le fermerait dehors lui aussi.
  if (estCompteDeService(cible)) throw new Error(ERREUR_PORTAIL_ACCES);
  // **Réservé à qui est déjà entré** (`aDejaUnAcces`) : à quelqu'un qui ne l'est jamais, il n'y a rien
  // à effacer, et c'est « Envoyer l'invitation » qui lui donne sa première clé. La garde est ici et
  // pas seulement dans l'écran : le bouton absent ne ferme pas la route.
  if (!aDejaUnAcces(temoinsAcces(cible))) throw new Error(`${cible.prenom} ${cible.nom} n'est jamais entré : il n'y a rien à réinitialiser. Envoie-lui plutôt l'invitation.`);
  // La suite vient de l'écran du clic (la fiche, ou la ligne de l'annuaire) : voir `envoyerLienMembre`.
  await exigerReauth(acteur, retour ?? `/admin/membres/${userId}`);

  const issue = await remettreAccesAZero(cible);

  await audit(acteur, "membre.acces_reinitialise", userId, {
    avaitMotDePasse: !!cible.passwordHash,
    avaitDeuxFa: !!cible.totpSecret && !!cible.totpActiveAt,
    ...issue,
  });
  rafraichir();
}

/** Sessions de connexion d'un utilisateur révoquées par un admin. */
export async function revoquerSessionsUtilisateur(userId: string): Promise<void> {
  const acteur = await assertPermission("auth_sessions.revoke");
  await exigerReauth(acteur, "/admin/sessions");
  const n = await revokeAllSessions(userId, acteur.id === userId);
  await audit(acteur, "sessions.revoquees", userId, { nombre: n });
  revalidatePath("/admin/sessions");
}

export async function revoquerSession(sessionId: string): Promise<void> {
  const acteur = await assertPermission("auth_sessions.revoke");
  const courant = await getCurrentUser();
  // Refus d'abord, code ensuite (voir `envoyerLienMembre`) : la liste des sessions affiche aussi
  // **la ligne de l'administrateur qui la regarde**, et son bouton « Déconnecter » est celui qu'on
  // clique par mégarde. Le code était demandé avant ce refus : on redonnait six chiffres pour
  // s'entendre dire « impossible de révoquer sa propre session ici ».
  if (courant?.sessionId === sessionId) throw new Error("Impossible de révoquer sa propre session ici.");
  await exigerReauth(acteur, "/admin/sessions");
  await db.authSession.delete({ where: { id: sessionId } }).catch(() => {});
  await audit(acteur, "session.revoquee", sessionId);
  revalidatePath("/admin/sessions");
}
