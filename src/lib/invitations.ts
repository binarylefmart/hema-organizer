import { db } from "./db";
import { revokeAllSessions } from "./auth/session";
import type { OrigineSession } from "./auth/session";
import { generateToken, hashToken, isValidTokenFormat } from "./auth/tokens";
import { checkRateLimit } from "./auth/rate-limit";
import { baseUrl, bequilleDev } from "./env";
import { peutEtreInvite } from "./permissions";
import { identite } from "./identite";

/**
 * Lien d'accès personnel : un jeton par membre et par période, qui connecte directement (sans mot de passe).
 * - validité **4 mois** à partir de la création — la durée d'un trimestre du club, pour qu'un lien
 *   couvre la période pour laquelle il a été émis ; renouvelé automatiquement (voir `renouvelerLien`,
 *   `renouvelerLiensExpirants`) et renvoyé par email à la personne, **quel que soit son rôle** ;
 * - révocable et régénérable par l'équipe (l'ancien lien meurt aussitôt) ; révoqué à la clôture de la période ;
 * - anti-abus : un lien ouvert trop souvent en peu de temps est révoqué, un nouveau est envoyé (`signalerOuverture`).
 * Le jeton brut n'existe que dans l'URL envoyée par email ; la base ne stocke que son SHA-256.
 * Le compte de service (connexion du portail) est exclu : il se connecte par mot de passe + 2FA.
 */

export const DUREE_LIEN_MS = 120 * 24 * 60 * 60 * 1000; // 4 mois (durée d'un trimestre du club)
/** Message renvoyé quand on tente d'inviter le compte de connexion du portail. */
export const ERREUR_COMPTE_SERVICE = "Le compte de connexion du portail ne peut pas être invité à une période.";
/**
 * Un lien pose une session sur au plus 3 appareils ; au-delà il est remplacé (nouveau lien envoyé).
 * Ce sont bien **3 sessions vivantes en même temps et ouvertes par le lien**, et non 3 ouvertures
 * cumulées, ni 3 sessions quelle qu'en soit la porte d'entrée — voir `verifierAppareils`.
 */
export const MAX_APPAREILS_PAR_LIEN = 3;

/**
 * Les sessions que ce plafond compte : celles qui sont entrées **par le lien**.
 *
 * Le type vient de `src/lib/auth/session.ts` et l'import est un `import type` — effacé à la
 * compilation. Il n'y a donc, à l'exécution, aucun lien de plus entre ce module et celui des
 * sessions ; seul le compilateur vérifie que la valeur écrite ici est bien l'une des origines
 * possibles, et le jour où l'une d'elles sera renommée, il le dira.
 */
const ORIGINE_COMPTEE: OrigineSession = "lien";
/** Un lien qui expire dans moins de 7 jours est renouvelé par le balayage quotidien */
export const RENOUVELLEMENT_AVANT_MS = 7 * 24 * 60 * 60 * 1000;

export type MotifRevocation = "MANUEL" | "CLOTURE" | "SUSPECT" | "REMPLACE" | "APPAREILS";

/**
 * Ce qu'une garde de sécurité du lien a fait — et, c'est tout l'objet de cette valeur, **si un lien
 * de remplacement est vraiment parti**.
 *
 * Les deux gardes (`signalerOuverture`, `verifierAppareils`) révoquent puis tentent un envoi, et cet
 * envoi peut ne pas avoir lieu : pas d'adresse email sur la fiche, ou période close. L'écran
 * d'arrivée doit donc savoir laquelle des deux choses s'est produite — annoncer « un nouveau lien
 * vient d'être envoyé par email » à qui n'en recevra aucun l'envoie attendre devant sa boîte mail au
 * lieu d'utiliser la seule porte qui lui reste.
 *
 * Dans les deux cas `"remplace-sans-email"`, les sessions ouvertes sont fermées par la garde
 * elle-même : l'ancien lien est mort, ce qu'il avait ouvert tombe avec lui.
 */
export type IssueGardeLien = "rien" | "remplace" | "remplace-sans-email";

export function invitationUrl(token: string): string {
  return `${baseUrl()}/invitation/${token}`;
}

/** Fin de validité = 4 mois après la création. */
export function invitationExpiry(depuis: Date = new Date()): Date {
  return new Date(depuis.getTime() + DUREE_LIEN_MS);
}

/** Le lien doit-il être renouvelé (expiré ou sur le point de l'être) ? Fonction pure, testée. */
export function lienARenouveler(expiresAt: Date, now = new Date(), marge = RENOUVELLEMENT_AVANT_MS): boolean {
  return expiresAt.getTime() - now.getTime() < marge;
}

/**
 * Crée le lien d'un membre pour une période. Les liens précédents encore actifs sont révoqués
 * (motif REMPLACE), sauf `garderAnciens` (renouvellement anticipé : l'ancien vit jusqu'à son expiration).
 * Retourne le jeton brut à envoyer.
 *
 * `deconnecterAppareils` : voir `OptionsEnvoi` ci-dessous — c'est **le** choix à faire consciemment.
 */
export async function createInvitation(userId: string, periodId: string, options: OptionsEnvoi = {}): Promise<{ token: string; url: string }> {
  // Garde-fou serveur : le compte du portail n'est pas une personne du club (pas de lien personnel, pas d'inscription à une période)
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { service: true } });
  if (!peutEtreInvite(cible)) throw new Error(ERREUR_COMPTE_SERVICE);
  const token = generateToken();
  /*
   * Le parcours d'entrée suit le lien (`Invitation.parcoursVuLe`) : un lien neuf le rejouerait donc
   * à chaque renvoi. On ne le rejoue que s'il n'a jamais été fait — ou si l'appelant le demande
   * (`parcours: "force"`, la remise à zéro). Voir `OptionsEnvoi`.
   */
  const dejaFait =
    options.parcours === "force"
      ? null
      : await db.invitation.findFirst({ where: { userId, parcoursVuLe: { not: null } }, select: { id: true } });
  const parcoursVuLe = dejaFait ? new Date() : null;
  await db.$transaction([
    ...(options.garderAnciens
      ? []
      : [
          db.invitation.updateMany({
            // `remplaceTousLesLiens` : tous les trimestres, pas seulement celui-ci (voir `OptionsEnvoi`).
            where: { userId, revokedAt: null, ...(options.remplaceTousLesLiens ? {} : { periodId }) },
            data: { revokedAt: new Date(), motifRevocation: "REMPLACE" },
          }),
        ]),
    db.invitation.create({ data: { userId, periodId, tokenHash: hashToken(token), expiresAt: invitationExpiry(), parcoursVuLe } }),
    db.periodMember.upsert({
      where: { periodId_userId: { periodId, userId } },
      create: { periodId, userId },
      update: {},
    }),
  ]);
  // Régénération volontaire ou de sécurité : on ferme aussi les sessions déjà ouvertes. Sans cela,
  // régénérer un lien qui a pu fuiter ne servirait à rien — l'ancien appareil resterait dedans.
  if (options.deconnecterAppareils) await revokeAllSessions(userId, options.deconnecterAppareils === "autres");
  return { token, url: invitationUrl(token) };
}

