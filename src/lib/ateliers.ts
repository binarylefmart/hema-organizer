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

type Personne = { prenom: string; nom: string } | null | undefined;

/**
 * « Animé par Prénom Nom (avec Prénom Nom) » — `null` quand personne n'est renseigné (un atelier
 * d'avant la colonne `animateurId`, ou des comptes effacés depuis). Si seul le premier a été effacé, le
 * second se lit seul : c'est lui qui reste pour animer.
 */
export function libelleAnimation(animateur: Personne, second: Personne): string | null {
  const [premier, avec] = animateur ? [animateur, second] : [second, null];
  if (!premier) return null;
  const nom = (p: { prenom: string; nom: string }) => `${p.prenom} ${p.nom}`.trim();
  return avec ? `Animé par ${nom(premier)} (avec ${nom(avec)})` : `Animé par ${nom(premier)}`;
}
