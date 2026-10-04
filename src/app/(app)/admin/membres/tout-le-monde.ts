import { can, type UserLike } from "@/lib/permissions";

/**
 * **« Pour tout le monde » : qui est derrière ces trois mots**, écrit une fois et lu deux fois — par
 * l'écran, qui annonce le nombre dans la confirmation, et par le serveur, qui agit. Si l'un et
 * l'autre recomposaient la population chacun de son côté, le chiffre de la confirmation finirait par
 * ne plus être celui du geste.
 *
 * C'est le périmètre des cases à cocher, étendu à tout l'annuaire au lieu de la page affichée : ni le
 * compte du portail, ni son propre compte (on ne ferme pas la porte de l'intérieur, comme « Désactiver
 * tous les comptes »), et un compte du bureau seulement pour qui peut modifier le bureau — c'est la
 * question que pose `canEditUser`, traduite en filtre de base.
 *
 * Module sans `"use server"` ni accès à la base : il ne rend que des filtres.
 */
export function perimetreToutLeMonde(acteur: UserLike & { id: string }) {
  return {
    service: false,
    id: { not: acteur.id },
    ...(can(acteur, "admins.manage") ? {} : { estAdmin: false }),
  };
}

/**
 * **Un lien qui ouvre encore une porte** pour la période des liens : non révoqué et non échu. C'est
 * la question de la colonne « État du lien » (`aUnLienEnCours`, `page.tsx`), du bouton « Révoquer le
 * lien » d'une ligne et de leurs deux versions de masse.
 */
export function lienVivant(periodId: string, maintenant: Date = new Date()) {
  return { periodId, revokedAt: null, expiresAt: { gt: maintenant } };
}

/**
 * **Qui recevra un email d'« Envoyer l'invitation »** : la remise à zéro n'envoie une invitation neuve
 * qu'à un compte actif, avec une adresse et inscrit à une période active (`remettreAccesAZero`). Les
 * autres sont remis à zéro sans rien recevoir — la confirmation dit les deux chiffres.
 */
export const RECOIT_INVITATION = { actif: true, email: { not: null }, periodes: { some: { period: { statut: "ACTIVE" } } } } as const;

/**
 * **« Déjà entré » et « jamais entré », en filtres de base** — la traduction de `aDejaUnAcces`
 * (src/lib/membres.ts) pour compter et choisir tout l'annuaire sans le rapatrier. Les quatre témoins
 * sont les mêmes, dans le même ordre ; `tests/unit/membres-acces-gestes.test.ts` vérifie que les deux
 * écritures disent la même chose. Un compte est exactement dans l'un des deux.
 */
export const DEJA_ENTRE = {
  OR: [{ invitations: { some: { usedAt: { not: null } } } }, { passwordHash: { not: null } }, { totpActiveAt: { not: null } }, { authSessions: { some: {} } }],
};
export const JAMAIS_ENTRE = {
  invitations: { none: { usedAt: { not: null } } },
  passwordHash: null,
  totpActiveAt: null,
  authSessions: { none: {} },
};
