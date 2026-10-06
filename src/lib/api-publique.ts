import { libelleDuree } from "@/components/evenements/libelles";
import { enParallele, type NatureElement, type Niveau } from "./constants";
import { addDays, formatDateLongue, formatHoraire, todayIso } from "./dates";
import { separerPictogramme, TITRE_ANNULATION, TITRE_EVENEMENT, TITRE_RECAP } from "./notifications/contenu";
import { dateRecap } from "./notifications/planification";
import { CANAUX_PAR_NOTIFICATION, TYPES_NOTIFICATION, type TypeNotification } from "./notifications/preferences";
import { dateEvenement, horaireEvenement, lienExterneSur, themeAffiche, type SeancePartagee } from "./partage";
import { calculerTaux } from "./presences";

/**
 * **API publique** (`GET /api/public/prochaines-seances`) : les prochains cours du club, lisibles
 * sans compte, pour le site WordPress — et pour qui voudrait les afficher ailleurs.
 *
 * Trois règles la gouvernent :
 *
 * 1. **Rien de nominatif, jamais.** Les données viennent de `src/lib/partage.ts`, qui ne lit même
 *    pas les colonnes qui porteraient un nom. Ce module n'ajoute rien : il met en forme.
 * 2. **Pas d'effectif en clair.** Le cahier des charges demande un taux ; c'est un taux qui sort,
 *    pas « 13 présents sur 18 ». Le nombre exact de personnes présentes à un cours dit quelque
 *    chose de la santé d'une association, et une page web est lue par n'importe qui, indéfiniment.
 *    Les pages de partage, elles, l'affichent : elles se donnent de la main à la main et ne sont
 *    pas indexées. Deux publics, deux niveaux de détail.
 * 3. **Une forme déjà prête à afficher.** Un thème d'affichage (« Messer (ou Dague) »), une date en
 *    toutes lettres, un horaire formaté : le site n'a pas à reproduire les règles de l'application
 *    en PHP, où elles finiraient par diverger. Les valeurs brutes (`date`, `heureDebut`…) restent
 *    à côté pour qui veut composer autrement.
 */

/** Nombre de séances rendues faute de `?limit=` (le shortcode WordPress demande la même chose). */
export const LIMITE_DEFAUT = 5;

/** Plafond : au-delà, l'appel n'annonce plus les prochains cours, il aspire le planning. */
export const LIMITE_MAX = 20;

/** Durée du cache HTTP (5 min) : le planning ne bouge pas à la minute, le site n'a pas à insister. */
export const CACHE_SECONDES = 300;

