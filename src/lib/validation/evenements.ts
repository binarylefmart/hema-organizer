import { z } from "zod";
import { isHHMM, isIsoDate } from "@/lib/dates";
import { dateIsoSchema } from "./gestion";

/**
 * Validation des événements du club (stages, tournois, démonstrations).
 *
 * Tout vient d'un formulaire rempli par l'encadrement : on ne fait confiance à rien.
 * - les dates et heures suivent la convention des séances (`isIsoDate` / `isHHMM` de src/lib/dates.ts) ;
 * - les liens ne peuvent être que `http(s)` — `javascript:` et `data:` sont refusés, ce sont les deux
 *   schémas qui transforment un lien affiché en exécution de code chez la personne qui clique ;
 * - la description est du **texte brut** limité à 600 caractères : elle s'affiche telle quelle
 *   (React échappe automatiquement le texte qu'on lui passe ; hors React — email, Discord — passer
 *   par `echapperTexte`, jamais de HTML construit à la main avec une description).
 */

/** Longueurs maximales (mêmes limites côté champ de saisie et côté serveur). */
export const NOM_MAX = 120;
/**
 * Une annonce se lit d'un coup d'oeil sur un téléphone : 600 caractères, la longueur d'un post,
 * pas d'un dossier. Le détail (programme, tarifs, règlement) vit au bout du lien d'inscription
 * ou de la publication d'origine. L'écran affiche le compte restant pendant la saisie.
 */
export const DESCRIPTION_MAX = 600;
export const LIEU_MAX = 120;
export const ORGANISATEUR_MAX = 120;
/**
 * Le prix est du **texte libre borné**, pas un montant numérique.
 *
 * Un club annonce « 25 € », « 20 € les deux jours », « prix libre », « 25 € + 5 € de location » :
 * un nombre obligerait à choisir une devise et un format, et rendrait ces cas inexprimables. La
 * borne est courte exprès — c'est une étiquette qui s'affiche sur une carte, pas un paragraphe :
 * le détail des tarifs vit dans la description ou au bout du lien d'inscription.
 *
 * Vide veut dire **gratuit**, et c'est l'affichage qui le formule : la base garde `""`. Ne jamais
 * y écrire le mot « Gratuit », sinon on ne distingue plus un tarif saisi d'un champ laissé vide.
 *
 * `prixAdherent` (tarif réduit pour les membres du club) partage cette borne et cette fabrique,
 * mais **pas la règle du champ vide**, et la différence se perd de vue en six mois :
 * - `prix` vide **dit quelque chose** : l'événement est gratuit, l'écran l'écrit noir sur blanc ;
 * - `prixAdherent` vide **ne dit rien** : il n'y a pas de tarif adhérent pour cet événement, et
 *   l'écran n'affiche aucune ligne — surtout pas « gratuit pour les adhérents », qui serait une
 *   promesse que personne n'a faite.
 * Deux champs de même forme, deux lectures opposées du vide : c'est voulu, pas un oubli.
 */
export const PRIX_MAX = 60;

/**
 * La durée, elle, est **un nombre et une unité** : « 2 jours », « 1 semaine », « 1 demi-journée ».
 *
 * C'est ce que le formulaire propose (un champ chiffre + une liste déroulante), et le stocker ainsi
 * plutôt qu'en texte libre a deux avantages : l'accord en nombre est calculé à l'affichage (« 1 jour »
 * / « 2 jours ») au lieu d'être laissé à la frappe de chacun, et une durée reste comparable si on veut
 * un jour trier ou filtrer dessus — ce qu'une chaîne « 2 jours » n'aurait jamais permis.
 *
 * Les unités couvrent ce qu'annonce un club d'AMHE : une demi-journée d'initiation, un stage d'un
 * ou deux jours, un séjour d'une semaine, un cycle de quelques mois. Ajouter une unité, c'est
 * ajouter une entrée ici — la base garde la **clé** (« demi-journee »), jamais le libellé affiché,
 * qui reste à l'interface : une clé déjà écrite en base ne doit donc jamais être renommée.
 */
export const UNITES_DUREE = ["demi-journee", "jour", "semaine", "mois"] as const;
export const DUREE_NOMBRE_MAX = 99;
export const ADRESSE_MAX = 200;
export const LIEN_MAX = 500;

