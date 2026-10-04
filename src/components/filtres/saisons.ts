import { BIMESTRES, datesBimestre, datesTrimestre, libelleSaison, saisonCourante, TRIMESTRES } from "@/lib/periodes";

/**
 * Regroupement des périodes par **saison sportive** (2026-2027 = →), pour le choix en deux temps «
 * la saison, puis la période dedans ». Fonctions pures, sans accès à la base ni à React : testées
 * dans tests/unit/selecteur-periode.test.ts.
 */

export type PeriodeOption = {
  id: string;
  nom: string;
  statut: string;
  dateDebut: string;
  dateFin: string;
};

export type SaisonGroupe = {
  /** Année de départ de la saison (2026 = saison 2026-2027) */
  saison: number;
  /** « 2026-2027 » */
  libelle: string;
  /** Périodes de la saison, dans l'ordre T1 → T2 → T3 → Été → personnalisées */
  periodes: PeriodeOption[];
};

export type Situation = "en-cours" | "a-venir" | "passee";

export const SITUATION_LABELS: Record<Situation, string> = {
  "en-cours": "En cours",
  "a-venir": "À venir",
  passee: "Passée",
};

/** Saison à laquelle une période appartient (d'après sa date de début). */
export function saisonDePeriode(p: Pick<PeriodeOption, "dateDebut">): number {
  return saisonCourante(p.dateDebut);
}

/**
 * Rang de tri dans la saison : 1 à 4 pour les trimestres du club (T1, T2, T3, Été), 5 à 10 pour les
 * bimestres — **dans l'un ou l'autre calage**, le rang étant celui du cycle et non du mois —, 11
 * pour une période personnalisée, qui passe donc après les découpages réguliers. À rang égal, c'est
 * la date de début qui tranche : un club ne mélange pas les deux grilles dans une même saison, et
 * s'il le fait, la chronologie reprend la main.
 */
export function rangDansSaison(p: Pick<PeriodeOption, "dateDebut" | "dateFin">): number {
  const saison = saisonDePeriode(p);
  for (const { n } of TRIMESTRES) {
    const t = datesTrimestre(saison, n);
    if (t.dateDebut === p.dateDebut && t.dateFin === p.dateFin) return n;
  }
  for (const decalage of [0, 1] as const) {
    for (const n of BIMESTRES) {
      const b = datesBimestre(saison, n, decalage);
      if (b.dateDebut === p.dateDebut && b.dateFin === p.dateFin) return 4 + n;
    }
  }
  return 11;
}

/** Situation d'une période par rapport à aujourd'hui (le repère « En cours / À venir / Passées »). */
export function situationPeriode(p: Pick<PeriodeOption, "dateDebut" | "dateFin">, aujourdHui: string): Situation {
  if (p.dateFin < aujourdHui) return "passee";
  if (p.dateDebut > aujourdHui) return "a-venir";
  return "en-cours";
}

/** Mention affichée à côté du nom d'une période : « (brouillon) », « (clôturée) » ou rien. */
export function suffixeStatut(p: Pick<PeriodeOption, "statut">): string {
  if (p.statut === "BROUILLON") return " (brouillon)";
  if (p.statut === "CLOSE") return " (clôturée)";
  return "";
}

/**
 * Saisons réellement présentes en base, déduites des dates des périodes : la plus récente en premier,
 * chacune avec ses périodes rangées T1 → T2 → T3 → Été → bimestres → personnalisées.
 */
export function grouperParSaison(periodes: readonly PeriodeOption[]): SaisonGroupe[] {
  const parSaison = new Map<number, PeriodeOption[]>();
  for (const p of periodes) {
    const s = saisonDePeriode(p);
    parSaison.set(s, [...(parSaison.get(s) ?? []), p]);
  }
  return [...parSaison.entries()]
    .sort(([a], [b]) => b - a)
    .map(([saison, liste]) => ({
      saison,
      libelle: libelleSaison(saison),
      periodes: [...liste].sort(
        (a, b) => rangDansSaison(a) - rangDansSaison(b) || a.dateDebut.localeCompare(b.dateDebut) || a.nom.localeCompare(b.nom, "fr"),
      ),
    }));
}

/**
 * Période la plus pertinente d'une saison quand on bascule dessus :
 * celle en cours si elle y est, sinon la première à venir, sinon la dernière écoulée.
 */
export function periodePertinente(periodes: readonly PeriodeOption[], aujourdHui: string): PeriodeOption | undefined {
  if (periodes.length === 0) return undefined;
  const chronologique = [...periodes].sort((a, b) => a.dateDebut.localeCompare(b.dateDebut) || a.dateFin.localeCompare(b.dateFin));
  return (
    chronologique.find((p) => situationPeriode(p, aujourdHui) === "en-cours") ??
    chronologique.find((p) => situationPeriode(p, aujourdHui) === "a-venir") ??
    chronologique[chronologique.length - 1]
  );
}
