import { headers } from "next/headers";

/**
 * Informations sur la requête courante, telles que les pose Nginx Proxy Manager devant nous.
 *
 * **L'adresse du visiteur est une donnée de sécurité** : c'est sur elle que comptent tous les
 * limiteurs de débit — connexion, jetons d'invitation inconnus, API publique, pages de partage — et
 * c'est elle que retient le journal d'audit. Se tromper d'adresse, ce n'est pas afficher une
 * mauvaise ligne : c'est donner à chacun autant de quotas qu'il veut d'en-têtes.
 */

/**
 * L'adresse du visiteur, prise **au dernier maillon** de `X-Forwarded-For` et non au premier.
 *
 * `X-Forwarded-For` est une liste que chaque relais **complète** : le proxy y ajoute l'adresse de
 * qui vient de lui parler. Le dernier élément est donc celui que *notre* proxy a constaté, le seul
 * qu'un visiteur ne puisse pas écrire lui-même. Les précédents, eux, viennent du client : prendre
 * le premier, comme on le faisait, revenait à laisser chacun choisir son adresse en ajoutant une
 * ligne d'en-tête — et à annuler d'un coup tous les quotas, y compris celui qui protège les liens
 * personnels contre la devinette.
 *
 * **Corollaire de déploiement, aussi important que ce code : l'application ne doit être joignable
 * que par le proxy.** Ce code protège contre un en-tête forgé qui traverse le proxy ; il ne peut
 * rien contre quelqu'un qui atteindrait l'application *sans* passer par lui, puisque le dernier
 * maillon serait alors le sien. Et l'application ne peut pas s'en défendre seule — elle ne voit pas
 * l'adresse de la connexion, seulement des en-têtes. C'est donc au réseau de fermer la porte :
 * port lié à la passerelle Docker, ou pare-feu limité à l'adresse du proxy. Voir la note dans
 * `docs/portainer-stack.yml`, qui décrit le montage réellement en place.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const maillons = xff.split(",").map((m) => m.trim()).filter(Boolean);
    const dernier = maillons.at(-1);
    if (dernier) return dernier;
  }
  // Posé par le proxy lui aussi, et lui ne porte qu'une valeur : pas de choix à faire.
  return h.get("x-real-ip") ?? "inconnue";
}

export async function userAgent(): Promise<string> {
  const h = await headers();
  return (h.get("user-agent") ?? "").slice(0, 255);
}
