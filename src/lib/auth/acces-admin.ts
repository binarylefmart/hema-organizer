import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { chiffrer, dechiffrer } from "@/lib/crypto";
import { baseUrl, env } from "@/lib/env";
import { estCompteDeService } from "@/lib/permissions";
import { signPayload, verifySignedPayload } from "./tokens";

/**
 * Accès administrateur **compte par compte**, et — — mot de passe et double authentification
 * **facultatifs pour les membres et les instructeurs**, **obligatoires pour les administrateurs** :
 * l'espace admin ne s'ouvre qu'avec les deux.
 *
 * Le compte du portail (`service`) est réglé une fois pour toutes par le seed. Les administrateurs
 * nominatifs, eux, entrent par leur lien personnel comme tout le monde — c'est permis, mais leur
 * session n'est alors jamais « forte », et l'administration technique reste fermée. Ils doivent donc
 * régler leur accès depuis `/admin/activer`, en trois temps repris là où ils se sont arrêtés :
 *   1. mot de passe (mêmes règles que le portail : `nouveauMotDePasseSchema`, haché argon2id) ;
 *   2. double authentification (QR code, secret chiffré, activation par un premier code juste) ;
 *   3. codes de secours, affichés une seule fois.
 * Au bout du parcours la session en cours devient forte (12 h, sans prolongation) et la connexion
 * directe sur `/connexion` fonctionne comme pour le compte du portail.
 *
 * **Membres et instructeurs** peuvent désormais, s'ils le veulent, se donner un mot de passe (et,
 * en option, une double authentification) depuis « Mon profil » : c'est un filet pour entrer depuis
 * un appareil où l'on n'a pas son lien, pas une obligation — le lien personnel continue de suffire.
 * Pour un ADMIN, au contraire, les deux sont exigés : ce n'est pas une option qu'il peut décliner
 * indéfiniment, puisque sans elles il n'a jamais de session forte.
 * Trois règles tiennent l'ensemble, et ce sont les trois fonctions ci-dessous :
 *
 * - `peutSeConnecterParMotDePasse` : qui peut ouvrir une session depuis `/connexion` — **tout compte
 *   actif qui a une adresse et un mot de passe**, quel que soit son rôle ;
 * - `exigeDeuxFaConnexion` : à qui l'on demande ensuite un code — **à qui l'a configuré**, et à
 *   personne d'autre, quel que soit le rôle. Ouvrir l'espace admin, en revanche, redemande
 *   toujours mot de passe **et** code : c'est une autre porte (`/connexion/admin`) ;
 * - `peutOuvrirSessionForte` : qui obtient la session « forte » qui ouvre l'administration
 *   technique — **le bureau (`User.estAdmin`) et lui seul**. Mot de passe + double authentification
 *   n'y donnent aucun droit : un instructeur qui s'équipe des deux ouvre une session ordinaire,
 *   exactement comme par son lien.
 *
 * **Adresse email facultative** : toutes ces portes supposent une adresse (on se connecte *par* son
 * adresse). Un compte sans adresse n'y a pas accès — ni réglage, ni connexion, ni mot de passe oublié.
 */

/** Route du parcours de réglage (contrat : les points d'entrée de l'application pointent ici). */
export const CHEMIN_ACTIVATION_ADMIN = "/admin/activer";

/**
 * Carte « Sécuriser mon compte » du profil : mot de passe et double authentification — facultatifs
 * pour un membre ou un instructeur, obligatoires pour un ADMIN (qui les règle, lui, par
 * `CHEMIN_ACTIVATION_ADMIN`).
 * (Ici et non dans `src/actions/auth.ts` : un fichier `"use server"` ne peut exporter que des
 * fonctions asynchrones — une constante exportée là fait tomber le rendu de toute l'application.)
 */
export const ANCRE_SECURITE = "/profil#securite";

