import { CLES, getSetting, setSetting } from "@/lib/settings";
// La fenêtre de l'alerte « peu de monde » se lit là où elle est définie (module pur, sans base) :
// la phrase du panneau ne recopie pas « 3 jours ».
import { HORIZON_ALERTE_EFFECTIF } from "./planification";

/**
 * Réglages du panneau « Notifications » (Gestion → Réglages).
 *
 * Tout est rangé dans **une seule clé JSON** de la table `Setting` (`CLES.notifications`) :
 * aucune migration Prisma, et une valeur absente ou illisible retombe sur `preferencesDefaut()`,
 * qui reproduit exactement le comportement d'avant ce réglage (les emails qui partaient partent encore).
 *
 * **Deux niveaux, jamais mélangés** :
 *
 * 1. **côté club** — la matrice notification × canal ci-dessous, réglée par le bureau
 *    (`Setting`, écran `/admin/notifications`) : elle décide de ce que le club envoie ;
 * 2. **côté personne** — `User.preferencesNotifications`, un JSON par type
 *    (`{ "recap_veille": false, … }`) réglé depuis « Mon profil » : il décide de ce que chacun
 *    accepte encore de recevoir.
 *
 * **Règle de composition (ET logique, jamais OU)** : une personne peut seulement **refuser** ce que le
 * club envoie, jamais s'ajouter ce que le club a coupé. Le club décide d'abord, la personne retranche
 * ensuite — voir `destinataireRetenu`, qui est le seul endroit où les deux niveaux se rencontrent.
 *
 * Point de passage unique côté serveur :
 * - `canalActif(canal)` — l'interrupteur général d'un canal ;
 * - `notificationActive(type, canal)` — la case d'une notification sur un canal (canal coupé ⇒ toujours faux) ;
 * - `destinataireRetenu(...)` — ajoute la préférence individuelle du membre (son JSON, à défaut la case
 *   historique `User.rappelEmail`) et **écarte en silence les personnes sans adresse email**
 *   (l'adresse est facultative).
 *
 * Les **messages d'accès et de sécurité** (lien personnel, nouvel appareil, mot de passe oublié, alertes
 * de sécurité aux administrateurs — `src/lib/alertes.ts`, `src/lib/invitations.ts`, `src/actions/auth.ts`)
 * ne passent volontairement pas par ce module : ils ne se refusent d'aucun des deux côtés, car ils portent
 * l'accès au compte ou la sécurité. Voir `NOTIFICATIONS_TOUJOURS_ENVOYEES`.
 *
 * ## Deux natures de canaux, et il ne faut jamais les confondre
 *
 * - **Les canaux d'envoi** (email, téléphone, Discord, Telegram, WhatsApp) : l'application **pousse**
 *   un message vers quelqu'un ou vers un salon. Ils ont une file d'attente, un journal
 *   (`NotificationLog`), des clés de déduplication, des reprises sur échec.
 * - **Les canaux d'exposition** (`api`, « Site du club ») : l'application **n'envoie rien du tout**.
 *   Elle laisse une porte ouverte, et quelqu'un vient lire — voir {@link CANAUX_EXPOSITION}.
 */

export const CANAUX = ["email", "push", "discord", "telegram", "whatsapp", "api"] as const;
export type Canal = (typeof CANAUX)[number];

export const LIBELLES_CANAUX: Record<Canal, string> = {
  email: "Email",
  push: "Téléphone",
  discord: "Discord",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  // **« Site du club » et non « API publique »** : la case est cochée par un bénévole du bureau, qui
  // sait ce qu'est le site du club et n'a aucune raison de savoir ce qu'est une API. Le mot
  // « partage » était pris — les *pages de partage* (`/partage/seance/<id>`) sont un lien qu'on
  // envoie à la main, pas une porte que le site du club lit toute seule.
  api: "Site du club",
};

/* ────────────────────────────── Canaux d'exposition ──────────────────────────────
 *
 * **`api` n'envoie rien. Rien ne part. Quelqu'un vient lire.**
 *
 * C'est la différence à garder en tête avant de brancher ce canal où que ce soit, et elle a des
 * conséquences très concrètes : **aucune** des mécaniques du dossier ne le concerne.
 *
 * - pas de **file d'attente** ni de reprise : il n'y a pas d'envoi à retenter ;
 * - pas de `journaliser` / `marquerEchec` : il n'y a ni succès ni échec à noter — la route répond,
 *   ou ne répond pas, et c'est le journal du serveur web qui le raconte ;
 * - pas de **clé de déduplication** : rien ne « part deux fois ». Le site lit cent fois par jour s'il
 *   veut, il lit à chaque fois l'état **actuel** de la base ;
 * - pas de {@link destinataireRetenu} : il n'y a **pas de destinataire**. Un refus personnel
 *   (« je ne veux plus du récap ») ne veut rien dire ici : le site du club n'écrit à personne, et ce
 *   qu'il publie ne nomme personne. La fonction rend donc `false` pour ce canal, exprès.
 *
 * Ce qui décide, à la place, c'est **deux portes** : la publication doit être ouverte
 * (`isPublicApiEnabled`, la case « Publier les prochains cours ») **et** la case de la notification
 * doit être cochée ici. Voir `src/app/api/public/annonces/route.ts`.
 *
 * **Ne branchez jamais un canal d'exposition dans une boucle d'envoi.** `envoiPossible`
 * (`canaux.ts`) rend `false` pour lui, et un test vérifie qu'aucun module d'envoi ne le nomme.
 */
export const CANAUX_EXPOSITION = ["api"] as const;
export type CanalExposition = (typeof CANAUX_EXPOSITION)[number];

/** Ce canal se contente-t-il d'**exposer** (rien ne part, quelqu'un vient lire) ? */
export function estCanalExposition(canal: Canal): canal is CanalExposition {
  return (CANAUX_EXPOSITION as readonly string[]).includes(canal);
}

export const TYPES_NOTIFICATION = [
  "recap_veille",
  "rappel_sans_reponse",
  "seance_annulee",
  "effectif_faible",
  "atelier_statut",
  "evenement_nouveau",
  "periode_suivante",
  "periode_non_activee",
] as const;
export type TypeNotification = (typeof TYPES_NOTIFICATION)[number];

