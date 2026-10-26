import { seanceCommencee } from "@/lib/dates";
import { reglagesVides } from "@/components/planning/options";
import type { SeanceExistante } from "@/lib/templates";

/**
 * **Ce que l'application d'un template sait d'une séance**, calculé depuis la base — côté serveur.
 *
 * L'écran annonce le plan avant l'appui (`planApplication`, dans le navigateur) et `appliquerTemplate`
 * le recalcule au moment de l'appui. Pour que les deux plans disent la même chose, ils doivent partir
 * des **mêmes faits** : `commencee` et `programmeVide` s'écrivent ici exactement comme dans
 * `src/actions/templates.ts` (`appliquerTemplate`, le `seances.map` passé à `planApplication`) —
 *
 * - `commencee` : `seanceCommencee(date, heureDebut, now)`, le verrou de l'heure de début ;
 * - `programmeVide` : **toutes** les parties sans atelier et aux réglages vides (`reglagesVides` :
 *   ni encadrant, ni second, ni thème, ni description, ni niveau affiché).
 *
 * **L'action l'importe** : une seule écriture de la règle, l'écran et le serveur ne peuvent pas diverger.
 *
 * Elle reste hors du composant client : `reglagesVides` est pur, mais rien n'oblige le navigateur à
 * connaître les encadrants et les descriptions de chaque séance pour savoir si un programme est vide —
 * seuls les deux booléens voyagent.
 */
export type SeanceLue = {
  id: string;
  date: string;
  heureDebut: string;
  annulee: boolean;
  parties: ReadonlyArray<{
    instructeurId: string | null;
    instructeurSecondId: string | null;
    theme: string;
    description: string;
    niveau: string;
    atelierId: string | null;
  }>;
};

/** Le `select` Prisma qui rapporte exactement ce que `versSeanceExistante` lit (le même que l'action). */
export const SELECT_SEANCE_APPLICATION = {
  id: true,
  date: true,
  heureDebut: true,
  annulee: true,
  parties: { select: { instructeurId: true, instructeurSecondId: true, theme: true, description: true, niveau: true, atelierId: true } },
} as const;

export function versSeanceExistante(s: SeanceLue, now: Date): SeanceExistante {
  return {
    id: s.id,
    date: s.date,
    heureDebut: s.heureDebut,
    annulee: s.annulee,
    commencee: seanceCommencee(s.date, s.heureDebut, now),
    programmeVide: s.parties.every(
      (p) =>
        !p.atelierId &&
        reglagesVides({ instructeur: p.instructeurId, instructeurSecond: p.instructeurSecondId, theme: p.theme, description: p.description, niveau: p.niveau }),
    ),
  };
}
