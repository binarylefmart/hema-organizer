import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { DUREE_ELEVATION_MS, DUREE_INACTIVITE_ELEVATION_MS, ELEVATION_COOKIE, GRACE_SORTIE_ELEVATION_MS } from "@/lib/constants";
import { baseUrl, env } from "@/lib/env";
import { signPayload, verifySignedPayload } from "./tokens";

/**
 * **L'espace admin est une élévation, pas un état permanent.**
 *
 * Un administrateur entre dans l'application comme tout le monde — par son lien personnel, ou par
 * son mot de passe — et sa session est alors **ordinaire** : il voit les cours, répond, organise.
 * Pour ouvrir l'administration technique, il *s'élève* : il redonne son mot de passe et son code à
 * usage unique, et obtient ce cookie-ci. Il en ressort d'un bouton, ou tout seul.
 *
 * **Pourquoi un cookie à part, et pas la colonne `forte` de la session.** Ce cookie n'a **pas de
 * `maxAge`** : c'est un cookie de session au sens du navigateur. En séparant les deux, fermer
 * l'espace admin ne déconnecte pas de l'application : on redescend au rang de membre, on ne se
 * retrouve pas dehors.
 *
 * **Ce que le cookie seul ne garantit pas** : « je quitte l'application et l'espace admin est
 * toujours ouvert ». Un cookie de session devrait mourir avec le navigateur, mais Chrome avec «
 * Continuer là où vous vous êtes arrêté », Android et les applications installées (PWA)
 * **restaurent** ces cookies au redémarrage. La promesse reposait donc sur une politesse du
 * navigateur, et personne ne la lui impose. D'où deux verrous de plus, tous deux côté serveur :
 * **l'application quittée referme l'espace admin** (le navigateur le dit en partant, voir
 * `src/components/admin/FermerEnQuittant.tsx` et `/api/admin/quitter`) et, en filet, **10 minutes
 * sans rien faire dans l'espace admin** (`AuthSession.elevationVueLe`, repoussée à chaque geste par
 * `toucherElevation`) — car un navigateur tué net ne prévient personne.
 *
 * **Pourquoi « quitter » ne ferme pas sur-le-champ.** Le navigateur envoie le même signal quand la
 * page passe en arrière-plan et quand elle change simplement d'adresse : fermer immédiatement
 * redemandait mot de passe et code au premier clic sur un lien. La sortie est donc **notée**
 * (`elevationSortieLe`) et n'a d'effet que si l'application ne revient pas avant
 * `GRACE_SORTIE_ELEVATION_MS` : la requête suivante — page de l'application, retour au premier plan
 * — l'annule.
 *
 * **Qui sait combien de temps l'application a été absente : elle seule.** Le serveur ne la voit que
 * lorsqu'elle lui parle ; entre deux requêtes, une page lue trois minutes et un téléphone posé
 * trois minutes se ressemblent trait pour trait. Laisser la note vieillir toute seule revenait donc
 * à mesurer **l'âge du signal de sortie**, pas la durée de l'absence : basculer d'onglet cinq
 * secondes envoie exactement le même `visibilitychange` qu'un départ, et le clic d'après — trois
 * minutes plus tard, sur un formulaire qu'on remplissait — refermait l'espace admin de quelqu'un
 * qui n'avait jamais quitté son bureau. C'est l'application qui tranche, parce qu'elle compte le
 * temps passé cachée : elle **déclare son retour** ({@link signalerRetourElevation}) — sous la
 * grâce, la sortie n'a jamais eu lieu ; au-delà, elle referme pour de bon, comme le redémarrage. La
 * note qui vieillit reste le filet du cas où personne n'a pu parler.
 *
 * Quatre verrous, tous vérifiés côté serveur à chaque lecture :
 *  - **la signature** (HMAC du secret de session) : le cookie ne se fabrique pas à la main ;
 *  - **la session** (`sid`) : une élévation vaut pour *cette* session et pour elle seule. Volée et
 *    recollée ailleurs, elle ne désigne pas la bonne session et ne vaut rien ;
 *  - **l'échéance** (`exp`, 12 h) : un navigateur resté ouvert des jours ne garde pas les réglages
 *    ouverts pour autant ;
 *  - **l'inactivité** (10 min, en base) : rouvrir l'application le lendemain redemande mot de passe
 *    et code, même si le navigateur a rendu son cookie intact ;
 *  - **la sortie de l'application** (2 min de grâce, en base) : partie pour de bon, l'application
 *    ne rouvre plus l'administration.
 *
 * Ce que ce cookie ne fait **pas** : donner un droit. Le rôle décide (`peutOuvrirSessionForte` :
 * ADMIN et lui seul), et il est revérifié à chaque appel — l'élévation n'est que le second facteur,
 * jamais le premier.
 */
