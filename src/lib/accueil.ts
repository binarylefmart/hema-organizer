import { db } from "./db";
import { dateDAdhesion, joursDeCoursDuClub, moisDepuis, presencesDuMeilleurMois } from "./blasons";
import { parisOffsetMinutes, todayIso } from "./dates";
import { evenementsAVenir } from "./evenements";
import { can, isStaff } from "./permissions";
import { prochainesSeances, type SeanceCarte } from "./seances";
import { calculerTaux, type Compteurs } from "./presences";
import { assiduite, coursEnDanger, decrochages, meilleuresSeries, moyennesParJour, serieDeTete, SEUIL_NOYAU, tendance, type SeancePassee } from "./pilotage";
import { statsPeriode } from "./tableau-de-bord";
import type { CurrentUser } from "./auth/current-user";

/**
 * Le compte rendu de l'écran d'accueil : ce qui vient, et combien de monde y sera.
 *
 * **Le partage entre les vues ne tient pas à la nature du chiffre, mais à ce qu'il sert.**
 * Un chiffre qui aide quelqu'un à s'organiser pour mardi (combien sont annoncés, à quel taux, qui
 * vient, ce qu'on y travaille, où j'en suis de mes réponses) appartient à tout le club : il est
 * dans les vues **Club** et **Personnel**. Un chiffre qui appelle un geste de l'équipe (relancer
 * ceux qui ne répondent pas, rappeler ceux qui ne viennent plus, trancher les ateliers) appartient
 * à la vue **Admin**, et à elle seule.
 *
 * **Et un chiffre déjà lisible ailleurs sur la page n'est pas repris en vue Admin.** Le taux du
 * trimestre et l'effectif invité sont sous les yeux de tout le club dans la bande « Club » : les
 * répéter au bureau ne lui apprenait rien et faisait passer la troisième position pour une redite.
 * Ce qu'elle porte désormais ne s'y lit nulle part ailleurs — c'est le critère pour y ajouter quoi
 * que ce soit.
 *
 * D'où la forme de ce type : ce qui aide à s'organiser est calculé pour tout le monde, et le
 * pilotage est rangé dans `admin`, **qui vaut `null` sans la permission**. Ce n'est pas une
 * commodité d'affichage : rien de ce bloc n'est envoyé au navigateur d'un membre, donc rien n'y
 * est à masquer (voir le commentaire de `BlocAdmin`).
 *
 * Tout est rassemblé par **une seule fonction** parce que l'accueil est l'écran le plus ouvert de
 * l'application : chaque appel supplémentaire s'y paie à chaque visite de chaque membre. D'où deux
 * partis pris :
 * - on **réemploie** les lectures existantes (`prochainesSeances`, `statsPeriode`, `evenementsAVenir`)
 *   au lieu d'en écrire de nouvelles, et on en tire tout ce qu'elles savent déjà ;
 * - ce qui se déduit des cartes et des agrégats déjà chargés (séances à venir, présents du prochain
 *   cours, participation moyenne, réponses manquantes) se déduit en mémoire, sans repasser par la base.
 *
 * Coût courant : 10 requêtes pour un membre comme pour un instructeur, 13 pour un administrateur.
 * **Le chiffre a monté de 7 et 10**, quand la vue Personnel a reçu sa série de présences et son
 * compte d'ateliers proposés : il est écrit ici plutôt que laissé à sa valeur d'hier, parce qu'un
 * coût qu'on ne réécrit pas est un coût qu'on cesse de surveiller. Les deux lectures ajoutées
 * partent **pour tout le monde** — ce sont les chiffres de la personne qui regarde, comme le reste
 * de `moi`, pas du pilotage à réserver au bureau — et c'est justement ce qui oblige à les tenir
 * minuscules : une seule colonne (`sessionId`) sur un seul trimestre, et un `count`. **Puis de 9 et
 * 12 à 10 et 13**, quand la vue Personnel a reçu ses présences de toute la saison : un `count` de
 * plus, minuscule — une seule personne, aucune colonne rapportée —, qui ne parle que de qui le
 * déclenche, et c'est la seule matière des blasons de l'horizon « La saison », les seuls qui ne
 * retombent pas à zéro à chaque trimestre. Les **trois** de l'écart restant ne partent, elles,
 * **que** pour le bureau et ne se devinent nulle part ailleurs : la file des ateliers, les liens
 * jamais ouverts, et les présences nominatives de tout le club. Tout le reste continue de se
 * déduire des cartes et des agrégats déjà chargés, sans une lecture de plus. La période se lit
 * d'abord — tout le reste en dépend —, puis les lectures restantes partent ensemble dans un seul
 * `Promise.all`. Hors saison, le repli sur la période la plus récente en ajoute une ; à l'inverse,
 * une période sans séance n'en déclenche que sept, les agrégats n'ayant rien à compter, et une
 * personne sans aucune période quatre — les trois lectures personnelles sont gardées par la
 * période, comme les autres.
 *
 * **Les détails nominatifs n'en ont pas ajouté non plus.** Chaque tuile du bureau dit désormais
 * *qui* ou *quoi* se cache derrière son chiffre, et tout cela se déduit de ce qui était déjà là :
 * les listes nominatives que portent les cartes, la ligne de chaque membre dans les agrégats, et
 * les présences nominatives déjà chargées pour la série et les décrochages. Une seule lecture a
 * **changé de forme** sans changer de nombre : les liens jamais ouverts étaient un `count`, ils
 * sont un `findMany` qui rapporte de quoi nommer les personnes, au même `where` — le compte se lit
 * maintenant sur la longueur de la liste. **10 et 13 restent donc exacts.** La règle qui tient ce
 * fichier n'a pas bougé : un détail qui coûterait une lecture de plus ne s'affiche pas.
 *
 * **La série en cours suit la même règle, et n'a rien ajouté non plus.** `moi.serie` (le record du
 * trimestre) et `moi.serieEnCours` (la suite qui se termine au dernier cours passé) sortent du
 * **même** parcours des cours passés, croisé avec la **même** lecture de ses « Présent ». Un second
 * chiffre pour zéro requête : **10 et 13 restent exacts**, et c'était la condition pour l'afficher.
 *
 * **L'ancienneté au club n'a rien coûté non plus.** Les rangs ne se gagnent plus aux présences du
 * trimestre mais au temps passé au club, et `moi.ancienneteMois` se déduit de `dateDAdhesion(user)`
 * — la date « Au club depuis » réglée par le bureau si elle est renseignée, la création du compte
 * sinon. Les deux colonnes sont chargées avec la ligne du compte par la session
 * (`src/lib/auth/current-user.ts`, `include: { user: true }`), y compris celle ajoutée le même jour
 * pour l'adhésion. Un chiffre de plus dans la vue Personnel, **zéro lecture de plus** : **10 et 13
 * restent exacts**.
 *
 * **La part minimale d'effectif n'a rien coûté non plus.** Elle est devenue un réglage
 * (`Identite.partEffectifMin`) pour que l'outil s'installe dans un club de huit comme dans un club
 * de quatre-vingts, et elle **arrive en argument** : elle se lit dans la page, où `identite()` est
 * déjà en mémoire pour l'en-tête et le manifeste. Ce module-ci ne touche donc pas à `settings.ts`,
 * et les tests continuent de l'éprouver sans réglage en base. Les jours de cours du club, eux, se
 * déduisent des séances du trimestre déjà chargées. **10 et 13 restent exacts.**
 *
 * **De 13 à 14 pour le bureau, puis retour à 13 le même jour.** La tuile « Jamais venus » comptait
 * les cours d'avant l'arrivée d'une personne, si bien qu'un inscrit de la Toussaint entrait dans la
 * liste d'appel du bureau avant d'avoir eu un seul cours à honorer. Une lecture des dates d'arrivée
 * a d'abord été ajoutée ici, au motif que rien de ce qui était chargé ne savait **quand** quelqu'un
 * avait rejoint le trimestre. C'était vrai des agrégats, qui ne comptent que des réponses — mais
 * faux de `statsPeriode`, qui venait de recevoir la même correction de l'autre côté :
 * `membres[].seances` **est** le nombre de cours passés depuis l'arrivée. La condition d'ici,
 * `passees.some((s) => s.date >= arrivee)`, s'écrit donc `m.seances > 0` sur des données déjà en
 * mémoire, et la lecture a été retirée : **13 requêtes**. Le chiffre affiché n'a pas bougé — c'est
 * tout l'intérêt —, et cet écran-ci ne peut plus diverger du tableau de bord, puisqu'il lit le même
 * nombre et non un calcul jumeau.
 *
 * **Le taux personnel s'affiche sur TROIS écrans, pas deux** : l'accueil du membre (ici, via
 * `statsPeriode`), le tableau de bord du bureau et son export CSV (`statsPeriode` encore), et **«
 * Mes présences »** (`historiquePresences`, `src/lib/seances.ts`), qui le calcule ailleurs. Les
 * deux premiers lisent la même ligne, donc ne peuvent pas se contredire ; le troisième ne le
 * pouvait pas non plus tant qu'il ignorait la date d'arrivée — et c'est exactement ce qui est
 * arrivé : « 80 % — 4 cours sur 5 » ici, « 33 % · 4 présences sur 12 » à un onglet d'écart. La
 * borne y est désormais posée avec **la même fonction** (`jourDArrivee`), qui n'a qu'une
 * définition.
 */

