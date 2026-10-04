import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ACCUEIL_ELEVATION_REFERMEE, SESSION_COOKIE, SUITE_COOKIE } from "@/lib/constants";
import { can, exigeSessionForte, type Permission } from "@/lib/permissions";
import { DUREE_REAUTH_MS } from "@/lib/constants";
import { cheminSuiteSur } from "@/lib/validation/auth";
import { hashToken, isValidTokenFormat } from "./tokens";
import { CHEMIN_ACTIVATION_ADMIN, peutOuvrirSessionForte } from "./acces-admin";
import { echeanceProlongee } from "./session";
import { annulerSortieElevation, etatElevation, ouvertureElevation, refermerElevationSortie, toucherElevation } from "./elevation";

export type CurrentUser = {
  id: string;
  prenom: string;
  nom: string;
  /** Adresse facultative : `null` pour quelqu'un dont le club n'a pas l'adresse (aucun message, aucun lien). */
  email: string | null;
  /** Rôle **de base** : `MEMBRE` ou `INSTRUCTEUR`. Le bureau s'ajoute par-dessus — voir `estAdmin`. */
  role: string;
  /**
   * **Du bureau, en supplément du rôle de base**. Tout ce qui demandait `role === "ADMIN"` lit ce
   * champ : la valeur `"ADMIN"` ne s'écrit plus dans `role`, donc une garde restée sur le rôle se
   * tairait — elle laisserait passer, ou fermerait, sans rien dire.
   */
  estAdmin: boolean;
  /**
   * **Le compte global créé au déploiement** (`ADMIN_EMAIL`), et lui seul. Ce n'est la personne de
   * personne : il est exclu des listes nominatives, des effectifs et des envois, et aucun geste de
   * l'interface ne le modifie ni ne le supprime.
   *
   * Il est dans la session parce qu'il a **tous les rôles**, pas seulement tous les droits : la
   * bascule de l'accueil, qui lit le rôle de base pour savoir si l'on encadre, ne pouvait pas le
   * reconnaître sans ce drapeau — et lui montrait donc deux positions sur trois.
   */
  service: boolean;
  actif: boolean;
  rappelEmail: boolean;
  /** Palette choisie par la personne (voir src/lib/themes.ts). Le mode clair/sombre, lui, reste celui de l'appareil. */
  theme: string;
  /**
   * **Date de création du compte**, d'où se déduit l'ancienneté au club (`moisDepuis`, puis
   * l'échelle des rangs de `src/lib/blasons.ts` et `moi.ancienneteMois` de l'accueil).
   *
   * Elle est ici **et ne coûte rien** : la session charge déjà la ligne entière du compte
   * (`include: { user: true }`), la colonne est donc en mémoire à chaque requête. C'était la
   * condition pour adosser les rangs à l'ancienneté — l'accueil est l'écran le plus ouvert de
   * l'application, et une lecture de plus s'y paie à chaque visite de chaque membre.
   */
  createdAt: Date;
  /**
   * **Date d'adhésion au club**, réglée par le bureau dans la fiche du membre (« Au club depuis »),
   * `null` tant que personne ne l'a saisie. C'est elle qui prime pour l'ancienneté — voir la règle
   * de repli unique, `dateDAdhesion` (src/lib/blasons.ts) : le club existait bien avant
   * l'application, et `createdAt` ne date que le compte.
   *
   * Comme `createdAt`, elle **ne coûte rien** : la session charge déjà la ligne entière du compte.
   */
  auClubDepuis: Date | null;
  sessionId: string;
  /**
   * **Espace admin ouvert sur cette session-ci.** Ce n'est pas une propriété du compte mais un état
   * momentané : il s'obtient en redonnant mot de passe + code (une *élévation*), il se referme d'un
   * bouton, et il tombe tout seul — **après 10 min sans rien faire dans l'espace admin**, et au
   * plus tard au bout de 12 h (voir `src/lib/auth/elevation.ts` : le cookie sans échéance ne
   * suffisait pas, les navigateurs le restaurent au redémarrage).
   */
  sessionForte: boolean;
  /** L'élévation est tombée d'elle-même (inactivité, absence, plafond) : voir `getCurrentUser`. */
  elevationRetombee: boolean;
  /** Quand l'élévation en cours a été ouverte (voir `ouvertureElevation`), `null` s'il n'y en a pas. */
  elevationOuverteLe: Date | null;
  /** Dernière vérification 2FA de cette session (null pour une session par lien) */
  reauthAt: Date | null;
};

