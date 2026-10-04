import { db } from "./db";
import { addDays, moisAvant, parisDateTime, todayIso } from "./dates";
import { can, type UserLike } from "./permissions";
import { getCurrentUser } from "./auth/current-user";

/**
 * Lecture des événements du club (stages, tournois, démonstrations).
 *
 * Tout le monde consulte : il n'y a pas de permission de lecture, seulement deux permissions
 * d'écriture (`evenements.edit` pour l'encadrement, `evenements.creer_supprimer` pour le bureau).
 * Deux conséquences ici :
 * - les brouillons (`publie: false`) ne sortent que pour qui peut modifier une annonce ;
 * - le filtre est appliqué **dans la requête**, pas après coup, pour qu'un oubli d'affichage
 *   côté écran ne puisse jamais laisser fuiter un brouillon.
 */

export type Evenement = {
  id: string;
  nom: string;
  description: string;
  /** "AAAA-MM-JJ" */
  dateDebut: string;
  /** "HH:MM" ou null (journée entière) */
  heureDebut: string | null;
  /** "AAAA-MM-JJ" ou null (événement d'un seul jour) */
  dateFin: string | null;
  heureFin: string | null;
  lieu: string;
  adresse: string;
  /** Qui organise (le club, une association amie…) ; "" = non précisé */
  organisateur: string;
  /** Tarif en texte libre ("25 €", "prix libre") ; "" = gratuit, et l'affichage le dit */
  prix: string;
  /** Tarif réduit adhérents ; "" = il n'y en a pas, et l'affichage n'en dit rien (voir PRIX_MAX) */
  prixAdherent: string;
  /** Nombre de la durée (1 à 99) ; null = durée non précisée, l'unité est alors sans objet */
  dureeNombre: number | null;
  /** Unité de la durée : une clé de `UNITES_DUREE` ("demi-journee" | "jour" | "semaine") */
  dureeUnite: string;
  lienInscription: string;
  lienSource: string;
  imageUrl: string;
  publie: boolean;
  /** Publication effective (null sur les annonces d'avant cette colonne : on lit `createdAt`) */
  publieAt: Date | null;
  creeParId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Ce qu'il faut savoir d'un événement pour le situer dans le temps. */
export type BornesEvenement = Pick<Evenement, "dateDebut" | "heureDebut" | "dateFin" | "heureFin">;

/** Dernière minute de la journée : un événement sans heure occupe tout son jour. */
const FIN_DE_JOURNEE = "23:59";

/**
 * Peut-on tenir une annonce à jour (modifier, publier, dépublier) ? Instructeurs et administrateurs.
 * C'est aussi ce qui donne accès aux brouillons.
 */
export function peutModifierEvenement(user: UserLike | null | undefined): boolean {
  return can(user, "evenements.edit");
}

/** Peut-on ouvrir une annonce ou l'effacer ? Les administrateurs seulement. */
export function peutCreerSupprimerEvenement(user: UserLike | null | undefined): boolean {
  return can(user, "evenements.creer_supprimer");
}

/**
 * Cette personne a-t-elle quelque chose à faire sur les événements (au moins modifier) ?
 * Raccourci de lecture — pour n'afficher que les boutons autorisés, demander les deux questions
 * séparément avec `peutModifierEvenement` et `peutCreerSupprimerEvenement`.
 */
export function peutGererEvenements(user: UserLike | null | undefined): boolean {
  return peutModifierEvenement(user);
}

/**
 * Instant qui fait basculer un événement dans le passé, en heure de Paris (même règle que
 * `seanceCommencee` pour les séances) :
 * - une fin renseignée fait foi (heure de fin, ou fin de la journée de fin) ;
 * - sinon on se rabat sur le début : heure de début, ou fin de la journée de début pour un
 *   événement sans horaire, qui reste donc « à venir » toute sa journée.
 */
export function finEvenement(e: BornesEvenement): { date: string; heure: string } {
  if (e.heureFin) return { date: e.dateFin ?? e.dateDebut, heure: e.heureFin };
  if (e.dateFin) return { date: e.dateFin, heure: FIN_DE_JOURNEE };
  return { date: e.dateDebut, heure: e.heureDebut ?? FIN_DE_JOURNEE };
}

/** L'événement est-il passé ? (frontière stricte : au premier instant d'après, il bascule) */
export function evenementTermine(e: BornesEvenement, now = new Date()): boolean {
  const { date, heure } = finEvenement(e);
  return parisDateTime(date, heure).getTime() < now.getTime();
}

/** Clé de tri chronologique : la date de début, puis l'heure (sans heure = tôt dans la journée). */
function cleChronologique(e: BornesEvenement): string {
  return `${e.dateDebut} ${e.heureDebut ?? "00:00"}`;
}

/** Tri chronologique : "asc" = le plus proche d'abord, "desc" = le plus récent d'abord. */
export function trierEvenements<T extends BornesEvenement>(liste: readonly T[], sens: "asc" | "desc"): T[] {
  const signe = sens === "asc" ? 1 : -1;
  return [...liste].sort((a, b) => {
    const [ca, cb] = [cleChronologique(a), cleChronologique(b)];
    return ca === cb ? 0 : signe * (ca < cb ? -1 : 1);
  });
}

/**
 * Qui lit ? Le paramètre `user` est facultatif : **omis**, on prend la personne connectée (cas
 * courant d'une page serveur, qui a déjà exigé une session) ; passé explicitement — `null`
 * compris, pour un contexte sans session — c'est lui qui décide.
 */
async function lecteur(user: UserLike | null | undefined): Promise<(UserLike & { id?: string; evenementsVusAt?: Date | null }) | null> {
  return user === undefined ? await getCurrentUser() : user;
}

/** Les brouillons ne sortent que pour qui peut les modifier (encadrement). */
function filtrePublication(user: UserLike | null) {
  return peutModifierEvenement(user) ? {} : { publie: true };
}

/**
 * Événements à venir (en cours compris), du plus proche au plus lointain.
 * Le filtre SQL est volontairement large (une journée de marge) : la frontière exacte dépend de
 * l'heure de Paris et se tranche ensuite avec `evenementTermine`.
 */
export async function evenementsAVenir(user?: UserLike | null, now = new Date()): Promise<Evenement[]> {
  const borne = veille(now);
  const liste = await db.evenement.findMany({
    where: {
      ...filtrePublication(await lecteur(user)),
      OR: [{ dateFin: { gte: borne } }, { AND: [{ dateFin: null }, { dateDebut: { gte: borne } }] }],
    },
    orderBy: [{ dateDebut: "asc" }, { heureDebut: "asc" }],
  });
  return trierEvenements(
    liste.filter((e) => !evenementTermine(e, now)),
    "asc",
  );
}

/** Événements passés, du plus récent au plus ancien. */
export async function evenementsPasses(user?: UserLike | null, now = new Date()): Promise<Evenement[]> {
  const borne = lendemain(now);
  const liste = await db.evenement.findMany({
    where: {
      ...filtrePublication(await lecteur(user)),
      OR: [{ dateFin: { lte: borne } }, { AND: [{ dateFin: null }, { dateDebut: { lte: borne } }] }],
    },
    orderBy: [{ dateDebut: "desc" }, { heureDebut: "desc" }],
  });
  return trierEvenements(
    liste.filter((e) => evenementTermine(e, now)),
    "desc",
  );
}

/**
 * Un événement précis (fiche, écran de modification). Renvoie `null` si l'événement n'existe pas
 * ou si c'est un brouillon que la personne n'a pas le droit de voir.
 */
export async function evenementParId(id: string, user?: UserLike | null): Promise<Evenement | null> {
  const e = await db.evenement.findUnique({ where: { id } });
  if (!e) return null;
  return e.publie || peutModifierEvenement(await lecteur(user)) ? e : null;
}

/** Bornes de requête larges d'un jour (date de Paris ± 1) : la frontière fine est tranchée ensuite. */
function veille(now: Date): string {
  return addDays(todayIso(now), -1);
}

function lendemain(now: Date): string {
  return addDays(todayIso(now), 1);
}

/**
 * Qui regarde, pour la pastille : la personne passée en argument (si elle porte déjà sa date de
 * dernière visite), sinon celle qui est connectée. La date est relue en base au besoin — la session
 * en mémoire ne la connaît pas.
 */
type Lecteur = UserLike & { id?: string; evenementsVusAt?: Date | null };

async function derniereVisite(lecteur: Lecteur): Promise<Date | null> {
  if (lecteur.evenementsVusAt !== undefined) return lecteur.evenementsVusAt;
  if (!lecteur.id) return null;
  const ligne = await db.user.findUnique({ where: { id: lecteur.id }, select: { evenementsVusAt: true } });
  return ligne?.evenementsVusAt ?? null;
}

/** Une annonce passée est gardée six mois, puis effacée : voir `purgerEvenementsAnciens`. */
export const MOIS_CONSERVATION_EVENEMENTS = 6;

/**
 * Efface les annonces **terminées depuis plus de six mois**.
 *
 * Une annonce d'événement n'est pas un registre : c'est une affiche. Passé le stage de l'an
 * dernier, elle n'informe plus personne, elle encombre l'onglet « Passé » et elle garde en base
 * des noms d'organisateurs, des adresses et une affiche qui n'ont plus de raison d'être — six
 * mois suffisent largement à retrouver « c'était quand, ce tournoi ? ». Les présences aux cours,
 * elles, ne sont pas concernées : l'historique du club, lui, se conserve.
 *
 * La borne se calcule sur la **fin** de l'événement (`finEvenement`), pas sur son début : un stage
 * de trois jours ne disparaît pas parce qu'il a commencé un jour plus tôt. On sélectionne d'abord
 * par `dateDebut` — la colonne indexée, et toujours antérieure ou égale à la date de fin — puis on
 * tranche en mémoire avec la même règle que le reste de l'application.
 *
 * L'affiche éventuelle n'est pas supprimée ici : plus personne ne la référençant, le ménage des
 * affiches orphelines (même entretien quotidien) la ramassera au passage suivant.
 */
export async function purgerEvenementsAnciens(now = new Date()): Promise<number> {
  const limite = moisAvant(todayIso(now), MOIS_CONSERVATION_EVENEMENTS);
  const candidats = await db.evenement.findMany({
    where: { dateDebut: { lt: limite } },
    select: { id: true, dateDebut: true, heureDebut: true, dateFin: true, heureFin: true },
  });
  const aEffacer = candidats.filter((e) => finEvenement(e).date < limite).map((e) => e.id);
  if (aEffacer.length === 0) return 0;
  const { count } = await db.evenement.deleteMany({ where: { id: { in: aEffacer } } });
  return count;
}

/** Quand cette annonce est-elle devenue visible ? (`createdAt` pour les annonces d'avant `publieAt`) */
export function dateDePublication(e: { publieAt: Date | null; createdAt: Date }): Date {
  return e.publieAt ?? e.createdAt;
}

/**
 * Nombre d'événements **nouveaux depuis la dernière ouverture du panneau** : la pastille.
 *
 * Ne comptent que les annonces que cette personne voit (publiées pour un membre, brouillons
 * compris pour l'encadrement) et qui ne sont pas terminées — une annonce passée n'est pas une
 * nouveauté. La référence est la **publication effective** (`publieAt`), pas la création : un
 * brouillon publié trois jours plus tard compte comme nouveau le jour de sa publication.
 * Jamais ouvert le panneau (`evenementsVusAt` vide) = tout ce qui est visible est nouveau.
 */
export async function nombreEvenementsNouveaux(user?: Lecteur | null, now = new Date()): Promise<number> {
  const qui = await lecteur(user);
  if (!qui) return 0;
  const [aVenir, vusAt] = await Promise.all([evenementsAVenir(qui, now), derniereVisite(qui)]);
  if (!vusAt) return aVenir.length;
  return aVenir.filter((e) => dateDePublication(e).getTime() > vusAt.getTime()).length;
}