/**
 * Le pilotage de la période, derrière la troisième position de la bascule.
 *
 * **Il n'est calculé que pour un administrateur dont l'élévation est ouverte** (`settings.technical`
 * *et* `sessionForte`, vérifiés côté serveur) ; il vaut `null` pour tout le monde d'autre.
 * C'est un invariant de sécurité, pas une préférence d'affichage : un membre curieux qui lit la
 * source de la page n'y trouve ni le nombre d'invités restés muets, ni celui des membres qui ne
 * viennent plus, ni la file des ateliers. Rien n'est envoyé puis masqué en CSS.
 *
 * Ce qui est ici n'y est pas parce que c'est confidentiel — la liste nominative des présents est
 * ouverte à tout le club depuis l'étape 3 — mais parce que **c'est du travail d'équipe** : des
 * chiffres sur lesquels le bureau décide, pas des chiffres avec lesquels un membre s'organise.
 *
 * **Chaque chiffre dit aussi qui ou quoi se cache derrière lui** (les champs `…Noms` et `…Dates`,
 * montrés en bulle au survol de la tuile). Un compteur seul ne se traite pas : « 3 silencieux »
 * s'oublie, « Charlie, Alice et Delta » s'appelle ce soir. Ces listes vivent **ici et nulle part
 * ailleurs**, donc sous la même double garde que le reste du bloc : elles ne sont pas calculées
 * pour un membre, ni pour un instructeur, ni pour un administrateur qui n'a pas ouvert son
 * élévation. C'est le même invariant que les chiffres, et il est éprouvé par les tests.
 */
export type BlocAdmin = {
  /**
   * Cours retenus pour les deux chiffres de relance : les prochains cours affichés, annulés exclus.
   * Zéro (fin de trimestre, prochains cours tous annulés) : le taux de réponse et les silencieux
   * ne porteraient sur rien, l'affichage les retire plutôt que d'écrire 0 %.
   */
  prochainsCours: number;
  /**
   * Part des invités qui se sont **prononcés** (Présent, Absent ou Peut-être) sur ces cours.
   *
   * C'est le chiffre qui dit s'il faut relancer, là où le taux de présence dit seulement qui vient :
   * à 90 % de réponses, un cours à trois personnes est un cours à trois personnes ; à 40 %, on ne
   * sait rien encore et un message vaut mieux qu'une décision.
   */
  tauxReponse: number;
  /** Invités qui n'ont répondu à **aucun** de ces cours : ceux qu'on relance nommément. */
  silencieux: number;
  /**
   * Qui n'a répondu à aucun des prochains cours — les gens qu'on appelle un par un (tuile
   * « Silencieux »).
   *
   * « Nommément » était jusqu'ici une intention : le compteur disait combien, jamais lesquels, et
   * il fallait rouvrir chaque carte pour croiser quatre listes de sans-réponse. Les noms sortent
   * des listes nominatives que les cartes portent déjà, sans une lecture de plus.
   */
  silencieuxNoms: string[];
  /**
   * Effectif invité sur la période. Il avait été retiré comme doublon de la vue Club (« N annoncés
   * sur M ») ; cette tuile ayant disparu depuis, le chiffre n'est plus écrit nulle part ailleurs —
   * et c'est la première chose qu'on donne quand on parle du club à l'extérieur.
   */
  invites: number;
  /**
   * Invités dont le lien personnel n'a **jamais été ouvert**. Ils ne répondent pas parce qu'ils ne
   * sont jamais entrés : ce n'est pas de la négligence, c'est un email à renvoyer. Aucun autre
   * chiffre ne les distingue des silencieux.
   */
  liensJamaisOuverts: number;
  /**
   * Qui n'a jamais ouvert son lien personnel — **un email à renvoyer, pas une relance** (tuile
   * « Liens jamais ouverts »).
   *
   * C'est la seule bulle dont les noms ne se déduisaient de rien : personne n'est nommé ailleurs
   * pour une invitation qui dort. D'où la seule lecture du fichier à avoir changé de forme (un
   * `findMany` au lieu d'un `count`, même `where`) — et le compte ci-dessus n'est plus que la
   * longueur de cette liste, pour que les deux ne puissent pas se contredire.
   */
  liensJamaisOuvertsNoms: string[];
  /** Prochains cours dont aucune case du planning n'est remplie : le programme reste à écrire. */
  coursSansProgramme: number;
  /**
   * Dates ISO de ces cours-là (tuile « Sans programme »).
   *
   * Un programme s'écrit pour **un** soir : « 2 cours sans programme » ne se traite pas, « mardi
   * 29 » s'ouvre et se remplit. Même raisonnement que `prochainCoursEnDanger`, appliqué à la
   * tuile d'à côté.
   */
  coursSansProgrammeDates: string[];
  /**
   * **Le mois entier, passé compris** : ce que la frise montre au bureau, là où le club voit les
   * quatre prochains cours. Un président ne regarde pas la même chose qu'un membre — il veut savoir
   * si la fréquentation tient depuis le début du mois, pas seulement combien viennent mardi.
   *
   * Aucune lecture de plus : les séances de la période et leurs compteurs sont déjà chargés par
   * `statsPeriode`, on n'en garde que le mois courant.
   */
  frequentationDuMois: Array<{ id: string; date: string; annulee: boolean; compteurs: Compteurs }>;
  /**
   * Invités présents à aucun des cours déjà passés du trimestre.
   *
   * Le décrochage ne se voit dans aucun autre chiffre de la page : une moyenne tient bon pendant
   * qu'une personne disparaît. C'est un appel à passer, pas une statistique.
   */
  jamaisVenus: number;
  /**
   * Qui n'est venu à aucun cours passé du trimestre (tuile « Jamais venus »).
   *
   * Le geste attendu est un appel nominatif : sans les noms, le chiffre n'est qu'un reproche
   * adressé à personne. Ils sortent des lignes déjà comptées par les agrégats du tableau de bord.
   */
  jamaisVenusNoms: string[];
  /** Nombre moyen de présents par séance passée, arrondi (0 si aucune). */
  participationMoyenne: number;
  /** Propositions d'ateliers en attente de décision. */
  ateliersEnAttente: number;
  /** Réponses encore manquantes, toutes personnes confondues, sur les prochains cours affichés. */
  invitesSansReponse: number;
  /**
   * Cours **encore à venir dans le trimestre** dont l'effectif attendu passe sous le seuil
   * d'alerte — la part de l'effectif invité réglée par le club (palier « Peu de monde »,
   * `palierEffectif`).
   *
   * Comptés sur tout ce qui reste, et pas seulement sur les quatre cours mis en avant : un creux
   * de la mi-novembre se rattrape en novembre, et personne ne le verra venir si le compteur
   * s'arrête à la semaine prochaine.
   */
  coursEnDanger: number;
  /**
   * Date ISO du premier d'entre eux, `null` s'il n'y en a aucun.
   *
   * **C'est cette date qui justifie le compteur d'à côté** : une relance se cale sur un jour —
   * « le 6 octobre » se traite ce soir, « quelque part en octobre » attend indéfiniment.
   */
  prochainCoursEnDanger: string | null;
  /**
   * Dates ISO de **tous** les cours à venir passés sous ce seuil, la plus proche d'abord (tuile
   * « Cours en danger »).
   *
   * La date du premier justifie le compteur ; la liste dit à quoi ressemble le reste du trimestre —
   * trois cours d'affilée creux en novembre ne se relancent pas comme un mardi isolé. Ces
   * dates-là ne se lisent nulle part ailleurs : la frise s'arrête aux quatre cours mis en avant.
   */
  coursEnDangerDates: string[];
  /**
   * Où va la fréquentation depuis le début du trimestre : la moyenne de présents de ses premiers
   * cours (`debut`), celle de ses derniers (`fin`), et l'écart entre les deux (`variation`).
   * `null` tant qu'il n'y a pas assez de cours passés pour comparer quoi que ce soit.
   *
   * Aucune moyenne ne dit ça toute seule : 8 de moyenne rassure après un début à 6 et inquiète
   * après un début à 11. C'est la pente qui appelle un geste — reprendre le créneau, relancer,
   * changer le programme —, pas le niveau.
   */
  tendance: { variation: number; debut: number; fin: number } | null;
  /**
   * Moyenne de présents par **jour de la semaine**, avec le nombre de cours tenus ce jour-là.
   *
   * Le seul chiffre de la page qui puisse faire bouger un créneau : si le mardi remplit et le jeudi
   * non, ce n'est pas aux membres qu'il faut écrire, c'est l'horaire qu'il faut revoir avec le
   * gymnase. Le nombre de cours accompagne la moyenne pour qu'on ne conclue rien d'un jour tenu
   * une seule fois.
   */
  parJour: Array<{ jour: string; moyenne: number; cours: number }>;
  /**
   * Le **noyau** : combien de membres viennent à au moins `SEUIL_NOYAU` % des cours passés.
   *
   * C'est l'effectif sur lequel le club peut réellement compter pour un stage, une démonstration
   * ou un tournoi — celui qu'on annonce à l'extérieur sans se tromper. L'effectif invité, lui,
   * compte aussi ceux qu'on n'a pas revus depuis octobre.
   */
  noyau: number;
  /**
   * Le noyau nommé : qui est présent à au moins deux cours sur trois (tuile « Noyau »).
   *
   * C'est la seule bulle qui ne prépare aucune relance — elle dit sur qui le club tient, et ces
   * noms-là sont ceux qu'on sollicite pour encadrer un stage ou tenir une démonstration.
   */
  noyauNoms: string[];
  /**
   * Assiduité **médiane** du trimestre : la moitié des membres est au-dessus, l'autre en dessous.
   *
   * La médiane et non la moyenne, parce que le taux moyen de la vue Club se laisse tirer par les
   * extrêmes — quelques fidèles à 100 % suffisent à couvrir une moitié de club à 30 %. L'écart
   * entre les deux chiffres est une information à lui seul.
   */
  assiduiteMediane: number;
  /**
   * Le taux d'assiduité le plus bas et le plus haut du club, **pour situer la médiane** (bulle de
   * la tuile « Assiduité médiane »). `null` tant qu'aucun cours n'est passé.
   *
   * Une médiane à 50 % ne veut pas dire la même chose dans un club qui va de 40 à 60 % et dans un
   * club qui va de 0 à 100 % : le premier vient ensemble, le second est deux clubs qui partagent
   * une salle. L'étendue est ce qui distingue les deux, et elle se lit sur les mêmes taux
   * personnels, déjà calculés.
   */
  assiduiteEtendue: { min: number; max: number } | null;
  /**
   * La plus longue série de présences consécutives du trimestre : sa longueur, un nom (`qui`) et
   * combien de personnes l'atteignent (`combien`). `null` si aucun cours n'est encore passé.
   *
   * Le seul chiffre de ce bloc qui n'appelle pas une relance mais un **merci**, dit de vive voix au
   * début du cours suivant. Un tableau de bord qui ne montre que ce qui va mal finit par ne
   * s'ouvrir qu'en cas de problème.
   */
  serie: { longueur: number; qui: string; combien: number } | null;
  /**
   * Les trois plus longues séries de présences du trimestre, la plus longue d'abord (bulle de la
   * tuile « Série »). Liste vide si personne n'a enchaîné deux cours.
   *
   * La tuile ne peut afficher qu'un nom et un « et 2 autres » ; le podium, lui, les nomme. C'est
   * la seule bulle qu'on ouvre pour le plaisir, et elle est calculée avec `serie` en un seul
   * passage sur les mêmes présences — les deux ne peuvent donc pas se contredire.
   */
  meilleuresSeries: Array<{ qui: string; longueur: number }>;
  /**
   * Membres venus au moins une fois dans le trimestre, puis absents des `FENETRE_DECROCHAGE`
   * derniers cours.
   *
   * À ne pas confondre avec `jamaisVenus`, qui parle de ceux qu'on n'a pas encore vus : ici, ce
   * sont des habitués qui s'arrêtent. Ils ne manquent à aucune moyenne — le groupe se maintient
   * sans eux —, et c'est exactement pour ça qu'ils s'en vont sans que personne ne s'en aperçoive.
   */
  decrochages: number;
  /**
   * Qui est venu au moins une fois puis a manqué les trois derniers cours (tuile « Décrochages »).
   *
   * Ceux-là se rattrapent d'un message personnel, et d'un seul — « on ne t'a pas vu depuis trois
   * cours » ne s'écrit pas à une liste anonyme. **Disjoints de `jamaisVenusNoms`** par
   * construction, comme les deux compteurs : une même personne dans les deux bulles rendrait les
   * deux illisibles.
   */
  decrochagesNoms: string[];
};

