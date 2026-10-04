"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { abaisserSessionCourante, createSession, destroySession, marquerReauth, renforcerSessionCourante, revokeAllSessions } from "@/lib/auth/session";
import {
  activerTotp,
  consommerCodeTotp,
  fermerAffichageCodes,
  fermerAttente2fa,
  genererSecretTotp,
  lireAttente2fa,
  ouvrirAffichageCodes,
  ouvrirAttente2fa,
  etatSecretTotp,
  MESSAGE_SECRET_2FA_ILLISIBLE,
} from "@/lib/auth/deux-fa";
import { consommerCodeSecours, enregistrerCodesSecours, genererCodesSecours } from "@/lib/auth/codes-secours";
import { destinationRetour, getCurrentUser, oublierDestination, type CurrentUser } from "@/lib/auth/current-user";
import {
  ANCRE_SECURITE,
  CHEMIN_ACTIVATION_ADMIN,
  compteAcces,
  deuxFaActive,
  etapeAcces,
  exigeDeuxFaConnexion,
  fermerReglage2fa,
  lireReglage2fa,
  ouvrirReglage2fa,
  peutOuvrirSessionForte,
  peutProposerDeuxFa,
  accesAdminRegle,
  peutReglerSonAcces,
  peutSecuriserSonCompte,
  peutSeConnecterParMotDePasse,
  type CompteAcces,
} from "@/lib/auth/acces-admin";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { generateToken, hashToken, isValidTokenFormat } from "@/lib/auth/tokens";
import { apresInvitation } from "@/lib/auth/apres-invitation";
import { clientIp, userAgent } from "@/lib/request-info";
import { DUREE_RESET_MS } from "@/lib/constants";
import { baseUrl } from "@/lib/env";
import { enqueueEmail } from "@/lib/email/mailer";
import { decrireAppareil, emailNouvelAppareil, emailReset } from "@/lib/email/templates/auth";
import { formatDateHeure } from "@/lib/dates";
import { checkInvitation, consumeInvitation, jetonDuLienColle, marquerParcoursVu, renouvelerLien, signalerOuverture, verifierAppareils } from "@/lib/invitations";
import { alerterLienRevoque, surveillerLiensInconnus } from "@/lib/alertes";
import { prevenirNouvelAppareilParPush } from "@/lib/notifications/securite";
import { poserLienPersonnel } from "@/lib/lien-personnel";
import { caseCochee, champ, zodToFormState, type FormState } from "@/lib/form";
import { cheminSuiteSur, demandeResetSchema, destinationApresConnexion, loginSchema, nouveauMotDePasseSchema } from "@/lib/validation/auth";
import { identite } from "@/lib/identite";

/**
 * **Un seul message d'échec**, quelle que soit la raison : adresse inconnue, mot de passe faux,
 * compte désactivé, ou compte qui n'a tout simplement pas de mot de passe (le cas courant depuis que
 * la porte est ouverte à tous). Il renvoie au lien personnel sans jamais dire si le compte existe :
 * pas d'énumération de comptes.
 */
const MESSAGE_LOGIN_GENERIQUE = "Email ou mot de passe incorrect. Si tu n'as pas défini de mot de passe, entre avec ton lien personnel reçu par email.";
const MESSAGE_TROP_DE_TENTATIVES = "Trop de tentatives. Réessaie dans quelques minutes.";
/**
 * Lien collé refusé : **un seul message**, qu'il soit mal recopié, expiré, révoqué ou inventé — et
 * qui ne répète jamais ce qui a été saisi (un jeton n'a rien à faire dans un message d'erreur).
 */
const MESSAGE_LIEN_COLLE_REFUSE =
  "Ce lien ne fonctionne pas. Vérifie que tu l'as collé en entier, ou demande à l'administrateur de t'en renvoyer un.";
/** Lien collé arrivé à terme, et un lien neuf est parti : le même geste que sur la page du lien. */
const MESSAGE_LIEN_COLLE_RENOUVELE =
  "Ce lien avait expiré (ils sont valables 4 mois) : un lien neuf vient de partir à ton adresse email — pense à vérifier tes spams. Colle celui-là pour entrer.";
/** Même expiration, mais aucun email ne pouvait partir : on ne fait pas attendre devant une boîte vide. */
const MESSAGE_LIEN_COLLE_EXPIRE_SANS_ENVOI =
  "Ce lien a expiré (ils sont valables 4 mois) et aucun lien neuf n'a pu être envoyé automatiquement. Connecte-toi avec ton mot de passe si tu en as un, sinon demande un nouveau lien à l'administrateur.";

/** Connexion email + mot de passe. */
export async function seConnecter(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: champ(fd, "email"),
    motDePasse: champ(fd, "motDePasse"),
    resterConnecte: caseCochee(fd, "resterConnecte"),
    suite: champ(fd, "suite") || undefined,
  });
  if (!parsed.success) return zodToFormState(parsed.error);
  const { email, motDePasse, resterConnecte, suite } = parsed.data;

  const ip = await clientIp();
  if (!(await checkRateLimit("login_ip", ip)) || !(await checkRateLimit("login_email", email))) {
    return { erreur: MESSAGE_TROP_DE_TENTATIVES };
  }

  const user = await db.user.findUnique({ where: { email } });
  const ok = await verifyPassword(user?.passwordHash, motDePasse);
  if (!user || !ok || !user.actif) {
    await audit(user ? { id: user.id, email: user.email } : { id: "", email }, "connexion.echec", null, {
      raison: !user ? "inconnu" : !ok ? "mot_de_passe" : "inactif",
    });
    return { erreur: MESSAGE_LOGIN_GENERIQUE };
  }
  // Garde-fou : la porte n'existe que pour un compte actif, avec une adresse et un mot de passe.
  // Les trois sont déjà vérifiés ci-dessus ; on le redit ici, au seul endroit qui ouvre une session
  // par identifiants, pour que la règle reste lisible d'un seul tenant (voir acces-admin.ts).
  if (!peutSeConnecterParMotDePasse(user)) {
    await audit({ id: user.id, email: user.email }, "connexion.echec", null, { raison: "sans_mot_de_passe" });
    return { erreur: MESSAGE_LOGIN_GENERIQUE };
  }

  // La page mémorisée avant la connexion, sauf si c'est un écran simplement rouvert (voir
  // `destinationApresConnexion`) : se connecter dépose alors à l'accueil.
  const destination = destinationApresConnexion(await destinationRetour(suite));

  // Mot de passe correct, et pas de second facteur à demander : membre ou instructeur qui s'est donné
  // un mot de passe sans activer la double authentification.
  if (!exigeDeuxFaConnexion(user)) {
    // On la lui **propose** au passage (une fois par trimestre, pas plus) : beaucoup ignorent que
    // ça existe, et c'est le seul moment où la question tombe à propos. L'écran porte un bouton
    // « Plus tard » qui ouvre la session sans rien configurer — voir `passerDeuxFa`.
    if (peutProposerDeuxFa(user)) {
      await ouvrirAttente2fa({ userId: user.id, remember: resterConnecte, suite: destination, secretProvisoire: genererSecretTotp() });
      await audit({ id: user.id, email: user.email }, "connexion.mot_de_passe_ok", null, { deuxFaConfiguree: false, proposition: true });
      redirect("/connexion/code");
    }
    // Session **ordinaire** — la même que par lien personnel : jamais forte, donc aucune porte
    // d'administration ouverte au passage.
    await oublierDestination();
    await destroySession(); // remplace une éventuelle session ouverte par lien
    await createSession(user.id, resterConnecte, "mot-de-passe", false);
    await audit({ id: user.id, email: user.email }, "connexion.succes", null, { resterConnecte, deuxFa: false });
    redirect(await apresConnexion(user.id, destination));
  }

  // Second facteur exigé : toujours pour un ADMIN (même s'il n'a rien configuré — la configuration est
  // alors guidée), et pour quiconque a activé la double authentification de son plein gré.
  const etatSecret = await etatSecretTotp(user.id);
  /*
   * **Un secret illisible ne se remplace pas sur présentation du mot de passe**. C'est le cœur du
   * correctif décrit dans `etatSecretTotp` : confondu avec « absent », ce cas faisait engendrer un
   * secret provisoire, et le premier venu avec le mot de passe inscrivait son téléphone. On
   * s'arrête ici, avant même d'ouvrir l'attente 2FA — il n'y a rien à faire de ce compte sans un
   * administrateur.
   */
  if (etatSecret.etat === "illisible") {
    await audit({ id: user.id, email: user.email }, "connexion.deux_fa_illisible");
    redirect("/connexion?erreur=2fa-illisible");
  }
  await ouvrirAttente2fa({
    userId: user.id,
    remember: resterConnecte,
    suite: destination,
    // On ne propose la configuration d'un nouveau secret qu'à un compte à qui la 2FA est **imposée**
    // (ADMIN). Un membre qui n'en veut pas n'est jamais passé par ici.
    secretProvisoire: etatSecret.etat === "actif" ? undefined : genererSecretTotp(),
  });
  await audit({ id: user.id, email: user.email }, "connexion.mot_de_passe_ok", null, { deuxFaConfiguree: etatSecret.etat === "actif" });
  redirect("/connexion/code");
}

