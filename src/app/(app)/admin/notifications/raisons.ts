import { RAISON_API_EXCLUE, type Canal, type TypeNotification } from "@/lib/notifications/preferences";

/**
 * **Pourquoi cette cellule de la matrice est vide** — la phrase affichée dans l'infobulle d'un
 * « sans objet ».
 *
 * Elle vivait dans `page.tsx`, d'où la matrice est partie pour devenir un tableau. Plutôt que de la
 * suivre dans le composant, elle a **son module, sans JSX** : c'est une règle, pas un affichage, et
 * c'est la seule forme qui se relit par un test unitaire (même raison que `reglagesVides` dans
 * `src/components/planning/options.ts`, ou `rangement.ts` pour les rangs des parties — le dépôt
 * range ses règles hors des écrans pour que le test les partage au lieu de les recopier).
 *
 * Deux familles, et **une case ou une raison, jamais les deux, jamais aucune** :
 *
 * 1. le canal « Site du club » a sa raison **par notification** ({@link RAISON_API_EXCLUE}),
 *    affichée telle quelle — un réglage absent sans explication passe pour un oubli, et quelqu'un
 *    finit par l'« ajouter ». Le repli n'est là que pour une notification ajoutée demain sans sa
 *    phrase : il dit la règle, il n'invente pas de motif ;
 * 2. les canaux de salon (Discord, Telegram, WhatsApp) ont la **règle commune** : un message qui
 *    nomme quelqu'un, ou qui ne regarde que le bureau, reste sur les canaux personnels.
 */
/**
 * **Pourquoi cette case est grisée alors que son canal marche** — le couple existe comme réglage,
 * mais aucun envoi du code ne le sert encore (`COUPLES_EMIS`). C'était une pastille « prévu » dans
 * la cellule ; la case grisée le dit déjà, cette phrase reste pour qui demande pourquoi.
 */
export const RAISON_NON_EMIS =
  "Ce canal ne porte pas encore cette notification : le réglage existe d'avance, rien ne partira tant que l'envoi correspondant n'est pas écrit.";

export function raisonSansObjet(type: TypeNotification, canal: Canal): string {
  if (canal === "api") return RAISON_API_EXCLUE[type] ?? "Cette notification ne se republie pas sur le site du club.";
  return "Cette notification part par email et sur le téléphone : elle nomme quelqu'un, ou ne regarde que le bureau.";
}
