"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { deuxFaActive, peutSecuriserSonCompte } from "@/lib/auth/acces-admin";
import { clientIp } from "@/lib/request-info";
import { envoyerInvitation, etatLienPersonnel } from "@/lib/invitations";
import { ACTION_DEMANDE, cleDemande, comptesDuBureau, demandeRecente, destinatairesDemande, envoyerDemande, motDePasseReinitialiseRecemment, prevenirTitulaireDeuxFa } from "@/lib/auth/demande-deux-fa";
import { formatDateHeure } from "@/lib/dates";
import { revalidatePath } from "next/cache";
import { champ, zodToFormState, type FormState } from "@/lib/form";
import { motDePasseSchema } from "@/lib/validation/auth";
import {
  DESCRIPTIONS,
  estCanalPersonnel,
  estTypeNotification,
  miseAJourPersonnelle,
  type CanalPersonnel,
  type TypeNotification,
} from "@/lib/notifications/preferences";
import { estChoixThemeConnu } from "@/lib/themes";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { enqueueEmail } from "@/lib/email/mailer";
import { emailEssai } from "@/lib/email/templates/essai";
import { identite } from "@/lib/identite";

const schema = z
  .object({
    actuel: z.string(),
    motDePasse: motDePasseSchema,
    confirmation: z.string(),
  })
  .refine((d) => d.motDePasse === d.confirmation, {
    path: ["confirmation"],
    message: "Les deux mots de passe ne sont pas identiques.",
  });

/**
 * **Définir ou changer son mot de passe**, depuis « Mon profil » — ouvert à tout le monde (membres
 * et instructeurs compris). Le mot de passe est **facultatif** : il sert à entrer depuis un
 * appareil où l'on n'a pas son lien personnel, et n'ouvre aucun droit supplémentaire.
 *
 * Deux garde-fous seulement : une adresse email (c'est *par* elle qu'on se connecte ensuite), et le
 * mot de passe actuel quand il y en a déjà un. Les autres appareils sont déconnectés.
 */
export async function changerMotDePasse(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  if (!peutSecuriserSonCompte(user)) {
    return { erreur: "Ton compte n'a pas d'adresse email : sans elle, la page de connexion ne saurait pas te retrouver. Demande à un administrateur de l'ajouter." };
  }
  const parsed = schema.safeParse({
    actuel: champ(fd, "actuel"),
    motDePasse: champ(fd, "motDePasse"),
    confirmation: champ(fd, "confirmation"),
  });
  if (!parsed.success) return zodToFormState(parsed.error);

  const compte = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (compte.passwordHash) {
    if (!parsed.data.actuel) return { erreur: "Indique ton mot de passe actuel.", erreurs: { actuel: "Indique ton mot de passe actuel." } };
    if (!(await verifyPassword(compte.passwordHash, parsed.data.actuel))) {
      return { erreur: "Le mot de passe actuel est incorrect.", erreurs: { actuel: "Mot de passe incorrect." } };
    }
  }
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.motDePasse) } });
  const n = await revokeAllSessions(user.id, true);
  await audit({ id: user.id, email: user.email }, "mot_de_passe.change", null, { autresSessionsFermees: n });
  /*
   * **L'action invalide le chemin de sa propre page** — règle du dépôt, et son absence ici a été
   * mesurée : après avoir défini son mot de passe, l'écran affichait l'alerte verte « Mot de passe
   * défini » **et**, deux fois, « Mot de passe — non défini » (le résumé de la colonne et le
   * tableau de « Sécuriser mon compte »). Pire que contradictoire : le bloc de la double
   * authentification restait sur « elle s'ajoute à un mot de passe », donc **la 2FA était
   * injoignable** sans un rechargement que rien ne suggérait. C'était la seule action de ce fichier
   * à ne pas le faire, et la carte « État de mon compte » du jour en a fait un mensonge affiché
   * deux fois.
   */
  revalidatePath("/profil");
  return {
    succes: compte.passwordHash
      ? "Mot de passe changé. Les autres appareils ont été déconnectés."
      : "Mot de passe défini : avec ton adresse email, il te connecte depuis la page de connexion, même sans ton lien personnel.",
  };
}