/** Une séance telle qu'elle sort de l'API — le contrat que le plugin WordPress consomme. */
export type SeancePublique = {
  /*
   * **Pas d'identifiant de séance ici.** Il en portait un, et c'était la fuite que tout le reste du
   * fichier cherchait à éviter : cette API s'interdit de publier l'effectif exact (elle ne donne
   * qu'un taux), mais `/partage/seance/<id>` est une page ouverte qui, elle, affiche « 13 présents
   * / 18 ». Ces pages ne tiennent que parce que leur adresse ne se devine pas — et l'API la
   * distribuait à qui lisait le site du club. Le plugin WordPress ne s'en servait pas : personne ne
   * le remarquera, et l'effectif du club redevient une affaire interne.
   */
  /** Date ISO (`2026-10-13`) pour qui trie ou filtre */
  date: string;
  /** « Mardi 13 octobre 2026 », pour qui affiche */
  dateTexte: string;
  heureDebut: string;
  heureFin: string;
  /** « 19h30 – 21h30 » */
  horaire: string;
  lieu: string;
  adresse: string;
  /** Thème affiché, alternative comprise : « Messer (ou Dague) » */
  theme: string;
  /** L'alternative seule, pour qui veut la mettre en forme autrement */
  alternative: string;
  /**
   * Le programme, élément par élément, dans l'ordre de lecture de la séance (partie, puis nature, puis
   * rang) : `ordre`, `partie` (le numéro, 1, 2, 3…), `nature` (`ECHAUFFEMENT` | `COURS` | `OPTION` |
   * `ATELIER`), `libelle` (« Partie 1 · Cours », « Partie 2 · Option 2 » — calculé, jamais saisi), le
   * titre, le niveau annoncé et la **description** — **jamais l'animateur**, ni le premier ni le second.
   *
   * **`estOption` reste publié**, alors que la colonne a disparu de la base : il vaut
   * `enParallele(nature)` — vrai pour une option ou un atelier, ce qu'il disait déjà. Un site qui le lit
   * (le plugin `hema-prochains-cours` livré, ou une intégration écrite par le club) continue de marcher
   * sans retouche ; `partie` et `nature` s'ajoutent, rien ne disparaît.
   *
   * Chaque case portait un **code** de partie (`MOITIE_1`…) pris dans une liste figée ; les séances
   * ayant désormais leurs propres parties, il n'y a plus de code à publier, seulement le libellé
   * calculé. Le plugin WordPress ne lit pas `programme` : le changement ne casse rien dehors.
   *
   * **La description sort par cette porte**. C'est du texte sur le contenu du cours, de la même
   * nature que le thème, et cette porte-ci est **fermée par défaut** : rien ne sort tant que le
   * club n'a pas coché la case. L'écran où elle se saisit l'annonce (`CaseEditeur`), ce que la
   * règle du dossier exige de tout champ publié.
   */
  programme: CasePublique[];
  /** Taux de participation en pourcentage (0 si personne n'a encore répondu) */
  taux: number;
  annulee: boolean;
  /** Motif d'annulation, "" si la séance n'est pas annulée */
  motif: string;
};

/** Un élément du programme tel que l'API le publie — la liste blanche de `versSeancePublique`. */
export type CasePublique = {
  ordre: number;
  /** Numéro de la partie, contigu à partir de 1 */
  partie: number;
  nature: NatureElement;
  libelle: string;
  /** Option ou atelier (`enParallele`) — gardé pour les sites qui le lisaient avant `nature` */
  estOption: boolean;
  theme: string;
  description: string;
  niveau: Niveau;
  atelier: boolean;
};

export type ReponseApiPublique = {
  club: string;
  /** Horodatage ISO de la réponse : le cache du site peut dire « mis à jour à … » */
  genereLe: string;
  seances: SeancePublique[];
};

/**
 * `?limit=` : un entier entre 1 et {@link LIMITE_MAX}. Tout le reste — absent, vide, « douze »,
 * « 1e3 », négatif — retombe sur {@link LIMITE_DEFAUT} plutôt que de rendre une erreur : une page
 * d'accueil de site associatif ne doit pas se retrouver vide parce qu'un paramètre est mal écrit.
 */
export function limiteDemandee(valeur: string | null | undefined): number {
  // Des chiffres, rien d'autre : « 2.5 », « 1e3 » ou « -2 » ne sont pas des nombres de cours
  const texte = (valeur ?? "").trim();
  if (!/^\d+$/.test(texte)) return LIMITE_DEFAUT;
  const n = Number(texte);
  if (n < 1) return LIMITE_DEFAUT;
  return Math.min(n, LIMITE_MAX);
}