export type CompteRendu = {
  /** Période retenue : celle en cours, sinon la plus récente où la personne est invitée. */
  periode: { id: string; nom: string; dateDebut: string; dateFin: string; invites: number } | null;
  /**
   * Les prochaines séances (4 au plus), la plus proche d'abord, annulées comprises.
   *
   * C'est le cœur de l'écran : chaque carte porte le thème, le nombre de présents annoncés, le
   * taux, et la liste nominative repliée. `SeanceCarte.monStatut` sert à la vue Personnel (la
   * pastille « Présent » sur la ligne) ; la vue Club l'ignore.
   */
  prochaines: SeanceCarte[];
  /** Nombre total de séances encore à venir dans la période. */
  aVenir: number;
  /** Séances déjà passées et non annulées : l'avancement du trimestre, écrit sous le bonjour. */
  seancesPassees: number;
  /** Séances non annulées de la période, passées comprises. */
  seancesTotal: number;
  /**
   * De quoi s'organiser pour le prochain cours, visible par tout le club.
   *
   * Ces compteurs ne révèlent rien que les cartes ne montrent déjà nom par nom : la liste
   * nominative des présents est ouverte à tout le club depuis l'étape 3.
   */
  groupe: {
    /** Personnes invitées sur la période (compte de service exclu). */
    invites: number;
    /** Qui a dit « Présent » au prochain cours non annulé. */
    presentsProchaine: number;
    /**
     * Taux moyen du trimestre, **ouvert à tout le club**. C'est un repère, pas un chiffre de
     * pilotage : sans lui, quelqu'un lit « ma présence : 71 % » sans savoir si c'est beaucoup ou
     * peu. Il ne révèle rien — la liste nominative de chaque cours est publique depuis l'étape 3.
     */
    tauxMoyen: number;
    /**
     * **Toutes les présences du trimestre additionnées**, cours passés et non annulés : le
     * « 42 présences depuis la rentrée » du club, celui qu'on annonce en début de cours.
     *
     * Ce n'est pas un taux et ça ne se déduit d'aucun : un taux monte et descend, ce compteur-là ne
     * fait qu'avancer, et c'est exactement pourquoi il rassemble — chacun sait que sa venue de
     * mardi y est pour une unité. Aucune lecture de plus : les présents de chaque séance sont déjà
     * comptés en SQL par `statsPeriode`, il ne reste qu'à les additionner.
     */
    presencesTotales: number;
  };
  /**
   * Sa propre situation, derrière la bascule : ses présences, ce qu'on attend encore d'elle, et de
   * quoi lui dire où elle en est (série, réponses, ateliers proposés).
   *
   * Calculé dans tous les cas, comme avant, **et pour la même raison** : tout ce bloc ne parle que
   * de la personne qui regarde. C'est le critère qui sépare ce fichier en deux — un chiffre sur soi
   * ou sur le cours de mardi appartient à tout le club, un chiffre sur lequel le bureau décide vit
   * dans `admin`, sous garde de permission. Trois de ces champs coûtent désormais une lecture
   * chacun (voir l'en-tête) ; ils restent de ce côté-ci de la frontière parce qu'aucun d'eux ne dit
   * rien de personne d'autre.
   */
  moi: {
    presences: number;
    seancesPassees: number;
    pourcentage: number;
    sansReponse: number;
    /**
     * **Le record** : sa plus longue suite de présences **consécutives** sur les cours passés et
     * non annulés du trimestre, pris dans l'ordre du calendrier. 0 si elle n'est jamais venue.
     *
     * « Consécutives » se lit sur les cours qui ont **eu lieu** : un cours annulé n'a manqué à
     * personne, il ne coupe donc aucune série — il n'est simplement pas dans la liste. Une absence,
     * elle, remet le compteur à zéro, même parfaitement excusée : c'est une série, pas une note de
     * conduite (même règle que `plusLongueSerie`, côté pilotage).
     *
     * Ce chiffre-là ne redescend jamais de tout le trimestre, et c'est exactement pourquoi c'est
     * lui qu'on affiche quand la série du moment est retombée (voir `serieEnCours`).
     */
    serie: number;
    /**
     * **La série en cours** : la même suite de présences, mais celle qui **se termine au dernier
     * cours passé** du trimestre. Présente aux trois derniers cours → 3 ; absente au dernier → 0.
     *
     * C'est le seul des deux qui puisse retomber, d'où la règle d'écriture que l'affichage doit
     * tenir (`BlocProgression`) : **on montre le record, jamais la chute.** Une série se casse sur
     * une grippe, un déménagement, un enfant malade — annoncer « série interrompue » ou « 0 cours
     * d'affilée » punirait quelqu'un qui n'a rien fait de mal. Le champ vaut donc 0 en silence, et
     * la vue bascule sur `serie`, qui est un fait acquis.
     *
     * Même lecture, même passage, **aucune requête de plus** : les deux se déduisent du parcours
     * des cours passés croisé avec le `findMany` de ses « Présent », déjà émis pour `serie`. Le
     * record est le maximum rencontré en chemin, la série en cours est la valeur du compteur en
     * sortie de boucle — les deux ne peuvent donc pas se contredire.
     */
    serieEnCours: number;
    /**
     * Combien de fois elle s'est **prononcée** sur ces mêmes cours : Présent, Absent **ou**
     * Peut-être. Un « Absent » est une réponse — le cours s'organise avec —, et c'est bien ce
     * qu'on veut valoriser ici : répondre, pas venir. Sa présence a déjà sa tuile à côté.
     *
     * Aucune requête : la ligne de la personne dans `stats.membres` porte déjà les trois compteurs,
     * il n'y a qu'à les additionner.
     */
    reponses: number;
    /** Nombre d'ateliers qu'elle a proposés, **toutes périodes confondues** : c'est une histoire
     * qui dépasse le trimestre, et la remettre à zéro tous les quatre mois n'aurait aucun sens. */
    ateliersProposes: number;
    /**
     * **Son ancienneté au club, en mois révolus** depuis son adhésion — ce qui donne son rang
     * (`rangs`, `prochainRang` dans `src/lib/blasons.ts`).
     *
     * « Depuis son adhésion » au sens de `dateDAdhesion` : la date « Au club depuis » réglée par le
     * bureau quand elle est renseignée, la création du compte sinon.
     *
     * C'est le seul chiffre de ce bloc qui ne parle pas du trimestre, et c'est délibéré : le rang
     * s'adosse à l'ancienneté, justement parce qu'un titre ne peut pas retomber à zéro tous les
     * quatre mois. Il ne descend jamais, par construction.
     *
     * **Aucune requête** : les deux dates arrivent avec la session (`CurrentUser.createdAt` et
     * `CurrentUser.auClubDepuis`, lues en même temps que le reste du compte), et le calcul est une
     * fonction pure. Le contrat de l'en-tête — 10 et 13 — ne bouge donc pas d'un pouce, et c'était
     * la condition pour l'afficher.
     */
    ancienneteMois: number;
    /**
     * **Ses présences depuis son arrivée, toutes périodes confondues** — cours passés et non
     * annulés, sans frontière de trimestre.
     *
     * À ne pas confondre avec `groupe.presencesTotales`, qui additionne celles **du club** sur le
     * trimestre en cours : celui-ci ne compte qu'elle, et ne repart jamais de zéro. C'est
     * exactement ce qui le rend nécessaire — les blasons de l'horizon « La saison » sont les seuls
     * à ne pas retomber à zéro tous les quatre mois, et aucun chiffre du trimestre ne pouvait les
     * alimenter : « 40 présences au club » se gagne une fois, « 12 ce trimestre » s'efface en
     * janvier.
     *
     * **Une lecture de plus** — la seule de ce fichier : un `count` sur une seule personne, gardé
     * par la période comme le reste de `moi`. Voir l'en-tête, qui la chiffre.
     */
    presencesToutesSaisons: number;
    /**
     * **Les jours de cours du club**, et pour chacun ses présences ce jour-là dans son meilleur mois
     * du trimestre : le maximum, mois par mois, du nombre de fois où elle est venue ce soir-là.
     *
     * C'est ce que demandent les blasons de créneau (« Le fer du mardi ») : un titre de régularité se
     * gagne sur un mois plein, pas sur un total de trimestre où trois mardis de septembre et un de
     * novembre se ressembleraient. Le meilleur mois, et non le mois courant, pour la même raison que
     * le record de série : un titre acquis ne se reprend pas parce qu'on a manqué décembre.
     *
     * **Les jours ne sont plus le mardi et le vendredi en dur** : ils se déduisent des séances du
     * club (`joursDeCoursDuClub`), sans quoi un club qui s'entraîne le lundi et le jeudi n'aurait eu
     * que deux blasons inatteignables.
     *
     * **Aucune requête** : les jours sortent des séances du trimestre déjà chargées, et les dates de
     * ses présences du parcours qui calcule déjà `serie` — mêmes cours passés, mêmes « Présent » déjà
     * chargés, un seul passage.
     */
    joursDeCours: Array<{ jour: number; presences: number }>;
  };
  /** Prochain événement publié, s'il y en a un (null sinon). */
  evenement: { id: string; nom: string; dateDebut: string; lieu: string; adresse: string } | null;
  /** Réservé à un administrateur **connecté en tant qu'administrateur** ; `null` pour tous les autres. */
  admin: BlocAdmin | null;
};