/**
 * Utilisateur connecté (ou null). Mis en cache par requête via React cache().
 * Met à jour lastSeenAt au plus une fois par heure.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!isValidTokenFormat(token)) return null;
  const session = await db.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now() || !session.user.actif) {
    await db.authSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  /*
   * **La fenêtre de 12 h glisse ici, à chaque requête**.
   *
   * Le dossier promet que « chaque geste dans l'application repousse l'échéance de 12 h ». Le glissement
   * ne vivait que dans `touchSession`, appelée depuis **cinq** server actions (deux sur les présences, une
   * sur les événements, une sur l'identité) : ouvrir une page, régler le planning, relire son historique,
   * répondre à un atelier ne repoussaient rien. Quelqu'un connecté le matin et revenu le soir se faisait
   * donc éjecter **au milieu** de son premier geste — le seul moment où l'échéance aurait bougé.
   *
   * C'est le bon endroit : `getCurrentUser` est traversée par **toute** requête authentifiée, elle est mise
   * en cache par requête (une seule écriture, pas une par composant), elle charge déjà la ligne, et elle y
   * rafraîchit déjà `lastSeenAt`. Les deux champs partent dans **la même** écriture quand les deux sont
   * dus.
   *
   * Ce qu'elle ne fait pas — et n'a pas le droit de faire : écrire le cookie. Un composant serveur ne peut
   * pas en poser. La persistance du cookie reste donc au geste explicite (`touchSession`), et c'est sans
   * conséquence : **la base est l'autorité** sur la durée d'une session ; le cookie ne fait que porter le
   * jeton.
   */
  const aEcrire: { lastSeenAt?: Date; expiresAt?: Date } = {};
  if (Date.now() - session.lastSeenAt.getTime() > 60 * 60 * 1000) aEcrire.lastSeenAt = new Date();
  const echeance = echeanceProlongee(session);
  if (echeance) aEcrire.expiresAt = echeance;
  if (Object.keys(aEcrire).length > 0) {
    await db.authSession.update({ where: { id: session.id }, data: aEcrire }).catch(() => {});
  }
  const u = session.user;
  /*
   * **La sortie de l'application se tranche ici, une fois par requête.**
   *
   * Le navigateur prévient qu'il part (arrière-plan, onglet fermé) — mais il envoie le même signal
   * quand on change simplement de page. La sortie est donc notée, jamais immédiate : cette requête
   * dit laquelle des deux c'était. Revenue à temps, l'application annule la sortie ; revenue trop
   * tard, l'élévation est **refermée pour de bon** (et pas seulement refusée : une fermeture en base
   * met tout le monde d'accord, y compris les requêtes parties en parallèle).
   */
  const etat = await etatElevation(session.id, session.elevationVueLe, session.elevationSortieLe);
  const peutElever = peutOuvrirSessionForte(u) && session.forte;
  const forte = peutElever && etat === "ouverte";
  /*
   * **Une élévation qui vient de tomber, et personne ne l'a demandé.** La session se dit encore
   * élevée (`session.forte`), mais le cookie ou l'une des échéances dit le contraire : dix minutes
   * sans rien faire dans l'espace admin, une absence trop longue, le plafond de douze heures. Ce
   * cas-là ne se traite pas comme « cette personne veut entrer » — voir `requirePermission`.
   */
  const retombee = peutElever && etat === "retombee";
  // Lue seulement quand elle sert : c'est un déchiffrement de cookie, pas une requête.
  const ouverteLe = forte ? await ouvertureElevation(session.id) : null;
  if (session.elevationSortieLe) {
    if (forte) await annulerSortieElevation(session.id);
    else if (session.forte) await refermerElevationSortie(session.id);
  }
  return {
    id: u.id,
    prenom: u.prenom,
    nom: u.nom,
    email: u.email,
    role: u.role,
    estAdmin: u.estAdmin,
    // La ligne entière du compte est déjà chargée (`include: { user: true }`) : aucune requête de plus.
    service: u.service,
    actif: u.actif,
    rappelEmail: u.rappelEmail,
    theme: u.theme,
    // Déjà chargées avec la ligne du compte : aucune requête de plus (voir le type).
    createdAt: u.createdAt,
    auClubDepuis: u.auClubDepuis,
    sessionId: session.id,
    /*
     * Voir `forte` plus haut. Trois conditions, dans cet ordre : **le rôle** (un instructeur qui
     * aurait le cookie n'ouvre rien), **la colonne `forte`** de la session, et **le cookie
     * d'élévation** (avec ses échéances d'inactivité et de sortie).
     *
     * La colonne n'est pas un doublon du cookie : c'est l'interrupteur **côté serveur**. Sans elle,
     * « Quitter l'espace admin » ne reposait que sur la bonne volonté du navigateur à jeter son
     * cookie — un cookie recopié ailleurs restait valable douze heures malgré la sortie, et aucun
     * administrateur ne pouvait couper l'élévation de quelqu'un sans supprimer sa session entière.
     * Le cookie, lui, reste indispensable : c'est lui, et lui seul, qui meurt à la fermeture de
     * l'application. L'un dit « le serveur veut bien », l'autre « l'application est encore ouverte ».
     */
    sessionForte: forte,
    /*
     * **Non pas « pas admin », mais « ne l'est plus ».** Ce drapeau ne donne aucun droit — il est
     * toujours faux quand `sessionForte` est vrai — et ne sert qu'à choisir où l'on renvoie
     * quelqu'un : l'accueil avec un mot d'explication quand l'élévation est tombée toute seule, la
     * porte (`/connexion/admin`) quand la personne vient la chercher.
     */
    elevationRetombee: retombee,
    /**
     * Quand l'élévation a été prise. Le navigateur s'en sert pour reconnaître une élévation qu'il
     * vient d'obtenir d'une élévation restaurée avec ses cookies au redémarrage de l'application.
     */
    elevationOuverteLe: ouverteLe,
    reauthAt: session.reauthAt,
  };
});