/**
 * **Faut-il déconnecter la personne de tous ses appareils quand son lien change ?**
 *
 * La réponse n'est pas la même selon *pourquoi* le lien change, et c'est le point délicat :
 *
 * - **régénération volontaire ou de sécurité** — l'équipe régénère depuis la fiche membre, la
 *   personne demande « Renvoyer mon lien », le lien est jugé suspect ou a servi sur trop
 *   d'appareils → `deconnecterAppareils: "tous"` (ou `"autres"` quand la personne le demande
 *   elle-même, pour ne pas la mettre dehors depuis l'appareil où elle est). C'est le sens même du
 *   geste : on régénère parce qu'un lien a pu fuiter, laisser vivre les sessions ouvertes viderait
 *   l'opération de son contenu.
 * - **envoi de masse** — départ des liens trois jours avant le début d'un trimestre
 *   (`envoyerLiensDesTrimestresQuiCommencent`), « Renvoyer les liens » après correction des
 *   adresses : option absente. Ce sont des gestes d'organisation, pas des incidents ; déconnecter
 *   tout le club parce qu'un instructeur a corrigé deux adresses serait hors de proportion.
 * - **renouvellement automatique d'expiration** — le balayage de 07:00, ou l'ouverture d'un lien
 *   arrivé à terme → option **absente**. Le lien change, **les sessions restent**.
 *   Déconnecter ici mettrait **tout le club dehors tous les quatre mois**, un matin, sans que
 *   personne n'ait rien demandé — et chacun devrait retrouver un email pour rentrer (avec, sur
 *   iPhone, le piège de l'application installée qui ne partage pas le stockage de Safari).
 *   Ce n'est pas de la sécurité, c'est une panne collective programmée.
 *
 * Le champ est **explicite à chaque appel**, sans valeur par défaut implicite : se tromper ici ne
 * se voit pas en test unitaire mais se paie en assemblée générale.
 */
export type OptionsEnvoi = {
  /** Le lien précédent survit jusqu'à son terme (renouvellement anticipé). */
  garderAnciens?: boolean;
  /**
   * **Le parcours d'entrée** (écran de bienvenue : installer l'application, se donner un mot de
   * passe, activer la double authentification) est attaché au lien, pas à la personne.
   *
   * - `"auto"` (défaut) — **renvoyer un lien renvoie un lien**, rien de plus : quelqu'un qui a déjà
   *   fait le parcours ne le refait pas parce que l'équipe a régénéré son accès. Le nouveau lien
   *   naît donc « parcours déjà vu ». Quelqu'un qui n'a jamais ouvert de lien, lui, le verra.
   * - `"force"` — **tout recommence** : c'est la remise à zéro de l'accès (mot de passe et 2FA
   *   effacés), où la personne doit de toute façon tout reconfigurer. Décision de Delta,.
   */
  parcours?: "auto" | "force";
  /**
   * Fermeture des sessions ouvertes (voir ci-dessus) :
   * - `"tous"` — tout tombe, y compris l'appareil d'où part la demande (geste de l'équipe, incident) ;
   * - `"autres"` — tout sauf la session en cours : la personne est **là**, elle vient de demander
   *   elle-même un nouveau lien — depuis son profil, ou depuis la gestion quand la fiche qu'elle
   *   régénère est la sienne ; ce sont les *autres* appareils qu'elle coupe. Même règle que le
   *   changement de mot de passe, qui ne se met pas dehors tout seul ;
   * - absent — rien n'est fermé (expiration, premier envoi, envoi de masse).
   */
  deconnecterAppareils?: "tous" | "autres";
  /**
   * **Un seul lien vivant par personne.** Révoque *tous* ses liens encore actifs, y compris ceux
   * des trimestres précédents, et non les seuls liens de la période visée.
   *
   * C'est ce qui se passe à l'ouverture d'un trimestre : chacun reçoit un lien neuf, les anciens
   * n'ont donc plus de raison de vivre. Sans cette option, quelqu'un pouvait garder trois liens
   * valides en même temps — celui du trimestre en cours et ceux d'avant, tant que leurs quatre mois
   * couraient encore. Un lien oublié dans une vieille boîte mail reste une porte ouverte ; la
   * fermer quand on en donne une neuve, c'est le minimum.
   *
   * **Les sessions ouvertes, elles, ne sont pas touchées** (sauf `deconnecterAppareils`) : on
   * remplace des clés, on ne met pas le club dehors un matin de rentrée.
   */
  remplaceTousLesLiens?: boolean;
};

export type InvitationCheck =
  | { ok: true; invitation: { id: string; userId: string; periodId: string; usedAt: Date | null; parcoursVuLe: Date | null; tokenHash: string; ouvertures: number } }
  | {
      ok: false;
      raison: "format" | "inconnue" | "revoquee" | "expiree" | "inactif";
      invitation?: { id: string; userId: string; periodId: string };
      /** Pour un lien révoqué : *pourquoi* — la réponse de l'écran n'est pas la même (voir `revocationDeSecurite`). */
      motifRevocation?: MotifRevocation | null;
    };

/**
 * Cette révocation est-elle un **geste de sécurité** ?
 *
 * Trois motifs le sont : le lien a été jugé suspect (`SUSPECT`), il a servi sur trop d'appareils
 * (`APPAREILS`), ou il a été remplacé par un plus récent (`REMPLACE`). Dans ces trois cas un nouveau
 * lien est parti par email et l'ancien a été neutralisé : il faut le **dire**, même à quelqu'un qui
 * est déjà connecté — c'est précisément l'information qu'il ne faut pas avaler en silence.
 *
 * Les autres (`MANUEL`, `CLOTURE`) sont de l'administration ordinaire : un lien périmé, rien de plus.
 */
export function revocationDeSecurite(motif: MotifRevocation | null | undefined): boolean {
  return motif === "SUSPECT" || motif === "APPAREILS" || motif === "REMPLACE";
}

/** Vérifie un jeton sans le consommer. Pour un lien expiré, l'invitation est renvoyée (renouvellement possible). */
export async function checkInvitation(token: unknown, now = new Date()): Promise<InvitationCheck> {
  if (!isValidTokenFormat(token)) return { ok: false, raison: "format" };
  const tokenHash = hashToken(token);
  const inv = await db.invitation.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, periodId: true, usedAt: true, parcoursVuLe: true, revokedAt: true, motifRevocation: true, expiresAt: true, ouvertures: true, user: { select: { actif: true } } },
  });
  if (!inv) return { ok: false, raison: "inconnue" };
  const ref = { id: inv.id, userId: inv.userId, periodId: inv.periodId };
  if (!inv.user.actif) return { ok: false, raison: "inactif", invitation: ref };
  if (inv.revokedAt) return { ok: false, raison: "revoquee", invitation: ref, motifRevocation: (inv.motifRevocation as MotifRevocation | null) ?? null };
  if (inv.expiresAt.getTime() < now.getTime()) return { ok: false, raison: "expiree", invitation: ref };
  return { ok: true, invitation: { ...ref, usedAt: inv.usedAt, parcoursVuLe: inv.parcoursVuLe, tokenHash, ouvertures: inv.ouvertures } };
}

