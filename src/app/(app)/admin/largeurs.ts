/**
 * **Quels écrans de l'espace admin occupent toute la largeur, et pourquoi chacun** — la règle, dans
 * un module pur, lisible du navigateur comme d'un test.
 *
 * Elle vivait dans le layout, sous forme d'une liste passée en props à `LargeurEspaceAdmin`. Deux
 * raisons de l'en sortir :
 *
 *  1. **les fiches ne sont pas des chemins fixes.** La fiche d'une période (`/admin/periodes/<id>`)
 *     mesurait **4 646 px de haut** à 1 920 px, pour 736 px de contenu : c'est l'écran le plus long
 *     de l'application, et aucune liste de chemins exacts ne peut le nommer. Il faut une **règle**,
 *     donc une fonction — et une fonction ne se passe pas en props d'un composant serveur à un
 *     composant client (seules des valeurs sérialisables traversent la frontière) ;
 *  2. **une règle se teste mieux qu'une chaîne.** Un test lisait la source du layout pour y chercher
 *     des noms d'écrans ; il peut maintenant poser la question qui compte — « cette adresse-là est
 *     elle large ? » — y compris pour une adresse qui n'existe nulle part dans la source.
 *
 * **Le principe du dossier reste celui-ci : un tableau s'élargit, une carte non** (`CLAUDE.md`). Ce
 * module ne décide donc pas « admin = large » : il nomme, un par un, les écrans dont le contenu a des
 * **colonnes** ou **deux piles indépendantes**, et laisse tous les autres dans la colonne de lecture.
 *
 * **Et il y a deux paliers, pas un**. La question qui les sépare n'est pas « tableau ou cartes ? »
 * mais **« ce contenu sait-il faire quelque chose de la place avant 1 536 px ? »** — et elle se
 * tranche écran par écran, à la mesure :
 *
 *  - **oui → large dès 1 024 px** (`PLEINE_LARGEUR`). Un tableau y déplie ses colonnes ; la fiche
 *    d'une période y découpe ses cartes en interne (ses grilles mesurent leur conteneur), et elle est
 *    mesurée **4 078 px à 1 280 px en page large contre 4 669 en colonne de lecture** — attendre
 *    1 536 lui coûtait donc 591 px sur un portable ;
 *  - **non → large seulement à 1 536 px** (`PLEINE_LARGEUR_2XL`), le palier de `DeuxPiles`. Une page
 *    large d'une seule pile donne alors exactement ce que la doctrine refuse : à 1 280 px, les zones
 *    de texte de « Thèmes et lieux » mesuraient **1 190 px**.
 *
 * Les deux paliers du dépôt existaient déjà (`PLEINE_LARGEUR`, `PLEINE_LARGEUR_2XL`) ; ce qui
 * manquait, c'était de dire **lequel** par écran — et de ne pas le déduire de la forme du contenu.
 */
import { PLEINE_LARGEUR, PLEINE_LARGEUR_2XL } from "@/components/ui/pleine-largeur";

/**
 * **Les écrans larges dès 1 024 px**, avec la raison de chacun. Un ajout ici se justifie par une
 * mesure, pas par une impression : ce qui est tronqué, ou les écrans de défilement économisés.
 */
const LARGES: readonly string[] = [
  // Journaux : des colonnes de texte long. 389 px et 168 px de texte étaient cachés à 1 920 px.
  "/admin/audit",
  "/admin/sessions",
  // Matrice notification × canal : un tableau au sens propre, six colonnes.
  "/admin/notifications",
  // Annuaire : un tableau (prénom, nom, email, rôle, état du lien, réponses).
  "/admin/membres",
  // Registre d'une séance : une ligne par personne, une liste déroulante par ligne.
  "/admin/presences",
  /*
   * Comptes admin (02/10 au soir, Delta : « l'onglet compte admin n'est pas allongé
   * dynamiquement »). Le pire cas de la journée, et il manquait à la liste du soir : à 1 920 px, la
   * colonne « Email » recevait **103 px** et déchirait `contact@club.test` sur
   * **quatre lignes**, d'où des lignes de **149 px de haut** — pendant que 1 184 px restaient vides.
   */
  "/admin/comptes",
  // Liste des périodes : un tableau de six colonnes, où « Rentrée 2026 » se pliait en deux lignes
  // dans 55 px et « Liens activés » en deux lignes d'en-tête.
  "/admin/periodes",
  /*
   * Club : large **dès 1 024 px**, et c'est une mesure qui l'a décidé (Delta, le 02/10 au soir :
   * « tu as étiré pour la fenêtre Club ? »). Rangé d'abord avec les deux écrans qui attendent
   * 1 536 px, il ne changeait **rien** à 1 280 — or à cette largeur ses champs d'identité se rangent
   * **sur deux colonnes** dans leur carte, **587 px** chacun, contre une seule colonne de **339 px**
   * dans la colonne de lecture. (Les hauteurs citées ici dans une première version ont été rendues
   * caduques le même soir par la coupure de l'écran en deux formulaires — identité d'un côté,
   * apparence de l'autre : elle s'achète en lisibilité, pas en pixels. Le palier, lui, reste le bon,
   * et c'est la largeur des champs qui le dit.)
   *
   * Ce qui le distingue de ses voisins, et c'est tout l'intérêt de mesurer écran par écran :
   * « Thèmes et lieux » n'a que des zones de texte, qui à 1 280 en page large mesureraient
   * **1 190 px** ; « À propos » n'y gagne que 16 px. Lui a des champs courts, donc des colonnes à
   * prendre.
   */
  "/admin/identite",
];