/** Second temps de la connexion admin : vérification du code de l'application d'authentification. */
export async function verifierCode2fa(_prev: FormState, fd: FormData): Promise<FormState> {
  const attente = await lireAttente2fa();
  if (!attente) redirect("/connexion?erreur=session");
  const user = await db.user.findUnique({ where: { id: attente.uid } });
  if (!user || !peutSeConnecterParMotDePasse(user)) redirect("/connexion?erreur=session");

  const ip = await clientIp();
  if (!(await checkRateLimit("totp_ip", ip)) || !(await checkRateLimit("totp_user", user.id))) return { erreur: MESSAGE_TROP_DE_TENTATIVES };

  const code = champ(fd, "code");
  const etatSecret = await etatSecretTotp(user.id);
  // Voir `etatSecretTotp` : illisible ≠ absent. Le cookie d'attente peut avoir été posé avant la
  // rotation de la clé et porter un secret provisoire ; l'activer écraserait le vrai.
  if (etatSecret.etat === "illisible") redirect("/connexion?erreur=2fa-illisible");
  const secretActif = etatSecret.etat === "actif" ? etatSecret.secret : null;
  const secret = secretActif ?? attente.secretProvisoire;
  if (!secret) redirect("/connexion?erreur=session");
  let parCodeSecours: number | null = null;
  /*
   * **Un code TOTP se consomme, il ne se vérifie pas**.
   *
   * `verifierCodeTotp` ne regarde que l'horloge : rien ne marquait un code comme déjà servi, et le
   * même code à six chiffres restait donc valable pendant toute sa fenêtre plus la tolérance de
   * dérive — 30 à 90 s. Un code aperçu par-dessus une épaule, resté sur une capture d'écran ou dans
   * le journal d'un proxy ouvrait une **seconde** porte, sur le facteur même qui est censé prouver
   * la possession du téléphone. `consommerCodeTotp` retient le pas de temps employé et refuse tout
   * pas inférieur ou égal.
   *
   * Les trois portes d'authentification (ici, l'élévation, la ré-authentification) l'appellent :
   * un chemin corrigé ne dit rien de ses voisins, et un compte n'a qu'une borne pour les trois.
   */
  if (!(await consommerCodeTotp(user.id, secret, code))) {
    // Un code de secours (XXXX-XXXX) remplace le code de l'application, une seule fois — pas pendant la configuration
    parCodeSecours = secretActif ? await consommerCodeSecours(user.id, code) : null;
    if (parCodeSecours === null) {
      await audit({ id: user.id, email: user.email }, "connexion.code_2fa_echec");
      return { erreur: "Code incorrect ou expiré. Regarde le nouveau code dans ton application et réessaie.", erreurs: { code: "Code incorrect." } };
    }
    await audit({ id: user.id, email: user.email }, "connexion.code_secours_utilise", null, { restants: parCodeSecours });
  }
  let suite = cheminSuiteSur(attente.suite);
  if (!secretActif) {
    await activerTotp(user.id, secret);
    // Première activation : 8 codes de secours, montrés une seule fois juste après
    const codes = genererCodesSecours();
    await enregistrerCodesSecours(user.id, codes);
    await ouvrirAffichageCodes(user.id, codes, suite);
    suite = "/connexion/codes-secours";
    await audit({ id: user.id, email: user.email }, "deux_fa.activee");
  }
  await fermerAttente2fa();
  await oublierDestination(); // la destination a servi
  await destroySession(); // remplace une éventuelle session ouverte par lien
  /*
   * **Se connecter n'ouvre pas l'espace admin**.
   *
   * La session créée ici est **ordinaire**, pour tout le monde, y compris un administrateur qui
   * vient de donner son mot de passe *et* son code. Auparavant elle naissait « forte » pour un
   * ADMIN — au motif que `/connexion/admin` demande exactement ces deux facteurs, et qu'il serait
   * absurde de les redemander aussitôt. Le résultat était précisément ce qu'on voulait éviter
   * ailleurs : on ouvrait l'application et l'on était dans les réglages sans l'avoir demandé, avec
   * les douze heures de l'élévation qui commençaient à courir toutes seules.
   *
   * C'est aussi ce que dit déjà, mot pour mot, la porte d'à côté (`seConnecterCommeAdmin`) : « les
   * deux preuves sont redemandées même si la session vient d'être ouverte au mot de passe :
   * l'élévation doit coûter un geste conscient, sinon elle n'est qu'un onglet de plus ». Les deux
   * chemins disent maintenant la même chose.
   *
   * Entrer dans l'application, c'est consulter ses cours — même règle pour tout le monde. L'espace
   * admin se prend depuis « Mon profil », et lui seul crée une session forte
   * (`renforcerSessionCourante`).
   */
  await createSession(user.id, attente.remember === 1, "mot-de-passe", false);
  await audit({ id: user.id, email: user.email }, "connexion.succes", null, { resterConnecte: attente.remember === 1, deuxFa: true, forte: false, codeSecours: parCodeSecours !== null });
  if (parCodeSecours === 0) redirect("/profil?codes=epuises");
  redirect(await apresConnexion(user.id, suite));
}

/**
 * **« Plus tard »** : la personne ne veut pas configurer sa double authentification maintenant.
 *
 * Son mot de passe a été vérifié au temps précédent : la session s'ouvre normalement, exactement
 * comme si rien n'avait été proposé. On note seulement la date, pour ne pas lui reposer la question
 * avant un trimestre (`peutProposerDeuxFa`).
 *
 * **Un administrateur ne passe jamais** : pour lui la double authentification est imposée, pas
 * proposée, et cette action le renvoie à l'écran du code. C'est le garde-fou de tout ce parcours —
 * sans lui, « Plus tard » deviendrait la porte dérobée de l'administration technique.
 */
