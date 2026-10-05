import { cache } from "react";
import { z } from "zod";
import { estThemeConnu, THEME_DEFAUT, type ThemeId } from "./themes";
import { ECU_LIVRE, LOGO_LIVRE, PART_EFFECTIF_LIVREE, SIGLE_LIVRE, SUFFIXE_LIVRE } from "./constants";
import { CLES, getSetting, setSetting } from "./settings";
import { FUSEAU_LIVRE, fuseauValide, poserFuseau } from "./fuseau";

/**
 * **L'identité du club** : son nom, son sigle, son logo, sa palette, sa part minimale d'effectif. Tout ce
 * qui, dans l'application, était taillé pour « Mon club d'AMHE » en dur passe
 * désormais par ici.
 *
 * La **part minimale de l'effectif** y est rangée pour exactement la même raison que le nom : « en
 * dessous de 4 présents, on n'ouvre pas la salle » était vrai du club pour lequel l'outil a été
 * écrit, et faux d'un club de quatre-vingts. C'est une décision de club, donc une donnée, et elle
 * se règle au même endroit que les autres — mais elle s'exprime désormais **en part de l'effectif
 * invité**, la seule forme qui s'adapte toute seule à la taille du club.
 *
 * **Pourquoi.** L'outil est né pour un club, et son nom était écrit dans le code — dans les
 * constantes, dans le manifeste PWA, dans les emails, dans les embeds Discord, dans les images
 * d'aperçu. Un second club ne pouvait pas l'installer sans repasser sur vingt fichiers. Le nom du
 * club est une **donnée**, pas une constante de compilation : il vit en base, il se change dans
 * l'espace admin, et il n'y a plus qu'un endroit à lire.
 *
 * **Trois sources, dans cet ordre** :
 *   1. la table `Setting` (clé `identite`), écrite par l'écran *Identité* de l'espace admin ;
 *   2. les variables d'environnement `CLUB_NOM` / `CLUB_SIGLE`, qui donnent son nom à une instance
 *      **au premier démarrage**, avant que personne ait ouvert l'écran de réglage — c'est ce qui
 *      permet de déployer l'image sans se connecter pour la nommer ;
 *   3. le nom livré par défaut, « HEMA Organizer » : neutre, valable pour n'importe quel club
 *      d'AMHE, et c'est celui que voit quelqu'un qui vient d'installer l'outil.
 *
 * Aucune de ces trois sources ne peut manquer : `resoudreIdentite` renvoie toujours une identité
 * complète, ce qui évite à chaque appelant d'avoir un repli à lui (et donc d'en avoir un différent).
 */

/**
 * L'identité livrée avec le code : **HEMA Organizer**, sans nom de club.
 *
 * *HEMA* (Historical European Martial Arts) est le nom international de l'AMHE : c'est le mot que
 * cherche un club qui découvre l'outil, quelle que soit sa langue. Le champ `club` est **vide** à
 * dessein — tant que personne n'a dit de quel club il s'agit, l'application ne prétend pas le
 * savoir, et n'affiche que son propre nom.
 */
export const IDENTITE_LIVREE = {
  club: "",
  sigle: SIGLE_LIVRE,
  /** Fixe : voir `Identite.suffixe`. */
  suffixe: SUFFIXE_LIVRE,
  theme: THEME_DEFAUT,
  marque: null,
  logoUrl: null,
  ecuUrl: null,
  partEffectifMin: PART_EFFECTIF_LIVREE,
  fuseau: FUSEAU_LIVRE,
} as const;

/**
 * Les fichiers livrés dans `public/`, servis tant qu'aucun logo n'a été déposé.
 *
 * Réexportés depuis `constants.ts`, où ils vivent : un composant client a besoin de ce repli, et il
 * ne peut pas importer ce module-ci (voir le commentaire là-bas).
 */
export { ECU_LIVRE, LOGO_LIVRE };

/** Ce qui est réglable, tel qu'il est écrit en base (tout est facultatif : un réglage absent = valeur livrée). */
export type IdentiteReglee = {
  club?: string;
  sigle?: string;
  theme?: ThemeId;
  marque?: string | null;
  logoUrl?: string | null;
  ecuUrl?: string | null;
  partEffectifMin?: number;
  fuseau?: string;
};

