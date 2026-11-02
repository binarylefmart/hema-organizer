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

/** Ce que l'écran sait d'une séance pour ce geste (date et heure : pour la liste « Choisir des dates »). */
export type SeanceARepondre = { id: string; annulee: boolean; commencee: boolean; monStatut: string | null; date?: string; heureDebut?: string };

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
