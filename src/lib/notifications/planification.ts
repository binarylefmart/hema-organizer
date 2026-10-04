import { addDays, joursAvant, TIMEZONE } from "@/lib/dates";

/**
 * Calendrier des envois (fonctions **pures**, sans base ni réseau : c'est ce que les tests vérifient).
 *
 * - le récap part la veille de chaque cours, à l'heure réglée dans Gestion → Réglages (défaut 18:00) ;
 * - les rappels aux personnes sans réponse partent une semaine (J-7) puis deux jours (J-2) avant le cours ;
 * - l'alerte « peu de monde » ne regarde que les cours des trois jours qui viennent.
 */

/** Jalons des rappels aux personnes sans réponse, en jours avant la séance. */
export const JALONS = [7, 2] as const;
export type Jalon = (typeof JALONS)[number];

/** "HH:MM" en heure de Paris à l'instant donné. */
export function heureParis(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: TIMEZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/**
 * Est-ce la minute de l'envoi du récap ? Le cron passe chaque minute ; comme l'heure est un réglage
 * modifiable à tout moment, on la compare ici plutôt que de figer une expression cron au démarrage.
 */
export function estHeureRecap(heureReglee: string, now = new Date()): boolean {
  return heureParis(now) === heureReglee;
}

/** "HH:MM" en minutes depuis minuit, ou null si ce n'est pas une heure. */
export function minutesDeLHeure(heure: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(heure.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/**
 * **Fenêtre de rattrapage des envois du soir**, et pas seulement la minute réglée.
 *
 * Jusqu', les envois ne partaient qu'à l'égalité exacte `heureParis(now) === heure` : une seule
 * minute par jour, sans filet. Trois choses la manquaient, et le récap sautait alors pour la
 * journée entière — sans que personne s'en aperçoive avant le lendemain :
 *
 * - le serveur redémarrait (déploiement, coupure, veille de la machine) pendant cette minute-là ;
 * - le passage du cron arrivait en retard sous charge, et l'horloge de Paris avait déjà changé de
 *   minute ;
 * - le changement d'heure sautait l'heure réglée : au printemps, 02:00 → 03:00 fait disparaître 60
 *   minutes du calendrier civil, dont l'heure du récap si elle y tombe.
 *
 * Et surtout, la reprise après échec promise par `journal.ts` n'avait **jamais lieu** pour le récap
 * et les rappels : une clé libérée par `marquerEchec` (SMTP fâché, Discord en panne) n'était rejouée
 * que le lendemain à la même minute — c'est-à-dire, pour un cours du lendemain, jamais.
 *
 * D'où un repassage toutes les `PAS_RATTRAPAGE_MIN` minutes pendant `FENETRE_RATTRAPAGE_MIN`
 * minutes après l'heure réglée. Il ne coûte rien : tout est idempotent
 * (`NotificationLog.dedupKey`), un repassage sans rien à faire n'est que deux ou trois requêtes.
 */
export const PAS_RATTRAPAGE_MIN = 15;
export const FENETRE_RATTRAPAGE_MIN = 90;

/**
 * Ce passage du cron doit-il déclencher les envois du soir ? Vrai à l'heure réglée, puis toutes les
 * `PAS_RATTRAPAGE_MIN` minutes jusqu'au bout de la fenêtre de rattrapage.
 */
export function estPassageEnvois(heureReglee: string, now = new Date()): boolean {
  const reglee = minutesDeLHeure(heureReglee);
  const courante = minutesDeLHeure(heureParis(now));
  if (reglee === null || courante === null) return false;
  // Pas de report d'un jour sur l'autre : une fenêtre qui déborderait minuit rejouerait le récap de
  // la veille pour les séances du surlendemain. Une heure réglée à 23:30 n'a qu'une demi-fenêtre.
  const ecart = courante - reglee;
  if (ecart < 0 || ecart > FENETRE_RATTRAPAGE_MIN) return false;
  return ecart % PAS_RATTRAPAGE_MIN === 0;
}

/** Date des séances concernées par le récap de la veille (= demain). */
export function dateRecap(aujourdHui: string): string {
  return addDays(aujourdHui, 1);
}

/** Dates des séances concernées par les rappels aujourd'hui : J-7 et J-2. */
export function datesJalons(aujourdHui: string): string[] {
  return JALONS.map((j) => addDays(aujourdHui, j));
}

/** Jalon d'une séance pour la journée en cours, ou null si ce n'est ni J-7 ni J-2. */
export function jalonPour(dateSeance: string, aujourdHui: string): Jalon | null {
  const restants = joursAvant(aujourdHui, dateSeance);
  return (JALONS as readonly number[]).includes(restants) ? (restants as Jalon) : null;
}

/**
 * Horizon de l'alerte « peu de monde », en jours avant le cours.
 *
 * Elle portait sur **les deux prochaines séances**, quelle que soit leur date : un trimestre qui
 * démarre calmement faisait donc partir, le même matin, deux alertes pour des cours situés à une et
 * deux semaines de là — alors que personne n'a encore répondu et qu'il n'y a rien à décider.
 * L'alerte ne sert qu'à choisir d'ouvrir la salle ou non : elle n'a de sens que **peu avant le
 * cours concerné**, c'est-à-dire dans les trois jours qui le précèdent.
 */
export const HORIZON_ALERTE_EFFECTIF = 3;

/** Dernière date de séance concernée aujourd'hui par l'alerte « peu de monde ». */
export function derniereDateAlerteEffectif(aujourdHui: string): string {
  return addDays(aujourdHui, HORIZON_ALERTE_EFFECTIF);
}

/**
 * La séance est-elle assez proche pour que l'alerte « peu de monde » parte aujourd'hui ?
 *
 * Un intervalle (J-3 → le jour même) plutôt qu'un jalon unique : le balayage quotidien doit pouvoir
 * rattraper un matin manqué (serveur arrêté, période activée tard), et la déduplication par séance
 * (`effectif_<id>`) garantit de toute façon une seule alerte par cours. Un cours qui repasse sous le
 * seuil la veille est ainsi encore signalé.
 */
export function dansHorizonAlerteEffectif(dateSeance: string, aujourdHui: string): boolean {
  const restants = joursAvant(aujourdHui, dateSeance);
  return restants >= 0 && restants <= HORIZON_ALERTE_EFFECTIF;
}

/** Le strict nécessaire pour composer une clé de déduplication : l'identifiant et le créneau. */
export type SeanceCle = { id: string; seance: { date: string; heureDebut: string } };

/**
 * **Empreinte du créneau d'une séance** — sa date et son heure de début, telles qu'elles sont au
 * moment de l'envoi.
 *
 * Elle entre dans les clés de déduplication du récap et des rappels (`journal.ts`). Sans elle, la clé
 * ne portait que l'identifiant de la séance, et **déplacer** un cours au lieu de l'annuler laissait
 * les membres avec la mauvaise date : l'annonce était déjà partie pour l'ancien créneau, sa clé
 * existait, et plus rien ne partait pour le nouveau. Ils avaient été prévenus du mauvais jour, et ne
 * l'étaient jamais du bon.
 *
 * Elle ne porte **que** le créneau, volontairement : corriger le thème, le lieu ou le programme d'une
 * séance ne renvoie rien à personne — seul un cours qui change d'heure ou de jour se réannonce.
 */
export function empreinteCreneau(seance: { date: string; heureDebut: string }): string {
  return `${seance.date}-${seance.heureDebut.replace(":", "")}`;
}
