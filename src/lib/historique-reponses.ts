import { db } from "@/lib/db";
import { parisDateTime } from "@/lib/dates";
import { audit, type AuditActeur } from "@/lib/audit";
import { estDesistement, fenetreDesistement } from "@/lib/notifications/desistement";
import { getDelaisDesistement } from "@/lib/settings";

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
 * - `tardif` : elle tombe dans une fenêtre d'alerte réglée **à ce moment-là** (désistement ou dernière
 *   minute) — une alerte est partie aux instructeurs ;
 * - `derniereMinute` : dans la fenêtre du **désistement de dernière minute** (`desistement.derniereMinuteMinutes`).
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
    const [seances, delais] = await Promise.all([
      db.session.findMany({ where: { id: { in: ids } }, select: { id: true, date: true, heureDebut: true } }),
      getDelaisDesistement(),
    ]);
    const parId = new Map(seances.map((s) => [s.id, s]));
    const lignes = utiles.map((c) => {
      const desistement = c.apres !== null && estDesistement(c.avant, c.apres) !== null;
      const s = parId.get(c.sessionId);
      const fenetre = desistement && s ? fenetreDesistement(s.date, s.heureDebut, now, delais) : null;
      return {
        sessionId: c.sessionId,
        userId: c.userId,
        auteurId,
        avant: c.avant,
        apres: c.apres,
        desistement,
        tardif: fenetre !== null,
        derniereMinute: fenetre === "derniere_minute",
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
      // Trois actions, un préfixe commun (`presence.desistement`) : le raccourci « désistements » du
      // journal les retrouve toutes, « désistements de dernière minute » la seule qui le dit.
      const action = !l.desistement ? "presence.reponse" : l.derniereMinute ? "presence.desistement_derniere_minute" : "presence.desistement";
      await audit(auteur, action, l.userId, {
        sessionId: l.sessionId,
        seance: s ? `${s.date} ${s.heureDebut}` : null,
        avant: l.avant,
        apres: l.apres,
        ...(l.desistement ? { derniereMinute: l.derniereMinute, signale: l.tardif } : {}),
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
export async function compterDesistements(userId: string): Promise<{ seances: number; tardifs: number; derniereMinute: number }> {
  const lignes = await db.attendanceChange.findMany({
    where: { userId, desistement: true, session: { annulee: false } },
    select: { sessionId: true, tardif: true, derniereMinute: true },
  });
  const seances = new Set(lignes.map((l) => l.sessionId));
  const tardifs = new Set(lignes.filter((l) => l.tardif).map((l) => l.sessionId));
  const derniereMinute = new Set(lignes.filter((l) => l.derniereMinute).map((l) => l.sessionId));
  return { seances: seances.size, tardifs: tardifs.size, derniereMinute: derniereMinute.size };
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
  derniereMinute: boolean;
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
    derniereMinute: l.derniereMinute,
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
  /** Dont signalés aux instructeurs (une fenêtre d'alerte, réglée au moment du désistement) */
  tardifs: number;
  /** Dont désistements de dernière minute */
  derniereMinute: number;
  /** Personnes qui se sont désistées au moins une fois */
  personnes: number;
  /** Délai médian entre le désistement et le cours, en minutes (null : aucun désistement) */
  medianeMin: number | null;
  tranches: Array<{ libelle: string; n: number }>;
  parMembre: Array<{ userId: string; nom: string; n: number; tardifs: number; derniereMinute: number }>;
  parSeance: Array<{ id: string; date: string; heureDebut: string; n: number; derniereMinute: number }>;
  derniers: Array<{ id: string; quand: Date; nom: string; avant: string | null; apres: string | null; tardif: boolean; derniereMinute: boolean; avantCoursMin: number; sessionId: string; date: string }>;
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
  /** Absent des lignes écrites avant la v0.87.0 dans les tests : vaut faux. */
  derniereMinute?: boolean;
  createdAt: Date;
  user: { prenom: string; nom: string };
  session: { date: string; heureDebut: string };
};

/** Le calcul seul, sur des lignes déjà lues (les plus récentes d'abord) — fonction pure. */
export function calculerStatsDesistements(changements: number, lignes: readonly LigneStat[]): StatsDesistements {
  // Le dernier retrait de chaque couple personne × séance (les lignes arrivent du plus récent au plus ancien).
  const couples = new Map<string, LigneStat & { tardifCouple: boolean; derniereMinuteCouple: boolean }>();
  for (const l of lignes) {
    const cle = `${l.userId}|${l.sessionId}`;
    const deja = couples.get(cle);
    if (!deja) couples.set(cle, { ...l, tardifCouple: l.tardif, derniereMinuteCouple: l.derniereMinute === true });
    else {
      if (l.tardif) deja.tardifCouple = true;
      if (l.derniereMinute) deja.derniereMinuteCouple = true;
    }
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

  const membres = new Map<string, { userId: string; nom: string; n: number; tardifs: number; derniereMinute: number }>();
  const seances = new Map<string, { id: string; date: string; heureDebut: string; n: number; derniereMinute: number }>();
  for (const c of liste) {
    const m = membres.get(c.userId) ?? { userId: c.userId, nom: `${c.user.prenom} ${c.user.nom}`.trim(), n: 0, tardifs: 0, derniereMinute: 0 };
    m.n += 1;
    if (c.tardifCouple) m.tardifs += 1;
    if (c.derniereMinuteCouple) m.derniereMinute += 1;
    membres.set(c.userId, m);
    const s = seances.get(c.sessionId) ?? { id: c.sessionId, date: c.session.date, heureDebut: c.session.heureDebut, n: 0, derniereMinute: 0 };
    s.n += 1;
    if (c.derniereMinuteCouple) s.derniereMinute += 1;
    seances.set(c.sessionId, s);
  }
  const parNombre = <T extends { n: number }>(a: T, b: T) => b.n - a.n;

  return {
    changements,
    desistements: liste.length,
    tardifs: liste.filter((c) => c.tardifCouple).length,
    derniereMinute: liste.filter((c) => c.derniereMinuteCouple).length,
    personnes: membres.size,
    medianeMin: mediane,
    tranches,
    parMembre: [...membres.values()].sort((a, b) => parNombre(a, b) || b.derniereMinute - a.derniereMinute || b.tardifs - a.tardifs || a.nom.localeCompare(b.nom, "fr")).slice(0, 10),
    parSeance: [...seances.values()].sort((a, b) => parNombre(a, b) || a.date.localeCompare(b.date)).slice(0, 5),
    derniers: lignes.slice(0, 15).map((l) => ({
      id: l.id,
      quand: l.createdAt,
      nom: `${l.user.prenom} ${l.user.nom}`.trim(),
      avant: l.avant,
      apres: l.apres,
      tardif: l.tardif,
      derniereMinute: l.derniereMinute === true,
      avantCoursMin: minutesAvantCours(l.createdAt, l.session.date, l.session.heureDebut),
      sessionId: l.sessionId,
      date: l.session.date,
    })),
  };
}

/* ───────────────────── Le détail des désistements, filtrable (page dédiée) ─────────────────────
 *
 * Demande de Delta : « savoir qui exactement, avec le nombre de désistements sur la période, les
 * dates, et un filtrage par date et par nom ». Même règle de compte que la carte du tableau de bord :
 * un désistement = une personne × une séance (le dernier retrait), séances annulées exclues.
 * **Pas d'horodatage** : l'écran dit la date du cours et l'écart au cours, l'instant exact reste au
 * journal d'audit.
 */

export type TypeDesistementFiltre = "tous" | "signales" | "derniere_minute";

export type FiltresDesistements = {
  /** Identifiant de période, ou "" pour toutes */
  periodId: string;
  /** Date du cours, bornes comprises (AAAA-MM-JJ), "" = sans borne */
  du: string;
  au: string;
  /** Identifiant de la personne, "" = tout le monde */
  personne: string;
  type: TypeDesistementFiltre;
};

export type LigneDesistement = {
  id: string;
  userId: string;
  nom: string;
  sessionId: string;
  date: string;
  heureDebut: string;
  lieu: string;
  avant: string | null;
  apres: string | null;
  /** Les instructeurs ont été prévenus (une fenêtre d'alerte) */
  signale: boolean;
  derniereMinute: boolean;
  avantCoursMin: number;
};

export type PersonneDesistements = { userId: string; nom: string; n: number; derniereMinute: number; signales: number; dernierCours: string };

export type DetailDesistements = { lignes: LigneDesistement[]; parPersonne: PersonneDesistements[]; total: number; derniereMinute: number; personnes: number };

type LigneDetailBrute = {
  id: string;
  sessionId: string;
  userId: string;
  avant: string | null;
  apres: string | null;
  tardif: boolean;
  derniereMinute: boolean;
  createdAt: Date;
  user: { prenom: string; nom: string };
  session: { date: string; heureDebut: string; lieu: string };
};

/** Le calcul seul (fonction pure) : lignes lues du plus récent au plus ancien. */
export function calculerDetailDesistements(brutes: readonly LigneDetailBrute[], type: TypeDesistementFiltre = "tous"): DetailDesistements {
  const couples = new Map<string, LigneDesistement>();
  for (const l of brutes) {
    const cle = `${l.userId}|${l.sessionId}`;
    const deja = couples.get(cle);
    if (deja) {
      // Un aller-retour sur la même séance : le dernier retrait fait la ligne, un retrait signalé ou de
      // dernière minute plus ancien la qualifie quand même.
      deja.signale ||= l.tardif;
      deja.derniereMinute ||= l.derniereMinute;
      continue;
    }
    couples.set(cle, {
      id: l.id,
      userId: l.userId,
      nom: `${l.user.prenom} ${l.user.nom}`.trim(),
      sessionId: l.sessionId,
      date: l.session.date,
      heureDebut: l.session.heureDebut,
      lieu: l.session.lieu,
      avant: l.avant,
      apres: l.apres,
      signale: l.tardif,
      derniereMinute: l.derniereMinute,
      avantCoursMin: minutesAvantCours(l.createdAt, l.session.date, l.session.heureDebut),
    });
  }
  const garder = (l: LigneDesistement) => (type === "derniere_minute" ? l.derniereMinute : type === "signales" ? l.signale && !l.derniereMinute : true);
  // Le plus récent cours d'abord, puis l'heure, puis le nom : l'ordre de lecture d'un registre.
  const lignes = [...couples.values()].filter(garder).sort((a, b) => b.date.localeCompare(a.date) || b.heureDebut.localeCompare(a.heureDebut) || a.nom.localeCompare(b.nom, "fr"));
  const parId = new Map<string, PersonneDesistements>();
  for (const l of lignes) {
    const p = parId.get(l.userId) ?? { userId: l.userId, nom: l.nom, n: 0, derniereMinute: 0, signales: 0, dernierCours: l.date };
    p.n += 1;
    if (l.derniereMinute) p.derniereMinute += 1;
    else if (l.signale) p.signales += 1;
    if (l.date > p.dernierCours) p.dernierCours = l.date;
    parId.set(l.userId, p);
  }
  const parPersonne = [...parId.values()].sort((a, b) => b.n - a.n || b.derniereMinute - a.derniereMinute || a.nom.localeCompare(b.nom, "fr"));
  return { lignes, parPersonne, total: lignes.length, derniereMinute: lignes.filter((l) => l.derniereMinute).length, personnes: parPersonne.length };
}

/** Les désistements selon les filtres de la page (une seule lecture). */
export async function detailDesistements(f: FiltresDesistements): Promise<DetailDesistements> {
  const brutes = await db.attendanceChange.findMany({
    where: {
      desistement: true,
      ...(f.personne ? { userId: f.personne } : {}),
      session: {
        annulee: false,
        ...(f.periodId ? { periodId: f.periodId } : {}),
        ...(f.du || f.au ? { date: { ...(f.du ? { gte: f.du } : {}), ...(f.au ? { lte: f.au } : {}) } } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { prenom: true, nom: true } }, session: { select: { date: true, heureDebut: true, lieu: true } } },
  });
  return calculerDetailDesistements(brutes, f.type);
}
