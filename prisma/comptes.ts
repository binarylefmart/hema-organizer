/**
 * Repères partagés du jeu de données : comptes types, jetons fixes, mot de passe et secrets de développement.
 * Importé par le seed, les tests e2e et le script de captures.
 *
 * Sa seule dépendance est `codeTotp`, pour `codeTotpFrais` en bas de fichier : une fonction pure,
 * sans base ni réseau. Le module était « sans dépendance » ; il valait mieux la prendre que de
 * recopier le même calcul de pas de temps dans les deux outils qui en ont besoin.
 */
import { codeTotp, TOTP_PAS_SECONDES } from "@/lib/auth/totp";

export const DEMO_MOT_DE_PASSE = "demo-organizer-2026";
/** Secret TOTP fixe de l'admin (vecteur RFC 6238) : les tests calculent le code avec codeTotp(). */
export const DEMO_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
/** Codes de secours fixes de l'admin (tests e2e) */
export const DEMO_CODES_SECOURS = ["ABCD-EFGH", "JKLM-NPQR", "STUV-WXYZ", "2345-6789"];
/** Jetons d'accès fixes (captures et tests e2e) */
export const DEMO_TOKEN_NOUVEAU = "demo-invitation-nouveau-membre-0123456789abcdefghij";
export const DEMO_TOKEN_EXISTANT = "demo-invitation-membre-existant-0123456789abcdefgh";

/** Adresse du compte d'administration : seule connexion par mot de passe du portail (les autres ADMIN entrent par lien). */
export const EMAIL_ADMINISTRATION = "contact@club.test";

/**
 * Comptes repères utilisés par les tests et les captures : **tous pris dans `MEMBRES_CLUB`**
 * (`prisma/donnees-club.ts`), sauf le compte d'administration, qui n'est le compte de personne.
 * Chacun est choisi pour l'état qu'il porte dans le jeu d'essai, dit en commentaire à côté.
 */
export const COMPTES = {
  /** Compte d'administration : mot de passe + 2FA déjà configurée */
  admin: EMAIL_ADMINISTRATION,
  /** Administrateur nominatif (entre par lien, comme tous les administrateurs nominatifs) */
  admin3: "foxtrot06@club.test",
  /** Administrateur nominatif (entre par lien ; l'administration technique demande le compte du bureau) */
  adminNominatif: "delta@club.test",
  /** Instructeur (accès par lien personnel) */
  instructeur: "charlie@club.test",
  /** Membre (sans droit de gestion) dont le lien a déjà servi */
  membre: "bravo@club.test",
  /** Membre qui n'a jamais ouvert son lien */
  nouveau: "india@club.test",
  /** Propose un atelier en attente */
  proposeur: "golf@club.test",
  /** A eu un atelier refusé */
  refuse: "hotel@club.test",
  /** A un atelier placé dans le planning */
  planifie: "bravo@club.test",
  /** Instructeur repère du programme (2nde personne de l'équipe) */
  instructeur2: "juliett@club.test",
  /** Sert aux essais de régénération / révocation de lien */
  lien: "foxtrot08@club.test",
} as const;

/** Lien d'accès fixe d'un compte du jeu de données. */
export function demoLien(email: string): string {
  if (email === COMPTES.membre) return DEMO_TOKEN_EXISTANT;
  if (email === COMPTES.nouveau) return DEMO_TOKEN_NOUVEAU;
  return `demo-lien-${email.split("@")[0].replace(/[^a-z0-9]/g, "-")}-`.padEnd(48, "0123456789abcdefghijklmnopqrstuvwxyz").slice(0, 48);
}

/**
 * **Un code TOTP qui n'a pas encore servi**, pour les outils qui passent deux portes d'affilée.
 *
 * Depuis, le serveur retient le dernier pas de temps consommé par compte et refuse tout pas
 * inférieur ou égal (`consommerCodeTotp`) : un code ne sert **qu'une fois**. Or ouvrir une session
 * d'administrateur en demande deux à quelques secondes d'intervalle — la connexion, puis la porte
 * de l'espace admin — et les deux tombent dans la même fenêtre de trente secondes, donc sur le même
 * code. La seconde porte se faisait refuser, et le refus se serait lu comme une panne de
 * l'élévation : des dizaines de scénarios e2e et toute la campagne de captures rouges, pour un
 * correctif qui fonctionne.
 *
 * On garde donc trace des pas déjà présentés **dans ce processus** et on prend le suivant. La tolérance du
 * serveur est de **±1 pas** : on ne peut pas prendre d'avance au-delà, et le troisième code d'une même
 * fenêtre attend que l'horloge avance. Une seconde d'attente valait mieux qu'un refus incompréhensible —
 * et ça n'arrive que si un outil demande trois codes en moins de trente secondes.
 *
 * **Un seul ensemble, pas un par secret**. La première version indexait les pas **par secret**, ce
 * qui paraissait plus fin et était faux : la borne du serveur vit sur le **compte**
 * (`User.totpDernierPas`), pas sur le secret. La scène qui règle une double authentification au vol
 * présente un code calculé sur un secret **neuf**, pour un compte dont les pas précédents venaient
 * d'être consommés par la connexion et l'élévation : son ensemble, vide, repartait du pas courant —
 * déjà consommé — et le serveur refusait, à juste titre. Le bon grain est donc celui du serveur.
 * L'outillage ne connaît de toute façon qu'un compte à double authentification, et avancer d'un pas
 * de trop ne coûte qu'une seconde d'attente.
 */
const pasPresentes = new Set<number>();

export async function codeTotpFrais(secret: string): Promise<string> {
  const vus = pasPresentes;
  for (;;) {
    const maintenant = Date.now();
    const pasCourant = Math.floor(maintenant / 1000 / TOTP_PAS_SECONDES);
    for (const delta of [0, 1]) {
      if (vus.has(pasCourant + delta)) continue;
      vus.add(pasCourant + delta);
      return codeTotp(secret, maintenant, delta);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