/**
 * **Le jeton d'un lien collé à la main**, ou `null` si rien d'exploitable.
 *
 * Pourquoi ce champ existe (page de connexion) : sur iPhone, une application installée sur l'écran
 * d'accueil a un **stockage séparé de Safari**, et un lien cliqué dans Mail ouvre Safari — jamais
 * l'icône. Quelqu'un qui a installé l'application et n'a pas de mot de passe se retrouve donc devant
 * un écran de connexion qu'il ne peut pas franchir : son lien ne se colle nulle part, une PWA n'ayant
 * pas de barre d'adresse. Le champ « colle ton lien ici » est la seule porte qui lui reste.
 *
 * Accepte le lien entier (`https://…/invitation/<jeton>`, avec ou sans paramètres) comme le jeton
 * seul. Tout le reste vaut `null` — et l'appelant répond alors **exactement** comme pour un jeton
 * inconnu : même message, même comptage. Rien de ce qui est saisi ici ne doit ressortir dans un
 * message d'erreur ni dans le journal : ce serait recopier un secret dans les traces.
 */
export function jetonDuLienColle(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const nettoye = valeur.trim();
  if (!nettoye) return null;
  // Lien entier : on prend le segment qui suit /invitation/, sans la requête ni l'ancre
  const capture = /\/invitation\/([^/?#\s]+)/.exec(nettoye);
  const candidat = capture ? capture[1] : nettoye;
  let decode = candidat;
  try {
    decode = decodeURIComponent(candidat);
  } catch {
    // Séquence d'échappement invalide : on garde la valeur telle quelle, le format tranchera
  }
  return isValidTokenFormat(decode) ? decode : null;
}

/**
 * **Un jeton refusé, mais une session déjà ouverte : laisse-t-on entrer ?**
 *
 * Le cas réel : l'application a été installée sur l'écran d'accueil **depuis la page du lien**, et
 * selon la version d'iOS l'icône rouvre cette adresse plutôt que `start_url`. Des mois plus tard le
 * jeton a expiré — mais la session, ouverte le jour même, vaut 12 h glissantes et ne dépend pas du
 * lien. Répondre « regarde ta
 * boîte mail » à quelqu'un qui voulait juste ouvrir son application, et lui renvoyer un lien dont il
 * n'a pas besoin, n'aurait aucun sens.
 *
 * **Le jeton n'ouvre rien** : dire oui ici ne crée aucune session et ne consomme aucune invitation.
 * On constate seulement qu'une session existe déjà, et on laisse la personne dans son application.
 *
 * Deux gardes tiennent avec cette fonction, et sont à lire ensemble :
 * 1. une révocation **de sécurité** se dit, même à quelqu'un de connecté (c'est tout l'objet de
 *    l'alerte) — d'où le `revocationDeSecurite` ci-dessous ;
 * 2. un jeton **inconnu** doit avoir été compté et journalisé **avant** qu'on appelle ceci
 *    (`invitation_inconnue_ip`, `invitation.lien_inconnu`), sinon un compte valide offrirait un
 *    angle mort à qui teste des jetons depuis son navigateur connecté. C'est la page qui tient cet
 *    ordre, et `tests/unit/invitation-deja-connecte.test.ts` qui le vérifie.
 */
export function entrerMalgreLienInvalide(check: Extract<InvitationCheck, { ok: false }>, dejaConnecte: boolean): boolean {
  if (!dejaConnecte) return false;
  if (check.raison === "revoquee" && revocationDeSecurite(check.motifRevocation)) return false;
  return true;
}

/** Marque l'invitation utilisée (première fois), compte l'ouverture et rattache le membre à la période. */
export async function consumeInvitation(invitationId: string, userId: string, periodId: string): Promise<void> {
  await db.$transaction([
    db.invitation.updateMany({ where: { id: invitationId, usedAt: null }, data: { usedAt: new Date() } }),
    db.invitation.update({ where: { id: invitationId }, data: { ouvertures: { increment: 1 }, derniereOuverture: new Date() } }),
    db.periodMember.upsert({
      where: { periodId_userId: { periodId, userId } },
      create: { periodId, userId },
      update: {},
    }),
  ]);
}

/**
 * **Ce lien-ci a vu le parcours d'accueil** (installer l'application, consolider son compte).
 *
 * Le marqueur est posé sur l'**invitation**, pas sur la personne : on ne repropose pas le parcours
 * à chaque connexion, ce serait un péage. Mais un lien neuf **naît « déjà vu »** dès que la
 * personne l'a vu une fois, où que ce soit (voir `createInvitation` et `OptionsEnvoi.parcours`) :,
 * renvoyer un lien renvoie un lien, rien de plus — une régénération ne remet personne devant
 * l'écran d'installation. Le parcours ne se rejoue donc qu'au tout premier lien, ou sur remise à
 * zéro de l'accès (`parcours: "force"`, où mot de passe et 2FA sont de toute façon effacés).
 *
 * Posé dès que le parcours est **montré**, et non à sa fin : quelqu'un qui l'abandonne en route a vu
 * la proposition, on ne la lui remet pas devant les yeux à chaque ouverture.
 */
export async function marquerParcoursVu(invitationId: string): Promise<void> {
  // L'échec **ne remonte pas** : la personne est en train d'entrer par son lien, et rater un
  // marqueur d'affichage ne justifie pas de lui refuser la porte. Mais il ne disparaît plus en
  // silence : sans ce marqueur, le parcours se remontre à **chaque** ouverture du même lien, et
  // c'est précisément le genre de panne que personne ne sait expliquer sans trace dans le journal
  // (même traitement que `renouvelerLiensExpirants` plus bas : on journalise, on continue).
  await db.invitation.update({ where: { id: invitationId }, data: { parcoursVuLe: new Date() } }).catch((e) => {
    console.error(`[liens] parcours d'accueil non marqué pour l'invitation ${invitationId}`, e);
  });
}

/**
 * **Rouvrir un trimestre clos rend les liens que la clôture avait fermés — et pas un de plus.**
 *
 * Correction. La réouverture remettait en service *tous* les liens révoqués `CLOTURE` encore
 * valides (`revokedAt: null`, `motifRevocation: null`), sans regarder ce qui s'était passé
 * entre-temps. Or entre la clôture et la réouverture, la personne a très bien pu recevoir un lien
 * neuf : ouverture du trimestre suivant (`remplaceTousLesLiens`), « Renvoyer le lien » depuis sa
 * fiche, renouvellement d'échéance. Ressusciter l'ancien lui en donnait **deux vivants à la fois**,
 * exactement ce que l'invariant « une seule clé en circulation par personne » (voir
 * `OptionsEnvoi.remplaceTousLesLiens`) interdit — et le plus vieux des deux dort dans une boîte
 * mail, souvent celle qu'on avait justement voulu fermer.
 *
 * Deux règles, donc, en plus de la validité :
 * 1. **personne qui a déjà une clé vivante ne récupère rien** — la plus récente gagne, l'ancienne
 *    reste révoquée ;
 * 2. **un seul lien par personne est remis en service**, le plus récent des `CLOTURE` : une
 *    clôture peut en avoir fermé deux d'un coup (un renouvellement anticipé laisse vivre l'ancien
 *    jusqu'à son terme, `garderAnciens`).
 *
 * Aucun email ne part d'ici : rouvrir un trimestre est un geste d'organisation. Ceux qui ne
 * récupèrent rien passent par « Renvoyer les liens ». Retourne le nombre de liens remis en service.
 */
export async function remettreEnServiceLiensDeCloture(periodId: string, now = new Date()): Promise<number> {
  const fermesParLaCloture = await db.invitation.findMany({
    // Un lien déjà périmé reste fermé (il ferait entrer le trimestre dans le balayage du matin) ;
    // les révocations MANUEL, SUSPECT, APPAREILS et REMPLACE ne sont pas le fait de la clôture.
    where: { periodId, motifRevocation: "CLOTURE", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true },
  });
  if (fermesParLaCloture.length === 0) return 0;
  // Qui a déjà une clé vivante, ce trimestre-ci ou un autre ? Une seule requête pour tout le monde.
  const vivants = await db.invitation.findMany({
    where: { userId: { in: [...new Set(fermesParLaCloture.map((i) => i.userId))] }, revokedAt: null, expiresAt: { gt: now } },
    select: { userId: true },
  });
  const dejaUneCle = new Set(vivants.map((i) => i.userId));
  const aRemettre: string[] = [];
  // Les liens arrivent du plus récent au plus ancien : le premier retenu pour une personne est le
  // sien, les suivants restent révoqués.
  for (const lien of fermesParLaCloture) {
    if (dejaUneCle.has(lien.userId)) continue;
    dejaUneCle.add(lien.userId);
    aRemettre.push(lien.id);
  }
  if (aRemettre.length === 0) return 0;
  const { count } = await db.invitation.updateMany({ where: { id: { in: aRemettre } }, data: { revokedAt: null, motifRevocation: null } });
  return count;
}

export async function revokeInvitation(invitationId: string, motif: MotifRevocation = "MANUEL"): Promise<void> {
  await db.invitation.update({ where: { id: invitationId }, data: { revokedAt: new Date(), motifRevocation: motif } });
}

/**
 * **Les motifs qu'une révocation d'administration a le droit de ré-estampiller.**
 *
 * Le scénario qui a rendu cette liste nécessaire : une boîte mail est compromise en janvier, le
 * bureau remet l'accès de la personne à zéro — mais le trimestre de novembre a été clos
 * entre-temps, et son lien porte donc déjà `revokedAt` et le motif `CLOTURE`. Les remises à zéro ne
 * visaient que les liens `revokedAt: null` : celui-là était **sauté**, et gardait son motif de
 * clôture. Un mois plus tard, le bureau rouvre le trimestre pour corriger une présence — et
 * `remettreEnServiceLiensDeCloture`, qui rend précisément les liens marqués `CLOTURE`, remet en
 * service le lien de novembre. Dans la boîte compromise.
 *
 * On ré-estampille donc **toutes** les invitations encore valables, déjà révoquées ou non — sauf
 * celles qui portent un motif de sécurité (`SUSPECT`, `APPAREILS`, `REMPLACE`, voir
 * `revocationDeSecurite`). Ces trois-là ferment **plus fort** que `MANUEL` : la page du lien le dit
 * à la personne même si elle est déjà connectée (`entrerMalgreLienInvalide`), et aucune réouverture
 * ne les ressuscite. Les écraser serait le seul endroit où ce correctif relâcherait quelque chose.
 *
 * Liste blanche explicite plutôt qu'un `NOT … in` : `motifRevocation` est une colonne *nullable*,
 * et `NOT IN (…)` laisse tomber les lignes à NULL en SQL — c'est-à-dire exactement les liens
 * vivants, les premiers qu'on veut fermer.
 */
export const MOTIFS_REVOCABLES = ["MANUEL", "CLOTURE"] as const satisfies readonly MotifRevocation[];

/**
 * Le `where` d'une révocation décidée par l'équipe : à composer avec `userId` (remise à zéro de
 * l'accès) ou `periodId` + `userId` (retrait du trimestre). Voir `MOTIFS_REVOCABLES`.
 *
 * Un lien déjà expiré est laissé tel quel : il n'ouvre plus rien, et le réécrire ne ferait que
 * brouiller le journal.
 */
export function conditionLiensARevoquer(now: Date = new Date()) {
  return {
    expiresAt: { gt: now },
    OR: [{ motifRevocation: null }, { motifRevocation: { in: [...MOTIFS_REVOCABLES] } }],
  };
}

export const RAISONS_INVITATION: Record<Exclude<InvitationCheck, { ok: true }>["raison"], string> = {
  format: "Ce lien n'est pas valide.",
  inconnue: "Ce lien n'est pas valide.",
  revoquee: "Ce lien a été annulé. Demande un nouveau lien à l'administrateur.",
  expiree: "Ce lien a expiré (les liens sont valables 4 mois).",
  inactif: "Ce compte est désactivé. Contacte l'administrateur.",
};

export type MotifEnvoi = "invitation" | "renouvellement" | "securite" | "appareils" | "reinitialisation";

/**
 * Crée le lien d'un membre pour une période et envoie l'email (file d'envoi). Utilisé au départ des
 * liens de début de trimestre, à l'ajout d'un membre, pour « Régénérer », et par les
 * renouvellements automatiques.
 *
 * **Personne sans adresse email** : rien n'est créé et rien n'est envoyé — la fonction renvoie `false`
 * sans lever. Un lien personnel n'existe que pour être envoyé : en fabriquer un pour une adresse absente
 * ne servirait à rien et ferait échouer les envois de masse. Les envois à l'unité, eux, vérifient
 * l'adresse **avant** d'appeler ici et affichent un message qui nomme la personne
 * (`envoyerLienMembre`, src/actions/membres.ts).
 *
 * **Email seul, et aucune notification sur le téléphone** : ce message *est* le secret de
 * connexion. Un lien personnel affiché sur un écran verrouillé, sous les yeux de qui passe, ouvre
 * le compte à qui le lit — c'est exactement ce que la révocation automatique des liens suspects
 * cherche à empêcher. Les autres messages de sécurité, eux, sont bien doublés sur le téléphone :
 * voir l'en-tête de `src/lib/notifications/securite.ts`. Ne pas ajouter ici un push « par
 * symétrie ».
 *
 * Retourne `true` si un email est parti.
 */
export async function envoyerInvitation(userId: string, periodId: string, motif: MotifEnvoi = "invitation", options: OptionsEnvoi = {}): Promise<boolean> {
  const [user, period] = await Promise.all([
    // Ne jamais rapatrier le hash du mot de passe, le secret TOTP ni les codes de secours pour composer un email
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, prenom: true, email: true } }),
    db.period.findUniqueOrThrow({ where: { id: periodId }, select: { nom: true } }),
  ]);
  if (!user.email) return false;
  const { url } = await createInvitation(userId, periodId, options);
  const { emailInvitation } = await import("./email/templates/auth");
  const { enqueueEmail } = await import("./email/mailer");
  const { sujet, contenu } = emailInvitation({ prenom: user.prenom, periodeNom: period.nom, url, motif, nomApp: (await identite()).nomCourt });
  /*
   * **Un lien qui part est journalisé, et un lien qui ne part pas aussi.** La file d'envoi
   * retentait trois fois puis se taisait dans la console du serveur : côté application, « Renvoyer
   * le lien » annonçait un succès que rien ne contredisait, même quand le SMTP refusait tout. Le
   * journal des notifications garde désormais l'issue de chaque invitation, avec le message
   * d'erreur, et l'écran des paramètres techniques la montre.
   */
  const { journaliser } = await import("./notifications/journal");
  enqueueEmail({ to: user.email, sujet, contenu, ref: `invitation_${user.id}_${motif}` }, (err) => {
    void journaliser({
      type: "INVITATION",
      canal: "EMAIL",
      userId: user.id,
      dedupKey: `invitation_${user.id}_${motif}_${Date.now()}`,
      statut: err ? "ECHEC" : "ENVOYE",
      erreur: err?.message ?? null,
    });
  });
  return true;
}