/**
 * Couples (notification × canal) qui ont un sens : les autres n'apparaissent ni en base, ni à l'écran.
 * Les messages **collectifs** (récap, annulation, effectif faible) ont les colonnes de salon ; les
 * messages **personnels** (rappel à une personne sans réponse, réponse à une proposition d'atelier)
 * restent l'email et le téléphone : ils nomment quelqu'un, et le salon Discord comme le groupe
 * WhatsApp sont publics.
 *
 * **La colonne « Site du club » (`api`) est la plus étroite des six**, et c'est voulu : un salon se
 * lit par les gens du club, une page web se lit par n'importe qui, indéfiniment, et Google la garde.
 * Trois notifications seulement y ont leur case — celles dont le contenu **est déjà** une annonce
 * publique. Les raisons de chaque absence sont dans {@link RAISON_API_EXCLUE}, affichées à l'écran.
 */
export const CANAUX_PAR_NOTIFICATION: Record<TypeNotification, readonly Canal[]> = {
  // « Le cours de demain » : la définition même de ce qu'un site de club affiche.
  recap_veille: ["email", "push", "discord", "telegram", "whatsapp", "api"],
  rappel_sans_reponse: ["email", "push"],
  // « Le cours de jeudi n'aura pas lieu » : c'est l'information qui évite un déplacement pour rien,
  // et elle vaut d'autant plus pour qui ne lit ni le salon ni ses emails.
  seance_annulee: ["email", "push", "discord", "telegram", "whatsapp", "api"],
  effectif_faible: ["email", "push", "discord", "telegram", "whatsapp"],
  atelier_statut: ["email", "push"],
  // Nouvel événement : email aux membres des périodes actives et annonce sur le salon. Pas de
  // WhatsApp tant que l'envoi automatique n'existe pas (le partage manuel reste possible).
  // Le site du club, si : un stage annoncé au club a vocation à être vu, et l'annonce est déjà
  // publique (elle a sa page de partage).
  evenement_nouveau: ["email", "push", "discord", "telegram", "api"],
  // Affaire de bureau : la période suivante se crée entre administrateurs. Rien sur le salon —
  // annoncer au club qu'il n'a pas de trimestre après le 31 décembre n'aide personne.
  periode_suivante: ["email", "push"],
  // Même famille, même raison : « personne n'a appuyé sur Activer » est un oubli de bureau, pas une
  // nouvelle du club.
  periode_non_activee: ["email", "push"],
};

/**
 * **Pourquoi telle notification n'a pas de case « Site du club ».**
 *
 * La raison est affichée à l'écran telle quelle, comme celles de {@link RAISON_ROUTAGE_FIXE} : un
 * réglage absent sans explication passe pour un oubli, et quelqu'un finit par l'« ajouter ».
 *
 * Deux familles, deux raisons :
 *
 * 1. **`effectif_faible` — le point à ne pas rater.** « Peu de monde annoncé » est une alerte **aux
 *    instructeurs** : un appel à décider s'il faut annuler, pas une nouvelle du club. Ce qu'elle porte
 *    et qui n'a rien à faire sur une page web, c'est son **lien d'annulation signé au nom de son
 *    destinataire** — une clé, pas une information. **Ce que cette exclusion ne protège pas,
 *    contrairement à ce qui était écrit ici** : le **taux** du cours. Il sort déjà, et légitimement —
 *    par le récap de la veille dès que sa case est cochée, et par `prochaines-seances` pour les cours
 *    à venir. Prétendre que publier l'alerte révélerait « qu'un cours se remplit mal » était donc
 *    faux, et une raison fausse finit par servir d'argument à quelqu'un. Ce qu'on refuse, c'est d'en
 *    faire un **titre** : « Peu de monde » écrit en tête d'une page indexée n'est pas le même geste
 *    qu'un pourcentage affiché à côté d'un cours. C'est déjà la raison pour laquelle sa case Discord
 *    est décochée par défaut (`preferencesDefaut`) et pour laquelle elle n'est pas routable vers la
 *    liste. Une case ne doit pas pouvoir défaire ce choix.
 * 2. **Tout ce qui nomme quelqu'un** (`rappel_sans_reponse`, `atelier_statut`) ou **ne regarde que le
 *    bureau** (`periode_suivante`, `periode_non_activee`) : sans discussion. Le dossier n'a qu'une
 *    garantie, et c'est celle-là — aucun nom ne sort du club, jamais.
 */
export const RAISON_API_EXCLUE: Partial<Record<TypeNotification, string>> = {
  rappel_sans_reponse: "Ce message s'adresse à une personne précise, qui n'a pas encore répondu. Un site web ne réclame pas une réponse à quelqu'un, et le nom de cette personne ne sort pas du club.",
  effectif_faible:
    "C'est une alerte aux instructeurs — « faut-il annuler ? » —, pas une nouvelle du club. Elle porte un lien d'annulation signé au nom de son destinataire, qui n'a rien à faire sur une page web ; et le taux du cours, lui, se publie déjà avec le cours. Ce qu'on refuse ici, c'est d'en faire un titre.",
  atelier_statut: "Réponse à une proposition : le message nomme son auteur et répond à son écrit. Il n'a rien à faire sur une page publique.",
  periode_suivante: "Affaire de bureau : « le trimestre suivant n'existe pas encore » est un oubli d'administrateur, pas une information pour les visiteurs du site.",
  periode_non_activee: "Même famille, même raison : « personne n'a appuyé sur Activer » ne regarde que le bureau.",
};

/**
 * Couples réellement émis aujourd'hui par le code (récap de la veille : `notifications/recap.ts` ;
 * rappels sans réponse : `notifications/rappels.ts` ; annulation et effectif faible :
 * `notifications/seances.ts`). Les autres sont des réglages d'avance : l'interface les annonce
 * comme « prévu » tant que l'envoi correspondant n'existe pas — c'est le cas de WhatsApp, qui
 * attend un service d'envoi (`notifications/whatsapp.ts`).
 *
 * Le canal `api` y figure pour les trois notifications qui ont une case : la route
 * `GET /api/public/annonces` les rend **aujourd'hui**, il n'y a rien à attendre. Le mot « émis » est
 * un raccourci pour lui — rien ne part, la porte est simplement ouverte (voir
 * {@link CANAUX_EXPOSITION}) — mais c'est bien la même question que l'écran pose : « est-ce que ça
 * marche vraiment, ou est-ce un réglage d'avance ? »
 */
export const COUPLES_EMIS: Record<TypeNotification, readonly Canal[]> = {
  recap_veille: ["email", "push", "discord", "telegram", "api"],
  rappel_sans_reponse: ["email", "push"],
  seance_annulee: ["email", "push", "discord", "telegram", "api"],
  effectif_faible: ["email", "push", "discord", "telegram"],
  atelier_statut: ["email", "push"],
  evenement_nouveau: ["email", "push", "discord", "telegram", "api"],
  periode_suivante: ["email", "push"],
  periode_non_activee: ["email", "push"],
};

