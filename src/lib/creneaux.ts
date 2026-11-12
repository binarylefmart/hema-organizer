/**
 * **Les créneaux de cours** : jour de la semaine × heure de début, tous cours confondus (« mardi »,
 * « vendredi », pas une date précise). Module pur, partagé par l'onglet Séances et les désistements du
 * tableau de bord.
 *
 * Le jour se lit sur la date de calendrier (`AAAA-MM-JJ` à midi UTC : aucun fuseau ne la fait changer
 * de jour). L'heure ne s'écrit dans le libellé que si ce jour a plusieurs horaires dans la liste.
 */
const NOMS_JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"] as const;
/** L'ordre de la semaine du club : lundi d'abord, dimanche en dernier (`getUTCDay` met dimanche à 0). */
const RANG_JOUR = [6, 0, 1, 2, 3, 4, 5];

export type Creneau = { cle: string; libelle: string; rang: number };

export function jourDeLaSemaine(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** Le créneau de chaque séance, par identifiant. */
export function creneauxDesSeances(seances: ReadonlyArray<{ id: string; date: string; heureDebut: string }>): Map<string, Creneau> {
  const heuresParJour = new Map<number, Set<string>>();
  for (const s of seances) {
    const j = jourDeLaSemaine(s.date);
    heuresParJour.set(j, (heuresParJour.get(j) ?? new Set()).add(s.heureDebut));
  }
  const resultat = new Map<string, Creneau>();
  for (const s of seances) {
    const j = jourDeLaSemaine(s.date);
    const plusieurs = (heuresParJour.get(j)?.size ?? 0) > 1;
    const [hh, mm] = s.heureDebut.split(":").map(Number);
    resultat.set(s.id, {
      cle: plusieurs ? `${j}-${s.heureDebut}` : `${j}`,
      libelle: plusieurs ? `${NOMS_JOURS[j]} · ${s.heureDebut.replace(":", "h")}` : NOMS_JOURS[j],
      // L'ordre de la semaine, puis l'heure : pour départager deux créneaux à égalité.
      rang: RANG_JOUR[j] * 2000 + (hh || 0) * 60 + (mm || 0),
    });
  }
  return resultat;
}