/** Secret TOTP provisoire du réglage en cours : cookie signé, secret chiffré (comme la connexion). */
const ACTIVATION_COOKIE = "hema_activation";
/** Installer une application d'authentification et scanner un QR code prend plus de temps qu'une connexion. */
export const DUREE_ACTIVATION_MS = 30 * 60 * 1000;

export type CompteAcces = {
  id: string;
  prenom: string;
  /**
   * Adresse facultative en base. Un compte sans adresse ne peut de toute façon pas se connecter par
   * mot de passe (la page de connexion cherche un compte **par son adresse**) : le parcours de réglage
   * ne s'ouvre donc jamais pour lui — voir `peutReglerSonAcces`.
   */
  email: string | null;
  /** Rôle **de base** : `MEMBRE` ou `INSTRUCTEUR`. Le bureau s'ajoute par-dessus — voir `estAdmin`. */
  role: string;
  /**
   * **Du bureau, en supplément du rôle de base**. Obligatoire ici, et pas facultatif : c'est la
   * forme que `compteAcces` lit en base, et toutes les portes ci-dessous en dépendent.
   */
  estAdmin: boolean;
  actif: boolean;
  service: boolean;
  passwordHash: string | null;
  totpSecret: string | null;
  totpActiveAt: Date | null;
  doitChangerMotDePasse: boolean;
};

/** Ce que les règles ci-dessous regardent d'un compte (les tests les appellent avec un objet nu). */
type Profil = {
  /** Rôle **de base** : `MEMBRE` ou `INSTRUCTEUR` (`role` ne vaut plus jamais `"ADMIN"`). */
  role: string;
  /**
   * **Du bureau, en supplément**. Facultatif ici pour la même raison que sur `UserLike`
   * (src/lib/permissions.ts) : les appelants qui n'interrogent que les portes « mot de passe »
   * (`peutSeConnecterParMotDePasse`, `deuxFaActive`, `peutProposerDeuxFa`) n'ont rien à voir avec
   * l'administration et continuent de passer un objet minimal. Absent, il vaut « pas du bureau » —
   * et les deux seules fonctions qui le lisent reçoivent, elles, un `CompteAcces`, où il est
   * obligatoire.
   */
  estAdmin?: boolean | null;
  actif: boolean;
  /** Adresse facultative : sans adresse, aucune porte « mot de passe » n'existe (voir ci-dessous). */
  email?: string | null;
  service?: boolean | null;
  passwordHash?: string | null;
  totpSecret?: string | null;
  totpActiveAt?: Date | null;
  doitChangerMotDePasse?: boolean | null;
};

/**
 * Ce que regarde `peutProposerDeuxFa`, et **rien de moins** : la dernière proposition est ici
 * **obligatoire**, volontairement.
 *
 * Le piège qu'on ferme : laissée facultative sur `Profil`, la colonne manquait sans bruit à tout
 * appelant qui ne l'avait pas chargée (`CompteAcces` ne la sélectionne pas), `derniere` valait
 * `undefined`, la fonction répondait donc toujours « oui » — et la proposition revenait à chaque
 * connexion, sans que rien ne le signale à la compilation. Exigé ici, un tel appelant ne compile plus.
 */
type ProfilProposition = Profil & {
  /** Dernière fois que la double authentification a été proposée (bouton « Plus tard »). */
  deuxFaProposeeLe: Date | null;
};

/** Accès du compte, tels qu'ils sont en base (aucun autre endroit ne lit ces colonnes ensemble). */
export async function compteAcces(userId: string): Promise<CompteAcces | null> {
  return db.user.findUnique({
    where: { id: userId },
    // `estAdmin` autant que `role` : les deux portes d'administration ci-dessous (`peutReglerSonAcces`,
    // `peutOuvrirSessionForte`) le lisent, et une colonne non chargée vaudrait « pas du bureau » —
    // c'est-à-dire un refus silencieux de l'espace admin à qui y a droit.
    select: { id: true, prenom: true, email: true, role: true, estAdmin: true, actif: true, service: true, passwordHash: true, totpSecret: true, totpActiveAt: true, doitChangerMotDePasse: true },
  });
}

