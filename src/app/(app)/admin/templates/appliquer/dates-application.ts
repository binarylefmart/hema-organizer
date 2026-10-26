import { addDays, isoWeekday } from "@/lib/dates";
import type { SeanceExistante } from "@/lib/templates";

/**
 * **Le choix des dates de l'écran « Appliquer un template »** — un module pur, sans React ni base,
 * importé par le composant client comme par la page serveur (et par les tests).
 *
 * Toutes les dates sont des chaînes « AAAA-MM-JJ » et le restent : on ne construit **jamais** de
 * `Date` locale à partir d'elles. `new Date("2026-09-24")` est minuit UTC, c'est-à-dire la veille au
 * soir sur un navigateur réglé à l'ouest de Greenwich — un « tous les mardis » qui tomberait sur des
 * lundis. On passe par `addDays` et `isoWeekday` (`src/lib/dates.ts`), qui calculent à midi UTC et ne
 * dépendent d'aucun fuseau.
 *
 * « Aujourd'hui » n'est pas calculé ici non plus : la page serveur le lit dans le fuseau du club
 * (`todayIso`) et le transmet. Un navigateur réglé sur un autre fuseau, ou dont l'horloge dérive,
 * aurait sinon proposé une date que le serveur écarte (« date passée ») — l'écran promettrait ce que
 * le serveur ne tient pas.
 */

/** Une période telle que l'écran la voit : seules ses bornes comptent pour le choix des dates. */
export type BornesPeriode = { dateDebut: string; dateFin: string };

/** Les jours de la semaine, dans l'ordre ISO (indice 0 = lundi = `isoWeekday` 1). */
export const JOURS_SEMAINE = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

/** « mardi » pour 2 : le nom d'un jour ISO (1 = lundi … 7 = dimanche). */
export function nomJour(jour: number): string {
  return JOURS_SEMAINE[jour - 1] ?? "";
}

/**
 * **Le premier jour où l'on peut encore appliquer un template** : aujourd'hui si la période est
 * commencée, son premier jour sinon ; `null` si elle est finie. Un template ne s'applique jamais au
 * passé (`planApplication` l'écarte), l'écran ne le propose donc pas.
 */
export function premierJourOuvert(periode: BornesPeriode, aujourdHui: string): string | null {
  const debut = periode.dateDebut > aujourdHui ? periode.dateDebut : aujourdHui;
  return debut <= periode.dateFin ? debut : null;
}

/**
 * **« Tous les mardis de la période »**, à partir d'aujourd'hui : chaque date du jour demandé entre le
 * premier jour ouvert et la fin de la période, dans l'ordre du calendrier.
 */
export function datesDuJour(periode: BornesPeriode, aujourdHui: string, jour: number): string[] {
  const debut = premierJourOuvert(periode, aujourdHui);
  if (!debut || jour < 1 || jour > 7) return [];
  // Le premier jour voulu, puis de sept en sept : pas de boucle jour par jour sur toute la période.
  let date = addDays(debut, (jour - isoWeekday(debut) + 7) % 7);
  const dates: string[] = [];
  while (date <= periode.dateFin) {
    dates.push(date);
    date = addDays(date, 7);
  }
  return dates;
}

/**
 * **Les jours de la semaine que la période offre encore**, avec leur nombre de dates — de quoi
 * remplir la liste du raccourci (« Mardi — 12 dates »). Un jour sans aucune date restante (une
 * période qui s'achève jeudi) n'est pas proposé : un bouton qui n'ajouterait rien serait un piège.
 */
export function joursProposes(periode: BornesPeriode, aujourdHui: string): Array<{ jour: number; nombre: number }> {
  return [1, 2, 3, 4, 5, 6, 7].map((jour) => ({ jour, nombre: datesDuJour(periode, aujourdHui, jour).length })).filter((j) => j.nombre > 0);
}

/**
 * **Le jour proposé d'emblée par le raccourci** : celui où la période a le plus de séances à venir
 * (non annulées) — c'est presque toujours le jour du cours, et c'est lui qu'on vient poser. À égalité,
 * le premier de la semaine. Sans aucune séance (une période brouillon pas encore générée), le jour du
 * premier jour ouvert. `null` si la période n'a plus aucun jour à offrir.
 */
export function jourParDefaut(periode: BornesPeriode, aujourdHui: string, seances: readonly Pick<SeanceExistante, "date" | "annulee">[]): number | null {
  const proposes = joursProposes(periode, aujourdHui);
  if (proposes.length === 0) return null;
  const debut = premierJourOuvert(periode, aujourdHui)!;
  const compte = new Map<number, number>();
  for (const s of seances) {
    if (s.annulee || s.date < debut || s.date > periode.dateFin) continue;
    const j = isoWeekday(s.date);
    compte.set(j, (compte.get(j) ?? 0) + 1);
  }
  let meilleur: number | null = null;
  for (const { jour } of proposes) {
    if ((compte.get(jour) ?? 0) > (meilleur === null ? 0 : (compte.get(meilleur) ?? 0))) meilleur = jour;
  }
  return meilleur ?? isoWeekday(debut);
}

