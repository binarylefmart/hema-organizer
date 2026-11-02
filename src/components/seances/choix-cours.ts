import type { NatureElement } from "@/lib/constants";

/**
 * **Le choix des cours par présence** (retours du club d'Arras) — les règles sans React ni base.
 *
 * Un membre qui a répondu « Présent » peut cocher, s'il le veut, le ou les cours qu'il suivra : les
 * éléments COURS, OPTION et ATELIER du programme, **jamais l'échauffement** (tout le monde le fait).
 * C'est facultatif et ça ne remplace rien : `Attendance` reste la référence des taux, des rappels et
 * des alertes. Les choix sont effacés quand la réponse passe à « Absent ».
 */

/** Les natures qu'on peut choisir : ce qui se déroule en parallèle, ou ce qu'on peut sauter. */
export const NATURES_CHOISISSABLES: readonly NatureElement[] = ["COURS", "OPTION", "ATELIER"];

export function natureChoisissable(nature: string): boolean {
  return (NATURES_CHOISISSABLES as readonly string[]).includes(nature);
}

/** Un élément proposé sur la carte d'une séance, avec le nombre de présents qui l'ont choisi. */
export type OptionChoix = { partieId: string; nom: string; detail: string; compte: number };

/** Ce que la carte sait du choix des cours d'une séance. */
export type ChoixCoursCarte = { options: OptionChoix[]; mesChoix: string[] };

/**
 * **Le nom d'une option** : le thème s'il y en a un (c'est ce qu'on choisit vraiment), à défaut le
 * titre de l'atelier, à défaut le nom calculé de l'élément (« Cours 2 »).
 */
export function nomOption(e: { libelle: string; theme: string; atelier?: { titre: string } | null }): string {
  return e.theme.trim() || e.atelier?.titre.trim() || e.libelle;
}

/** « 1 inscrit », « 5 inscrits », « Personne pour l'instant » — le compteur affiché par cours. */
export function libelleCompte(n: number): string {
  if (n === 0) return "personne pour l'instant";
  return n === 1 ? "1 inscrit" : `${n} inscrits`;
}

/** Le compteur suit le geste avant que le serveur réponde : +1 en cochant, -1 en décochant. */
export function compteApres(option: OptionChoix, avant: ReadonlySet<string>, apres: ReadonlySet<string>): number {
  const delta = (apres.has(option.partieId) ? 1 : 0) - (avant.has(option.partieId) ? 1 : 0);
  return Math.max(0, option.compte + delta);
}

/* ─────────── Les statistiques (tableau de bord) ─────────── */

/** Un choix tel que le tableau de bord le lit : l'élément choisi et la date de sa séance. */
export type ChoixLu = { partieId: string; sessionId: string; nom: string; niveau: string; date: string };

export type LigneStat = { cle: string; libelle: string; choix: number; seances: number };

export type StatsChoix = { total: number; parCours: LigneStat[]; parNiveau: LigneStat[]; parMois: LigneStat[] };

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « novembre 2026 » depuis une date ISO. */
export function libelleMois(date: string): string {
  const [an, mois] = date.split("-");
  return `${MOIS[Number(mois) - 1]} ${an}`;
}

/**
 * **Trois lectures des mêmes choix** : par cours (le nom de l'option), par niveau et par mois. Chaque
 * ligne compte les choix et les séances où ils portent. Rangées du plus choisi au moins choisi, sauf
 * les mois, rangés dans l'ordre du calendrier.
 */
export function statsChoix(lus: readonly ChoixLu[], libelleNiveau: (niveau: string) => string): StatsChoix {
  const grouper = (cle: (c: ChoixLu) => string, libelle: (c: ChoixLu) => string) => {
    const lignes = new Map<string, { libelle: string; choix: number; seances: Set<string> }>();
    for (const c of lus) {
      const k = cle(c);
      const l = lignes.get(k) ?? { libelle: libelle(c), choix: 0, seances: new Set<string>() };
      l.choix += 1;
      l.seances.add(c.sessionId);
      lignes.set(k, l);
    }
    return [...lignes].map(([k, l]) => ({ cle: k, libelle: l.libelle, choix: l.choix, seances: l.seances.size }));
  };
  const parChoix = (a: LigneStat, b: LigneStat) => b.choix - a.choix || a.libelle.localeCompare(b.libelle, "fr");
  return {
    total: lus.length,
    parCours: grouper((c) => c.nom.toLocaleLowerCase("fr"), (c) => c.nom).sort(parChoix),
    parNiveau: grouper((c) => c.niveau, (c) => libelleNiveau(c.niveau)).sort(parChoix),
    parMois: grouper((c) => c.date.slice(0, 7), (c) => libelleMois(c.date)).sort((a, b) => a.cle.localeCompare(b.cle)),
  };
}

/**
 * **Le choix des cours d'une séance, tel que la carte le montre** : les éléments choisissables du
 * programme lisible (`programme`, les muets déjà écartés), chacun avec le nombre de **présents** qui
 * l'ont choisi — un choix laissé par quelqu'un passé à « Peut-être », ou sorti de la période, ne
 * compte pas —, et les choix de la personne qui regarde.
 */
export function choixDeLaSeance(
  parties: ReadonlyArray<{ id: string; nature: string; libelle: string; theme: string; atelier?: { titre: string } | null; choix: ReadonlyArray<{ userId: string }> }>,
  visibles: ReadonlySet<string>,
  presents: ReadonlySet<string>,
  userId: string,
): ChoixCoursCarte {
  const options: OptionChoix[] = [];
  const mesChoix: string[] = [];
  for (const p of parties) {
    if (!natureChoisissable(p.nature) || !visibles.has(p.id)) continue;
    const nom = nomOption(p);
    options.push({ partieId: p.id, nom, detail: nom === p.libelle ? "" : p.libelle, compte: p.choix.filter((c) => presents.has(c.userId)).length });
    if (p.choix.some((c) => c.userId === userId)) mesChoix.push(p.id);
  }
  return { options, mesChoix };
}