export async function passerDeuxFa(): Promise<void> {
  const attente = await lireAttente2fa();
  if (!attente) redirect("/connexion?erreur=session");
  const user = await db.user.findUnique({ where: { id: attente.uid } });
  if (!user || !peutSeConnecterParMotDePasse(user)) redirect("/connexion?erreur=session");
  if (deuxFaActive(user)) redirect("/connexion/code");

  await db.user.update({ where: { id: user.id }, data: { deuxFaProposeeLe: new Date() } });
  await fermerAttente2fa();
  await oublierDestination();
  await destroySession(); // remplace une éventuelle session ouverte par lien
  await createSession(user.id, attente.remember === 1, "mot-de-passe", false);
  await audit({ id: user.id, email: user.email }, "deux_fa.proposition_reportee");
  await audit({ id: user.id, email: user.email }, "connexion.succes", null, { resterConnecte: attente.remember === 1, deuxFa: false, propositionPassee: true });
  redirect(await apresConnexion(user.id, cheminSuiteSur(attente.suite)));
}

/**
 * Destination après une connexion : la page demandée, sauf deux réglages qui ne se remettent pas
 * à plus tard.
 *
 * 1. **Mot de passe encore provisoire** (compte d'administration fraîchement créé) : on impose d'en
 *    choisir un avant toute chose.
 * 2. **Administrateur dont l'accès n'est pas réglé** : mot de passe et double authentification lui
 *    sont **obligatoires**, et on le dépose sur son parcours plutôt que de le laisser découvrir
 *    plus tard, devant une porte close, qu'il lui manquait deux réglages. C'est la même règle qu'à
 *    l'ouverture d'un lien personnel (`apresInvitation`) : elle vaut donc pour les deux façons
 *    d'entrer, sans quoi il suffisait de passer par le mot de passe pour y échapper.
 *
 * Ce n'est pas un enfermement : le parcours se quitte, l'application reste utilisable, et c'est la
 * porte de l'espace admin — elle seule — qui reste fermée tant qu'il n'est pas terminé.
 */
async function apresConnexion(userId: string, suite: string): Promise<string> {
  // Les codes de secours qui viennent d'être générés passent toujours en premier
  if (suite === "/connexion/codes-secours") return suite;
  const compte = await compteAcces(userId);
  if (compte?.doitChangerMotDePasse) return "/nouveau-mot-de-passe";
  if (compte && peutReglerSonAcces(compte) && !accesAdminRegle(compte)) return CHEMIN_ACTIVATION_ADMIN;
  return cheminSuiteSur(suite);
}

/**
 * Première connexion avec un mot de passe **provisoire** : on en choisit un vrai.
 *
 * **La condition est vérifiée ici, et pas seulement sur la page.** Une server action est un point
 * d'entrée HTTP à part entière : elle s'appelle directement, sans passer par l'écran qui la garde.
 * Tant que cette action ne regardait que « y a-t-il une session », n'importe quelle session prise
 * à quelqu'un — un lien personnel retrouvé dans une boîte mail, un téléphone laissé déverrouillé —
 * permettait de **réécrire son mot de passe sans connaître l'ancien**, puis, ligne plus bas, de
 * déconnecter la personne de tous ses autres appareils. Changer un mot de passe qu'on connaît se
 * fait depuis « Mon profil » (`changerMotDePasse`), qui demande l'ancien.
 */
export async function choisirMotDePasse(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?erreur=session");
  const parsed = nouveauMotDePasseSchema.safeParse({ motDePasse: champ(fd, "motDePasse"), confirmation: champ(fd, "confirmation") });
  if (!parsed.success) return zodToFormState(parsed.error);
  const compte = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  // Le compte n'attend pas de changement : cet écran ne le concerne pas, et il ne sert pas de
  // raccourci pour se fixer un mot de passe sans donner le précédent.
  if (!compte.doitChangerMotDePasse) redirect(ANCRE_SECURITE);
  if (await verifyPassword(compte.passwordHash, parsed.data.motDePasse)) {
    return { erreur: "Choisis un mot de passe différent du provisoire.", erreurs: { motDePasse: "Trop proche du provisoire." } };
  }
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.motDePasse), doitChangerMotDePasse: false } });
  await revokeAllSessions(user.id, true);
  await audit({ id: user.id, email: user.email }, "mot_de_passe.premier_choix");
  redirect("/");
}

/* ------------------------------------------------------------------------------------------------ */
/* Réglage de l'accès administrateur, compte par compte (/admin/activer)                              */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Garde commune des trois étapes : l'identité vient **de la session, et de nulle part ailleurs**
 * (aucun identifiant de compte ne transite par les formulaires) — on ne règle jamais le compte d'un autre.
 */
async function enReglageDacces(): Promise<{ user: CurrentUser; compte: CompteAcces }> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?erreur=session");
  const compte = await compteAcces(user.id);
  // Membre, instructeur, compte désactivé, ou compte du portail (déjà réglé) : rien à faire ici
  if (!compte || !peutReglerSonAcces(compte)) redirect("/?acces=refuse");
  return { user, compte };
}

/** Limiteur de débit du parcours : par IP et par compte, comme la connexion. */
async function debitReglageOk(userId: string): Promise<boolean> {
  const ip = await clientIp();
  return (await checkRateLimit("activation_ip", ip)) && (await checkRateLimit("activation_user", userId));
}

/**
 * Étape 1 — mot de passe. Mêmes règles que pour le portail (`nouveauMotDePasseSchema`, argon2id).
 * Enchaîne directement sur l'étape 2 en préparant le secret TOTP provisoire.
 */
export async function definirMotDePasseAdmin(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, compte } = await enReglageDacces();
  // Mot de passe déjà défini : c'est « Mon profil » qui le change, pas ce parcours
  if (etapeAcces(compte) !== "mot-de-passe") redirect(CHEMIN_ACTIVATION_ADMIN);
  if (!(await debitReglageOk(user.id))) return { erreur: MESSAGE_TROP_DE_TENTATIVES };

  const parsed = nouveauMotDePasseSchema.safeParse({ motDePasse: champ(fd, "motDePasse"), confirmation: champ(fd, "confirmation") });
  if (!parsed.success) return zodToFormState(parsed.error);

  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.motDePasse), doitChangerMotDePasse: false } });
  await audit({ id: user.id, email: user.email }, "admin.mot_de_passe_defini", user.id);
  await ouvrirReglage2fa(user.id, genererSecretTotp());
  redirect(CHEMIN_ACTIVATION_ADMIN);
}

/** Étape 2 — (re)proposer un QR code : reprise du parcours, ou réglage abandonné en route puis repris. */
export async function preparerDeuxFaAdmin(): Promise<void> {
  const { user, compte } = await enReglageDacces();
  // On ne saute jamais l'étape 1 : pas de double authentification sans mot de passe
  if (etapeAcces(compte) !== "deux-fa") redirect(CHEMIN_ACTIVATION_ADMIN);
  if (!(await debitReglageOk(user.id))) redirect(`${CHEMIN_ACTIVATION_ADMIN}?erreur=tentatives`);
  await ouvrirReglage2fa(user.id, genererSecretTotp());
  redirect(CHEMIN_ACTIVATION_ADMIN);
}