export type DescriptionNotification = {
  /** Intitulé court de la ligne */
  titre: string;
  /** Qui reçoit quoi et quand, en une phrase — affichée telle quelle sous le titre */
  quand: string;
};

/**
 * **Aucune de ces phrases n'écrit un nombre de personnes** : elles énoncent la règle.
 *
 * `effectif_faible` annonçait « un cours comptant moins de **4** présents » — le 4 du vieux réglage
 * en nombre absolu, resté en dur dans un texte livré, alors que le seuil est **calculé** depuis la
 * part de l'effectif réglée par le club (`Identite.partEffectifMin`) et l'effectif invité de la
 * période concernée (`seuilEnPersonnes`, `src/lib/presences.ts`). Le bureau d'un club de 80 réglait
 * sa part sur l'écran Club, qui lui disait « 20 % de 80 invités, soit **16** personnes — jamais
 * moins de 4 », puis lisait deux onglets plus loin « moins de **4** présents ». Et cette phrase
 * s'affiche sur quatre écrans (`/admin/notifications`, `…/email`, `…/push`, la fiche membre) plus le
 * profil de **chaque instructeur**, via `lignesNotificationsMembre`.
 *
 * Ces phrases sont des constantes, sans base ni club sous la main : elles ne peuvent donc pas
 * afficher le nombre du club. La règle du dossier (« un réglage exprimé en nombre absolu ne s'adapte
 * pas à la taille du club ») laisse exactement deux issues — composer la phrase depuis la règle, ou
 * **dire la règle sans chiffre**. C'est la seconde qui est retenue ici, et le nombre en personnes se
 * lit là où il a un sens : sur l'écran Club, qui le montre, et dans le pied de l'alerte elle-même,
 * qui le calcule (`piedAlerteEffectif`, `src/lib/email/templates/seances.ts`).
 *
 * La **fenêtre** se compose, elle, depuis sa constante (`HORIZON_ALERTE_EFFECTIF`) : c'est un nombre
 * de jours, pas un nombre de personnes — il ne dépend d'aucun réglage de club, mais il n'a pas à
 * être recopié deux fois. `tests/unit/notifications-preferences.test.ts` relie les deux.
 */
export const REGLE_SEUIL_EFFECTIF = "dont l'effectif attendu (présents et moitié des « peut-être ») reste sous la part minimale réglée par le club";

export const DESCRIPTIONS: Record<TypeNotification, DescriptionNotification> = {
  recap_veille: {
    titre: "Récap de la veille",
    quand: "La veille de chaque cours, à l'heure réglée ci-dessus, aux membres inscrits Présent ou Peut-être (et sur le salon Discord).",
  },
  rappel_sans_reponse: {
    titre: "Rappel aux personnes sans réponse",
    quand: "Une semaine puis deux jours avant le cours, aux invités de la période qui n'ont pas encore répondu.",
  },
  seance_annulee: {
    titre: "Séance annulée",
    quand: "Dès l'annulation d'une séance, à tous les invités actifs de la période, et sur le salon Discord, avec la date et le motif.",
  },
  effectif_faible: {
    titre: "Alerte « peu de monde »",
    quand: `Chaque matin à 7h et avec les envois du soir, aux instructeurs, dans les ${HORIZON_ALERTE_EFFECTIF} jours qui précèdent un cours ${REGLE_SEUIL_EFFECTIF} — le nombre de personnes correspondant est affiché sur l'écran Club (sur le salon Discord seulement si la case est cochée).`,
  },
  atelier_statut: {
    titre: "Réponse à une proposition d'atelier",
    quand: "À la personne qui a proposé l'atelier, dès que l'équipe le place dans le planning ou le refuse.",
  },
  evenement_nouveau: {
    titre: "Nouvel événement",
    quand: "Quand un événement est publié (stage, tournoi, démonstration), aux membres des périodes actives, et sur le salon Discord. Une seule fois par événement.",
  },
  periode_suivante: {
    titre: "Période suivante à créer",
    quand: "Une semaine puis deux jours avant la fin d'un trimestre, aux administrateurs, tant que la période suivante n'a pas été créée.",
  },
  periode_non_activee: {
    titre: "Période à activer",
    quand: "Trois jours puis un jour avant le premier cours d'une période restée en brouillon, aux administrateurs : sans activation, aucun lien personnel ne part.",
  },
};

/**
 * Notifications personnelles qui partent toujours : accès au compte et sécurité. Elles sont affichées
 * en lecture seule dans le panneau (rien à décocher), car les couper enfermerait les gens dehors :
 * sans lien personnel, sans email de nouvel appareil ni de mot de passe oublié, plus personne ne peut
 * entrer ni signaler un accès volé.
 */
export const NOTIFICATIONS_TOUJOURS_ENVOYEES: readonly DescriptionNotification[] = [
  { titre: "Alertes de sécurité", quand: "Aux administrateurs, par email et sur le téléphone, quand un lien personnel est révoqué automatiquement ou qu'une vague de liens inconnus est détectée." },
  { titre: "Lien d'accès personnel", quand: "À la personne concernée, par email seulement : invitation, renouvellement du lien de 4 mois, remplacement après un incident de sécurité." },
  { titre: "Nouvel appareil", quand: "À la personne concernée, par email et sur ses autres appareils, quand son lien ouvre une session sur un appareil de plus." },
  { titre: "Mot de passe oublié", quand: "Au compte de connexion du portail qui en fait la demande." },
];

/**
 * Types de **rappel** : ceux dont la case historique du profil (`User.rappelEmail`) tient lieu de choix
 * tant que la personne n'a rien réglé finement. C'est la reprise de l'existant : quelqu'un qui avait
 * coupé ses rappels (case décochée, ou lien de désinscription en pied d'email) reste coupé.
 */
export const RESPECTE_RAPPEL_EMAIL: readonly TypeNotification[] = ["recap_veille", "rappel_sans_reponse"];

/**
 * Noms des cases du formulaire (Gestion → Réglages). Construits à partir des constantes ci-dessus :
 * aucune clé ne vient du client, la lecture du formulaire ne parcourt que des couples connus.
 */
export function champCanal(canal: Canal): string {
  return `canal_${canal}`;
}

