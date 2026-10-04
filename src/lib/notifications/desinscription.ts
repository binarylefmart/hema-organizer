import { db } from "@/lib/db";
import { signPayload, verifySignedPayload } from "@/lib/auth/tokens";
import { baseUrl, env } from "@/lib/env";
import { RESPECTE_RAPPEL_EMAIL, miseAJourPersonnelle, type TypeNotification } from "./preferences";

/**
 * Lien de désinscription en pied des emails de rappel (récap de la veille, rappels sans réponse).
 *
 * Le jeton est **signé** (HMAC-SHA256, même mécanique que le lien d'annulation) et contient le seul
 * identifiant du membre : il coupe ses **rappels** (récap de la veille et rappel sans réponse) **sans
 * connexion**, en un clic, et ne donne aucun autre droit. Il reste valable un an (un vieil email doit
 * encore pouvoir désinscrire).
 *
 * **Il coupe les deux canaux, email et téléphone** — et c'est délibéré. Ce module a longtemps
 * prétendu ne toucher qu'à l'email alors que `reglerRappels` écrit un booléen par type, donc les
 * deux canaux personnels d'un coup (voir `miseAJourPersonnelle`). De deux corrections possibles —
 * restreindre le lien à l'email, ou l'annoncer franchement —, c'est la seconde qui est retenue :
 * quelqu'un qui clique « ne plus recevoir ces rappels » depuis son téléphone veut la paix, pas un
 * canal sur deux. Mais alors il faut le **dire** partout où le lien se présente, d'où {@link
 * LIBELLE_LIEN_DESINSCRIPTION} et {@link PHRASE_DESINSCRIPTION}, repris tels quels par le pied des
 * emails et par la page de confirmation.
 *
 * Le reste des choix n'est pas touché : se désinscrire des rappels ne coupe ni les annulations, ni
 * les nouveaux événements — sur aucun canal.
 *
 * Depuis les préférences par personne, le clic écrit les deux choses à la fois : la case historique
 * `User.rappelEmail` **et** les deux types de rappel dans `User.preferencesNotifications`. Sans cela,
 * quelqu'un qui aurait explicitement coché « récap de la veille » dans son profil continuerait de le
 * recevoir après s'être désinscrit depuis un email.
 *
 * La page publique qui consomme le jeton est `src/app/(public)/desinscription/[token]/` : tout le
 * travail serveur est fait ici, elle ne fait qu'afficher et appeler. **L'ouverture du lien n'écrit
 * rien** — elle montre un écran de confirmation (`apercuDesinscription`, lecture seule) et c'est le
 * bouton qui envoie le POST : les messageries préchargent les liens des emails (Outlook Safe Links,
 * antivirus, générateurs d'aperçu), et un GET qui coupait les rappels désinscrivait des gens qui
 * n'avaient rien cliqué. Même découpage que `src/app/(public)/invitation/[token]/`, qui l'explique
 * en détail.
 */
export const CHEMIN_DESINSCRIPTION = "/desinscription";

/**
 * Le libellé du lien, en pied d'email. Il nomme les **deux** canaux : un lien qui disait « par
 * email » et coupait aussi le téléphone était un piège, et c'est le genre de piège dont on ne
 * s'aperçoit qu'en ratant un cours.
 */
export const LIBELLE_LIEN_DESINSCRIPTION = "Ne plus recevoir ces rappels, ni par email ni sur le téléphone";

/** La même vérité, en une phrase, pour la page de confirmation et l'écran « c'est fait ». */
export const PHRASE_DESINSCRIPTION =
  "Cela coupe les deux à la fois : ni email de rappel, ni notification sur le téléphone. Ni le récap de la veille, ni les relances quand tu n'as pas encore répondu.";
/** Un lien de désinscription reste valable un an. */
export const DUREE_LIEN_DESINSCRIPTION_MS = 365 * 24 * 60 * 60 * 1000;

export function jetonDesinscription(userId: string, now = new Date()): string {
  return signPayload({ uid: userId, exp: now.getTime() + DUREE_LIEN_DESINSCRIPTION_MS }, env().SESSION_SECRET, "desinscription");
}

