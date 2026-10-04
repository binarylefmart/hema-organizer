import type { AtelierStatut } from "./constants";

/**
 * Cycle de vie d'un atelier (fonction pure, testée), volontairement minimal :
 * PROPOSE (en attente) → PLANIFIE (placé dans le planning) | REFUSE ;
 * PLANIFIE → PROPOSE (retiré du planning) | REFUSE ; REFUSE → PROPOSE (réexamen).
 * Le membre ne peut modifier/supprimer que tant que PROPOSE.
 */
const TRANSITIONS: Record<AtelierStatut, AtelierStatut[]> = {
  PROPOSE: ["PLANIFIE", "REFUSE"],
  PLANIFIE: ["PROPOSE", "REFUSE"],
  REFUSE: ["PROPOSE"],
};

export function transitionAutorisee(de: string, vers: string): boolean {
  return (TRANSITIONS[de as AtelierStatut] ?? []).includes(vers as AtelierStatut);
}

export function membrePeutModifier(statut: string): boolean {
  return statut === "PROPOSE";
}

export const ATELIER_LABELS: Record<AtelierStatut, string> = {
  PROPOSE: "En attente",
  PLANIFIE: "Dans le planning",
  REFUSE: "Refusé",
};
