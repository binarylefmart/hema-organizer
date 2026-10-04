"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/request-info";
import { annulerDesinscription, appliquerDesinscription, CHEMIN_DESINSCRIPTION, type EtatDesinscription } from "@/lib/notifications/desinscription";

/**
 * Les deux gestes de la page de désinscription, tous les deux en **POST**.
 *
 * Couper les rappels se faisait à l'ouverture du lien, donc sur un GET : une messagerie qui
 * précharge (Outlook Safe Links, antivirus, générateur d'aperçu) désinscrivait la personne sans
 * qu'elle ait cliqué, et le jeton vaut un an. La page ne fait plus que demander confirmation ;
 * c'est le bouton qui écrit — même découpage que `/invitation/[token]`.
 *
 * Aucune connexion n'est ouverte et rien d'autre n'est lisible ni modifiable : un jeton trafiqué,
 * périmé ou pointant sur un compte inconnu ne fait rien du tout. Les deux gestes sont journalisés
 * avec, comme acteur, la personne du jeton — c'est la seule identité qu'un lien de désinscription
 * connaisse, et sans elle le journal ne gardait aucune trace de ces écritures.
 */
async function basculerRappels(jeton: string, actif: boolean): Promise<EtatDesinscription> {
  // Page publique atteinte depuis un email : on borne les bascules par adresse (clé déjà prévue)
  if (!(await checkRateLimit("unsubscribe_ip", await clientIp()))) return { ok: false };
  const res = actif ? await annulerDesinscription(jeton) : await appliquerDesinscription(jeton);
  if (res.ok && res.userId) {
    await audit({ id: res.userId, email: res.email ?? null }, actif ? "rappels.reactives" : "rappels.desinscrit", res.userId, { via: "lien_email" });
  }
  return res;
}

/** Bouton « Ne plus recevoir les rappels » : le seul geste qui coupe `User.rappelEmail`. */
export async function confirmerDesinscription(jeton: string): Promise<void> {
  await basculerRappels(jeton, false);
  redirect(`${CHEMIN_DESINSCRIPTION}/${jeton}?etat=inactif`);
}

/** Bouton « Réactiver les rappels » : l'exact inverse, même lien signé, même vérification. */
export async function reactiverRappels(jeton: string): Promise<void> {
  await basculerRappels(jeton, true);
  redirect(`${CHEMIN_DESINSCRIPTION}/${jeton}?etat=actif`);
}
