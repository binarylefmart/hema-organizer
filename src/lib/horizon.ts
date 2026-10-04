import { addDays, seanceCommencee, todayIso } from "./dates";

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
 * **La frontière du passé, c'est le début du cours — jamais minuit.**
 *
 * Une séance porte sa date *et* son heure de début : le cours de ce soir n'est passé qu'à partir de
 * 20 h, comme partout ailleurs dans l'application (`seanceCommencee`, la bascule « À venir /
 * Passé », les compteurs de l'accueil et du tableau de bord).
 *
 * `heureDebut` absente = on ne sait pas quand le cours commence : on retombe sur la date seule,
 * l'ancien comportement. C'est le repli des listes qui ne portent que des dates (une frise, un jeu
 * d'essai) ; tout ce qui vient d'une requête de séance porte son heure.
 */
function seancePassee(s: { date: string; heureDebut?: string }, aujourdHui: string, now: Date): boolean {
  return s.heureDebut === undefined ? s.date <= aujourdHui : seanceCommencee(s.date, s.heureDebut, now);
}

/**
 * Même fenêtre, tournée vers le passé (séances triées par date croissante) :
 * « prochain » ne garde que la dernière séance écoulée.
 *
 * **Le haut de la fenêtre est le début du cours, pas la fin de la journée**. Le découpage se
 * faisait sur `s.date <= aujourdHui`, si bien qu'un mardi à 18 h le cours de 20 h comptait déjà
 * pour passé : l'horizon « Dernier cours » du tableau de bord retenait **le cours du soir non
 * commencé** — une seule ligne, « moyenne 0 % », et tout le club à « 0 présence / 0 séance / 0 % »,
 * le cours de jeudi dernier n'étant même pas montré. Les écrans de séances ne le voyaient pas : ils
 * pré-filtrent avec `seanceCommencee` avant d'appeler ici (voir `src/components/filtres/temps.ts`).
 * Un compensateur posé d'un côté et pas de l'autre, c'est exactement la forme de défaut que ce
 * dossier passe son temps à démonter : la règle est donc **dans cette fonction**, où les deux
 * appelants la reçoivent.
 *
 * `now` sert à cette frontière (l'heure qu'il est), `aujourdHui` à la largeur de la fenêtre (le jour
 * d'où l'on compte) : les deux valent le même instant chez tous les appelants, et restent deux
 * arguments parce que « le jour de référence » se force parfois seul dans les tests.
 */
export function filtrerHorizonPasse<T extends { date: string; heureDebut?: string }>(
  seances: T[],
  horizon: Horizon,
  aujourdHui = todayIso(),
  now = new Date(),
): T[] {
  if (horizon === "periode") return seances;
  const passees = seances.filter((s) => seancePassee(s, aujourdHui, now));
  if (horizon === "prochain") return passees.slice(-1);
  const debut = addDays(aujourdHui, -(JOURS[horizon] as number));
  return passees.filter((s) => s.date >= debut);
}
