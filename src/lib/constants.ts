/**
 * Constantes métier partagées (SQLite n'a pas d'enums : les statuts sont des
 * chaînes verrouillées ici et dans les schémas Zod).
 */
/**
 * **Les lignes de la matrice de permissions** — pas les valeurs de la colonne `role`.
 *
 * `"ADMIN"` y reste, et c'est voulu : c'est le nom du jeu de droits le plus large, celui que `can`
 * accorde à quiconque porte `estAdmin`. Ce qui a changé, c'est qu'on ne l'**écrit plus en base** :
 * voir {@link ROLES_DE_BASE}.
 */
export const ROLES = ["ADMIN", "INSTRUCTEUR", "MEMBRE"] as const;
export type Role = (typeof ROLES)[number];

/**
 * **Le rôle de base, celui que tout le monde porte : membre ou instructeur**.
 *
 * Avant, les trois rôles étaient **exclusifs** : nommer quelqu'un au bureau lui retirait son rôle
 * d'instructeur, et le club ne pouvait plus dire qu'un membre du bureau enseigne — alors que c'est le
 * cas le plus courant dans une petite association. « Administrateur » est devenu un **supplément**
 * (`User.estAdmin`), et cette liste est ce qu'un écran propose dans une liste déroulante de rôle.
 *
 * Conséquence à retenir : **`role` ne vaut plus jamais `"ADMIN"`** (la migration
 * `role_de_base_et_admin_en_supplement` l'a déplacé), et ce qui veut savoir si quelqu'un est du
 * bureau lit `estAdmin`, jamais `role`.
 */
export const ROLES_DE_BASE = ["INSTRUCTEUR", "MEMBRE"] as const;
export type RoleDeBase = (typeof ROLES_DE_BASE)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  INSTRUCTEUR: "Instructeur",
  MEMBRE: "Membre",
};

export const PERIOD_STATUTS = ["BROUILLON", "ACTIVE", "CLOSE"] as const;
export type PeriodStatut = (typeof PERIOD_STATUTS)[number];

/**
 * **Une période close ne se retouche plus, et la règle s'écrit ici une fois.**
 *
 * Quatre endroits posaient la même question en la recopiant : la grille du planning
 * (`partiePourEcriture` et `seancePourEcriture`, `src/actions/planning.ts`), la file des
 * propositions d'atelier (`periodeOuverte`, `src/actions/ateliers.ts`) et la séance elle-même. La
 * quatrième écriture est ce qui a décidé du regroupement : « un nom, une valeur, un endroit ».
 *
 * **Le verrou ne peut pas se déduire de la date** : on clôt un trimestre sans attendre son dernier
 * cours, donc une période close peut porter des séances à venir. C'est le **statut** qui tranche, et
 * lui seul.
 *
 * Ce qui est partagé, c'est la **question**, pas la phrase : le planning, la séance et un atelier
 * refusent la même écriture mais ne parlent pas du même objet, et `REFUS_PERIODE_CLOSE` garde donc une
 * phrase par objet — le mot « planning » dans un message d'annulation de séance serait une erreur de
 * plus, pas une économie.
 */
export function ecritureFermee(statut: PeriodStatut | string): boolean {
  return statut === "CLOSE";
}

/** Le refus, dans les mots de l'objet auquel on vient de toucher. */
export const REFUS_PERIODE_CLOSE = {
  planning: "Cette période est close : le planning n'est plus modifiable.",
  seance:
    "Ce trimestre est clos : la séance n'est plus modifiable. Ses réponses, son programme et ses envois appartiennent à un trimestre terminé — rouvre la période si c'est vraiment ce que tu veux.",
  /*
   * **Le verrou valait pour la séance et pas pour la liste des séances**. L'écran de la période
   * créait et effaçait des séances — donc des réponses — sur un trimestre clos, pendant que l'écran
   * de la séance répondait « Ce trimestre est clos ». Même asymétrie que celle du code récent, sur
   * le verrou d'état cette fois : deux portes vers la même écriture ne peuvent pas avoir deux
   * serrures.
   */
  seances:
    "Ce trimestre est clos : ses séances ne se créent ni ne s'effacent plus. Rouvre la période si c'est vraiment ce que tu veux.",
  /*
   * **Le registre d'un trimestre clos se lit, il ne se réécrit plus**. `CLAUDE.md` annonce que ce
   * verrou est « lu par les quatre appelants » — la correction des réponses, unitaire comme en
   * masse, n'en faisait pas partie : un appel forgé ramenait le registre d'une séance de 11
   * réponses à **0**, puis déclarait les douze invités présents, **sur une période CLOSE**. Même
   * asymétrie que celle (le verrou valait pour la séance et pas pour la liste des séances) : deux
   * portes vers la même écriture ne peuvent pas avoir deux serrures. Et ces réponses nourrissent
   * tous les taux du club, y compris ceux d'un bilan d'assemblée générale.
   */
  presences:
    "Ce trimestre est clos : ses réponses ne se corrigent plus. Elles appartiennent à un trimestre terminé — rouvre la période si c'est vraiment ce que tu veux.",
} as const;