/** L'identité complète, telle que la lisent les écrans, les emails et les notifications. */
export type Identite = {
  /** Nom de l'association, en entier (« Mon club d'AMHE »). Peut être vide. */
  club: string;
  /** Sigle, celui de l'en-tête sur un téléphone étroit (« HEMA »). Jamais vide. */
  sigle: string;
  /**
   * Le mot qui suit le sigle : **toujours « Organizer »**, et ce n'est pas un réglage.
   *
   * *Organizer* est le nom de l'outil ; ce qui change d'un club à l'autre, c'est le sigle qui le
   * précède. Le champ reste dans le type parce que les noms composés se lisent mieux en le nommant,
   * mais il vaut `SUFFIXE_LIVRE` pour tout le monde.
   */
  suffixe: string;
  /** Nom court de l'application : « HEMA Organizer ». Titre des onglets, du manifeste, des emails. */
  nomCourt: string;
  /** Nom long : « Mon club d'AMHE — Organizer », ou le nom court si le club est vide. */
  nomLong: string;
  /**
   * Nom à employer pour **désigner le club** : son nom entier s'il est connu, sinon le nom court de
   * l'application. C'est ce qui va dans le pied des emails, l'en-tête des embeds Discord et les
   * images de partage — les endroits où l'on parle du club, pas du logiciel.
   */
  nomClub: string;
  /** Thème appliqué à qui n'a rien choisi. */
  theme: ThemeId;
  /** Couleur de marque de l'en-tête (`#rrggbb`), ou null pour celle du thème. */
  marque: string | null;
  /** Logo complet : celui qui a été déposé, sinon le fichier livré. */
  logo: string;
  /** Écu (image carrée, icônes et vignettes) : celui qui a été déposé, sinon le fichier livré. */
  ecu: string;
  /** Vrai si le logo affiché a été déposé dans l'espace admin (et non livré avec le code). */
  logoDepose: boolean;
  /** Vrai si l'écu affiché a été déposé dans l'espace admin. */
  ecuDepose: boolean;
  /**
   * **En dessous de quelle part de l'effectif invité un cours ne vaut guère la peine d'ouvrir la
   * salle**, en pourcentage.
   *
   * La même part partout : l'alerte « peu de monde » des instructeurs, le trait en pointillé de la
   * frise, le palier des jauges et le badge de remplissage des cartes de cours. Le nombre de
   * personnes s'en déduit **cours par cours**, avec l'effectif invité de sa période et le plancher
   * de quatre personnes (`seuilEnPersonnes`, `src/lib/presences.ts`) : c'est ce qui permet au même
   * réglage de servir un club de douze et un club de quatre-vingts. Toujours entre
   * {@link PART_EFFECTIF_MIN} et {@link PART_EFFECTIF_MAX}, jamais `NaN`.
   */
  partEffectifMin: number;
  /**
   * **Le fuseau horaire du club** (identifiant IANA : « Europe/Paris », « America/Montreal »). Les
   * heures des séances, « aujourd'hui », l'heure du récap et les tâches du matin s'y entendent. Réglé
   * dans *Club* ; à défaut la variable `TZ` du déploiement ; à défaut Paris. Voir `src/lib/fuseau.ts`.
   */
  fuseau: string;
};

/**
 * Longueurs maximales : le nom entre dans un en-tête de 80 px de haut et dans un sujet d'email.
 * Ce ne sont pas des limites techniques mais des limites de mise en page — mieux vaut refuser
 * la saisie que laisser un nom couper la barre en deux.
 */
export const CLUB_MAX = 80;
export const SIGLE_MAX = 12;

/**
 * **Bornes de la part minimale, en pourcentage de l'effectif invité.**
 *
 * **5 % au plus bas** : en dessous, la part ne décide plus de rien — le plancher de quatre personnes
 * (`SEUIL_PLANCHER`) l'emporterait dans tout club de moins de quatre-vingts, et le bureau croirait
 * avoir réglé quelque chose qui ne s'applique jamais. Régler moins, c'est vouloir éteindre l'alerte,
 * ce qui se fait dans l'écran des notifications, pas ici.
 *
 * **50 % au plus haut** : au-delà, il faudrait plus de la moitié du club à chaque cours pour que
 * l'application le juge suffisant — aucun club ne remplit ça toutes les semaines, l'alerte « peu de
 * monde » ne s'éteindrait jamais et cesserait d'être lue.
 */
export const PART_EFFECTIF_MIN = 5;
export const PART_EFFECTIF_MAX = 50;