/** Combien de séances l'accueil met en avant : au-delà, on renvoie vers la liste complète. */
const PROCHAINES_AFFICHEES = 4;

/**
 * En dessous de deux cours d'affilée, ce n'est pas une série : c'est être venu.
 *
 * **Réexporté, pas redéfini** : la valeur vit avec le calcul des séries (`SERIE_MINIMALE`,
 * `src/lib/pilotage.ts`), et la vue Personnel la lit d'ici (voir `BlocProgression`) pour appliquer
 * exactement le même seuil que le bureau, à la raison inverse près : en dessous de deux, sa ligne de
 * série **disparaît**. Écrire « ta plus longue série : 1 cours » reviendrait à dire « tu n'as jamais
 * enchaîné deux cours » — un reproche déguisé en fait. Un nom, une valeur, un endroit : deux
 * constantes du même nom à deux valeurs, le dépôt en a déjà connu.
 */
export { SERIE_MINIMALE } from "./pilotage";

/**
 * Combien de séries la bulle nomme : un podium, pas un classement. Au-delà de trois noms, on ne
 * félicite plus personne, on publie un tableau — et la moitié du club y lirait son rang.
 */
const MEILLEURES_SERIES = 3;

const SELECT_PERIODE = { id: true, nom: true, dateDebut: true, dateFin: true } as const;

/**
 * La période dont on rend compte : celle en cours (ou la prochaine à démarrer), sinon la plus
 * récente — hors saison, le bilan du trimestre qui vient de s'achever vaut mieux qu'un écran vide.
 *
 * Droits : exactement la règle de `prochainesSeances` — l'équipe suit toute l'organisation, un
 * membre ne voit que les périodes où il est invité. Les brouillons sont écartés pour tout le
 * monde : personne n'y a encore été invité pour de bon, ce n'est pas un compte rendu.
 */
async function periodeDuCompteRendu(user: CurrentUser, now: Date) {
  const droit = isStaff(user) ? {} : { membres: { some: { userId: user.id } } };
  const aujourdHui = todayIso(now);
  return (
    (await db.period.findFirst({
      where: { ...droit, statut: "ACTIVE", dateFin: { gte: aujourdHui } },
      orderBy: { dateDebut: "asc" },
      select: SELECT_PERIODE,
    })) ??
    (await db.period.findFirst({
      where: { ...droit, statut: { not: "BROUILLON" } },
      orderBy: { dateDebut: "desc" },
      select: SELECT_PERIODE,
    }))
  );
}

/**
 * Tout ce qu'affiche l'accueil, en une fois.
 *
 * Aucun cas ne lève : sans période, sans séance ou pour une recrue du jour, le compte rendu sort
 * vide et à zéro (`periode: null`, listes vides) — jamais de `NaN`, jamais d'exception.
 */