export const ATTENDANCE_STATUTS = ["PRESENT", "ABSENT", "PEUT_ETRE"] as const;
export type AttendanceStatut = (typeof ATTENDANCE_STATUTS)[number];

export const ATELIER_STATUTS = ["PROPOSE", "PLANIFIE", "REFUSE"] as const;
export type AtelierStatut = (typeof ATELIER_STATUTS)[number];

/**
 * **Le nom livré avec le code, et rien de plus.**
 *
 * Il y avait ici trois constantes qui nommaient le club en dur (`APP_NAME`, `APP_SHORT_NAME`,
 * `ASSOCIATION_NAME`) : l'outil n'était installable que par le club pour lequel il a été écrit.
 * Le nom est maintenant une **donnée** — voir `src/lib/identite.ts`, qui le lit en base, à défaut
 * dans l'environnement, à défaut ici.
 *
 * Ces deux constantes ne servent donc qu'au tout premier démarrage et aux rares endroits qui ne
 * peuvent pas attendre une lecture de base (l'expéditeur des emails, construit par une fonction
 * pure). *HEMA* est le nom international de l'AMHE : neutre, et juste pour n'importe quel club.
 */
export const SIGLE_LIVRE = "HEMA";
export const SUFFIXE_LIVRE = "Organizer";
export const NOM_APP_LIVRE = `${SIGLE_LIVRE} ${SUFFIXE_LIVRE}`;

/**
 * **Les deux images livrées dans `public/`**, servies tant qu'aucun logo n'a été déposé dans l'écran
 * *Identité*.
 *
 * Elles sont ici, et non dans `src/lib/identite.ts`, pour une raison de frontière : des composants
 * **client** (l'en-tête, le bandeau d'un événement) ont besoin de ce chemin de repli, et importer
 * `identite.ts` depuis le navigateur y entraînerait `settings.ts`, donc `crypto.ts`, donc
 * `node:crypto` — le build échoue franchement, ce qui est la bonne nouvelle de l'histoire. Ce
 * fichier-ci ne dépend de rien : il se lit des deux côtés.
 */
export const LOGO_LIVRE = "/logo.png";
export const ECU_LIVRE = "/logo-ecu.png";

/**
 * **Le plafond d'une image déposée, et les mots qui l'annoncent : une seule valeur, un seul endroit.**
 *
 * Le nombre vivait dans `src/lib/affiches.ts` (`AFFICHE_TAILLE_MAX`) et se **recopiait** dans les
 * écrans de dépôt, plus « 4 Mo » écrit en clair dans les messages de refus. Cinq écritures pour un
 * seul plafond : on pouvait changer la valeur et laisser les écrans continuer de promettre 4 Mo — or
 * le dossier exige qu'un plafond annoncé à l'utilisateur et son équivalent technique soient reliés
 * par un test, pas par la mémoire de qui relit.
 *
 * Il est **ici** et pas dans `affiches.ts` pour la raison de frontière qui vaut déjà pour les logos
 * livrés : les zones de dépôt sont des composants **client**, et importer `affiches.ts` depuis le
 * navigateur y entraînerait `db.ts`, `env.ts`, `identite.ts` — donc `settings.ts`, donc
 * `node:crypto`, et un `npm run build` en échec que ni `tsc` ni les tests ne voient. Ce fichier-ci ne
 * dépend de rien.
 *
 * Les mégaoctets sont la **source** ; les octets et le libellé s'en déduisent, pour qu'un changement
 * de plafond emporte du même geste ce que l'écran promet.
 */
