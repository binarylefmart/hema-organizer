import { ROLES_DE_BASE, type Role, type RoleDeBase } from "./constants";

/**
 * Matrice centrale des permissions.
 * Toute vérification d'accès côté serveur passe par can(user, permission).
 *
 * **Une ligne que personne ne vérifie n'a pas sa place ici**. Quatre y dormaient — `recap.hour`,
 * `whatsapp.share`, `attendances.view_all`, `profile.own` — sans un seul `can()` ni
 * `assertPermission()` dans tout le dépôt, et **deux disaient l'inverse du code réel** : le partage
 * (`BoutonPartager`, le résumé public sans aucun nom) est ouvert à tout le monde, et la liste « Qui
 * vient ? » est montrée à chaque invité sur la carte de sa séance — pas seulement à l'encadrement.
 * Une matrice qui affirme un droit que le code n'applique pas est pire qu'une matrice incomplète :
 * la relecture suivante s'y fie et cherche la faille ailleurs. Les quatre sont donc retirées ; le
 * jour où l'un de ces gestes doit vraiment se restreindre, la ligne revient **avec** son
 * `assertPermission` dans le même commit.
 */
export const PERMISSIONS = {
  // Organisation (INSTRUCTEUR + ADMIN)
  "sessions.manage": ["ADMIN", "INSTRUCTEUR"],
  /*
   * **Consulter** l'annuaire du club. Ouverte à l'encadrement — un instructeur, se disait-on, a
   * besoin de savoir qui est invité pour préparer son cours —, refermée sur le bureau : l'écran des
   * membres a rejoint l'espace admin, avec les fiches, les adresses et les liens. Un instructeur
   * voit qui vient à un cours sur la séance elle-même, là où c'est utile ; l'annuaire, lui, est un
   * registre de comptes.
   *
   * Elle reste **distincte** de `members.manage` : lire n'est pas écrire, et le jour où l'annuaire
   * devra se rouvrir à quelqu'un, c'est cette ligne-ci qui bougera, pas les gestes d'écriture.
   */
  "members.view": ["ADMIN"],
  "ateliers.moderate": ["ADMIN", "INSTRUCTEUR"],
  /*
   * **Effacer une proposition d'atelier sans y répondre** — bureau seul.
   *
   * Décider (placer, refuser) est de l'organisation : c'est une réponse, elle part par email, et
   * l'encadrement la prend. Effacer, c'est autre chose : la proposition de quelqu'un disparaît
   * **sans réponse ni trace visible pour lui**, et rien ne le lui dit. Le doublon, le brouillon
   * envoyé par erreur, le message déplacé : ça existe, et ça n'a pas à encombrer la file — mais
   * faire disparaître l'écrit d'un membre en silence engage le club, comme désactiver un compte.
   * D'où la même frontière que pour les comptes : le bureau, avec le journal d'audit pour mémoire.
   */
  "ateliers.supprimer": ["ADMIN"],
  "dashboard.view": ["ADMIN", "INSTRUCTEUR"],
  "exports.csv": ["ADMIN", "INSTRUCTEUR"],
  // Événements du club (stages, tournois, démonstrations) : tout le monde les consulte — la lecture
  // n'a pas de permission dédiée. L'écriture, elle, se partage en deux gestes de portée différente :
  // tenir une annonce à jour (horaire, lieu, lien, publication) appartient à l'encadrement…
  "evenements.edit": ["ADMIN", "INSTRUCTEUR"],
  // Gestion technique (ADMIN uniquement)
  "settings.technical": ["ADMIN"],
  "admins.manage": ["ADMIN"],
  // Couper (ou rendre) l'accès de quelqu'un est une décision du bureau, pas de l'encadrement :
  // un instructeur gère les membres (fiches, périodes, liens) mais ne désactive aucun compte.
  "members.activate": ["ADMIN"],
  // Ouvrir un compte (à l'unité ou par import CSV) engage le club : réservé au bureau.
  "members.create": ["ADMIN"],
  /*
   * **Écrire sur la fiche de quelqu'un** — son nom, son rôle, et surtout son adresse email. Réservé
   * au bureau, avec `invitations.manage` juste en dessous, pour une raison précise : l'adresse
   * email est l'endroit où arrive le lien personnel. Qui peut changer l'adresse d'une personne
   * **et** lui renvoyer son lien reçoit ce lien chez lui, et entre sous son identité. Les deux
   * gestes séparément sont anodins ; ensemble ils valent un mot de passe. Un instructeur garde
   * l'organisation entière (périodes, séances, planning, ateliers, présences) et la **lecture** de
   * l'annuaire (`members.view`).
   */
  "members.manage": ["ADMIN"],
  /*
   * **Le lien personnel de quelqu'un d'autre** : le renvoyer (donc le régénérer), le révoquer.
   * Réservé au bureau pour la raison ci-dessus, et parce qu'une régénération déconnecte tous les
   * appareils de la personne — un instructeur ne devrait pas pouvoir mettre le bureau dehors en
   * pleine séance. Chacun, quel que soit son rôle, peut en revanche se renvoyer **le sien** depuis
   * « Mon profil » (`renvoyerMonLien`, src/actions/profil.ts) : c'est le geste dont on a besoin
   * soi-même, et il ne demande que d'être connecté — aucune ligne de cette matrice ne le garde.
   */
  "invitations.manage": ["ADMIN"],
  // Effacer une personne et tout son historique est irréversible : plus grave encore qu'une désactivation.
  "members.delete": ["ADMIN"],
  /*
   * **Le trimestre lui-même** : le créer, engendrer ses séances en récurrence, le modifier, et
   * l'**activer** — c'est-à-dire envoyer son lien personnel à chaque membre. Réservé au bureau,
   * avec la même doctrine que les comptes : ouvrir un trimestre engage le club (des emails partent
   * à tout le monde, des accès s'ouvrent pour quatre mois), là où animer un cours n'engage que la
   * séance.
   *
   * Ce qui reste à l'encadrement, et c'est l'essentiel de son travail : le contenu des séances
   * (`sessions.manage`), le planning (`planning.edit`), les thèmes, les ateliers, les présences.
   * Un instructeur travaille **dans** le trimestre ; c'est le bureau qui l'ouvre et le referme.
   */
  "periods.manage": ["ADMIN"],
  // Effacer une période emporte ses séances et les réponses des membres : c'est une décision du bureau,
  // pas un geste d'organisation courant (même doctrine que members.delete).
  "periods.delete": ["ADMIN"],
  /*
   * … et **ouvrir ou effacer** une annonce appartient à la même équipe : administrateurs **et**
   * instructeurs. Les stages, tournois et démonstrations sont la vie du club, et c'est
   * l'encadrement qui les connaît, les organise et sait quand ils tombent à l'eau. Les membres,
   * eux, les consultent — la lecture n'a jamais demandé de permission.
   *
   * Ce n'est pas la même chose qu'un trimestre ou qu'un compte : une annonce se retire d'un clic
   * et n'ouvre aucun accès à personne. Le journal d'audit garde qui a publié quoi.
   */
  "evenements.creer_supprimer": ["ADMIN", "INSTRUCTEUR"],
  "auth_sessions.revoke": ["ADMIN"],
  "audit.view": ["ADMIN"],
  // Régler les notifications **de quelqu'un d'autre** depuis sa fiche (« je suis spammé sur mon
  // téléphone, coupe-moi ça »). Réservé au bureau : un instructeur gère les fiches, les périodes et
  // les liens, mais ne décide pas à la place des gens de ce qu'ils reçoivent. La personne garde le
  // dernier mot — elle revient sur ce réglage depuis « Mon profil », au même endroit et sans
  // demander la permission.
  "notifications.autrui": ["ADMIN"],
  // Corriger la réponse **de quelqu'un d'autre** (« untel était là mais n'a jamais répondu »).
  // Ce n'est pas un geste d'organisation, c'est de la tenue de registre : le taux de présence sert
  // ensuite aux bilans et aux décisions du club, donc écrire à la place d'une personne engage le
  // club. Réservé au bureau, même doctrine que `notifications.autrui` : un instructeur organise
  // (séances, planning, liens) mais ne réécrit pas les réponses des autres.
  "attendances.autrui": ["ADMIN"],
  // Membre
  "attendances.own": ["ADMIN", "INSTRUCTEUR", "MEMBRE"],
  // Le planning se remplit par l'équipe (admins + instructeurs), chaque changement est journalisé ; les membres consultent
  "planning.edit": ["ADMIN", "INSTRUCTEUR"],
  // Les thèmes du planning sont le **vocabulaire commun** du club, pas un geste d'organisation :
  // une ligne retirée change ce que tout le monde peut choisir dans toutes les cases à venir.
  // Passés au bureau, en même temps que leur écran a rejoint l'espace admin — donc derrière
  // l'élévation, comme toute permission réservée à ADMIN.
  "themes.manage": ["ADMIN"],
  "ateliers.propose": ["ADMIN", "INSTRUCTEUR", "MEMBRE"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/**
 * **`estAdmin` est un supplément, pas un rôle**. Tout le monde porte un rôle de base — membre ou
 * instructeur — et le bureau s'ajoute par-dessus. Le champ est **optionnel** dans ce type pour que
 * les appelants qui n'ont rien à voir avec l'administration (une liste d'instructeurs, un
 * destinataire d'email) continuent de passer un objet minimal ; absent, il vaut « pas du bureau ».
 */
export type UserLike = { role: string; estAdmin?: boolean | null; actif?: boolean };

export function can(user: UserLike | null | undefined, permission: Permission): boolean {
  if (!user || user.actif === false) return false;
  const allowed: readonly string[] = PERMISSIONS[permission];
  /*
   * **Le bureau d'abord, le rôle de base ensuite**, et les deux s'additionnent : un instructeur du
   * bureau garde ses droits d'instructeur *et* reçoit ceux du bureau. C'était impossible avant, les
   * trois rôles étant exclusifs — nommer quelqu'un au bureau lui retirait l'instruction.
   *
   * `allowed.includes(user.role)` reste **après**, et pas seulement par prudence : c'est lui qui
   * donne encore les bons droits à une ligne restée en `role = "ADMIN"` — une base que la migration
   * n'aurait pas traversée, un jeu d'essai écrit à l'ancienne. Fermer cette porte ferait perdre
   * l'accès au bureau sans rien dire ; la laisser ouverte ne donne rien à personne d'autre, puisque
   * plus aucun écran n'écrit cette valeur.
   */
  if (user.estAdmin && allowed.includes("ADMIN")) return true;
  return allowed.includes(user.role);
}

/**
 * Un acteur peut-il attribuer ce **rôle de base** ? Il n'y en a que deux, et ils relèvent de la même
 * permission : tenir l'annuaire.
 *
 * **Le bureau ne s'attribue pas ici** : « administrateur » n'est plus une valeur de ce choix mais
 * un supplément, et il se donne et se retire au seul endroit qui le faisait déjà — l'écran des
 * comptes admin, derrière `admins.manage` ({@link peutNommerAdmin}). Un rôle passé en argument qui
 * ne serait pas un rôle de base est donc refusé, et c'est une frontière, pas une politesse : c'est
 * elle qui empêche qu'une requête forgée se donne le bureau par l'annuaire.
 */
export function canAssignRole(actor: UserLike, targetRole: string): boolean {
  if (!ROLES_DE_BASE.includes(targetRole as RoleDeBase)) return false;
  return can(actor, "members.manage");
}

/** Un acteur peut-il nommer ou retirer un administrateur ? C'est le seul geste qui touche `estAdmin`. */
export function peutNommerAdmin(actor: UserLike): boolean {
  return can(actor, "admins.manage");
}

/**
 * Un acteur peut-il modifier ce compte cible (rôle, activation, suppression) ?
 * - un INSTRUCTEUR ne touche jamais à un compte du bureau (`estAdmin`), ni à son propre rôle
 * - un ADMIN peut tout, sauf se retirer lui-même son rôle (géré à l'appel)
 */
/**
 * **Ce que cette porte ne garde PAS, et il ne faut pas le lui ajouter** : le compte global du
 * déploiement. On a essayé d'y poser son refus, pour centraliser une garantie que les actions
 * tiennent une par une — et un test a dit non, à juste titre : « laisse corriger son email et son
 * nom, son rôle restant celui qu'il a ». Ce compte **n'est pas immuable en bloc**. Il l'est dans
 * ses **rôles**, son **activation** et son **existence** ; son identité, elle, se corrige —
 * l'adresse d'administration d'une installation change.
 *
 * La garantie reste donc là où elle sait **de quel geste** il s'agit : dans chaque action, qui refuse
 * ce compte en nommant la raison (`estCompteDeService`). C'est plus verbeux qu'un verrou central, et
 * c'est le prix d'un refus qui dit vrai.
 */
export function canEditUser(actor: UserLike & { id: string }, target: UserLike & { id: string }): boolean {
  if (!can(actor, "members.manage")) return false;
  // **La cible du bureau se lit sur `estAdmin`**, plus sur son rôle : un administrateur porte
  // désormais un rôle de base comme tout le monde, et `role === "ADMIN"` ne serait plus jamais vrai
  // — la garde se serait taue, et un instructeur aurait pu modifier un compte du bureau.
  if (target.estAdmin && !can(actor, "admins.manage")) return false;
  return true;
}

/** Permission réservée aux ADMIN : exige en plus une session forte (mot de passe + 2FA), pas un simple lien. */
/**
 * **La liste des gestes réservés au bureau qui n'exigent PAS de session forte.** Elle est la plus
 * facile à élargir sans y penser, d'où ce commentaire : chaque entrée se justifie par la **nature du
 * geste** — ni destructeur, ni technique, défaisable d'un clic —, jamais par la commodité du moment.
 *
 * **Elle n'en compte plus qu'une.** `attendances.autrui` y a figuré cinq jours, et son argument
 * était vrai : les administrateurs nominatifs entrent par leur lien personnel, et le carnet se
 * tient un soir de cours, pas devant un écran. Ce qu'il laissait passer a été mesuré — un appel
 * forgé depuis une session ouverte par ce seul lien ramenait une séance de onze réponses à zéro,
 * puis déclarait les douze invités présents. Le registre engage le club, ses chiffres nourrissent
 * les bilans, et un email transféré suffisait. Elle est donc **sortie** (voir plus bas).
 *
 * **`notifications.autrui` y figure aussi, mais ne dispense de rien aujourd'hui** : son seul écran
 * est la fiche d'un membre, partie dans l'espace admin — il faut donc s'élever pour l'atteindre,
 * exemption ou pas. On la garde quand même, parce qu'elle décrit la **nature du geste** (régler ce
 * que quelqu'un reçoit n'est ni destructeur ni technique) et non l'endroit où il se fait : le jour
 * où ces cases reviendront sur un écran atteignable par lien, la règle sera déjà juste. La retirer
 * serait durcir une action sans que personne l'ait demandé.
 *
 * `evenements.creer_supprimer` y figurait tant qu'elle était réservée au bureau ; elle est revenue
 * à l'encadrement entier, la question de la session forte ne se pose donc plus pour elle.
 *
 * **`attendances.autrui` en est SORTIE** après qu'une relecture a mesuré le trou : un appel forgé
 * depuis une session ouverte par le **seul lien personnel** d'un administrateur ramenait une séance
 * de onze réponses à zéro, puis déclarait les douze invités présents. Le registre engage le club —
 * ses chiffres nourrissent les bilans —, et un email transféré suffisait.
 *
 * **Ce que l'exemption défendait était vrai, et c'est pour ça qu'elle a tenu cinq jours** : les
 * administrateurs nominatifs entrent par leur lien personnel, sans mot de passe, et exiger un **code
 * récent** (`exigerReauth`, dix minutes) aurait renvoyé sur l'écran de connexion **au milieu d'une
 * liste** celui qui tient le carnet un soir de cours. La sortie de cette liste ne marche donc qu'avec
 * la correction qui l'accompagne, et les deux se lisent ensemble :
 *
 *  - ce qui est exigé, c'est **l'espace admin ouvert** (`sessionForte` : rôle + interrupteur serveur +
 *    cookie d'élévation), pas un code frais. On le donne **une fois** en arrivant, et il vaut douze
 *    heures ;
 *  - et **cocher une présence compte comme une activité d'espace admin** : les deux actions de
 *    correction appellent `toucherElevation`, qui repousse l'échéance des dix minutes d'inactivité.
 *    Sans elle, l'élévation tombait pendant qu'on tenait le registre, puisque la fiche d'une séance
 *    n'est pas dans `/admin/**`.
 *
 * Corriger une réponse n'ouvre toujours aucun accès et se défait d'un clic ; ce que ça change, c'est
 * qu'un lien volé ne suffit plus pour réécrire le registre du club.
 *
 * **`notifications.autrui` reste, elle.** Son geste ne touche qu'à ce qu'une personne reçoit, et son
 * seul écran vit déjà dans l'espace admin : la sortir ne durcirait rien, mais effacerait la règle de
 * nature qu'elle porte (voir ci-dessus).
 */
const SANS_SESSION_FORTE: readonly Permission[] = ["notifications.autrui"];

export function exigeSessionForte(permission: Permission): boolean {
  if (SANS_SESSION_FORTE.includes(permission)) return false;
  const allowed: readonly string[] = PERMISSIONS[permission];
  return allowed.length === 1 && allowed[0] === "ADMIN";
}

export function isStaff(user: UserLike | null | undefined): boolean {
  return can(user, "sessions.manage");
}

/**
 * **« Cette personne encadre-t-elle ? »** — le **rôle de base**, et non un droit.
 *
 * À ne pas confondre avec `isStaff`, qui demande « a-t-elle le droit d'organiser ? » et répond oui
 * à tout administrateur. Depuis que le bureau est un **supplément**, les deux questions se
 * séparent : un administrateur dont le rôle de base est *membre* pilote le club sans l'encadrer.
 *
 * La distinction n'est pas théorique — elle a montré un défaut : la bascule de l'accueil ouvrait la
 * vue de l'encadrement à un administrateur-membre, parce qu'elle lisait le droit au lieu de la
 * place dans le club.
 *
 * **Ce qui doit l'appeler, et ce qui ne doit pas** : ce qui parle d'**identité** (quelle vue
 * m'ouvre-t-on, comment on me nomme) lit ceci ; ce qui parle de **périmètre** (voir toutes les
 * périodes, atteindre l'espace instructeur) lit `isStaff`, et un administrateur y a bien sa place.
 *
 * Pas de repli sur `role === "ADMIN"` ici, à la différence de `can()` : une base que la migration
 * n'aurait pas traversée rendrait `false` pour un instructeur-administrateur, qui perdrait une
 * **position de bascule** — un désagrément d'affichage, jamais un accès.
 */
export function estInstructeur(user: UserLike | null | undefined): boolean {
  return !!user && user.actif !== false && user.role === "INSTRUCTEUR";
}

/**
 * **« Cette personne voit-elle le club comme l'encadrement ? »** — le rôle de base, **ou** le compte
 * global du déploiement.
 *
 * Le compte créé au déploiement (`ADMIN_EMAIL`, marqué `service`) a **tous les rôles**, pas
 * seulement tous les droits : c'est le compte d'administration global de l'installation, immuable
 * dans ses rôles et qu'aucun autre compte ne peut supprimer. `estInstructeur` répond non pour lui —
 * son rôle de base est `MEMBRE`, et il n'enseigne pas —, mais la question de la vue n'est pas «
 * enseigne-t-il ? » : c'est « lui ouvre-t-on la vue de l'encadrement ? ». Pour lui, oui.
 *
 * On ne touche pas `estInstructeur` pour autant : « encadrer » garde son sens strict, et c'est ce
 * sens-là que lisent les écrans qui nomment des instructeurs.
 */
export function encadreLeClub(user: (UserLike & CompteLike) | null | undefined): boolean {
  return estInstructeur(user) || (!!user && user.actif !== false && estCompteDeService(user));
}

/** Un compte marqué `service` est le compte de connexion du portail, pas une personne du club. */
export type CompteLike = { service?: boolean | null };

export function estCompteDeService(user: CompteLike | null | undefined): boolean {
  return user?.service === true;
}

/**
 * Le compte du portail ne peut être ni invité à une période, ni destinataire d'un lien personnel :
 * il se connecte par mot de passe + double authentification. (Les alertes de sécurité aux
 * administrateurs, elles, continuent de lui parvenir : voir src/lib/alertes.ts.)
 */
export function peutEtreInvite(user: CompteLike | null | undefined): boolean {
  return !estCompteDeService(user);
}

/** Retire les comptes de service d'une liste nominative (participants, destinataires d'emails). */
export function personnesDuClub<T extends CompteLike>(gens: readonly T[]): T[] {
  return gens.filter((g) => !estCompteDeService(g));
}
