import { db } from "./db";
import { NOMBRE_COULEURS } from "./couleurs";

/**
 * Numéro de couleur à donner à une nouvelle personne : le moins utilisé de la palette,
 * pour que deux membres du club n'aient jamais la même pastille tant qu'elle n'est pas épuisée.
 */
export async function prochaineCouleurLibre(): Promise<number> {
  const pris = await db.user.findMany({ where: { service: false, couleur: { not: null } }, select: { couleur: true } });
  const usages = new Array<number>(NOMBRE_COULEURS).fill(0);
  for (const { couleur } of pris) {
    if (couleur == null) continue;
    usages[((couleur % NOMBRE_COULEURS) + NOMBRE_COULEURS) % NOMBRE_COULEURS]++;
  }
  let choix = 0;
  for (let i = 1; i < NOMBRE_COULEURS; i++) if (usages[i] < usages[choix]) choix = i;
  return choix;
}
