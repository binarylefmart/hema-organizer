"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { deuxFaActive, peutSecuriserSonCompte } from "@/lib/auth/acces-admin";
import { clientIp } from "@/lib/request-info";
import { envoyerInvitation, etatLienPersonnel } from "@/lib/invitations";
import { desactiverTotp, ouvrirAffichageCodes } from "@/lib/auth/deux-fa";
import { enregistrerCodesSecours, genererCodesSecours } from "@/lib/auth/codes-secours";
import { redirect } from "next/navigation";
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
 * **Réinitialiser sa double authentification** (nouveau téléphone) : mot de passe exigé.
 *
 * Pour un administrateur, la 2FA est obligatoire : elle lui sera reproposée à sa prochaine connexion
 * (et sans elle, plus de session forte — donc plus d'administration technique). Pour un membre ou un
 * instructeur, elle était facultative : la retirer le ramène simplement au mot de passe seul, et il
 * la réactive quand il veut depuis « Sécuriser mon compte ».
 */
export async function reinitialiserMaDeuxFa(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  // **Même exigence que pour les codes de secours juste en dessous** : retirer la 2FA d'un compte
  // d'administration est un geste d'administration. Sans cette ligne, un lien personnel dérobé
  // suffisait à faire sauter le second facteur d'un administrateur — mot de passe d'abord réécrit,
  // puis 2FA retirée, puis parcours de réglage rejoué avec son propre téléphone. Le titulaire, lui,
  // a toujours ses codes de secours pour s'élever si son téléphone est perdu.
  if (can(user, "settings.technical") && !user.sessionForte) {
    return { erreur: "Connecte-toi en tant qu'administrateur (mot de passe et code) avant de retirer ta double authentification." };
  }
  // Ce formulaire vérifie un mot de passe : sans plafond, il devient un banc d'essai pour le deviner.
  if (!(await checkRateLimit("totp_user", user.id))) return { erreur: "Trop d'essais. Réessaie dans un quart d'heure." };
  const compte = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!deuxFaActive(compte)) return { erreur: "La double authentification n'est pas active sur ton compte." };
  if (!(await verifyPassword(compte.passwordHash, champ(fd, "motDePasse")))) {
    return { erreur: "Mot de passe incorrect.", erreurs: { motDePasse: "Mot de passe incorrect." } };
  }
  await desactiverTotp(user.id);
  // Retrait volontaire : on ne vient pas lui reproposer la 2FA à sa prochaine connexion. Le compteur
  // repart, elle sera reproposée dans un trimestre (et reste disponible ici à tout moment).
  if (!can(user, "settings.technical")) await db.user.update({ where: { id: user.id }, data: { deuxFaProposeeLe: new Date() } });
  await audit({ id: user.id, email: user.email }, "deux_fa.reinitialisee", user.id);
  // Même raison qu'au mot de passe ci-dessus : sans ça, les deux endroits qui disent l'état de la
  // double authentification continuent d'annoncer « active » après l'avoir retirée.
  revalidatePath("/profil");
  return {
    succes: can(user, "settings.technical")
      ? "Double authentification réinitialisée : à ta prochaine connexion, un nouveau QR code te sera proposé."
      : "Double authentification retirée : ton mot de passe suffit désormais. Tu peux la réactiver ci-dessus quand tu veux.",
  };
}

/** Régénérer ses codes de secours (mot de passe exigé) : les anciens deviennent invalides, les nouveaux sont affichés une fois. */
export async function regenererCodesSecours(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  // Un administrateur reste tenu à sa session forte pour ce geste : c'est l'un de ses accès techniques.
  // Un membre ou un instructeur, lui, n'a pas de session forte à produire — son mot de passe suffit (ci-dessous).
  if (can(user, "settings.technical") && !user.sessionForte) return { erreur: "Reconnecte-toi avec ton mot de passe et ton code avant de régénérer tes codes de secours." };
  // Ce formulaire vérifie un mot de passe : sans plafond, il devient un banc d'essai pour le deviner,
  // depuis une session déjà ouverte. Sa voisine `reinitialiserMaDeuxFa` bornait la même vérification,
  // celle-ci ne la bornait pas — même compteur, même quart d'heure.
  if (!(await checkRateLimit("totp_user", user.id))) return { erreur: "Trop d'essais. Réessaie dans un quart d'heure." };
  const compte = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!deuxFaActive(compte)) return { erreur: "Active d'abord la double authentification." };
  if (!(await verifyPassword(compte.passwordHash, champ(fd, "motDePasse")))) {
    return { erreur: "Mot de passe incorrect.", erreurs: { motDePasse: "Mot de passe incorrect." } };
  }
  const codes = genererCodesSecours();
  await enregistrerCodesSecours(user.id, codes);
  await ouvrirAffichageCodes(user.id, codes, "/profil#securite");
  await audit({ id: user.id, email: user.email }, "deux_fa.codes_regeneres", user.id);
  redirect("/connexion/codes-secours");
}
