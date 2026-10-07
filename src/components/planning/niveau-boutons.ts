import { NIVEAU_DEFAUT, NIVEAUX, type Niveau } from "@/lib/constants";

/**
 * **Le niveau d'une case en quatre boutons, sur téléphone.** Quatre valeurs fixes, sans personne
 * dedans : un tap vaut mieux qu'une liste qu'on ouvre pour en choisir une. Les personnes, elles,
 * restent en liste déroulante (règle de l'écran au téléphone).
 *
 * Deux libellés par bouton : `court` est ce qu'on lit — quatre boutons doivent tenir côte à côte sur
 * 360 px, d'où « Interm. » — et `nom` est ce qu'on entend, en entier. « Tous » dit l'absence de
 * niveau (`INDIFFERENT`), que la liste écrit `----------` : un bouton vide ne se toucherait pas.
 */
export type BoutonNiveau = { niveau: Niveau; court: string; nom: string };

const LIBELLES: Record<Niveau, { court: string; nom: string }> = {
  INDIFFERENT: { court: "Tous", nom: "Tous niveaux" },
  DEBUTANT: { court: "Débutant", nom: "Débutant" },
  INTERMEDIAIRE: { court: "Interm.", nom: "Intermédiaire" },
  AVANCE: { court: "Avancé", nom: "Avancé" },
};

/** Dans l'ordre de la liste déroulante : on retrouve les mêmes choix au même rang. */
export const BOUTONS_NIVEAU: readonly BoutonNiveau[] = NIVEAUX.map((n) => ({ niveau: n, ...LIBELLES[n] }));

/** Une valeur reçue d'un contrôle, ramenée à un niveau connu (le défaut sinon), comme la liste le faisait. */
export function niveauChoisi(v: string): Niveau {
  return (NIVEAUX as readonly string[]).includes(v) ? (v as Niveau) : NIVEAU_DEFAUT;
}
