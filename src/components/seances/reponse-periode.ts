import type { AttendanceStatut } from "@/lib/constants";
import { pluriel } from "@/components/ui/choix-geste";

/**
 * **« Répondre pour toutes les séances à venir »** — la réponse d'un membre à toute une période d'un
 * coup (retours du club d'Arras). Les règles sans React ni base : quelles séances la réponse touche,
 * ce que la case « Ne pas modifier mes réponses déjà données » garde, et les phrases qui le disent.
 *
 * Le serveur (`repondrePourLaPeriode`) refait le même tri avec ses propres lectures ; l'écran ne
 * sert qu'à annoncer les chiffres avant l'appui.
 */

/** Un cours proposé au choix sur une séance (`choixDeLaSeance`), et s'il est déjà coché par la personne. */
export type CoursARepondre = { partieId: string; nom: string; choisi: boolean };

/**
 * Ce que l'écran sait d'une séance pour ce geste (date et heure : pour la liste « Choisir des dates » ;
 * `cours` : les cours au choix, seulement quand le club a ouvert le choix des cours).
 */
export type SeanceARepondre = { id: string; annulee: boolean; commencee: boolean; monStatut: string | null; date?: string; heureDebut?: string; cours?: CoursARepondre[] };

/** Les séances encore ouvertes à une réponse : ni annulées, ni commencées (donc ni passées). */
export function seancesOuvertes<T extends SeanceARepondre>(seances: readonly T[]): T[] {
  return seances.filter((s) => !s.annulee && !s.commencee);
}

export type PlanReponse = {
  /** Les séances qui recevront la réponse (et dont elle change vraiment). */
  aEcrire: string[];
  /** Déjà répondues autrement, gardées telles quelles parce que la case est cochée. */
  gardees: number;
  /** Déjà répondues autrement, remplacées parce que la case est décochée. */
  remplacees: number;
  /** Portent déjà la réponse choisie : rien n'y change. */
  deja: number;
};

/**
 * **Le tri**, la règle unique de l'écran et du serveur : une séance sans réponse la reçoit ; une
 * séance déjà répondue la garde si `garder`, sinon la reçoit ; une séance qui porte déjà la réponse
 * choisie n'est pas réécrite (et n'est pas comptée comme « remplacée » — elle gonflerait le chiffre
 * censé faire hésiter).
 *
 * `choisies` restreint le geste à des dates précises (« Choisir des dates ») : sans lui, toutes les
 * séances ouvertes de la période. Une séance choisie mais annulée ou commencée entre-temps reste
 * ignorée, comme dans le geste entier.
 */
export function planReponse(seances: readonly SeanceARepondre[], statut: AttendanceStatut, garder: boolean, choisies?: ReadonlySet<string>): PlanReponse {
  const plan: PlanReponse = { aEcrire: [], gardees: 0, remplacees: 0, deja: 0 };
  for (const s of seancesOuvertes(seances)) {
    if (choisies && !choisies.has(s.id)) continue;
    if (s.monStatut === statut) plan.deja += 1;
    else if (s.monStatut === null) plan.aEcrire.push(s.id);
    else if (garder) plan.gardees += 1;
    else {
      plan.remplacees += 1;
      plan.aEcrire.push(s.id);
    }
  }
  return plan;
}

const MOT_STATUT: Record<AttendanceStatut, string> = { PRESENT: "Présent", ABSENT: "Absent", PEUT_ETRE: "Peut-être" };

/** « Présent pour 8 séances » — le libellé du bouton, et le cœur des phrases. */
export function libelleReponse(statut: AttendanceStatut, n: number): string {
  return `${MOT_STATUT[statut]} pour ${pluriel(n, "séance")}`;
}

/** Les phrases sous les boutons : ce qui change, ce qui est gardé, ce qui est remplacé. */
export function phrasesPlan(plan: PlanReponse): string[] {
  const phrases: string[] = [];
  if (plan.gardees > 0)
    phrases.push(`${pluriel(plan.gardees, "réponse")} déjà ${plan.gardees > 1 ? "données sont gardées" : "donnée est gardée"}.`);
  if (plan.remplacees > 0)
    phrases.push(`${pluriel(plan.remplacees, "réponse")} déjà ${plan.remplacees > 1 ? "données seront remplacées" : "donnée sera remplacée"}.`);
  if (plan.deja > 0) phrases.push(`${pluriel(plan.deja, "séance")} ${plan.deja > 1 ? "portent" : "porte"} déjà cette réponse.`);
  return phrases;
}