export async function compteRendu(user: CurrentUser, partEffectifMin: number, now = new Date()): Promise<CompteRendu> {
  const aujourdHui = todayIso(now);
  /*
   * La garde de l'invariant, à un seul endroit : c'est ici, côté serveur, que se décide si le bloc
   * de pilotage sera calculé. La file des ateliers n'est même pas lue sans lui — il n'y a donc rien
   * à penser à filtrer plus bas, avant l'envoi au navigateur.
   *
   * **Deux conditions, pas une** : l'appartenance au bureau *et* l'élévation en cours
   * (`sessionForte`). Le bureau seul ne suffit plus depuis que l'espace admin est une élévation : un administrateur entré par son
   * lien personnel — sur le téléphone posé sur un banc, pendant le cours — voyait sinon la vue
   * « Admin » de l'accueil, avec qui ne répond plus, qui n'est jamais venu, la fréquentation du
   * mois. Ce sont les chiffres de pilotage du club : ils appartiennent à l'espace admin, et
   * l'espace admin se prend en redonnant mot de passe et code.
   *
   * **Et ce drapeau ne s'appelle plus `estAdmin`** : `User.estAdmin` existe désormais, et dit autre
   * chose — « du bureau », sans rien savoir de la session en cours. Deux noms identiques pour deux
   * valeurs dont l'une est strictement plus permissive que l'autre, c'est la confusion qu'on vient
   * ouvrir : il suffisait de passer le champ à la place du drapeau pour montrer la vue de pilotage
   * à un administrateur entré par son lien personnel.
   */
  const espaceAdminOuvert = can(user, "settings.technical") && user.sessionForte;
  const periode = await periodeDuCompteRendu(user, now);
  /*
   * L'heure qu'il est **à Paris**, « HH:MM », pour poser en SQL exactement la frontière de
   * `seanceCommencee` : une séance a eu lieu si sa date est passée, ou si c'est aujourd'hui et que
   * son heure de début est atteinte. `heureDebut` est une chaîne « HH:MM », qui se compare comme
   * telle — aucune `Date` construite côté base.
   */
  const heureParis = new Date(now.getTime() + parisOffsetMinutes(now) * 60_000).toISOString().slice(11, 16);
  const commencees = { annulee: false, OR: [{ date: { lt: aujourdHui } }, { date: aujourdHui, heureDebut: { lte: heureParis } }] };
  const [cartes, stats, evenements, ateliersEnAttente, liensDormants, presencesNominatives, mesPresences, ateliersProposes, presencesToutesSaisons] = await Promise.all([
    // Les cartes des prochains cours, telles que les affiche déjà la liste des séances.
    prochainesSeances(user, now),
    // Les agrégats de la période sont comptés en SQL par le tableau de bord (`groupBy`) : on lui
    // reprend la moyenne, l'avancement et les présents de chaque séance plutôt que de recompter ici.
    periode ? statsPeriode(periode.id, now) : null,
    // Passer `user` est ce qui garde les brouillons d'annonce invisibles aux membres.
    evenementsAVenir(user, now),
    espaceAdminOuvert ? db.atelier.count({ where: { statut: "PROPOSE" } }) : 0,
    /*
     * Liens jamais ouverts : une invitation encore valide dont personne ne s'est servi. Lue ici
     * seulement pour le bureau — un membre n'a rien à faire de ce chiffre, et il coûterait une
     * requête à tout le monde.
     *
     * **C'était un `count` ; c'est le même `where`, rendu autrement.** Le bureau a besoin de
     * *qui* n'est jamais entré — un email à renvoyer se renvoie à quelqu'un —, et rien d'autre
     * sur la page ne nomme ces personnes-là : elles ne figurent dans aucune liste de présence,
     * puisqu'elles ne sont jamais venues. Deux colonnes de plus sur autant de lignes qu'il y a
     * d'invités en attente, **et toujours une seule requête** : le contrat de l'en-tête (10 et 13)
     * ne bouge pas, et le compte se lit désormais sur la longueur de la liste.
     */
    espaceAdminOuvert && periode
      ? db.invitation.findMany({
          where: { periodId: periode.id, usedAt: null, revokedAt: null, user: { service: false } },
          select: { user: { select: { prenom: true, nom: true } } },
        })
      : [],
    /*
     * Les présences nominatives du trimestre : la seule lecture qu'ajoutent les indicateurs de
     * pilotage, et la seule qu'aucun agrégat ne remplace. Les `groupBy` de `statsPeriode` savent
     * combien de monde est venu, et combien de fois chacun est venu ; ils ne savent pas **qui était
     * là quel soir** — or une série de présences, comme un décrochage, ne se lit que dans cet
     * enchaînement, jamais dans un total.
     *
     * Ce qu'elle coûte est tenu au plus court, et c'est ce qui la rend acceptable sur l'écran le
     * plus ouvert de l'application : elle ne part que pour un administrateur élevé (exactement la
     * garde de la file des ateliers), ne demande que les lignes « Présent » d'un **seul** trimestre,
     * et n'en rapporte que deux identifiants — ni date, ni statut, ni nom.
     */
    espaceAdminOuvert && periode
      ? db.attendance.findMany({ where: { statut: "PRESENT", session: { periodId: periode.id } }, select: { userId: true, sessionId: true } })
      : [],
    /*
     * **Ses** présences à elle, et cette fois pour tout le monde.
     *
     * Même impossibilité que ci-dessus, à une personne près : les `groupBy` de `statsPeriode`
     * savent combien de fois quelqu'un est venu, jamais **à quels cours** — or une suite de
     * présences ne se lit que dans l'enchaînement. Croisée en mémoire avec les cours passés déjà
     * chargés, cette liste donne `moi.serie`, et rien d'autre ne la donne.
     *
     * Elle part pour chaque visite de chaque membre, ce qui se dit plutôt que de se cacher : elle
     * est l'une des trois lectures personnelles que chiffre l'en-tête. Ce qui la rend acceptable,
     * c'est sa taille — un
     * seul trimestre, une seule personne, **une seule colonne** — et le fait qu'elle ne parle que
     * de qui la déclenche : la garder sous permission n'aurait rien protégé, puisqu'il s'agit des
     * réponses que la personne a elle-même saisies.
     */
    periode ? db.attendance.findMany({ where: { userId: user.id, statut: "PRESENT", session: { periodId: periode.id } }, select: { sessionId: true } }) : [],
    // Ses ateliers proposés, toutes périodes confondues — un `count`, la plus petite lecture qui
    // soit. Gardé par la période comme le reste : sans trimestre, l'accueil ne montre rien de la
    // vue Personnel, il n'y a donc aucune raison de la faire payer.
    periode ? db.atelier.count({ where: { proposeParId: user.id } }) : 0,
    /*
     * **Ses présences depuis son arrivée**, trimestres confondus : la 10e requête de l'accueil,
     * écrite dans le contrat de l'en-tête plutôt que glissée en silence.
     *
     * Elle est minuscule — un `count`, une seule personne, aucune colonne rapportée — et ne parle
     * que de qui la déclenche, comme le reste de `moi`. Ce qui la rend nécessaire : c'est la seule
     * matière des blasons de l'horizon « La saison », les seuls qui ne retombent pas à zéro à
     * chaque trimestre, et aucun agrégat de la période ne sait compter au-delà d'elle. Gardée par
     * la période comme les deux autres lectures personnelles : sans trimestre, l'accueil ne montre
     * rien de la vue Personnel.
     *
     * Les cours annulés et ceux qui restent à venir en sont exclus : s'inscrire n'est pas venir, et
     * un cours qui n'a pas eu lieu n'a rassemblé personne. `Session.date` est une chaîne
     * « AAAA-MM-JJ » qui se compare comme telle — aucune `Date` construite ici, elle basculerait
     * d'un jour selon le fuseau du serveur.
     *
     * **La frontière est celle de `seanceCommencee`, et pas « avant aujourd'hui ».** C'était le
     * seul compteur de l'écran à s'arrêter à minuit : le soir même d'un cours, le compteur du
     * trimestre avait déjà avancé (il lit `passee`, donc l'heure de début) pendant que le blason
     * « 50 cours » affichait encore le chiffre de la veille, juste à côté. Deux compteurs de
     * présence qui ne disent pas la même chose sur le même écran, c'est un compteur de trop.
     */
    periode ? db.attendance.count({ where: { userId: user.id, statut: "PRESENT", session: commencees } }) : 0,
  ]);

  // À partir d'ici, plus aucune requête : tout se lit dans ce qui vient d'être chargé.
  // Les prochains cours vont jusqu'à la fin de la journée en cours : celui de ce soir y est encore
  // à 18 h, et il en sort dès qu'il a commencé. C'est exactement la frontière que le tableau de
  // bord applique pour dire qu'une séance est passée — sans quoi le même écran compterait le cours
  // de 19 h 30, à 20 h, à la fois comme fait et comme restant à faire.
  const aVenir = cartes.filter((c) => !c.commencee);
  const deLaPeriode = periode ? aVenir.filter((c) => c.periodId === periode.id) : [];
  const prochaines = aVenir.slice(0, PROCHAINES_AFFICHEES);
  // Ce qu'on attend encore de la personne : les cartes portent déjà sa réponse (`monStatut`),
  // rien à relire. Une séance annulée n'attend aucune réponse : la relancer serait un faux rappel.
  const sansReponse = deLaPeriode.filter((c) => c.inscrit && !c.annulee && c.monStatut === null).length;
  // La prochaine séance « pour de vrai » : une séance annulée n'attend aucune réponse et ne
  // rassemblera personne, la mettre en avant donnerait des chiffres qui ne veulent rien dire.
  const prochaine = aVenir.find((c) => !c.annulee) ?? null;

  // Les séances annulées n'ont pas eu lieu : elles ne comptent ni dans le réalisé ni dans le
  // total, pour que « 4 / 12 » se lise sur une seule et même base — celle du taux.
  const seances = stats?.seances ?? [];
  const passees = seances.filter((s) => s.passee && !s.annulee);
  /*
   * **Les soirs de cours du club**, pour les blasons de créneau (« Le fer du mardi »).
   *
   * Déduits du **trimestre en cours** et non de tout l'historique, et c'est le choix le plus simple :
   * la récurrence engendre toutes les séances du trimestre d'un coup, ces dates sont donc déjà en
   * mémoire — une lecture de l'historique entier coûterait une requête à chaque visite de chaque
   * membre, ce que ce fichier s'interdit. Le calendrier d'un club ne change pas d'un trimestre à
   * l'autre ; s'il change, les blasons suivent le nouveau calendrier, ce qui est le comportement
   * voulu. Les séances annulées sont écartées comme partout ailleurs ici.
   */
  const joursDeCours = joursDeCoursDuClub(seances.filter((s) => !s.annulee).map((s) => new Date(`${s.date}T00:00:00Z`)));
  // La ligne de la personne dans le tableau de bord : c'est le second `groupBy` (par membre) qui
  // l'a déjà comptée en même temps que le reste de la période. La vue personnelle ne coûte donc
  // rien de plus que la vue club — elles sortent des deux mêmes agrégats.
  const moi = stats?.membres.find((m) => m.id === user.id) ?? null;
  // Ses suites de présences : les cours passés sont déjà dans l'ordre du calendrier, il suffit de
  // les parcourir en comptant les présences d'affilée. Les cours annulés en ont été retirés plus
  // haut, donc une annulation ne casse aucune série — elle n'a manqué à personne.
  //
  // **Un seul passage donne les deux chiffres**, et c'est ce qui les rend gratuits : `serie` est le
  // maximum rencontré en chemin (le record du trimestre), `suite` est ce que vaut le compteur une
  // fois le dernier cours traversé (la série en cours). Absente au dernier cours, la boucle vient
  // de la remettre à zéro : c'est la valeur juste, et c'est à l'affichage — pas ici — de ne jamais
  // l'écrire telle quelle (voir la règle « on montre le record, jamais la chute »).
  //
  // Le même passage rapporte **les dates** de ses présences, et c'est ce qui rend gratuits les
  // compteurs de créneau (`moi.joursDeCours`) : la matière est déjà là — les cours passés portent
  // leur date, le `Set` dit auxquels elle était —, il n'y a qu'à retenir les dates au lieu de les
  // jeter. Date UTC construite depuis la chaîne « AAAA-MM-JJ », pour que le jour de la semaine ne
  // dépende pas du fuseau du serveur.
  //
  // **Le parcours s'arrête à sa date d'arrivée dans le trimestre, comme ses trois compteurs**. Il
  // courait sur *tous* les cours passés, pendant que `moi.presences`, `moi.seancesPassees` et
  // `moi.pourcentage` sortent de la ligne bornée de `statsPeriode` : quelqu'un inscrit en cours de
  // trimestre, venu une fois en essai avant de s'inscrire (le bureau coche après coup), lisait « 0
  // présence, 0 %, 4 cours passés » à côté de « ta plus longue série : 2 cours ». C'est exactement
  // le défaut réparé le matin même sur « Mes présences », déplacé d'un cran. `arrivee` vaut `""`
  // quand la donnée manque (`jourDArrivee`), ce qui ne borne rien — l'ancien comportement, le plus
  // prudent. Et sans ligne d'agrégat (personne non invitée sur la période), il n'y a pas de série
  // non plus : ses compteurs sont déjà tous à zéro, une série à côté les démentirait.
  const mesSeances = new Set(mesPresences.map((a) => a.sessionId));
  const mesDates: Date[] = [];
  let serie = 0;
  let suite = 0;
  for (const s of moi ? passees.filter((p) => p.date >= moi.arrivee) : []) {
    const presente = mesSeances.has(s.id);
    if (presente) mesDates.push(new Date(`${s.date}T00:00:00Z`));
    suite = presente ? suite + 1 : 0;
    if (suite > serie) serie = suite;
  }
  const serieEnCours = suite;
  // Invités de la période, comptes de service exclus (le tableau de bord les a déjà écartés).
  const invites = stats?.membres.length ?? 0;
  const evenement = evenements[0] ?? null;
  // Les lignes « Présent » rangées par personne : c'est la forme qu'attendent la plus longue série
  // et les décrochages, et elle se construit une fois pour les deux. Les identifiants que le
  // tableau de bord ne connaît pas sont écartés au passage — le compte de service du portail n'est
  // pas un membre du club, et rien ne l'empêcherait sinon de tenir la plus longue série.
  const noms = new Map(stats?.membres.map((m) => [m.id, `${m.prenom} ${m.nom}`] as const) ?? []);
  /*
   * **Chacun n'y porte que les cours donnés depuis son arrivée dans le trimestre**. La lecture,
   * elle, n'a aucune borne — elle ne peut pas en avoir, c'est une liste nominative de tout le club
   * en une requête —, et c'est ici que la borne se pose, sur les dates de séance déjà en mémoire.
   *
   * **Pourquoi c'est indispensable :** cette table alimente les séries et les décrochages, quand la
   * tuile « Jamais venus » d'à côté lit `m.presents`, **borné** à la date d'arrivée par
   * `statsPeriode`. Deux bornes différentes sur le même écran, et les deux tuiles que leurs
   * docstrings jurent disjointes nommaient la même personne : quelqu'un inscrit le 10 septembre, venu
   * en essai le 1er (le bureau coche après coup), jamais revenu, était à la fois « jamais venu » (0
   * présence depuis son arrivée) et « décrochage » (venu une fois, absent des trois derniers cours) —
   * deux scripts d'appel contradictoires, sur le même écran, pour la même personne.
   *
   * La règle appliquée est celle de tout le dossier : **un compteur de personne ne compte que les
   * cours depuis son arrivée** ; le remplissage d'une séance, lui, reste un fait sans borne (voir
   * `csvPresences`). Sa présence d'essai n'est donc effacée de rien : elle est sur la fiche du cours
   * du 1er septembre, dans le total de cette séance et dans la colonne du CSV.
   *
   * Une séance inconnue de `seances` ne peut pas être située dans le temps : elle est écartée plutôt
   * que comptée sans borne. Le cas ne se présente pas — `statsPeriode` est lu ici sur toute la
   * période, comme la liste des présences.
   */
  const arriveeDe = new Map(stats?.membres.map((m) => [m.id, m.arrivee] as const) ?? []);
  const dateDeLaSeance = new Map(seances.map((s) => [s.id, s.date] as const));
  const presencesParMembre = new Map<string, Set<string>>();
  for (const { userId, sessionId } of presencesNominatives) {
    if (!noms.has(userId)) continue;
    const date = dateDeLaSeance.get(sessionId);
    if (date === undefined || date < (arriveeDe.get(userId) ?? "")) continue;
    const siennes = presencesParMembre.get(userId) ?? new Set<string>();
    siennes.add(sessionId);
    presencesParMembre.set(userId, siennes);
  }

  return {
    periode: periode ? { ...periode, invites } : null,
    prochaines,
    aVenir: deLaPeriode.length,
    seancesPassees: passees.length,
    seancesTotal: seances.filter((s) => !s.annulee).length,
    groupe: {
      invites,
      // Le compteur de la carte : la liste des séances l'a déjà calculé pour l'affichage.
      presentsProchaine: prochaine?.compteurs.presents ?? 0,
      tauxMoyen: stats?.moyenne ?? 0,
      // Le compteur qui ne redescend jamais : les présents de chaque cours déjà donné, additionnés.
      presencesTotales: passees.reduce((total, s) => total + s.compteurs.presents, 0),
    },
    moi: {
      // Personne non invitée sur la période (un instructeur, une recrue du jour) : aucune séance
      // ne la concerne, donc zéro partout — et surtout pas un taux calculé sur rien.
      presences: moi?.presents ?? 0,
      seancesPassees: moi?.seances ?? 0,
      pourcentage: moi?.pourcentage ?? 0,
      sansReponse,
      serie,
      serieEnCours,
      // Se prononcer, c'est avoir dit Présent, Absent **ou** Peut-être — même définition qu'au
      // bureau (`tauxReponse`), pour que les deux écrans ne puissent pas se contredire. Les trois
      // compteurs sont déjà sur sa ligne du tableau de bord : rien à relire.
      reponses: (moi?.presents ?? 0) + (moi?.absents ?? 0) + (moi?.peutEtre ?? 0),
      ateliersProposes,
      // Son ancienneté : une soustraction de dates sur ce que la session portait déjà, et rien de
      // plus. Contrairement à tout le reste de ce bloc, elle vaut même sans période et même pour
      // qui n'est invité nulle part — on est du club avant d'être inscrit à un trimestre.
      // `dateDAdhesion` porte la règle de repli (la date saisie par le bureau si elle existe, la
      // création du compte sinon) : elle est écrite une seule fois, dans src/lib/blasons.ts.
      ancienneteMois: moisDepuis(dateDAdhesion(user), now),
      // Le seul chiffre de ce bloc qui coûte une lecture, et le seul qui ne s'arrête pas au
      // trimestre : ses présences depuis son arrivée (voir le commentaire de la requête).
      presencesToutesSaisons,
      // Ses présences du meilleur mois sur chacun des soirs de cours du club : mêmes dates, un
      // appel d'une fonction pure par créneau, zéro requête.
      joursDeCours: joursDeCours.map((jour) => ({ jour, presences: presencesDuMeilleurMois(mesDates, jour) })),
    },
    // `adresse` voyage avec le lieu : la ligne de l'accueil en fait un lien vers la carte, comme
    // partout ailleurs. Elle est déjà chargée avec l'annonce — aucune requête de plus.
    evenement: evenement ? { id: evenement.id, nom: evenement.nom, dateDebut: evenement.dateDebut, lieu: evenement.lieu, adresse: evenement.adresse } : null,
    admin: espaceAdminOuvert
      ? blocAdmin({
          prochaines,
          // Les séances passées dans l'ordre du calendrier (`statsPeriode` les rend déjà triées) :
          // les indicateurs de pilotage lisent cet ordre, une tendance et une série n'ont pas de
          // sens sur un tas.
          passees: passees.map((s) => ({ id: s.id, date: s.date, presents: s.compteurs.presents })),
          // Tout ce qui reste au trimestre, et pas les seuls cours mis en avant : « 2 cours en
          // danger » doit parler de la fin du trimestre, sinon le compteur rassure à tort.
          aVenirDuTrimestre: seances.filter((s) => !s.passee && !s.annulee),
          membres: stats?.membres ?? [],
          ateliersEnAttente,
          seancesDeLaPeriode: seances,
          aujourdHui,
          liens: liensDormants,
          presences: presencesParMembre,
          noms,
          invites,
          partEffectifMin,
        })
      : null,
  };
}