/**
 * **Le témoin qui dit que l'écran a rendu ce canal RÉGLABLE**.
 *
 * Sans lui, le gel se décidait sur l'état des canaux **à l'instant de l'enregistrement**, alors que
 * le formulaire a été rendu **avant**. La faiblesse mesurée : on ouvre « Notifications » publication
 * fermée (les cases « Site du club » sont alors `disabled`, donc absentes de l'envoi), quelqu'un
 * d'autre — ou soi-même dans un autre onglet — **ouvre la publication**, et l'enregistrement de la
 * matrice **efface les trois cases** et l'interrupteur du canal, en silence. Aucun forgeage n'est
 * nécessaire : un onglet laissé ouvert suffit. Et le message de succès ne dit rien, puisque le canal
 * est opérationnel au moment de l'écriture.
 *
 * Le témoin tranche ce que le serveur ne pouvait pas savoir : **l'absence d'une case veut-elle dire
 * « décochée » ou « pas réglable » ?** Il est posé par l'écran à côté de chaque interrupteur de canal
 * réglable, et c'est lui — pas l'état du moment — qui décide du gel.
 */
export function champCanalRendu(canal: Canal): string {
  return `canal_${canal}_reglable`;
}

export function champNotification(type: TypeNotification, canal: Canal): string {
  return `notif_${type}_${canal}`;
}

/** Le choix « chacun le sien » / « la liste » d'une notification (groupe de boutons radio). */
export function champMode(type: TypeNotification): string {
  return `mode_${type}`;
}

export const CHAMP_ADRESSE_LISTE = "adresseListe";
export const CHAMP_QUOTA_JOUR = "quotaJour";

/* ──────────────────── « Chacun le sien » ou « la liste » (canal Email) ────────────────────
 *
 * **Le problème.** Un envoi par personne : dans un club de 80 membres avec deux cours par semaine,
 * le seul récap de la veille fait 160 emails par semaine. C'est au-dessus du quota d'un SMTP
 * gratuit, qui coupe **au milieu de la liste** — et les derniers ne reçoivent rien, en silence.
 *
 * **Le remède.** Chaque notification *d'information* peut être réglée en « chacun le sien » (l'état
 * historique, un email par personne) ou en « la liste » : **un** message à une adresse de
 * distribution unique, tenue par le serveur mail du club. C'est alors ce serveur qui gère les
 * arrivées et les départs — et c'est à dire, parce que cela a une conséquence honnête :
 *
 * > **En mode liste, les refus individuels ne s'appliquent plus.** L'application ne sait pas qui lit
 * > la liste ; elle ne peut donc plus retrancher personne. Quelqu'un qui a décoché « récap de la
 * > veille » dans son profil le recevra tant qu'il est abonné à la liste, et c'est au bureau de l'en
 * > retirer. L'écran de réglage le dit, et les guides doivent le redire.
 *
 * **Trois règles, non négociables.**
 *
 * 1. **Un message personnel ne peut jamais emprunter la liste.** Les emails d'accès et de sécurité
 *    (lien personnel, lien renouvelé, réinitialisation, mot de passe oublié, alertes de sécurité)
 *    ne sont d'ailleurs pas dans {@link TYPES_NOTIFICATION} : ils n'ont aucun réglage, donc aucun
 *    routage possible. La garde de second rideau est dans `src/lib/email/liste.ts`
 *    (`messageCollectif`), qui relit le contenu et refuse tout message porteur d'un jeton personnel.
 * 2. **Le routage est une propriété du message**, pas une préférence de canal : un gabarit est
 *    *collectif* ou *personnel*, et seuls les collectifs connaissent l'adresse de liste. Le réglage
 *    ci-dessous ne fait que choisir **lequel des deux gabarits** est employé.
 * 3. **Le téléphone ne change pas.** Le push reste personnel, hors quota, dans tous les modes : il
 *    ne coûte rien au SMTP, et c'est justement le canal qui permet de rester joignable
 *    individuellement quand l'email passe par la liste.
 */
export const MODES_ENVOI = ["individuel", "liste"] as const;
export type ModeEnvoi = (typeof MODES_ENVOI)[number];

/**
 * **« Par membre » et « Liste de distribution »**.
 *
 * C'était « Chacun le sien » et « La liste », suivis d'une parenthèse explicative dans la liste
 * déroulante — « (un email par personne) », « (un seul message) ». Deux tournures imagées qui
 * demandaient leur propre glose : dans une liste déroulante, l'étiquette doit se comprendre seule.
 * « Par membre » et « Liste de distribution » nomment la chose, et les parenthèses tombent — la
 * phrase d'aide sous le champ dit déjà, et mieux, ce qu'elles disaient (le nombre de destinataires
 * d'un côté, l'adresse visée de l'autre).
 */
export const LIBELLES_MODE: Record<ModeEnvoi, string> = {
  individuel: "Par membre",
  liste: "Liste de distribution",
};

/**
 * Les notifications **d'information** dont l'email peut être routé vers la liste : elles disent au
 * club ce qui se passe, elles ne s'adressent à personne en particulier et ne portent aucun jeton.
 */
export const TYPES_ROUTABLES: readonly TypeNotification[] = ["recap_veille", "rappel_sans_reponse", "seance_annulee", "evenement_nouveau"];

/**
 * Et pourquoi les autres ne le sont **jamais**. La raison est affichée à l'écran telle quelle : un
 * réglage absent sans explication passe pour un oubli, et quelqu'un finit par l'« ajouter ».
 */
export const RAISON_ROUTAGE_FIXE: Partial<Record<TypeNotification, string>> = {
  /*
   * **L'alerte « peu de monde » a été retirée des types routables.**
   *
   * Il n'existe qu'**une** adresse de liste, celle du club. Réglée sur « la liste », cette alerte
   * partait donc à tout le monde — en annonçant publiquement que le cours se remplit mal, et en
   * signant « envoyé à la liste d'encadrement », ce qui était faux. C'est exactement la raison pour
   * laquelle sa case Discord est décochée par défaut (voir `preferencesDefaut`) : un menu déroulant
   * ne doit pas pouvoir défaire ce choix.
   *
   * Une seconde adresse d'encadrement aurait tout le poids d'un réglage de plus — saisie,
   * validation, refus à l'enregistrement, ligne d'audit — pour un gain d'envois **nul** : l'alerte
   * ne vise que les deux ou trois personnes qui encadrent, et elle porte un lien d'annulation signé
   * qui ne peut de toute façon pas atterrir sur une adresse partagée.
   */
  effectif_faible:
    "Elle ne vise que les deux ou trois personnes qui encadrent, et elle annonce que le cours se remplit mal : sur la liste du club, ce serait une publication, pas une alerte. Son lien d'annulation est signé au nom de son destinataire, et une clé donnée à une liste est donnée à tous.",
  atelier_statut:
    "Réponse à une proposition : le message nomme son auteur et répond à son écrit. Le publier sur une liste, c'est afficher le refus d'une idée devant tout le club.",
  periode_suivante: "Affaire de bureau : deux ou trois destinataires. Une liste n'économiserait rien et noierait le club sous des rappels qui ne le regardent pas.",
  periode_non_activee: "Même famille, même raison : « personne n'a appuyé sur Activer » est un oubli de bureau, pas une nouvelle du club.",
};