/**
 * Ce qu'un renouvellement à l'ouverture a pu faire. **Trois issues, parce que l'écran d'après doit
 * dire laquelle** : « regarde ta boîte mail » adressé à qui n'a pas d'adresse, ou dont le trimestre
 * est clos, l'envoie attendre devant une boîte où rien n'arrivera jamais, au lieu de chercher la
 * vraie porte (son mot de passe, ou l'équipe).
 *
 * `deja-envoye` n'est pas un échec : un lien neuf est bien parti dans les dernières 24 h, le
 * plafond d'un par jour a seulement refusé d'en émettre un second. L'écran dit donc la même chose
 * que pour `envoye` — et c'est l'arbitrage d'origine, conservé.
 */
export type IssueRenouvellement = "envoye" | "deja-envoye" | "impossible";

/**
 * Lien expiré ouvert par la personne : on lui renvoie un nouveau lien, au plus une fois par jour.
 *
 * **L'adresse est vérifiée avant le plafond quotidien**, et non l'inverse : sans adresse, aucun
 * email ne peut partir, et consommer au passage le seul renouvellement de la journée ferait
 * attendre 24 h à qui retrouverait son adresse entre-temps.
 */
export async function renouvelerLien(invitation: { id: string; userId: string; periodId: string }): Promise<IssueRenouvellement> {
  const [period, compte] = await Promise.all([
    db.period.findUnique({ where: { id: invitation.periodId }, select: { statut: true } }),
    db.user.findUnique({ where: { id: invitation.userId }, select: { email: true } }),
  ]);
  // On n'émet pas de lien pour une période close, et nulle part où l'envoyer sans adresse.
  if (!period || period.statut === "CLOSE" || !compte?.email) return "impossible";
  /*
   * **Un seul lien vivant par personne : on n'en émet pas un second**.
   *
   * `garderAnciens` a été posé quelques heures plus tôt pour que rouvrir un vieil email ne révoque pas
   * le lien valide reçu depuis. Le correctif était juste et il a dépassé la cible : comme plus rien
   * n'était révoqué, le vieux lien restait **éternellement** dans l'état « expiré », donc la porte
   * publique restait ouverte pour lui, une fois par jour, indéfiniment. Trente jours de clics sur le
   * même vieil email auraient produit **trente clés de quatre mois valables en même temps**, dans trente
   * boîtes différentes — l'exact contraire de l'invariant écrit dans `OptionsEnvoi` : « un lien oublié
   * dans une vieille boîte mail reste une porte ouverte ».
   *
   * Aggravant, et c'est ce qui rendait la chose difficile à rattraper : l'écran de la période n'en
   * montre qu'un par personne, et c'est le **plus ancien** (la `Map` construite sur une liste triée du
   * plus récent au plus ancien garde la dernière entrée). Ces liens auraient donc été invisibles **et**
   * non révocables depuis l'interface.
   *
   * La garde est celle que le balayage quotidien avait déjà (`renouvelerLiensExpirants` saute les
   * personnes qui ont un lien neuf) : si un lien non révoqué et non expiré existe pour ce couple
   * (personne, période), il n'y a rien à renouveler — on le dit, et l'écran invite à regarder sa boîte.
   */
  const dejaValide = await db.invitation.findFirst({
    where: { userId: invitation.userId, periodId: invitation.periodId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (dejaValide) return "deja-envoye";
  if (!(await checkRateLimit("renouvellement_user", invitation.userId))) return "deja-envoye";
  /*
   * Lien arrivé à terme, ouvert par son propriétaire : c'est une expiration, pas un incident.
   * Les sessions déjà ouvertes survivent (voir `OptionsEnvoi`).
   *
   * **`garderAnciens`, comme le balayage quotidien**. Les options étaient vides, donc
   * `createInvitation` révoquait **toutes** les invitations non révoquées de la personne sur cette
   * période — y compris un lien parfaitement valide.
   *
   * Le scénario, et il n'a rien d'exotique : le balayage de 07:00 renouvelle les liens sept jours avant
   * terme **en gardant l'ancien** (il meurt de sa propre expiration). Quelqu'un a donc en boîte mail
   * l'email de janvier, dont le lien vient de périmer, et celui de mai, dont le lien est celui qu'il
   * utilise. Le jour où il rouvre le vieil email — ou, pire, où le filtre anti-virus de sa messagerie le
   * précharge pour lui —, ce chemin-ci révoquait le lien de mai. La personne se retrouvait dehors sans
   * avoir rien fait, avec un troisième email qu'elle n'avait pas demandé.
   *
   * L'autre moitié du même défaut est qu'on écrivait ici pendant le **rendu d'un GET** ; elle est
   * traitée dans la page (`src/app/(public)/invitation/[token]/page.tsx`).
   */
  return (await envoyerInvitation(invitation.userId, invitation.periodId, "renouvellement", { garderAnciens: true })) ? "envoye" : "impossible";
}

/**
 * Balayage quotidien : renouvelle les liens actifs qui expirent dans moins de 7 jours
 * (membres des périodes non closes), sans couper l'ancien avant son terme. Retourne le nombre renvoyés.
 *
 * **Aucun filtre de rôle, et c'est volontaire** : membres, instructeurs et administrateurs nominatifs
 * entrent tous par leur lien personnel, donc tous voient le leur renouvelé et renvoyé par email.
 * Les seules conditions sont celles qui rendent un renouvellement *possible* : compte actif, adresse
 * email renseignée, période non close, lien pas déjà remplacé. Ne pas réintroduire de condition sur
 * `role` ici — un instructeur dont le lien expire est un instructeur qui ne peut plus entrer.
 *
 * Un échec sur une personne (compte de service inscrit par erreur, adresse devenue invalide…) est
 * **isolé** : il est journalisé et le balayage continue. Sans cela, un seul cas bancal priverait
 * tous les suivants de leur renouvellement.
 */
/**
 * **Combien de jours avant le premier cours d'un trimestre son lien personnel part.**
 *
 * Trois jours : assez tôt pour que chacun ait le temps d'ouvrir son email et de dire s'il vient,
 * assez tard pour que le lien ne dorme pas des semaines dans une boîte avant de servir.
 *
 * Le repère est **le premier cours**, et non la date de début du trimestre : les deux se
 * ressemblent mais ne tombent pas le même jour. Un trimestre peut s'ouvrir un lundi pour un premier
 * cours le jeudi — le lien doit arriver trois jours avant *le cours*, qui est la seule date à
 * laquelle il y a quelque chose à faire dans l'application. À défaut de séance (trimestre engendré
 * plus tard), on retombe sur la date de début.
 */
export const LIENS_AVANT_DEBUT_JOURS = 3;

/**
 * **Les liens d'un trimestre partent trois jours avant son premier cours** — et non à son
 * activation.
 *
 * Les deux gestes étaient confondus, et ils ne disent pas la même chose. **Activer**, c'est ouvrir
 * le trimestre au travail de l'équipe : les séances deviennent visibles, le planning se remplit,
 * les thèmes se posent. Ça se fait des semaines à l'avance, quand on prépare la saison.
 * **Envoyer les liens**, c'est ouvrir l'application aux membres — et ça n'a de sens qu'au moment
 * où il y a quelque chose à y faire. Un lien reçu six semaines avant le premier cours est un lien
 * oublié, donc un lien qu'on redemandera.
 *
 * Chacun reçoit un lien neuf, et **tous ses anciens liens sont révoqués** (`remplaceTousLesLiens`) :
 * un trimestre commence avec une seule clé en circulation par personne. Les sessions ouvertes, elles,
 * ne bougent pas — personne n'est mis dehors un matin de rentrée.
 *
 * **Seulement à qui a déjà un lien en service** (`lienEncoreEnService`) : son dernier lien vit encore,
 * ou n'a été fermé que par la clôture du trimestre précédent. Qui n'a jamais été invité reçoit son
 * invitation d'un bouton, quand l'équipe le décide ; qui a vu son lien révoqué (à la main, adresse
 * changée, usage suspect…) n'en reçoit pas un neuf dans son dos.
 *
 * Idempotence : `Period.liensEnvoyesLe`. Le balayage tourne tous les jours, il ne doit pas
 * réexpédier le même trimestre chaque matin jusqu'à sa date de début.
 */
/**
 * Le dernier lien d'une personne la rend-elle éligible au lien du trimestre qui commence ? Oui s'il
 * vit encore, ou si seule la clôture d'un trimestre l'a fermé — c'est le cas de tout le club à chaque
 * rentrée. Non s'il n'y en a jamais eu, ou si quelqu'un (ou une garde) l'a révoqué.
 */
export function lienEncoreEnService(dernier: { revokedAt: Date | null; motifRevocation: string | null } | null | undefined): boolean {
  if (!dernier) return false;
  return dernier.revokedAt === null || dernier.motifRevocation === "CLOTURE";
}

export async function envoyerLiensDesTrimestresQuiCommencent(now = new Date()): Promise<number> {
  const limite = new Date(now.getTime() + LIENS_AVANT_DEBUT_JOURS * 86_400_000).toISOString().slice(0, 10);
  const candidates = await db.period.findMany({
    where: { statut: "ACTIVE", liensEnvoyesLe: null },
    select: {
      id: true,
      dateDebut: true,
      membres: { where: { user: { service: false, actif: true } }, select: { userId: true } },
      // Le premier cours qui aura vraiment lieu : une séance annulée n'est pas une échéance.
      sessions: { where: { annulee: false }, orderBy: { date: "asc" }, take: 1, select: { date: true } },
    },
  });
  // Les dates sont des chaînes ISO (« AAAA-MM-JJ ») : leur comparaison suit l'ordre chronologique,
  // c'est le même tri que partout ailleurs dans le projet.
  const periodes = candidates.filter((p) => (p.sessions[0]?.date ?? p.dateDebut) <= limite);
  let envoyes = 0;
  for (const p of periodes) {
    // Le dernier lien de chaque inscrit, en une requête : le plus récent d'abord, le premier vu gagne.
    const liens = await db.invitation.findMany({
      where: { userId: { in: p.membres.map((m) => m.userId) } },
      orderBy: { createdAt: "desc" },
      select: { userId: true, revokedAt: true, motifRevocation: true },
    });
    const dernier = new Map<string, (typeof liens)[number]>();
    for (const l of liens) if (!dernier.has(l.userId)) dernier.set(l.userId, l);
    for (const m of p.membres) {
      if (!lienEncoreEnService(dernier.get(m.userId))) continue;
      try {
        // Un trimestre neuf, une clé neuve : les anciennes sont révoquées, toutes périodes confondues.
        if (await envoyerInvitation(m.userId, p.id, "invitation", { remplaceTousLesLiens: true })) envoyes++;
      } catch (e) {
        // Un cas bancal (adresse devenue invalide, compte de service inscrit par erreur) ne doit pas
        // priver les suivants de leur lien : on journalise et on continue.
        console.error(`[liens] envoi de début de trimestre impossible pour ${m.userId} (période ${p.id})`, e);
      }
    }
    // Marqué même si certains envois ont échoué : réexpédier tout le trimestre demain pour rattraper
    // quelques cas enverrait un second lien à tous les autres. Les manquants se rattrapent à la main,
    // depuis la fiche de la personne.
    await db.period.update({ where: { id: p.id }, data: { liensEnvoyesLe: new Date() } });
  }
  return envoyes;
}

export async function renouvelerLiensExpirants(now = new Date()): Promise<number> {
  const bientot = await db.invitation.findMany({
    where: {
      revokedAt: null,
      expiresAt: { lt: new Date(now.getTime() + RENOUVELLEMENT_AVANT_MS) },
      // Sans adresse email, il n'y a rien à renouveler : le lien ne peut pas être envoyé
      user: { actif: true, email: { not: null } },
      period: { statut: { not: "CLOSE" } },
    },
    select: { id: true, userId: true, periodId: true, expiresAt: true },
  });
  if (bientot.length === 0) return 0;
  // Les renouvellements déjà émis (lien plus récent encore valide) sont relevés en une requête,
  // et non une par lien à renouveler : le balayage quotidien reste constant quel que soit l'effectif.
  const recents = await db.invitation.findMany({
    where: {
      revokedAt: null,
      expiresAt: { gte: new Date(now.getTime() + RENOUVELLEMENT_AVANT_MS) },
      userId: { in: [...new Set(bientot.map((i) => i.userId))] },
      periodId: { in: [...new Set(bientot.map((i) => i.periodId))] },
    },
    select: { userId: true, periodId: true },
  });
  const dejaRenouveles = new Set(recents.map((i) => `${i.userId}|${i.periodId}`));
  let n = 0;
  for (const inv of bientot) {
    if (dejaRenouveles.has(`${inv.userId}|${inv.periodId}`)) continue;
    try {
      // Balayage d'expiration : le lien change, les sessions restent. Déconnecter ici mettrait
      // tout le club dehors le même matin (voir `OptionsEnvoi`).
      if (!(await envoyerInvitation(inv.userId, inv.periodId, "renouvellement", { garderAnciens: true }))) continue;
    } catch (e) {
      console.error(`[liens] renouvellement impossible pour ${inv.userId} (période ${inv.periodId})`, e);
      continue;
    }
    // Le lien qui vient de partir couvre ce membre sur cette période : pas de second envoi dans le même passage
    dejaRenouveles.add(`${inv.userId}|${inv.periodId}`);
    n++;
  }
  return n;
}

/* ------------------------------------------------------------------------------------------------ */
/* Ce que « Mon profil » dit du lien de la personne connectée                                          */
/* ------------------------------------------------------------------------------------------------ */

/**
 * État du lien personnel de quelqu'un, tel que son profil l'affiche.
 *
 * Trois choses à savoir en lisant ceci :
 * - **le lien lui-même n'est pas lisible** : la base ne garde que son SHA-256 (`tokenHash`), rien ici
 *   ne peut donc le réafficher ni le renvoyer tel quel. « Renvoyer son lien » veut dire *en créer un
 *   nouveau* (`envoyerInvitation`), et l'ancien meurt aussitôt ;
 * - la validité n'est pas réécrite ici : ce sont les mêmes règles que `checkInvitation` (révoqué,
 *   expiré, sinon actif), lues sur le dernier lien de la période en cours ;
 * - sans période ouverte, il n'y a **rien à renvoyer** : un lien n'existe que pour une période.
 */
export type EtatLienPersonnel =
  /** Compte de connexion du portail : il n'a pas de lien personnel, et n'en aura jamais. */
  | { etat: "compte-de-service" }
  | { etat: "sans-email" }
  | { etat: "aucune-periode" }
  | { etat: "aucun"; periodId: string; periodeNom: string }
  | { etat: "revoque"; periodId: string; periodeNom: string; motif: MotifRevocation | null }
  | { etat: "expire"; periodId: string; periodeNom: string; expiresAt: Date }
  | { etat: "actif"; periodId: string; periodeNom: string; expiresAt: Date; ouvert: boolean };

export async function etatLienPersonnel(userId: string, now = new Date()): Promise<EtatLienPersonnel> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, service: true } });
  // Le compte du portail n'a pas de lien personnel (il se connecte par mot de passe + 2FA)…
  if (!user || !peutEtreInvite(user)) return { etat: "compte-de-service" };
  // …et sans adresse email, il n'y a nulle part où en envoyer un.
  if (!user.email) return { etat: "sans-email" };

  const periode = await db.period.findFirst({
    where: { statut: { not: "CLOSE" }, membres: { some: { userId } } },
    orderBy: { dateDebut: "desc" },
    select: { id: true, nom: true },
  });
  if (!periode) return { etat: "aucune-periode" };
  const repere = { periodId: periode.id, periodeNom: periode.nom };

  const inv = await db.invitation.findFirst({
    where: { userId, periodId: periode.id },
    orderBy: { createdAt: "desc" },
    select: { expiresAt: true, usedAt: true, revokedAt: true, motifRevocation: true },
  });
  if (!inv) return { etat: "aucun", ...repere };
  if (inv.revokedAt) return { etat: "revoque", ...repere, motif: (inv.motifRevocation as MotifRevocation | null) ?? null };
  if (inv.expiresAt.getTime() < now.getTime()) return { etat: "expire", ...repere, expiresAt: inv.expiresAt };
  return { etat: "actif", ...repere, expiresAt: inv.expiresAt, ouvert: !!inv.usedAt };
}