/**
 * Les chiffres de pilotage, tous déduits de ce qui est déjà en mémoire.
 *
 * Fonction à part pour que l'appel de `compteRendu` se lise d'un trait — `espaceAdminOuvert ? … : null` —
 * et qu'on ne puisse pas, en la retouchant, faire remonter un de ces chiffres hors de la garde de
 * permission.
 *
 * **Chacun de ces chiffres appelle un geste, et aucun ne se lit ailleurs sur la page.** Le taux du
 * trimestre et l'effectif invité en sont sortis : le premier est déjà la tuile « Taux du trimestre »
 * de la vue Club, le second le dénominateur de son « N annoncés sur M ». Les répéter au bureau
 * donnait une troisième vue qui n'apprenait rien à personne.
 *
 * **Revirement : le nombre de cours sous le seuil est revenu.** Il avait été écarté d'ici comme un
 * doublon de la frise, qui montre déjà chaque prochain cours colonne par colonne, trait du seuil
 * compris et palier en toutes lettres. Le raisonnement avait un trou, et Delta l'a relevé : la
 * frise s'arrête aux quatre cours mis en avant et ne situe le reste que dans le mois, là où le
 * bureau a besoin du **jour**. « 2 cours en danger, le premier » se traite le soir même ; « quelque
 * part en octobre » attend. Le compteur porte donc sur **tout ce qui reste au trimestre** et il
 * nomme la date du premier : c'est cette date, que rien d'autre sur la page ne donne, qui le fait
 * entrer dans le critère plutôt que de l'en exclure.
 *
 * Les entrées arrivent en un seul objet nommé, et pas en huit arguments de suite : la moitié sont
 * des tableaux de séances qui s'intervertiraient sans une erreur de compilation. Ce qu'elles ont en
 * commun est plus important que leur forme — **tout est déjà en mémoire**. Cette fonction ne lit
 * jamais la base : ce qui lui manquerait doit lui être passé, ou ne pas être affiché.
 */