type JetonElevation = { sid: string; exp: number };

function options() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: baseUrl().startsWith("https://"),
    // `path: "/"` et non `/admin` : la présence de l'élévation se lit partout (l'en-tête et le
    // profil disent où l'on en est), pas seulement dans les pages qu'elle ouvre.
    path: "/",
    // Volontairement **pas** de `maxAge` : cookie de session navigateur, il meurt avec l'application.
  };
}

/** Ouvre l'espace admin pour la session en cours (mot de passe + code à usage unique vérifiés). */
export async function ouvrirElevation(sessionId: string): Promise<void> {
  const jeton = signPayload({ sid: sessionId, exp: Date.now() + DUREE_ELEVATION_MS }, env().SESSION_SECRET, "elevation");
  (await cookies()).set(ELEVATION_COOKIE, jeton, options());
  await toucherElevation(sessionId);
}

/** Voir {@link etatElevation} : « ouverte », « retombée » (elle l'a été), « aucune » (elle ne l'a jamais été). */
export type EtatElevation = "ouverte" | "aucune" | "retombee";

/**
 * L'espace admin est-il ouvert **pour cette session-ci** ? (Le « pourquoi non » se lit avec
 * {@link etatElevation}, dont cette fonction n'est que le oui/non.)
 *
 * `vueLe` est le dernier geste fait dans l'espace admin, lu sur la session (l'appelant l'a déjà en
 * main : pas de second aller-retour en base). `null` — une session qui n'a jamais rien fait là-bas,
 * ou qu'on vient d'abaisser — vaut refus.
 */
export async function elevationOuverte(sessionId: string, vueLe: Date | null, sortieLe: Date | null = null): Promise<boolean> {
  return (await etatElevation(sessionId, vueLe, sortieLe)) === "ouverte";
}

/**
 * **Pourquoi l'espace admin n'est pas ouvert** — la distinction qui décide où l'on renvoie les gens.
 *
 * - `"ouverte"` : tout est bon, on passe ;
 * - `"retombee"` : **elle l'a été, et elle est tombée** — dix minutes sans rien faire ici, une
 *   absence trop longue, ou le plafond de douze heures. La personne n'a rien demandé : on la
 *   referme pour de bon et on la dépose sur l'accueil, avec un mot d'explication ;
 * - `"aucune"` : cette session n'a jamais pris l'espace admin, ou l'a rendu. C'est quelqu'un qui
 *   **veut entrer** : on l'envoie sur `/connexion/admin`, qui est la porte.
 *
 * Sans cette distinction, les deux cas se ressemblaient (« pas élevé ») et menaient tous deux à une
 * demande de mot de passe — servie, dans le premier cas, à quelqu'un qui venait simplement de
 * reprendre son téléphone.
 *
 * L'ordre des tests n'est pas indifférent : **un cookie absent ou illisible n'est jamais une
 * chute**. C'est l'état d'une application qu'on vient d'ouvrir, ou d'un navigateur qui a fait le
 * ménage ; en faire une chute renverrait à l'accueil quelqu'un qui clique sur « Espace admin »
 * depuis son profil, et lui coûterait un clic pour rien. Un cookie **qui est là mais périmé**, lui,
 * raconte bien une élévation qui a vécu.
 */
export async function etatElevation(sessionId: string, vueLe: Date | null, sortieLe: Date | null = null): Promise<EtatElevation> {
  const brut = (await cookies()).get(ELEVATION_COOKIE)?.value;
  if (!brut) return "aucune";
  const jeton = verifySignedPayload<JetonElevation>(brut, env().SESSION_SECRET, "elevation");
  if (!jeton || typeof jeton.sid !== "string" || typeof jeton.exp !== "number") return "aucune";
  // Un jeton posé pour une autre session ne dit rien de celle-ci : ce n'est pas une chute.
  if (jeton.sid !== sessionId) return "aucune";
  if (jeton.exp <= Date.now()) return "retombee";
  if (sortieLe && Date.now() - sortieLe.getTime() > GRACE_SORTIE_ELEVATION_MS) return "retombee";
  // Jamais rien fait dans l'espace admin : il n'y avait rien à perdre.
  if (!vueLe) return "aucune";
  return Date.now() - vueLe.getTime() <= DUREE_INACTIVITE_ELEVATION_MS ? "ouverte" : "retombee";
}

/**
 * **Quand cette élévation a été ouverte**, déduite de l'échéance inscrite dans le jeton.
 *
 * Aucune colonne de plus en base : le jeton porte déjà `exp = ouverture + {@link DUREE_ELEVATION_MS}`,
 * et il est signé — cette date ne se retouche donc pas depuis le navigateur.
 *
 * À quoi elle sert : le navigateur, lui, doit pouvoir distinguer « je viens de redonner mot de passe
 * et code » de « l'application a redémarré avec un cookie restauré ». Les deux se ressemblent
 * exactement côté serveur ; seule l'ancienneté de l'ouverture les sépare (voir `FermerEnQuittant`).
 */