/**
 * Le plafond d'appareils est-il atteint ? (fonction pure)
 *
 * L'argument est le nombre de sessions **vivantes et ouvertes par le lien** — un appareil, une
 * session —, et non le cumul des ouvertures du lien, ni le nombre total de sessions de la
 * personne : voir `verifierAppareils`.
 */
export function lienSature(sessionsDuLien: number, max = maxAppareils()): boolean {
  return sessionsDuLien >= max;
}

/** Plafond effectif : LIEN_MAX_APPAREILS ne peut le relever qu'hors production (tests e2e, captures). */
function maxAppareils(): number {
  const v = Number(bequilleDev("LIEN_MAX_APPAREILS"));
  if (Number.isInteger(v) && v > 0) return v;
  return MAX_APPAREILS_PAR_LIEN;
}

/**
 * **Trois appareils, c'est trois sessions vivantes *ouvertes par le lien*.**
 *
 * Correction. Le plafond se lisait sur `Invitation.ouvertures`, qui compte **toutes** les
 * connexions faites avec ce lien depuis sa création. Or un lien vit quatre mois et une session
 * douze heures : quelqu'un qui n'a pas de mot de passe rouvre son lien chaque fois qu'il revient,
 * **depuis le même téléphone**. À la quatrième ouverture — quelques jours, pas quatre appareils —
 * son lien était révoqué, toutes ses sessions coupées, un nouveau lien envoyé, et une alerte « lien
 * utilisé sur plus de 3 appareils » partait au bureau ; puis cela recommençait toutes les trois
 * connexions. Le compteur mesurait la fidélité, pas la diffusion.
 *
 * On compte donc ce que le plafond annonce : **les sessions encore ouvertes**, une par appareil
 * (12 h glissantes). Trois téléphones font trois sessions ; un téléphone qui revient dix fois n'en
 * fait qu'une à la fois — la précédente a expiré, ou elle est simplement reprise
 * (`connexionParInvitation` : déjà connecté sur cet appareil, on entre sans rien compter). Le vrai
 * cas d'un lien diffusé, lui, est exactement celui-ci : trois sessions vivantes ailleurs, et une
 * quatrième qui s'ouvre.
 *
 * **Second correctif du même jour, après relecture adverse : encore fallait-il ne compter que les
 * sessions du lien.** La première version comptait *toutes* les sessions vivantes, quelle qu'en soit
 * la porte d'entrée. Or beaucoup de gens se connectent aussi au mot de passe, et une session dure
 * 12 h : le téléphone le matin, le portable l'après-midi, la tablette du club le soir — trois
 * sessions vivantes qui n'ont jamais touché au lien. La personne ouvrait ensuite son lien depuis sa
 * boîte mail : révocation, toutes ses sessions coupées, et une alerte au bureau annonçant un lien
 * « utilisé sur plus de 3 appareils » alors qu'il venait d'être ouvert **une** fois. Sans adresse
 * email, elle restait dehors jusqu'à ce qu'on lui recopie un lien à la main.
 *
 * `AuthSession.origine`, posée à la création de chaque session (`createSession`), dit par où l'on
 * est entré. Attention : **`forte` ne le dit pas** — la connexion n'élève jamais, une session
 * ouverte au mot de passe naît `forte = false` exactement comme celle du lien. Les sessions
 * antérieures à la migration ont `origine` à NULL (origine inconnue) : elles restent valables et ne
 * sont comptées nulle part. C'est un plafond momentanément plus large pendant leurs dernières
 * heures, et c'est le bon sens du compromis — mieux vaut ne pas révoquer que révoquer sur une
 * supposition.
 *
 * `Invitation.ouvertures` reste tenu à jour — c'est le suivi affiché sur la fiche du membre et le
 * rang de l'appareil dans le journal —, il ne décide simplement plus de rien ici.
 *
 * **Depuis, les appareils déjà connectés tombent aussi** (avant, ils gardaient leur session). Un
 * lien qui a posé plus de sessions que prévu est le symptôme d'un lien diffusé : le remplacer sans
 * couper ce qu'il a ouvert laisserait entrer qui en avait profité. Les trois appareils légitimes
 * rouvrent avec le nouveau lien, qui vient de partir par email. Retourne l'issue de la garde (voir
 * `IssueGardeLien`) : `"rien"` = le lien vit, on peut ouvrir une session.
 */
