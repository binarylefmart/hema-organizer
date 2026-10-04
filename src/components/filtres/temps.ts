import { seanceCommencee, todayIso } from "@/lib/dates";
import { filtrerHorizon, filtrerHorizonPasse, type Horizon } from "@/lib/horizon";

/**
 * Sens de lecture du temps, commun aux écrans qui listent des séances : on regarde **ce qui vient**
 * (position par défaut, l'URL reste propre) ou **ce qui est passé** (`?quand=passe`).
 *
 * C'est le premier filtre : il dit de quel côté d'aujourd'hui on se place. La fenêtre de temps
 * (`h` : Toute la période · 2 mois · 1 mois · 2 semaines · 1 semaine · Prochain cours) dit ensuite
 * jusqu'où, dans ce sens-là — « 1 mois » en position « Passé », c'est le mois écoulé.
 */
export const QUANDS = ["avenir", "passe"] as const;
export type Quand = (typeof QUANDS)[number];

export const QUAND_LABELS: Record<Quand, string> = { avenir: "À venir", passe: "Passé" };

export function lireQuand(valeur?: string): Quand {
  return valeur === "passe" ? "passe" : "avenir";
}

/** Valeur à mettre dans l'URL : rien pour la position par défaut. */
export function valeurQuand(quand: Quand): string | undefined {
  return quand === "passe" ? "passe" : undefined;
}

/** Nom du paramètre d'URL qui porte une date précise (« je cherche le cours du 12 »). */
export const PARAM_DATE = "date";

/**
 * **La date cherchée, ou rien.**
 *
 * Une date venue de l'URL est une saisie comme une autre : on ne garde que ce qui a la forme d'un
 * jour du calendrier **et** qui existe vraiment. `2026-02-31` a la bonne forme et n'est pas un
 * jour ; sans cette seconde vérification, l'écran filtrerait sur une date que personne ne peut
 * atteindre et n'afficherait plus rien, sans dire pourquoi.
 *
 * Rendre `undefined` plutôt que de lever : un filtre illisible, c'est un filtre absent — l'écran
 * retombe sur ce qu'il montre d'habitude, ce qui est toujours mieux qu'une page vide.
 */
export function lireDateFiltre(valeur?: string): string | undefined {
  if (!valeur || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return undefined;
  const [annee, mois, jour] = valeur.split("-").map(Number);
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  const reel = d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour;
  return reel ? valeur : undefined;
}

/**
 * Lien d'un écran filtré : les paramètres vides (valeur par défaut) disparaissent de l'URL,
 * les autres filtres de la page (période, fenêtre de temps…) sont conservés tels quels.
 */
export function lienTemps(base: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(params)) if (valeur) q.set(cle, valeur);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Une séance vue d'ici : sa date et son heure de début suffisent à savoir de quel côté elle est. */
export type SeanceTemps = { date: string; heureDebut: string };

/**
 * Séances retenues, dans les deux sens.
 *
 * La frontière n'est pas la date mais **le début du cours** (`seanceCommencee`) : le cours du soir
 * reste « à venir » toute la journée, et bascule dans le passé dès qu'il a commencé.
 *
 * - « À venir » : de la plus proche à la plus lointaine, resserrées par `filtrerHorizon` ;
 * - « Passé » : de la plus récente à la plus ancienne, resserrées par `filtrerHorizonPasse`.
 *
 * `seances` doit être triée par date croissante (c'est l'ordre des requêtes et du planning).
 */
export function selectionnerSeances<T extends SeanceTemps>(
  seances: T[],
  quand: Quand,
  horizon: Horizon,
  now = new Date(),
  aujourdHui = todayIso(now),
): T[] {
  const commencee = (s: T) => seanceCommencee(s.date, s.heureDebut, now);
  if (quand === "passe") {
    const passees = seances.filter(commencee);
    return filtrerHorizonPasse(passees, horizon, aujourdHui).slice().reverse();
  }
  return filtrerHorizon(
    seances.filter((s) => !commencee(s)),
    horizon,
    aujourdHui,
  );
}


/**
 * **Les séances d'un jour précis** — ce que rend l'écran quand on a cherché une date.
 *
 * Elle court-circuite les deux autres filtres, et c'est voulu : quelqu'un qui tape « 12 octobre »
 * demande le cours du 12 octobre, pas « le 12 octobre s'il tombe dans la fenêtre que j'avais
 * choisie ». Le sens du temps (à venir / passé) et la largeur de la fenêtre n'ont plus rien à dire
 * une fois qu'un jour est nommé — les croiser ne pourrait que rendre une liste vide sur une date
 * qui existe, ce qui se lit comme une panne.
 *
 * Aucun tri : `seances` arrive déjà dans l'ordre du calendrier, et un même jour porte au plus deux
 * cours dans ce club.
 */
export function seancesDuJour<T extends SeanceTemps>(seances: T[], date: string): T[] {
  return seances.filter((s) => s.date === date);
}
