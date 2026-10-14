import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { chiffrer, dechiffrer } from "@/lib/crypto";
import { baseUrl, env } from "@/lib/env";
import { signPayload, verifySignedPayload } from "./tokens";

/**
 * Accès administrateur **compte par compte**. Deux portes, deux serrures :
 *
 * - **entrer dans l'application** : son lien personnel, ou son adresse et son mot de passe.
 *   **Jamais de code de double authentification ici**, quel que soit le rôle et même si elle est
 *   configurée : la session ouverte est ordinaire, la même que par le lien ;
 * - **ouvrir l'espace admin** (`/connexion/admin`, l'élévation) : mot de passe **et** code, toujours.
 *   C'est la seule porte où la double authentification sert, et elle n'existe que pour le bureau.
 *
 * **Un membre du bureau n'utilise pas l'application sans avoir réglé son accès** — compte du portail
 * compris (`reglageAccesDu`). Tant que ce n'est pas fait, chaque écran de l'espace connecté le
 * renvoie sur `/admin/activer` (mise en page `src/app/(app)/layout.tsx`), la connexion et
 * l'ouverture de son lien l'y déposent, et les server actions gardées par `assertPermission` le
 * refusent. Le parcours se fait en trois temps, repris là où il s'est arrêté :
 *   1. mot de passe (`nouveauMotDePasseSchema`, haché argon2id) — déjà fait pour le compte du
 *      portail, qui choisit le sien sur `/nouveau-mot-de-passe` ;
 *   2. double authentification (QR code, secret chiffré, activation par un premier code juste) ;
 *   3. codes de secours, affichés une seule fois.
 * Au bout du parcours la session en cours devient forte (12 h, sans prolongation). Une fois réglé,
 * entrer dans l'application ne demande toujours **aucun** code.
 *
 * **Membres et instructeurs** peuvent se donner un mot de passe depuis « Mon profil » : c'est un
 * filet pour entrer depuis un appareil où l'on n'a pas son lien, pas une obligation.
 * Trois règles tiennent l'ensemble, et ce sont les trois fonctions ci-dessous :
 *
 * - `peutSeConnecterParMotDePasse` : qui peut ouvrir une session depuis `/connexion` — **tout compte
 *   actif qui a une adresse et un mot de passe**, quel que soit son rôle ;
 * - `peutReglerSonAcces` / `reglageAccesDu` : qui règle mot de passe et double authentification,
 *   et qui **doit** le faire avant tout le reste — **un membre du bureau actif avec une adresse**,
 *   compte du portail compris ;
 * - `peutOuvrirSessionForte` : qui obtient la session « forte » qui ouvre l'administration
 *   technique — **le bureau (`User.estAdmin`) et lui seul**.
 *
 * **Adresse email facultative** : toutes ces portes supposent une adresse (on se connecte *par* son
 * adresse). Un compte sans adresse n'y a pas accès — ni réglage, ni connexion, ni mot de passe oublié.
 */

/** Route du parcours de réglage (contrat : les points d'entrée de l'application pointent ici). */
export const CHEMIN_ACTIVATION_ADMIN = "/admin/activer";

/**
 * Carte « Sécuriser mon compte » du profil : mot de passe facultatif pour un membre ou un instructeur ;
 * mot de passe et double authentification obligatoires pour un membre du bureau, qui les règle par
 * `CHEMIN_ACTIVATION_ADMIN`.
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
   * (`peutSeConnecterParMotDePasse`, `deuxFaActive`) n'ont rien à voir avec
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
 * Qui règle son propre accès administrateur sur `/admin/activer` : **un membre du bureau actif qui a
 * une adresse**, compte du portail compris. Un membre ou un instructeur n'a rien à régler ici — son
 * lien personnel suffit, et le mot de passe qu'il se donne éventuellement depuis « Mon profil »
 * (`ANCRE_SECURITE`) reste facultatif.
 */
export function peutReglerSonAcces(compte: Profil | null | undefined): boolean {
  // **Le bureau se lit sur `estAdmin`** : `role === "ADMIN"` n'est plus jamais vrai, la garde
  // aurait donc répondu « non » à tout le monde — aucun administrateur n'aurait plus été envoyé
  // régler son mot de passe et sa double authentification, et l'espace admin serait resté fermé
  // sans que rien n'indique pourquoi.
  if (!compte || !compte.actif || !compte.estAdmin) return false;
  // Sans adresse email, la page de connexion ne saurait pas retrouver ce compte : régler un mot de
  // passe ne mènerait nulle part. On renseigne d'abord l'adresse, depuis la fiche du membre.
  return !!compte.email;
}