/**
 * Étape 2 — activation par un premier code juste, puis étape 3 : codes de secours affichés une fois.
 * La session en cours devient forte (12 h, sans prolongation) : l'administration s'ouvre avec **ce** compte.
 */
export async function activerDeuxFaAdmin(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, compte } = await enReglageDacces();
  if (etapeAcces(compte) !== "deux-fa") redirect(CHEMIN_ACTIVATION_ADMIN);
  const ip = await clientIp();
  if (!(await checkRateLimit("totp_ip", ip)) || !(await checkRateLimit("totp_user", user.id))) return { erreur: MESSAGE_TROP_DE_TENTATIVES };

  /*
   * **Le mot de passe courant, en plus du code.** C'est cette étape qui rend la session forte : sans
   * cette vérification, détenir le lien personnel d'un administrateur suffisait à devenir cet
   * administrateur — on ouvrait le lien, on scannait le QR code avec son propre téléphone, et
   * l'élévation tombait. Le vrai titulaire se retrouvait dehors, avec un second facteur qui n'était
   * plus le sien.
   *
   * Le titulaire, lui, connaît son mot de passe : le geste ne lui coûte rien. Un administrateur qui
   * n'en a pas encore posé ne peut pas être ici (l'étape 1 précède toujours l'étape 2, `etapeAcces`),
   * donc `compte.passwordHash` est nécessairement renseigné.
   */
  if (!(await verifyPassword(compte.passwordHash, champ(fd, "motDePasse")))) {
    await audit({ id: user.id, email: user.email }, "admin.deux_fa_echec", null, { facteur: "mot_de_passe" });
    return { erreur: "Mot de passe incorrect.", erreurs: { motDePasse: "Mot de passe incorrect." } };
  }

  // Secret provisoire du réglage en cours : rattaché à ce compte, jamais à un autre
  const secret = await lireReglage2fa(user.id);
  if (!secret) redirect(`${CHEMIN_ACTIVATION_ADMIN}?erreur=expire`);
  /*
   * **Ce code est consommé comme les autres**.
   *
   * Il avait d'abord été laissé en vérification pure, au motif que cette porte-ci ne se rejoue pas :
   * le secret est *provisoire* (cookie à usage unique, `lireReglage2fa`), et une fois la 2FA active
   * `etapeAcces` / `deuxFaActive` renvoient l'appel ailleurs. C'est vrai de **cette** porte, et c'est
   * précisément ce qui rendait l'exception trompeuse : le pas de temps, lui, appartient au **compte**,
   * pas au secret provisoire. Non consommé, les six chiffres que l'administrateur vient de recopier
   * ici restaient valables une minute et demie sur la **connexion** et sur la **porte de l'espace
   * admin** — les deux endroits qu'on vient de fermer au rejeu. Une lucarne nommée dans un commentaire
   * reste une lucarne, et celle-ci s'ouvrait juste après le seul moment du parcours où quelqu'un
   * regarde par-dessus l'épaule : l'écran qui affiche un QR code.
   *
   * Ça ne coûte rien à la personne : la fin du parcours élève sa session **sans redemander de code**
   * (`renforcerSessionCourante`), elle n'a donc aucun second code à donner dans la foulée.
   */
  if (!(await consommerCodeTotp(user.id, secret, champ(fd, "code")))) {
    await audit({ id: user.id, email: user.email }, "admin.deux_fa_echec");
    return { erreur: "Code incorrect ou expiré. Regarde le nouveau code dans ton application et réessaie.", erreurs: { code: "Code incorrect." } };
  }

  await activerTotp(user.id, secret);
  await fermerReglage2fa();
  await audit({ id: user.id, email: user.email }, "admin.deux_fa_activee", user.id);

  const codes = genererCodesSecours();
  await enregistrerCodesSecours(user.id, codes);
  await ouvrirAffichageCodes(user.id, codes, "/admin");
  await audit({ id: user.id, email: user.email }, "admin.codes_secours_generes", user.id, { nombre: codes.length });

  // Le réglage est complet : la session ouverte par lien personnel devient forte, sur place
  await renforcerSessionCourante(user.sessionId);
  redirect(CHEMIN_ACTIVATION_ADMIN);
}

/* ------------------------------------------------------------------------------------------------ */
/* Double authentification **facultative**, réglée depuis « Mon profil » (/profil#securite)           */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Garde commune des deux actions ci-dessous. Volontairement plus large que `enReglageDacces` : ici
 * **tout le monde** est admis (membre, instructeur, administrateur), pourvu que le compte soit actif,
 * qu'il ait une adresse et qu'il ait **déjà** un mot de passe — on ne met pas un second verrou sur
 * une porte qui n'en a pas encore un. L'identité vient de la session, et de nulle part ailleurs.
 */
async function enReglageDeSaDeuxFa(): Promise<{ user: CurrentUser; compte: CompteAcces }> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?erreur=session");
  const compte = await compteAcces(user.id);
  if (!compte || !peutSecuriserSonCompte(compte) || !compte.passwordHash) redirect(ANCRE_SECURITE);
  // Un administrateur nominatif qui n'a pas terminé son parcours obligatoire y reste : une seule
  // façon de régler un accès administrateur, et c'est /admin/activer.
  if (peutReglerSonAcces(compte) && etapeAcces(compte) !== "termine") redirect(CHEMIN_ACTIVATION_ADMIN);
  return { user, compte };
}

/** Proposer (ou reproposer) un QR code depuis le profil : secret provisoire, 30 min, ce compte seul. */
export async function preparerMaDeuxFa(): Promise<void> {
  const { user, compte } = await enReglageDeSaDeuxFa();
  if (deuxFaActive(compte)) redirect(ANCRE_SECURITE); // déjà active : rien à préparer
  if (!(await debitReglageOk(user.id))) redirect("/profil?erreur=tentatives#securite");
  await ouvrirReglage2fa(user.id, genererSecretTotp());
  redirect(ANCRE_SECURITE);
}

/**
 * Activer sa double authentification depuis le profil, par un premier code juste, puis afficher les
 * codes de secours une seule fois.
 *
 * **Aucune élévation de session** : à la différence d'`activerDeuxFaAdmin`, rien n'est renforcé ici.
 * La personne repart avec la session qu'elle avait. Activer un second facteur protège son compte ;
 * cela ne lui donne pas un droit de plus — l'administration technique reste au rôle ADMIN, muni
 * d'une session forte ouverte par `/connexion` ou par `/admin/activer`.
 *
 * **Le mot de passe courant est redemandé**, comme pour un administrateur et pour exactement la même
 * raison : sans lui, détenir la session de quelqu'un — un lien personnel laissé ouvert sur un
 * appareil prêté — suffisait à scanner le QR code avec **son propre** téléphone et à repartir avec
 * les codes de secours. Le titulaire se retrouvait dehors, avec un second facteur qui n'était plus
 * le sien. Ses trois voisines (`activerDeuxFaAdmin`, `reinitialiserMaDeuxFa`, `regenererCodesSecours`)
 * le demandaient déjà ; celle-ci était la seule à ne pas le faire. Le mot de passe existe
 * forcément : `enReglageDeSaDeuxFa` refuse un compte qui n'en a pas.
 */
