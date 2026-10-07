# Ce que fait HEMA Organizer

> Ce document décrit ce que fait l'application, rôle par rôle et écran par écran,
> au téléphone et à l'ordinateur. Pour installer l'application, voir `docs/DEPLOIEMENT.md` ; pour
> le modèle de sécurité, `docs/SECURITE.md` ; pour la prise en main par les membres, les trois
> guides de `docs/guides/`. Les règles de conception que le code applique sont dans `CLAUDE.md`.

HEMA Organizer est l'outil dédié aux clubs d'AMHE (arts martiaux historiques européens) : les séances de la
semaine, leur programme partie par partie (échauffement, cours d'épée longue ou de messer, option de
dague ou de lutte, atelier proposé par un membre), les réponses des membres, les stages, tournois et
démonstrations, et ce que le club envoie ou publie.

Trois rôles, qui s'additionnent :

- **membre** : il répond aux cours, lit le programme, propose des ateliers, suit les événements ;
- **instructeur** : en plus, il tient le planning, les séances, les ateliers et les annonces
  d'événements, et lit le tableau de bord ;
- **administrateur** (« du bureau ») : un supplément posé sur l'un des deux rôles précédents. Il ouvre
  l'espace admin : périodes, annuaire, présences, thèmes et lieux, réglages du club, notifications,
  comptes, journal. Un instructeur du bureau garde le planning et reçoit l'administration.

## Deux formats : le téléphone et l'ordinateur

L'application choisit son format toute seule :

- **version téléphone** dès que l'écran se pilote au doigt, ou qu'il est étroit (moins de 48 rem) ;
  sur une tablette ou un grand écran tactile, elle garde une colonne de lecture de 40 rem ;
- **version ordinateur** avec une souris et un écran large.

Le choix est retenu par l'appareil, pour que la page arrive dans le bon format dès la deuxième
visite. Les deux formats font **les mêmes choses** avec les mêmes règles ; seule la façon de faire
change. Sur téléphone :

- les gestes se font au pouce : listes en lignes, volets qui montent du bas de l'écran, barres de
  sélection claires en bas ;
- les personnes se choisissent toujours dans une **liste déroulante**, jamais dans des puces ;
- l'accueil est le même sur les deux formats.

Partout, un bouton qui enlève quelque chose (retirer, supprimer, révoquer) est dessiné en **contour
rouge**, et un geste qui a plusieurs suites possibles passe par un menu **« Que veux-tu faire ? »**
suivi d'un bouton qui dit ce qu'il fait.

L'application s'installe sur l'écran d'accueil du téléphone (Android, et iPhone depuis iOS 16.4) et
reçoit alors les notifications, application fermée. Douze thèmes de couleurs sont proposés, clairs
et sombres ; le sens des couleurs ne change jamais : vert pour Présent, rouge pour Absent, ocre pour
Peut-être.

## Membre

### Entrer

- **Le lien personnel** : chaque membre reçoit par email un lien à son nom, valable quatre mois, trois
  jours avant le premier cours du trimestre. L'ouvrir puis appuyer sur le bouton de la page le
  connecte. Il n'y a rien à créer.
- **Parcours d'entrée**, une fois par lien : « Veux-tu installer l'application sur ton téléphone ? »
  (avec les gestes de la plateforme et « Copier mon lien »), puis « Consolider ton compte » (mot de
  passe facultatif) ou « Continuer avec mon lien ». La question de l'installation est sautée sur
  ordinateur et dans l'application installée.
- **Revenir** : le lien collé une fois est gardé sur l'appareil. L'écran de connexion propose
  « Me connecter avec ce lien », « Modifier » et « Oublier » (pour un téléphone prêté). Sur iPhone,
  l'application installée a son champ « J'ai reçu un lien par email » pour coller le lien.
- **Mot de passe et double authentification** sont facultatifs pour un membre : « Mon profil » →
  « Sécuriser mon compte ». La connexion dure douze heures glissantes.

