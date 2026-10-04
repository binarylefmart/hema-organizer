# Rôle

> **Ce document décrit l'application, pas la façon dont elle a été écrite.** Les sections qui
> décrivaient le poste de travail de l'auteur, son découpage en étapes et sa manière de
> travailler avec son assistant ont été retirées de cette copie publique : elles ne disaient
> rien du logiciel. Ce qui reste — la pile, les rôles, le modèle de données, les règles de
> sécurité, l'UX, la charte et les contraintes de production — est la référence
> d'architecture du projet.

Tu es un développeur full-stack senior, rigoureux sur la sécurité et l'UX accessible.
Tu construis une application complète, prête pour la production, livrée en image Docker.

# Contexte
Association d'AMHE (arts martiaux historiques européens) : « Les Compagnons d'Armes » (sigle HEMA)
(site WordPress : https://mon-club.fr).
Besoin : remplacer Cally par un outil de gestion de présence aux cours.
Public : membres de tous âges, certains très peu à l'aise avec l'informatique.
→ Interface ultra simple, lisible, gros boutons, zéro jargon, 100 % en français.
Contrainte : uniquement des services gratuits, aucun numéro de téléphone ni service payant.
Les logos sont fournis : public/logo.png (le logo complet) et public/logo-ecu.png (l'écu seul), fond transparent.

# Stack imposée
- Next.js 15 (App Router, TypeScript strict, output standalone), Tailwind CSS
- SQLite via Prisma
- Auth : sessions serveur (cookie httpOnly, Secure, SameSite=Lax), mots de passe argon2id, passkeys (WebAuthn) en option
- Emails : Nodemailer SMTP (paramètres en variables d'environnement)
- Notifications : webhook Discord (POST JSON, embed) + email SMTP + lien de partage WhatsApp (wa.me), aucune lib tierce
- Tâches planifiées : node-cron dans l'app (fuseau Europe/Paris)
- PWA installable : manifeste, icônes engendrées par `npm run icons:generate` (192, 512, maskable, badge,
  apple-touch-icon) et service worker minimal — **sans cache**, il n'existe que pour les notifications
  push (Web Push, clés VAPID engendrées au premier besoin et rangées chiffrées en base : aucune variable
  à ajouter).
- Pas de TLS dans l'app (géré par NPM), faire confiance à X-Forwarded-* ;
  domaine : organizer.mon-club.fr

# Rôles

**Un rôle de base pour tout le monde, et « administrateur » en supplément.** Des rôles exclusifs
interdiraient le cas le plus courant d'une petite association : un membre du bureau qui enseigne.
Nommer quelqu'un au bureau ne lui retire donc aucun droit. La règle :
- `User.role` est le **rôle de base** : `MEMBRE` ou `INSTRUCTEUR` (`ROLES_DE_BASE`). **Il ne vaut plus
  jamais `"ADMIN"`** — la migration `role_de_base_et_admin_en_supplement` a déplacé la valeur (anciens
  administrateurs → `role = MEMBRE`, `estAdmin = true`), aucun droit perdu ;
- `User.estAdmin` dit **du bureau**, par-dessus le rôle de base. Les deux droits **s'additionnent** :
  `can()` accorde la ligne `ADMIN` de la matrice à quiconque porte le supplément, **en plus** de son rôle
  de base — un instructeur du bureau garde le planning *et* reçoit l'administration ;
- **tout ce qui veut savoir si quelqu'un est du bureau lit `estAdmin`, jamais `role`.** Une garde restée
  sur `role === "ADMIN"` ne lève plus jamais : elle ne refuse plus rien, ou refuse tout, **sans rien
  dire**. Et un `select` Prisma qui prend `role: true` sans `estAdmin: true` passe `undefined`, donc
  « pas du bureau », donc un refus silencieux. Cinq gardes l'ont appris le jour du changement, dont
  `exigerReauth` — écrite sur le rôle, elle rendait la main tout de suite, et plus **aucun** geste
  sensible ne redemandait de code récent ;
- `can()` garde un **repli** sur `role === "ADMIN"` : une base que la migration n'aurait pas traversée,
  ou un jeu d'essai écrit à l'ancienne, ne doit pas perdre l'accès au bureau en silence. Il ne donne rien
  à personne d'autre, plus aucun écran n'écrivant cette valeur. **Un test qui simule un administrateur
  par `role: "ADMIN"` ne prouve donc rien** : il passe par le repli, pas par la forme réelle de la base —
  un rôle de base **plus** le supplément, en choisissant `INSTRUCTEUR` partout où la permission visée
  n'est ouverte à aucun instructeur, de sorte que tout ce qui passe ne peut passer que par `estAdmin` ;
- **le rôle de base s'attribue dans l'annuaire** (`canAssignRole`, qui refuse désormais toute autre
  valeur que les deux rôles de base) ; **le bureau se donne et se retire à sa page**, derrière
  `peutNommerAdmin` (= `admins.manage`) et l'élévation, par un **second menu déroulant**
  (`SelecteurBureau` : `----------` ou `admin`) posé **hors** du formulaire d'identité. Il
  **n'enregistre pas au `change`** — la liste choisit, une confirmation nomme, un bouton écrit, parce
  que ce geste-là donne ou retire *tous* les droits du club, et qu'une molette sur un téléphone ne nomme
  pas un administrateur. L'annuaire n'a **aucun** chemin vers le bureau, requête forgée comprise : trois
  verrous indépendants le tiennent (schéma, permission, valeur écrite).

Ce que chacun peut faire reste réparti comme suit — « ADMIN » se lisant désormais « qui porte le
supplément », quel que soit son rôle de base :
- ADMIN : tous les droits, y compris la gestion technique (paramètres, webhook Discord, SMTP,
  API publique, sessions de connexion, journal d'audit, gestion des comptes ADMIN), **plus le trimestre et
  l'annuaire** (`/admin/periodes`, `/admin/membres`) **et les thèmes du planning**
  (`/admin/themes`, `themes.manage` : la liste vaut pour tout le club). Tous ces écrans vivent dans
  **l'espace admin** et exigent en plus une **élévation** : mot de passe et code redonnés sur `/connexion/admin`
- INSTRUCTEUR : il travaille **dans** le trimestre — séances, planning (thème et alternative d'une séance,
  parties d'une séance et leur contenu), présences, ateliers,
  tableau de bord, exports — et tient les **annonces d'événements** (création, modification, publication,
  suppression : `evenements.edit` + `evenements.creer_supprimer`),
  mais ni la gestion technique, ni les comptes, ni l'annuaire, ni le trimestre lui-même.
  **Il ne touche ni aux comptes ni aux accès** : l'annuaire lui est
  **fermé** — `members.view` comprise, avec l'écran des membres parti dans l'espace admin —, et il ne crée, ne
  modifie — l'adresse email comprise — ni ne supprime aucun compte, n'attribue aucun rôle, et ne renvoie ni ne
  révoque le lien personnel de qui que ce soit. **Pourquoi :** changer l'adresse de quelqu'un *et* lui renvoyer son lien
  fait arriver ce lien chez soi, donc permet d'entrer sous son identité — deux gestes anodins qui, ensemble, valent un
  mot de passe. Chacun peut en revanche se renvoyer **le sien** depuis « Mon profil ». Qui vient à un cours se lit
  **sur la séance elle-même**, là où c'est utile ; l'annuaire, lui, est un registre de comptes.
  **Le trimestre appartient aussi au bureau** : le créer, engendrer ses séances en récurrence, le modifier,
  l'**activer** (`periods.manage`) et l'effacer (`periods.delete`) sont réservés aux ADMIN. **Pourquoi :** activer un
  trimestre l'ouvre au travail de l'équipe et enclenche, trois jours avant son début, le départ des liens personnels —
  un email et un accès de quatre mois pour chaque membre. Ça engage le club, là où animer un cours n'engage que la séance
- MEMBRE : indique sa présence, consulte les séances et les **événements** (lecture seule), propose des ateliers,
  règle son profil
- Les droits sont définis dans une matrice centrale de permissions (ex. can(user, "periods.manage")), vérifiée côté serveur

# Modèle de données (minimum)
- User (id, prénom, nom, email unique, **rôle de base** MEMBRE|INSTRUCTEUR, **estAdmin** bool, passwordHash, actif, rappelEmail bool défaut true, createdAt)
- Period (id, nom ex "T4 2026", dateDebut, dateFin, statut BROUILLON|ACTIVE|CLOSE)
- PeriodMember (periodId, userId) — membres invités sur la période
- Session (id, periodId, date, heureDebut, heureFin, lieu, theme, alternative, instructeurs[], annulee, motifAnnulation)
- SessionPartie (id, sessionId, libelle, ordre, estOption, instructeurId?, instructeurSecondId?, theme,
  description, niveau, atelierId?) — les parties d'une séance, **en nombre libre** : c'est le planning.
  `ordre` est le rang affiché (contigu depuis zéro après chaque écriture), `niveau` vaut INDIFFERENT par
  défaut, `description` est vide par défaut. **`libelle` est une valeur DÉRIVÉE, jamais saisie**
  : il vaut toujours `libellePartie(rang dans la nature, estOption)` et le code le tient à
  jour à chaque écriture. Il n'a jamais été une clé, et ne l'est toujours pas
- Attendance (userId, sessionId, statut PRESENT|ABSENT|PEUT_ETRE, updatedAt) — unique (userId, sessionId)
- Atelier (id, proposeParId, sessionId?, titre, description, dureeMinutes?, materiel?,
  statut PROPOSE|VALIDE|REFUSE|PLANIFIE, commentaireInstructeur?, createdAt, updatedAt)
- Invitation (id, userId, periodId, tokenHash SHA-256, expiresAt = fin de période, usedAt, revokedAt)
- NotificationLog (type, canal, sessionId, userId?, statut, erreur, date)
- AuditLog (acteur, action, cible, date, ip)

# Fonctionnalités

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
  dossier traque (le dénominateur, lui, n'est pas borné) ; et `/admin/presences` doit continuer d'accepter
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
  **par partie**, sur chaque séance du trimestre. À 1 440 px : **1 477 px de page et zéro zone de
  saisie** en lecture, contre **4 205 px** en modification. En lecture, l'annuaire du club et la liste
  des ateliers ne traversent pas vers le navigateur (`optionsDepuis` ne les envoie qu'à qui peut s'en
  servir) : sur un trimestre de vingt-six séances, ce n'est pas rien
  - **Trois boutons** : « Modifier le planning » ouvre la saisie, « Appliquer les modifications » la
    referme en écrivant, « **Annuler** » la referme en jetant. **Une sortie se cherche à la même place
    que l'entrée** — elle se présente donc comme elle, en bouton, et non en lien discret. Il est
    toujours montré, en **secondaire** (ce qui écrit garde le seul bouton plein), **à gauche**
    d'« Appliquer » (on ne met pas ce qui jette sous le pouce qui valide), et ne demande confirmation
    que s'il y a quelque chose à perdre. **Il appelle `vider()` avant de quitter l'adresse**, et pas
    seulement `router.push` : le registre de la garde de fermeture porte une clé par case réglée, et
    une garde laissée armée ferait poser au navigateur sa question sur un planning en lecture seule.
  - **Le mode vit dans l'URL** (`?modifier=1`), comme le trimestre, la fenêtre de temps et la date
    cherchée : le retour du navigateur sort du mode, un lien se partage tel qu'on le lit, et quitter
    l'adresse **jette le brouillon**, qui n'a jamais touché la base. Seul `1` ouvre la saisie — `0`,
    `true`, un reste de copier-coller rendent la lecture seule : un écran de saisie ne s'ouvre pas sur
    un à-peu-près. La règle est dans un module pur (`src/components/planning/mode-edition.ts`) :
    entrer en modification ne fait perdre **aucun filtre**, sans quoi il faudrait tout refiltrer avant
    de corriger la case qu'on avait sous les yeux.
  - **Et le mode exige le DROIT en plus du paramètre** (`enEdition = peutModifier && modeEdition`).
    `?modifier=1` s'écrit à la main : sans cette conjonction, un membre voyait la barre « Appliquer les
    modifications » au-dessus d'un planning qu'il ne peut pas régler. Rien n'était ouvert (les options
    suivent le droit, l'action exige `planning.edit`), mais l'écran promettait un geste inexistant.
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
  - Corollaire trouvé en écrivant le geste par lots : **une séance annulée verrouille aussi son
    programme** (`partiePourEcriture` et `seancePourEcriture`). Elles ne regardaient que le statut du
    trimestre, si bien qu'un appel forgé pouvait remplir le programme d'un cours annulé — programme qui
    **sort du club** (pages de partage, API publique). Ce n'était pas un oubli isolé mais une
    divergence : `programmerAtelierDansCase` refusait déjà l'annulation de son côté, et deux portes vers
    la même écriture ne peuvent pas avoir deux serrures
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
- **La nature d'une partie se choisit à l'ajout, et ne change plus après coup.** Deux boutons —
  *ajouter un cours*, *ajouter une option* — posent la nature au moment où elle se décide. Pour en
  changer, on **retire la partie et on ajoute l'autre** : aucune ligne ne bouge sous le doigt. Changer
  la nature en place déplacerait la partie d'une série à l'autre, donc de place, et la suivante
  hériterait de son nom. `changerNaturePartie` reste côté serveur avec ses verrous et ses tests,
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
  reconstituent pas. Il demandait `sessions.manage` : un instructeur pouvait donc vider un trimestre
  entier séance par séance, depuis un bouton qu'on lui affichait, alors que la même destruction en un
  clic depuis l'écran de la période lui était refusée. **Deux portes vers la même destruction ne
  peuvent pas avoir deux serrures.** Le bouton n'est rendu qu'à qui peut aboutir (permission *et*
  session forte) : un bouton qui ne peut que refuser est pire que pas de bouton
- **Une période CLOSE verrouille aussi ses séances** : le planning refusait déjà toute
  écriture sur un trimestre clos (`partiePourEcriture`, `seancePourEcriture`, `periodeOuverte`), mais
  la séance restait ouverte — on pouvait changer son horaire, réécrire son thème par autosave,
  l'effacer, et surtout **l'annuler**, ce qui fait partir un email à tous les invités plus une annonce
  sur Discord et Telegram, à propos d'un cours d'un trimestre terminé. Le lien d'annulation des emails
  tombe pour la même raison (`porteurJetonAnnulation`). **Le verrou ne se déduit pas de la date** : on
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
  valables**, et marque comme envoyés les liens d'un trimestre déjà commencé qui n'était pas encore parti. Sans ces
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
  `attendances.autrui` est **sortie** de la liste `SANS_SESSION_FORTE` (`src/lib/permissions.ts`), donc
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
  donne et ne se retire que là** : l'annuaire (`/admin/membres`, fiche comprise) ne propose plus que *membre* et
  *instructeur*. **Un administrateur ne se crée pas de zéro** : cet onglet n'a pas de formulaire de
  création — il doublerait celui de l'annuaire et pourrait ouvrir un second compte à quelqu'un de déjà
  inscrit. On ajoute la personne dans « Membres », puis on la **nomme** ici ; `creerMembre` et
  l'import CSV refusent le rôle ADMIN. Révocation des sessions, consultation de l'AuditLog
- **Derniers emails envoyés** (`/admin/parametres`) : les douze derniers envois journalisés avec leur verdict et le
  message du serveur SMTP en cas d'échec — c'est là qu'on tranche un « il n'a rien reçu »

*(`/gestion/periodes/**` et `/gestion/membres/**` redirigent vers `/admin/periodes/**` et
`/admin/membres/**` : des emails portent les anciennes adresses.)*

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
  TOTP. **Pourquoi :** le lien *seul* enfermait dehors quiconque perdait son email ou changeait d'appareil, et la seule
  issue était de déranger un administrateur. Sans mot de passe, on entre par son lien, comme avant. Les écrans qui
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
- **Ce qui ne change pas, et ne doit jamais changer : l'administration technique exige le supplément « du bureau » ET une
  « session forte »** (mot de passe + code TOTP). La force d'une session **ne se déduit jamais** de « mot de passe + 2FA » :
  elle se déduit du **compte** (`peutOuvrirSessionForte`, `src/lib/auth/acces-admin.ts` — un compte actif portant
  `estAdmin` — c'est ce supplément qu'il lit, pas un rôle), au seul endroit où une session forte se
  crée. Un instructeur équipé d'un mot de passe *et* d'une double authentification n'entre pas dans les réglages — vérifié
  par `tests/unit/admin-activation.test.ts` et `tests/unit/permissions.test.ts`
- **Se connecter n'ouvre jamais l'espace admin**. La session créée à la connexion est **ordinaire pour tout
  le monde**, y compris pour un ADMIN qui vient de donner son mot de passe *et* son code : elle naissait « forte », si
  bien qu'ouvrir l'application déposait dans les réglages sans l'avoir demandé, et que les 12 h de l'élévation partaient
  toutes seules. **Un seul endroit élève** : `renforcerSessionCourante`, appelé par `/connexion/admin` (les deux preuves
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
  l'application repousse l'échéance de 12 h, et "Rester connecté" ne décide plus que de la survie du
  cookie à la fermeture du navigateur. **Le glissement se fait à chaque requête** (`echeanceProlongee`, lue par
  `getCurrentUser`) : porté par les seules server actions, il laisserait quelqu'un connecté le matin et revenu le
  soir être mis dehors **au milieu** de son premier geste, le seul moment où l'échéance aurait bougé. `touchSession`
  ne garde que ce qu'elle est seule à pouvoir faire : reposer le cookie. Et elle ne le repose **que si la case était
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
  **« Se déconnecter » ne l'efface pas** : il l'effaçait, et chaque déconnexion de son propre
  téléphone renvoyait chercher son email — or on se déconnecte de son propre appareil cent fois pour une fois
  qu'on rend celui d'un autre. Le geste du téléphone prêté s'appelle « Oublier », sur l'écran de connexion,
  là même où la déconnexion dépose. **Ce bloc ne doit jamais repasser derrière un pli** : replié, il
  laisse l'écran de connexion promettre une clé qu'il ne montre pas.
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
  cochée. Les trois écrans qui en parlent la lisent, jamais la matrice en direct : la page du canal l'avait
  fait, et annonçait « republiée » pendant que la route rendait une liste vide. `portesExposition()` lit les
  deux réglages **une fois** pour les trois types. Un test relit les neuf modules d'envoi et échoue si l'un
  d'eux le nomme
- **Trois types ont une case, et trois seulement** : `recap_veille`, `seance_annulee`, `evenement_nouveau`.
  Tous **décochés à l'installation** — une mise à jour ne publie jamais ce que le club n'a pas décidé.
  `effectif_faible` n'en a **jamais** : c'est un appel à décider adressé aux instructeurs, et son email porte
  un **lien d'annulation signé au nom de son destinataire** — une clé, pas une information. (L'argument écrit
  d'abord, « annoncer qu'un cours se remplit mal », était faux : le **taux** du cours de demain sort déjà par
  le récap, et celui des cinq prochains par l'autre route. Une raison fausse dans un commentaire finit par
  servir d'argument à quelqu'un.) Les messages
  personnels (rappel, réponse d'atelier) et les affaires de bureau (période suivante, période non activée) non
  plus. Chaque exclusion porte **sa phrase** (`RAISON_API_EXCLUE`), affichée telle quelle dans l'infobulle de
  la case grisée : une case **ou** une raison, jamais les deux, jamais aucune

- **Une case grisée n'exprime aucune décision**. Les cellules d'un canal non opérationnel sont
  rendues `disabled`, donc **absentes du formulaire** — et une case absente vaut « décochée ». Enregistrer la
  matrice effaçait ainsi les cases d'un canal fermé, en silence, alors que l'écran promet le contraire.
  `figerCanauxIndisponibles` reprend désormais de l'état **d'avant** la valeur de ces couples : le formulaire
  ne peut ni les allumer ni les vider. C'est déjà ce que la même fonction faisait pour l'adresse de liste et
  le quota, qui se règlent ailleurs — deux façons opposées de traiter le même cas dans une seule fonction
  auraient été le vrai défaut. Corollaire : **toute écriture de cet écran exige `exigerReauth`**, la matrice
  comprise (elle décide de ce qui part *et* de ce que le club publie sur Internet)

### Commun
- Interface Notifier (DiscordNotifier, EmailNotifier) pour ajouter d'autres canaux plus tard
- Retry x3 avec backoff, journal NotificationLog, ne jamais bloquer l'app en cas d'échec
- Idempotence : pas de double envoi. **Une clé de déduplication porte ce qui identifie
  l'occurrence annoncée, pas seulement la ligne de base** : type + canal + destinataire + jalon, et
  l'**empreinte du créneau** de la séance (`empreinteCreneau`, `notifications/planification.ts`) —
  une séance déplacée garde son identifiant, et une clé qui ne portait que lui interdisait à jamais
  l'annonce de la bonne date après celle de la mauvaise. Même règle ailleurs : la clé d'une décision
  d'atelier porte l'horodatage de la décision, sans quoi un second refus après « réexaminer » ne
  partirait pas. L'empreinte ne porte **que** le créneau : corriger un thème ou un lieu ne renvoie rien
- **La clé se pose AVANT l'envoi** (`journaliser`), jamais après : c'est la contrainte d'unicité qui
  tranche entre deux passages simultanés. Et **tout envoi libère sa clé en cas d'échec**
  (`marquerEchec`) — sans quoi la reprise promise n'a jamais lieu. **L'invariant se vérifie par un test
  par module d'envoi**, jamais une fois pour toutes : une clé écrite *après* l'envoi fait partir deux
  fois « Cours annulé » à tout le club dès que deux instructeurs annulent en même temps, et un module
  sans `marquerEchec` perd définitivement une alerte de sécurité que le serveur d'envoi a ratée. Chaque
  envoi est un chemin de code à part, et un chemin corrigé ne dit rien de son voisin
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
- **Les gardes valent pour tous les verbes, `OPTIONS` comprise**. Le préalable CORS ne passait ni
  l'interrupteur ni le seau : une porte annoncée fermée répondait `204` **en publiant l'origine autorisée du site du
  club**, et une boucle sur ce seul verbe était gratuite et illimitée — donc le « 60 appels/min/IP » du dossier ne
  couvrait que la moitié de ce qui est exposé. Un refus ne porte désormais **aucun en-tête CORS** : il n'y a rien à
  autoriser quand il n'y a rien à lire
- **Le plugin WordPress livré applique le refus tout de suite** : son cache de secours (7 jours) ne joue que sur une
  **panne réseau**. Il ne distinguait pas un refus délibéré d'une coupure, si bien que décocher la case laissait le
  site du club afficher les cours pendant une semaine — adresses de salle et motifs d'annulation compris. La promesse
  « refermer coupe tout d'un coup » était vraie du serveur et fausse de la vitrine que ce dépôt livre lui-même
- **`/api/image` n'est pas une porte publique, et ne rapatrie que ce que le serveur connaît déjà** : l'affiche d'un
  événement enregistré, ou l'illustration qu'un aperçu de lien vient de proposer. Elle ne vérifiait **rien** — un
  simple membre pouvait faire sonder n'importe quel hôte public depuis l'adresse IP du club, et ses messages d'erreur
  distinguaient les cas, donc répondaient par écrit à « ce port est-il ouvert ? ». Tout échec rend un **seul** message

# Sécurité (obligatoire)
- Validation de toutes les entrées avec Zod, côté serveur
- Protection CSRF sur les mutations, en-têtes de sécurité (CSP stricte, X-Frame-Options DENY, Referrer-Policy)
- Rate limiting : login, invitation, reset, désinscription, API publique (par IP et par email)
- Messages d'erreur génériques (pas d'énumération de comptes)
- Contrôle d'accès vérifié côté serveur sur chaque route/action
- Aucune élévation de privilège possible : l'annuaire est fermé à un INSTRUCTEUR, et le supplément « du bureau »
  (`estAdmin`) ne s'écrit **que** derrière `admins.manage` et l'élévation — le geste de rôle, à l'unité comme en masse,
  n'écrit jamais ce champ. Depuis que le rôle de base n'ouvre plus rien par lui-même, un administrateur a le droit de
  régler **le sien** (se dire instructeur ne lui donne aucun droit qu'il n'ait déjà) ; ce qui reste refusé sur son propre
  compte, c'est se désactiver, se supprimer et **se retirer le bureau**
- Description des ateliers affichée en texte brut (échappée), longueur limitée
- Aucun secret dans le code : .env.example documenté ; secrets uniquement côté serveur
- Sauvegarde SQLite quotidienne (sqlite3 .backup ou API Prisma équivalente) vers BACKUP_DIR, rétention 30 jours
- AuditLog sur les actions admin/instructeur et les connexions
- **Un jeton signé porte son usage, et chaque lecteur exige le sien.** Un seul secret (`SESSION_SECRET`)
  signe tout ce que l'application frappe : cookies de passage, jeton d'élévation, liens d'email. Une
  signature qui ne couvrirait que les **champs** rendrait ces jetons interchangeables dès que deux
  d'entre eux ont la même forme — et certains dorment en clair dans le pied d'un email, pour un an.
  Trois règles, et elles sont structurelles : **aucun jeton ne se signe sans usage**
  (`signPayload(charge, secret, usage)` — l'usage entre dans le HMAC, donc le retoucher invalide la
  signature au lieu de la contourner) ; **aucun lecteur ne lit sans dire ce qu'il attend** (un
  `verifySignedPayload` sans usage ne compile pas), les usages étant déclarés un par un dans
  `USAGES_JETON` (`src/lib/auth/tokens.ts`) ; et **un lecteur valide la forme entière de la charge**,
  pas seulement les champs dont il se sert — sans quoi une charge mal typée lève une exception au
  milieu d'une action au lieu d'un refus propre. Contre-épreuves : les usages croisés **deux à deux**,
  de sorte qu'un usage ajouté sans être déclaré à la lecture fait échouer les tests
- **Les gestes qui, ensemble, valent un mot de passe exigent un code récent des deux côtés.** Changer l'adresse de
  quelqu'un *et* lui renvoyer son lien fait arriver chez soi une clé de quatre mois à son nom : `definirEmailMembre`,
  la branche « adresse » de `modifierMembre` et `envoyerLienMembre` appellent tous `exigerReauth`.
  Corriger une moitié sans l'autre laisserait la paire ouverte
- **Détruire des réponses de membres appartient au bureau.** `supprimerSeance` exigeait `sessions.manage` (donc aussi
  un INSTRUCTEUR, sans élévation) et effaçait la séance **avec toutes ses réponses**, alors que son jumeau de masse
  exigeait `periods.manage` + élévation : un instructeur pouvait vider un trimestre séance par séance, depuis un bouton
  qui lui était affiché. Deux portes vers la même destruction ne peuvent pas avoir deux serrures
- **Une période close verrouille aussi la séance, pas seulement le planning.** On pouvait **annuler** un cours d'un
  trimestre terminé — donc faire partir un email à tous les invités et une annonce sur les deux salons. Le verrou ne
  se déduit pas de la date (on clôt un trimestre sans attendre son dernier cours) : c'est le statut qui tranche, et il
  s'écrit **une fois** (`ecritureFermee`, `src/lib/constants.ts`), lu par les quatre appelants
- **Aucune mutation par GET.** Un lien d'email mène à un écran qui **montre** ce qui sera enregistré et demande un
  appui (POST) : `/seances?seance=…&reponse=present` écrivait au rendu, si bien qu'un antivirus de messagerie
  préchargeant le lien répondait **à la place du membre**. Même argument que la page d'invitation, qui a toujours eu
  son bouton
- **Tout export d'un module `"use server"` appelle une garde, et un balayage l'exige** — `tests/unit/gardes-serveur.test.ts`
  relit la source de chaque module portant la directive (pas seulement `src/actions/**`) et échoue sur un export sans
  `assertPermission` / `requireUser` / `exigerReauth`, ou sans `getCurrentUser` suivi d'un refus. Les exceptions
  légitimes — les portes de qui n'est pas encore connecté — se déclarent avec **leur raison écrite**, jamais comme une
  simple liste de noms. C'est le filet qui aurait attrapé les trois défauts ci-dessus
- **Une permission qui n'est vérifiée nulle part est un piège, pas une réserve.** Quatre lignes de la matrice étaient
  mortes et **deux mentaient** (le partage WhatsApp est ouvert à tout le monde, la liste des participants s'affiche à
  chaque invité) : elles ont été retirées, et un balayage exige désormais que chaque clé de la matrice apparaisse
  ailleurs que dans `src/lib/permissions.ts`

# UX / Accessibilité
- Mobile first, parfait aussi sur PC (largeur max confortable)
- Police ≥ 16 px, cibles tactiles ≥ 48 px, contrastes WCAG AA, mode sombre automatique
- Pas plus de 2 taps pour indiquer sa présence depuis l'ouverture
- Textes courts et bienveillants, icônes + libellés

## Ce que l'écran promet, le code doit le tenir

- **Tout champ non contrôlé dont la valeur vient du serveur porte `cleValeurServeur`**
  (`src/components/ui/valeur-serveur.ts`). React n'applique `defaultValue` / `defaultChecked` qu'au
  **montage**, et React 19 réinitialise un formulaire dès que son action a rendu la main : sans clé de
  remontage, le champ retombe sur la valeur du chargement de la page, et un **second clic sur
  « Enregistrer » renvoie cette ancienne valeur au serveur**, qui l'écrit par-dessus la bonne (perte
  de donnée). Les quatre briques de saisie (`Champ`, `Case`, `Select`, `ZoneTexte`) la posent
  elles-mêmes : **passer par elles** plutôt que par un `<input>` nu. Deux règles s'y attachent : un
  champ **piloté** par React (`value=` / `checked=`) n'a pas de clé, et la clé ne bouge que si la
  valeur du serveur bouge (ce qu'on est en train de taper n'est jamais effacé). **Un composant client
  dont l'état est *semé* par le serveur relève de la même doctrine, et le balayage ne le voit pas** :
  un `useState(props.valeur)` n'est semé qu'au montage, donc il continue d'afficher la valeur du
  chargement quand le serveur en renvoie une autre : après un changement de rôle en masse, la liste
  déroulante d'une personne montrerait l'ancien rôle, choisir le bon ne ferait rien — le serveur voit la
  valeur déjà bonne — et le réflexe de forçage par l'autre valeur **écrirait vraiment** la
  rétrogradation. La clé de remontage ne convient pas ici — c'est un contrôle **piloté**,
  dont l'état fait foi entre deux rendus. On s'en protège par un **miroir de la valeur du serveur**
  (`vuDuServeur`, dans `SelecteurRole` et `CaseEditeur`) : on garde à côté de l'état la
  dernière valeur reçue, et quand elle change, le serveur reprend la main. Le test se fait sur le
  scénario — le serveur renvoie une autre valeur, l'écran doit la montrer —, puisque
  `tests/unit/valeurs-fraiches.test.ts` ne balaie que le JSX et ne peut pas voir un `useState`. Et **une action
  invalide le chemin de sa propre page** (`revalidatePath`), sans quoi la valeur fraîche n'arrive
  jamais jusqu'à l'écran d'où l'on vient d'enregistrer ; `FormulaireAction` redemande la page en
  plus, et les écrans coûteux dont l'action fait déjà ce travail le coupent
  (`rafraichirApresSucces={false}`).
  Balayage de tout `src/**/*.tsx` par `tests/unit/valeurs-fraiches.test.ts` : un `defaultValue`
  dynamique sur un élément nu, sans `key`, fait échouer les tests
- **Un plafond annoncé à l'utilisateur et le plafond technique correspondant sont reliés par un
  test.** `bodySizeLimit` de `next.config.ts` doit rester **au-dessus** de `AFFICHE_TAILLE_MAX`
  (`tests/unit/affiches.test.ts`) : réglé plus bas, il rendait injoignable tout ce que l'application
  dit accepter, et Next refusant le corps **avant** d'entrer dans la server action, il n'y avait même
  pas d'erreur à afficher. Marge pour l'encodage multipart (frontières et en-têtes s'ajoutent aux
  octets du fichier) ; le vrai refus reste côté serveur, où il se dit en français. Corollaire dans les
  composants de dépôt : suivre la **promesse de l'action**, jamais `pending`, et l'entourer d'un
  `catch` — une promesse qui rejette sans réponse laisserait l'écran sur « Envoi… » indéfiniment
- **Une donnée affichée n'est jamais une clé.** Ce que l'équipe écrit et relit à l'écran (le libellé
  d'une partie, le nom d'un thème, un intitulé quelconque) est une **donnée** : l'identité d'une ligne
  tient à son identifiant, et à lui seul. Une clé portée par le texte affiché fait d'un renommage un
  déménagement — deux onglets, deux lignes — et interdit deux libellés identiques dans le même parent.
  Corollaire : une action de modification reçoit l'**identifiant** de ce qu'elle modifie, jamais le
  couple « parent + nom »
- **Un ordre d'affichage se stocke, il ne se reconstruit pas depuis une constante.** Une colonne
  `ordre`, renumérotée de façon contiguë à partir de zéro après chaque écriture, et **une seule
  lecture triée** dont tous les écrans héritent. Un ordre déduit de la position dans une liste figée
  finit reconstruit en autant d'endroits qu'il y a de vues (quatre, pour les parties d'une
  séance), et c'est autant d'occasions de diverger
- **Le repli des listes a un seul patron, et une constante par nature de chose comptée.** Les trois
  vivent dans `src/components/seances/listes.ts`, avec `ListeRepliee` : **aucun bouton tant que la
  liste tient**, le bouton **annonce le reste** (« Afficher les N autres »), « Replier » existe une
  fois déplié. Aucune ne s'indexe sur **un réglage du club** — surtout pas la part d'effectif, qui est
  un quorum d'annulation et non un compte de lignes. Les trois natures : `LIGNES_VISIBLES` (20) compte
  des **personnes**, `SEANCES_VISIBLES` (5) des **cartes de cours à venir** (liste des séances et
  grille du planning, qui se replient pareil), `COURS_HISTORIQUE_VISIBLES` (40) les **cours déjà
  donnés** de l'historique personnel — et ce dernier commande en plus ce que le serveur rapatrie.
  L'une s'indexe sur l'effectif du club, l'autre sur la hauteur d'un écran, la troisième sur le rythme
  du calendrier : les confondre fait apparaître un repli là où il ne devait rien y avoir (un trimestre
  ordinaire compte vingt-six cours, le repli des personnes vingt lignes). **Un nom, une valeur, un
  endroit** : deux constantes du même nom à deux valeurs ont existé, un auto-import du
  mauvais compilait sans broncher et multipliait par huit le repli d'un écran — un test les empêche
  désormais de se reconfondre. Le seuil au-delà duquel une liste déroulante reçoit une recherche
  (`SEUIL_RECHERCHE`) reprend en revanche `LIGNES_VISIBLES` sans en créer un troisième : « pas plus de
  vingt » est une seule règle, elle n'a qu'une seule valeur. Et **replier ne remplace pas chercher** : au-delà du seuil,
  une liste où l'on cherche une ligne reçoit une recherche (filtrage dans le navigateur, les données
  étant déjà chargées) ou un tri dans l'URL — cacher la moitié d'une liste qu'on doit parcourir ne fait
  que déplacer le problème d'un clic. L'ordre des listes nominatives est celui de `ORDRE_GROUPES`
  (sans réponse, peut-être, présents, absents), décidé **au rendu serveur** et jamais recalculé depuis
  les corrections en cours : la ligne qu'on vient de toucher sauterait sous le doigt
- **Ce qui est publié doit être annoncé à qui le saisit.** Tout champ dont la valeur sort du club —
  thème, **description d'une partie**, motif d'annulation, résumé de partage — le dit **dans l'écran de
  saisie**, au moment de la saisie. Le corollaire vaut pour le reste : ce qui ne sort pas (le second
  instructeur, les noms) ne doit jamais se retrouver dans une page publique ni dans l'API
- **Un réglage exprimé en nombre absolu ne s'adapte pas à la taille du club.** Un seuil de personnes
  sert un club et trahit l'autre : il s'exprime en **part de l'effectif** (`Identite.partEffectifMin`),
  et le nombre de personnes s'en déduit **au point d'usage**, avec l'effectif invité de la période
  concernée (`seuilEnPersonnes`). Trois corollaires : un **plancher** est une constante livrée et non un
  second réglage (`SEUIL_PLANCHER`) ; l'**arrondi est au supérieur**, pour que « en dessous du seuil »
  veuille dire à la personne près « strictement moins que la part réglée » ; et **toute échelle bâtie
  sur ce seuil suit la part** (`seuilConfort`), sinon le mot affiché finit par contredire le
  pourcentage affiché à côté. L'écran de réglage montre **le résultat en personnes**, pas seulement le
  pourcentage : un taux ne se vérifie pas d'un coup d'œil
- **Une sélection multiple nomme sa portée, et ne prend jamais ce qui n'est pas affiché.** Résultat de
  la recherche en cours, page courante, lignes dépliées — jamais la liste entière en silence. Les
  libellés disent donc ce que la case emporte (« Sélectionner les 12 résultats », « les 20 lignes
  affichées ») et le mot **« Tout » ne s'écrit nulle part** : il serait faux dès qu'un filtre ou un
  repli est en jeu, c'est-à-dire justement quand on s'en sert. Ce qui reste dehors est **compté et dit**,
  et un second bouton propose le geste qu'on voulait vraiment faire (« Afficher et sélectionner les 80
  personnes »). L'ordre rendu est celui de la liste, jamais celui des clics