/**
 * **Mes notifications** (écran « Mon profil »).
 *
 * Chacun choisit, type par type, ce qu'il accepte encore de recevoir — « certains ne supportent pas
 * d'être spammés ». Deux règles, tenues par `src/lib/notifications/preferences.ts` :
 *
 * - on ne peut que **refuser** ce que le club envoie, jamais s'ajouter ce que le club a coupé ;
 * - les messages d'accès et de sécurité (lien personnel, nouvel appareil, mot de passe oublié)
 *   n'apparaissent pas ici : ils partent toujours.
 *
 * L'écriture passe toujours par `miseAJourPersonnelle`, qui tient aussi à jour la case historique
 * `User.rappelEmail` — c'est elle qui sert de valeur par défaut aux rappels, et ce que lit encore le
 * reste de l'application. La **lecture**, elle, n'a pas besoin d'action serveur : l'écran relit les
 * deux colonnes et les passe à `preferencesPersonnellesDe` (voir `src/app/(app)/profil/`).
 */
/** Accepter ou refuser **un** type de notification. Le type inconnu est refusé côté serveur. */
export async function definirPreferenceNotification(type: string, canal: string, actif: boolean): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  if (!estTypeNotification(type)) return { erreur: "Ce réglage n'existe pas." };
  // Le canal vient du formulaire : on ne règle que ceux qui s'adressent à une personne (email,
  // téléphone). Un canal de salon n'a pas de réglage personnel — il se coupe côté club.
  if (!estCanalPersonnel(canal)) return { erreur: "Ce moyen d'envoi n'existe pas." };
  const ou = canal === "push" ? "sur ton téléphone" : "par email";
  return enregistrerChoix(
    user.id,
    { [type]: { [canal]: !!actif } },
    `${DESCRIPTIONS[type].titre} : ${actif ? `tu recevras ces messages ${ou}.` : `tu ne recevras plus ces messages ${ou}.`}`,
  );
}

/**
 * **Un email d'essai à soi-même**, demandé depuis « Mon profil ».
 *
 * Il part **quoi qu'aient réglé le club et la personne** : ce n'est pas une notification du club,
 * c'est une vérification technique demandée à l'instant par son destinataire — la couper reviendrait
 * à empêcher quelqu'un de vérifier pourquoi il ne reçoit rien. Même raison que pour les messages
 * d'accès et de sécurité, qui ne passent pas non plus par la matrice.
 *
 * Il ne part qu'à **sa propre adresse**, jamais à une adresse reçue du client, et le limiteur de
 * débit l'empêche de servir de robinet à courriels.
 */
export async function testerNotificationEmail(): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  const compte = await db.user.findUnique({ where: { id: user.id }, select: { prenom: true, email: true } });
  if (!compte?.email) return { erreur: "Ton compte n'a pas d'adresse email : demande à un administrateur de l'ajouter." };
  if (!(await checkRateLimit("activation_user", user.id))) return { erreur: "Trop d'essais. Réessaie dans un quart d'heure." };
  const { sujet, contenu } = emailEssai({ prenom: compte.prenom, nomApp: (await identite()).nomCourt });
  enqueueEmail({ to: compte.email, sujet, contenu, ref: `essai_${user.id}_${Date.now()}` });
  return { succes: `C'est envoyé à ${compte.email}. L'email arrive en général en moins d'une minute — pense au dossier « indésirables ».` };
}