/**
 * Qui **doit** régler son propre accès administrateur : un membre du bureau actif **nominatif**.
 * Le compte du portail est déjà réglé (et ne doit pas être rejoué) ; un membre ou un instructeur
 * n'a rien à régler ici — son lien personnel suffit, et le mot de passe qu'il se donne éventuellement
 * depuis « Mon profil » (`ANCRE_SECURITE`) reste facultatif.
 */
export function peutReglerSonAcces(compte: Profil | null | undefined): boolean {
  // **Le bureau se lit sur `estAdmin`** : `role === "ADMIN"` n'est plus jamais vrai, la garde
  // aurait donc répondu « non » à tout le monde — aucun administrateur n'aurait plus été envoyé
  // régler son mot de passe et sa double authentification, et l'espace admin serait resté fermé
  // sans que rien n'indique pourquoi.
  if (!compte || !compte.actif || !compte.estAdmin) return false;
  // Sans adresse email, la page de connexion ne saurait pas retrouver ce compte : régler un mot de
  // passe ne mènerait nulle part. On renseigne d'abord l'adresse, depuis la fiche du membre.
  if (!compte.email) return false;
  return !estCompteDeService(compte);
}

/**
 * Qui peut se connecter sur `/connexion` : **tout compte actif qui a une adresse et un mot de passe**.
 *
 * Jusqu' cette porte était réservée aux ADMIN. Elle s'ouvre à qui s'est donné un mot de passe
 * depuis « Mon profil » — **facultatif pour un membre ou un instructeur** —, parce que le lien seul
 * enfermait dehors quiconque perdait son email. Ce n'est qu'une **porte d'entrée** : elle ne
 * distribue aucun droit — les droits restent ceux du rôle, et l'administration technique continue
 * d'exiger `peutOuvrirSessionForte`.
 *
 * Un compte **sans** mot de passe n'entre pas par ici : il a son lien personnel, et la page de
 * connexion lui renvoie le message générique (aucune énumération de comptes). Pour un **ADMIN**, ce
 * cas n'est qu'un état transitoire : il lui faut un mot de passe (et une 2FA) pour ouvrir l'espace
 * admin, d'où le parcours obligatoire `/admin/activer`.
 */
export function peutSeConnecterParMotDePasse(compte: Profil | null | undefined): boolean {
  // `!!compte.email` : la connexion et le « mot de passe oublié » cherchent un compte par son adresse.
  // Sans adresse, cette porte n'existe pas — le contrôle est ici, une fois pour toutes.
  return !!compte && compte.actif && !!compte.passwordHash && !!compte.email;
}

/** La double authentification est-elle configurée et active sur ce compte ? */
export function deuxFaActive(compte: Profil | null | undefined): boolean {
  return !!compte && !!compte.totpSecret && !!compte.totpActiveAt;
}

/**
 * Faut-il un code de double authentification pour **se connecter à l'application** ?
 *
 * **Une seule règle, pour tout le monde** : on demande le code **à qui l'a configuré**,
 * administrateurs compris, et à personne d'autre. Trois façons d'entrer, donc, toutes légitimes :
 * son lien personnel ; son mot de passe ; son mot de passe **et** son code si la double
 * authentification est en place. À qui ne l'a pas, elle est **proposée** juste après le mot de
 * passe, avec un bouton « Plus tard » (voir `peutProposerDeuxFa`).
 *
 * Le rôle n'entre pas dans cette règle-ci. Ce qu'il commande, c'est **l'élévation** — ouvrir
 * l'espace admin, qui redemande toujours les deux preuves, quelle que soit la façon dont la
 * session s'est ouverte (`src/app/(public)/connexion/admin`). Entrer dans l'application et ouvrir
 * les réglages techniques sont deux portes, avec deux serrures.
 *
 * (C'est la même fonction, volontairement, qui sert à la sortie du « mot de passe oublié ».)
 */