/**
 * Destination de retour (« suite ») : un seul et même format partout, un seul validateur
 * (`cheminSuiteSur`, qui n'accepte qu'un chemin interne et renvoie "/" sinon).
 */
export function lienConnexion(suite: string): string {
  const cible = cheminSuiteSur(suite);
  return cible === "/" ? "/connexion" : `/connexion?suite=${encodeURIComponent(cible)}`;
}

/**
 * Page en cours, d'après l'en-tête posé par le middleware : un layout (rendu avant sa page)
 * peut ainsi renvoyer vers la connexion sans perdre l'URL demandée.
 * Les pages de connexion elles-mêmes sont exclues (pas de boucle de retour sur soi).
 */
export async function cheminCourant(): Promise<string> {
  const chemin = cheminSuiteSur((await headers()).get("x-chemin"));
  return chemin === "/" || chemin.startsWith("/connexion") ? "/" : chemin;
}

/** Valeur du cookie « suite » posé par le middleware (Next peut l'avoir encodée en l'écrivant). */
function decoderCookieSuite(valeur: string | undefined): string {
  if (!valeur) return "/";
  if (valeur.startsWith("/")) return valeur;
  try {
    return decodeURIComponent(valeur);
  } catch {
    return "/";
  }
}

/**
 * Destination mémorisée avant la connexion : d'abord celle passée explicitement (URL ou formulaire),
 * sinon celle retenue par le middleware au moment de la redirection — la personne a pu repasser par
 * sa boîte mail (lien personnel) entre-temps. Toujours validée comme chemin interne.
 */
export async function destinationRetour(suite?: string | null): Promise<string> {
  const demandee = cheminSuiteSur(suite);
  if (demandee !== "/") return demandee;
  return cheminSuiteSur(decoderCookieSuite((await cookies()).get(SUITE_COOKIE)?.value));
}

/** Oublie la destination mémorisée (à appeler dès qu'elle a servi). Server actions uniquement. */
export async function oublierDestination(): Promise<void> {
  (await cookies()).delete(SUITE_COOKIE);
}

/** Redirige vers la connexion si non connecté, en gardant la page demandée. */
export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const cible = cheminSuiteSur(next);
    redirect(lienConnexion(cible === "/" ? await cheminCourant() : cible));
  }
  return user;
}

/**
 * Redirige vers l'accueil (403 fonctionnel) si la permission manque.
 * Les permissions d'administration exigent l'**élévation** (mot de passe + code redonnés) : un
 * administrateur qui n'a pas encore pris l'espace admin sur cet appareil est envoyé sur
 * `/connexion/admin`, qui ne le déconnecte de rien — il y ajoute le second facteur et revient ici.
 *
 * Seule exception : le parcours de réglage de l'accès administrateur (`/admin/activer`), qui ne peut
 * pas exiger la session forte qu'il sert justement à obtenir. Le rôle et l'activité du compte sont
 * vérifiés ici comme ailleurs ; la page, elle, ajoute ses propres règles (administrateur nominatif,
 * étapes dans l'ordre) — voir src/lib/auth/acces-admin.ts.
 */