/**
 * **« Renvoyer mon lien »** (carte « Mon lien d'accès », écran « Mon profil »).
 *
 * Le lien ne peut pas être *renvoyé* : la base n'en garde que l'empreinte SHA-256, l'application est
 * incapable de le reconstituer. Ce bouton **en fabrique donc un nouveau** et l'envoie par email —
 * l'ancien cesse aussitôt de fonctionner (`createInvitation` révoque les précédents, motif REMPLACE).
 * L'écran le dit avant d'agir : quelqu'un qui a son lien ouvert sur un autre appareil doit savoir
 * qu'il le perd.
 *
 * Un seul chemin de génération dans toute l'application : `envoyerInvitation` (motif `renouvellement`,
 * le même que le renouvellement automatique d'un lien expiré). Rien n'est réécrit ici.
 *
 * Garde-fous : une adresse email, une période ouverte, le limiteur de débit des renouvellements
 * (`renouvellement_user` : une fois par jour et par personne — ce bouton envoie un email, il ne doit
 * pas devenir un robinet) doublé du plafond par IP, et une trace au journal d'audit.
 */
export async function renvoyerMonLien(): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };

  const etat = await etatLienPersonnel(user.id);
  if (etat.etat === "compte-de-service") {
    return { erreur: "Le compte de connexion du portail n'a pas de lien personnel : il se connecte par mot de passe et code." };
  }
  if (etat.etat === "sans-email") {
    return { erreur: "Ton compte n'a pas d'adresse email : demande à un administrateur de t'envoyer ton lien." };
  }
  if (etat.etat === "aucune-periode") {
    return { erreur: "Tu n'es inscrit(e) à aucune période en cours : demande à un administrateur de t'inviter." };
  }

  if (!(await checkRateLimit("invitation_ip", await clientIp())) || !(await checkRateLimit("renouvellement_user", user.id))) {
    return { erreur: "Un lien t'a déjà été envoyé récemment. Regarde ta boîte mail (et tes spams), ou demande à un administrateur." };
  }

  // La personne demande elle-même un nouveau lien : l'ancien meurt, et les sessions qu'il a
  // ouvertes **sur ses autres appareils** avec lui. Pas celle d'ici : elle est devant son écran,
  // elle vient de cliquer — la mettre dehors au passage ressemblerait à une panne.
  if (!(await envoyerInvitation(user.id, etat.periodId, "renouvellement", { deconnecterAppareils: "autres" }))) {
    return { erreur: "L'envoi n'a pas pu se faire. Demande à un administrateur de te renvoyer ton lien." };
  }
  await audit({ id: user.id, email: user.email }, "invitation.renvoyee_a_sa_demande", etat.periodId);
  revalidatePath("/profil");
  return { succes: `Un nouveau lien vient de partir à ${user.email}. L'ancien ne fonctionne plus — pense à ouvrir le nouveau sur chaque appareil.` };
}

async function enregistrerChoix(
  userId: string,
  choix: Partial<Record<TypeNotification, boolean | Partial<Record<CanalPersonnel, boolean>>>>,
  succes: string,
): Promise<FormState> {
  const compte = await db.user.findUnique({ where: { id: userId }, select: { rappelEmail: true, preferencesNotifications: true } });
  if (!compte) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  await db.user.update({ where: { id: userId }, data: miseAJourPersonnelle(compte, choix) });
  return { succes };
}

/**
 * **Mon thème** (écran « Mon profil ») : la palette de couleurs de l'application.
 *
 * Réglage personnel, comme le rappel email : pas d'audit. Le mode clair/sombre reste celui du
 * système, le thème ne choisit que la palette (voir `src/lib/themes.ts`).
 *
 * `revalidatePath("/", "layout")` est indispensable : le thème est posé sur la balise `<html>` de
 * la mise en page racine (`src/app/layout.tsx`). C'est donc elle qu'il faut refaire, sinon le
 * changement n'apparaîtrait qu'au prochain rechargement complet de la page.
 */
export async function choisirTheme(theme: string): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  // Jamais de valeur non validée en base : la colonne alimente directement l'attribut data-theme.
  if (!estChoixThemeConnu(theme)) return { erreur: "Ce thème n'existe pas." };
  await db.user.update({ where: { id: user.id }, data: { theme } });
  revalidatePath("/", "layout");
  return { succes: "Thème appliqué." };
}

