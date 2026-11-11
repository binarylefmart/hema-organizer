import { db } from "@/lib/db";
import { parisDateTime } from "@/lib/dates";
import { audit, type AuditActeur } from "@/lib/audit";
import { estDesistement, dansFenetreDesistementTardif } from "@/lib/notifications/desistement";
import { getDelaiDesistementMin } from "@/lib/settings";

/**
 * **L'historique des réponses** (`AttendanceChange`, demande de Delta : « un log sur les
 * changements de dispo sur chaque séance », et le nombre de désistements sur la fiche des adhérents).
 *
 * Une ligne par réponse **réellement changée** (avant ≠ après), quel que soit le chemin : la personne
 * elle-même (`indiquerPresence`, `repondrePourLaPeriode`) ou une correction du bureau
 * (`modifierPresenceMembre`, `modifierPresencesEnMasse` — `auteurId` est alors celui de l'admin).
 *
 * - `desistement` : la transition retire une présence (`estDesistement` : Présent → Absent ou
 *   Peut-être, Peut-être → Absent), la même règle que l'alerte aux instructeurs ;
 * - `tardif` : elle tombe dans le délai d'alerte réglé **à ce moment-là** (`desistement.delaiMinutes`).
 *
 * **Ne lève jamais**, comme `audit()` : la réponse est déjà écrite quand on note, et un historique qui
 * hoquette ne doit ni la défaire ni l'afficher en erreur.
 */
export type ChangementReponse = { sessionId: string; userId: string; avant: string | null; apres: string | null };

export async function noterChangementsReponse(auteur: NonNullable<AuditActeur>, changements: readonly ChangementReponse[], now = new Date()): Promise<void> {
  const auteurId = auteur.id;
  const utiles = changements.filter((c) => c.avant !== c.apres);
  if (utiles.length === 0) return;
  try {
    const ids = [...new Set(utiles.map((c) => c.sessionId))];
    const [seances, delaiMin] = await Promise.all([
      db.session.findMany({ where: { id: { in: ids } }, select: { id: true, date: true, heureDebut: true } }),
      getDelaiDesistementMin(),
    ]);
    const parId = new Map(seances.map((s) => [s.id, s]));
    const lignes = utiles.map((c) => {
      const desistement = c.apres !== null && estDesistement(c.avant, c.apres) !== null;
      const s = parId.get(c.sessionId);
      return {
        sessionId: c.sessionId,
        userId: c.userId,
        auteurId,
        avant: c.avant,
        apres: c.apres,
        desistement,
        tardif: desistement && !!s && dansFenetreDesistementTardif(s.date, s.heureDebut, now, delaiMin),
        createdAt: now,
      };
    });
    await db.attendanceChange.createMany({ data: lignes });
    /*
     * **L'horodatage, dans le journal d'audit et nulle part ailleurs** (Delta : « je veux
     * l'horodatage dans les logs, pas pour les users »). Les écrans des instructeurs ne disent que
     * l'écart au cours ; le journal (bureau, `audit.view`) garde l'instant exact, l'IP et la séance.
     * Une correction du bureau a déjà sa ligne (`presence.modifiee_par_admin`) : on ne la double pas.
     */
    for (const l of lignes) {
      if (l.userId !== auteurId) continue;
      const s = parId.get(l.sessionId);
      await audit(auteur, l.desistement ? "presence.desistement" : "presence.reponse", l.userId, {
        sessionId: l.sessionId,
        seance: s ? `${s.date} ${s.heureDebut}` : null,
        avant: l.avant,
        apres: l.apres,
        ...(l.desistement ? { derniereMinute: l.tardif } : {}),
        avantCoursMin: s ? minutesAvantCours(now, s.date, s.heureDebut) : null,
      });
    }
  } catch (e) {
    console.error("[historique] changement de réponse non noté (non bloquant)", e);
  }
}

/**
 * **Les désistements d'une personne**, pour sa fiche : le nombre de **séances** dont elle s'est retirée
 * (un aller-retour Présent → Absent → Présent → Absent sur la même séance compte une fois), et parmi
 * elles celles où le retrait est tombé dans le délai d'alerte. Les séances annulées ne comptent pas :
 * se retirer d'un cours qui n'a pas lieu n'est pas un désistement.
 */
