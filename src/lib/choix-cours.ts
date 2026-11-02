import { db } from "@/lib/db";
import { nomOption, type ChoixLu } from "@/components/seances/choix-cours";

/**
 * **Les choix de cours suivent la réponse « Absent »** : qui ne vient pas ne suit aucun cours. Appelé
 * par **chaque** chemin qui écrit une réponse — le membre pour une séance (`indiquerPresence`), pour
 * une période (`repondrePourLaPeriode`), et le bureau qui corrige (`modifierPresenceMembre`,
 * `modifierPresencesEnMasse`). « Peut-être » garde les choix (ils ne sont ni montrés ni comptés tant
 * que la réponse n'est pas « Présent »), pour qu'un hésitant qui revient à « Présent » les retrouve.
 *
 * Ne lève jamais : un choix resté en base après un échec ne fausse aucun taux — les compteurs ne
 * lisent que les choix des présents.
 */
export async function effacerChoixSiAbsent(userIds: readonly string[], sessionIds: readonly string[], statut: string | null): Promise<void> {
  // Une réponse effacée par le bureau (`null`) ne laisse pas de choix derrière elle non plus.
  if ((statut !== "ABSENT" && statut !== null) || userIds.length === 0 || sessionIds.length === 0) return;
  try {
    await db.attendanceChoix.deleteMany({ where: { userId: { in: [...userIds] }, partie: { sessionId: { in: [...sessionIds] } } } });
  } catch (e) {
    console.error("[choix des cours] effacement après « Absent » : échec non bloquant", e);
  }
}

/**
 * **Les choix des présents sur un ensemble de séances**, pour le tableau de bord : seuls comptent les
 * choix d'une personne **invitée sur la période** (règle de tous les compteurs du dépôt) dont la
 * réponse à cette séance est « Présent ». Un choix resté après un « Peut-être » ne compte pas.
 */
export async function choixDesPresents(periodId: string, sessionIds: readonly string[]): Promise<ChoixLu[]> {
  if (sessionIds.length === 0) return [];
  const [choix, presents] = await Promise.all([
    db.attendanceChoix.findMany({
      where: { partie: { sessionId: { in: [...sessionIds] } }, user: { service: false, periodes: { some: { periodId } } } },
      select: {
        userId: true,
        partie: { select: { id: true, sessionId: true, libelle: true, theme: true, niveau: true, atelier: { select: { titre: true } }, session: { select: { date: true } } } },
      },
    }),
    db.attendance.findMany({ where: { sessionId: { in: [...sessionIds] }, statut: "PRESENT" }, select: { userId: true, sessionId: true } }),
  ]);
  const present = new Set(presents.map((a) => `${a.userId}:${a.sessionId}`));
  return choix
    .filter((c) => present.has(`${c.userId}:${c.partie.sessionId}`))
    .map((c) => ({ partieId: c.partie.id, sessionId: c.partie.sessionId, nom: nomOption(c.partie), niveau: c.partie.niveau, date: c.partie.session.date }));
}