export function exigeDeuxFaConnexion(compte: Profil | null | undefined): boolean {
  return deuxFaActive(compte);
}


/**
 * Entre deux propositions de double authentification : **un trimestre**.
 *
 * Elle est proposée à la connexion par mot de passe, à qui n'en a pas. Proposer est utile — beaucoup
 * ne savent pas que ça existe ; reproposer à chaque connexion serait du harcèlement, et la bonne
 * façon de faire cliquer « Plus tard » sans lire. Une fois par trimestre, c'est un rappel, pas une
 * insistance. Et le réglage reste disponible en permanence dans « Mon profil ».
 */
export const DELAI_PROPOSITION_DEUX_FA_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Faut-il **proposer** la double authentification à cette personne après son mot de passe ?
 *
 * Proposer, pas imposer : le bouton « Plus tard » ouvre la session normalement. Ne concerne donc
 * jamais un compte qui l'a déjà : il n'y a alors rien à proposer, il y a un code à saisir.
 */
export function peutProposerDeuxFa(compte: ProfilProposition | null | undefined, now = new Date()): boolean {
  if (!compte || !compte.actif) return false;
  // Ce qui empêche de proposer, c'est **d'en avoir déjà une** — et rien d'autre. Le rôle n'entre
  // pas en jeu : un administrateur qui n'a pas encore réglé la sienne se la voit proposer ici
  // comme tout le monde, et son parcours obligatoire (`/admin/activer`) reste la porte de l'espace
  // admin. Proposer n'est pas imposer, et imposer ne se fait pas sur un écran de connexion.
  if (deuxFaActive(compte)) return false;
  // On ne propose qu'à la suite d'un mot de passe : sans mot de passe, on n'est jamais passé par là
  if (!compte.passwordHash) return false;
  const derniere = compte.deuxFaProposeeLe;
  return !derniere || now.getTime() - derniere.getTime() >= DELAI_PROPOSITION_DEUX_FA_MS;
}

/**
 * Qui peut obtenir une session **forte** — celle, et la seule, qui ouvre l'administration technique
 * (`exigeSessionForte`, src/lib/permissions.ts) ?
 *
 * **Le bureau (`estAdmin`), et rien d'autre.** C'est le garde-fou de l'ouverture du mot de passe à
 * tous : la force d'une session ne se déduit *jamais* de « mot de passe + double authentification »,
 * sinon un instructeur qui s'équipe des deux entrerait dans les réglages par effet de bord. Elle se
 * déduit de l'appartenance au bureau, vérifiée ici, au seul endroit où une session forte se crée
 * (`verifierCode2fa`) ou se renforce (`activerDeuxFaAdmin`).
 *
 * **Ce n'est plus un rôle, c'est un supplément** : un instructeur du bureau garde son rôle de base
 * *et* ouvre les réglages, ce que les trois rôles exclusifs d'avant rendaient impossible.
 */
export function peutOuvrirSessionForte(compte: Profil | null | undefined): boolean {
  // Le bureau se lit sur `estAdmin`, plus sur `role` : « administrateur » est un supplément au rôle
  // de base, et c'est lui — pas un rôle exclusif — qui ouvre la session forte.
  return !!compte && compte.actif && !!compte.estAdmin;
}

/**
 * Qui peut se donner un mot de passe (et, ensuite, une double authentification) depuis « Mon profil » :
 * tout compte actif qui a une adresse — c'est *par* elle qu'on se connecte ensuite. Le compte du
 * portail est inclus : c'est là qu'il change son mot de passe.
 *
 * « Peut », et non « doit » : pour un membre ou un instructeur, c'est un filet facultatif. Un ADMIN
 * nominatif, lui, n'a pas le choix — mais son chemin de réglage est `/admin/activer`
 * (`peutReglerSonAcces`), qui enchaîne mot de passe, 2FA et codes de secours.
 */
