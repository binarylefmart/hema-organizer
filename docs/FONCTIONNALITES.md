# Ce que fait HEMA Organizer

> Ce document décrit ce que fait l'application, écran par écran ; il reprend la partie
> « Fonctionnalités » de `CLAUDE.md`, qui fait référence. Pour installer l'application, voir
> `docs/DEPLOIEMENT.md` ; pour le modèle de sécurité, `docs/SECURITE.md` ; pour la prise en
> main par les membres, les trois guides de `docs/guides/`.

## Côté membre
- Écran d'accueil = liste des prochaines séances (cartes), la plus proche en haut
- Chaque carte : date en toutes lettres, horaire, lieu, thème, alternative, instructeur(s),
  ateliers planifiés (titre + nom de l'animateur),
  taux de présence en % + nombre (ex "72 % — 13/18"), et 3 gros boutons : ✅ Présent / ❌ Absent / 🤔 Peut-être
- Un tap = enregistré (optimistic UI + confirmation visuelle), modifiable jusqu'au début du cours
- Séances annulées clairement barrées avec motif
- "Mes présences" : historique et taux personnel du trimestre
- Bouton "Proposer un atelier" : titre, description, durée estimée, matériel nécessaire (optionnel),
  séance souhaitée (optionnel, parmi les séances à venir)
- "Mes propositions" : suivi du statut + commentaire de l'instructeur, modifiable/supprimable tant que PROPOSE
- "Mon profil" : nom, email, notifications, thème, **état du lien d'accès + bouton « Renvoyer mon lien »**,
  carte « Sécuriser mon compte » (mot de passe et double authentification, facultatifs)

## Calcul du taux
- Taux = présents / membres invités sur la période × 100, arrondi à l'entier
- Afficher aussi le nombre de réponses en attente
- **Un compteur de séance compte ce qui s'est passé dans la salle : aucune borne d'arrivée. Un compteur de
  personne ne compte que les cours donnés depuis son arrivée dans la période** (`PeriodMember.addedAt`).
  Trois corollaires : une **donnée saisie n'est jamais masquée** pour faire coïncider une
  colonne avec un total — le fichier porte une colonne « Arrivée » qui explique l'écart, et ses totaux
  s'intitulent « depuis l'arrivée » ; borner le seul numérateur d'une séance recréerait le péché que ce
  dossier traque (le dénominateur, lui, n'est pas borné) ; et `/admin/presences` accepte
  qu'on coche quelqu'un sur un cours antérieur à son arrivée — le cours d'essai a eu lieu.
- **Tout compteur de présences filtre sur l'appartenance à la période** (`user: { service: false, periodes:
  { some: { periodId } } }`). `Attendance` pend à `User` et à `Session`, jamais à `PeriodMember` : sans ce
  filtre, la réponse de quelqu'un sorti du trimestre — ou du compte de service du portail — compte dans le
  chiffre et disparaît de la liste des noms, qui est filtrée — un planning annoncerait « 12 / 12 »
  au-dessus de onze noms

## Gestion de l'organisation (INSTRUCTEUR et ADMIN)

Espace « Gestion » (`/gestion`, libellé « Espace instructeur »). Sa sous-navigation porte **trois entrées, les
mêmes pour un admin et pour un instructeur** — **Ateliers**, **Tableau de bord**, **Événements** — et `/gestion`
redirige vers `/gestion/ateliers`. Rien n'y est montré à l'un et caché à l'autre.

- **Le planning ne déroule pas tout le trimestre** : il montre **cinq séances**, puis un
  bouton « Afficher les N autres séances » (et « Replier le trimestre » une fois déplié) — le même
  comportement que la liste des séances (`ListeSeances`). La coupure se compte en séances, pas en
  lignes : un mois dont aucune séance n'est visible passe entier derrière le bouton
- **Le planning s'ouvre en LECTURE SEULE, même pour l'encadrement.** Lire le programme ne doit pas
  demander de traverser un mur de contrôles de saisie — quatre listes déroulantes et une zone de texte
  **par partie**, sur chaque séance du trimestre. En lecture, l'annuaire du club et la liste
  des ateliers ne traversent pas vers le navigateur (`optionsDepuis` ne les envoie qu'à qui peut s'en
  servir) : sur un trimestre de vingt-six séances, ce n'est pas rien
  - **Trois boutons** : « Modifier le planning » ouvre la saisie, « Appliquer les modifications » la
    referme en écrivant, « **Annuler** » la referme en jetant. **Une sortie se cherche à la même place
    que l'entrée** — elle se présente donc comme elle, en bouton, et non en lien discret. « Annuler »
    est toujours montré, en **secondaire** et **à gauche** d'« Appliquer » (on ne met pas ce qui jette
    sous le pouce qui valide), et ne demande confirmation que s'il y a quelque chose à perdre.
  - **Le mode vit dans l'URL** (`?modifier=1`), comme le trimestre, la fenêtre de temps et la date
    cherchée : le retour du navigateur sort du mode, un lien se partage tel qu'on le lit, et quitter
    l'adresse **jette le brouillon**, qui n'a jamais touché la base. Seul `1` ouvre la saisie — `0`,
    `true`, un reste de copier-coller rendent la lecture seule : un écran de saisie ne s'ouvre pas sur
    un à-peu-près. La règle est dans un module pur (`src/components/planning/mode-edition.ts`) :
    entrer en modification ne fait perdre **aucun filtre**, sans quoi il faudrait tout refiltrer avant
    de corriger la case qu'on a sous les yeux.
  - **Et le mode exige le DROIT en plus du paramètre** (`enEdition = peutModifier && modeEdition`).
    `?modifier=1` s'écrit à la main : sans le droit, l'écran reste en lecture seule et ne montre pas
    la barre « Appliquer les modifications » (les options suivent le droit, l'action exige
    `planning.edit`).
  - **Les cases attendent, et c'est ce qui rend les boutons honnêtes.** Enregistrées une par une à
    chaque réglage, « Appliquer » n'aurait rien à écrire et « Annuler » rien à jeter. Elles
    s'accumulent dans un brouillon (`ContexteBrouillon`, branché sur le **seul** entonnoir
    d'écriture d'une case), chacune dit « Modifié — pas encore appliqué », la barre compte, et **un
    seul appel** part (`enregistrerCases` : mêmes verrous que l'unitaire par **appel des mêmes
    fonctions**, tout-ou-rien en nommant la case refusée, un identifiant répété n'écrivant qu'une fois,
    une entrée de journal par case sous la **même** action `planning.case` avec `enMasse: true`,
    plafond repris de `SELECTION_MAX`). Seules les cases qui changent vraiment sont écrites
    (`caseInchangee`) : `updatedAt` est un `@updatedAt` et la grille l'affiche dans « Modifié par … le
    … », donc écrire une case inchangée annoncerait un changement qui n'a pas eu lieu.
  - **Ce que le brouillon ne couvre pas, la barre l'écrit** : ajouter, retirer, déplacer une partie et
    programmer un atelier partent **sans attendre**. Une partie provisoire n'aurait pas d'identifiant à
    donner au rangement des rangs ni au placement d'un atelier, et ces gestes sont déjà des décisions à
    part, confirmées. Une promesse à moitié tenue vaut moins qu'une phrase.
  - **La fiche d'une séance garde l'enregistrement immédiat** : on y règle **une** séance, et une case
    sans brouillon s'enregistre toute seule — c'est le `null` du contexte qui le dit.
  - **Une séance annulée verrouille aussi son programme** (`partiePourEcriture`, `seancePourEcriture`
    et `programmerAtelierDansCase` refusent tous trois l'écriture) : ce programme **sort du club**
    (pages de partage, API publique), et deux portes vers la même écriture ont la même serrure
- **Le planning se règle par parties, une carte par séance** : chaque séance porte ses
  propres parties (`SessionPartie`), qui s'ajoutent, se montent, se descendent et se retirent
  (`planning.edit`, le même droit que remplir une case). Une partie porte **un instructeur qui
  mène, un second qui assiste** (facultatif, jamais publié), un thème, une **description** facultative
  et un **niveau** — *indifférent*
  (défaut), *débutant*, *intermédiaire*, *avancé*. Le niveau ne s'écrit **jamais** quand il vaut
  indifférent et n'a **pas de couleur propre** : les trois niveaux ne se classent pas. Le modèle d'une
  séance neuve (`PARTIES_MODELE`) est une constante du code, pas un réglage de club, et il ne porte que
  **deux cours** : il décrit ce qu'une séance a *toujours*, pas ce qu'elle pourrait avoir — une option
  posée d'office naîtrait vide sur **chaque** séance du trimestre, et une case vide ne dit rien d'autre
  que « il manque quelque chose ». Les options s'ajoutent quand il y en a, et un
  atelier retenu s'en crée une au besoin. Vider une case et
  retirer une partie sont deux gestes distincts ; retirer est refusé tant qu'un atelier occupe la partie ;
  un atelier retenu vise la première option libre, et l'application en crée une en queue s'il n'y en a pas
- **La nature d'une partie se choisit à l'ajout, et ne change pas après coup.** Deux boutons —
  *ajouter un cours*, *ajouter une option* — posent la nature au moment où elle se décide. Pour en
  changer, on **retire la partie et on ajoute l'autre** : aucune ligne ne bouge sous le doigt. Changer
  la nature en place déplacerait la partie d'une série à l'autre, donc de place, et la suivante
  hériterait de son nom. `changerNaturePartie` existe côté serveur avec ses verrous et ses tests,
  **sans écran qui l'appelle**, et son en-tête le dit
- **Le nom d'une partie ne se saisit pas : il se calcule.** `libellePartie(rang, estOption)` donne
  « Cours 1 », « Cours 2 »… et « Option 1 », « Option 2 »… — **une seule forme par série**.
  **Chaque nature se numérote dans sa propre série** (`rangsDansNature`) : le troisième cours
  s'appelle « Cours 3 » même s'il est la cinquième ligne, et toute étiquette posée à côté d'un libellé
  compte la même chose que lui. Il n'y a **ni champ texte, ni renommage, ni saisie d'un nom à
  l'ajout** : ce qui décrit une partie, ce sont ses informations (instructeur, thème, niveau,
  description). La colonne `libelle` existe — l'API publique, les emails et les embeds la lisent
  avec leur propre requête — et **un seul endroit la tient à jour** : `rangerParties`
  (`src/lib/planning.ts`), qui range `ordre` et `libelle` ensemble. Le **calcul** des deux invariants, lui,
  vit dans `src/components/planning/rangement.ts` — un module sans Prisma, pour que le script de réparation
  (`scripts/reparer-donnees.ts`, contrôle `rangs`) partage la règle au lieu de la recopier ; `rangerParties`
  n'en est que le passage à l'écriture. Et **ranger ne repeint pas la bulle** : les voisines renommées
  gardent leur `updatedAt` et leur auteur, parce que la bulle dit qui a écrit *ce qui est dans la case*, pas
  qui a bougé la ligne — le geste, lui, se lit au journal. Même doctrine que les migrations qui réécrivent
  des rangs.
  **Une seule définition de « case vide »** : `reglagesVides` (`src/components/planning/options.ts`, module
  pur, lisible du navigateur comme du serveur), dont dérivent `caseVide` et `partieLibre`. Les deux portes
  qui posent la question — l'écran qui propose de programmer un atelier, et le serveur qui l'accepte —
  posent donc **la même**. Un atelier ne se pose jamais sur une case remplie et n'émet une écriture que pour les
  lignes dont quelque chose change vraiment (`updatedAt` est un `@updatedAt`, et la grille l'affiche
  dans « Modifié par … le … »). Les quatre gestes qui décalent un rang — ajouter, retirer, déplacer,
  changer de nature (`changerNaturePartie`) — passent tous par elle. Le planning affiche **une séance
  par ligne, pleine largeur** : les parties portent des noms de personnes, qui ne se tronquent pas
- **Une partie porte une `description` facultative**, qu'un instructeur remplit ou non pour décrire
  le travail de la partie. Texte libre plafonné
  à `PARTIE_DESCRIPTION_MAX` (500 signes — plus court que la proposition d'atelier, parce qu'elle
  s'affiche **en ligne** dans une carte et se répète par partie), vide par défaut, jamais obligatoire.
  Elle se saisit avec les autres réglages de la case (planning et fiche de séance), est journalisée
  comme eux, et **ne s'affiche que remplie** (règle `champsLus`). Elle **sort du club** — pages de
  partage, et API publique quand le club l'a ouverte —, comme le thème, et **l'écran de saisie
  l'annonce** ; voir `docs/SECURITE.md`, « Ce qui sort du club ». Elle compte dans `caseVide` : un
  atelier retenu ne vient pas effacer une phrase que quelqu'un a écrite
- Éditer thème et alternative de chaque séance (formulaire simple, autosave), depuis l'onglet **Séances**
  (`/seances`, ouvert à tout le club : la carte est la même pour tous, l'encadrement a des actions en pied)
- **Une séance ne change pas de trimestre** : la période se choisit à la création, et
  l'écran de modification l'affiche en texte ; `modifierSeance` refuse tout changement et le dit.
  **Pourquoi :** une séance porte les réponses des membres, et le dénominateur de tous les taux est
  l'effectif invité **de sa période**. La déplacer y ferait entrer des réponses de gens absents du
  nouveau dénominateur — les « 12 présents sur 11 ». Pour que le déplacement soit juste, il faudrait
  effacer ces réponses au passage : une perte de données sèche déclenchée par une liste déroulante.
  On crée la séance là où elle doit être
- **Effacer une séance n'est PAS un geste d'organisation** : `supprimerSeance` exige
  `periods.manage` (ADMIN) **et l'élévation** (`exigerReauth`), exactement comme son geste jumeau
  `supprimerSeancesPeriode` sur l'écran de la période, et le nombre de réponses perdues part dans le
  journal d'audit. **Pourquoi :** la séance emporte en cascade les réponses des membres, qui ne se
  reconstituent pas. **Deux portes vers la même destruction ont la même serrure.** Le bouton n'est rendu qu'à qui peut aboutir (permission *et*
  session forte) : un bouton qui ne peut que refuser est pire que pas de bouton
- **Une période CLOSE verrouille son planning et ses séances** (`partiePourEcriture`,
  `seancePourEcriture`, `periodeOuverte`) : ni horaire, ni thème, ni suppression, ni surtout
  **annulation** — qui ferait partir un email à tous les invités et une annonce sur Discord et
  Telegram à propos d'un cours d'un trimestre terminé. Le lien d'annulation des emails est refusé pour
  la même raison (`porteurJetonAnnulation`). **Le verrou ne se déduit pas de la date** : on
  clôt un trimestre sans attendre son dernier cours, une période close porte donc des séances à venir
- Voir la liste nominative des présents / absents / peut-être / sans réponse
- Ateliers : file des propositions (badge compteur), valider / refuser avec commentaire,
  planifier sur une séance (statut PLANIFIE) ; email automatique au membre à chaque changement de statut.
  La **liste des thèmes** du planning, elle, se règle dans l'espace admin (`/admin/themes`)
- **Effacer une proposition sans y répondre** (bouton « Effacer sans répondre », `ateliers.supprimer`) :
  réservé aux **ADMIN**. La ligne disparaît, **aucun email ne part**, et le
  journal d'audit garde le titre, l'auteur et le statut d'alors. C'est le geste du doublon ou de l'envoi
  par erreur — répondre « refusé » à ces choses-là serait un contresens, et les laisser en attente
  encombre la file de tout le monde. **Pourquoi le bureau :** faire disparaître l'écrit d'un membre en
  silence engage le club, comme désactiver un compte ; décider (placer, refuser) est une réponse, et
  reste à l'encadrement. Un membre garde le droit d'effacer **la sienne** tant qu'elle est en attente
- Tableau de bord : taux par séance (graphique simple), taux par membre, export CSV
- Événements : créer, modifier, publier et supprimer une annonce (`evenements.edit` +
  `evenements.creer_supprimer`) — les stages, tournois et démonstrations sont la vie du club, et c'est
  l'encadrement qui les connaît. Une annonce se retire d'un clic et n'ouvre aucun accès à personne ; le
  journal d'audit garde qui a publié quoi
- Bouton "Partager sur WhatsApp" sur chaque séance (voir section dédiée) — **ouvert à tout le monde**,
  le résumé partagé ne contenant aucun nom

## Administration technique et gestion du bureau (ADMIN uniquement, avec élévation)

Espace admin (`/admin`). Sa sous-navigation porte, dans cet ordre : **Périodes**, **Membres**, **Présences**,
**Thèmes et lieux**, **Club**, **Notifications**, **Comptes admin**, **Sessions**, **Journal d'audit** et
**À propos**. On y entre par « Mon profil », et chaque écran exige une **session forte** — mot de passe et
code redonnés sur `/connexion/admin`.

**Une règle simple : tout ce qui PART se règle dans Notifications.**
Le salon Discord, le serveur d'envoi et son journal des douze derniers emails, le groupe Telegram,
les notifications sur le téléphone, l'**API publique** et les **alertes de sécurité** y sont
rassemblés, chacun sur la page de son canal. **« À propos »** (`/admin/apropos`) ne répond qu'à « qu'est-ce que je fais tourner, au juste ? » :
version, domaine, contenu de la base, sauvegardes et images sur le disque, adresse de l'API — et le
seul réglage purement technique de l'application, la conservation du journal d'audit.

- Périodes : créer une période — **trimestre**, **bimestre** (six cycles de deux mois par saison, avec un
  **calage pair ou impair** qui décale toute la grille d'un mois : *pair* = sept.-oct., nov.-déc.… ; *impair* =
  oct.-nov., déc.-janv.…) ou **période personnalisée**, le nom et les dates restant modifiables — + générer les séances en récurrence (jour(s)
  de semaine + horaire, exclusions de dates). La carte « Séances » porte **deux encarts** : *Reste à
  créer* (les dates des créneaux qui manquent, cochées) et *Séances déjà créées* (celles qui existent, cochées ;
  **décocher = supprimer**, avec le décompte des réponses perdues en confirmation, `supprimerSeancesPeriode`) ; bouton "Activer la période" → **ouvre le trimestre au travail de l'équipe, et rien d'autre**
  (il n'envoie aucun email) : les liens personnels partent tout seuls **3 jours avant le début
  du trimestre** (balayage de 07:00, `envoyerLiensDesTrimestresQuiCommencent`, `LIENS_AVANT_DEBUT_JOURS`), chacun
  recevant une clé neuve qui **révoque toutes ses clés précédentes, trimestres confondus** (`remplaceTousLesLiens`) ;
  renvoyer / révoquer une invitation individuelle, voir qui n'a pas encore activé son lien.
  **« Rouvrir la période »** : le geste inverse de la clôture, sur une période CLOSE. Il ne fait partir
  **aucun email** — il rend les liens que la clôture avait révoqués (`CLOTURE`) **et seulement s'ils sont encore
  valables**, et marque comme envoyés les liens d'un trimestre déjà commencé qui ne sont pas encore partis. Sans ces
  deux garde-fous, la réouverture déclencherait un « lien renouvelé » ou un premier lien à tout le club au balayage
  du lendemain.
  **Alerte « période à activer »** : si une période créée arrive à son premier cours **en
  brouillon**, les administrateurs sont prévenus (email + téléphone) **trois jours puis un jour avant** —
  J-3 est exactement le jour où les liens seraient partis. Le jalon se compte sur la **première séance
  non annulée** (même règle que l'envoi des liens), et l'alerte s'arrête d'elle-même dès l'activation
- Membres : CRUD (import CSV : prénom, nom, email, rôle MEMBRE ou INSTRUCTEUR), activation / désactivation,
  lien personnel, réglage des notifications d'un membre à sa demande (`notifications.autrui`)
- **Présences** (`/admin/presences`) : **corriger la réponse de n'importe qui, même après le cours**, sans
  ouvrir la fiche de la séance. Une liste déroulante de séances (trimestres ouverts, annulées exclues ; par défaut **le
  dernier cours commencé**, à défaut le prochain) et la liste des invités avec leur réponse — le même composant que la
  fiche de séance (`PresencesEquipe`, `attendances.autrui`), déplié d'emblée. La séance voyage dans l'URL
  (`?seance=<id>`) : l'écran reste un composant serveur et le retour du navigateur ramène la précédente. **Pourquoi un
  écran à lui :** le registre d'un soir de cours et le registre des comptes sont deux métiers, et les mêler en tête de
  l'annuaire coûterait deux requêtes de plus à chaque ouverture.
  **Corriger le registre exige l'espace admin OUVERT** :
  `attendances.autrui` ne figure **pas** dans la liste `SANS_SESSION_FORTE` (`src/lib/permissions.ts`), donc
  les deux écritures du registre — `modifierPresenceMembre` et `modifierPresencesEnMasse` — exigent une
  **session forte**, par les deux écrans qui les montent. **Pourquoi :** sans elle, un appel forgé
  depuis une session ouverte par le **seul lien personnel** d'un administrateur ramène une séance de
  onze réponses à zéro, puis déclare les douze invités présents. Le registre engage le club, ses
  chiffres nourrissent les bilans, et un email transféré suffirait.
  **Le verrou va sur la permission, jamais sur un écran** : des portes dédiées (`corrigerPresence*`)
  ne protégeraient que l'écran du bureau, qui exige déjà l'élévation pour **s'afficher**, tout en
  laissant croire à un verrou. **Une seule paire d'écritures, donc une seule serrure à vérifier**, et
  un test garde leur absence.
  **Ce que le verrou ne demande PAS, et c'est la moitié qui le rend tenable** : aucun code **récent**
  (`exigerReauth`). L'élévation se donne **une fois** en arrivant et vaut douze heures ; surtout,
  **cocher une présence compte comme une activité d'espace admin** (`toucherElevation` sur les deux
  actions), parce que le registre se tient aussi depuis la **fiche de séance**, qui n'est pas dans
  `/admin/**`. Sans ce rappel, l'élévation tomberait au bout de dix minutes **au milieu de la liste**.
  Les deux moitiés ne se séparent donc pas. Rien n'est repoussé sur un refus : il n'y a rien à
  prolonger.
  **Et le refus se dit de deux façons, parce qu'il ne se répare pas pareil** (`refusCorrection`) :
  « ouvre l'espace admin : ton mot de passe et ton code à usage unique » à qui a la permission et à qui
  il ne manque que dix secondes, « tu n'as pas le droit » à qui ne l'a pas. Un message unique enverrait
  le bureau chercher un droit qu'il a déjà. La fiche de séance applique la même règle **à l'affichage** :
  sans élévation, elle montre le chemin vers `/connexion/admin?suite=…`, jamais un registre qui ne
  pourrait que refuser.
  **Correction par lots** (`modifierPresencesEnMasse`) : cocher des lignes, puis une seule réponse pour
  tout le lot. Verrous **identiques** à ceux du geste unitaire, **tout ou rien** si quelqu'un du lot n'est pas invité,
  une **entrée d'audit par personne** (`presence.modifiee_par_admin`), et **aucune notification**
- **Rôle en masse depuis l'annuaire** (`definirRolesEnMasse`) : **MEMBRE ou INSTRUCTEUR seulement**. Le
  rôle **ADMIN est refusé dans les deux sens**, et c'est la **valeur écrite** qui tient cette frontière, pas une garde
  sur la cible : le lot n'écrit que `role`, jamais `estAdmin`. **Un administrateur a donc une case** — le bureau
  étant un supplément, le lot ne retire rien à personne, et un instructeur du bureau passé membre reste du bureau.
  **Le seul compte sans case est le sien** (`sansCase.soiMeme`), et
  l'écran dit pourquoi. Gardes du geste unitaire (`members.manage`, `canEditUser`, compte du
  portail intouchable, personne ne change le sien) + plafond de lot.
  **Une liste déroulante et un bouton**, plutôt qu'un bouton par rôle. La liste est celle du dépôt (`ListeDeroulante`, jamais un `<select>` nu) et elle
  **n'applique rien au `change`** — un rôle effleuré écrirait sur douze personnes, et cela ne se rattrape pas ligne par
  ligne. Elle ouvre sur « Choisir un rôle… » (entrée à valeur vide) et le bouton reste inerte tant que rien n'est
  choisi. C'est la différence assumée avec la liste déroulante d'**une** ligne (`SelecteurRole`), qui enregistre au choix
- **Désactiver, réactiver, supprimer en masse depuis l'annuaire** (`appliquerGesteEnMasse`). Une seule
  fonction pour les trois : leurs verrous sont identiques à une permission près, et les
  écrire trois fois serait trois occasions d'en oublier un. Verrous **exactement** ceux des boutons de ligne
  (`members.manage` en plancher, puis `members.activate` / `members.delete`, `canEditUser`, portail intouchable,
  personne sur son propre compte) + `exigerReauth` sur les trois. **C'est `canEditUser` qui décide, compte par
  compte** — et non une exclusion du bureau en bloc : qui a `admins.manage` peut désactiver un autre administrateur, à
  l'unité comme en lot, parce que c'est la **même** frontière qu'à l'unité et que deux chemins d'écriture aux règles
  différentes sont une porte dérobée d'un côté ou une fonctionnalité morte de l'autre. **Sans case : son propre compte
  et le compte du portail** ; l'écran dit pourquoi, et si l'un d'eux arrive par une requête forgée, le lot **entier**
  est refusé et la personne nommée. La désactivation
  révoque les sessions personne par personne, comme à l'unité ; la suppression annonce **les réponses de présence
  perdues, nom par nom**, avant de partir, et son bouton dit **ce qu'il détruit** — « Supprimer l'utilisateur », accordé
  au lot : un verbe seul au milieu d'autres gestes ne nomme pas son
  objet. **Aucun email** ne part de ces trois gestes-là — le seul geste de masse de l'annuaire qui écrit aux gens est
  « Renvoyer le lien », ci-dessous, où l'envoi *est* le geste demandé
- **Renvoyer le lien personnel en masse depuis l'annuaire** (`renvoyerLiensEnMasse`). **C'est le seul
  geste de masse du dépôt qui part vers les gens**, et il est
  traité comme tel : la confirmation annonce **le nombre d'emails** (pas le nombre de cases cochées — les deux diffèrent
  dès qu'une personne du lot n'a pas d'adresse), et c'est le seul chiffre qu'on ne rattrape pas. Il ne contredit pas
  « un geste de masse n'envoie pas la notification du geste unitaire multipliée » : ici l'envoi **est** le geste demandé,
  ce n'est pas la notification d'une écriture. Verrous **exactement** ceux d'`envoyerLienMembre` — `invitations.manage`
  (pas `members.manage`), compte du portail intouchable, **`exigerReauth`** avant le premier envoi —, plus `canEditUser`,
  que l'unitaire n'appelle pas : l'écran ne donne de case qu'aux comptes qu'il sait traiter, le serveur tient la même
  frontière. **Deux populations, deux traitements** : ce qui trahit un écran périmé (portail, compte non modifiable,
  identifiant introuvable, période close) refuse le **lot entier** — des emails partis ne se rappellent pas ; ce qui est
  un état ordinaire de l'annuaire (sans adresse email, compte désactivé) est **écarté, nommé, et les autres partent**,
  comme « Renvoyer les liens » d'une période. Chaque envoi régénère la clé et déconnecte les appareils (la promesse du
  bouton d'une ligne), **une entrée d'audit par personne** sous `invitation.renvoyee`, et **aucun code n'est redemandé
  quand aucun email ne peut partir**
- **Une action de masse se nomme avant qu'on ait deviné son geste d'entrée, mais n'occupe pas
  l'écran.** Deux exigences qui tiennent ensemble :
  - des cases à cocher ne disent rien de ce qu'elles permettent : une fonctionnalité qui n'apparaît
    qu'après le geste qu'elle est censée révéler n'existe pas pour qui ne l'a pas deviné ;
  - une barre inerte prend ~200 px sur un téléphone de 390 px — trois lignes de la liste qu'on vient
    lire — pour des boutons qui ne peuvent rien écrire.
  **Les deux barres ne se montrent donc qu'avec une sélection** (`barreDeMasseVisible`, dans le module
  partagé : les deux écrans doivent apparaître au même moment), et **l'invite descend à côté des
  cases**, en une ligne sous la case maîtresse (`texteInviteMasse` : « Coche des lignes pour agir sur
  plusieurs personnes à la fois », « … pour corriger plusieurs réponses à la fois »), qui s'efface dès
  qu'une case est cochée. **Ce qu'on ne fait pas** : laisser les cases seules, sans un mot de ce
  qu'elles permettent ; ni coller la barre en bas dès l'ouverture
- Notifications : **heure d'envoi du récap**, canaux (email, Discord, téléphone), matrice notification × canal,
  un salon Discord par notification
- URL du webhook Discord (surcharge éventuelle de la variable d'env, stockée côté serveur, masquée à l'affichage),
  activation de l'API publique, boutons "Envoyer un message Discord de test" et "Envoyer un email de test"
- Gestion des comptes ADMIN : **nommer** un administrateur parmi les personnes de l'annuaire, **retirer les droits**
  d'un administrateur — le compte reste, et la personne **garde son rôle de base** : elle ne « redevient » pas
  membre, elle ne l'a jamais cessé —, réinitialiser la 2FA — **sauf celle du compte permanent, que lui
  seul réinitialise** : c'est le seul compte qui puisse rouvrir l'administration, et sa voie de secours
  est sa propre boîte email, puis le redéploiement. **Le rôle ADMIN ne se
  donne et ne se retire que là** : l'annuaire (`/admin/membres`, fiche comprise) ne propose que *membre* et
  *instructeur*. **Un administrateur ne se crée pas de zéro** : cet onglet n'a pas de formulaire de
  création — il doublerait celui de l'annuaire et pourrait ouvrir un second compte à quelqu'un de déjà
  inscrit. On ajoute la personne dans « Membres », puis on la **nomme** ici ; `creerMembre` et
  l'import CSV refusent le rôle ADMIN. Révocation des sessions, consultation de l'AuditLog
- **Derniers emails envoyés** (`/admin/parametres`) : les douze derniers envois journalisés avec leur verdict et le
  message du serveur SMTP en cas d'échec — c'est là qu'on tranche un « il n'a rien reçu »

*(`/gestion/periodes/**` et `/gestion/membres/**` redirigent vers `/admin/periodes/**` et
`/admin/membres/**`, pour que les liens de cette forme déjà envoyés par email restent valables.)*

## Invitations et accès
- Jeton : 32 octets aléatoires (crypto.randomBytes), base64url dans l'URL, seul le hash SHA-256 est stocké
- Lien : https://<DOMAIN>/invitation/<token>, **valable 4 mois** (la durée d'un trimestre du club), révoqué à la clôture de
  la période ; renouvelé automatiquement et renvoyé par email — **à tout le monde, quel que soit le rôle** (balayage de 07:00,
  `renouvelerLiensExpirants` : aucun filtre sur `role`, ne pas en ajouter)
- **Mot de passe et double authentification sont FACULTATIFS pour les membres et les instructeurs,
  OBLIGATOIRES pour les administrateurs.** Le lien personnel, généré/régénéré/révoqué par
  l'équipe, reste la porte principale de **tout le monde, quel que soit le rôle** : il connecte directement (session
  de 12 h glissantes) ; première utilisation → écran de bienvenue
- **Membres et instructeurs : un filet, jamais une obligation.** Depuis « Mon profil » → « Sécuriser mon compte »
  (`/profil#securite`), chacun peut se définir un mot de passe, puis — en option — activer une double authentification
  TOTP. **Pourquoi :** avec le lien *seul*, quiconque perd son email ou change d'appareil reste dehors jusqu'à ce
  qu'un administrateur intervienne. Sans mot de passe, on entre par son lien. Les écrans qui
  accueillent l'ouverture d'un lien (page du lien, écran de bienvenue) le mentionnent en une phrase, avec un lien vers
  cette ancre
- **ADMIN : mot de passe ET double authentification obligatoires**, réglés par le parcours dédié **`/admin/activer`**
  (mot de passe → 2FA → codes de secours, repris là où il s'est arrêté). Un ADMIN a parfaitement le droit d'entrer par
  son lien personnel comme les autres — sa session est alors **ordinaire** — mais **l'espace admin reste fermé tant que
  ce parcours n'est pas terminé** : ce n'est pas une option qu'il peut décliner indéfiniment. **Pourquoi :**
  l'administration technique (paramètres, comptes, sessions, journal d'audit) ne s'ouvre jamais sans second facteur
- **La page de connexion est ouverte à qui s'est donné un mot de passe**, quel que soit son rôle. Le code TOTP est ensuite
  demandé **toujours à un administrateur** (configuré au passage s'il n'en a pas encore), et à quiconque a activé la double
  authentification de lui-même. À qui n'en a pas, elle est **proposée** après le mot de passe, avec un bouton « Plus tard »
  qui ouvre la session sans rien configurer (et pas reproposée avant un trimestre : `User.deuxFaProposeeLe`) — ce
  « Plus tard » est **refusé à un ADMIN**. Un compte **sans** mot de passe reçoit un message générique
  (aucune énumération de comptes) qui le renvoie à son lien personnel. Le reset de mot de passe suit la même règle
- **L'administration technique exige le supplément « du bureau » ET une
  « session forte »** (mot de passe + code TOTP). La force d'une session **ne se déduit jamais** de « mot de passe + 2FA » :
  elle se déduit du **compte** (`peutOuvrirSessionForte`, `src/lib/auth/acces-admin.ts` — un compte actif portant
  `estAdmin` — c'est ce supplément qu'il lit, pas un rôle), au seul endroit où une session forte se
  crée. Un instructeur équipé d'un mot de passe *et* d'une double authentification n'entre pas dans les réglages — vérifié
  par `tests/unit/admin-activation.test.ts` et `tests/unit/permissions.test.ts`
- **Se connecter n'ouvre jamais l'espace admin**. La session créée à la connexion est **ordinaire pour tout
  le monde**, y compris pour un ADMIN qui vient de donner son mot de passe *et* son code : ouvrir l'application
  ne dépose pas dans les réglages sans qu'on l'ait demandé. **Un seul endroit élève** : `renforcerSessionCourante`, appelé par `/connexion/admin` (les deux preuves
  redemandées, même fraîchement connecté) et par la fin du parcours `/admin/activer`. Vérifié par
  `tests/unit/elevation-admin.test.ts` (« la connexion n'élève personne »)
- **La page du lien garde son bouton (POST) : ne jamais le remplacer par une ouverture automatique.**
  Un GET ne consomme rien ; c'est l'appui qui pose la session. Sans ce découpage, les messageries qui
  préchargent les liens (Safe Links, antivirus) « ouvriraient » chaque invitation — et au 3e passage le
  lien serait révoqué automatiquement, cassant l'accès de gens qui n'ont rien fait.
  **La règle vaut pour tout lien d'email qui écrit** : la désinscription l'applique, et les boutons
  « Je viens » / « Je ne viens plus » du récap de la veille aussi. Écrire la réponse pendant le rendu de
  la page, c'est-à-dire sur un GET, laisserait un antivirus de messagerie **répondre à la place du
  membre** — et ce chiffre nourrit les taux et les bilans du club. Le lien
  `/seances?seance=…&reponse=…` ouvre donc un écran qui montre ce qui sera enregistré et attend l'appui
  (`repondreDepuisLien`) : **deux taps depuis l'email, pas plus**. Tout nouveau lien d'email qui écrit
  se découpe de la même façon d'emblée
- **Déjà connecté + lien périmé → on entre** (l'app installée sur iPhone peut rouvrir l'URL du lien) ;
  un jeton inconnu reste compté et journalisé, une révocation de sécurité reste affichée
- **Champ « colle ton lien ici » sur `/connexion`** : sur iPhone, l'app installée ne partage pas le
  stockage de Safari — c'est la seule porte de qui n'a pas de mot de passe. Même chemin de vérification
  que l'ouverture du lien, message générique, jeton jamais recopié dans une erreur ni dans le journal
- **Régénérer un lien déconnecte tous les appareils ; le renouvellement automatique d'échéance, non**
  (sinon tout le club dehors tous les 4 mois) — voir `OptionsEnvoi` dans `src/lib/invitations.ts`
- Utilisateur ayant déjà un compte → le lien le connecte et le rattache à la période
- **Parcours d'entrée, montré une fois par lien** (`Invitation.parcoursVuLe`, pas par personne : un
  nouveau lien le remet une fois, revenir ne coûte pas un clic de plus) : (1) « veux-tu installer
  l'application ? » — oui / je l'ai déjà installée / non —, avec les étapes de la plateforme et le
  bouton « Copier mon lien » ; (2) « consolider ton compte » — mot de passe, puis 2FA si un mot de
  passe vient d'être posé — ou « continuer avec mon lien ». Tout est déclinable, **sauf pour un
  ADMIN** : son lien le connecte (session ordinaire), mais le parcours le dépose sur
  `/admin/activer`, qu'il doit terminer pour ouvrir l'espace admin. La question de
  l'installation est **sautée** sur ordinateur et en mode `standalone`
- Ensuite : connexion classique email + mot de passe depuis n'importe quel appareil, **pour qui s'en est donné un**
- "Mot de passe oublié" par lien email à usage unique (30 min)
- Sessions : **12 h glissantes**, avec ou sans "Rester connecté" — chaque geste dans
  l'application repousse l'échéance de 12 h, et "Rester connecté" ne décide que de la survie du
  cookie à la fermeture du navigateur. **Le glissement se fait à chaque requête** (`echeanceProlongee`, lue par
  `getCurrentUser`) : porté par les seules server actions, il laisserait quelqu'un connecté le matin et revenu le
  soir être mis dehors **au milieu** de son premier geste, le seul moment où l'échéance aurait bougé. `touchSession`
  ne fait que reposer le cookie, et **seulement si la case a été
  cochée** — `AuthSession.persistant`, gardé en base parce qu'un serveur ne peut pas relire le `maxAge` d'un cookie.
  Le reposer systématiquement rendrait persistante la session ouverte sur l'ordinateur d'un ami dès deux gestes à
  trente-cinq minutes d'intervalle, et viderait de son sens la seule case qu'on peut cocher pour s'en protéger.
  **La base est l'autorité sur la durée ; le cookie ne fait que porter le jeton.** **Pourquoi 12 h :** sur un
  téléphone perdu ou prêté, deux mois ne sont pas raisonnables. Ce qui rend ce choix vivable : le lien personnel collé dans l'application est **gardé sur
  l'appareil** (`src/lib/lien-memorise.ts`). L'écran de connexion l'annonce dans un bloc **visible sans rien
  déplier** — « Un lien est gardé sur cet appareil », avec la phrase qui dit qu'un lien personnel est une clé
  valable jusqu'à quatre mois — et porte « Me connecter avec **ce** lien », « Modifier » et **« Oublier »**.
  Le libellé ne dit jamais « **ton** lien » : une seule clé est mémorisée par appareil, et l'écran ne sait pas
  à qui elle est (le serveur seul pourrait le dire, et il n'est pas consulté avant l'appui). Le lien n'est
  jamais affiché en entier.
  **« Se déconnecter » ne l'efface pas** : on se déconnecte de son propre appareil cent fois pour une fois
  qu'on rend celui d'un autre. Le geste du téléphone prêté s'appelle « Oublier », sur l'écran de connexion,
  là même où la déconnexion dépose. **Ce bloc n'est jamais replié** : replié, il laisserait l'écran de
  connexion promettre une clé qu'il ne montre pas.
  Le cookie de passage qui porte le lien après l'ouverture (`src/lib/lien-personnel.ts`, 15 min, `/bienvenue`)
  est **signé et son jeton chiffré**, il nomme son destinataire — comme celui des codes de secours — et la
  déconnexion l'efface : sur une tablette partagée, le compte suivant ne peut pas récupérer la clé du
  précédent.
  Sessions révocables par l'admin ; l'élévation administrateur dure 12 h elle aussi, et se referme en plus **dès que
  l'application est quittée** (`/api/admin/quitter`, prévenu par `sendBeacon`) ou après **10 min sans activité dans
  l'espace admin** (le cookie sans échéance ne suffit pas : les navigateurs le restaurent)

## Notifications (veille du cours) — Discord + email

### Contenu commun (une seule fonction de formatage partagée)
- Date en toutes lettres, horaire (début–fin), lieu, thème du cours,
  nombre de présents / invités et pourcentage (ex "✅ 13 présents / 18 — 72 %")
- Aucun nom de membre
- Exemple :
  🗡️ Cours de demain
  📅 Jeudi 24 septembre 2026 — 19h30 à 21h30
  📍 Gymnase municipal
  📖 Messer — garde haute
  ✅ 13 présents / 18 — 72 %

### Discord
- Cron quotidien à l'heure paramétrée (défaut 18:00, Europe/Paris) pour chaque séance du lendemain non annulée
- POST sur DISCORD_WEBHOOK_URL avec un embed contenant le contenu commun
  (couleur de l'embed : #2B2622, username "Les Compagnons d'Armes", avatar_url = logo hébergé sur l'app)
- En cas d'annulation : message immédiat "❌ Cours annulé" avec date, horaire, lieu et motif (couleur #A5472C)
- Gestion du rate limit Discord (429 + retry_after)

### Email de rappel aux membres
- Même cron que Discord, même contenu commun
- Destinataires : UNIQUEMENT les membres dont le statut pour la séance est PRESENT ou PEUT_ETRE
  (et rappelEmail = true, compte actif)
- Un email individuel par membre (jamais de destinataires visibles entre eux)
- Objet : "🗡️ Rappel : cours demain à 19h30 — <thème>"
- Rappel de son propre statut dans le mail ("Tu es inscrit(e) : Présent")
  + boutons "Je viens" / "Je ne viens plus" menant à l'app (connexion requise)
- Lien de désinscription en pied de mail (jeton signé, désactive rappelEmail sans connexion)
- Template HTML simple, lisible sur mobile, aux couleurs HEMA, logo en en-tête (URL absolue + texte alternatif) + version texte
- En cas d'annulation : email immédiat aux mêmes destinataires
- Envoi espacé (file simple) pour respecter les limites SMTP

### Telegram
- Même rôle que Discord, pour les clubs qui tiennent un groupe Telegram.
  `src/lib/notifications/telegram.ts`, écran `/admin/notifications/telegram`
- **Un second débouché du même contenu** : les messages sont mis en forme une seule fois (embed,
  `contenu.ts`) et `texteTelegram` les transcrit en HTML restreint. Ne jamais écrire un contenu
  propre à Telegram — une correction doit se voir sur les deux canaux
- Porte les messages **collectifs** (récap, annulation, effectif faible, événements). Jamais les
  messages personnels : ils nomment quelqu'un, un groupe est public
- Jeton du bot et `chat_id` **chiffrés en base** (comme le webhook Discord), à défaut
  `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`. Le jeton est vérifié (`getMe`) **avant** enregistrement
  et n'est jamais réaffiché ; l'écran relève les salons (`getUpdates`) pour éviter au bureau de lire
  du JSON dans son navigateur
- Clé de déduplication **propre au canal** (`…_telegram_<id>`) : les deux salons partent, échouent et
  réessaient indépendamment
- Une annonce d'événement part **une fois** (pas de suivi des corrections, contrairement à Discord)

### Partage WhatsApp (manuel)
- Bouton "Partager sur WhatsApp" visible **par tout le monde** sur chaque séance à venir : le résumé
  partagé est celui des pages publiques (date, horaire, lieu, thème, taux) et **ne contient aucun nom**,
  il n'y a donc rien à réserver à l'encadrement. Le bouton reste en retrait sur la carte — répondre à
  l'appel demeure la seule action qui compte
- Contenu commun + lien vers l'app, construit au moment du clic (chiffres à jour)
- Ouvre https://wa.me/?text=<message encodé> (l'utilisateur choisit le groupe et envoie)
- Sur mobile, utiliser l'API Web Share si disponible, sinon wa.me
- Bouton secondaire "Copier le texte" (Clipboard API, confirmation visuelle)

### Alerte « peu de monde »
- **Trois jours avant le cours, pas plus tôt** (`HORIZON_ALERTE_EFFECTIF`) : fenêtre J-3 → le jour
  même, une seule alerte par séance (`effectif_<id>`). Alerter sur « les deux prochaines séances »
  quelles que soient leurs dates préviendrait pour des cours situés à une ou deux semaines de là,
  quand il n'y a encore rien à décider

### Fenêtres de temps des écrans
- `src/lib/horizon.ts`, les mêmes puces partout (séances, planning, tableau de bord) : **Toute la période · 2 mois ·
  1 mois · 2 semaines · 1 semaine · Prochain cours**. Les libellés sont **en durée** : « 1 mois » et non
  « Mois », « Toute la période » et non « Tout le trimestre »

### Le canal « Site du club » — il n'envoie rien
- La matrice porte un sixième canal, `api` (« Site du club »). Il ne ressemble aux
  cinq autres que par sa colonne : **rien ne part, quelqu'un vient lire.** Toute la mécanique du dossier lui
  est donc étrangère — pas de file d'envoi, pas de `journaliser`, pas de `marquerEchec`, pas de clé de
  déduplication, pas de `destinataireRetenu`. `envoiPossible` rend **`false`** pour lui par construction, et la
  vraie question porte un autre nom : `expositionPossible(type, portes?)`, qui compose **trois** conditions
  et non deux — publication ouverte (`isPublicApiEnabled`), **interrupteur du canal** coché, et case du type
  cochée. Les trois écrans qui en parlent la lisent, jamais la matrice en direct : ce qu'ils annoncent
  est ce que la route rend. `portesExposition()` lit les
  deux réglages **une fois** pour les trois types. Un test relit les neuf modules d'envoi et échoue si l'un
  d'eux le nomme
- **Trois types ont une case, et trois seulement** : `recap_veille`, `seance_annulee`, `evenement_nouveau`.
  Tous **décochés à l'installation** — une mise à jour ne publie jamais ce que le club n'a pas décidé.
  `effectif_faible` n'en a **jamais** : c'est un appel à décider adressé aux instructeurs, et son email porte
  un **lien d'annulation signé au nom de son destinataire** — une clé, pas une information. Les messages
  personnels (rappel, réponse d'atelier) et les affaires de bureau (période suivante, période non activée) non
  plus. Chaque exclusion porte **sa phrase** (`RAISON_API_EXCLUE`), affichée telle quelle dans l'infobulle de
  la case grisée : une case **ou** une raison, jamais les deux, jamais aucune

- **Une case grisée n'exprime aucune décision**. Les cellules d'un canal non opérationnel sont
  rendues `disabled`, donc **absentes du formulaire** — où une case absente vaudrait « décochée ».
  `figerCanauxIndisponibles` reprend donc pour ces couples la **valeur enregistrée** : le formulaire ne
  peut ni les allumer ni les vider, comme pour l'adresse de liste et le quota, qui se règlent ailleurs.
  Corollaire : **toute écriture de cet écran exige `exigerReauth`**, la matrice
  comprise (elle décide de ce qui part *et* de ce que le club publie sur Internet)

### Commun
- Interface Notifier (DiscordNotifier, EmailNotifier) pour ajouter d'autres canaux plus tard
- Retry x3 avec backoff, journal NotificationLog, ne jamais bloquer l'app en cas d'échec
- Idempotence : pas de double envoi. **Une clé de déduplication porte ce qui identifie
  l'occurrence annoncée, pas seulement la ligne de base** : type + canal + destinataire + jalon, et
  l'**empreinte du créneau** de la séance (`empreinteCreneau`, `notifications/planification.ts`) —
  une séance déplacée garde son identifiant, et une clé qui ne porterait que lui bloquerait l'annonce de
  la bonne date après celle de la mauvaise. Même règle ailleurs : la clé d'une décision
  d'atelier porte l'horodatage de la décision, sans quoi un second refus après « réexaminer » ne
  partirait pas. L'empreinte ne porte **que** le créneau : corriger un thème ou un lieu ne renvoie rien
- **La clé se pose AVANT l'envoi** (`journaliser`), jamais après : c'est la contrainte d'unicité qui
  tranche entre deux passages simultanés. Et **tout envoi libère sa clé en cas d'échec**
  (`marquerEchec`) — sans quoi la reprise promise n'a jamais lieu. **L'invariant se vérifie par un test
  par module d'envoi**, jamais une fois pour toutes : une clé écrite *après* l'envoi fait partir deux
  fois « Cours annulé » à tout le club dès que deux instructeurs annulent en même temps, et un module
  sans `marquerEchec` perd définitivement une alerte de sécurité que le serveur d'envoi a ratée. Chaque
  envoi est un chemin de code à part, et un chemin vérifié ne dit rien de son voisin
- **Une modification ne vaut jamais première annonce.** Une notification « nouveauté » ne part qu'au
  moment où l'objet *devient* public (comparer l'état d'avant à celui d'après), jamais à chaque
  enregistrement. Ne pas s'en remettre à la déduplication pour tenir cette règle : une clé ne protège
  qu'un canal qui existait déjà à la publication, et un canal branché plus tard annoncerait comme neuf
  ce qui date de six mois. Toute autre écriture ne fait que **synchroniser** (message édité, barré,
  jamais posté). Contrepartie assumée : un salon en panne à l'instant exact de la publication oblige à
  dépublier/republier

## API publique (pour le site WordPress)
- GET /api/public/prochaines-seances?limit=5 : date, horaires, lieu, thème, alternative, taux %, annulée,
  et le **programme** partie par partie (nom calculé, thème, niveau, description — jamais un nom de personne)
- **GET /api/public/annonces** : ce que le club a décidé de **republier** sur son site — le récap
  de la veille, une séance annulée, un nouvel événement. **Deux portes, indépendantes** : la publication doit
  être ouverte (`isPublicApiEnabled`), **et** la notification doit avoir sa case dans la colonne « Site du
  club » de la matrice. Aucune case cochée rend `200` et une liste **vide**, jamais une erreur : un site n'a
  pas à traiter un 4xx pour afficher une liste vide
- Aucune donnée nominative, lecture seule, CORS limité à PUBLIC_API_ORIGIN
- Cache HTTP 5 min, rate limiting (**le même seau** pour les deux routes), désactivable dans les paramètres admin
- **Les gardes valent pour tous les verbes, `OPTIONS` comprise** : le préalable CORS passe par
  l'interrupteur et par le seau comme les autres requêtes, et une porte fermée ne publie pas l'origine
  autorisée du site du club. Un refus ne porte **aucun en-tête CORS** : il n'y a rien à autoriser quand il
  n'y a rien à lire
- **Le plugin WordPress livré applique le refus tout de suite** : son cache de secours (7 jours) ne joue que sur une
  **panne réseau**, jamais sur un refus délibéré. Décocher la case retire aussitôt les cours du site du club —
  adresses de salle et motifs d'annulation compris
- **`/api/image` n'est pas une porte publique, et ne rapatrie que ce que le serveur connaît déjà** : l'affiche d'un
  événement enregistré, ou l'illustration qu'un aperçu de lien vient de proposer. Elle ne sert donc pas à sonder un
  hôte quelconque depuis l'adresse IP du club, et tout échec rend un **seul** message, qui ne distingue pas les cas
  (rien ne répond à « ce port est-il ouvert ? »)