export const AFFICHE_TAILLE_MAX_MO = 4;
/** Le plafond en octets — c'est lui que le serveur compare à la taille reçue. */
export const AFFICHE_TAILLE_MAX = AFFICHE_TAILLE_MAX_MO * 1024 * 1024;
/** Et le plafond tel qu'il s'écrit à l'écran, aides et refus compris : « 4 Mo ». */
export const AFFICHE_TAILLE_MAX_LIBELLE = `${AFFICHE_TAILLE_MAX_MO} Mo`;

/** Nom du cookie de session de connexion */
export const SESSION_COOKIE = "hema_session";
/**
 * Cookie de l'**élévation administrateur** : il ouvre l'espace admin, et lui seul. Sans `maxAge`
 * (cookie de session navigateur), il ne survit en principe pas à la fermeture de l'application — voir
 * `src/lib/auth/elevation.ts`.
 */
export const ELEVATION_COOKIE = "hema_admin";
/** Cookie temporaire entre le mot de passe et le code de double authentification (admins) */
export const DEUX_FA_COOKIE = "hema_2fa";
export const DUREE_DEUX_FA_MS = 10 * 60 * 1000;
/**
 * Cookie temporaire mémorisant la page demandée avant la connexion (« suite ») : la personne
 * arrivée par un bouton d'email repasse souvent par sa boîte mail (lien personnel) avant de
 * revenir, et l'URL de départ serait alors perdue.
 */
export const SUITE_COOKIE = "hema_suite";
export const DUREE_SUITE_MS = 30 * 60 * 1000;

/** Durées (en millisecondes) */
/**
 * **Une session dure 12 h, « Rester connecté » ou non**.
 *
 * Elle durait 60 jours glissants : sur un téléphone perdu ou prêté, c'était deux mois d'accès
 * ouvert à qui le ramassait. Douze heures, c'est la journée : on entre le matin, on répond le soir,
 * et le lendemain on se reconnecte.
 *
 * **Ce qui rend ce raccourcissement supportable, c'est que se reconnecter ne coûte rien** : le lien
 * personnel collé dans l'application est gardé sur l'appareil (voir `LIEN_MEMORISE`,
 * src/lib/lien-memorise.ts), et l'écran de connexion le propose d'un seul bouton. Sans cette
 * mémoire, douze heures serait une punition ; avec, c'est un geste par jour.
 *
 * « Rester connecté » ne change donc plus la durée — il ne décide plus que du cookie : coché, il
 * survit à la fermeture du navigateur ; décoché, il meurt avec lui.
 */
export const DUREE_SESSION_LONGUE_MS = 12 * 60 * 60 * 1000;
export const DUREE_SESSION_FORTE_MS = 12 * 60 * 60 * 1000; // admin (mot de passe + 2FA) : 12 h, sans prolongation
/**
 * Durée maximale d'une **élévation administrateur**, plafond par-dessus la fermeture de
 * l'application : un navigateur laissé ouvert trois jours ne garde pas les réglages ouverts.
 */
export const DUREE_ELEVATION_MS = DUREE_SESSION_FORTE_MS;
/**
 * **Inactivité qui referme l'espace admin : 10 min.** Le cookie d'élévation n'a pas d'échéance —
 * il devrait donc mourir avec le navigateur —, mais Chrome (« Continuer là où vous vous êtes
 * arrêté »), Android et les applications installées (PWA) **restaurent** les cookies de session au
 * redémarrage : la promesse « fermer l'application ferme l'espace admin » ne tenait pas sur les
 * appareils où l'on s'en sert vraiment. Cette échéance-ci, elle, vit côté serveur
 * (`AuthSession.elevationVueLe`) et ne dépend d'aucun navigateur.
 *
 * **Pourquoi dix minutes et non trente :** sur un téléphone posé sur une table ou prêté, une
 * demi-heure laissait l'espace admin ouvert bien trop longtemps ; dix minutes, c'est le délai au
 * bout duquel on considère que la personne a lâché l'écran.
 */
