import { z } from "zod";
import { MOT_DE_PASSE_MIN } from "@/lib/constants";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Indique ton adresse email.")
  .max(254)
  .email("Cette adresse email n'a pas l'air correcte.");

export const motDePasseSchema = z
  .string()
  .min(MOT_DE_PASSE_MIN, `Le mot de passe doit faire au moins ${MOT_DE_PASSE_MIN} caractères.`)
  .max(200, "Le mot de passe est trop long.");

export const loginSchema = z.object({
  email: emailSchema,
  motDePasse: z.string().min(1, "Indique ton mot de passe.").max(200),
  resterConnecte: z.boolean().default(false),
  suite: z.string().max(500).optional(),
});

export const demandeResetSchema = z.object({ email: emailSchema });

export const nouveauMotDePasseSchema = z
  .object({
    motDePasse: motDePasseSchema,
    confirmation: z.string(),
  })
  .refine((d) => d.motDePasse === d.confirmation, {
    path: ["confirmation"],
    message: "Les deux mots de passe ne sont pas identiques.",
  });

/**
 * Chemin interne sûr pour une redirection après connexion (évite les open redirects) :
 * seul validateur de destination de l'application (« suite »), à utiliser partout.
 * Refuse : une autre origine (« //evil.tld », « https://evil.tld »), un schéma (« javascript: »),
 * un antislash (que certains navigateurs lisent comme « / »), et les caractères de contrôle —
 * les navigateurs retirent tabulations et sauts de ligne des URL, « /<tab>/evil.tld » deviendrait
 * « //evil.tld ». Une valeur encodée plusieurs fois ne commence pas par « / » : elle tombe ici aussi.
 */
export function cheminSuiteSur(suite: string | undefined | null): string {
  if (!suite || /[\u0000-\u001F\u007F]/.test(suite)) return "/";
  if (!suite.startsWith("/") || suite.startsWith("//") || suite.includes("\\")) return "/";
  return suite;
}

/**
 * **Se connecter dépose à l'accueil** — sauf si la page demandée avant la connexion portait une
 * intention précise, auquel cas on y va.
 *
 * Signalé par. Ce n'était pas une panne : le middleware garde la page demandée (`?suite=`, plus un
 * cookie de 30 min) pour ne pas la perdre quand la personne passe par sa boîte mail, et la rend
 * après la connexion. Sur une application installée, la page rendue est simplement **celle qui
 * était ouverte la dernière fois** — souvent « Mon profil », parce que c'est de là qu'on prend
 * l'espace admin. Reprendre là où la session est morte a l'air attentionné et ne sert à rien : il
 * n'y a que quatre écrans, et ce qu'on veut en ouvrant l'application, c'est le compte rendu.
 *
 * Ce qui reste honoré, parce qu'on n'y va pas par hasard :
 *  - **une adresse qui porte des paramètres** — le « Je viens » d'un email de rappel
 *    (`/seances?seance=…&reponse=present`) doit arriver sur la séance, pas sur l'accueil ;
 *  - **une adresse à plus d'un niveau** — un événement partagé (`/evenements/<id>`), un écran
 *    d'administration (`/admin/membres`) : quelqu'un a cliqué un lien précis.
 *
 * Tout le reste — `/profil`, `/planning`, `/seances`, `/ateliers`, `/gestion` — c'est un écran
 * qu'on rouvre, pas une destination : l'accueil.
 *
 * **Où cette règle s'applique** : aux deux portes d'entrée (`seConnecter`, `connexionParInvitation`),
 * sur ce que rend `destinationRetour` — c'est-à-dire sur la mémoire du middleware. Les redirections
 * que l'application se donne à elle-même n'y passent pas : la fin du parcours d'activation mène bien
 * à `/admin`, et le détour par les codes de secours revient bien où il allait.
 */
export function destinationApresConnexion(suite: string | undefined | null): string {
  const chemin = cheminSuiteSur(suite);
  if (chemin === "/") return "/";
  const [sansParametres, parametres] = chemin.split("?");
  if (parametres) return chemin;
  return sansParametres.split("/").filter(Boolean).length > 1 ? chemin : "/";
}