export function urlDesinscription(userId: string, now = new Date()): string {
  return `${baseUrl()}${CHEMIN_DESINSCRIPTION}/${jetonDesinscription(userId, now)}`;
}

/** Vérifie un lien de désinscription : retourne l'identifiant du membre, ou null. */
export function lireJetonDesinscription(jeton: string, now = new Date()): string | null {
  const p = verifySignedPayload<{ uid: string; exp: number }>(jeton, env().SESSION_SECRET, "desinscription");
  if (!p || typeof p.uid !== "string" || typeof p.exp !== "number" || p.exp < now.getTime()) return null;
  return p.uid;
}

/** Les deux types coupés (ou rendus) par ce lien, **sur leurs deux canaux** : les rappels, rien d'autre. */
const TYPES_DU_LIEN: readonly TypeNotification[] = RESPECTE_RAPPEL_EMAIL;

function choixRappels(actif: boolean): Partial<Record<TypeNotification, boolean>> {
  return Object.fromEntries(TYPES_DU_LIEN.map((type) => [type, actif]));
}

/**
 * Ce que la page (et le journal d'audit) apprennent du jeton : la personne existe, son prénom pour
 * lui parler, son adresse pour signer la ligne d'audit — le lien, lui, ne connaît qu'un identifiant.
 */
export type EtatDesinscription = { ok: boolean; prenom?: string; email?: string | null; userId?: string };

/**
 * Met les rappels d'une personne dans l'état demandé, **sur les deux canaux personnels** : la case
 * historique `rappelEmail` et, dans ses choix personnels, `recap_veille` et `rappel_sans_reponse`
 * pour l'email *et* pour le téléphone (un booléen passé à `miseAJourPersonnelle` règle les deux).
 */
async function reglerRappels(userId: string, actif: boolean): Promise<EtatDesinscription> {
  const membre = await db.user.findUnique({ where: { id: userId }, select: { id: true, prenom: true, email: true, rappelEmail: true, preferencesNotifications: true } });
  if (!membre) return { ok: false };
  // Personne qui n'a rien réglé finement : la case historique suffit (elle *est* la valeur par défaut
  // des deux rappels), on n'écrit pas de JSON pour rien. Sinon, les deux sont mis d'accord.
  const data = membre.preferencesNotifications ? miseAJourPersonnelle(membre, choixRappels(actif)) : { rappelEmail: actif };
  await db.user.update({ where: { id: membre.id }, data });
  return { ok: true, prenom: membre.prenom, email: membre.email, userId: membre.id };
}

/**
 * Lecture seule : qui est derrière ce jeton, pour l'écran de confirmation. N'écrit **rien** — c'est
 * tout l'intérêt : cette page est un GET, et un GET ne doit pas désinscrire (voir l'en-tête).
 */
export async function apercuDesinscription(jeton: string, now = new Date()): Promise<EtatDesinscription> {
  const userId = lireJetonDesinscription(jeton, now);
  if (!userId) return { ok: false };
  const membre = await db.user.findUnique({ where: { id: userId }, select: { id: true, prenom: true, email: true } });
  if (!membre) return { ok: false };
  return { ok: true, prenom: membre.prenom, email: membre.email, userId: membre.id };
}

/**
 * Coupe les rappels du membre désigné par le jeton, **par email et sur le téléphone** (voir
 * l'en-tête du module). Idempotent : un lien cliqué deux fois répond la même chose. Aucun message
 * d'erreur ne distingue un jeton invalide d'un compte inconnu.
 */
export async function appliquerDesinscription(jeton: string, now = new Date()): Promise<EtatDesinscription> {
  const userId = lireJetonDesinscription(jeton, now);
  if (!userId) return { ok: false };
  return reglerRappels(userId, false);
}

/**
 * L'inverse, pour le bouton « je me suis trompé » de la page de désinscription : les rappels
 * repartent sur les deux canaux, case historique **et** choix personnels, sans toucher au reste des
 * préférences.
 */
export async function annulerDesinscription(jeton: string, now = new Date()): Promise<EtatDesinscription> {
  const userId = lireJetonDesinscription(jeton, now);
  if (!userId) return { ok: false };
  return reglerRappels(userId, true);
}