/**
 * **Où atterrit quelqu'un dont l'espace admin vient de se refermer tout seul.**
 *
 * Un seul chemin pour les trois façons d'en sortir sans l'avoir demandé — le minuteur d'inactivité,
 * le retour après une absence, et le clic qui arrive après l'une ou l'autre : c'est la même chose
 * qui s'est passée, il n'y a donc qu'un endroit où l'on revient et qu'une phrase à lire. Le `?admin`
 * n'est là que pour cette phrase (voir l'accueil) ; il n'ouvre et ne ferme rien.
 */
export const ACCUEIL_ELEVATION_REFERMEE = "/?admin=expire";

export const DUREE_INACTIVITE_ELEVATION_MS = 10 * 60 * 1000;
/**
 * **Temps toléré hors de l'application avant que l'espace admin se referme : 2 min**.
 *
 * Le navigateur prévient quand la page passe en arrière-plan — mais il envoie **exactement le même
 * signal** quand on change simplement de page dans l'application (elle passe cachée le temps de la
 * navigation). Fermer sur-le-champ redemandait donc mot de passe et code en plein travail. D'où ce
 * délai : l'application qui revient (page suivante, retour au premier plan) annule la sortie ; celle
 * qui ne revient pas la laisse expirer.
 */
export const GRACE_SORTIE_ELEVATION_MS = 2 * 60 * 1000;
export const DUREE_REAUTH_MS = 10 * 60 * 1000; // ré-authentification 2FA valable 10 min pour les actions sensibles
export const DUREE_RESET_MS = 30 * 60 * 1000; // lien "mot de passe oublié" : 30 min

export const MOT_DE_PASSE_MIN = 10;

/**
 * **La part de l'effectif livrée avec le code : 20 %.**
 *
 * En dessous de cette part des invités du trimestre, un cours ne vaut guère la peine d'ouvrir la
 * salle. C'est le repère de l'alerte « peu de monde » envoyée aux instructeurs, du trait tracé sur
 * la jauge et sur la frise, et du palier écrit sur chaque carte de cours — un seul repère, au même
 * endroit pour tout le monde.
 *
 * **Pourquoi une part et non un nombre de personnes** : le réglage valait 4 *personnes*, et un
 * nombre fixe ne peut pas servir deux clubs. Dans un club de quatre-vingts, « 4 présents » n'arrive
 * jamais : l'alerte ne serait jamais partie, le trait de la jauge restait collé tout en bas, et une
 * carte affichait « 19 présents sur 80 · 24 % » à côté d'un badge « Bien rempli » — le chiffre et
 * son commentaire ne racontaient plus la même histoire. Monter ce nombre à 16 pour ce club-là
 * aurait éteint tous les cours d'un club de douze. Une part s'adapte d'elle-même à l'effectif, et
 * ne se règle donc **qu'une fois**.
 *
 * Le nombre de personnes qui en découle se calcule par `seuilEnPersonnes` (`src/lib/presences.ts`),
 * qui porte aussi le **plancher de quatre personnes** : sous quatre, il n'y a pas de cours, quel que
 * soit l'effectif du club.
 *
 * Elle reste **ici** et non dans `src/lib/identite.ts` pour la raison décrite au-dessus des deux
 * logos livrés : des composants **client** (la jauge, la frise, les fiches de l'accueil) tracent ce
 * trait, et `identite.ts` entraînerait `node:crypto` dans leur bundle. Ce fichier-ci ne dépend de
 * rien. Les composants reçoivent d'ailleurs la part **en propriété** depuis leur appelant serveur —
 * seule la valeur livrée se lit des deux côtés.
 */
export const PART_EFFECTIF_LIVREE = 20;