export function estRoutable(type: TypeNotification): boolean {
  return TYPES_ROUTABLES.includes(type);
}

function estModeEnvoi(valeur: unknown): valeur is ModeEnvoi {
  return typeof valeur === "string" && (MODES_ENVOI as readonly string[]).includes(valeur);
}

/** Longueur maximale d'une adresse de liste (la limite des adresses email). */
export const ADRESSE_LISTE_MAX = 254;

/**
 * L'adresse de liste est **une** adresse, vérifiée comme telle : pas une liste de destinataires
 * séparés par des virgules (ce qui reproduirait le problème qu'on vient de résoudre, en pire — tous
 * les destinataires se verraient les uns les autres).
 *
 * Fonction pure, volontairement plus stricte que nécessaire sur la forme : l'écran d'administration
 * valide en plus avec Zod (même règle que les adresses des membres), et c'est ici la ceinture qui
 * protège les envois eux-mêmes.
 */
export function adresseListeValide(adresse: string): boolean {
  const v = adresse.trim();
  if (v === "" || v.length > ADRESSE_LISTE_MAX) return false;
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(v);
}

export type PreferencesNotifications = {
  canaux: Record<Canal, boolean>;
  notifications: Record<TypeNotification, Partial<Record<Canal, boolean>>>;
  /** Adresse de distribution du club, ou "" tant qu'aucune n'est réglée. */
  adresseListe: string;
  /** « Chacun le sien » ou « la liste », par notification (canal Email seulement). */
  modes: Record<TypeNotification, ModeEnvoi>;
  /**
   * Quota d'envois par jour **déclaré** par le club (celui de son SMTP), ou `null` s'il ne l'a pas
   * renseigné. Il ne limite rien : il sert à comparer le volume prévu à ce que le serveur accepte,
   * et à prévenir *avant* la coupure plutôt qu'après.
   */
  quotaJour: number | null;
};

/**
 * Valeurs par défaut (clé absente ou illisible). Elles sont **sûres** : tout ce qui part aujourd'hui
 * continue de partir. WhatsApp est éteint tant qu'aucun service d'envoi n'est branché.
 */
export function preferencesDefaut(): PreferencesNotifications {
  return {
    // Telegram part **coché** comme Discord : un canal non branché n'envoie rien de toute façon
    // (`canalOperationnel`), et un club qui colle son jeton n'a alors rien d'autre à faire.
    //
    // **Le site du club est dans le même cas, et pour la même raison** : l'interrupteur du canal est
    // coché, mais la publication reste fermée (`isPublicApiEnabled` vaut faux dans une base neuve) et
    // **aucune** de ses cases n'est cochée ci-dessous. Une base neuve, ou la base du club telle
    // qu'elle est aujourd'hui, ne publie donc rien de plus qu'avant — il faut deux gestes explicites :
    // ouvrir la publication, puis cocher une notification. Le laisser décoché aurait fait un troisième
    // geste, dans un écran qui en demande déjà deux.
    canaux: { email: true, push: true, discord: true, telegram: true, whatsapp: false, api: true },
    notifications: {
      recap_veille: { email: true, push: true, discord: true, telegram: true, whatsapp: false, api: false },
      rappel_sans_reponse: { email: true, push: true },
      seance_annulee: { email: true, push: true, discord: true, telegram: true, whatsapp: false, api: false },
      // L'alerte « peu de monde » annonce publiquement que le cours se remplit mal : sur Discord, elle
      // s'active à la main (case décochée par défaut), contrairement au récap et à l'annulation. Sur le
      // site du club, elle n'a pas de case du tout — voir `RAISON_API_EXCLUE`.
      effectif_faible: { email: true, push: true, discord: false, telegram: false, whatsapp: false },
      atelier_statut: { email: true, push: true },
      evenement_nouveau: { email: true, push: true, discord: true, telegram: true, api: false },
      periode_suivante: { email: true, push: true },
      periode_non_activee: { email: true, push: true },
    },
    // Rien ne change tant que le club n'a pas réglé d'adresse : « chacun le sien » partout, c'est
    // exactement le comportement d'avant ce réglage.
    adresseListe: "",
    modes: Object.fromEntries(TYPES_NOTIFICATION.map((type) => [type, "individuel" as ModeEnvoi])) as Record<TypeNotification, ModeEnvoi>,
    quotaJour: null,
  };
}

/**
 * Le quota, relu depuis n'importe quoi : un entier strictement positif, ou `null` (« non déclaré »).
 * Zéro vaut « non déclaré » — personne n'a un serveur qui refuse tout, et c'est la façon d'effacer
 * la valeur en vidant la case.
 */
function lireQuota(valeur: unknown): number | null {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return null;
  const entier = Math.floor(valeur);
  return entier > 0 ? entier : null;
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Relit la valeur stockée sans jamais lever : ce qui est illisible, inconnu ou d'un mauvais type
 * est simplement ignoré et remplacé par la valeur par défaut correspondante.
 */
export function lirePreferences(brut: string | null | undefined): PreferencesNotifications {
  const prefs = preferencesDefaut();
  if (!brut) return prefs;
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return prefs;
  }
  if (!estObjet(donnees)) return prefs;
  const canaux = estObjet(donnees.canaux) ? donnees.canaux : {};
  for (const canal of CANAUX) {
    if (typeof canaux[canal] === "boolean") prefs.canaux[canal] = canaux[canal];
  }
  const notifications = estObjet(donnees.notifications) ? donnees.notifications : {};
  for (const type of TYPES_NOTIFICATION) {
    const ligne = estObjet(notifications[type]) ? notifications[type] : {};
    for (const canal of CANAUX_PAR_NOTIFICATION[type]) {
      if (typeof ligne[canal] === "boolean") prefs.notifications[type][canal] = ligne[canal];
    }
  }
  if (typeof donnees.adresseListe === "string" && adresseListeValide(donnees.adresseListe)) prefs.adresseListe = donnees.adresseListe.trim();
  const modes = estObjet(donnees.modes) ? donnees.modes : {};
  for (const type of TYPES_NOTIFICATION) {
    // Un type non routable n'a pas de mode : même si la base prétend le contraire (valeur écrite à
    // la main, ou type devenu non routable depuis), il reste en « chacun le sien ».
    if (!estRoutable(type)) continue;
    if (estModeEnvoi(modes[type])) prefs.modes[type] = modes[type];
  }
  prefs.quotaJour = lireQuota(donnees.quotaJour);
  return prefs;
}