export async function activerMaDeuxFa(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, compte } = await enReglageDeSaDeuxFa();
  if (deuxFaActive(compte)) redirect(ANCRE_SECURITE);
  const ip = await clientIp();
  if (!(await checkRateLimit("totp_ip", ip)) || !(await checkRateLimit("totp_user", user.id))) return { erreur: MESSAGE_TROP_DE_TENTATIVES };

  if (!(await verifyPassword(compte.passwordHash, champ(fd, "motDePasse")))) {
    await audit({ id: user.id, email: user.email }, "deux_fa.activation_echec", null, { facteur: "mot_de_passe" });
    return { erreur: "Mot de passe incorrect.", erreurs: { motDePasse: "Mot de passe incorrect." } };
  }

  const secret = await lireReglage2fa(user.id);
  if (!secret) redirect("/profil?erreur=expire#securite");
  // Consommé comme partout ailleurs : même raison qu'`activerDeuxFaAdmin` ci-dessus — le pas de temps
  // appartient au compte, pas au secret provisoire, et un code non consommé ici resterait valable sur
  // la connexion et sur la porte de l'espace admin pendant une minute et demie.
  if (!(await consommerCodeTotp(user.id, secret, champ(fd, "code")))) {
    await audit({ id: user.id, email: user.email }, "deux_fa.activation_echec");
    return { erreur: "Code incorrect ou expiré. Regarde le nouveau code dans ton application et réessaie.", erreurs: { code: "Code incorrect." } };
  }

  await activerTotp(user.id, secret);
  await fermerReglage2fa();
  await audit({ id: user.id, email: user.email }, "deux_fa.activee", user.id, { depuis: "profil" });

  const codes = genererCodesSecours();
  await enregistrerCodesSecours(user.id, codes);
  await ouvrirAffichageCodes(user.id, codes, ANCRE_SECURITE);
  await audit({ id: user.id, email: user.email }, "deux_fa.codes_generes", user.id, { nombre: codes.length });
  redirect("/connexion/codes-secours");
}

/**
 * **Se connecter en tant qu'administrateur** : l'élévation, depuis une session déjà ouverte.
 *
 * La session ne bouge pas — ni sa ligne, ni son échéance, ni son appareil. On y ajoute le second
 * facteur, et l'espace admin s'ouvre jusqu'à 10 min sans activité (12 h au plus).
 *
 * **Pourquoi le mot de passe *et* le code ici, alors que la connexion à l'application ne demande
 * plus le code à un administrateur** : ce sont deux portes différentes. Entrer dans l'application,
 * c'est consulter ses cours — même règle pour tout le monde. Ouvrir les réglages techniques, c'est
 * autre chose, et cette porte-là n'a jamais eu qu'une serrure à deux tours. Les deux preuves sont
 * redemandées même si la session vient d'être ouverte au mot de passe : l'élévation doit coûter un
 * geste conscient, sinon elle n'est qu'un onglet de plus.
 */
export async function seConnecterCommeAdmin(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?erreur=session");
  if (!peutOuvrirSessionForte(user)) redirect("/?acces=refuse");

  const ip = await clientIp();
  // Les deux limiteurs de la connexion par mot de passe, plus celui des codes : cet écran est une
  // porte d'administration, il ne doit pas devenir le guichet tranquille où l'on essaie des codes.
  if (!(await checkRateLimit("login_ip", ip)) || !(await checkRateLimit("totp_user", user.id))) {
    return { erreur: MESSAGE_TROP_DE_TENTATIVES };
  }

  const compte = await compteAcces(user.id);
  if (!compte || !accesAdminRegle(compte)) redirect(CHEMIN_ACTIVATION_ADMIN);

  const motDePasse = champ(fd, "motDePasse");
  const code = champ(fd, "code");
  // Message unique pour les deux facteurs : dire lequel des deux est faux renseignerait qui essaie.
  const refus = { erreur: "Mot de passe ou code incorrect. (Un code déjà utilisé ne sert pas une seconde fois : attends le suivant dans ton application.)" };

  if (!(await verifyPassword(compte.passwordHash, motDePasse))) {
    await audit({ id: user.id, email: user.email }, "admin.elevation_echec", null, { facteur: "mot_de_passe" });
    return refus;
  }
  const etatSecret = await etatSecretTotp(user.id);
  // Illisible : on ne renvoie **pas** sur le parcours de réglage, qui proposerait un secret neuf (et
  // qui, de toute façon, se déclare « terminé » — voir `etapeAcces`). On le dit, et on s'arrête.
  if (etatSecret.etat === "illisible") return { erreur: MESSAGE_SECRET_2FA_ILLISIBLE };
  if (etatSecret.etat === "absent") redirect(CHEMIN_ACTIVATION_ADMIN);
  const secret = etatSecret.secret;
  // Le code se consomme ici aussi (voir `verifierCode2fa`) : c'est la porte des réglages techniques,
  // celle qui vaut le plus la peine d'être rejouée.
  if (!(await consommerCodeTotp(user.id, secret, code))) {
    const restants = await consommerCodeSecours(user.id, code);
    if (restants === null) {
      await audit({ id: user.id, email: user.email }, "admin.elevation_echec", null, { facteur: "code" });
      return refus;
    }
    await audit({ id: user.id, email: user.email }, "connexion.code_secours_utilise", null, { restants, contexte: "elevation" });
  }

  await renforcerSessionCourante(user.sessionId);
  await audit({ id: user.id, email: user.email }, "admin.espace_ouvert");
  const suite = cheminSuiteSur(champ(fd, "suite"));
  redirect(suite === "/" ? "/admin" : suite);
}

/**
 * **Quitter l'espace admin** : le pendant du bouton « Se connecter en tant qu'administrateur ».
 *
 * On redescend au rang de membre — l'élévation s'efface, la session reste. C'est volontairement
 * *l'inverse* d'une déconnexion : quelqu'un qui ferme les réglages veut continuer à consulter ses
 * cours, pas se retrouver sur la page de connexion. Dix minutes sans rien faire dans l'espace
 * admin font la même chose toutes seules (voir `src/lib/auth/elevation.ts`).
 */
export async function quitterEspaceAdmin(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?erreur=session");
  await abaisserSessionCourante(user.sessionId);
  await audit({ id: user.id, email: user.email }, "admin.espace_quitte");
  redirect("/profil?admin=quitte");
}

/** Ré-authentification pour une action sensible : code de l'application (ou de secours), puis retour à `suite`. */
export async function reverifierCode2fa(suite: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  // Le bureau se lit sur `estAdmin` : `role === "ADMIN"` n'étant plus jamais vrai, cette garde
  // renvoyait **tout le monde** sur la page de connexion — y compris l'administrateur qu'on vient
  // d'envoyer ici pour confirmer son code, qui se retrouvait dehors au milieu de son geste.
  if (!user || !user.estAdmin || !user.sessionForte) redirect("/connexion?erreur=admin");
  const ip = await clientIp();
  if (!(await checkRateLimit("totp_ip", ip)) || !(await checkRateLimit("totp_user", user.id))) return { erreur: MESSAGE_TROP_DE_TENTATIVES };
  const etatSecret = await etatSecretTotp(user.id);
  if (etatSecret.etat === "illisible") return { erreur: MESSAGE_SECRET_2FA_ILLISIBLE };
  if (etatSecret.etat === "absent") redirect("/connexion?erreur=admin");
  const secret = etatSecret.secret;
  const code = champ(fd, "code");
  // Même borne que la connexion et l'élévation (voir `verifierCode2fa`).
  if (!(await consommerCodeTotp(user.id, secret, code))) {
    const restants = await consommerCodeSecours(user.id, code);
    if (restants === null) {
      await audit({ id: user.id, email: user.email }, "reauth.echec");
      return { erreur: "Code incorrect ou expiré. Regarde le nouveau code dans ton application et réessaie.", erreurs: { code: "Code incorrect." } };
    }
    await audit({ id: user.id, email: user.email }, "connexion.code_secours_utilise", null, { restants, contexte: "reauth" });
  }
  await marquerReauth(user.sessionId);
  await audit({ id: user.id, email: user.email }, "reauth.ok");
  redirect(cheminSuiteSur(suite));
}