/**
 * **Le nom d'une partie se CALCULE, il ne se saisit plus**.
 *
 * « Cours 1 », « Cours 2 », « Cours 3 »… pour le cours lui-même ; « Option 1 », « Option 2 »… pour ce
 * qui se tient pendant le cours. **Deux séries, chacune numérotée dans sa nature** : le troisième
 * cours s'appelle « Cours 3 » même s'il est la cinquième ligne de la séance, et c'est ce qui rend le
 * nom prévisible dès qu'on ajoute une partie.
 *
 * Ce qui a disparu ce jour-là, et pourquoi :
 *
 * - **le champ texte.** Le titre était une donnée saisie, plafonnée à quarante signes, avertie d'être
 *   publiée, rattrapée par un module entier quand Échap l'annulait. Or personne n'a rien à écrire
 *   là : ce qui décrit un cours, ce sont ses **informations** — l'instructeur, le thème, le niveau, et
 *   désormais sa `description`. Un champ de saisie qui reçoit toujours la même valeur est un champ qui
 *   coûte un geste, une ligne d'avertissement et une occasion de se tromper pour rien ;
 * - **« Cours n°1 ».** Le « n° » ne disait rien de plus que le chiffre ;
 * - **« 1ère option ».** Une série numérotée n'a pas à écrire son premier rang autrement que les
 *   autres : c'était deux formes à produire, à reconnaître en SQL et à lire à l'écran, pour un seul
 *   objet. « Option 1 » se lit comme « Cours 1 », et les deux séries se ressemblent enfin.
 *
 * `rang` part de 1 (voir `rangsDansNature`). La colonne `SessionPartie.libelle` garde le résultat —
 * l'API publique, les emails et les embeds la lisent —, et `rangerParties` (src/lib/planning.ts) la
 * remet d'accord à chaque écriture.
 */
export function libellePartie(rang: number, estOption: boolean): string {
  return `${estOption ? "Option" : "Cours"} ${rang}`;
}

/**
 * Le libellé d'une partie de plus, dans la nature demandée : on compte ce que la séance porte **déjà**
 * de cette nature, et on prend le suivant. C'est un rang, pas une recherche de nom libre.
 */
export function prochainLibellePartie(parties: ReadonlyArray<{ estOption: boolean }>, estOption: boolean): string {
  return libellePartie(parties.filter((p) => p.estOption === estOption).length + 1, estOption);
}

/**
 * **Longueur d'une description de partie : 500 signes.**
 *
 * Le dépôt a déjà deux textes libres de ce genre : la proposition d'atelier (1 500 signes,
 * `atelierSchema`) et l'annonce d'événement (600, `DESCRIPTION_MAX`). Celle-ci est plus courte que
 * les deux, et pour une raison de place : une description d'atelier se lit **seule**, sur sa propre
 * fiche, alors que celle d'une partie s'affiche **en ligne** dans une carte de séance, sous le thème
 * et les encadrants, et se répète autant de fois que la séance compte de parties. Cinq cents signes,
 * c'est un vrai paragraphe — de quoi dire ce qu'on va travailler — et pas un article.
 *
 * Le serveur, lui, **refuse** au-delà (`texteCourt`, `casePlanningSchema`) — il ne coupe pas ; ici, c'est le `maxLength` du champ, qui
 * empêche d'écrire ce qui serait de toute façon coupé.
 */
export const PARTIE_DESCRIPTION_MAX = 500;

/**
 * **Les parties d'une séance sont des données, pas une liste figée.**
 *
 * Il y avait ici quatre valeurs (`MOITIE_1`, `MOITIE_2`, `OPTION_1`, `OPTION_2`) qui servaient de
 * **clé en base** : le nom de la partie *était* son identifiant (`@@unique([sessionId, partie])`).
 * Une séance ne pouvait donc avoir ni cinq parties, ni trois — et un club qui découpe ses cours
 * autrement n'avait pas d'issue. Chaque séance porte maintenant ses propres parties
 * (`SessionPartie` : `ordre`, `estOption`, et le `libelle` qui s'en déduit), en nombre libre.
 *
 * Ce qui reste ici, c'est **le modèle d'une séance neuve** : ce que le club met le plus souvent, et
 * rien de plus. Une constante du code, volontairement — pas un réglage de club : un club qui range
 * ses séances autrement le fait séance par séance, avec les mêmes gestes (ajouter, monter,
 * descendre, retirer) qu'il utilisera de toute façon ; un écran de réglage de plus se paierait en
 * complexité pour un geste qu'on fait une fois.
 */