### Répondre aux cours

- **Accueil** : les prochains cours, le plus proche en haut, et **« Indiquer ma présence »** qui
  ouvre le premier cours sans réponse.
- **Séances** : une carte par cours, avec la date en toutes lettres, l'horaire, le lieu (qui ouvre la
  carte du téléphone), le programme, l'effectif et trois gros boutons **Présent**, **Absent**,
  **Peut-être**. Un tap enregistre, et la réponse se change jusqu'au début du cours.
  - au téléphone, la carte est **resserrée** : la date, le programme en lignes, les trois boutons,
    puis les compteurs (peut-être, absents, sans réponse) ;
  - à l'ordinateur, la carte est plus aérée, deux par ligne sur un grand écran.
- **« Qui vient ? »** déplie la liste nominative, réponse par réponse, repliée par vingt.
- Un cours en dessous de la part d'effectif réglée par le club porte **« Peu de monde »** ; au-dessus,
  **« Effectif juste »** ou **« Bien rempli »**.
- Une séance annulée est barrée, avec son motif.
- **Partager** un cours : WhatsApp, « Copier le lien », et au téléphone le partage de l'appareil. Le
  message ne contient aucun nom.
- **Historique** : les cours passés, la réponse donnée et le taux personnel du trimestre (une tuile de
  présence au téléphone), avec « Qui était là ? » pour chaque soirée.

### Lire le programme

L'onglet **Planning** montre le trimestre, cinq séances d'abord puis « Afficher les N autres
séances ». Un filtre choisit le trimestre, l'à venir ou le passé, et une date précise.

Chaque séance se lit **partie par partie**. Une partie porte des **éléments** :