export async function verifierAppareils(invitation: { id: string; userId: string; periodId: string }, now = new Date()): Promise<IssueGardeLien> {
  // Deux filtres, et deux seulement — mais chacun retire un faux positif qui coûtait son accès à
  // quelqu'un :
  //  - `expiresAt > now` : une session expirée n'occupe plus d'appareil (la purge quotidienne efface
  //    les lignes mortes, mais le plafond ne doit pas dépendre de son passage) ;
  //  - `origine = "lien"` : **seules comptent les sessions ouvertes par le lien**. Compter toutes les
  //    sessions revenait à compter des appareils qui ne se servent pas du lien du tout.
  const sessionsDuLien = await db.authSession.count({
    where: { userId: invitation.userId, expiresAt: { gt: now }, origine: ORIGINE_COMPTEE },
  });
  if (!lienSature(sessionsDuLien)) return "rien";

  /*
   * **Avant de révoquer : par où cette personne reviendrait-elle ?**
   *
   * Cette garde ne protège personne si elle se déclenche à tort — elle ne fait que couper l'accès
   * d'un membre. On ne ferme donc une porte que si l'on peut en désigner une autre, ouverte :
   *  - un nouveau lien qui part vraiment : il faut une adresse email (l'adresse est facultative dans
   *    cet outil, et elle peut avoir été retirée de la fiche après l'envoi du lien) **et** une
   *    période encore ouverte (on n'émet pas de lien pour une période close) ;
   *  - ou un mot de passe, si la personne s'en est donné un — la page de connexion lui reste ouverte.
   * Sans ni l'un ni l'autre, révoquer mettrait quelqu'un dehors jusqu'à ce que le bureau lui recopie
   * un lien à la main. On laisse donc vivre le lien : une garde qui enferme dehors ne protège
   * personne, elle ne fait que coûter son accès à un membre.
   */
  const [compte, period] = await Promise.all([
    db.user.findUnique({ where: { id: invitation.userId }, select: { email: true, passwordHash: true } }),
    db.period.findUnique({ where: { id: invitation.periodId }, select: { statut: true } }),
  ]);
  const nouveauLienPossible = Boolean(compte?.email) && Boolean(period) && period?.statut !== "CLOSE";
  if (!nouveauLienPossible && !compte?.passwordHash) return "rien";

  await revokeInvitation(invitation.id, "APPAREILS");
  // Remplacement de sécurité : les appareils déjà connectés tombent avec l'ancien lien.
  const envoye = nouveauLienPossible && (await envoyerInvitation(invitation.userId, invitation.periodId, "appareils", { deconnecterAppareils: "tous" }));
  // Aucun lien n'est parti : `createInvitation` — qui porte la déconnexion — n'a pas été appelé, et
  // les sessions de l'ancien lien vivraient leurs 12 h. On ne relâche rien : le lien est mort, ce
  // qu'il a ouvert tombe avec lui. La personne revient par son mot de passe (c'est la condition
  // qu'on vient de vérifier pour en arriver ici).
  if (!envoye) await revokeAllSessions(invitation.userId);
  return envoye ? "remplace" : "remplace-sans-email";
}

