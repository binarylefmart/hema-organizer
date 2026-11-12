import { creneauxDesSeances } from "./creneaux";
import type { Compteurs } from "./presences";

/**
 * **Les calculs des graphiques des onglets Séances et Personnes** du tableau de bord (fonctions
 * pures, sur les chiffres déjà calculés par `statsPeriode`). Un taux ne se lit que sur les **séances
 * passées** et non annulées : pour un cours à venir, ce ne sont que des réponses déjà reçues.
 */

type SeanceStat = { id: string; date: string; heureDebut: string; annulee: boolean; passee: boolean; compteurs: Compteurs };
type MembreStat = { id: string; prenom: string; nom: string; pourcentage: number; sansReponse: number; seances: number };

export type TauxCreneau = { cle: string; libelle: string; cours: number; taux: number };

/** Le taux moyen par jour de cours (mardi, vendredi…), séances passées seulement, le mieux rempli d'abord. */
export function tauxParCreneau(seances: readonly SeanceStat[]): TauxCreneau[] {
  const passees = seances.filter((s) => s.passee && !s.annulee);
  const creneauDe = creneauxDesSeances(passees);
  const parCle = new Map<string, { libelle: string; rang: number; somme: number; cours: number }>();
  for (const s of passees) {
    const c = creneauDe.get(s.id)!;
    const x = parCle.get(c.cle) ?? { libelle: c.libelle, rang: c.rang, somme: 0, cours: 0 };
    x.somme += s.compteurs.pourcentage;
    x.cours += 1;
    parCle.set(c.cle, x);
  }
  return [...parCle.entries()]
    .map(([cle, x]) => ({ cle, libelle: x.libelle, cours: x.cours, taux: Math.round(x.somme / x.cours), rang: x.rang }))
    .sort((a, b) => b.taux - a.taux || a.rang - b.rang)
    .map((c) => ({ cle: c.cle, libelle: c.libelle, cours: c.cours, taux: c.taux }));
}

/** Les `n` cours passés les mieux et les moins remplis (à égalité, le plus récent d'abord). */
export function extremesSeances(seances: readonly SeanceStat[], n = 3): { mieux: SeanceStat[]; moins: SeanceStat[] } {
  const passees = seances.filter((s) => s.passee && !s.annulee);
  const parTaux = [...passees].sort((a, b) => b.compteurs.pourcentage - a.compteurs.pourcentage || b.date.localeCompare(a.date));
  const moins = [...passees].sort((a, b) => a.compteurs.pourcentage - b.compteurs.pourcentage || b.date.localeCompare(a.date));
  return { mieux: parTaux.slice(0, n), moins: moins.slice(0, n) };
}

export const TRANCHES_TAUX: ReadonlyArray<{ libelle: string; min: number; max: number }> = [
  { libelle: "75 à 100 %", min: 75, max: 101 },
  { libelle: "50 à 75 %", min: 50, max: 75 },
  { libelle: "25 à 50 %", min: 25, max: 50 },
  { libelle: "moins de 25 %", min: 0, max: 25 },
];

/** Combien de personnes dans chaque tranche de taux — seules celles qui ont eu au moins un cours compté. */
export function repartitionTaux(membres: readonly MembreStat[]): Array<{ libelle: string; n: number }> {
  const comptes = membres.filter((m) => m.seances > 0);
  return TRANCHES_TAUX.map((t) => ({ libelle: t.libelle, n: comptes.filter((m) => m.pourcentage >= t.min && m.pourcentage < t.max).length }));
}

/** Top et flop de l'assiduité, et le plus souvent sans réponse (`n` chacun). */
export function topsPersonnes(membres: readonly MembreStat[], n = 5) {
  const nom = (m: MembreStat) => `${m.prenom} ${m.nom}`.trim();
  const comptes = membres.filter((m) => m.seances > 0);
  const alpha = (a: MembreStat, b: MembreStat) => nom(a).localeCompare(nom(b), "fr");
  return {
    top: [...comptes].sort((a, b) => b.pourcentage - a.pourcentage || alpha(a, b)).slice(0, n),
    flop: [...comptes].sort((a, b) => a.pourcentage - b.pourcentage || alpha(a, b)).slice(0, n),
    sansReponse: membres.filter((m) => m.sansReponse > 0).sort((a, b) => b.sansReponse - a.sansReponse || alpha(a, b)).slice(0, n),
  };
}