function blocAdmin(entrees: {
  prochaines: SeanceCarte[];
  /** Séances passées non annulées, dans l'ordre du calendrier. */
  passees: SeancePassee[];
  /** Séances non annulées restant au trimestre, cartes mises en avant ou non. */
  aVenirDuTrimestre: Array<{ date: string; compteurs: Compteurs }>;
  membres: Array<{ id: string; presents: number; seances: number; pourcentage: number }>;
  /**
   * **L'effectif invité du trimestre** — le second nombre de la tuile « La salle » (« 7 sur 12 »).
   *
   * Il arrive en argument et ne se déduit **pas** du premier cours à venir, comme c'était le cas :
   * en fin de trimestre, quand il ne reste plus un seul cours, ce chiffre retombait à zéro et la
   * tuile annonçait « 7 présents en moyenne sur 0 invités ». L'effectif d'un trimestre ne dépend
   * pas de ce qu'il lui reste à jouer : c'est la longueur de sa liste d'invités, celle-là même que
   * la vue Club affiche à tout le monde.
   */
  invites: number;
  ateliersEnAttente: number;
  seancesDeLaPeriode: Array<{ id: string; date: string; annulee: boolean; compteurs: Compteurs }>;
  aujourdHui: string;
  /** Les invitations encore dormantes, une ligne par lien, avec de quoi nommer la personne. */
  liens: Array<{ user: { prenom: string; nom: string } }>;
  /** Qui était présent à quelles séances du trimestre. */
  presences: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * La part minimale d'effectif **réglée par le club** (`Identite.partEffectifMin`, en pourcentage
   * des invités) : c'est elle qui décide quels cours « manquent de monde ». Elle arrive en argument
   * comme le reste — cette fonction ne lit rien.
   */
  partEffectifMin: number;
  /**
   * Nom affichable de chaque membre, **dans l'ordre de l'annuaire** (`stats.membres` sort déjà
   * trié par nom de famille). Cet ordre est celui des bulles : les parcourir suffit à obtenir des
   * listes alphabétiques, sans retrier quoi que ce soit ni risquer deux ordres différents d'une
   * tuile à l'autre.
   */
  noms: ReadonlyMap<string, string>;
}): BlocAdmin {
  const { prochaines, passees, membres, ateliersEnAttente, seancesDeLaPeriode, aujourdHui, liens, presences, noms } = entrees;
  // Les cours annulés n'attendent aucune réponse : les compter ferait tomber le taux de réponse et
  // ferait passer pour muet quelqu'un à qui on n'a rien demandé.
  const suivis = prochaines.filter((c) => !c.annulee);
  const attendues = suivis.reduce((n, c) => n + c.compteurs.invites, 0);
  const manquantes = suivis.reduce((n, c) => n + c.compteurs.enAttente, 0);
  // Les noms d'un membre à partir de sa ligne d'agrégat : un identifiant absent de l'annuaire
  // (compte de service) n'a pas de nom à montrer, il sort de la liste plutôt que d'y écrire un
  // trou. L'ordre de `membres` est celui de `noms` — les deux sortent du même `statsPeriode`.
  const nommer = (gens: readonly { id: string }[]): string[] =>
    gens.flatMap((g) => {
      const nom = noms.get(g.id);
      return nom ? [nom] : [];
    });

  /*
   * Les quatre listes qui portent à la fois un compteur et sa bulle sont construites **une seule
   * fois** et le compteur en est la longueur. C'est le point d'attention de tout ce bloc : deux
   * parcours indépendants — un pour compter, un pour nommer — finiraient un jour par annoncer
   * « 3 silencieux » au-dessus de deux noms, et c'est précisément ce genre d'écart qui fait cesser
   * de faire confiance à un tableau de bord.
   */
  const muets = silencieux(suivis);
  /*
   * **Jamais venu se compte depuis l'arrivée de la personne, pas depuis la rentrée.**
   *
   * Quelqu'un inscrit à la Toussaint n'a pas « manqué » les six cours de septembre : il n'y était
   * pas invité. Compté sur tout le trimestre, il arrivait dans la tuile « Jamais venus » — donc
   * dans la liste d'appel du bureau — avant même d'avoir eu un seul cours à honorer. La condition
   * n'est donc plus « le trimestre a des cours passés » mais « **son** trimestre en a ».
   *
   * **Et ce chiffre-là, `statsPeriode` le rend déjà** : `m.seances`, c'est le nombre de cours
   * passés depuis son arrivée — le dénominateur de son taux personnel. Ce bloc a un temps relu les
   * dates d'arrivée pour refaire le même calcul de son côté ; à `passees` et `arrivee` identiques,
   * `passees.some((s) => s.date >= arrivee)` n'est rien d'autre que `m.seances > 0`. Une requête,
   * une Map et une condition pour un chiffre déjà en mémoire — et surtout deux calculs libres de
   * diverger. Le taux personnel et la tuile lisent maintenant le **même** nombre, à la lettre.
   */
  const jamaisVenus = membres.filter((m) => m.presents === 0 && m.seances > 0);
  const sansProgramme = suivis.filter((c) => c.programme.length === 0);
  // Tout ce qui reste au trimestre, dans l'ordre du calendrier — le calcul vit dans `pilotage.ts`,
  // avec les autres indicateurs de trimestre, et n'est pas recopié ici : c'est la seule façon que la
  // règle de seuil ne finisse pas par différer d'un écran à l'autre.
  const enDanger = coursEnDanger(entrees.aVenirDuTrimestre, entrees.partEffectifMin);

  // L'assiduité se lit sur les membres que le trimestre a déjà eu l'occasion de compter : tant
  // qu'aucun cours n'est passé, chacun est à 0 % sans avoir rien manqué, et une médiane à 0
  // annoncerait un club en déroute le jour de la rentrée.
  const comptes = membres.filter((m) => m.seances > 0);
  const pourcentages = comptes.map((m) => m.pourcentage);
  const { mediane, noyau } = assiduite(pourcentages);
  // Le même seuil que le compteur, pris au même endroit : le noyau nommé ne peut pas être plus
  // large ni plus étroit que le noyau compté.
  const assidus = comptes.filter((m) => m.pourcentage >= SEUIL_NOYAU);

  /*
   * Les séries de présences et les décrochages : **les deux vivent dans `pilotage.ts`**, avec le
   * reste des indicateurs de trimestre, et ne sont pas réécrits ici. Ils l'ont été, et les deux
   * versions avaient déjà divergé (celle du pilotage parcourait tout identifiant présent en table,
   * compte de service compris) : c'est la copie livrée qui décidait, pendant que les tests
   * éprouvaient l'autre. Un calcul, un exemplaire.
   *
   * Le classement sert deux champs — la tuile `serie` et le podium `meilleuresSeries` — et il est
   * calculé **une fois** : séparément, les deux pourraient afficher un nom dans la tuile et un autre
   * en tête de la bulle qui s'ouvre au-dessus.
   */
  const meilleures = meilleuresSeries(passees, presences, noms);
  const record = serieDeTete(meilleures);
  const decrocheurs = decrochages(passees, presences, noms);

  return {
    prochainsCours: suivis.length,
    // Se prononcer, c'est avoir dit Présent, Absent **ou** Peut-être : un « Absent » est une
    // réponse, et le cours peut être organisé sur cette base. D'où le complément des réponses
    // manquantes, et non le nombre de présents.
    tauxReponse: calculerTaux(attendues - manquantes, attendues),
    silencieux: muets.length,
    // Les cartes portent le prénom et le nom de chacun : la bulle se remplit sans rien relire.
    silencieuxNoms: nomsTries(muets),
    // L'effectif invité du trimestre, tel quel : il ne se lit plus sur le prochain cours, qui
    // n'existe plus en fin de trimestre et faisait alors afficher « 7 sur 0 ».
    invites: entrees.invites,
    liensJamaisOuverts: liens.length,
    // Ces gens-là ne figurent dans aucune liste de présence — ils ne sont jamais entrés —, d'où
    // les noms rapportés par la requête elle-même, triés ici comme l'annuaire les trierait.
    liensJamaisOuvertsNoms: nomsTries(liens.map((l) => l.user)),
    // Un cours sans aucune case remplie : personne ne sait encore ce qu'on y fera, et c'est le
    // genre d'oubli qui ne se voit que la veille. Compté sur les cours mis en avant, comme les
    // autres chiffres de relance — c'est là qu'on peut encore agir.
    coursSansProgramme: sansProgramme.length,
    coursSansProgrammeDates: sansProgramme.map((c) => c.date),
    // Le mois civil en cours, dans l'ordre du calendrier : les cours déjà donnés disent si la
    // fréquentation tient, ceux à venir où il faut relancer. Les deux sur la même frise, parce que
    // c'est la comparaison qui parle — un mardi à trois après quatre mardis à dix, ça se voit.
    frequentationDuMois: seancesDeLaPeriode.filter((s) => s.date.slice(0, 7) === aujourdHui.slice(0, 7)),
    // Invité à des cours déjà passés, présent à aucun : la moyenne du groupe ne le dit pas, elle
    // se maintient pendant qu'une personne décroche. Une période sans cours passé n'en compte
    // aucun — personne n'a encore eu l'occasion de venir.
    jamaisVenus: jamaisVenus.length,
    jamaisVenusNoms: nommer(jamaisVenus),
    // Combien de monde vient en moyenne : les présents par séance sont déjà comptés en SQL par
    // `statsPeriode`, il ne reste qu'à en faire la moyenne. Aucune séance passée → 0, jamais NaN.
    participationMoyenne: passees.length ? Math.round(passees.reduce((n, s) => n + s.presents, 0) / passees.length) : 0,
    ateliersEnAttente,
    // Sur les cours mis en avant, et pas sur tout le trimestre : c'est le chiffre sur lequel on
    // peut encore agir cette semaine (relancer, appeler), pas une statistique de fin de saison.
    invitesSansReponse: manquantes,
    coursEnDanger: enDanger.length,
    // La date du premier : elle seule transforme le compteur en geste à poser (voir l'en-tête).
    // Les dates étant triées, c'est la première de la liste — pas un second parcours.
    prochainCoursEnDanger: enDanger[0] ?? null,
    coursEnDangerDates: enDanger,
    // La pente de la fréquentation, et non son niveau : les deux séries de séances comparées
    // sortent des présents déjà comptés en SQL, il n'y a rien à relire pour l'obtenir.
    tendance: tendance(passees),
    // Le seul indicateur qui parle du créneau plutôt que des personnes.
    parJour: moyennesParJour(passees),
    noyau,
    noyauNoms: nommer(assidus),
    assiduiteMediane: mediane,
    // Le plus bas et le plus haut taux du club : ce qui donne son sens à la médiane. Aucun membre
    // encore compté → `null`, et surtout pas un `{ min: 0, max: 0 }` qui se lirait comme un fait.
    assiduiteEtendue: pourcentages.length ? { min: Math.min(...pourcentages), max: Math.max(...pourcentages) } : null,
    // Le seul qui cite un nom, d'où la table des noms en entrée : « Charlie Bernard, 9 cours
    // d'affilée » se remercie, « une personne à 9 cours » ne se remercie pas. `combien` compte les
    // ex æquo, pour que l'affichage écrive « et 2 autres » plutôt que de désigner quelqu'un au hasard.
    serie: record,
    meilleuresSeries: meilleures.slice(0, MEILLEURES_SERIES),
    // Des habitués qui s'arrêtent, à distinguer de ceux qui ne sont jamais venus (`jamaisVenus`) :
    // les deux appellent un appel, mais pas le même.
    decrochages: decrocheurs.length,
    decrochagesNoms: decrocheurs,
  };
}