/** La question d'avant l'écriture, avec ses chiffres. */
export function confirmationReponse(statut: AttendanceStatut, plan: PlanReponse): string {
  return [`Répondre « ${MOT_STATUT[statut]} » pour ${pluriel(plan.aEcrire.length, "séance")} ?`, ...phrasesPlan(plan)].join(" ");
}

/** Ce que le serveur répond une fois l'écriture faite. */
export function succesReponse(statut: AttendanceStatut, plan: PlanReponse): string {
  if (plan.aEcrire.length === 0) return ["Rien à changer.", ...phrasesPlan(plan)].join(" ");
  return [`C'est noté : ${libelleReponse(statut, plan.aEcrire.length)}.`, ...phrasesPlan(plan).map((p) => p.replace("seront remplacées", "ont été remplacées").replace("sera remplacée", "a été remplacée"))].join(" ");
}

/* ─────────── Le choix des cours dans la réponse groupée ─────────── */

/**
 * **Les séances où la personne sera « Présent » après le geste** — les seules où l'on peut choisir des
 * cours : celles qui reçoivent « Présent » (`aEcrire`) et celles qui le portent déjà. Une réponse
 * gardée autrement (case cochée) ne reçoit aucun cours. Rien si la réponse choisie n'est pas « Présent ».
 */
export function seancesPresentesApres(seances: readonly SeanceARepondre[], statut: AttendanceStatut, garder: boolean, choisies?: ReadonlySet<string>): string[] {
  if (statut !== "PRESENT") return [];
  const ecrites = new Set(planReponse(seances, statut, garder, choisies).aEcrire);
  return seancesOuvertes(seances)
    .filter((s) => (!choisies || choisies.has(s.id)) && (ecrites.has(s.id) || s.monStatut === "PRESENT"))
    .map((s) => s.id);
}

/** La clé d'un nom de cours : « Épée longue » et « épée longue » sont le même cours. */
export const cleCours = (nom: string) => nom.trim().toLocaleLowerCase("fr");

export type CoursPropose = { cle: string; nom: string; seances: number };

/**
 * **Les cours qu'on peut cocher d'un coup** : les noms des cours au choix (`nomOption` — le thème,
 * sinon le titre de l'atelier, sinon le nom de l'élément) des séances visées, chacun une fois, avec
 * le nombre de séances qui le proposent. Rangés du plus fréquent au plus rare, puis par nom.
 */
export function coursProposes(seances: readonly SeanceARepondre[], cibles: readonly string[]): CoursPropose[] {
  const visees = new Set(cibles);
  const parCle = new Map<string, { nom: string; seances: Set<string> }>();
  for (const s of seances) {
    if (!visees.has(s.id)) continue;
    for (const c of s.cours ?? []) {
      const cle = cleCours(c.nom);
      const ligne = parCle.get(cle) ?? { nom: c.nom.trim(), seances: new Set<string>() };
      ligne.seances.add(s.id);
      parCle.set(cle, ligne);
    }
  }
  return [...parCle]
    .map(([cle, l]) => ({ cle, nom: l.nom, seances: l.seances.size }))
    .sort((a, b) => b.seances - a.seances || a.nom.localeCompare(b.nom, "fr"));
}

/**
 * **Les éléments à cocher** pour les noms retenus, sur les séances visées : ceux qui portent un de ces
 * noms et ne sont pas déjà choisis. **Rien n'est jamais décoché** : le geste ajoute des cours, il
 * n'en retire aucun — décocher se fait sur la carte de la séance.
 */
export function partiesAChoisir(seances: readonly SeanceARepondre[], cibles: readonly string[], cles: ReadonlySet<string>): string[] {
  if (cles.size === 0) return [];
  const visees = new Set(cibles);
  return seances.filter((s) => visees.has(s.id)).flatMap((s) => (s.cours ?? []).filter((c) => !c.choisi && cles.has(cleCours(c.nom))).map((c) => c.partieId));
}

/** « 3 cours ajoutés », la phrase qui suit la réponse quand des cours ont été cochés. */
export function phraseCours(n: number, fait: boolean): string {
  if (n === 0) return "";
  return fait ? `${pluriel(n, "cours", "cours")} ${n > 1 ? "ajoutés" : "ajouté"} à tes choix.` : `${pluriel(n, "cours", "cours")} ${n > 1 ? "seront ajoutés" : "sera ajouté"} à tes choix.`;
}
