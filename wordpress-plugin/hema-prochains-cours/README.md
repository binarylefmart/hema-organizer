# HEMA — Prochains cours (plugin WordPress)

Affiche les prochains cours du club sur le site WordPress, à partir de l'API publique de
**HEMA Organizer**. Aucune donnée de membre ne circule : l'API ne publie que la date, l'horaire, le
lieu, le thème, l'état (annulé ou non) et le taux de participation d'une séance.

## Installation

1. Compresser le dossier `hema-prochains-cours` en `.zip`.
2. Dans WordPress : **Extensions → Ajouter → Téléverser une extension**, choisir le `.zip`, installer, activer.
3. Aller dans **Réglages → Prochains cours HEMA** et renseigner :
   - **Adresse de l'API** : `https://organizer.mon-club.fr/api/public/prochaines-seances`
   - **Adresse de l'application** : `https://organizer.mon-club.fr` (bouton « Indiquer ma présence » ; laisser vide pour ne pas l'afficher)
   - **Nombre de cours** affichés par défaut.

L'API doit être ouverte côté application : **Espace admin → Notifications → carte « Publication des cours
sur le site du club » → « Publier les prochains cours »**. Elle est **fermée par défaut**, et la
refermer retire le planning du site dès l'appel suivant.

## Affichage

Placer le shortcode dans une page, un article ou un widget :

```
[hema_prochains_cours]
[hema_prochains_cours limite="3" titre="Prochains entraînements"]
[hema_prochains_cours limite="5" taux="oui"]
```

| Attribut | Défaut | Rôle |
|---|---|---|
| `limite` (ou `limit`) | réglage du plugin | Nombre de cours affichés, de 1 à 20 |
| `titre` | *(aucun)* | Titre affiché au-dessus des cartes |
| `taux` | `non` | `oui` ajoute « 72 % de participation » sur chaque carte |

**Elementor** : utiliser le widget **Shortcode** et y coller la même ligne.

## Ce que fait le plugin

- Un appel `wp_remote_get` vers l'API, **mis en cache 15 minutes** (transient WordPress).
- Un **cache de secours de 7 jours**, réservé aux **pannes** : si l'application est injoignable
  (mise à jour de l'image, coupure réseau, DNS), la page continue d'afficher le dernier planning
  connu plutôt qu'un vide.
- **Un refus n'est pas une panne, et il s'applique tout de suite.** Si l'application répond autre
  chose qu'un planning — et c'est ce qu'elle fait, par un `503`, quand « Publier les prochains
  cours » est **décochée** dans l'espace admin —, les deux caches sont **vidés** et la page cesse
  d'afficher les cours **immédiatement**. Décocher la case dans l'application suffit donc à retirer
  le planning du site : il n'y a rien à faire côté WordPress, et rien ne survit une semaine.
- Tout est échappé à l'affichage (`esc_html`, `esc_url`) ; aucune donnée n'est stockée en base
  hormis les réglages et ces deux caches, supprimés à la désinstallation.
- Les styles sont préfixés `.hema-` et ne sont chargés que sur les pages qui portent le shortcode.
  Les couleurs sont des variables CSS posées sur `.hema-cours` : un site peut les surcharger sans
  réécrire la feuille.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Rien ne s'affiche (visiteur), un message d'explication (administrateur) | « Publier les prochains cours » décochée dans l'application (cas le plus fréquent), adresse de l'API absente, ou application injoignable |
| « Aucun cours programmé pour l'instant » | Aucune séance à venir dans une période **active** |
| Le planning ne se met pas à jour | Cache de 15 minutes : enregistrer la page de réglages le vide |
| Erreur 503 en appelant l'API à la main | « Publier les prochains cours » est décochée dans l'espace admin (Notifications) : le plugin cesse alors d'afficher les cours dès l'appel suivant, cache de secours compris |

La réponse de l'API se vérifie dans un navigateur ou en ligne de commande :

```bash
curl "https://organizer.mon-club.fr/api/public/prochaines-seances?limit=3"
```