/**
 * **La règle unique de l'obligation** : ce compte doit-il faire le parcours `/admin/activer` avant
 * toute autre chose ? Oui pour un membre du bureau actif, avec une adresse (compte du portail
 * compris), dont le mot de passe, la double authentification ou les codes manquent.
 *
 * Elle s'applique **dès l'entrée**, pas seulement à la porte de l'espace admin : à la connexion, à
 * l'ouverture du lien, et à son prochain écran pour un compte qui vient d'être nommé au bureau.
 *
 * Un membre du bureau **sans adresse** n'y est pas tenu : il ne pourrait pas se connecter par mot de
 * passe, et l'enfermer sur un parcours qu'il ne peut pas terminer le mettrait dehors.
 */
export function reglageAccesDu(compte: Profil | null | undefined): boolean {
  return peutReglerSonAcces(compte) && !accesAdminRegle(compte!);
}

/**
 * Écrans que l'obligation de réglage laisse ouverts : le parcours lui-même, l'écran de bienvenue (la
 * question de l'installation passe d'abord, puis il sort vers le parcours), le choix d'un mot de
 * passe provisoire (qui précède l'étape 2) et l'affichage unique des codes de secours (un cookie de
 * codes en attente ne doit jamais être perdu par un renvoi). Tout autre chemin renvoie sur
 * `CHEMIN_ACTIVATION_ADMIN`.
 * Comparaison sur la partie chemin, à l'égalité ou au sous-chemin près (`/admin/activer-tout` n'est
 * pas le parcours).
 */
export const CHEMINS_LIBRES_PENDANT_REGLAGE = [CHEMIN_ACTIVATION_ADMIN, "/bienvenue", "/nouveau-mot-de-passe", "/connexion/codes-secours"] as const;

export function cheminLibrePendantReglage(cheminDemande: string): boolean {
  const chemin = cheminDemande.split(/[?#]/)[0];
  return CHEMINS_LIBRES_PENDANT_REGLAGE.some((libre) => chemin === libre || chemin.startsWith(`${libre}/`));
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
 * Qui peut se donner un mot de passe depuis « Mon profil » : tout compte actif qui a une adresse —
 * c'est *par* elle qu'on se connecte ensuite. Le compte du portail est inclus : c'est là qu'il change
 * son mot de passe.
 *
 * « Peut », et non « doit » : pour un membre ou un instructeur, c'est un filet facultatif. Un membre
 * du bureau, lui, n'a pas le choix — son chemin de réglage est `/admin/activer` (`reglageAccesDu`),
 * qui enchaîne mot de passe, 2FA et codes de secours.
 */
export function peutSecuriserSonCompte(compte: Profil | null | undefined): boolean {
  return !!compte && compte.actif && !!compte.email;
}

/**
 * Qui peut **activer** une double authentification depuis « Mon profil » : le bureau seulement
 * (`peutOuvrirSessionForte`), avec un mot de passe déjà posé. Elle ne sert qu'à ouvrir l'espace admin ;
 * proposée à un membre, elle ne protégerait rien.
 */
export function peutActiverDeuxFa(compte: Profil | null | undefined): boolean {
  return peutSecuriserSonCompte(compte) && peutOuvrirSessionForte(compte) && !!compte?.passwordHash;
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

async function chargeReglage2fa(userId: string): Promise<Reglage2fa | null> {
  const brut = (await cookies()).get(ACTIVATION_COOKIE)?.value;
  if (!brut) return null;
  const p = verifySignedPayload<Reglage2fa>(brut, env().SESSION_SECRET, "reglage-2fa");
  if (!p || p.uid !== userId || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  // `secret` part dans `dechiffrer`, qui découpe une chaîne : la forme se vérifie, elle ne se suppose pas.
  if (typeof p.secret !== "string" || !p.secret) return null;
  return p;
}

/**
 * Secret provisoire du réglage en cours, **pour ce compte uniquement** : un cookie portant l'identité
 * de quelqu'un d'autre est ignoré (on ne règle jamais le compte d'un autre).
 */
export async function lireReglage2fa(userId: string): Promise<string | null> {
  const p = await chargeReglage2fa(userId);
  return p ? dechiffrer(p.secret) : null;
}

export async function fermerReglage2fa(): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVATION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}