/** Page « codes de secours » : l'admin confirme les avoir notés. */
export async function confirmerCodesSecours(suite: string): Promise<void> {
  const user = await getCurrentUser();
  await fermerAffichageCodes();
  redirect(user ? await apresConnexion(user.id, suite) : cheminSuiteSur(suite));
}

/** Abandon de la connexion en deux temps. */
export async function annulerConnexion2fa(): Promise<void> {
  await fermerAttente2fa();
  redirect("/connexion");
}

/** Déconnexion. */
export async function seDeconnecter(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit({ id: user.id, email: user.email }, "deconnexion");
  redirect("/connexion");
}

/**
 * « Mot de passe oublié » : réponse toujours identique (pas d'énumération de comptes).
 *
 * **Email seul, et pas de notification sur le téléphone** : qui demande à réinitialiser son mot de
 * passe est par définition dehors, donc sans appareil abonné qui l'attende — et le message porte un
 * lien de réinitialisation, qui n'a rien à faire sur un écran verrouillé. Ne pas « compléter » ce
 * chemin par symétrie avec les autres messages de sécurité : voir l'en-tête de
 * `src/lib/notifications/securite.ts`.
 */
export async function demanderReinitialisation(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = demandeResetSchema.safeParse({ email: champ(fd, "email") });
  if (!parsed.success) return zodToFormState(parsed.error);
  const { email } = parsed.data;
  const succes = { succes: "Si cette adresse correspond à un compte, un email vient de partir. Pense à vérifier tes spams." };

  const ip = await clientIp();
  if (!(await checkRateLimit("reset_ip", ip)) || !(await checkRateLimit("reset_email", email))) return succes;

  const user = await db.user.findUnique({ where: { email } });
  // Même règle que la connexion : on ne renvoie un mot de passe qu'à qui en a déjà un. Un administrateur
  // nominatif qui n'a pas encore réglé son accès passe par son lien personnel puis /admin/activer.
  if (user && peutSeConnecterParMotDePasse(user)) {
    const token = generateToken();
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + DUREE_RESET_MS) },
    });
    const url = `${baseUrl()}/reinitialiser/${token}`;
    const { sujet, contenu } = emailReset({ prenom: user.prenom, url, nomApp: (await identite()).nomCourt });
    // Le compte a été retrouvé **par** cette adresse : elle est forcément renseignée
    enqueueEmail({ to: email, sujet, contenu, ref: `reset_${user.id}` });
    await audit({ id: user.id, email: user.email }, "mot_de_passe.demande_reset");
  }
  return succes;
}