export async function ouvertureElevation(sessionId: string): Promise<Date | null> {
  const brut = (await cookies()).get(ELEVATION_COOKIE)?.value;
  if (!brut) return null;
  const jeton = verifySignedPayload<JetonElevation>(brut, env().SESSION_SECRET, "elevation");
  if (!jeton || jeton.sid !== sessionId || typeof jeton.exp !== "number") return null;
  return new Date(jeton.exp - DUREE_ELEVATION_MS);
}

/**
 * L'application prévient qu'elle part (arrière-plan, onglet fermé). On note l'heure, on ne ferme
 * rien : c'est `GRACE_SORTIE_ELEVATION_MS` sans nouvelle d'elle qui fera tomber l'élévation.
 */
export async function signalerSortieElevation(sessionId: string): Promise<void> {
  await db.authSession.update({ where: { id: sessionId }, data: { elevationSortieLe: new Date() } }).catch(() => {});
}

/** L'application est de retour avant la fin de la grâce : la sortie n'a jamais eu lieu. */
export async function annulerSortieElevation(sessionId: string): Promise<void> {
  await db.authSession.update({ where: { id: sessionId }, data: { elevationSortieLe: null } }).catch(() => {});
}

/**
 * **L'absence annoncée dépasse-t-elle la grâce ?** (fonction pure)
 *
 * Le même calcul des deux côtés : l'application compte le temps passé cachée
 * (`FermerEnQuittant`), le serveur en tire la conséquence. En faire une fonction à part, c'est
 * s'assurer que le seuil ne se dédouble pas.
 */
export function absenceDepasseLaGrace(absenceMs: number): boolean {
  return absenceMs > GRACE_SORTIE_ELEVATION_MS;
}

/**
 * **L'application est revenue, et dit depuis combien de temps elle était partie.**
 *
 * C'est la moitié manquante de {@link signalerSortieElevation} : sans elle, une sortie notée
 * vieillissait jusqu'au prochain geste et refermait l'espace admin d'une application qui n'était
 * jamais partie (voir l'en-tête du fichier). La durée, ici, est **mesurée** et non déduite.
 *
 * - sous la grâce : la sortie n'a pas eu lieu, on l'efface — l'élévation garde ses deux échéances
 *   ordinaires (10 min d'inactivité, plafond de 12 h), qui ne bougent pas d'un pouce ;
 * - au-delà : c'était un vrai départ, on referme pour de bon — le même geste que « Quitter l'espace
 *   admin ».
 *
 * **Se déclarer revenu ne donne aucun droit** : au mieux l'élévation reste ce qu'elle était, au pire
 * elle tombe. Une durée mensongère ne peut donc que se retourner contre qui l'envoie, et les
 * échéances vérifiées en base restent au-dessus d'elle.
 */
export async function signalerRetourElevation(sessionId: string, absenceMs: number): Promise<void> {
  if (absenceDepasseLaGrace(absenceMs)) return refermerElevationSortie(sessionId);
  return annulerSortieElevation(sessionId);
}

/**
 * La grâce a expiré : on referme pour de bon, côté serveur. `forte` repasse à faux pour que la
 * liste des sessions dise la vérité, et les deux dates sont remises à plat — la session ordinaire,
 * elle, n'est pas touchée.
 */
export async function refermerElevationSortie(sessionId: string): Promise<void> {
  await db.authSession
    .update({ where: { id: sessionId }, data: { forte: false, reauthAt: null, elevationVueLe: null, elevationSortieLe: null } })
    .catch(() => {});
}

/**
 * Repousse l'échéance d'inactivité : appelée à chaque page et à chaque action qui exigent
 * l'élévation (voir `requirePermission` / `assertPermission`). Silencieuse en cas d'échec — une
 * écriture ratée ne doit pas faire tomber un écran d'administration.
 */
export async function toucherElevation(sessionId: string): Promise<void> {
  await db.authSession.update({ where: { id: sessionId }, data: { elevationVueLe: new Date(), elevationSortieLe: null } }).catch(() => {});
}

/**
 * Referme l'espace admin **sans déconnecter** : la session reste ouverte, avec ses droits de
 * membre et d'encadrant. C'est le bouton « Quitter l'espace admin », et le geste que fait aussi
 * `destroySession` par acquit de conscience quand tout se ferme.
 */
export async function fermerElevation(): Promise<void> {
  (await cookies()).set(ELEVATION_COOKIE, "", { ...options(), maxAge: 0 });
}