- **Échauffement** (thème pris dans la liste des thèmes d'échauffement) ;
- **Cours** (thème pris dans la liste des disciplines du club : épée longue, messer, sabre…) ;
- **Option**, un cours proposé en même temps qu'un autre, pour un autre public ou une autre arme ;
- **Atelier**, proposé par un membre et programmé par l'encadrement.

Chaque élément montre ce qui est rempli, et seulement ce qui est rempli : l'instructeur qui mène, le
second qui assiste, le thème, le niveau (un, deux ou trois chevrons pour Débutant, Intermédiaire,
Avancé ; rien quand le cours est pour tous) et une description. Les titres « Partie 1 », « Partie 2 »
n'apparaissent que si la séance en a plusieurs.

**Les couleurs se lisent d'un coup d'œil** :

- chaque cours et chaque option prend la **couleur de son thème** : l'épée longue a toujours la même
  couleur, d'une séance à l'autre ; deux disciplines différentes n'ont jamais la même couleur dans une
  séance. La palette compte huit teintes, lisibles dans tous les thèmes ;
- un cours est en aplat, une option en contour ;
- l'échauffement garde la couleur du club, l'atelier le vert ;
- chaque nature a son petit écu héraldique (fasce ondée, sautoir, chevron, croix) ;
- quand il y a plusieurs parties, chaque partie a sa teinte sur son titre et sa bande.

### Proposer un atelier

Un membre propose un atelier : un exercice, une technique, une source qu'il a travaillée.

- **Au téléphone**, un assistant en quatre étapes : **« L'idée »** (titre et description),
  **« Qui anime ? »** (l'animateur, par défaut celui qui propose, et un second animateur
  facultatif, choisis parmi les comptes du club), **« Le matériel »**, **« La séance »** (une séance
  souhaitée, choisie dans un menu, ou peu importe).
- **À l'ordinateur**, les mêmes champs dans un seul formulaire.
- **« Mes propositions »** : le statut (En attente, Dans le planning, Refusé) et la réponse de
  l'instructeur. Tant qu'elle est en attente, la proposition se modifie ou se retire.

### Événements

L'étendard de la barre du haut ouvre les **stages, tournois et démonstrations** publiés : dates,
horaires, lieu et adresse, organisateur, tarifs en texte libre, affiche, description et
**« S'inscrire »**, qui mène chez l'organisateur (le club annonce, il n'encaisse rien). Une pastille
compte les annonces nouvelles. Chaque annonce a une page de partage lisible sans compte.

### Mon profil

Au téléphone, le profil est une **liste groupée** de lignes ; à l'ordinateur, des cartes en deux
colonnes. On y trouve :

- **Mes informations** (le nom et l'email se changent auprès du bureau) ;
- **Mes notifications** : chaque message, réglé par email et par téléphone, avec « Tout recevoir »
  et « Ne recevoir que l'essentiel ». Chacun ne voit que les messages qui peuvent lui arriver ;
- **Notifications sur cet appareil**, à activer appareil par appareil ;
- **Apparence** : le thème de couleurs, ou celui du téléphone par défaut ;
- **Mon lien d'accès** : jusqu'à quand il vaut, et **« Renvoyer mon lien »** (qui déconnecte les
  autres appareils) ;
- **Sécuriser mon compte** : mot de passe, double authentification, codes de secours ;
- **« Se déconnecter »**.

## Instructeur

Tout ce que fait un membre, et en plus le planning, les séances, l'**Espace instructeur** (Ateliers,
Tableau de bord, Événements) et quelques messages de plus.

### Remplir le planning

Le planning s'ouvre **en lecture**, comme pour les membres. **« Modifier le planning »** ouvre la
saisie, **« Appliquer les modifications »** l'enregistre et revient en lecture, **« Annuler »** sort
sans rien écrire (avec une confirmation s'il y a des réglages en attente). Le mode tient dans
l'adresse : le retour du navigateur en sort.

**Ce qui attend, et ce qui part tout de suite.** Le contenu des éléments (instructeur, second,
thème, niveau, description) attend dans un brouillon : chaque élément touché porte « Modifié — pas
encore appliqué » et la barre du bas les compte. Ajouter, retirer, déplacer un élément et
programmer un atelier partent sans attendre.

**Le modèle d'une séance.** Une séance neuve naît avec **une partie et un cours**. Ensuite :

- **« Ajouter dans la partie N… »**, un menu sous chaque partie : Échauffement, Cours, Option, et
  chaque atelier en attente (le choisir le programme) ;
- **« Ajouter une partie »**, au pied de la séance ;
- autant d'échauffements, de cours, d'options et d'ateliers que voulu dans chaque partie ;
- **l'ordre dans une partie est libre** : un élément qui arrive se pose à sa place habituelle
  (échauffement, cours, atelier, option), puis se déplace où l'on veut ;
- le nom d'un élément se calcule tout seul (« Cours », « Partie 2 · Option 2 ») : il n'y a rien à
  taper ;
- la nature d'un élément ne change pas après coup : on le retire et on en ajoute un autre ;
- retirer un atelier le rend à la file des propositions.

**Régler un élément.** Instructeur qui mène, second instructeur (après le premier), thème (la liste
de sa nature, ou « Autre… » pour le taper), puis niveau et description, qui n'apparaissent qu'une
fois un thème choisi. `----------` en tête de liste veut dire « rien ici » : ce qui reste vide ne
s'affiche pas aux membres. La description (500 signes) est publique : l'écran le rappelle.

**Au téléphone, le planning se règle aux gestes.** Chaque élément est une ligne compacte :

- **toucher la ligne** déplie ses réglages juste en dessous ; **« Valider »** la replie ;
- le **niveau** se choisit en quatre boutons : Tous, Débutant, Interm., Avancé ;
- **glisser la ligne vers la gauche** révèle « Retirer », qu'il faut toucher pour confirmer ;
- **tenir la poignée ⋮⋮ et glisser** déplace l'élément dans sa partie, dans une autre, ou dans une
  nouvelle partie au bas de la séance ;
- une courte **démonstration** des gestes se joue les trois premières fois, et « Revoir les gestes »
  la relance ;
- la barre d'édition tient sur deux lignes, avec **Annuler · Appliquer** ; son explication est
  derrière un « i ».

**À l'ordinateur**, chaque élément montre ses listes déroulantes, ses flèches **↑ ↓** (une place
dans l'ordre de lecture, en passant d'une partie à l'autre) et **Retirer**.

**Sélection multiple.** En modification, l'interrupteur **« Sélection multiple »** pose une case
sur chaque séance, une case maîtresse qui dit ce qu'elle emporte, et **« Sélectionner par jour »**
(« Tous les mardis (6) »). Sur les séances cochées :

- **Régler un élément** : instructeur, second, thème, niveau, description, chacun à « Ne pas
  changer » par défaut. Rien ne part : les réglages entrent dans le brouillon, et « Appliquer les
  modifications » les enregistre. Les séances qui n'ont pas cet élément, ou qu'un réglage rendrait
  incohérentes, restent de côté et sont comptées ;
- **Ajouter dans une partie** : la partie, puis la nature, sur toutes les séances cochées d'un coup.

Au téléphone, la sélection se fait dans une barre claire en bas de l'écran et un volet qui monte ;
on peut y cocher élément par élément.

Un trimestre clos ne se modifie plus. Une séance annulée verrouille son programme.

### Tenir les séances

- **Fiche d'une séance** : son programme (réglé ici avec enregistrement immédiat, mêmes gestes
  qu'au planning), les réponses, les ateliers rattachés.
- **Annuler** une séance : le motif est obligatoire et public. L'annonce part aussitôt, une fois,
  par email aux invités, sur le téléphone et dans les salons branchés. Les ateliers placés sur la
  séance reviennent dans la file, sans email.
- **Rétablir** une séance annulée ; **« Nouvelle séance »** en ajoute une au trimestre. Une séance ne
  change pas de trimestre.
- **Sélection multiple des séances** (onglet Séances, en modification) : annuler (motif commun),
  rétablir, changer le lieu, changer l'horaire. Supprimer est réservé au bureau.
- Annuler ou rétablir une séance déjà commencée est refusé.

### Ateliers

**Espace instructeur → Ateliers**, avec trois onglets : En attente, Dans le planning, Refusé.

- **Au téléphone**, deux boutons par proposition : **« Programmer »** (choisir la séance) et
  **« Refuser… »** (avec un mot pour le membre), chacun dans un volet qui monte du bas.
- **À l'ordinateur**, un menu « Que veux-tu faire ? » : **Placer dans le planning**, **Refuser**,
  puis selon le cas **Retirer du planning** ou **Remettre en attente**.
- Le membre reçoit un email à chaque décision. L'atelier placé reprend ses animateurs dans la
  séance.
- **Effacer sans répondre** (un doublon, un envoi par erreur) est réservé au bureau.

### Événements

**Espace instructeur → Événements** : écrire une annonce de stage, tournoi ou démonstration, en
brouillon, puis la publier.

- Champs : nom, dates (avec la durée si l'événement tient sur plusieurs jours), lieu et adresse,
  organisateur, prix et prix adhérent, lien d'inscription, affiche, description.
- **« Récupérer les infos du lien »** préremplit l'annonce depuis la publication d'origine.
- **Publier** prévient tout le club, une seule fois : email, salons, téléphone. Une correction
  ensuite met à jour le message du salon Discord au lieu d'en poster un autre ; dépublier le barre.
- Modifier, publier, dépublier, supprimer passent par « Que veux-tu faire ? ».
- **Au téléphone**, les annonces sont groupées en **« À publier »** et **« Publiés »**, une ligne
  par annonce avec **Modifier**, le geste du moment (**Publier** ou **Voir**) et **⋯** pour les
  autres gestes.

### Tableau de bord

Taux par séance (une date ouvre la fiche), taux par membre (tri « Taux le plus bas »,
« Sans réponse », « Alphabétique », recherche par nom), et **« Exporter en CSV »**. Les fenêtres de
temps sont les mêmes partout : Toute la période, 2 mois, 1 mois, 2 semaines, 1 semaine, Prochain
cours.

### Ce qu'un instructeur reçoit en plus

- **Alerte « peu de monde »** : dans les trois jours qui précèdent un cours resté sous la part
  d'effectif du club, avec un bouton qui annule la séance (motif déjà écrit, utilisable une fois).
- **Désistement de dernière minute** : quand un membre passe de Présent à Absent ou Peut-être (ou de
  Peut-être à Absent) dans les deux heures avant un cours, tous les instructeurs reçoivent son nom et
  l'effectif à jour, par email et sur le téléphone, jamais sur les salons. Ceux qui ont eux-mêmes
  répondu Absent ou Peut-être ne la reçoivent pas.

## Bureau (administrateur)

### Ouvrir l'espace admin

On y entre par **« Mon profil » → « Accès administrateur »**. La première fois, un parcours en trois
étapes : choisir son mot de passe, activer la double authentification, noter ses huit codes de
secours. Ensuite, **« Se connecter en tant qu'administrateur »** redemande le mot de passe et le
code. Se connecter à l'application n'ouvre jamais l'espace admin.

L'espace admin se referme avec « Quitter l'espace admin », après dix minutes sans activité, dix
minutes après avoir quitté l'application, et au plus tard douze heures après son ouverture.

**Au téléphone**, l'espace admin est un **menu en liste** rangé sous trois titres (Le club au
quotidien, Réglages, Sécurité), avec « ‹ Admin » pour revenir et un bandeau fin qui rappelle qu'on
est dans l'espace admin. **À l'ordinateur**, les mêmes dix rubriques sont des onglets : Périodes,
Membres, Présences, Thèmes et lieux, Club, Notifications, Comptes admin, Sessions, Journal d'audit,
À propos.

### Périodes

- **Nouvelle période** : **Trimestre** (quatre par saison), **Bimestre** (six cycles de deux mois,
  avec un calage pair, septembre-octobre…, ou impair, octobre-novembre…) ou **Période
  personnalisée** (un stage, une session d'été). Le nom et les dates se corrigent.
- **Créneaux hebdomadaires** (jour, horaire, lieu) puis la carte **Séances** : *Reste à créer*
  (les dates des créneaux, cochées ; on décoche vacances et jours fériés) et *Séances déjà créées*
  (décocher supprime, avec le nombre de réponses perdues).
- **Instructeurs habituels**, **Membres invités**.
- **« Activer la période »** ouvre le trimestre au travail de l'équipe. Il n'envoie rien : trois jours
  avant le premier cours, un lien neuf part tout seul à qui a déjà un lien en service. Les personnes
  jamais invitées reçoivent le leur par « Envoyer l'invitation » (annuaire). Une période restée en
  brouillon déclenche une alerte aux administrateurs trois jours puis un jour avant son premier cours.
- **Clore la période** arrête ses liens et verrouille planning, séances et réponses ;
  **« Rouvrir la période »** fait l'inverse sans envoyer d'email.
- Au téléphone, la période se lit en liste groupée.

### Membres (l'annuaire)

- Ajouter une personne (email facultatif, pour un enfant par exemple), **importer un fichier CSV**
  (`prénom;nom;email;rôle`), corriger une fiche, régler à sa demande ses notifications. Aucun email ne
  part à l'ajout : on envoie l'invitation quand on est prêt.
- Rôle de base **Membre** ou **Instructeur** : sur ordinateur, la liste **Rôle** de la fiche ; au
  téléphone, un curseur à deux positions **Membre | Instructeur**, posé sur le rôle actuel, que l'on
  touche (ou fait glisser) de l'autre côté pour l'appliquer. Les droits d'administrateur ne se donnent
  ni dans la liste ni sur la fiche, qui renvoie à **Comptes admin**.
- Colonne **État du lien** : qui n'a jamais reçu de lien, qui ne l'a jamais ouvert.
- **Sélection multiple** (interrupteur commun) : changer le rôle, désactiver, réactiver, supprimer,
  renvoyer le lien. Le renvoi est le seul geste de masse qui écrit aux gens, et sa confirmation compte
  les emails qui partiront.
- **Au téléphone**, l'annuaire est une liste de lignes avec **« + Ajouter »**, et la fiche d'un membre
  se règle par boutons.
- **Réinitialiser l'accès** remet à zéro mot de passe, code, codes de secours et liens, et envoie un
  lien neuf.

### Présences

Corriger la réponse de n'importe qui, même après le cours, sans ouvrir la fiche de la séance : une
liste de séances (par défaut le dernier cours commencé), puis la liste des invités.

- **Au téléphone**, trois boutons par personne : **✓** (Présent), **?** (Peut-être), **✕**
  (Absent). La sélection multiple met les réponses dans la barre du bas.
- **À l'ordinateur**, une liste déroulante par personne, et pour un lot **« Mettre leur réponse
  à : »** Présent, Absent, Peut-être ou Sans réponse.
- La confirmation d'un lot compte les réponses que les membres avaient données eux-mêmes. Aucune
  notification ne part ; le journal garde une ligne par personne.

### Thèmes et lieux

Trois listes, une ligne par entrée :

- **Thèmes d'échauffement** (facultatif ; vide, l'échauffement se décrit librement) ;
- **Thèmes de cours et options** : les **disciplines** du club (épée longue, messer, dague, sabre,
  épée de côté, lutte…). L'ordre de la liste fixe la **couleur** de chaque discipline sur le
  planning, la fiche, l'accueil et les pages de partage ;
- **Lieux des cours**, au format `Nom | Adresse` : ils sont proposés à la création des créneaux et
  des séances.

Un club qui installe l'outil part avec une liste de disciplines et d'exercices d'AMHE, et aucune
salle.

### Club

- **Nom et sigle**, **Logo** (logo complet et icône carrée), **Apparence** (le thème du club parmi
  les douze, une couleur de marque facultative). Ils s'affichent partout, dans les emails et sur
  l'application installée.
- **Effectif** : la part de l'effectif invité (5 à 50 %, 20 % par défaut, jamais moins de quatre
  personnes) sous laquelle un cours est « Peu de monde ». L'écran montre ce qu'elle donne en
  personnes.
- **Fuseau horaire** : le fuseau du club (Europe/Paris par défaut), qui règle l'heure des envois
  et des tâches du jour.

### Notifications : tout ce qui part

Une règle : **tout ce qui part du club se règle ici**, chaque canal sur sa page.

- **Canaux et notifications** : l'heure du récap de la veille (18:00 par défaut), et la matrice
  message × canal : Email, Téléphone, Discord, Telegram, Site du club. Une case qu'on ne peut pas
  cocher dit pourquoi (canal pas encore réglé, avec un lien pour le régler, ou message qui ne passe
  pas par ce canal). Ce qui était coché sur un canal non réglé est gardé.
- **Canal Email** : « M'envoyer un email de test », **Derniers emails envoyés** (les douze derniers,
  avec la réponse du serveur), **Liste de distribution** (une adresse de liste au lieu d'un email
  par personne, pour les messages d'information) et **Combien d'emails partent**.
- **Canal Discord** : l'adresse du webhook (masquée une fois enregistrée), un salon par message si
  on veut, message de test.
- **Canal Telegram** : le jeton du bot, la recherche du salon, message de test. Telegram porte les
  messages collectifs, jamais les messages personnels.
- **Canal Téléphone** : les appareils abonnés et ce qui part sur le téléphone. Rien à configurer sur
  le serveur ; l'application doit être servie en HTTPS.
- **Canal WhatsApp** : le partage reste manuel (bouton de partage sur chaque séance) ; aucun envoi
  automatique.
- **Publication des cours sur le site du club** et **Alertes de sécurité** (prévenir les
  administrateurs d'un lien ouvert trop souvent ou d'une vague de liens inconnus).

Les messages :

| Message | Pour qui | Quand |
|---|---|---|
| Récap de la veille | inscrits Présent ou Peut-être, salons | la veille, à l'heure réglée |
| Rappel aux personnes sans réponse | invités sans réponse | une semaine, puis deux jours avant |
| Séance annulée | tous les invités, salons | aussitôt |
| Alerte « peu de monde » | instructeurs | le matin, dans les trois jours avant |
| Désistement de dernière minute | instructeurs | dans les deux heures avant le cours |
| Réponse à une proposition d'atelier | l'auteur | à la décision |
| Nouvel événement | membres, salons | à la publication, une fois |
| Période suivante à créer, période à activer | administrateurs | avant la fin, puis avant le premier cours |

Le lien d'accès, l'alerte « nouvel appareil » et le mot de passe oublié partent toujours. Les
messages personnels ne partent qu'aux personnes qui ont un accès actif.

### Comptes admin, Sessions, Journal d'audit, À propos

- **Comptes admin** : nommer un administrateur parmi les personnes de l'annuaire (recherche, liste
  repliée à dix noms), retirer les droits (la personne garde son rôle de base), réinitialiser la
  double authentification de quelqu'un. Un administrateur ne se crée pas de zéro : on l'ajoute dans
  Membres, puis on le nomme.
- **Sessions** : déconnecter un appareil, ou tous ceux d'une personne.
- **Journal d'audit** : qui a fait quoi, filtres, raccourcis (par exemple *liens*), export CSV. Le
  journal des modifications du planning y mène aussi.
- **À propos** : version, domaine, contenu de la base, sauvegardes, adresse de l'API, et la durée de
  conservation du journal.

## Ce qui sort du club

- **Pages de partage** (séance, événement) : lisibles sans compte, sans aucun nom.
- **API publique**, fermée par défaut. Ouverte dans « Notifications », elle publie les prochains
  cours (`/api/public/prochaines-seances`) : date, horaire, lieu et adresse, thème, programme partie
  par partie (nature, thème, niveau, description), annulation et motif, taux de participation.
  Jamais un nom, jamais l'effectif en clair. Une seconde adresse (`/api/public/annonces`) republie les
  messages cochés dans la colonne « Site du club » : récap de la veille, séance annulée, nouvel
  événement. Accès limité à l'origine déclarée du site, cache de cinq minutes, débit limité.
- **Plugin WordPress** (`wordpress-plugin/hema-prochains-cours`) : le shortcode
  `[hema_prochains_cours limit="5"]` affiche les prochains cours en cartes sur le site du club, avec
  un lien « Indiquer ma présence ». Il garde quinze minutes de cache et applique tout de suite une
  fermeture de l'API.
- **Ce qui ne sort jamais** : les noms (membres, instructeurs, animateurs, second instructeur),
  l'effectif en clair, les annonces en brouillon, l'alerte « peu de monde » (son email porte un lien
  d'annulation).

## Les calculs

- **Taux d'une séance** = présents / invités de la période × 100, arrondi, avec le nombre de réponses
  en attente. Il compte ce qui s'est passé dans la salle.
- **Taux d'une personne** : seulement les cours donnés depuis son arrivée dans la période (l'export
  CSV porte une colonne « Arrivée » qui explique l'écart). Un cours d'essai antérieur à l'arrivée
  peut quand même être coché.
- Tout compteur ne prend que les invités de la période : une réponse de quelqu'un sorti du trimestre
  ne compte pas.

## Les rendez-vous du jour

| Heure | Ce qui se passe |
|---|---|
| 03:30 | sauvegarde de la base, gardée trente jours |
| 07:00 | liens des trimestres qui commencent dans trois jours, renouvellement des liens en fin de validité, alertes, ménage du journal |
| l'heure du récap (18:00 par défaut) | récap de la veille, puis rappels aux personnes sans réponse |

Les heures suivent le fuseau du club.