/** Mise en forme d'une séance publiable. Fonction pure : ce qui n'est pas recopié ici ne sort pas. */
export function versSeancePublique(s: SeancePartagee): SeancePublique {
  return {
    date: s.date,
    dateTexte: formatDateLongue(s.date),
    heureDebut: s.heureDebut,
    heureFin: s.heureFin,
    horaire: formatHoraire(s.heureDebut, s.heureFin),
    lieu: s.lieu,
    adresse: s.adresse,
    theme: themeAffiche(s),
    alternative: (s.alternative ?? "").trim(),
    /*
     * **Le programme est recomposé champ par champ, jamais recopié en bloc.** `s.programme` arrive
     * de `src/lib/partage.ts`, qui sert aussi les pages de partage : tout champ qu'on y ajoutera un
     * jour se retrouverait publié ici sans que personne ne l'ait décidé. C'est ce qui est arrivé —
     * chaque case portait l'identifiant de sa ligne en base, sorti tel quel dans une réponse
     * publique et mise en cache, dans le fichier même qui explique pourquoi l'identifiant de séance
     * en a été retiré. La liste blanche rend la règle de l'en-tête (« ce qui n'est pas recopié ici
     * ne sort pas ») vraie par construction, et non par vigilance.
     */
    programme: s.programme.map((c) => ({
      ordre: c.ordre,
      partie: c.bloc,
      nature: c.nature,
      libelle: c.libelle,
      estOption: enParallele(c.nature),
      theme: c.theme,
      description: c.description,
      niveau: c.niveau,
      atelier: c.atelier,
    })),
    // Une séance annulée n'a plus de taux : afficher 68 % sous « Cours annulé » n'aurait aucun sens.
    taux: s.annulee ? 0 : calculerTaux(s.compteurs.presents, s.compteurs.invites),
    annulee: s.annulee,
    motif: s.annulee ? (s.motifAnnulation ?? "").trim() : "",
  };
}

export function reponsePublique(club: string, seances: SeancePartagee[], now = new Date()): ReponseApiPublique {
  return { club, genereLe: now.toISOString(), seances: seances.map(versSeancePublique) };
}

/**
 * En-têtes d'une réponse servie : CORS **limité à l'origine configurée** (`PUBLIC_API_ORIGIN`, vide
 * par défaut) et cache de 5 minutes. `Vary: Origin` parce que la réponse dépend de l'origine
 * autorisée ; la valeur est unique et fixe — le site du club, pas un miroir de ce que demande
 * l'appelant.
 */