export async function compterDesistements(userId: string): Promise<{ seances: number; tardifs: number }> {
  const lignes = await db.attendanceChange.findMany({
    where: { userId, desistement: true, session: { annulee: false } },
    select: { sessionId: true, tardif: true },
  });
  const seances = new Set(lignes.map((l) => l.sessionId));
  const tardifs = new Set(lignes.filter((l) => l.tardif).map((l) => l.sessionId));
  return { seances: seances.size, tardifs: tardifs.size };
}

export type LigneHistorique = {
  id: string;
  quand: Date;
  personne: string;
  /** Qui a écrit, quand ce n'est pas la personne elle-même (correction du bureau) */
  par: string | null;
  avant: string | null;
  apres: string | null;
  desistement: boolean;
  tardif: boolean;
  /** Minutes entre le changement et le début du cours (négatif : après le début) */
  avantCoursMin: number;
};

/** Minutes entre un instant et le début d'un cours (fonction pure). */
export function minutesAvantCours(quand: Date, date: string, heureDebut: string): number {
  return Math.floor((parisDateTime(date, heureDebut).getTime() - quand.getTime()) / 60_000);
}

/** « 45 min avant le cours », « 3 h 20 avant le cours », « 2 j 4 h avant le cours », « après le début du cours ». */
export function libelleAvantCours(minutes: number): string {
  if (minutes <= 0) return "après le début du cours";
  if (minutes < 60) return `${minutes} min avant le cours`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""} avant le cours`;
  }
  const j = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return `${j} j${h ? ` ${h} h` : ""} avant le cours`;
}

/** L'historique d'une séance, le plus récent d'abord. */
export async function historiqueSeance(sessionId: string, limite = 200): Promise<LigneHistorique[]> {
  const lignes = await db.attendanceChange.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: limite,
    include: { user: { select: { prenom: true, nom: true } }, auteur: { select: { prenom: true, nom: true } }, session: { select: { date: true, heureDebut: true } } },
  });
  return lignes.map((l) => ({
    id: l.id,
    quand: l.createdAt,
    personne: `${l.user.prenom} ${l.user.nom}`.trim(),
    par: l.auteurId && l.auteurId !== l.userId ? (l.auteur ? `${l.auteur.prenom} ${l.auteur.nom}`.trim() : "un compte supprimé") : null,
    avant: l.avant,
    apres: l.apres,
    desistement: l.desistement,
    tardif: l.tardif,
    avantCoursMin: minutesAvantCours(l.createdAt, l.session.date, l.session.heureDebut),
  }));
}

/** Les tranches de délai du tableau de bord, de la plus tardive à la plus anticipée. */
export const TRANCHES_DELAI: ReadonlyArray<{ libelle: string; maxMin: number }> = [
  { libelle: "Moins de 2 h avant", maxMin: 120 },
  { libelle: "2 h à 24 h avant", maxMin: 1440 },
  { libelle: "1 à 3 jours avant", maxMin: 3 * 1440 },
  { libelle: "3 à 7 jours avant", maxMin: 7 * 1440 },
  { libelle: "1 à 2 semaines avant", maxMin: 14 * 1440 },
  { libelle: "Plus de 2 semaines avant", maxMin: Number.POSITIVE_INFINITY },
];

export type StatsDesistements = {
  /** Changements de réponse notés sur ces séances */
  changements: number;
  /** Désistements : couples personne × séance distincts */
  desistements: number;
  /** Dont dans le délai d'alerte réglé au moment du désistement */
  tardifs: number;
  /** Personnes qui se sont désistées au moins une fois */
  personnes: number;
  /** Délai médian entre le désistement et le cours, en minutes (null : aucun désistement) */
  medianeMin: number | null;
  tranches: Array<{ libelle: string; n: number }>;
  parMembre: Array<{ userId: string; nom: string; n: number; tardifs: number }>;
  parSeance: Array<{ id: string; date: string; heureDebut: string; n: number }>;
  derniers: Array<{ id: string; quand: Date; nom: string; avant: string | null; apres: string | null; tardif: boolean; avantCoursMin: number; sessionId: string; date: string }>;
};

/**
 * **Les chiffres des désistements** sur un ensemble de séances (tableau de bord, instructeurs et
 * bureau). Un désistement = une personne × une séance, compté une fois même après plusieurs
 * allers-retours ; son délai est celui du **dernier** retrait. Séances annulées exclues.
 */
export async function statsDesistements(sessionIds: readonly string[]): Promise<StatsDesistements> {
  const ids = [...sessionIds];
  const [changements, lignes] = await Promise.all([
    db.attendanceChange.count({ where: { sessionId: { in: ids }, session: { annulee: false } } }),
    db.attendanceChange.findMany({
      where: { sessionId: { in: ids }, desistement: true, session: { annulee: false } },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { prenom: true, nom: true } }, session: { select: { date: true, heureDebut: true } } },
    }),
  ]);
  return calculerStatsDesistements(changements, lignes);
}

type LigneStat = {
  id: string;
  sessionId: string;
  userId: string;
  avant: string | null;
  apres: string | null;
  tardif: boolean;
  createdAt: Date;
  user: { prenom: string; nom: string };
  session: { date: string; heureDebut: string };
};

/** Le calcul seul, sur des lignes déjà lues (les plus récentes d'abord) — fonction pure. */
export function calculerStatsDesistements(changements: number, lignes: readonly LigneStat[]): StatsDesistements {
  // Le dernier retrait de chaque couple personne × séance (les lignes arrivent du plus récent au plus ancien).
  const couples = new Map<string, LigneStat & { tardifCouple: boolean }>();
  for (const l of lignes) {
    const cle = `${l.userId}|${l.sessionId}`;
    const deja = couples.get(cle);
    if (!deja) couples.set(cle, { ...l, tardifCouple: l.tardif });
    else if (l.tardif) deja.tardifCouple = true;
  }
  const liste = [...couples.values()];
  const delais = liste.map((c) => minutesAvantCours(c.createdAt, c.session.date, c.session.heureDebut)).sort((a, b) => a - b);
  const mediane = delais.length === 0 ? null : delais.length % 2 ? delais[(delais.length - 1) / 2] : Math.round((delais[delais.length / 2 - 1] + delais[delais.length / 2]) / 2);

  const tranches = TRANCHES_DELAI.map((t) => ({ libelle: t.libelle, n: 0 }));
  for (const d of delais) {
    // Borne haute comprise pour la première tranche (pile 2 h avant = « moins de 2 h ») ; une
    // correction après le début du cours y tombe aussi.
    const i = TRANCHES_DELAI.findIndex((t, k) => (k === 0 ? d <= t.maxMin : d < t.maxMin));
    tranches[i].n += 1;
  }

  const membres = new Map<string, { userId: string; nom: string; n: number; tardifs: number }>();
  const seances = new Map<string, { id: string; date: string; heureDebut: string; n: number }>();
  for (const c of liste) {
    const m = membres.get(c.userId) ?? { userId: c.userId, nom: `${c.user.prenom} ${c.user.nom}`.trim(), n: 0, tardifs: 0 };
    m.n += 1;
    if (c.tardifCouple) m.tardifs += 1;
    membres.set(c.userId, m);
    const s = seances.get(c.sessionId) ?? { id: c.sessionId, date: c.session.date, heureDebut: c.session.heureDebut, n: 0 };
    s.n += 1;
    seances.set(c.sessionId, s);
  }
  const parNombre = <T extends { n: number }>(a: T, b: T) => b.n - a.n;

  return {
    changements,
    desistements: liste.length,
    tardifs: liste.filter((c) => c.tardifCouple).length,
    personnes: membres.size,
    medianeMin: mediane,
    tranches,
    parMembre: [...membres.values()].sort((a, b) => parNombre(a, b) || b.tardifs - a.tardifs || a.nom.localeCompare(b.nom, "fr")).slice(0, 10),
    parSeance: [...seances.values()].sort((a, b) => parNombre(a, b) || a.date.localeCompare(b.date)).slice(0, 5),
    derniers: lignes.slice(0, 15).map((l) => ({
      id: l.id,
      quand: l.createdAt,
      nom: `${l.user.prenom} ${l.user.nom}`.trim(),
      avant: l.avant,
      apres: l.apres,
      tardif: l.tardif,
      avantCoursMin: minutesAvantCours(l.createdAt, l.session.date, l.session.heureDebut),
      sessionId: l.sessionId,
      date: l.session.date,
    })),
  };
}