/**
 * Une part utilisable : entier, dans les bornes. Tout le reste — une décimale, un zéro, une valeur
 * écrite à la main en base — retombe sur la valeur livrée plutôt que de fausser tous les paliers.
 *
 * **Un pourcentage entier**, et pas 20,5 % : la part se convertit de toute façon en personnes
 * entières, et un dixième de pourcent ne déplace le seuil d'aucun club de moins de mille membres.
 */
function partUtilisable(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= PART_EFFECTIF_MIN && n <= PART_EFFECTIF_MAX;
}

/** Une couleur `#rrggbb` — la seule forme acceptée : c'est celle qu'écrit un sélecteur de couleur. */
export const COULEUR_HEX = /^#[0-9a-f]{6}$/i;

/**
 * Une URL d'image déposée : le chemin servi par `/api/affiche/<sha256>.<ext>`, et rien d'autre.
 *
 * **Ce motif est une frontière de sécurité, pas une commodité.** Ces deux valeurs finissent en
 * `src` d'une balise `<img>`, dans le manifeste PWA et dans des emails HTML : accepter une URL
 * quelconque laisserait un administrateur pointer l'icône de l'application vers un serveur tiers
 * (fuite de l'IP de chaque membre à chaque chargement), ou glisser un `javascript:` dans un
 * gabarit. Le seul emplacement autorisé est le nôtre, et il est adressé par contenu.
 */
export const URL_IMAGE_DEPOSEE = /^\/api\/affiche\/[a-f0-9]{64}\.(jpg|png|webp)$/;

/**
 * Schéma de ce qui peut être écrit en base (une valeur hors normes est ignorée, pas fatale).
 *
 * **La reprise de l'ancien réglage tient dans cette phrase** : le champ `seuilEffectif` d'hier — un
 * nombre de personnes — n'est plus déclaré, donc Zod le laisse tomber à la lecture comme à la
 * prochaine écriture. Il n'y a **rien à convertir, et rien d'honnête à convertir** : « 4 personnes »
 * ne dit pas sur quel effectif il portait, et le réglage n'a jamais su combien le club comptait
 * d'invités. On repart donc de la part livrée (20 %) — ce qui, grâce au plancher de quatre
 * personnes, redonne **exactement** le comportement d'hier à tout club de vingt invités ou moins.
 */
const schemaReglee = z
  .object({
    club: z.string().trim().max(CLUB_MAX),
    sigle: z.string().trim().max(SIGLE_MAX),
    theme: z.string().refine(estThemeConnu),
    marque: z.string().regex(COULEUR_HEX).nullable(),
    logoUrl: z.string().regex(URL_IMAGE_DEPOSEE).nullable(),
    ecuUrl: z.string().regex(URL_IMAGE_DEPOSEE).nullable(),
    partEffectifMin: z.number().int().min(PART_EFFECTIF_MIN).max(PART_EFFECTIF_MAX),
    fuseau: z.string().refine(fuseauValide),
  })
  .partial();

/**
 * Identité complète à partir de ce qui est réglé et de ce que dit l'environnement.
 *
 * **Fonction pure** : c'est elle que vérifient les tests, sans base ni variables d'environnement.
 * Les noms composés (`nomCourt`, `nomLong`, `nomClub`) sont **calculés ici et nulle part ailleurs** :
 * c'était le vrai défaut de l'ancienne version, où trois constantes disaient trois fois le même
 * nom et pouvaient diverger à la première modification.
 */
