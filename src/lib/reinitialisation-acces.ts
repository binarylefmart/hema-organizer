import { db } from "@/lib/db";
import { conditionLiensARevoquer, envoyerInvitation, revokeInvitation } from "@/lib/invitations";
import { revokeAllSessions } from "@/lib/auth/session";
import { estCompteDeService } from "@/lib/permissions";

/**
 * **Ce que fait « Envoyer l'invitation » (remettre l'accès à zéro), sans ses verrous.**
 *
 * Deux portes y mènent : la personne seule (`reinitialiserAccesMembre`, src/actions/membres.ts) et
 * plusieurs d'un coup (`reinitialiserAccesEnMasse`, l'annuaire). La mécanique vit ici, une fois, pour
 * qu'elles ne puissent pas diverger sur ce qu'elles effacent ; **les gardes, elles, restent dans
 * chaque action** — ce module n'est pas un fichier `"use server"`, il ne se rappelle pas du dehors, et
 * aucun appelant ne doit l'atteindre sans avoir d'abord vérifié permission, `canEditUser`, portail et
 * code récent.
 */
export type CibleReinitialisation = { id: string; email: string | null; actif: boolean; service: boolean };

export type IssueReinitialisation = { liensRevoques: number; sessionsFermees: number; lienRenvoye: boolean };

export async function remettreAccesAZero(cible: CibleReinitialisation): Promise<IssueReinitialisation> {
  const userId = cible.id;
  // Ce qui est effacé : les deux facteurs, et de quoi les contourner.
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: null, doitChangerMotDePasse: false, totpSecret: null, totpActiveAt: null, codesSecours: null, deuxFaProposeeLe: null },
  });
  // Les liens en cours partent avec : « réinitialiser » doit vouloir dire qu'aucune porte ne reste
  // ouverte. Le motif `MANUEL` dit au journal que c'est une décision, pas une révocation de sécurité.
  //
  // **Toutes** les invitations encore valables, pas seulement celles à `revokedAt: null`
  // (`conditionLiensARevoquer`, src/lib/invitations.ts). Scénario corrigé : boîte mail compromise,
  // accès remis à zéro — mais un trimestre antérieur était clos, donc son lien portait déjà le motif
  // `CLOTURE` et la remise à zéro le **sautait** en lui laissant ce motif. Le bureau rouvre ensuite
  // ce trimestre pour corriger une présence, et la réouverture rend précisément les liens `CLOTURE` :
  // le vieux lien redevenait valable, dans la boîte qu'on avait justement voulu fermer.
  const liens = await db.invitation.findMany({ where: { userId, ...conditionLiensARevoquer() }, select: { id: true } });
  for (const lien of liens) await revokeInvitation(lien.id);
  // …et les appareils déjà connectés, sans épargner personne : une session ouverte survivrait à tout
  // le reste et rendrait la remise à zéro décorative.
  const sessionsFermees = await revokeAllSessions(userId, false);

  /*
   * **Et on lui rend une porte.** Remettre l'accès à zéro sans rien renvoyer laissait la personne
   * dehors sans qu'elle le sache : ses liens étaient morts, ses appareils déconnectés, et aucun
   * email ne partait.
   *
   * **Et tout recommence pour de bon** : le lien neuf rejoue le **parcours d'entrée complet**
   * (`parcours: "force"`) — installer l'application, se donner un mot de passe, activer la double
   * authentification —, ce qui est exactement la situation où se trouve la personne, ses deux
   * facteurs venant d'être effacés. L'email le dit dans ces termes (motif `reinitialisation`), là
   * où « régénérer et envoyer » se contente de renvoyer un lien sans rien rejouer.
   *
   * Sinon (pas d'adresse, pas de trimestre en cours) on ne peut rien envoyer : le journal le dit,
   * et l'équipe reprend la main depuis la fiche.
   */
  const inscription = cible.email && cible.actif && !estCompteDeService(cible)
    ? await db.periodMember.findFirst({
        where: { userId, period: { statut: "ACTIVE" } },
        orderBy: { period: { dateDebut: "desc" } },
        select: { periodId: true },
      })
    : null;
  const lienRenvoye = inscription
    ? await envoyerInvitation(userId, inscription.periodId, "reinitialisation", { deconnecterAppareils: "tous", parcours: "force" })
    : false;
  return { liensRevoques: liens.length, sessionsFermees, lienRenvoye };
}