- **Un geste de masse journalise par personne, et refuse le lot entier plutôt que d'en écrire une
  partie.** Une seule transaction, une **entrée d'audit nominative** portant la **même action** que le
  geste unitaire (c'est un seul filtre du journal qui doit tout retrouver), écrite après le commit et
  hors transaction, et **seulement pour les lignes réellement modifiées**. Les verrous sont **exactement**
  ceux du geste unitaire : deux chemins d'écriture aux règles différentes, c'est une porte dérobée d'un
  côté ou une fonctionnalité morte de l'autre. La confirmation annonce **ce qui sera écrasé**, en
  séparant ceux qui avaient répondu eux-mêmes de ceux qui portent déjà la valeur visée — les confondre
  gonfle le chiffre censé faire hésiter. Et un geste de masse **n'envoie pas la notification du geste
  unitaire multipliée** : cinquante-cinq emails partis d'un clic sont un incident, pas une notification
- **Les deux écrans de masse partagent leur module** (`src/components/ui/selection.ts`, sans React ni
  base) : un bureau qui apprend à cocher sur l'un doit retrouver le même geste sur l'autre. Ce qui se
  duplique, ce sont les **mots** propres au métier de l'écran, jamais la mécanique
- **Un tableau s'élargit, une carte non.** La colonne de lecture (`max-w-3xl`) est la règle ; `PLEINE_LARGEUR`
  (`src/components/ui/pleine-largeur.ts`) est l'exception, et elle se mérite. **La ligne de partage est la nature du
  contenu** : le planning range des noms de personnes en colonnes et la fiche d'une
  séance les cases de son programme — les tronquer perd de l'information, ces deux-là gardent les 90 rem. L'accueil et
  `/seances` empilent des cartes de phrases courtes : les étirer à 1 440 px n'ajoute rien, ça couche une date seule
  devant 900 px de blanc. Un écran qui ne déborde pas occupe l'espace **autrement** (deux tuiles par ligne, sans trou).
  Quand l'élargissement a lieu, il se pose sur une **page**, jamais sur un morceau de page — sinon le titre et les
  filtres restent étroits au-dessus d'une liste large, soit deux alignements sur le même écran.
  **L'espace admin, l'espace instructeur et les événements suivent la même règle.** Le relevé qui l'a
  imposée : à 1 920 px, **1 150 px de marge vides** pendant que les deux journaux rangeaient six
  colonnes dans 692 px — lire « qui a fait quoi, depuis quelle adresse » demandait de **défiler de
  côté**, ligne par ligne, sur douze mille entrées (389 px et 168 px de texte cachés), et douze écrans
  tenaient 736 px de contenu avec **1 184 px de blanc**. Mesures après correction, à 1 920 px : fiche d'une période 4 050 → **2 953 px**,
  tableau de bord 1 687 → **1 211**, fil des événements 1 649 → **1 158**, « À propos » 1 643 →
  **1 197**, « Club » 2 054 → **1 482**, registre des présences 1 599 → **1 140**, « Thèmes et lieux »
  1 279 → **939** ; « Mon profil » 3 377 → **2 580**, annuaire 2 565 → **2 217** (57 px par personne au
  lieu de 88), matrice des notifications 4 632 → **4 135**. Ce que cette passe a ajouté à la règle, et
  qui se lit dans `src/app/(app)/admin/largeurs.ts` :
  - **deux paliers, pas un — et la question qui les sépare n'est pas la forme du contenu.** « Un
    tableau s'élargit dès 1 024 px, une suite de cartes à 1 536 » est faux à la mesure : la fiche d'une
    période mesure **4 078 px à 1 280 px en page large contre 4 669 en colonne de lecture**, parce que
    ses cartes savent se découper en interne. La bonne question est **« ce contenu sait-il faire
    quelque chose de la place avant 1 536 px ? »**, et elle se tranche écran par écran, à la mesure. Les deux paliers portent donc le nom de la **largeur** qu'ils posent
    (`PLEINE_LARGEUR` dès 1 024 px, `PLEINE_LARGEUR_2XL` à 1 536 px, celui de `DeuxPiles`), plus celui
    d'une forme de contenu. Une page large d'une seule pile donne exactement ce que la règle refuse :
    à 1 280 px, les zones de texte de « Thèmes et lieux » mesuraient 1 190 px ;
  - **une liste d'objets semblables se range en grille, et le palier de la grille EST celui de sa
    page.** Posé plus tard (`xl` sur une page large dès `lg`), il laisse une bande de 256 px où la page
    est large et la grille n'a qu'une colonne — une carte étirée à 976 px, puis 1 231, soit exactement
    ce que la règle refuse. La grille garde ses hauteurs égales (pas d'`items-start`) et ses
    boutons en bas de carte (`mt-auto`) : c'est ce qui la distingue des sept cartes de réglages de
    « Mon profil », où une grille « faisait des trous » et où il a fallu **deux piles indépendantes** ;
  - **`DeuxPiles` (`src/components/ui/DeuxPiles.tsx`) est le composant de cette seconde famille**, et la
    coupure se fait sur une **coupure de la liste**, jamais sur un tri : en dessous du palier, le flux
    doit rester exactement dans l'ordre d'avant, sinon un lecteur d'écran lit autre chose que ce que
    voit l'œil. Deux colonnes ne peuvent pas non plus **se partager un `<form>`** — la coupure de
    « Club » suit donc les formulaires existants, et scinder une action serveur pour une raison de mise
    en page serait mettre la charrue avant les bœufs ;
  - **la largeur se pose sur la mise en page quand la mise en page porte la navigation.** `/gestion` l'a
    reçue sur son layout après mesure : posée sur les trois pages, elle laissait la barre d'onglets dans
    la colonne de lecture **au-dessus** d'un contenu large — contenu de x = 240 à 1 680, onglets de
    x = 592 à 1 328, soit **352 px de décalage**. C'est le défaut des « deux alignements sur le même
    écran », rencontré trois fois en trois jours. Corollaire payé le même jour : **une règle lue dans un
    layout est évaluée une fois pour toutes**, App Router ne re-rendant pas un layout d'une page sœur à
    l'autre, alors que la barre d'onglets est le chemin normal — arrivé par « Périodes » puis clic sur
    « Journal d'audit », le conteneur ferait **736 px au lieu de 1 440**, et dans l'autre sens un
    formulaire s'étalerait sur 1 440 : une même adresse à deux largeurs selon la façon d'y arriver. La
    règle reste à un seul endroit ; une enveloppe cliente de dix lignes la pose au bon moment
    (`usePathname()`), et elle ne contient rien d'autre — un composant client qui porterait le bandeau
    d'élévation ou les onglets emporterait des données de session dans le paquet du navigateur ;
  - **un formulaire ne s'élargit toujours pas** — mais deux colonnes de 690 px ne sont pas un
    élargissement : c'est la géométrie d'un téléphone posée deux fois. Ce qui est proscrit, c'est le
    champ de 1 398 px (mesuré sur « Club » avant correction, maintenant plafonné à 666, et aucun champ
    du dépôt ne dépasse 700 px à aucune largeur). L'écran de création d'une période reste donc étroit ;
  - **une carte qui n'occupe plus la page ne suit plus la fenêtre, donc elle mesure son CONTENEUR.**
    En demi-colonne, la carte « Apparence » est passée de 736 à 536 px de large, mais son `sm:flex-row`
    interne regardait toujours la fenêtre : sur un écran de 1 920 px, elle posait la liste et l'aperçu
    côte à côte et la légende du thème se coupait en **sept lignes de trois mots**. La parade est une
    **requête de conteneur** (`@container`, palier `@2xl`), qui vaut dans une demi-colonne comme dans la
    colonne de lecture — à 1 440 px la carte est inchangée, sur 390 px rien ne bouge. Un balayage
    (`tests/unit/profil-deux-piles.test.ts`) interdit désormais toute découpe sur une mesure de fenêtre
    dans ces cartes, `DeuxPiles` excepté : son conteneur, lui, suit la fenêtre ;
  - **et le piège d'imbrication** : une fois une grille posée, une cellule fait ~690 px alors que le
    conteneur le plus proche en fait 1 440. Une sous-grille interrogerait donc 1 440 px en croyant
    mesurer sa cellule : **chaque cellule qui porte une sous-grille doit être elle-même un
    `@container`**, et la preuve se fait par une sonde, pas par raisonnement. Corollaire mesuré le même
    jour : une grille sans `grid-cols-1` explicite laisse une piste `auto` qui grossit jusqu'au
    `max-content` de son contenu — **207 px de débordement horizontal sur un téléphone de 390 px**.

  **Une carte rétrécie grandit, et cela se dit avant d'annoncer un gain.** « Mes notifications » fait
  **1 633 px** en demi-colonne contre 1 368 en colonne de lecture, « Apparence » 407 contre 295 : +19 %
  et +38 %. Un gain de hauteur par partage se paie en largeur. Et **ce qui bouge sur le téléphone se
  compte aussi** : +4 px par intercarte sur les écrans passés en deux piles (`DeuxPiles` empile en 24 px
  là où ces pages empilaient en 20), tout le reste identique au pixel — une seule géométrie partagée
  valant mieux qu'un réglage par écran.
  **Enfin, un écran peut recevoir la largeur et la mal employer.** Une ligne `flex` avec le nom en
  `flex-1` colle sa liste déroulante au bord droit, **~1 150 px après le nom**, à parcourir cinquante
  fois un soir de cours — exactement ce que ce dossier reproche à une carte étirée. Le registre des
  présences tient donc les deux ensemble, aucune ne suffisant : **plafonner** la ligne (seule, elle
  laisse 600 px d'écart) et **remplir** la largeur libérée par une seconde colonne de lignes (seule,
  elle ne rapproche rien). Résultat : **239 px** à 1 920, 225 à 1 280, 12 sur un téléphone.
  **Et le piège qui va avec, il vaut partout : `lg:` mesure la FENÊTRE, pas le conteneur.** Une
  carte étroite dans une page large garde ses découpes en colonnes et les **serre** au lieu de les aérer —
  les trois boutons de réponse d'une carte de séance se retrouveraient dans une demi-colonne de 22 rem sur un écran
  de 1 440 px, plus étroits que sur un téléphone. Une découpe en `lg:` n'est légitime que dans un
  conteneur dont on sait qu'il suit la fenêtre (`tests/unit/bandes-pleine-largeur.test.ts`)
- **`----------` est un libellé d'affichage, jamais une donnée.** C'est l'unique écriture du vide pour
  les réglages d'une case (`LIBELLE_VIDE`), en **tête** de chaque liste déroulante ; en base, rien ne
  change (chaîne vide, `null`, ou la valeur par défaut). Corollaire qui vaut pour tout écran de
  lecture : **un champ vide ne s'affiche pas du tout aux membres**, ni sa valeur ni son intitulé — et la
  règle tient dans une seule fonction (`champsLus`), pour qu'aucun écran ne l'oublie dans son coin. En
  lecture, **chaque valeur porte son intitulé** : deux noms et un thème empilés nus ne se distinguent pas

## Charte graphique (issue du logo)
- Variables CSS (et thème Tailwind) :
  --marque-bleu: #2B2622   (primaire : en-tête, liens, boutons principaux)
  --marque-rouge: #A5472C  (accent : bouton "Absent", annulations, alertes)
  --marque-or: #D7B461     (rehauts : badges, taux de présence, focus visible)
  --marque-noir: #000000   (texte, titres)
  --marque-gris: #808080   (textes secondaires, bordures)
  Fond clair : #FAFAFA ; mode sombre : fond #0E1A2B (dérivé du bleu)
- Bouton "Présent" en vert accessible (#1E7A3C), distinct du rouge de la charte
- Or jamais utilisé pour du texte sur fond blanc (contraste insuffisant) : uniquement sur bleu ou noir
- Titres dans une police à empattements de style médiéval lisible ("Cinzel" via next/font, fallback serif),
  texte courant en sans-serif système

## Logo et identité
**L'identité du club est une DONNÉE, pas une constante** : l'outil est installable par n'importe quel
club d'AMHE. Tout se règle dans **Espace admin → Club**.
- `src/lib/identite.ts` — source unique. Trois sources dans l'ordre : réglage en base
  (`Setting.identite`), variables `CLUB_NOM` / `CLUB_SIGLE` (nommer une instance neuve sans se
  connecter), puis le nom livré : **« HEMA Organizer »**. Les constantes `APP_NAME`,
  `APP_SHORT_NAME` et `ASSOCIATION_NAME` **n'existent plus** ; ne pas les réintroduire.
- **Deux formulaires, pas un** : l'**identité** (nom entier, sigle) et l'**apparence**
  (thème du club, couleur de marque) s'enregistrent séparément, avec deux entrées de journal distinctes
  (`identite.noms_modifies`, `identite.apparence_modifiee`) — l'ancien `identite.modifiee` ne disait pas
  *quoi*. La raison est de lisibilité, et elle découle de la règle des deux colonnes : deux colonnes ne
  peuvent pas se partager un `<form>`, si bien que la carte intitulée « Nom » contenait aussi le thème et
  la couleur, et que les logos se retrouvaient loin du thème avec lequel ils vont. L'écran se lit
  maintenant comme il est rangé — à gauche ce que le club **est**, à droite comment il **se montre**. Ça
  ne raccourcit pas la page (un second formulaire coûte un en-tête et un bouton : +150 px sur un
  téléphone) : le gain est de lisibilité.
- Deux champs réglables — `club` (nom entier) et `sigle` — d'où se **calculent** `nomCourt`
  (« HEMA Organizer »), `nomLong` (« Les Compagnons d'Armes — Organizer ») et `nomClub` (le
  club, ou le nom de l'app à défaut). **« Organizer » ne se règle pas** : c'est le nom de l'outil,
  seul le sigle qui le précède change d'un club à l'autre (et il s'efface sur un téléphone étroit,
  où le sigle reste seul). Plus un **thème du club** parmi les douze et une **couleur de marque**
  facultative.
- **Les fonctions pures reçoivent le nom en argument**, elles ne le lisent pas : gabarits d'email,
  embeds Discord/Telegram, QR code TOTP restent testables sans base. La lecture (`await identite()`,
  mise en cache par requête) se fait au point asynchrone le plus proche de l'envoi.
- Deux logos **déposés** dans l'écran Identité (stockage des affiches : SHA-256 du contenu, type
  déduit des octets, SVG refusé, métadonnées retirées) ; à défaut, les fichiers livrés
  `public/logo.png` et `public/logo-ecu.png` :
  - écu dans l'en-tête (seul si largeur < 360 px), vignettes et icône de l'application installée
  - logo complet sur la page de connexion / invitation et en en-tête des emails
  - `npm run icons:generate` engendre les icônes **livrées** depuis `public/logo-ecu.png`
- **Manifeste PWA dynamique** (`src/app/manifest.ts`, `force-dynamic`) : il porte le nom et l'icône du
  club. Ne jamais le remettre en fichier figé dans `public/`.
- **Piège du build** : un composant client qui importe un module touchant `settings.ts` entraîne
  `node:crypto` dans le bundle et fait échouer `npm run build` (ni `tsc` ni `vitest` ne le voient).
  Les constantes partagées avec le navigateur vont dans `src/lib/constants.ts`, qui ne dépend de
  rien ; un type s'importe avec `import type`.
- **Les lieux des cours sont un réglage** (`/admin/themes`, « Thèmes et lieux »), vide par défaut :
  `src/lib/lieux.ts` est **pur**, la lecture vit dans `planning.ts`.

# Production : contraintes de l'image (stack Portainer gérée à la main)
- NE génère PAS de fichier de stack Portainer ni de webhook : je gère la stack manuellement.
- L'image DOIT fonctionner avec exactement ce compose (référence, à recopier tel quel dans docs/portainer-stack.yml) :

```yaml
services:
  app:
    image: ${IMAGE:-hematools/hema-organizer}:${APP_TAG:-latest}
    container_name: hema-organizer
    restart: always
    environment:
      NODE_ENV: production
      TZ: ${TZ:-Europe/Paris}
      DATABASE_URL: file:/data/organizer.db
      BACKUP_DIR: /backups
      DOMAIN: ${DOMAIN}
      SESSION_SECRET: ${SESSION_SECRET}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      SMTP_FROM: ${SMTP_FROM}
      DISCORD_WEBHOOK_URL: ${DISCORD_WEBHOOK_URL}
      PUBLIC_API_ORIGIN: ${PUBLIC_API_ORIGIN:-https://mon-club.fr}
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
    volumes:
      - organizer_data:/data
      - organizer_backups:/backups
    tmpfs:
      - /tmp
    networks:
      - npm
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  organizer_data:
  organizer_backups:

networks:
  npm:
    external: true
    name: ${NPM_NETWORK:-npm_default}
```

- **Ce compose est le contrat minimal que l'image doit satisfaire ; l'installation réelle, elle, est décrite par
  `docs/portainer-stack.yml`, et elle en diffère sur deux points assumés :**
  - **aucun port publié.** Un port lié à toutes les interfaces ferait de quiconque l'atteint **sans passer par Nginx Proxy Manager** le dernier maillon de
    `X-Forwarded-For` : il choisit donc l'adresse que `clientIp()` retiendra, ce qui rend tous les seaux par IP
    inopérants **et l'IP du journal d'audit choisie par l'attaquant** — les alertes envoyées au bureau raconteraient
    alors une histoire fausse. Le proxy vise `hema-organizer:3000` : les deux lignes `ports:` sont commentées ;
  - **bind mounts (`${DATA_DIR}`) au lieu des volumes nommés `organizer_data` / `organizer_backups`.** C'est l'installation qui
    tourne, et repasser aux volumes nommés repartirait d'une base **vide** : le compose ci-dessus reste le contrat de
    l'image (elle doit fonctionner avec les deux), `docs/DEPLOIEMENT.md` décrit les bind mounts, et la procédure pose
    désormais `chmod 750` sur les deux dossiers — sans lui, le `chmod 0750` du Dockerfile est sans effet (le mode de
    l'hôte gagne sur un bind mount) et une copie complète de la base est lisible par tout compte de l'hôte.
- Exigences image :
  - Dockerfile multi-stage (node:22-alpine), Next.js standalone, utilisateur non-root, wget présent
  - écoute sur 0.0.0.0:3000
  - GET /api/health → 200 si app + base OK
  - au démarrage (entrypoint) : prisma migrate deploy, puis seed admin idempotent (ADMIN_EMAIL/ADMIN_PASSWORD)
  - écriture uniquement dans /data, /backups, /tmp — **et `/app/.next/cache`**, le seul dossier de l'application qui
    appartienne à l'utilisateur d'exécution (fonctionne avec cap_drop ALL et no-new-privileges). **Le code, lui, est en
    `root:root`** : un `COPY --chown=node:node` rendrait une primitive d'écriture de fichier capable de modifier
    **le programme de façon persistante**, que `restart: always` relancerait. `cap_drop: ALL` n'y changerait rien —
    il n'y a aucune élévation à obtenir quand on peut déjà réécrire le code. Si un autre dossier sous `/app`
    demandait à être écrit, lui donner ce dossier-là et pas plus
  - permissions des volumes /data et /backups gérées (création des dossiers avec le bon propriétaire dans l'image)
- Publication : .github/workflows/release.yml
  - déclenché sur push de tag v*.*.* et workflow_dispatch
  - lint + tests, build linux/amd64, push sur ghcr.io/<owner>/hema-organizer:<version> et :latest
  - authentification avec GITHUB_TOKEN (permissions packages: write), package privé
- docker-compose.yml à la racine : développement local uniquement (build local, port 3000 publié, volumes locaux)

# Reprise
- Où est quoi : `docs/FONCTIONNALITES.md` dit ce que fait l'outil, écran par écran ;
  `docs/DEPLOIEMENT.md` comment le déployer et l'exploiter ; `docs/SECURITE.md` comment il
  protège les comptes et les données ; `docs/guides/` les trois guides à distribuer.
- Ce fichier-ci est la référence du logiciel : les exigences, la stack imposée et les décisions
  de conception.
