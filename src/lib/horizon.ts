import { addDays, todayIso } from "./dates";

/**
 * Fenêtre de temps commune à tous les écrans : on part de la période entière (le trimestre en
 * cours) et on resserre jusqu'au prochain cours. Toujours dans le même ordre, avec les mêmes mots.
 *
 * Les libellés disent tous une durée depuis que « 2 mois » existe : « 1 mois » et non « Mois »,
 * pour qu'on lise deux fenêtres de même nature côte à côte plutôt qu'un mois et un autre.
 */
export const HORIZONS = ["periode", "2mois", "mois", "2semaines", "semaine", "prochain"] as const;
export type Horizon = (typeof HORIZONS)[number];

export const HORIZON_LABELS: Record<Horizon, string> = {
  periode: "Toute la période",
  // Entre le trimestre entier et le mois : un trimestre du club en dure trois, et « deux mois » est
  // la fenêtre de celui qui prépare la suite sans vouloir tout relire.
  "2mois": "2 mois",
  mois: "1 mois",
  "2semaines": "2 semaines",
  semaine: "1 semaine",
  prochain: "Prochain cours",
};

/** Mêmes fenêtres, côté passé (tableau de bord) : « 1 mois » = le mois écoulé. */
export const HORIZON_LABELS_PASSE: Record<Horizon, string> = {
  ...HORIZON_LABELS,
  prochain: "Dernier cours",
};

/** Durée de la fenêtre en jours (null = toute la période, 0 = une seule séance). */
const JOURS: Record<Horizon, number | null> = { periode: null, "2mois": 60, mois: 30, "2semaines": 14, semaine: 7, prochain: 0 };

export function lireHorizon(valeur?: string): Horizon {
  return (HORIZONS as readonly string[]).includes(valeur ?? "") ? (valeur as Horizon) : "periode";
}

/**
 * Restreint une liste de séances **triées par date croissante** à la fenêtre choisie,
 * à partir d'aujourd'hui : « prochain » ne garde que la première.
 */
export function filtrerHorizon<T extends { date: string }>(seances: T[], horizon: Horizon, aujourdHui = todayIso()): T[] {
  if (horizon === "periode") return seances;
  if (horizon === "prochain") return seances.slice(0, 1);
  const fin = addDays(aujourdHui, JOURS[horizon] as number);
  return seances.filter((s) => s.date <= fin);
}

/**
 * Même fenêtre, tournée vers le passé (séances triées par date croissante) :
 * « prochain » ne garde que la dernière séance écoulée.
 *
 * **Le haut de la fenêtre est la veille, jamais le cours de ce soir** (`seancePassee`, demande de
 * Delta) : un cours ne rejoint le passé que le lendemain, à minuit dans le fuseau du club — commencé
 * ou non, celui du jour reste parmi les cours à venir, grisé et verrouillé dès son heure de début.
 * C'est la règle du planning et de l'onglet Séances, et c'est ici qu'elle se pose pour le tableau de
 * bord, l'historique et l'accueil : une seule fonction, que tous les appelants reçoivent. Un mardi à
 * 21 h, l'horizon « Dernier cours » montre donc le cours de jeudi dernier, pas celui qui se donne.
 */
export function filtrerHorizonPasse<T extends { date: string }>(seances: T[], horizon: Horizon, aujourdHui = todayIso()): T[] {
  if (horizon === "periode") return seances;
  // `seancePassee` (dates.ts), lue sur le jour de référence reçu : les tests le forcent seul.
  const passees = seances.filter((s) => s.date < aujourdHui);
  if (horizon === "prochain") return passees.slice(-1);
  const debut = addDays(aujourdHui, -(JOURS[horizon] as number));
  return passees.filter((s) => s.date >= debut);
}