/**
 * Anti-abus : à chaque ouverture réussie d'un lien, on compte. Au-delà du seuil (voir RATE_LIMITS.invitation_token :
 * 12 ouvertures par heure — un humain n'ouvre pas son lien à ce rythme), le lien est révoqué (SUSPECT) et un nouveau
 * lien part par email à la personne concernée. Retourne l'issue de la garde (`"rien"` = rien à signaler).
 *
 * **Révoquer un lien ne ferme rien tout seul**. La déconnexion des appareils est portée par
 * `createInvitation` — la fin de `envoyerInvitation` —, et `envoyerInvitation` **sort avant** d'y
 * arriver quand le compte n'a pas d'adresse email (un état parfaitement normal : effacer une
 * adresse ne révoque rien, voir `definirEmailMembre`). Sans adresse, ou sur une période close, le
 * lien était donc marqué SUSPECT et **aucune session n'était fermée** : comme `touchSession` est
 * une fenêtre *glissante* de 12 h, un porteur qui ouvre l'application une fois par demi-journée
 * gardait son accès indéfiniment sur un lien révoqué pour diffusion — exactement le cas pour lequel
 * la règle existe. Même remède que chez la jumelle `verifierAppareils` : si aucun lien de
 * remplacement n'est parti, on coupe les sessions nous-mêmes.
 *
 * **Et ici, on révoque même quand personne ne peut revenir** — contrairement au plafond
 * d'appareils, qui ne ferme une porte que s'il peut en désigner une autre. Douze ouvertures en une
 * heure ne sont pas un usage maladroit, c'est un lien qui circule : on le coupe, et la personne
 * repasse par l'équipe. L'écran d'après le lui dit (`/connexion?erreur=suspect-sans-email`).
 */
export async function signalerOuverture(invitation: { id: string; userId: string; periodId: string; tokenHash: string }): Promise<IssueGardeLien> {
  if (await checkRateLimit("invitation_token", invitation.tokenHash)) return "rien";
  await revokeInvitation(invitation.id, "SUSPECT");
  const period = await db.period.findUnique({ where: { id: invitation.periodId }, select: { statut: true } });
  // Lien jugé suspect : on coupe tout, c'est exactement le cas pour lequel la règle existe.
  const envoye =
    Boolean(period) &&
    period?.statut !== "CLOSE" &&
    (await envoyerInvitation(invitation.userId, invitation.periodId, "securite", { deconnecterAppareils: "tous" }));
  // Aucun lien n'est parti (pas d'adresse, ou période close) : `createInvitation`, qui porte la
  // déconnexion, n'a pas été appelé. On ne laisse rien ouvert derrière un lien jugé diffusé.
  if (!envoye) await revokeAllSessions(invitation.userId);
  return envoye ? "remplace" : "remplace-sans-email";
}