export function peutSecuriserSonCompte(compte: Profil | null | undefined): boolean {
  return !!compte && compte.actif && !!compte.email;
}

export type EtapeAcces = "mot-de-passe" | "deux-fa" | "codes-secours" | "termine";

/** Rang de l'étape, pour l'affichage « Étape n sur 3 ». */
export const RANG_ETAPE: Record<Exclude<EtapeAcces, "termine">, number> = { "mot-de-passe": 1, "deux-fa": 2, "codes-secours": 3 };

/**
 * Où en est le réglage. L'ordre est une règle de sécurité, pas seulement d'affichage :
 * la double authentification ne s'active qu'une fois le mot de passe choisi.
 */
export function etapeAcces(compte: Profil, codesEnAttente = false): EtapeAcces {
  if (!compte.passwordHash || compte.doitChangerMotDePasse) return "mot-de-passe";
  if (!compte.totpSecret || !compte.totpActiveAt) return "deux-fa";
  return codesEnAttente ? "codes-secours" : "termine";
}

/**
 * **Le secret existe mais ne se déchiffre pas**.
 *
 * `etapeAcces` juge sur la colonne, et répond donc « terminé » à un compte dont le secret TOTP est
 * devenu illisible (rotation de `SESSION_SECRET` — voir `etatSecretTotp`, src/lib/auth/deux-fa.ts).
 * L'écran de réglage félicitait alors quelqu'un qui ne pouvait plus entrer, et c'est **la page censée
 * réparer** : un cul-de-sac qui affirme que tout va bien. Elle le dit maintenant.
 *
 * On ne renvoie pas « étape 2 » pour autant : cette étape propose un secret neuf, et échanger un second
 * facteur illisible contre un neuf sur simple présentation du mot de passe est exactement ce que le
 * correctif de `etatSecretTotp` interdit. La sortie est la remise à zéro par un administrateur.
 */
export function secretTotpIllisible(compte: Profil): boolean {
  return !!compte.totpSecret && dechiffrer(compte.totpSecret) === null;
}

/** Réglage terminé : le compte a tout ce qu'il faut pour ouvrir une session forte. */
export function accesAdminRegle(compte: Profil): boolean {
  return etapeAcces(compte) === "termine";
}

type Reglage2fa = { uid: string; exp: number; secret: string };

/** Ouvre (ou renouvelle) le réglage 2FA en cours avec un secret provisoire, le temps de le scanner. */
export async function ouvrirReglage2fa(userId: string, secretBase32: string): Promise<void> {
  const payload: Reglage2fa = { uid: userId, exp: Date.now() + DUREE_ACTIVATION_MS, secret: chiffrer(secretBase32) };
  const jar = await cookies();
  jar.set(ACTIVATION_COOKIE, signPayload(payload, env().SESSION_SECRET, "reglage-2fa"), {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl().startsWith("https://"),
    path: "/",
    maxAge: DUREE_ACTIVATION_MS / 1000,
  });
}

/**
 * Secret provisoire du réglage en cours, **pour ce compte uniquement** : un cookie portant l'identité
 * de quelqu'un d'autre est ignoré (on ne règle jamais le compte d'un autre).
 */
export async function lireReglage2fa(userId: string): Promise<string | null> {
  const brut = (await cookies()).get(ACTIVATION_COOKIE)?.value;
  if (!brut) return null;
  const p = verifySignedPayload<Reglage2fa>(brut, env().SESSION_SECRET, "reglage-2fa");
  if (!p || p.uid !== userId || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  // `secret` part dans `dechiffrer`, qui découpe une chaîne : la forme se vérifie, elle ne se suppose pas.
  if (typeof p.secret !== "string" || !p.secret) return null;
  return dechiffrer(p.secret);
}

export async function fermerReglage2fa(): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVATION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}
