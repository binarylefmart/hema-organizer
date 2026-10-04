import { cookies } from "next/headers";
import { isValidTokenFormat, signPayload, verifySignedPayload } from "@/lib/auth/tokens";
import { chiffrer, dechiffrer } from "@/lib/crypto";
import { baseUrl, env } from "@/lib/env";
import { invitationUrl } from "@/lib/invitations";

/**
 * **Le seul endroit où l'application connaît le lien personnel en clair.**
 *
 * La base n'en garde que le SHA-256 : nulle part ailleurs on ne saurait le réafficher. Il n'existe
 * qu'à l'instant où quelqu'un ouvre `/invitation/<jeton>` — c'est-à-dire juste avant d'atterrir ici.
 * Ce cookie de passage transporte le jeton sur ce seul pas, pour que l'écran de bienvenue puisse
 * offrir un vrai bouton « Copier mon lien » (ce qu'un email, lui, ne peut pas faire).
 *
 * Pourquoi un cookie plutôt qu'un paramètre d'URL : un jeton dans l'adresse reste dans l'historique
 * du navigateur, part dans le `Referer` et se retrouve dans les journaux du proxy. En cookie
 * `httpOnly`, il ne traverse que le serveur, et n'apparaît qu'une fois dans le HTML de cet écran.
 *
 * **Ce cookie est rattaché à son propriétaire, et il l'est** (défaut trouvé par relecture adverse).
 * Il ne portait que le jeton nu, et la lecture n'en vérifiait que la *forme* : sur un appareil
 * partagé — la tablette du club, l'iPad de la maison —, Alice ouvrait son lien puis se
 * déconnectait, et si Bob se connectait dans les quinze minutes et passait par `/bienvenue`, le
 * bouton « Copier mon lien » lui donnait **la clé d'Alice**, valable quatre mois. Le cookie porte
 * donc désormais, comme celui des codes de secours (`lireAffichageCodes`, src/lib/auth/deux-fa.ts),
 * un contenu **signé** qui nomme son destinataire, un jeton **chiffré**, et sa propre échéance ; et
 * `destroySession` l'efface, pour ne pas laisser traîner une clé dont plus personne n'a l'usage.
 */
export const LIEN_PERSO_COOKIE = "hema_lien_perso";

/** Le temps de lire l'écran de bienvenue, pas davantage : ensuite le bouton de copie disparaît. */
export const DUREE_LIEN_PERSO_MS = 15 * 60 * 1000;

/** Ce que porte le cookie : à qui il est destiné, jusqu'à quand, et le jeton chiffré. */
type PassageLienPerso = { uid: string; exp: number; jeton: string };

/**
 * Pose le cookie de passage au sortir de l'ouverture d'un lien. Le jeton n'y est ni lisible (il est
 * chiffré) ni détachable de son propriétaire (la signature couvre `uid`) : recopié dans le
 * navigateur de quelqu'un d'autre, il ne rend rien.
 */
export async function poserLienPersonnel(userId: string, token: string): Promise<void> {
  const charge: PassageLienPerso = { uid: userId, exp: Date.now() + DUREE_LIEN_PERSO_MS, jeton: chiffrer(token) };
  (await cookies()).set(LIEN_PERSO_COOKIE, signPayload(charge, env().SESSION_SECRET, "lien-personnel"), {
    httpOnly: true,
    sameSite: "lax",
    secure: baseUrl().startsWith("https://"),
    path: "/bienvenue",
    maxAge: DUREE_LIEN_PERSO_MS / 1000,
  });
}

/**
 * Efface le cookie de passage. Appelé par `destroySession` : la personne s'en va, sa clé ne reste
 * pas sur l'appareil à attendre le suivant. Le `path` doit être **le même** qu'à la pose, sinon le
 * navigateur garde l'ancien cookie à côté du nouveau.
 */
export async function oublierLienPersonnel(): Promise<void> {
  (await cookies()).set(LIEN_PERSO_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/bienvenue", maxAge: 0 });
}

/**
 * Le lien personnel qui vient d'être ouvert **par cette personne-là**, ou `null` si ce passage ne l'a
 * pas transmis (cookie périmé, arrivée par un autre chemin, cookie laissé par quelqu'un d'autre sur
 * un appareil partagé) : dans ce cas l'écran se passe simplement du bouton.
 */
export async function lienPersonnelDeLOuverture(userId: string): Promise<string | null> {
  const brut = (await cookies()).get(LIEN_PERSO_COOKIE)?.value;
  if (!brut) return null;
  const charge = verifySignedPayload<PassageLienPerso>(brut, env().SESSION_SECRET, "lien-personnel");
  // Usage, signature, destinataire, échéance : les quatre, et dans cet ordre. C'est le contrôle qui manquait.
  if (!charge || charge.uid !== userId || typeof charge.exp !== "number" || charge.exp < Date.now()) return null;
  if (typeof charge.jeton !== "string") return null;
  const jeton = dechiffrer(charge.jeton);
  // Forme du jeton vérifiée avant de reconstruire l'adresse : un cookie reste une entrée du dehors
  return isValidTokenFormat(jeton) ? invitationUrl(jeton) : null;
}