export function resoudreIdentite(reglee: IdentiteReglee | null | undefined, depuisEnv?: { club?: string; sigle?: string; fuseau?: string }): Identite {
  const r = reglee ?? {};
  // Un réglage vide en base (champ effacé) doit retomber sur l'environnement puis sur le livré :
  // d'où `||` et non `??`, la chaîne vide n'étant pas une réponse.
  const club = (r.club ?? "").trim() || (depuisEnv?.club ?? "").trim();
  const sigle = (r.sigle ?? "").trim() || (depuisEnv?.sigle ?? "").trim() || IDENTITE_LIVREE.sigle;
  // Jamais réglable : « Organizer » est le nom de l'outil, pas celui du club.
  const suffixe = IDENTITE_LIVREE.suffixe;
  const nomCourt = [sigle, suffixe].filter(Boolean).join(" ");
  const logoUrl = URL_IMAGE_DEPOSEE.test(r.logoUrl ?? "") ? (r.logoUrl as string) : null;
  const ecuUrl = URL_IMAGE_DEPOSEE.test(r.ecuUrl ?? "") ? (r.ecuUrl as string) : null;
  return {
    club,
    sigle,
    suffixe,
    nomCourt,
    // Le nom long ne répète pas le sigle : « Mon club d'AMHE — Organizer », pas
    // « … — HEMA Organizer ». Sans nom de club, il n'y a rien à allonger.
    nomLong: club ? `${club} — ${suffixe}` : nomCourt,
    nomClub: club || nomCourt,
    theme: estThemeConnu(r.theme) ? r.theme : IDENTITE_LIVREE.theme,
    marque: COULEUR_HEX.test(r.marque ?? "") ? (r.marque as string).toLowerCase() : null,
    logo: logoUrl ?? LOGO_LIVRE,
    ecu: ecuUrl ?? ECU_LIVRE,
    logoDepose: logoUrl !== null,
    ecuDepose: ecuUrl !== null,
    partEffectifMin: partUtilisable(r.partEffectifMin) ? r.partEffectifMin : IDENTITE_LIVREE.partEffectifMin,
    fuseau: fuseauValide(r.fuseau) ? r.fuseau : fuseauValide(depuisEnv?.fuseau) ? depuisEnv.fuseau : IDENTITE_LIVREE.fuseau,
  };
}

/** Ce que l'environnement propose comme nom d'instance au premier démarrage. */
function depuisEnv(): { club?: string; sigle?: string; fuseau?: string } {
  // Lecture directe de `process.env` plutôt que `env()` : l'identité est lue par le manifeste et par
  // la mise en page racine, y compris sur les pages publiques, et une configuration incomplète ne
  // doit pas faire tomber l'écran d'accueil pour un nom de club.
  // `TZ` est la variable du compose de production : le fuseau de la machine devient celui du club tant
  // que le bureau n'en a pas réglé un autre.
  return { club: process.env.CLUB_NOM?.trim(), sigle: process.env.CLUB_SIGLE?.trim(), fuseau: process.env.TZ?.trim() };
}

/** Ce qui est écrit en base, nettoyé ; `{}` si rien n'est réglé ou si la valeur est illisible. */
export async function identiteReglee(): Promise<IdentiteReglee> {
  const brut = await getSetting(CLES.identite);
  if (!brut) return {};
  try {
    const analyse = schemaReglee.safeParse(JSON.parse(brut));
    return analyse.success ? analyse.data : {};
  } catch {
    // JSON abîmé : on repart du livré plutôt que de casser toutes les pages.
    return {};
  }
}

/**
 * **L'identité du club.** Mise en cache pour la durée de la requête (React `cache`) : la mise en
 * page racine, le manifeste, l'en-tête et le pied de page la demandent chacun, et cela ne fait
 * qu'une lecture.
 */
export const identite = cache(async (): Promise<Identite> => {
  return resoudreIdentite(await identiteReglee(), depuisEnv());
});

/**
 * **Lit le fuseau du club et le pose côté serveur** (`poserFuseau`). Appelé au démarrage
 * (`src/instrumentation.ts`), hors de toute requête : d'où la lecture directe, sans le cache de
 * requête de `identite`.
 */
export async function appliquerFuseauDuClub(): Promise<string> {
  const { fuseau } = resoudreIdentite(await identiteReglee(), depuisEnv());
  poserFuseau(fuseau);
  return fuseau;
}

/**
 * Enregistre un **changement partiel** : les champs absents gardent leur valeur.
 *
 * On relit avant d'écrire plutôt que d'écrire le tout : l'écran d'identité envoie les noms et les
 * couleurs, le dépôt d'un logo n'envoie que l'URL du logo, et les deux ne doivent pas s'effacer
 * l'un l'autre.
 */
export async function enregistrerIdentite(patch: IdentiteReglee): Promise<void> {
  const fusion = { ...(await identiteReglee()), ...patch };
  await setSetting(CLES.identite, JSON.stringify(schemaReglee.parse(fusion)));
}

/**
 * Les images déposées que l'identité **référence** : la purge des fichiers orphelins doit les
 * épargner. Sans cela, le logo du club disparaîtrait au bout de 24 h, à la première tâche
 * d'entretien — un logo n'est référencé par aucun événement.
 */
export async function imagesIdentite(): Promise<string[]> {
  const r = await identiteReglee();
  return [r.logoUrl, r.ecuUrl].filter((u): u is string => typeof u === "string" && URL_IMAGE_DEPOSEE.test(u));
}