export async function requirePermission(permission: Permission, next?: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/?acces=refuse");
  if (exigeSessionForte(permission) && !user.sessionForte) {
    // Égalité stricte (ou sous-chemin du parcours) : un `startsWith` nu aurait offert la même
    // dispense à toute future route commençant par ces lettres — `/admin/activer-tout`, par
    // exemple, qui n'a rien à voir avec le réglage de l'accès administrateur.
    // (`cheminCourant` rend le chemin **et** sa requête : `/admin/activer?erreur=tentatives` est
    // bien le parcours, on compare donc sur la partie chemin.)
    const chemin = (await cheminCourant()).split(/[?#]/)[0];
    if (chemin === CHEMIN_ACTIVATION_ADMIN || chemin.startsWith(`${CHEMIN_ACTIVATION_ADMIN}/`)) return user;
    /*
     * **L'élévation est tombée toute seule : on referme pour de bon, et on dépose à l'accueil.**
     *
     * Demander mot de passe et code ici serait une mise à la porte déguisée — la personne n'a rien
     * demandé, elle a juste cliqué après avoir lâché son téléphone dix minutes.
     *
     * `refermerElevationSortie` est le **même** geste que le bouton « Quitter l'espace admin » :
     * `forte` repasse à faux en base, les deux dates sont remises à plat. Il ne s'agit pas de cacher
     * l'onglet Admin, mais d'être vraiment sorti — l'onglet disparaît alors de lui-même, parce qu'il
     * n'y a plus rien à afficher. Et c'est ce qui rend la fois d'après normale : la session n'étant
     * plus marquée élevée, un clic sur « Espace admin » repasse par la porte, sans rebond.
     */
    if (user.elevationRetombee) {
      await refermerElevationSortie(user.sessionId);
      redirect(ACCUEIL_ELEVATION_REFERMEE);
    }
    redirect(`/connexion/admin?suite=${encodeURIComponent(cheminSuiteSur(next ?? "/admin"))}`);
  }
  // Ouvrir un écran d'administration est un geste : il repousse l'échéance d'inactivité.
  if (exigeSessionForte(permission)) await toucherElevation(user.sessionId);
  return user;
}

export class AccesRefuse extends Error {
  constructor() {
    super("Accès refusé");
    this.name = "AccesRefuse";
  }
}

/** Variante pour les server actions : lève au lieu de rediriger. */
export async function assertPermission(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || !can(user, permission)) throw new AccesRefuse();
  if (exigeSessionForte(permission)) {
    if (!user.sessionForte) throw new AccesRefuse();
    // Une action d'administration compte comme un geste, au même titre qu'une page ouverte.
    await toucherElevation(user.sessionId);
  }
  return user;
}

/**
 * Actions sensibles (suppression de compte, changement de rôle, paramètres techniques, sessions, 2FA d'autrui) :
 * un administrateur doit avoir vérifié son code 2FA depuis moins de 10 min, sinon il est envoyé sur
 * /connexion/verifier puis ramené à `suite`. Les instructeurs (sessions par lien, sans 2FA) ne sont pas concernés.
 *
 * **Le bureau se lit sur `estAdmin`**. Cette ligne-ci est celle qui coûtait le plus cher : écrite
 * `user.role !== "ADMIN"`, elle rendait la main **tout de suite pour tout le monde** — `role` ne
 * vaut plus jamais `"ADMIN"` — et plus un seul des gestes qui exigent un code récent (changer
 * l'adresse de quelqu'un, lui renvoyer son lien, effacer un compte ou une séance) ne le
 * redemandait. Un refus silencieux se voit ; une garde qui s'ouvre en silence, non.
 */
export async function exigerReauth(user: CurrentUser, suite: string): Promise<void> {
  if (!user.estAdmin) return;
  if (!user.sessionForte) redirect(`/connexion/admin?suite=${encodeURIComponent(cheminSuiteSur(suite))}`);
  if (!user.reauthAt || Date.now() - user.reauthAt.getTime() > DUREE_REAUTH_MS) {
    redirect(`/connexion/verifier?suite=${encodeURIComponent(cheminSuiteSur(suite))}`);
  }
}