/** Choix d'un nouveau mot de passe via le lien reçu par email. */
export async function reinitialiserMotDePasse(token: string, _prev: FormState, fd: FormData): Promise<FormState> {
  if (!isValidTokenFormat(token)) return { erreur: "Ce lien n'est pas valide." };
  const parsed = nouveauMotDePasseSchema.safeParse({
    motDePasse: champ(fd, "motDePasse"),
    confirmation: champ(fd, "confirmation"),
  });
  if (!parsed.success) return zodToFormState(parsed.error);

  const reset = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now() || !reset.user.actif) {
    return { erreur: "Ce lien a expiré ou a déjà été utilisé. Refais une demande depuis « Mot de passe oublié »." };
  }

  const passwordHash = await hashPassword(parsed.data.motDePasse);
  await db.$transaction([
    // `doitChangerMotDePasse: false` : celui qu'on vient de choisir **est** le vrai. Sans cette
    // remise à zéro, quelqu'un qui passait par « Mot de passe oublié » alors qu'il traînait encore
    // un mot de passe provisoire était renvoyé sur « Choisis ton mot de passe » aussitôt après
    // l'avoir choisi — une boucle absurde. Les deux autres chemins qui posent un mot de passe le
    // font déjà (`choisirMotDePasse`, `definirMotDePasseAdmin`) ; celui-ci l'avait oublié.
    db.user.update({ where: { id: reset.userId }, data: { passwordHash, doitChangerMotDePasse: false } }),
    db.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllSessions(reset.userId);
  await audit({ id: reset.userId, email: reset.user.email }, "mot_de_passe.reinitialise");
  // Même règle qu'à la connexion, et c'est la même fonction : le code est demandé à qui l'a
  // configuré, et à personne d'autre. Pour les autres, le lien reçu par email a déjà prouvé
  // l'identité — la session s'ouvre.
  if (!exigeDeuxFaConnexion(reset.user)) {
    await createSession(reset.userId, true, "mot-de-passe", false);
    await audit({ id: reset.userId, email: reset.user.email }, "connexion.succes", null, { deuxFa: false, apresReset: true });
    redirect("/?mdp=ok");
  }
  const etatSecret = await etatSecretTotp(reset.userId);
  // Même refus qu'à la connexion ordinaire : ce chemin-ci est **le** plus tentant, puisqu'il suffit
  // d'accéder à la boîte email pour y arriver sans connaître le mot de passe.
  if (etatSecret.etat === "illisible") {
    await audit({ id: reset.userId, email: reset.user.email }, "connexion.deux_fa_illisible", null, { apresReset: true });
    redirect("/connexion?erreur=2fa-illisible");
  }
  await ouvrirAttente2fa({ userId: reset.userId, remember: true, suite: "/?mdp=ok", secretProvisoire: etatSecret.etat === "actif" ? undefined : genererSecretTotp() });
  redirect("/connexion/code");
}

/**
 * Lien d'accès personnel : connexion (session de 12 h glissantes, cf. `DUREE_SESSION_LONGUE_MS`) et
 * rattachement à la période ; premier accès → bienvenue.
 * La page demandée au départ (bouton d'un email de rappel) est reprise du formulaire ou du cookie posé
 * par le middleware, puis appliquée — directement, ou à la sortie de l'écran de bienvenue.
 */
export async function connexionParInvitation(token: string, fd?: FormData): Promise<void> {
  const ip = await clientIp();
  if (!(await checkRateLimit("invitation_ip", ip))) redirect("/connexion?erreur=tentatives");

  const check = await checkInvitation(token);
  if (!check.ok) {
    /*
     * **Un jeton inconnu est compté et journalisé ici aussi**. Les deux autres portes le faisaient
     * — la page du lien, à l'ouverture (GET), et le champ « colle ton lien ici » —, celle-ci non.
     * Or la page et son bouton sont **deux requêtes** : l'appui envoie un POST sur cette action, le
     * jeton en argument lié, et rien n'oblige à être passé par le GET qui compte. Qui relève
     * l'identifiant de l'action dans le HTML de cette page publique pouvait donc essayer des jetons
     * à la chaîne sans jamais franchir `invitation_inconnue_ip` (8 par heure), sans laisser de
     * trace dans le journal et sans déclencher l'alerte de balayage : seul le limiteur générique
     * par IP freinait. Les trois portes comptent la même chose, maintenant.
     *
     * Le jeton n'est recopié ni dans le journal ni dans un message — la règle du champ collé vaut ici.
     */
    if (check.raison === "format" || check.raison === "inconnue") {
      const encoreAdmis = await checkRateLimit("invitation_inconnue_ip", ip);
      await audit(null, "invitation.lien_inconnu", null, { ip, bloque: !encoreAdmis, voie: "bouton" });
      await surveillerLiensInconnus();
      if (!encoreAdmis) redirect("/connexion?erreur=tentatives");
    }
    redirect(check.raison === "expiree" ? `/invitation/${token}` : "/connexion?erreur=invitation");
  }

  const { userId, periodId, id, usedAt, parcoursVuLe } = check.invitation;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

  // Même règle que la connexion par mot de passe : un écran rouvert n'est pas une destination.
  const destination = destinationApresConnexion(await destinationRetour(fd ? champ(fd, "suite") : undefined));

  // Un administrateur nominatif dont le mot de passe ou la double authentification manquent doit
  // d'abord les régler : c'est obligatoire pour lui (l'espace admin n'ouvre qu'avec les deux), là
  // où c'est facultatif pour un membre ou un instructeur. Son lien le connecte quand même — on ne
  // lui ferme pas l'application —, mais il le dépose sur `/admin/activer`.
  const reglageAdminDu = peutReglerSonAcces(user) && !accesAdminRegle(user);

  const courant = await getCurrentUser();
  if (courant?.id === userId) {
    // Déjà connecté sur cet appareil : on ne compte pas d'ouverture, on entre simplement
    await oublierDestination();
    redirect(apresInvitation(parcoursVuLe, destination, reglageAdminDu));
  }

  /*
   * Lien ouvert à un rythme anormal (robot, lien diffusé) : révoqué, nouveau lien envoyé, pas de session.
   *
   * **L'issue de la garde voyage jusqu'à l'écran** : elle dit si un lien de remplacement est
   * vraiment parti. Sans cette distinction, `/connexion?erreur=suspect` promettait un email à
   * quelqu'un qui n'en recevra aucun (fiche sans adresse, ou période close) et l'envoyait attendre
   * devant sa boîte mail au lieu d'utiliser la seule porte qui lui reste.
   */
  const suspect = await signalerOuverture(check.invitation);
  if (suspect !== "rien") {
    await audit({ id: userId, email: user.email }, "invitation.suspecte", periodId, { ip, lienRenvoye: suspect === "remplace" });
    await alerterLienRevoque({ invitationId: id, motif: "SUSPECT", email: user.email, ip, remplace: suspect === "remplace" });
    redirect(suspect === "remplace" ? "/connexion?erreur=suspect" : "/connexion?erreur=suspect-sans-email");
  }
  // 3 appareils déjà connectés **avec ce lien** (les connexions par mot de passe ne comptent pas,
  // voir `verifierAppareils`) : le lien est remplacé, un nouveau part par email, et aucune
  // session ne s'ouvre sur cet appareil-ci.
  const appareils = await verifierAppareils(check.invitation);
  if (appareils !== "rien") {
    await audit({ id: userId, email: user.email }, "invitation.appareils_max", periodId, { ip, lienRenvoye: appareils === "remplace" });
    await alerterLienRevoque({ invitationId: id, motif: "APPAREILS", email: user.email, ip, remplace: appareils === "remplace" });
    redirect(appareils === "remplace" ? "/connexion?erreur=appareils" : "/connexion?erreur=appareils-sans-email");
  }

  await consumeInvitation(id, userId, periodId);
  if (courant) await destroySession();
  // `"lien"` : **la seule** création de session qui compte pour le plafond de 3 appareils du lien
  // personnel (`verifierAppareils`). Une session ouverte au mot de passe n'occupe pas un appareil
  // du lien — c'est toute la correction.
  await createSession(userId, true, "lien");
  // À partir du 2e appareil : message de sécurité « nouvel appareil », par email **et** sur ses
  // autres appareils. Les deux textes ne disent pas la même chose, et c'est voulu : l'email nomme
  // l'appareil, l'adresse IP et l'heure, la notification ne dit que « ça vient d'arriver, va voir »
  // (elle s'affiche écran verrouillé — voir `src/lib/notifications/securite.ts`).
  if (check.invitation.ouvertures >= 1) {
    // Sans adresse email, l'email de sécurité ne peut pas partir : on n'envoie rien, sans erreur
    // (en pratique ce cas ne se présente pas, un lien personnel n'existe que pour une adresse connue).
    if (user.email) {
      const ua = await userAgent();
      const { sujet, contenu } = emailNouvelAppareil({ prenom: user.prenom, appareil: decrireAppareil(ua), ip, quand: formatDateHeure(new Date()), nomApp: (await identite()).nomCourt });
      enqueueEmail({ to: user.email, sujet, contenu, ref: `nouvel_appareil_${user.id}_${Date.now()}` });
    }
    // La clé porte le rang de l'appareil, comme le journal d'audit juste en dessous : chaque ouverture
    // nouvelle prévient une fois, et rejouer la même n'en refait pas partir une seconde.
    await prevenirNouvelAppareilParPush(user.id, `nouvel_appareil_push_${id}_${check.invitation.ouvertures + 1}_${user.id}`);
  }
  await audit({ id: userId, email: user.email }, usedAt ? "invitation.connexion" : "invitation.premier_acces", periodId, { appareil: check.invitation.ouvertures + 1 });
  await oublierDestination();
  // Le parcours d'accueil suit, et c'est le **seul** endroit de l'application où un bouton « Copier
  // mon lien » est possible — la base ne garde que le SHA-256 du jeton, le lien en clair n'existe
  // qu'ici, à cet instant. On le lui passe par un cookie de passage plutôt que par l'URL : un jeton
  // dans l'adresse resterait dans l'historique, partirait dans le `Referer` et se retrouverait dans
  // les journaux du proxy. `httpOnly`, borné à `/bienvenue`, et périmé en 15 min.
  if (!parcoursVuLe) {
    await marquerParcoursVu(id);
    // Signé au nom de cette personne et chiffré : sur un appareil partagé, le suivant ne peut pas
    // récupérer la clé du précédent (voir `src/lib/lien-personnel.ts`).
    await poserLienPersonnel(userId, token);
  }
  redirect(apresInvitation(parcoursVuLe, destination, reglageAdminDu));
}

/**
 * **« J'ai reçu un lien par email — colle-le ici »** (page de connexion).
 *
 * Pourquoi ce champ existe : sur iPhone, l'application installée sur l'écran d'accueil a un
 * **stockage séparé de Safari**, et un lien cliqué dans Mail ouvre Safari — jamais l'icône. Sans ce
 * champ, quelqu'un qui a installé l'application et n'a pas de mot de passe reste bloqué devant
 * l'écran de connexion : son lien ne se colle nulle part, une PWA n'ayant pas de barre d'adresse.
 *
 * **Ce n'est pas un second parcours d'authentification** : une fois le jeton extrait, tout repasse
 * par `connexionParInvitation` — mêmes vérifications, mêmes gardes anti-abus, même journal. Coller
 * son lien ou l'ouvrir revient exactement au même.
 *
 * Deux précautions propres à la saisie à la main :
 * - un jeton **inconnu** est compté par IP (`invitation_inconnue_ip`) et journalisé comme sur la page
 *   du lien : le champ ne doit pas devenir le guichet tranquille où l'on essaie des jetons ;
 * - **ce qui est saisi ne ressort jamais** — ni dans le message d'erreur, ni dans le journal. Le
 *   message est le même pour un lien mal recopié, un lien inventé et un lien révoqué.
 *
 * **Un lien expiré collé déclenche le même renouvellement que la page du lien**. Il n'en
 * déclenchait aucun : la personne recevait « demande à l'administrateur » là où l'ouverture de la
 * même URL lui aurait renvoyé un lien neuf. Or ce champ existe précisément pour qui **ne peut pas**
 * ouvrir l'URL — application installée sur iPhone, pas de barre d'adresse : c'était la personne la
 * plus démunie qui recevait la réponse la plus sèche, et le docstring d'à côté affirmait que coller
 * ou ouvrir « revient exactement au même ». C'est le seul endroit où le message distingue un cas
 * d'un autre, et il ne dit rien de plus que ce que l'écran du lien dit déjà à la même personne : le
 * jeton n'est jamais recopié, le plafond d'un renouvellement par jour et par personne s'applique,
 * et un lien révoqué ou inventé garde le message unique.
 */
export async function ouvrirParLienColle(_prev: FormState, fd: FormData): Promise<FormState> {
  const ip = await clientIp();
  if (!(await checkRateLimit("invitation_ip", ip))) return { erreur: MESSAGE_TROP_DE_TENTATIVES };

  const token = jetonDuLienColle(champ(fd, "lien"));
  const check = token ? await checkInvitation(token) : null;
  if (!check?.ok) {
    // Rien d'exploitable, ou jeton inexistant : dans les deux cas c'est un lien inconnu.
    // On compte et on journalise **sans jamais recopier la saisie**.
    if (!check || check.raison === "format" || check.raison === "inconnue") {
      const encoreAdmis = await checkRateLimit("invitation_inconnue_ip", ip);
      await audit(null, "invitation.lien_inconnu", null, { ip, bloque: !encoreAdmis, voie: "colle" });
      await surveillerLiensInconnus();
      if (!encoreAdmis) return { erreur: "Trop de liens invalides depuis ta connexion. Réessaie dans une heure, ou demande ton lien à l'administrateur." };
    }
    // Lien arrivé à terme : même geste que la page du lien — on en renvoie un neuf, et on dit
    // honnêtement si un email a pu partir (`IssueRenouvellement`).
    if (check?.raison === "expiree" && check.invitation) {
      const issue = await renouvelerLien(check.invitation);
      await audit({ id: check.invitation.userId, email: "" }, "invitation.renouvelee_a_l_ouverture", check.invitation.periodId, { issue, voie: "colle" });
      return issue === "impossible" ? { erreur: MESSAGE_LIEN_COLLE_EXPIRE_SANS_ENVOI } : { succes: MESSAGE_LIEN_COLLE_RENOUVELE };
    }
    return { erreur: MESSAGE_LIEN_COLLE_REFUSE };
  }

  // À partir d'ici, c'est un lien valide : on le traite comme s'il avait été ouvert (l'action
  // redirige, ou lève). `connexionParInvitation` repasse par toutes ses gardes, y compris son
  // propre limiteur par IP — deux jetons comptés pour une tentative, ce qui va dans le bon sens.
  await connexionParInvitation(token!, fd);
  return {};
}


/**
 * **Renvoyer un lien expiré — sur appui, jamais au rendu**.
 *
 * La page d'un lien expiré appelait `renouvelerLien` **dans le corps du composant**, donc pendant le
 * rendu d'un simple GET. Quatrième fois que cette famille de défaut se corrige dans ce dossier, et
 * CLAUDE.md l'écrit noir sur blanc : « Aucune mutation par GET. […] Au prochain lien d'email qui écrit,
 * découper d'emblée. »
 *
 * Ce que coûtait le rendu-qui-écrit, concrètement : les messageries préchargent les liens d'un email
 * (Safe Links, antivirus, aperçu de conversation). Le vieil email de janvier suffisait donc à déclencher
 * un renouvellement que personne n'avait demandé — un email de plus dans la boîte, une entrée au journal
 * sans acteur, et, avant le correctif du même soir dans `renouvelerLien`, la **révocation du lien
 * valide** reçu depuis.
 *
 * Le geste est maintenant celui de la page voisine : on montre ce qui va se passer, et on attend
 * l'appui. Aucun contrôle n'est relâché — `renouvelerLien` garde ses trois conditions (période non
 * close, adresse renseignée, un renouvellement par jour et par personne) et le limiteur par IP de
 * l'ouverture d'un lien s'applique ici aussi.
 */
export async function renvoyerLienExpire(token: string): Promise<FormState> {
  const ip = await clientIp();
  if (!(await checkRateLimit("invitation_ip", ip))) return { erreur: MESSAGE_TROP_DE_TENTATIVES };

  const check = await checkInvitation(token);
  /*
   * **Un jeton inconnu est compté, journalisé et surveillé ici aussi**.
   *
   * Cette action ne passait que par le seau large de l'ouverture d'un lien (30 / 15 min). Or la page du
   * lien fait trois choses de plus sur un jeton mal formé ou inconnu, et pour une raison écrite dans son
   * propre commentaire : le seau **serré** `invitation_inconnue_ip` (8 / heure), la ligne d'audit
   * `invitation.lien_inconnu`, et l'alerte de balayage. En ouvrant cette porte j'ai rouvert le « guichet
   * tranquille » que le dossier avait fermé sur les trois autres : un robot qui POSTe des jetons devinés
   * disposait de quatre fois le budget de la page, ne laissait **aucune trace**, et ne déclenchait
   * **aucune alerte**.
   *
   * Les trois gestes sont donc les mêmes, et dans le même ordre. On ne renvoie ensuite que sur un lien
   * **expiré** : un jeton inconnu ou révoqué ne dit pas à qui écrire, et un lien encore valable n'a pas
   * besoin d'être remplacé.
   */
  if (!check.ok && (check.raison === "format" || check.raison === "inconnue")) {
    const encoreAdmis = await checkRateLimit("invitation_inconnue_ip", ip);
    await audit(null, "invitation.lien_inconnu", null, { ip, bloque: !encoreAdmis, via: "renvoi" });
    await surveillerLiensInconnus();
    if (!encoreAdmis) return { erreur: MESSAGE_TROP_DE_TENTATIVES };
  }
  if (check.ok || check.raison !== "expiree" || !check.invitation) {
    return { erreur: "Ce lien ne peut pas être renouvelé. Demande à l'administrateur de t'en renvoyer un." };
  }
  const issue = await renouvelerLien(check.invitation);
  await audit({ id: check.invitation.userId, email: "" }, "invitation.renouvelee_a_l_ouverture", check.invitation.periodId, { issue });
  if (issue === "impossible") {
    return { erreur: "L'application n'a pas pu envoyer de lien neuf. Demande à l'administrateur de t'en renvoyer un." };
  }
  return {
    succes:
      issue === "deja-envoye"
        ? "Un lien neuf t'a déjà été envoyé aujourd'hui : regarde ta boîte mail (et tes spams)."
        : "C'est parti : un nouveau lien personnel vient d'être envoyé à ton adresse email. Pense à vérifier tes spams.",
  };
}