/**
 * **Pourquoi une date précise ne peut pas être ajoutée** — `null` si elle peut l'être. Les mêmes
 * raisons que `planApplication`, dites au moment de la saisie : une puce ajoutée pour être aussitôt
 * « écartée » n'apprend rien qu'on ne puisse dire tout de suite, sous le champ.
 */
export function refusDate(date: string, periode: BornesPeriode, aujourdHui: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Choisis une date.";
  if (date < periode.dateDebut || date > periode.dateFin) return "Cette date n'est pas dans la période.";
  if (date < aujourdHui) return "Cette date est déjà passée.";
  return null;
}

export type AjoutDates = {
  /** La sélection après l'ajout : sans doublon, dans l'ordre du calendrier. */
  dates: string[];
  /** Les dates réellement ajoutées. */
  ajoutees: number;
  /** Celles qui étaient déjà choisies. */
  deja: number;
  /** Celles qui n'ont pas trouvé de place sous le plafond (`DATES_APPLICATION_MAX`). */
  refusees: number;
};

/**
 * **Ajoute des dates à la sélection, sous le plafond.** Le serveur refuse une demande de plus de
 * `max` dates (`applicationSchema`) : l'écran ne doit donc jamais en réunir davantage, sans quoi le
 * bouton mènerait à un refus. Ce qui dépasse est **compté et dit**, jamais avalé en silence ; on
 * garde les premières dans l'ordre du calendrier.
 */
export function ajouterDates(choisies: readonly string[], nouvelles: readonly string[], max: number): AjoutDates {
  const deja = new Set(choisies);
  const candidates = [...new Set(nouvelles)].filter((d) => !deja.has(d)).sort();
  const place = Math.max(0, max - deja.size);
  const prises = candidates.slice(0, place);
  return {
    dates: [...deja, ...prises].sort(),
    ajoutees: prises.length,
    deja: new Set(nouvelles).size - candidates.length,
    refusees: candidates.length - prises.length,
  };
}

/**
 * **La période ouverte d'emblée**, quand l'URL n'en nomme pas une valable : la période **active**
 * (celle qui contient aujourd'hui s'il y en a plusieurs, sinon la plus récente), à défaut la
 * période **brouillon la plus proche** d'aujourd'hui — celle qu'on est en train de préparer.
 * Une période close n'arrive jamais jusqu'ici : la page ne charge que les périodes ouvertes.
 */
export function periodeParDefaut<P extends BornesPeriode & { id: string; statut: string }>(
  periodes: readonly P[],
  aujourdHui: string,
  demandee?: string,
): P | null {
  const nommee = demandee ? periodes.find((p) => p.id === demandee) : undefined;
  if (nommee) return nommee;
  const contient = (p: P) => p.dateDebut <= aujourdHui && aujourdHui <= p.dateFin;
  const actives = periodes.filter((p) => p.statut === "ACTIVE");
  if (actives.length) return actives.find(contient) ?? [...actives].sort((a, b) => b.dateDebut.localeCompare(a.dateDebut))[0];
  // L'écart à aujourd'hui : 0 si elle le contient, sinon la distance à sa borne la plus proche
  // (calculée à midi UTC, comme `joursAvant`, pour qu'aucun changement d'heure ne la fausse).
  const ecart = (p: P) => (contient(p) ? 0 : Math.abs(Date.parse(`${p.dateDebut > aujourdHui ? p.dateDebut : p.dateFin}T12:00:00Z`) - Date.parse(`${aujourdHui}T12:00:00Z`)));
  const brouillons = periodes.filter((p) => p.statut === "BROUILLON");
  return [...brouillons].sort((a, b) => ecart(a) - ecart(b) || a.dateDebut.localeCompare(b.dateDebut))[0] ?? null;
}

/**
 * **Le lien « Voir le planning »** : la page planning lit `?periode=` (`src/app/(app)/planning/page.tsx`),
 * et ouvre par défaut les séances à venir — exactement celles qu'on vient de poser.
 */
export function lienPlanningPeriode(periodeId: string): string {
  return `/planning?periode=${encodeURIComponent(periodeId)}`;
}

/** L'adresse de cet écran, avec sa présélection : c'est elle qu'on recharge en changeant de période. */
export function lienAppliquer({ template, periode }: { template?: string | null; periode?: string | null }): string {
  const params = new URLSearchParams();
  if (template) params.set("template", template);
  if (periode) params.set("periode", periode);
  const requete = params.toString();
  return `/admin/templates/appliquer${requete ? `?${requete}` : ""}`;
}