// Caractères de contrôle : interdits dans un lien (voir `lienSur`) et retirés des textes saisis.
const CONTROLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Un lien sûr : vide (le champ est facultatif) ou une URL absolue en http(s). */
export function lienSur(valeur: string): boolean {
  if (valeur === "") return true;
  // Les navigateurs retirent espaces, tabulations et sauts de ligne des URL : « java\nscript:… »
  // redeviendrait « javascript:… ». On refuse donc tout blanc et tout caractère de contrôle
  // avant même de lire le schéma de l'URL.
  if (/\s/.test(valeur) || new RegExp(CONTROLE.source).test(valeur)) return false;
  let url: URL;
  try {
    url = new URL(valeur);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/** Champ lien facultatif : vide ou http(s). */
export const lienSchema = z
  .string()
  .trim()
  .max(LIEN_MAX, `${LIEN_MAX} caractères maximum.`)
  .refine(lienSur, "Indique un lien commençant par http:// ou https://");

/**
 * Nom d'une affiche déposée dans l'application : `/api/affiche/<sha256>.<extension>`.
 * Même expression que `lireAffiche` (src/lib/affiches.ts) — un chemin interne, pas une URL.
 */
const AFFICHE_DEPOSEE = /^\/api\/affiche\/[a-f0-9]{64}\.(jpg|png|webp)$/;

/**
 * L'affiche accepte **deux formes**, et c'est tout l'intérêt du champ : une adresse http(s) pour
 * une image déjà en ligne, ou le chemin interne d'un fichier **déposé** par glisser-déposer.
 * Le refuser revenait à casser le dépôt d'affiche au moment d'enregistrer l'annonce — le formulaire
 * répondait « Indique un lien commençant par http:// » sur une image qu'il venait lui-même de ranger.
 */
export const afficheSchema = z
  .string()
  .trim()
  .max(LIEN_MAX, `${LIEN_MAX} caractères maximum.`)
  .refine((v) => v === "" || AFFICHE_DEPOSEE.test(v) || lienSur(v), "Dépose une image, ou indique un lien commençant par http:// ou https://");

/**
 * **Une adresse d'affiche est aussi vérifiée comme ADRESSE, pas seulement comme lien** — et la
 * vérification vit dans l'action, pas ici.
 *
 * `/api/image` accepte de rapatrier toute adresse **présente en base** : c'est sa liste blanche. Ce champ
 * n'y entrait qu'avec un contrôle de schéma, donc tout titulaire de `evenements.edit` (un INSTRUCTEUR,
 * entré par simple lien personnel, sans élévation) pouvait y écrire une adresse interne ou un hôte et un
 * port quelconques — même dans un brouillon —, puis faire sonder la cible **depuis l'IP du club**, avec le
 * seau du relais (300 par quart d'heure) au lieu de celui de l'aperçu de lien (20), qui est le chemin
 * prévu pour ça.
 *
 * **Pourquoi pas dans le schéma, qui serait l'endroit naturel :** la validation d'adresse vit dans
 * `src/lib/lien-apercu.ts`, qui importe `node:dns`. Ce fichier-ci est un module de validation, donc
 * destiné à être lu du navigateur comme du serveur : l'y importer ferait entrer `node:dns` dans le
 * bundle client dès le jour où un formulaire importerait le schéma, et ferait échouer `npm run build`
 * sans que ni `tsc` ni les tests ne le voient (piège documenté dans `CLAUDE.md`). La vérification est
 * donc appelée depuis `src/actions/evenements.ts`, qui est déjà serveur-seul — et c'est de toute façon
 * une **politique**, pas une règle de forme.
 *
 * La résolution DNS reste en aval (`verifierHote`) : elle est asynchrone, et une adresse peut changer de
 * résolution entre l'écriture et la lecture.
 */
export const MESSAGE_AFFICHE_ADRESSE_REFUSEE =
  "Cette adresse d'image ne peut pas être utilisée : indique une image accessible publiquement, ou dépose le fichier.";

/** Une valeur d'affiche à éprouver comme adresse ? (Un fichier déposé ou un champ vide : non.) */
export function afficheAVerifier(valeur: string): boolean {
  return valeur !== "" && !AFFICHE_DEPOSEE.test(valeur);
}

/** Texte libre : contrôle de longueur et retrait des caractères de contrôle (sauts de ligne gardés). */
const texte = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(CONTROLE, "").trim())
    .pipe(z.string().max(max, `${max} caractères maximum.`));

/** Heure facultative : "" (non renseignée, enregistrée en `null`) ou "HH:MM". */
const heureFacultativeSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || isHHMM(v), "Heure invalide (HH:MM attendu).")
  .transform((v) => (v === "" ? null : v));