/**
 * **« Demander la réinitialisation de ma double authentification »** (carte « Sécuriser mon
 * compte » de « Mon profil »).
 *
 * La double authentification se gère dans l'espace admin (Comptes admin → « Ma double
 * authentification ») ; qui a perdu son téléphone n'y entre plus. Ce bouton prévient donc le bureau,
 * qui la réinitialise depuis « Comptes admin » — **la personne qui demande n'est jamais prévenue**,
 * et le compte du portail ne l'est qu'à défaut d'un autre membre du bureau (`destinatairesDemande`).
 *
 * Gardes : une session (l'identité vient d'elle, et de nulle part ailleurs), un compte qui a bien une
 * double authentification active, **une demande toutes les six heures** — lue au journal d'audit
 * pour pouvoir le dire, tenue par le limiteur et la clé de déduplication quand deux appuis arrivent
 * ensemble. Aucun mot de passe : ce geste n'écrit rien sur le compte, il prévient des personnes qui
 * vérifieront de vive voix avant d'agir (l'email le leur demande).
 */
export async function demanderReinitialisationDeuxFa(): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  const compte = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, service: true, actif: true, totpSecret: true, totpActiveAt: true },
  });
  if (!compte || !compte.actif) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  if (!deuxFaActive(compte)) return { erreur: "Ton compte n'a pas de double authentification active : il n'y a rien à réinitialiser." };

  const recente = await demandeRecente(user.id);
  if (recente) {
    return { erreur: `Ta demande est déjà partie au bureau le ${formatDateHeure(recente)}. Elle ne se renvoie qu'après six heures : en attendant, contacte un membre du bureau directement.` };
  }
  const { destinataires, repliPortail } = destinatairesDemande(user.id, await comptesDuBureau());
  if (destinataires.length === 0) {
    return {
      erreur: compte.service
        ? `Il n'y a personne d'autre au bureau à prévenir. Sur le serveur, la commande de secours réinitialise ta double authentification : npm run admin:reset-2fa -- ${compte.email ?? "<adresse>"} --confirmer`
        : "Il n'y a personne au bureau à prévenir. Contacte le responsable de l'application.",
    };
  }
  if (!(await checkRateLimit("demande_2fa_user", user.id))) return { erreur: "Ta demande est déjà partie au bureau. Elle ne se renvoie qu'après six heures." };

  // La clé porte la personne et la fenêtre de six heures : deux appuis simultanés n'envoient qu'une fois.
  const dedupKey = cleDemande(user.id, new Date());
  const reset = await motDePasseReinitialiseRecemment(user.id);
  const partie = await envoyerDemande({ demandeur: compte, destinataires, dedupKey, motDePasseReinitialiseLe: reset ? formatDateHeure(reset) : null });
  if (!partie) return { erreur: "Ta demande est déjà partie au bureau. Elle ne se renvoie qu'après six heures." };
  await audit({ id: user.id, email: user.email }, ACTION_DEMANDE, user.id, {
    destinataires: destinataires.length,
    ...(repliPortail ? { repli: "compte du portail" } : {}),
    ...(compte.service ? { comptePortail: true } : {}),
  });
  // Le titulaire est prévenu lui aussi, à sa propre adresse et sur ses appareils : si la demande part
  // d'une session volée, c'est la seule personne qui peut s'en apercevoir.
  await prevenirTitulaireDeuxFa({ titulaire: compte, evenement: "demande", dedupKey: `${dedupKey}_titulaire` });
  revalidatePath("/profil");
  revalidatePath("/admin/comptes");
  const aQui = repliPortail ? "au bureau (la boîte du compte du portail, faute d'autre membre du bureau)" : "au bureau";
  return {
    succes: !compte.estAdmin
      ? `Ta demande est partie ${aQui}. Une personne du bureau va retirer ta double authentification ; ta connexion ne change pas.`
      : compte.service
        ? `Ta demande est partie ${aQui}. Ce compte ne se réinitialise que par la commande de secours sur le serveur : la personne qui gère le serveur va vérifier avec toi, puis la lancer.`
        : `Ta demande est partie ${aQui}. Une personne du bureau va vérifier avec toi, puis la réinitialiser : un nouveau QR code te sera alors demandé à ta prochaine connexion.`,
  };
}
