# Notes de version

Ce que chaque version change, rédigé depuis l'historique du dépôt à chaque publication.

## 0.70.1

### Corrections

- **planning** : la barre de sélection ne colle plus, « Modifier le planning » est plein

## 0.70.0

### Nouveautés

- **planning** : modification multiple et « Sélectionner par jour »
- **seances** : « Modifier le programme » ouvre le planning sur les séances cochées
- **seances** : en modification, le programme est un bouton pleine largeur vers le planning

### Autres changements

- **e2e** : la carte du planning se retrouve depuis sa case

## 0.69.2

### Nouveautés

- **seances** : le thème détaillé ne se saisit plus — le programme se règle dans le planning

## 0.69.1

### Corrections

- **public** : aucun thème d'exemple dans le dépôt public, comme pour les lieux

## 0.69.0

### Nouveautés

- **seances** : modification par sélection, et l'interrupteur « Sélection multiple »
- **evenements** : les gestes d'une annonce passent par « Que veux-tu faire ? »
- **club** : le fuseau horaire se règle dans l'administration
- **ui** : plus aucune liste native — ChampListe et ListeDeroulante partout
- **seances** : lecture seule par défaut, « Modifier les séances » et « Que veux-tu faire ? »
- **seances** : l'alternative ne se saisit plus — les options et cours du planning la remplacent

### Corrections

- **build** : le fuseau se pose depuis demarrerTaches, plus depuis instrumentation
- **ui** : une liste déroulante n'élargit plus sa carte ; trois scénarios e2e remis à jour

### Autres changements

- **e2e** : la sélection des séances se teste en admin, après zz-liens ; état au 06/10
- **code** : pas de date d'arbitrage dans les fichiers publiés
- **club** : les thèmes du club quittent constants.ts, la palette --marque-* morte est retirée
- **e2e** : l'ajout d'un membre n'envoie aucun email ; « Gérer » visé seul dans l'annuaire
- **etat** : reprise au 05/10 — v0.68.1, cause du bouton bloqué, gestes rouges à jour

## 0.68.1

### Corrections

- **public** : un test ne dépend plus d'un prénom que le miroir remplace

## 0.68.0

### Nouveautés

- **evenements** : les gestes d'une annonce, seulement ceux qui s'y appliquent
- **ateliers** : chaque proposition pose « Que veux-tu faire ? »
- **membres** : le volet « Gérer » d'une ligne pose la même question que la fiche
- **presences** : la barre de correction ne propose que les réponses utiles
- **membres** : la fiche d'un membre pose « Que veux-tu faire ? »

### Corrections

- **react** : corriger le ping perdu du React embarqué par Next 15.5
- **attente** : « Que veux-tu faire ? » a la même garde d'attente que les autres boutons
- **attente** : relancer le rendu qu'une action laisse suspendu, et le dire si le serveur se tait
- **serveur** : journal WAL au démarrage et délai sur les envois push

### Autres changements

- **attente** : la cause mesurée est le ping perdu de pingSuspendedRoot, la relance devient la ceinture
- **gestes** : désactiver, dépublier et oublier passent aussi en rouge
- **gestes** : rouge pour tout ce qui supprime, efface, retire, réinitialise ou révoque
- **annulation** : « aujourd'hui » se compte à l'heure du club, pas en UTC
- **notifications** : chaque bouton d'enregistrement dit ce qu'il enregistre
- **e2e** : les rôles en masse passent par « Que veux-tu faire ? »
- **etat** : « Que veux-tu faire ? » partout dans l'administration
- **admin** : plus de vert, et le rouge gardé à ce qui ne se défait pas
- **ui** : « Que veux-tu faire ? » devient une forme commune

## 0.67.0

### Nouveautés

- **membres** : « Que veux-tu faire ? » — un geste, une explication, un bouton

### Corrections

- **membres** : « Au club depuis » se choisit en saison d'arrivée
- **admin** : l'espace admin ne se referme plus en plein travail

## 0.66.0

### Corrections

- **notifications** : les messages personnels ne partent qu'aux personnes qui ont un accès actif
- **liens** : le lien de début de trimestre ne part qu'à qui a déjà un lien en service
- **membres** : ajouter un membre n'envoie plus de lien tout seul

## 0.65.0

### Nouveautés

- **membres** : gestes d'accès à la ligne, en sélection et pour tout le monde
- **admin** : « Mise à jour disponible » dans le profil, avec ses notes de version

### Corrections

- **membres** : changer une adresse n'envoie plus de lien tout seul
- **suivi** : les constructions bougent à chaque image, et l'étape longue a sa barre de temps
- **suivi** : une construction en cours ne décale plus les colonnes du tableau

## 0.64.0

### Nouveautés

- **themes** : un thème choisi est clair ou sombre, et la liste les sépare
- **themes** : six accents Catppuccin de plus — Green, Lavender, Teal, Peach, Sapphire, Flamingo

### Corrections

- **lieux** : les salles du club reviennent dans « Thèmes et lieux »

## 0.63.0

### Nouveautés

- **themes** : trois thèmes Catppuccin — Mocha, Macchiato et Frappé
- **suivi** : le tableau suit les constructions GitHub, étape par étape

### Corrections

- **mobile** : la fin de page ne passe plus sous la barre d'onglets

## 0.62.0

### Nouveautés

- **planning** : niveau et description attendent le thème, comme le second attend le premier

### Corrections

- **demo** : le renvoi du garde-fou menait à un document qui n'existe pas

### Autres changements

- SQLite sans référence à la taille du club
- décrire l'état actuel, sans historique
- **deploiement** : le registre n'est plus « ghcr.io », c'est celui que le dépôt a configuré