export function entetesPubliques(origineAutorisee: string): Record<string, string> {
  const origine = origineAutorisee.trim();
  return {
    // **Aucune origine configurée : aucun en-tête.** Un `Access-Control-Allow-Origin` vide serait
    // une valeur invalide que les navigateurs traitent diversement ; son absence, elle, veut dire
    // exactement ce qu'on veut dire — aucun site n'est autorisé à lire cette réponse en JavaScript.
    // Le plugin WordPress appelle depuis son serveur : il n'est pas concerné.
    ...(origine ? { "Access-Control-Allow-Origin": origine } : {}),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
    "Cache-Control": `public, max-age=${CACHE_SECONDES}, s-maxage=${CACHE_SECONDES}`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ANNONCES — `GET /api/public/annonces`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **Ce que le club accepte de republier sur son site, notification par notification.**
 *
 * Demande de. C'est donc **un canal de plus dans la matrice** (`api`, « Site du club »,
 * `src/lib/notifications/preferences.ts`) — et une route pour aller le lire.
 *
 * ## Ce qui n'est pas un envoi
 *
 * Ce canal **n'envoie rien**. Il n'a ni file d'attente, ni journal, ni clé de déduplication, ni
 * destinataire : le site vient lire, quand il veut, et il lit l'état **actuel** de la base. Voir
 * `CANAUX_EXPOSITION` dans `preferences.ts`, qui l'écrit noir sur blanc, et `expositionPossible`
 * (`notifications/canaux.ts`), le point de passage unique.
 *
 * ## Dérivée de la base, jamais d'un journal
 *
 * Aucun message n'est stocké : chaque annonce est **recalculée** depuis les séances et les
 * événements tels qu'ils sont maintenant — la doctrine de ce fichier depuis le début. Corollaire
 * honnête : une annonce disparaît d'elle-même quand elle cesse d'être vraie (le cours de demain
 * devient le cours d'hier), et une correction du thème se voit tout de suite, sans « édition de
 * message » à gérer comme sur Discord.
 *
 * ## Deux portes, et il faut les deux
 *
 * 1. la **publication est ouverte** — la case « Publier les prochains cours » (carte *Publication
 *    des cours sur le site du club*). Fermée, la route rend `503` sans toucher la base, comme
 *    `prochaines-seances`, et sans rien changer aux cases de la matrice ;
 * 2. la **case de la notification** est cochée dans la colonne « Site du club ». Aucune ne l'est
 *    dans une base neuve : une mise à jour ne publie rien que le club n'ait décidé.
 *
 * ## Un seul contenu pour tous les canaux
 *
 * Les **titres** sont les constantes mêmes que portent l'email, l'embed Discord et le message
 * Telegram (`TITRE_RECAP`, `TITRE_ANNULATION`, `TITRE_EVENEMENT` — `notifications/contenu.ts`), et
 * les **valeurs affichables** sortent des mêmes fonctions pures que partout ailleurs
 * (`themeAffiche`, `formatDateLongue`, `formatHoraire`, `calculerTaux`, `dateEvenement`,
 * `horaireEvenement`, `libelleDuree`). Une correction faite là se voit sur tous les canaux à la fois.
 *
 * **Ce qui n'est volontairement pas repris, et pourquoi :** `lignesSeance` / `texteSeance`, les
 * lignes toutes faites du contenu commun. Elles portent « ✅ 13 présents / 18 — 72 % », c'est-à-dire
 * l'**effectif en clair** — exactement ce que la règle 2 de l'en-tête de ce fichier interdit à une
 * page web indexable. On rend donc du **JSON structuré**, construit depuis les mêmes données, et le
 * site compose la phrase qu'il veut ; le taux y est, l'effectif n'y est pas.
 */

/** Les notifications qui ont une case « Site du club ». La matrice décide, ce tuple ne fait que la nommer. */
export const TYPES_ANNONCE = ["recap_veille", "seance_annulee", "evenement_nouveau"] as const;
export type TypeAnnonce = (typeof TYPES_ANNONCE)[number];

/**
 * Elle est **dérivée de la matrice**, et un test relie les deux (`tests/unit/api-publique.test.ts`) :
 * ajouter la colonne `api` à une notification sans lui écrire son annonce ici — ou l'inverse — doit
 * faire échouer les tests, pas passer inaperçu.
 */
export function typesAnnonceDeLaMatrice(): TypeNotification[] {
  return TYPES_NOTIFICATION.filter((type) => CANAUX_PAR_NOTIFICATION[type].includes("api"));
}

/**
 * **Fenêtre des annonces d'annulation** : un cours annulé s'annonce tant qu'il n'a pas eu lieu, dans
 * la quinzaine. Au-delà, ce n'est plus une nouvelle — et le site a déjà `prochaines-seances`, qui
 * porte `annulee` et `motif` sur chacun des cours qu'il affiche. Les deux routes ne font pas le même
 * travail : celle-ci annonce, l'autre affiche le calendrier.
 */
export const HORIZON_ANNONCES_JOURS = 14;

/**
 * Plafonds de lecture : ils sont là pour qu'un club au planning chargé ne fasse jamais remonter deux
 * cents lignes pour en publier trois.
 *
 * **Ce sont des bornes de requête, mais elles ne sont pas neutres, et il faut le dire**. La lecture
 * prend les {@link ANNONCES_SEANCES_LUES} **prochaines séances** tandis que la fenêtre des
 * annulations balaie {@link HORIZON_ANNONCES_JOURS} **jours** : au-delà de vingt séances sur la
 * quinzaine — plusieurs groupes, plusieurs périodes actives en parallèle —, c'est la borne qui
 * écrête les annulations les plus lointaines, pas la fenêtre. Vingt séances couvrent plus de trois
 * semaines à six cours par semaine, donc le cas est improbable ; s'il devenait réel, la réponse
 * n'est pas de monter le nombre mais de lire **par dates** (la fenêtre, en requête), sous peine de
 * retomber sur le même écart un club plus gros plus tard.
 *
 * Le récap de la veille, lui, ne dépend pas de la borne : le cours de demain est parmi les premiers.
 */
export const ANNONCES_SEANCES_LUES = 20;
export const ANNONCES_EVENEMENTS_MAX = 10;

/**
 * **Un événement tel qu'il sort de l'API : liste blanche.** Même patron que `versSeancePublique` —
 * ce qui n'est pas recopié ne sort pas, et ce n'est pas une affaire de vigilance.
 *
 * Ce qui reste **volontairement** en base : `id`, `creeParId` (qui a saisi l'annonce — un nom),
 * `publie` (seules les annonces publiées arrivent ici), `lienSource` (le lien de travail de
 * l'équipe, pas celui dont un visiteur a besoin) et `imageUrl` (l'affiche vit dans le stockage de
 * l'application, et son adresse n'a pas à circuler).
 */
export type EvenementPublic = {
  nom: string;
  description: string;
  /** Date ISO de début, pour qui trie ou filtre */
  dateDebut: string;
  /** Date ISO de fin, "" si l'événement tient sur un jour */
  dateFin: string;
  /** « Samedi 10 octobre 2026 » ou « Du samedi 10 au dimanche 11 octobre 2026 » */
  dateTexte: string;
  /** "" si l'horaire n'est pas précisé (journée entière) */
  heureDebut: string;
  heureFin: string;
  /** « 10h00 – 17h30 », « à partir de 19h30 », « jusqu'à 17h30 », ou "" */
  horaire: string;
  /** « 2 jours », « 1 demi-journée », ou "" si la durée n'est pas annoncée */
  duree: string;
  lieu: string;
  adresse: string;
  /** Qui organise : le club, une association amie, une fédération */
  organisateur: string;
  /** Tarif en texte libre (« 45 € ») ; "" = gratuit, et c'est au site de le dire */
  prix: string;
  /** Tarif réduit pour les adhérents ; "" = il n'y en a pas */
  prixAdherent: string;
  /** Lien d'inscription filtré (http/https uniquement), "" s'il n'y en a pas */
  lienInscription: string;
};

/** Ce qu'il faut d'une ligne d'événement pour la publier — volontairement permissif en entrée. */
export type EvenementAnnoncable = {
  nom: string;
  description?: string | null;
  dateDebut: string;
  dateFin?: string | null;
  heureDebut?: string | null;
  heureFin?: string | null;
  lieu?: string | null;
  adresse?: string | null;
  organisateur?: string | null;
  prix?: string | null;
  prixAdherent?: string | null;
  dureeNombre?: number | null;
  dureeUnite?: string | null;
  lienInscription?: string | null;
};

/** Toujours une chaîne, jamais `null` : un site qui affiche « null » est un site qu'on a mal servi. */
function texte(valeur: string | null | undefined): string {
  return (valeur ?? "").trim();
}

/** Mise en forme d'un événement publiable. Fonction pure : ce qui n'est pas recopié ici ne sort pas. */
export function versEvenementPublic(e: EvenementAnnoncable): EvenementPublic {
  const dateFin = texte(e.dateFin);
  const bornes = { dateDebut: e.dateDebut, dateFin: dateFin || null, heureDebut: texte(e.heureDebut) || null, heureFin: texte(e.heureFin) || null };
  return {
    nom: texte(e.nom),
    description: texte(e.description),
    dateDebut: e.dateDebut,
    dateFin,
    // Les trois textes d'affichage viennent des fonctions que les pages de partage emploient déjà :
    // le site du club n'a pas à réécrire « Du samedi 10 au dimanche 11 octobre » en PHP.
    dateTexte: dateEvenement(bornes),
    heureDebut: texte(e.heureDebut),
    heureFin: texte(e.heureFin),
    horaire: horaireEvenement(bornes),
    duree: libelleDuree(e.dureeNombre ?? null, texte(e.dureeUnite)),
    lieu: texte(e.lieu),
    adresse: texte(e.adresse),
    organisateur: texte(e.organisateur),
    prix: texte(e.prix),
    prixAdherent: texte(e.prixAdherent),
    // Un lien saisi par l'équipe n'est republié que s'il est http(s) : une page publique ne relaie
    // pas un « javascript: » arrivé par le formulaire d'annonce (même garde que `evenementPartage`).
    lienInscription: lienExterneSur(e.lienInscription),
  };
}

/**
 * Une annonce, telle que le site la lit. `type` est la clé de la matrice : le site peut n'afficher
 * que ce qui l'intéresse sans réinterpréter le titre.
 */
export type AnnonceSeance = {
  type: "recap_veille" | "seance_annulee";
  /** « Cours de demain », « Cours annulé » — le titre des autres canaux, sans son pictogramme */
  titre: string;
  /** Le pictogramme du titre, à part : « 🗡️ », « ❌ » (l'interface du club, elle, met une icône) */
  picto: string;
  seance: SeancePublique;
};

export type AnnonceEvenement = {
  type: "evenement_nouveau";
  titre: string;
  picto: string;
  evenement: EvenementPublic;
};

export type AnnoncePublique = AnnonceSeance | AnnonceEvenement;

export type ReponseAnnonces = {
  club: string;
  /** Horodatage ISO de la réponse : le cache du site peut dire « mis à jour à … » */
  genereLe: string;
  annonces: AnnoncePublique[];
};

/** Titre d'une annonce, découpé comme les pages de partage le font (une seule règle, `contenu.ts`). */
function entete(titreCommun: string): { titre: string; picto: string } {
  const { picto, texte: titre } = separerPictogramme(titreCommun);
  return { titre, picto };
}

export type SourcesAnnonces = {
  /** Séances des périodes actives, d'aujourd'hui aux suivantes (annulées comprises) */
  seances: readonly SeancePartagee[];
  /** Annonces **publiées** à venir, du plus proche au plus lointain */
  evenements: readonly EvenementAnnoncable[];
  /** Les types dont la case « Site du club » est cochée, publication ouverte comprise */
  types: readonly TypeNotification[];
  now?: Date;
};

/**
 * **Les annonces courantes du club** (fonction pure).
 *
 * Trois sortes, chacune derrière sa case — un type absent de `types` ne produit rien du tout :
 *
 * - `recap_veille` → **le cours de demain**, non annulé. « Demain » est celui du cron du soir
 *   (`dateRecap`), pas un second calcul : l'annonce du site et le message du salon parlent du même
 *   cours. Pour les cinq prochains cours, le site a `prochaines-seances` ;
 * - `seance_annulee` → les cours **annulés** d'aujourd'hui à {@link HORIZON_ANNONCES_JOURS} jours,
 *   avec leur motif ;
 * - `evenement_nouveau` → les annonces **publiées** à venir, écrêtées à
 *   {@link ANNONCES_EVENEMENTS_MAX}.
 *
 * L'ordre rendu est celui de {@link TYPES_ANNONCE}, et chronologique à l'intérieur de chaque sorte
 * (les sources arrivent déjà triées). Il est stable : le site peut s'y fier.
 */
export function annoncesPubliques({ seances, evenements, types, now = new Date() }: SourcesAnnonces): AnnoncePublique[] {
  const actifs = new Set(types);
  const aujourdHui = todayIso(now);
  const demain = dateRecap(aujourdHui);
  const limite = addDays(aujourdHui, HORIZON_ANNONCES_JOURS);
  const annonces: AnnoncePublique[] = [];
  if (actifs.has("recap_veille")) {
    for (const s of seances) {
      if (s.date !== demain || s.annulee) continue;
      annonces.push({ type: "recap_veille", ...entete(TITRE_RECAP), seance: versSeancePublique(s) });
    }
  }
  if (actifs.has("seance_annulee")) {
    for (const s of seances) {
      if (!s.annulee || s.date < aujourdHui || s.date > limite) continue;
      annonces.push({ type: "seance_annulee", ...entete(TITRE_ANNULATION), seance: versSeancePublique(s) });
    }
  }
  if (actifs.has("evenement_nouveau")) {
    for (const e of evenements.slice(0, ANNONCES_EVENEMENTS_MAX)) {
      annonces.push({ type: "evenement_nouveau", ...entete(TITRE_EVENEMENT), evenement: versEvenementPublic(e) });
    }
  }
  return annonces;
}

export function reponseAnnonces(club: string, annonces: AnnoncePublique[], now = new Date()): ReponseAnnonces {
  return { club, genereLe: now.toISOString(), annonces };
}