/**
 * **Les écrans larges seulement à partir de 1 536 px** : leur contenu ne sait rien faire de la place
 * avant d'avoir de quoi tenir deux piles côte à côte. Mesures d'avant/après, à 1 920 px : « Thèmes et lieux » 1 279 → 939,
 * « Club » 2 054 → 1 482, « À propos » 1 643 → 1 197.
 */
const LARGES_2XL: readonly string[] = [
  // Deux cartes strictement indépendantes : les thèmes du planning, les lieux des cours.
  "/admin/themes",
  // Cinq cartes d'étiquettes et de valeurs : ce qui décrit l'installation, puis ce qui s'ouvre
  // vers l'extérieur et se règle.
  "/admin/apropos",
];

/**
 * **Les sous-arbres larges** : tout ce qui pend de ces adresses, les fiches et leurs identifiants.
 * À n'employer que quand *tous* les enfants le méritent — sinon on nomme l'enfant dans `EXACTS`.
 */
const BRANCHES_LARGES: readonly string[] = [
  /*
   * La fiche d'une période : **7 315 px de haut sur un téléphone, 4 050 px à 1 920** avant cette
   * passe — l'écran le plus long de l'application, et celui où le bureau passe le plus de temps en
   * début de trimestre. Deux piles (coupure après « Séances » : 2 565 px à gauche, 1 680 à droite) le
   * ramènent à **2 953 px**. Elle est large **dès 1 024 px** et non à partir de 1 536, parce que ses
   * cartes savent déjà se découper en interne : mesurée à 1 280 px, 4 078 px en page large contre
   * 4 669 en colonne de lecture.
   */
  "/admin/periodes",
];

/**
 * **Les exceptions étroites, qui gagnent sur tout le reste.** Un formulaire ne s'élargit jamais : des
 * champs de 1 400 px sont exactement ce que la doctrine refuse, et c'est le défaut qu'une relecture a
 * mesuré le 02/10 au matin sur « Club ». Elles passent avant `BRANCHES`, parce qu'un sous-arbre large
 * porte presque toujours un formulaire de création.
 */
const ETROITS: readonly string[] = ["/admin/periodes/nouvelle"];

/** Les trois sorts possibles d'un écran d'administration — nommés par la **largeur**, pas par le contenu. */
export type PalierLargeur = "lecture" | "large" | "large2xl";

/** **Le palier d'un écran**, et la seule fonction qui tranche. */
export function palierLargeur(chemin: string): PalierLargeur {
  if (ETROITS.includes(chemin)) return "lecture";
  if (LARGES.includes(chemin)) return "large";
  if (LARGES_2XL.includes(chemin)) return "large2xl";
  if (BRANCHES_LARGES.some((branche) => chemin.startsWith(`${branche}/`))) return "large";
  return "lecture";
}

/** La classe que pose l'enveloppe de l'espace admin, à chaque navigation. */
export function classeLargeurAdmin(chemin: string): string {
  const palier = palierLargeur(chemin);
  return palier === "large" ? PLEINE_LARGEUR : palier === "large2xl" ? PLEINE_LARGEUR_2XL : "";
}

/** « Cet écran sort-il de la colonne de lecture ? » — la question des tests et de la doctrine. */
export function estEcranLarge(chemin: string): boolean {
  return palierLargeur(chemin) !== "lecture";
}