/** Forme canonique à écrire en base : uniquement les canaux connus et les couples qui ont un sens. */
export function normaliserPreferences(prefs: PreferencesNotifications): PreferencesNotifications {
  const defaut = preferencesDefaut();
  const sortie: PreferencesNotifications = {
    canaux: { ...defaut.canaux },
    notifications: { ...defaut.notifications },
    adresseListe: adresseListeValide(prefs.adresseListe ?? "") ? (prefs.adresseListe ?? "").trim() : "",
    modes: { ...defaut.modes },
    quotaJour: lireQuota(prefs.quotaJour),
  };
  for (const canal of CANAUX) sortie.canaux[canal] = prefs.canaux?.[canal] === true;
  for (const type of TYPES_NOTIFICATION) {
    const ligne: Partial<Record<Canal, boolean>> = {};
    for (const canal of CANAUX_PAR_NOTIFICATION[type]) ligne[canal] = prefs.notifications?.[type]?.[canal] === true;
    sortie.notifications[type] = ligne;
    // Seul un type routable peut porter autre chose que « individuel » : la forme écrite en base ne
    // garde donc aucune trace d'un mode interdit, et personne ne peut le « réactiver » plus tard.
    const mode = prefs.modes?.[type];
    sortie.modes[type] = estRoutable(type) && estModeEnvoi(mode) ? mode : "individuel";
  }
  return sortie;
}

/**
 * Les notifications réglées sur « la liste » alors qu'aucune adresse n'est renseignée (fonction pure).
 *
 * L'enregistrement les **refuse** — un réglage qui ne peut pas s'appliquer doit se dire au moment où
 * on le pose, pas se découvrir trois semaines plus tard en constatant que le récap part toujours en
 * quatre-vingts exemplaires.
 */
export function typesSansAdresseDeListe(prefs: PreferencesNotifications): TypeNotification[] {
  if (adresseListeValide(prefs.adresseListe)) return [];
  return TYPES_NOTIFICATION.filter((type) => estRoutable(type) && prefs.modes[type] === "liste");
}

/**
 * **Le mode réellement appliqué** à l'envoi par email d'une notification (fonction pure).
 *
 * Deux garde-fous, dans cet ordre :
 *
 * 1. un type non routable est toujours « chacun le sien », quoi que dise la base ;
 * 2. **sans adresse valide, on retombe sur « chacun le sien »** plutôt que de ne rien envoyer.
 *    Le cas est déjà impossible (l'enregistrement le refuse) ; s'il survenait quand même, mieux vaut
 *    dépasser un quota que laisser quatre-vingts personnes sans nouvelle de leur cours — et l'écran
 *    annonce le volume, donc l'anomalie se voit.
 */
export function modeEnvoiDans(prefs: PreferencesNotifications, type: TypeNotification): ModeEnvoi {
  if (!estRoutable(type)) return "individuel";
  if (prefs.modes[type] !== "liste") return "individuel";
  return adresseListeValide(prefs.adresseListe) ? "liste" : "individuel";
}

/** Raccourci de lecture : cet envoi par email part-il en **un seul** message sur la liste ? */
export function envoiCollectifDans(prefs: PreferencesNotifications, type: TypeNotification): boolean {
  return modeEnvoiDans(prefs, type) === "liste";
}

/**
 * L'adresse à employer pour un envoi collectif, ou `null`. Passer par ici plutôt que de lire
 * `prefs.adresseListe` garantit qu'aucun appelant ne peut expédier à la liste un type qui n'a pas le
 * droit d'y aller : le type est revérifié à chaque fois.
 */
export function adresseListePour(prefs: PreferencesNotifications, type: TypeNotification): string | null {
  return envoiCollectifDans(prefs, type) ? prefs.adresseListe : null;
}

/**
 * **Un canal qui ne peut rien faire n'est pas réglable : ses cases sont figées** (fonction pure).
 *
 * L'écran rend `disabled` les cellules d'un canal non opérationnel (aucun salon branché, publication
 * du site fermée…). Or une case `disabled` **n'est pas envoyée** par le navigateur : elle n'exprime
 * aucune décision, ni « cochée » ni « décochée ». On reprend donc la valeur d'**avant** pour ces
 * couples — exactement ce que l'enregistrement fait déjà de l'adresse de liste et du quota, absents
 * du même formulaire.
 *
 * **La garde d'origine tient toujours, et par construction** : la valeur retenue ne vient pas du
 * client, donc une case grisée cochée de force n'allume rien. Ce qui s'y ajoute, c'est l'inverse —
 * enregistrer la matrice ne peut plus **effacer** ce qu'on n'a pas eu le droit de toucher. Sans
 * cela, fermer la publication du site puis enregistrer la matrice vidait en silence les trois cases
 * « Site du club », alors que l'écran promet qu'elles reprennent effet à la réouverture ;
 * débrancher un salon Discord effaçait ses cases de la même façon. Le piège était d'autant plus
 * discret que l'écran a **deux** façons de griser une cellule aux conséquences alors opposées :
 * l'interrupteur du canal décoché grise en CSS (valeur conservée), un canal non opérationnel grise
 * en `disabled` (valeur perdue).
 *
 * `figes` ne liste que les canaux dont il y a **quelque chose à dire** : une case au moins y reste
 * cochée sans pouvoir rien faire. Un canal éteint de partout n'a pas à encombrer le message.
 */
export function figerCanauxIndisponibles(
  avant: PreferencesNotifications,
  apres: PreferencesNotifications,
  /**
   * Les canaux que **l'écran a rendus réglables** (ses témoins, voir {@link champCanalRendu}) — et
   * non ceux qui sont opérationnels maintenant : entre le rendu du formulaire et son envoi, un canal
   * a pu être branché par quelqu'un d'autre, et ses cases absentes seraient alors prises pour des
   * décisions. **Aucun témoin du tout** veut dire « formulaire d'une version antérieure » : on
   * retombe sur l'état du moment, comme avant, plutôt que de tout geler et de ne rien enregistrer.
   */
  reglables: Partial<Record<Canal, boolean>>,
): { prefs: PreferencesNotifications; figes: Canal[] } {
  const ancien = normaliserPreferences(avant);
  const sortie = normaliserPreferences(apres);
  const figes: Canal[] = [];
  for (const canal of CANAUX) {
    if (reglables[canal] === true) continue;
    sortie.canaux[canal] = ancien.canaux[canal] === true;
    for (const type of TYPES_NOTIFICATION) {
      if (canal in sortie.notifications[type]) sortie.notifications[type][canal] = ancien.notifications[type][canal] === true;
    }
    if (TYPES_NOTIFICATION.some((t) => sortie.notifications[t][canal])) figes.push(canal);
  }
  /*
   * **Un couple que le code n'émet pas se fige aussi, canal opérationnel ou non**. L'écran grise
   * désormais ces cases — et une case grisée est **absente du formulaire**, donc lue « décochée »
   * par le serveur. Sans ce second passage, brancher un jour le service WhatsApp sans écrire
   * l'envoi correspondant ferait effacer ses cases au premier enregistrement, en silence ; et tant
   * qu'il n'est pas branché, c'est la boucle ci-dessus qui les tient — deux raisons de les figer,
   * une seule règle : **une case grisée n'exprime aucune décision**, ni dans un sens ni dans
   * l'autre.
   */
  for (const type of TYPES_NOTIFICATION) {
    for (const canal of CANAUX) {
      if (COUPLES_EMIS[type].includes(canal)) continue;
      if (canal in sortie.notifications[type]) sortie.notifications[type][canal] = ancien.notifications[type][canal] === true;
    }
  }
  return { prefs: sortie, figes };
}