/**
 * **Deux cours, et rien d'autre**.
 *
 * Le modèle en portait quatre — deux cours et deux options —, héritage des quatre cases figées de la
 * grille d'avant le 29/09. Résultat : **toute** séance naissait avec deux options vides que personne
 * ne remplissait, et une case vide ne dit rien d'autre que « il manque quelque chose ».
 *
 * Les options ne disparaissent pas : elles s'**ajoutent** quand il y en a (« Ajouter une option »,
 * `AjouterPartie`), et un atelier retenu s'en crée une au besoin (`placerAtelier`). Le modèle décrit
 * donc ce qu'une séance a **toujours** — deux cours — et non ce qu'elle pourrait avoir.
 */
export const PARTIES_MODELE = [
  { libelle: libellePartie(1, false), estOption: false },
  { libelle: libellePartie(2, false), estOption: false },
] as const;

/**
 * **`----------` : « rien ici, pas encore ».**
 *
 * Les quatre réglages d'une case disaient leur vide chacun à sa façon — « aucun », « aucun thème »,
 * « personne en second », « Indifférent » —, quatre formulations pour un seul état, dont une
 * (« Indifférent ») qui ressemblait à une décision alors qu'elle n'en est pas une. Une seule
 * écriture désormais, la même partout, et c'est elle qui décide de l'affichage : ce qui vaut
 * `----------` **n'existe pas** pour un membre — ni la valeur, ni son intitulé (voir `champsLus`).
 * L'encadrement, lui, voit les quatre champs, `----------` compris : c'est là qu'il remplit.
 *
 * **Un libellé d'affichage, jamais une donnée.** En base, rien ne change : chaîne vide pour le
 * thème, `null` pour les instructeurs, `INDIFFERENT` pour le niveau. Et l'entrée reste **en tête**
 * de chaque liste déroulante — c'est le choix par défaut, pas une entrée de plus glissée au milieu.
 */
export const LIBELLE_VIDE = "----------";

/**
 * **Niveau d'une case du planning** : un troisième réglage de l'encadrement, à côté de
 * l'instructeur et du thème, pour annoncer à qui s'adresse la partie.
 *
 * `INDIFFERENT` ouvre la liste parce que c'est le cas de l'immense majorité des cours — tout le
 * monde y est à sa place — et c'est aussi la valeur de départ en base (`SessionPartie.niveau`).
 * Elle s'y montre sous la forme `----------` (`libelleChoixNiveau`) et ne s'affiche **nulle part**
 * ailleurs : une mention qui ne distingue personne alourdirait chaque case
 * du planning, chaque fiche d'accueil et chaque récap du soir pour ne rien apprendre.
 *
 * Comme `PARTIES_MODELE` juste au-dessus, ces valeurs vivent ici et non en base : la grille du
 * planning est un composant **client**, et un module qui lirait un réglage y entraînerait
 * `node:crypto`.
 */
export const NIVEAUX = ["INDIFFERENT", "DEBUTANT", "INTERMEDIAIRE", "AVANCE"] as const;
export type Niveau = (typeof NIVEAUX)[number];

export const NIVEAU_LABELS: Record<Niveau, string> = {
  INDIFFERENT: "Indifférent",
  DEBUTANT: "Débutant",
  INTERMEDIAIRE: "Intermédiaire",
  AVANCE: "Avancé",
};

export const NIVEAU_DEFAUT: Niveau = "INDIFFERENT";

/**
 * Le niveau **tel qu'il s'offre dans la liste déroulante d'une case**. « Indifférent » y est devenu
 * `----------` : ce n'était pas un niveau parmi quatre mais l'absence de niveau, et lui donner un
 * mot laissait croire qu'on avait tranché quelque chose. `NIVEAU_LABELS` garde « Indifférent » pour
 * le journal d'audit, qui veut toujours un mot lisible.
 */
export function libelleChoixNiveau(n: Niveau): string {
  return n === NIVEAU_DEFAUT ? LIBELLE_VIDE : NIVEAU_LABELS[n];
}

/**
 * **Le niveau à montrer, ou `null` quand il n'y a rien à dire.** Un seul endroit décide de ce
 * silence : les six écrans qui affichent un thème appellent celui-ci, et aucun ne peut oublier la
 * règle dans son coin. `null` couvre les trois cas qui reviennent au même — « indifférent », champ
 * vide, et valeur inconnue écrite par une autre version : aucun n'apprend quoi que ce soit au
 * lecteur, et une valeur inconnue affichée telle quelle (« EXPERT ») serait une fuite de vocabulaire
 * technique dans l'interface.
 */