/**
 * Les personnes restées muettes sur **tous** les prochains cours où elles sont invitées.
 *
 * Ce n'est pas le total des réponses manquantes (`invitesSansReponse`) sous un autre angle : sept
 * réponses manquantes, ce sont peut-être sept personnes qui ont répondu à trois cours sur quatre —
 * là, on attend. Ce sont peut-être trois personnes dont on n'a aucune nouvelle — là, on appelle.
 * D'où ce relevé par personne, qui ne coûte rien : chaque carte porte déjà sa liste nominative.
 *
 * Quelqu'un n'est retenu que sur les cours où il est **invité** (les périodes n'ont pas toutes les
 * mêmes invités) : on compare son nombre de silences au nombre de cours qui le concernent.
 *
 * Les **gens** sont renvoyés, et non leur nombre : le compteur de la tuile en est la longueur, sa
 * bulle en est la liste, et il n'existe donc aucun chemin par lequel les deux pourraient différer.
 * Les cartes portant déjà prénom et nom, nommer quelqu'un ici ne coûte pas une lecture de plus —
 * y compris pour un invité d'une autre période, qui n'est pas dans l'annuaire du trimestre en cours.
 */
function silencieux(cours: SeanceCarte[]): Array<{ prenom: string; nom: string }> {
  const invitations = new Map<string, number>();
  const silences = new Map<string, number>();
  const gens = new Map<string, { prenom: string; nom: string }>();
  const compter = (table: Map<string, number>, id: string) => table.set(id, (table.get(id) ?? 0) + 1);
  for (const c of cours) {
    const { presents, absents, peutEtre, sansReponse } = c.participants;
    for (const p of [...presents, ...absents, ...peutEtre, ...sansReponse]) {
      compter(invitations, p.id);
      gens.set(p.id, { prenom: p.prenom, nom: p.nom });
    }
    for (const p of sansReponse) compter(silences, p.id);
  }
  return [...silences].flatMap(([id, n]) => {
    if (n !== invitations.get(id)) return [];
    const personne = gens.get(id);
    return personne ? [personne] : [];
  });
}

/**
 * « Prénom Nom », dans l'ordre alphabétique du **nom de famille** — celui de l'annuaire.
 *
 * Réservé aux deux listes qui ne viennent pas de `stats.membres` (les silencieux, tirés des cartes,
 * et les liens dormants, tirés de leur requête) : partout ailleurs, parcourir la table des noms
 * suffit, elle est déjà triée. Un même écran ne doit pas ranger les gens de deux façons selon la
 * bulle qu'on ouvre.
 */
function nomsTries(gens: readonly { prenom: string; nom: string }[]): string[] {
  return [...gens].sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr")).map((p) => `${p.prenom} ${p.nom}`);
}