export function serialiserPreferences(prefs: PreferencesNotifications): string {
  return JSON.stringify(normaliserPreferences(prefs));
}

/** Interrupteur général d'un canal (fonction pure). */
export function canalActifDans(prefs: PreferencesNotifications, canal: Canal): boolean {
  return prefs.canaux[canal] === true;
}

/**
 * Une notification peut-elle partir sur ce canal ? (fonction pure)
 * Faux dès que le canal est coupé, que le couple n'a pas de sens, ou que la case est décochée.
 */
export function notificationActiveDans(prefs: PreferencesNotifications, type: TypeNotification, canal: Canal): boolean {
  if (!CANAUX_PAR_NOTIFICATION[type].includes(canal)) return false;
  if (!canalActifDans(prefs, canal)) return false;
  return prefs.notifications[type]?.[canal] === true;
}

/* ────────────────────────────── Préférences personnelles ──────────────────────────────
 *
 * « Certains ne supportent pas d'être spammés » : chacun règle, depuis « Mon profil », ce qu'il
 * accepte encore de recevoir, **type par type**. Le choix est rangé dans `User.preferencesNotifications`,
 * un JSON plat `{ "<type>": <booléen>, … }` — uniquement des types connus, uniquement des booléens :
 *
 *     { "recap_veille": false, "rappel_sans_reponse": true, "evenement_nouveau": false }
 *
 * Une clé **absente** veut dire « rien de choisi » : on retombe sur la valeur par défaut du type, qui
 * est `User.rappelEmail` pour les rappels (reprise de l'existant) et « oui » pour le reste.
 * Une valeur illisible (JSON cassé, type inattendu) est ignorée comme si elle était absente : ce module
 * ne lève jamais, une préférence abîmée ne doit pas empêcher un message de partir ni faire tomber un cron.
 */

/**
 * Types qu'une personne peut refuser : **toute** la matrice du club. Les messages d'accès et de
 * sécurité (`NOTIFICATIONS_TOUJOURS_ENVOYEES`) n'en font pas partie — ils n'ont pas de type ici et ne
 * passent jamais par `destinataireRetenu`, donc ils partent quoi qu'il arrive.
 */
export const TYPES_REFUSABLES: readonly TypeNotification[] = TYPES_NOTIFICATION;

/**
 * Les canaux qui s'adressent à **une personne**, et qu'elle règle donc elle-même : l'email et la
 * notification sur le téléphone. Discord et WhatsApp parlent au groupe — personne ne s'y
 * désabonne individuellement, c'est le club qui décide d'y publier ou non. Le site du club, lui,
 * ne parle à personne : il expose (voir {@link CANAUX_EXPOSITION}).
 */
export const CANAUX_PERSONNELS = ["email", "push"] as const;
export type CanalPersonnel = (typeof CANAUX_PERSONNELS)[number];

export function estCanalPersonnel(valeur: unknown): valeur is CanalPersonnel {
  return typeof valeur === "string" && (CANAUX_PERSONNELS as readonly string[]).includes(valeur);
}

/**
 * Ce qu'une personne accepte, **type par type et canal par canal** : « le récap oui, mais seulement
 * sur le téléphone » est un réglage légitime, et c'est même le plus demandé dès qu'un second canal
 * existe.
 *
 * L'ancien format — un simple booléen par type — reste lu : il vaut alors pour les deux canaux
 * (voir `lirePreferencesPersonnelles`). Personne n'a à re-régler quoi que ce soit le jour où le
 * push s'allume.
 */
export type PreferencesPersonnelles = Record<TypeNotification, Record<CanalPersonnel, boolean>>;

/** Le type existe-t-il ? (garde pour tout ce qui vient d'un formulaire) */
export function estTypeNotification(valeur: unknown): valeur is TypeNotification {
  return typeof valeur === "string" && (TYPES_NOTIFICATION as readonly string[]).includes(valeur);
}

/**
 * Ce que reçoit quelqu'un qui n'a **rien réglé** : tout, sauf que les rappels suivent la case
 * historique du profil. `rappelEmail` n'est donc pas perdu — il devient la valeur par défaut des
 * deux types de rappel.
 */
export function preferencesPersonnellesDefaut(rappelEmail = true): PreferencesPersonnelles {
  const sortie = {} as PreferencesPersonnelles;
  for (const type of TYPES_NOTIFICATION) {
    // La case historique vaut pour les deux canaux : qui a coupé ses rappels les a coupés, et
    // brancher le téléphone ne doit pas les lui rendre par surprise.
    const valeur = RESPECTE_RAPPEL_EMAIL.includes(type) ? rappelEmail !== false : true;
    sortie[type] = { email: valeur, push: valeur };
  }
  return sortie;
}

/**
 * Relit le JSON du profil sans jamais lever : illisible, inconnu ou d'un mauvais type ⇒ valeur par
 * défaut du type (fonction pure).
 */
export function lirePreferencesPersonnelles(brut: string | null | undefined, rappelEmail = true): PreferencesPersonnelles {
  const prefs = preferencesPersonnellesDefaut(rappelEmail);
  if (!brut) return prefs;
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return prefs;
  }
  if (!estObjet(donnees)) return prefs;
  for (const type of TYPES_NOTIFICATION) {
    const valeur = donnees[type];
    // Ancien format : un booléen pour le type entier — il vaut pour tous les canaux personnels.
    if (typeof valeur === "boolean") prefs[type] = { email: valeur, push: valeur };
    else if (estObjet(valeur)) {
      for (const canal of CANAUX_PERSONNELS) {
        if (typeof valeur[canal] === "boolean") prefs[type][canal] = valeur[canal];
      }
    }
  }
  return prefs;
}