export function niveauAffiche(valeur: string | null | undefined): Niveau | null {
  const v = valeur ?? "";
  if (!v || v === NIVEAU_DEFAUT) return null;
  return (NIVEAUX as readonly string[]).includes(v) ? (v as Niveau) : null;
}

/** Libellé d'un niveau, valeur manquante ou inconnue comprise : le journal d'audit veut toujours un mot. */
export function libelleNiveau(valeur: string | null | undefined): string {
  return NIVEAU_LABELS[niveauAffiche(valeur) ?? NIVEAU_DEFAUT];
}

/** Thèmes proposés par défaut dans les cases du planning (liste modifiable dans Gestion → Réglages). */
export const THEMES_DEFAUT = [
  "Antrim Bata",
  "Bauernwehr",
  "Couteau",
  "Dague",
  "Dussack",
  "Épée et bocle",
  "Épée longue",
  "Hache de pas",
  "Lance",
  "Lutte",
  "Messer",
  "Montante",
  "Rapière",
  "Sidesword",
  "Sparring",
  "Viking",
] as const;

export const THEME_MAX = 60;

/*
 * Les **lieux habituels des cours** vivaient ici, avec les adresses postales des deux salles du club
 * pour lequel l'outil a été écrit. Ils sont devenus un réglage (`src/lib/lieux.ts`, écran
 * *Thèmes et lieux* de l'espace admin) : une constante ne pouvait pas servir un second club, et
 * l'adresse d'une salle n'a rien à faire dans un dépôt de code.
 */

/** Thèmes d'une séance (colonne `disciplines`, séparés par des virgules, alimentée par le planning). */
export function parseDisciplines(valeur: string | null | undefined): string[] {
  return (valeur ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

/* ────────────────────────────── Adresses de l'API publique ──────────────────────────────
 *
 * Les deux seules routes de l'application qui répondent **sans compte**. Leur chemin est écrit ici,
 * et non dans l'un des modules qui les servent, parce qu'il est **affiché à l'écran** (l'onglet
 * *À propos*, la page du canal *Site du club*) autant qu'il est servi : un chemin recopié à la main
 * dans un écran est un chemin qui finira par mentir. `src/lib/constants.ts` ne dépend de rien, il
 * s'importe donc depuis un composant client comme depuis une route.
 */

/** Les prochains cours du club (le plugin WordPress lit celle-ci). */
export const CHEMIN_API_PROCHAINES_SEANCES = "/api/public/prochaines-seances";

/**
 * Les **annonces courantes** du club : le cours de demain, les cours annulés, les événements
 * publiés — notification par notification, selon ce que le bureau a coché dans la matrice
 * (colonne « Site du club »). Voir `src/lib/api-publique.ts`.
 */
export const CHEMIN_API_ANNONCES = "/api/public/annonces";

/* ────────────────────────────── Forme d'un webhook Discord ──────────────────────────────
 *
 * **Une règle, une écriture.** Deux endroits posent la même question — le champ de l'espace admin
 * (`webhookDiscordSchema`, `src/lib/validation/gestion.ts`) et la variable de la stack
 * (`normaliserWebhookDiscord`, `src/lib/env.ts`) —, et ils l'ont longtemps posée en recopiant la
 * même expression. Une valeur refusée à l'écran mais acceptée par la stack, c'est une vérification
 * pour rien : c'est justement par la variable de stack qu'une URL mal recopiée est arrivée jusqu'à
 * `fetch()`, dont le `TypeError` reprenait le jeton porteur dans son message.
 *
 * Pourquoi **ici** et pas dans `env.ts` : `env.ts` est une feuille chargée partout, et
 * `validation/gestion.ts` tire `@/lib/blasons` et `./auth` — l'un ne peut pas importer l'autre sans
 * entraîner tout un pan du serveur dans un bundle client. `constants.ts`, lui, ne dépend de rien.
 */
export const FORME_WEBHOOK_DISCORD = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;