/**
 * Nombre de la durée : `""` (non précisée, enregistrée en `null`) ou un entier de 1 à 99.
 *
 * On filtre les chiffres **avant** de convertir : `Number()` seul aurait accepté « 2.5 » (→ 2,5) et
 * « -1 », et rendu `NaN` sur « deux » — trois valeurs qui n'ont rien à faire en base. Une durée de
 * zéro n'est pas une durée, d'où la borne basse à 1 : pour « pas de durée », on laisse le champ vide.
 */
const dureeNombreSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d+$/.test(v), `Indique un nombre entier entre 1 et ${DUREE_NOMBRE_MAX}, ou laisse vide.`)
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || (v >= 1 && v <= DUREE_NOMBRE_MAX), `Indique un nombre entier entre 1 et ${DUREE_NOMBRE_MAX}, ou laisse vide.`);

/**
 * Unité de la durée : une des clés de `UNITES_DUREE`, avec repli silencieux sur « jour ».
 *
 * Le repli est volontaire et ne concerne que ce champ : l'unité vient d'une liste déroulante, donc
 * d'un choix contraint. Une valeur absente ou inconnue signale un navigateur exotique ou un
 * formulaire bricolé, pas une faute de saisie à montrer à la personne — faire échouer tout
 * l'enregistrement pour ça serait disproportionné. Mais on n'écrit pas non plus n'importe quoi en
 * base : `catch` remplace la valeur inconnue par la seule unité sûre, jamais ne la laisse passer.
 * (Sans nombre, l'unité ne s'affiche pas : sa valeur est alors sans importance.)
 */
const dureeUniteSchema = z.enum(UNITES_DUREE).catch("jour");

/** Date facultative : "" (enregistrée en `null`) ou "AAAA-MM-JJ". */
const dateFacultativeSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || isIsoDate(v), "Date invalide (AAAA-MM-JJ attendu).")
  .transform((v) => (v === "" ? null : v));

/**
 * Événement complet. Les champs facultatifs arrivent vides du formulaire et repartent en `null`
 * (colonnes nullables : heures et date de fin) ou en `""` (colonnes à valeur par défaut), jamais
 * en `undefined` : la base n'a ainsi qu'une seule façon de dire « non renseigné ».
 */
export const evenementSchema = z
  .object({
    nom: texte(NOM_MAX).pipe(z.string().min(2, "Donne un nom à l'événement (2 caractères minimum).")),
    description: texte(DESCRIPTION_MAX),
    dateDebut: dateIsoSchema,
    heureDebut: heureFacultativeSchema,
    dateFin: dateFacultativeSchema,
    heureFin: heureFacultativeSchema,
    lieu: texte(LIEU_MAX),
    adresse: texte(ADRESSE_MAX),
    organisateur: texte(ORGANISATEUR_MAX),
    prix: texte(PRIX_MAX),
    prixAdherent: texte(PRIX_MAX),
    dureeNombre: dureeNombreSchema,
    dureeUnite: dureeUniteSchema,
    lienInscription: lienSchema,
    lienSource: lienSchema,
    imageUrl: afficheSchema,
    publie: z.boolean(),
  })
  .refine((e) => !e.dateFin || e.dateFin >= e.dateDebut, {
    path: ["dateFin"],
    message: "La date de fin ne peut pas précéder la date de début.",
  })
  // Sur une seule journée, l'heure de fin doit suivre l'heure de début ;
  // sur plusieurs jours, « 9h00 → 17h00 le lendemain » est parfaitement normal.
  .refine((e) => !(e.heureDebut && e.heureFin && (e.dateFin ?? e.dateDebut) === e.dateDebut) || e.heureFin > e.heureDebut, {
    path: ["heureFin"],
    message: "L'heure de fin doit suivre l'heure de début.",
  });