/** Forme canonique à écrire en base : seulement des types et des canaux connus, seulement des booléens. */
export function serialiserPreferencesPersonnelles(prefs: PreferencesPersonnelles): string {
  const sortie: Record<string, Record<string, boolean>> = {};
  for (const type of TYPES_NOTIFICATION) {
    sortie[type] = {};
    for (const canal of CANAUX_PERSONNELS) sortie[type][canal] = prefs[type]?.[canal] === true;
  }
  return JSON.stringify(sortie);
}

/** Ce qu'il faut savoir d'une personne pour décider si un message lui part. */
export type DestinataireLike = {
  actif?: boolean | null;
  /** Case historique « rappel la veille » : valeur par défaut des types de rappel */
  rappelEmail?: boolean | null;
  email?: string | null;
  /** JSON des choix personnels (`User.preferencesNotifications`), ou null si rien n'a été réglé */
  preferencesNotifications?: string | null;
};

/** Les choix d'une personne, relus depuis ses colonnes (fonction pure, ne lève jamais). */
export function preferencesPersonnellesDe(personne: DestinataireLike): PreferencesPersonnelles {
  return lirePreferencesPersonnelles(personne.preferencesNotifications, personne.rappelEmail !== false);
}

/** Cette personne accepte-t-elle encore ce type de message, sur ce canal-là ? (sans rien savoir du club) */
export function accepteNotification(personne: DestinataireLike, type: TypeNotification, canal: CanalPersonnel = "email"): boolean {
  return preferencesPersonnellesDe(personne)[type]?.[canal] === true;
}

/**
 * Le nouveau choix d'une personne, prêt à écrire (fonction pure) : le JSON canonique **et** la case
 * historique `rappelEmail`, tenue à jour en miroir (elle reste vraie tant qu'au moins un des deux
 * rappels est accepté) pour que le reste de l'application — et le lien de désinscription — continuent
 * de dire la vérité.
 */
export function miseAJourPersonnelle(
  personne: DestinataireLike,
  choix: Partial<Record<TypeNotification, boolean | Partial<Record<CanalPersonnel, boolean>>>>,
): { preferencesNotifications: string; rappelEmail: boolean } {
  const prefs = preferencesPersonnellesDe(personne);
  for (const type of TYPES_NOTIFICATION) {
    const valeur = choix[type];
    // Un booléen règle les deux canaux d'un coup (un écran qui ne connaît qu'une case par ligne) ;
    // un objet règle canal par canal, sans toucher à ce qui n'est pas nommé.
    if (typeof valeur === "boolean") prefs[type] = { email: valeur, push: valeur };
    else if (valeur) {
      for (const canal of CANAUX_PERSONNELS) {
        if (typeof valeur[canal] === "boolean") prefs[type][canal] = valeur[canal];
      }
    }
  }
  return {
    preferencesNotifications: serialiserPreferencesPersonnelles(prefs),
    // La case historique ne parle que d'email : c'est le lien de désinscription des emails qui la lit.
    rappelEmail: RESPECTE_RAPPEL_EMAIL.some((type) => prefs[type].email),
  };
}

/**
 * **Le point de passage unique** : le réglage du club **et** le choix de la personne (fonction pure).
 *
 * Règle de composition, dans cet ordre et jamais autrement :
 *
 * 1. le club décide — `notificationActiveDans` : canal coupé ou case décochée, rien ne part ;
 * 2. la personne **retranche** — son choix ne peut que transformer un « oui » du club en « non ».
 *    Il n'y a volontairement aucun chemin pour rallumer ici ce que le club a coupé : le refus
 *    personnel est un ET logique, jamais un OU.
 *
 * S'y ajoutent deux évidences : un compte désactivé ne reçoit rien, et une personne sans adresse
 * email est écartée en silence d'un envoi par email (l'adresse est facultative).
 *
 * Les messages d'accès et de sécurité (lien personnel, nouvel appareil, mot de passe oublié, alertes
 * aux administrateurs) ne passent pas par ici : ils n'ont pas de type dans la matrice et partent
 * toujours. C'est volontaire — les couper enfermerait les gens dehors.
 *
 * Les messages **de salon** (Discord, et demain WhatsApp) s'adressent au groupe, pas à une personne :
 * ils ne passent pas par cette fonction et ne se refusent donc que du côté du club.
 *
 * Un **canal d'exposition** (le site du club) rend toujours `false` : il n'y a pas de destinataire à
 * retenir, rien ne part, et cette fonction n'a donc rien à dire de lui. Voir {@link CANAUX_EXPOSITION}.
 */
export function destinataireRetenu(
  prefs: PreferencesNotifications,
  type: TypeNotification,
  canal: Canal,
  personne: DestinataireLike,
): boolean {
  /*
   * **0. Un canal d'exposition n'a pas de destinataire.** Sans cette ligne, la fonction répondrait
   * « oui, écris à cette personne » pour le canal `api` dès que sa case est cochée — et la première
   * boucle d'envoi qui le prendrait pour un canal comme les autres chercherait à lui expédier
   * quelque chose. Il n'y a rien à expédier : le site du club vient lire (`/api/public/annonces`).
   */
  if (estCanalExposition(canal)) return false;
  // 1. Le club d'abord.
  if (!notificationActiveDans(prefs, type, canal)) return false;
  if (personne.actif === false) return false;
  // Sans adresse email, aucun email ne peut partir : la personne est écartée, en silence.
  // (Un objet qui ne porte pas du tout le champ — un jeu de préférences nu — n'est pas concerné :
  // les vrais destinataires viennent de la base et portent toujours `email: string | null`.)
  if (canal === "email" && (personne.email === null || personne.email === "")) return false;
  // 2. La personne ensuite : elle ne peut que retrancher, et canal par canal. Un canal de salon
  // (Discord, WhatsApp) ne s'adresse à personne en particulier : il n'a rien à lui demander.
  if (estCanalPersonnel(canal) && !accepteNotification(personne, type, canal)) return false;
  return true;
}

export async function getPreferencesNotifications(): Promise<PreferencesNotifications> {
  return lirePreferences(await getSetting(CLES.notifications));
}

export async function setPreferencesNotifications(prefs: PreferencesNotifications): Promise<void> {
  await setSetting(CLES.notifications, serialiserPreferences(prefs));
}

/** Point de passage unique : le canal est-il actif ? */
export async function canalActif(canal: Canal): Promise<boolean> {
  return canalActifDans(await getPreferencesNotifications(), canal);
}

/** Point de passage unique : cette notification part-elle sur ce canal ? À appeler avant tout envoi. */
export async function notificationActive(type: TypeNotification, canal: Canal): Promise<boolean> {
  return notificationActiveDans(await getPreferencesNotifications(), type, canal);
}
