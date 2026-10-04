import { formatDateLongue, formatHeure, formatHoraire, joursAvant, minuscule } from "@/lib/dates";

/**
 * Un événement tel que le fil a besoin de le lire.
 *
 * Volontairement plus permissif que le modèle (tout ce qui peut manquer est `| null`) : le fil
 * accepte ainsi les lignes de la base sans dépendre du détail de leur nullabilité, et un champ
 * qui deviendrait facultatif plus tard ne casserait pas l'affichage.
 */
export type EvenementAffiche = {
  id: string;
  nom: string;
  description?: string | null;
  dateDebut: string;
  dateFin?: string | null;
  heureDebut?: string | null;
  heureFin?: string | null;
  lieu?: string | null;
  adresse?: string | null;
  /** Club ou association qui organise — ce n'est pas toujours le nôtre */
  organisateur?: string | null;
  /** Tarif en texte libre (« 25 € ») ; vide = gratuit */
  prix?: string | null;
  /** Tarif réduit pour les adhérents ; vide = il n'y en a pas, et on n'en dit rien */
  prixAdherent?: string | null;
  /** Nombre d'unités de durée (« 2 » de « 2 jours ») ; null = durée non précisée */
  dureeNombre?: number | null;
  /** Unité de la durée : « demi-journee », « jour » ou « semaine » */
  dureeUnite?: string | null;
  lienInscription?: string | null;
  lienSource?: string | null;
  imageUrl?: string | null;
  publie?: boolean | null;
};

/**
 * La date en toutes lettres. Un événement sur plusieurs jours (un stage du samedi au dimanche)
 * se dit « Du … au … » : les deux dates entières, sans abréviation — c'est ce qu'on recopie dans
 * son agenda.
 */
export function dateEvenement(debut: string, fin?: string | null): string {
  const d = formatDateLongue(debut);
  if (!fin || fin === debut) return d;
  const f = formatDateLongue(fin);
  return `Du ${minuscule(d)} au ${minuscule(f)}`;
}

/** « 10h00 à 18h00 », « À partir de 14h00 », « Jusqu'à 17h00 » — ou rien si l'horaire n'est pas connu. */
export function horaireEvenement(debut?: string | null, fin?: string | null): string | null {
  if (debut && fin) return formatHoraire(debut, fin);
  if (debut) return `À partir de ${formatHeure(debut)}`;
  if (fin) return `Jusqu'à ${formatHeure(fin)}`;
  return null;
}

/**
 * Le tarif tel qu'on l'annonce — **la seule formulation** du prix dans l'application : la carte,
 * la fiche et la page publique appellent toutes celle-ci et disent donc la même chose.
 *
 * Les deux champs ont des règles **opposées**, et c'est voulu :
 * - `prix` vide veut dire **gratuit**, et on l'écrit : « on ne sait pas » et « c'est gratuit » ne
 *   sont pas la même réponse pour qui hésite à s'inscrire ;
 * - `prixAdherent` vide ne veut rien dire du tout : il n'y a pas de tarif réduit, on n'ajoute donc
 *   ni ligne, ni tiret, ni parenthèse vide.
 *
 * Un événement gratuit tait son tarif adhérent : un tarif réduit est **forcément moins cher que le
 * plein tarif**, et rien n'est moins cher que gratuit. La ligne dirait le contraire de ce qu'elle
 * veut dire. Le champ reste en base, il ressortira le jour où un prix sera saisi.
 *
 * C'est une règle d'**affichage**, jamais de saisie : les prix sont du texte libre (« 15 € / 10 € »,
 * « prix libre »), on ne sait pas les comparer, et un formulaire qui refuserait une saisie parce
 * qu'il croit y lire un nombre ferait bien plus de dégâts que le cas tordu qu'il éviterait.
 *
 * Le mot « adhérents » est écrit en toutes lettres : la ligne voyage aussi sans son icône (vignette
 * d'aperçu des réseaux, message WhatsApp), où un « / 35 € » seul serait illisible.
 */
export function libellePrix(prix?: string | null, prixAdherent?: string | null): string {
  const plein = prix?.trim();
  if (!plein) return "Gratuit";
  const adherent = prixAdherent?.trim();
  return adherent ? `${plein} · ${adherent} pour les adhérents` : plein;
}

/**
 * Les unités de durée proposées à la saisie, et l'accord de chacune.
 *
 * Une liste courte plutôt qu'un texte libre : c'est ce que le club demande (« un champ chiffre,
 * une unité à choisir »), et c'est aussi ce qui permet d'écrire « 1 jour » / « 2 jours » sans que
 * personne n'ait à y penser. Le libellé entre parenthèses de la liste déroulante (« jour(s) »)
 * annonce justement que l'accord se fera tout seul.
 */
export const UNITES_DUREE_CHOIX = [
  { valeur: "demi-journee", libelle: "demi-journée(s)", singulier: "demi-journée", pluriel: "demi-journées" },
  { valeur: "jour", libelle: "jour(s)", singulier: "jour", pluriel: "jours" },
  { valeur: "semaine", libelle: "semaine(s)", singulier: "semaine", pluriel: "semaines" },
  // « mois » est invariable : « 1 mois », « 2 mois ». D'où un pluriel écrit ici plutôt qu'un « s »
  // ajouté à la volée — chaque unité porte ses deux formes, aucune règle à retenir ailleurs.
  { valeur: "mois", libelle: "mois", singulier: "mois", pluriel: "mois" },
] as const;

/** Unité de repli quand la valeur stockée n'est pas reconnue : le jour, la plus courante. */
const UNITE_PAR_DEFAUT = UNITES_DUREE_CHOIX[1];

/**
 * La durée annoncée, accordée : « 1 demi-journée », « 2 demi-journées », « 1 jour », « 3 semaines ».
 *
 * Renvoie `""` quand le nombre n'est pas renseigné — contrairement au prix, une durée absente ne
 * veut rien dire de particulier : on n'écrit pas « Durée non précisée », qui n'apprendrait rien.
 *
 * **Seul endroit où l'accord se décide** : la carte, la fiche et la page publique appellent toutes
 * cette fonction, et disent donc exactement la même chose.
 */
export function libelleDuree(nombre?: number | null, unite?: string | null): string {
  if (nombre == null || !Number.isFinite(nombre) || nombre < 1) return "";
  const u = UNITES_DUREE_CHOIX.find((x) => x.valeur === unite) ?? UNITE_PAR_DEFAUT;
  return `${nombre} ${nombre > 1 ? u.pluriel : u.singulier}`;
}

/** « Aujourd'hui », « Demain », « Dans 4 jours » — au-delà d'une semaine, la date suffit. */
export function proximite(aujourdHui: string, date: string): string | null {
  const jours = joursAvant(aujourdHui, date);
  if (jours < 0 || jours >= 7) return null;
  if (jours === 0) return "Aujourd'hui";
  if (jours === 1) return "Demain";
  return `Dans ${jours} jours`;
}

/**
 * Où charger une affiche. Une image du club (chemin interne) se sert telle quelle ; une image
 * hébergée ailleurs passe par le relais `/api/image`, qui la rapatrie côté serveur — la politique
 * de sécurité de l'application n'autorise que sa propre origine en source d'images, et aucun
 * navigateur de membre n'a à appeler le serveur d'un tiers (voir src/app/api/image/route.ts).
 */
export function sourceImage(src: string): string {
  return src.startsWith("/") ? src : `/api/image?url=${encodeURIComponent(src)}`;
}
