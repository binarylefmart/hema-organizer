/**
 * Utilitaires de dates en fuseau Europe/Paris.
 * Les séances stockent une date "AAAA-MM-JJ" et des heures "HH:MM" locales.
 */
export const TIMEZONE = "Europe/Paris";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isIsoDate(s: string): boolean {
  return ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function isHHMM(s: string): boolean {
  return HHMM.test(s);
}

/**
 * « mardi » → « Mardi ». `Intl` rend les jours et les mois en minuscules, et un libellé français
 * commence par une capitale — cette ligne était écrite six fois dans le projet.
 */
export function capitale(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** L'inverse, pour glisser une date au milieu d'une phrase : « …le vendredi 25 septembre ». */
export function minuscule(texte: string): string {
  return texte.charAt(0).toLowerCase() + texte.slice(1);
}

/** « 2026-09 » → « Septembre 2026 » : l'intitulé d'un mois, dans le planning comme dans un formulaire. */
export function nomMois(cle: string): string {
  return capitale(new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${cle}-15T12:00:00Z`)));
}

/** Date du jour ("AAAA-MM-JJ") en heure de Paris. */
export function todayIso(now = new Date()): string {
  return toIsoDate(now);
}

export function toIsoDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Ajoute n jours à une date ISO. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Recule de n mois **calendaires**, en bornant le jour au dernier jour du mois d'arrivée :
 * six mois avant le 31 août, c'est le 28 (ou 29) février, pas le 3 mars. Sans ce garde-fou,
 * `setUTCMonth` déborde sur le mois suivant et une règle de conservation « 6 mois » garderait
 * deux ou trois jours de trop, au hasard du calendrier.
 */
export function moisAvant(iso: string, n: number): string {
  const [a, m, j] = iso.split("-").map(Number);
  const cible = new Date(Date.UTC(a, m - 1 - n, 1, 12));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0, 12)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernierJour));
  return cible.toISOString().slice(0, 10);
}

/** Nombre de jours entre deux dates ISO (b − a). */
export function joursAvant(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Jour de semaine ISO (1 = lundi … 7 = dimanche) d'une date ISO. */
export function isoWeekday(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** "jeudi 24 septembre 2026" — première lettre en majuscule. */
export function formatDateLongue(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const s = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
  // « 1 septembre » se dit « 1er septembre »
  const avecPremier = s.replace(/\b1 /, "1er ");
  return capitale(avecPremier);
}

/**
 * « Vendredi 25 septembre » — la date en toutes lettres, **sans l'année**.
 *
 * C'est la forme des cartes de séance : sur un cours à venir, l'année n'apprend rien et coûte une
 * ligne entière sur un téléphone étroit, où elle repoussait l'horaire et les boutons de réponse.
 * Les résumés partagés et les emails, eux, gardent l'année (un message se relit des mois après).
 */
export function formatDateSansAnnee(iso: string): string {
  return formatDateLongue(iso).replace(/\s\d{4}$/, "");
}

/** "jeudi 24 sept." (format court pour les listes). */
export function formatDateCourte(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const s = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(d);
  return capitale(s);
}

/**
 * « ven 25 sept. » — la date d'une colonne de frise, à l'échelle de quatre colonnes sur un
 * téléphone de 390 px. `formatDateCourte` y écrit « Vendredi 25 sept. », qui se faisait couper au
 * milieu du jour ; une date tronquée ne dit plus rien du tout.
 */
export function formatDateFrise(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .format(d)
    .replace(/\.$/, "");
}

/** "19:30" → "19h30" */
export function formatHeure(hhmm: string): string {
  return hhmm.replace(":", "h");
}

/** "19h30 à 21h30" */
export function formatHoraire(debut: string, fin: string): string {
  return `${formatHeure(debut)} à ${formatHeure(fin)}`;
}

/**
 * Instant (Date) correspondant à une date + heure locale Paris.
 * Calculé sans bibliothèque : on part de l'UTC puis on corrige avec le décalage observé.
 */
export function parisDateTime(iso: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = new Date(`${iso}T${hhmm}:00Z`);
  const offsetMin = parisOffsetMinutes(guess);
  const result = new Date(guess.getTime() - offsetMin * 60_000);
  // Deuxième passe pour les jours de changement d'heure
  const offset2 = parisOffsetMinutes(result);
  if (offset2 !== offsetMin) {
    return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), h, m) - offset2 * 60_000);
  }
  return result;
}

/** Décalage Europe/Paris ↔ UTC en minutes à un instant donné (+60 ou +120). */
export function parisOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** La séance a-t-elle déjà commencé ? */
export function seanceCommencee(dateIso: string, heureDebut: string, now = new Date()): boolean {
  return parisDateTime(dateIso, heureDebut).getTime() <= now.getTime();
}

/* " à 19h30" pour les journaux et emails techniques */
export function formatDateHeure(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

/** Lien vers la carte (Google Maps, sans clé ni service payant) pour un lieu + adresse. */
export function lienCarte(lieu: string, adresse: string): string {
  const requete = adresse ? `${lieu}, ${adresse}` : lieu;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(requete)}`;
}
