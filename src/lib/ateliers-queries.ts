import { db } from "./db";
import { todayIso } from "./dates";
import { isStaff, type UserLike } from "./permissions";

/**
 * Séances à venir non annulées (pour les listes déroulantes).
 *
 * Même règle qu'à l'onglet Séances : on ne propose que les trimestres où la personne est invitée,
 * l'équipe voyant tout. Sans ce filtre, la liste « séance souhaitée » d'une proposition d'atelier
 * révélerait les dates et les lieux d'un trimestre auquel on n'appartient pas.
 *
 * `user` est optionnel le temps que tous les appelants le transmettent ; sans lui, aucun filtre
 * n'est appliqué — ne jamais l'omettre depuis un écran ouvert aux membres.
 */
export async function seancesAVenir(user?: (UserLike & { id: string }) | null) {
  const sienne = !user || isStaff(user) ? {} : { membres: { some: { userId: user.id } } };
  return db.session.findMany({
    where: { date: { gte: todayIso() }, annulee: false, period: { ...sienne, statut: { not: "CLOSE" } } },
    orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
    select: { id: true, date: true, heureDebut: true, lieu: true },
    take: 40,
  });
}
