"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { AccesRefuse, assertPermission, getCurrentUser } from "@/lib/auth/current-user";
import { touchSession } from "@/lib/auth/session";
import { toucherElevation } from "@/lib/auth/elevation";
import { audit } from "@/lib/audit";
import { ATTENDANCE_STATUTS, ecritureFermee, REFUS_PERIODE_CLOSE } from "@/lib/constants";
import { seanceCommencee } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { presenceAutruiSchema, presencesEnMasseSchema } from "@/lib/validation/presences";

const schema = z.object({
  sessionId: z.string().min(1).max(64),
  statut: z.enum(ATTENDANCE_STATUTS),
});

export type ResultatPresence = { ok: true; statut: string } | { ok: false; erreur: string };

/**
 * **Le refus, dit de façon utile**. Depuis que `attendances.autrui` exige l'espace admin ouvert,
 * `assertPermission` lève pour **deux** raisons qui ne se corrigent pas du tout pareil : « ce n'est
 * pas ton geste » (un instructeur) ne se répare pas, « il te manque l'élévation » se répare en dix
 * secondes. Un seul message pour les deux enverrait le bureau chercher un droit qu'il a déjà.
 */
function refusCorrection(user: Parameters<typeof can>[0]): string {
  return can(user, "attendances.autrui")
    ? "Pour corriger une réponse, ouvre l'espace admin : ton mot de passe et ton code à usage unique."
    : "Tu n'as pas le droit de modifier la réponse de quelqu'un d'autre.";
}

/**
 * Enregistre (ou modifie) la réponse du membre connecté pour une séance.
 * Conditions : invité sur la période, séance non annulée, cours pas encore commencé.
 */
export async function indiquerPresence(input: { sessionId: string; statut: string }): Promise<ResultatPresence> {
  const user = await getCurrentUser();
  if (!user || !can(user, "attendances.own")) return { ok: false, erreur: "Ta session a expiré. Reconnecte-toi." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, erreur: "Réponse non reconnue." };
  const { sessionId, statut } = parsed.data;

  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: { period: { include: { membres: { where: { userId: user.id } } } } },
  });
  if (!session || session.period.statut !== "ACTIVE" || session.period.membres.length === 0) {
    return { ok: false, erreur: "Cette séance n'est pas disponible." };
  }
  if (session.annulee) return { ok: false, erreur: "Cette séance est annulée." };
  if (seanceCommencee(session.date, session.heureDebut)) {
    return { ok: false, erreur: "Le cours a déjà commencé : la réponse n'est plus modifiable." };
  }

  await db.attendance.upsert({
    where: { userId_sessionId: { userId: user.id, sessionId } },
    create: { userId: user.id, sessionId, statut },
    update: { statut },
  });
  await touchSession();
  revalidatePath("/seances");
  revalidatePath("/");
  return { ok: true, statut };
}

export type ResultatPresenceAutrui = { ok: true; statut: string | null } | { ok: false; erreur: string };

/**
 * Corrige la réponse **de quelqu'un d'autre** pour une séance (ADMIN uniquement).
 * Sert à tenir le registre à jour quand la vie réelle et l'application divergent : quelqu'un est
 * venu sans jamais répondre, s'est décommandé par message, a répondu depuis le téléphone d'un autre.
 * Le passage à « sans réponse » (statut null) efface la ligne : on distingue « n'a rien dit » de
 * « a dit non », et seule l'absence de ligne exprime la première.
 */
export async function modifierPresenceMembre(input: {
  sessionId: string;
  userId: string;
  statut: string | null;
}): Promise<ResultatPresenceAutrui> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, erreur: "Ta session a expiré. Reconnecte-toi." };
  try {
    /*
     * `assertPermission` plutôt qu'un `can()` recopié : la matrice est seule à décider, **session
     * forte comprise** — et c'est ce qui a fait tout le travail, quand `attendances.autrui` est
     * sortie de `SANS_SESSION_FORTE`. Le verrou s'est posé à **un** endroit, sur la permission, et
     * les deux écrans qui corrigent l'ont suivi sans qu'on les touche. Un `can()` recopié ici
     * aurait continué d'ouvrir la porte, en silence.
     */
    await assertPermission("attendances.autrui");
  } catch (e) {
    if (!(e instanceof AccesRefuse)) throw e;
    return { ok: false, erreur: refusCorrection(user) };
  }
  const parsed = presenceAutruiSchema.safeParse(input);
  if (!parsed.success) return { ok: false, erreur: "Réponse non reconnue." };
  const { sessionId, userId, statut } = parsed.data;

  const session = await db.session.findUnique({
    where: { id: sessionId },
    // Le statut de la période part avec la séance : c'est lui qui dit si le registre est encore
    // ouvert (voir `REFUS_PERIODE_CLOSE.presences`), et il ne coûte pas une requête de plus.
    select: { periodId: true, annulee: true, period: { select: { statut: true } } },
  });
  if (!session) return { ok: false, erreur: "Cette séance n'existe plus." };
  if (ecritureFermee(session.period.statut)) return { ok: false, erreur: REFUS_PERIODE_CLOSE.presences };
  if (session.annulee) return { ok: false, erreur: "Cette séance est annulée : les réponses n'ont plus de sens." };

  // La personne doit être invitée sur la période de la séance — et être une personne du club :
  // le compte de service du portail n'apparaît dans aucune liste nominative, il n'a pas de présence.
  const invite = await db.periodMember.findFirst({
    where: { periodId: session.periodId, userId, user: { service: false } },
    select: { userId: true },
  });
  if (!invite) return { ok: false, erreur: "Cette personne n'est pas invitée sur cette période." };

  // Volontairement PAS de contrôle `seanceCommencee` ici, contrairement à `indiquerPresence` :
  // c'est précisément après le cours que le bureau corrige le registre (« untel est venu sans
  // répondre »). Rétablir la garde « par symétrie » viderait la fonctionnalité de son intérêt.

  const avant = (await db.attendance.findUnique({ where: { userId_sessionId: { userId, sessionId } }, select: { statut: true } }))?.statut ?? null;
  if (statut === null) {
    // deleteMany plutôt que delete : effacer une réponse qui n'existait pas n'est pas une erreur.
    await db.attendance.deleteMany({ where: { userId, sessionId } });
  } else {
    await db.attendance.upsert({
      where: { userId_sessionId: { userId, sessionId } },
      create: { userId, sessionId, statut },
      update: { statut },
    });
  }
  // Écrire à la place de quelqu'un se justifie toujours après coup : la trace nomme l'acteur,
  // la personne visée et ce qui a été remplacé.
  await audit(user, "presence.modifiee_par_admin", userId, { sessionId, avant, apres: statut });

  await touchSession();
  /*
   * **Tenir le registre est une activité d'espace admin**, au même titre que le durcissement de
   * `attendances.autrui`. L'élévation tombe après dix minutes sans geste dans `/admin/**` ; or on
   * corrige le plus souvent depuis la **fiche d'une séance**, qui n'en fait pas partie. Sans cette
   * ligne, le verrou renverrait sur `/connexion/admin` **au milieu d'une liste**, un quart d'heure
   * après le début du cours.
   */
  await toucherElevation(user.sessionId);
  rafraichirApresCorrection(sessionId);
  return { ok: true, statut };
}

/**
 * **Les écrans qu'une correction de registre périme**, listés une seule fois.
 *
 * La correction unitaire et la correction en masse écrivent la même chose : elles doivent rendre
 * caduques exactement les mêmes pages, sinon le taux affiché sur le tableau de bord dépendrait de
 * la façon dont la réponse a été saisie.
 *
 * **`/admin/presences` en fait partie, et c'est l'écran d'où la correction part.** Il y manquait :
 * la page gardait donc les réponses d'avant, et le panneau n'affichait juste que parce qu'il gardait
 * ses corrections en mémoire — mémoire qui, elle, ne se purgeait jamais (voir
 * `oublierCorrectionsArrivees`). Les deux vont ensemble : le panneau retombe désormais sur ce que dit
 * le serveur dès qu'une écriture est revenue, ce qui n'a de sens que si le serveur a relu la base.
 * L'ordre des lignes, lui, ne bouge pas pour autant : il est figé à l'ouverture (`selonOrdreFige`),
 * exactement comme sur la fiche de séance, qui est revalidée depuis toujours.
 */
function rafraichirApresCorrection(sessionId: string): void {
  revalidatePath("/seances");
  revalidatePath("/");
  revalidatePath("/planning");
  revalidatePath(`/seances/${sessionId}`);
  revalidatePath("/gestion/tableau-de-bord");
  revalidatePath("/admin/presences");
}

export type ResultatPresencesEnMasse =
  | { ok: true; statut: string | null; modifiees: number; inchangees: number }
  | { ok: false; erreur: string };

/**
 * Corrige la réponse **de plusieurs personnes d'un coup** (ADMIN uniquement).
 *
 * ## Pourquoi
 *
 * Demande de Delta. Dans un club de quatre-vingts, une séance arrive avec quarante-six à
 * cinquante-cinq personnes **sans réponse**, et le bureau qui relève la feuille de présence à la
 * main devait toucher une liste déroulante par personne, cinquante fois. Le registre finissait par
 * ne plus être tenu — et c'est lui qui nourrit tous les taux du club.
 *
 * ## Les mêmes verrous que la correction unitaire, à la lettre
 *
 * `attendances.autrui`, séance existante, séance non annulée, personnes **invitées sur la période**
 * de la séance et non « de service ». Aucun verrou en plus, aucun en moins : deux chemins d'écriture
 * aux règles différentes, c'est une porte dérobée d'un côté ou une fonctionnalité morte de l'autre.
 * En particulier, **pas** de `seanceCommencee` — corriger après le cours est tout l'intérêt —, et
 * pas de contrôle sur le statut de la période : la correction unitaire n'en a pas, et l'écran
 * `/admin/presences` ne propose déjà que les séances des trimestres ouverts.
 *
 * ## Tout ou rien
 *
 * Si **une seule** personne du lot n'est pas invitée sur la période, le lot entier est refusé. Le
 * bureau a compté quatorze noms : en corriger treize en silence produirait un registre faux dont
 * personne ne saurait qu'il l'est.
 *
 * ## Une seule transaction, une entrée de journal par personne
 *
 * Toutes les écritures partent dans un unique `$transaction` : un lot à moitié appliqué serait
 * pire qu'un lot refusé. Le **journal**, lui, reste nominatif — une entrée par personne, la même
 * action (`presence.modifiee_par_admin`) que la correction unitaire, pour qu'un seul filtre
 * retrouve tout ce qui a été écrit à la place de quelqu'un, quelle que soit la façon de le saisir.
 * Les entrées sont écrites **après** le commit et **hors** transaction : `audit()` ne lève jamais
 * (le journal ne doit pas bloquer l'application), et une correction ne doit pas être annulée parce
 * que sa trace a échoué. Seules les personnes **réellement modifiées** y figurent : une ligne
 * « avant = après » ne tranche aucun désaccord et noierait les vraies sous cinquante-cinq entrées.
 *
 * ## Notifications : rien ne part, et c'est délibéré
 *
 * La correction unitaire n'envoie **aucune** notification (voir `modifierPresenceMembre` : elle
 * journalise et revalide, rien d'autre) — écrire à la place de quelqu'un n'est pas une nouvelle à
 * annoncer, et le seul message que l'application envoie sur une présence est le rappel de la veille,
 * piloté par le cron. La version en masse n'en envoie donc pas davantage. Si un jour la correction
 * unitaire devait prévenir la personne concernée, cette action **ne devrait pas** se contenter de
 * l'appeler cinquante-cinq fois : cinquante-cinq emails partis d'un seul clic sont un incident, pas
 * une notification. Il faudrait un message unique et collectif, ou rien.
 */
export async function modifierPresencesEnMasse(input: {
  sessionId: string;
  userIds: string[];
  statut: string | null;
}): Promise<ResultatPresencesEnMasse> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, erreur: "Ta session a expiré. Reconnecte-toi." };
  try {
    await assertPermission("attendances.autrui");
  } catch (e) {
    if (!(e instanceof AccesRefuse)) throw e;
    return { ok: false, erreur: refusCorrection(user) };
  }
  const parsed = presencesEnMasseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, erreur: "Sélection ou réponse non reconnue." };
  const { sessionId, userIds, statut } = parsed.data;

  const session = await db.session.findUnique({
    where: { id: sessionId },
    // Le statut de la période part avec la séance : c'est lui qui dit si le registre est encore
    // ouvert (voir `REFUS_PERIODE_CLOSE.presences`), et il ne coûte pas une requête de plus.
    select: { periodId: true, annulee: true, period: { select: { statut: true } } },
  });
  if (!session) return { ok: false, erreur: "Cette séance n'existe plus." };
  if (ecritureFermee(session.period.statut)) return { ok: false, erreur: REFUS_PERIODE_CLOSE.presences };
  if (session.annulee) return { ok: false, erreur: "Cette séance est annulée : les réponses n'ont plus de sens." };

  // Une seule requête pour tout le lot, et le compte doit tomber juste (voir « tout ou rien »).
  const invites = await db.periodMember.findMany({
    where: { periodId: session.periodId, userId: { in: userIds }, user: { service: false } },
    select: { userId: true },
  });
  if (invites.length !== userIds.length) {
    return { ok: false, erreur: "Une partie de la sélection n'est pas invitée sur cette période. Recharge l'écran et recommence." };
  }

  // L'état d'avant, pour le journal **et** pour ne rien écrire d'inutile : repasser « Présent »
  // quelqu'un qui l'est déjà coûterait une écriture et une ligne de journal pour rien.
  const existantes = await db.attendance.findMany({ where: { sessionId, userId: { in: userIds } }, select: { userId: true, statut: true } });
  const avantParUser = new Map(existantes.map((a) => [a.userId, a.statut as string]));
  const aEcrire = userIds.filter((userId) => (avantParUser.get(userId) ?? null) !== statut);
  const inchangees = userIds.length - aEcrire.length;
  if (aEcrire.length === 0) return { ok: true, statut, modifiees: 0, inchangees };

  if (statut === null) {
    // Un seul `deleteMany` pour tout le lot : effacer une réponse qui n'existait pas n'est pas une
    // erreur, et `aEcrire` ne contient de toute façon que ceux qui en avaient une.
    await db.$transaction([db.attendance.deleteMany({ where: { sessionId, userId: { in: aEcrire } } })]);
  } else {
    // Prisma n'a pas d'« upsert de masse » : on empile les opérations et c'est `$transaction` qui
    // en fait un seul aller-retour atomique.
    await db.$transaction(
      aEcrire.map((userId) =>
        db.attendance.upsert({
          where: { userId_sessionId: { userId, sessionId } },
          create: { userId, sessionId, statut },
          update: { statut },
        }),
      ),
    );
  }

  for (const userId of aEcrire) {
    await audit(user, "presence.modifiee_par_admin", userId, { sessionId, avant: avantParUser.get(userId) ?? null, apres: statut, enMasse: true });
  }

  await touchSession();
  /*
   * **Tenir le registre est une activité d'espace admin**, au même titre que le durcissement de
   * `attendances.autrui`. L'élévation tombe après dix minutes sans geste dans `/admin/**` ; or on
   * corrige le plus souvent depuis la **fiche d'une séance**, qui n'en fait pas partie. Sans cette
   * ligne, le verrou renverrait sur `/connexion/admin` **au milieu d'une liste**, un quart d'heure
   * après le début du cours.
   */
  await toucherElevation(user.sessionId);
  rafraichirApresCorrection(sessionId);
  return { ok: true, statut, modifiees: aEcrire.length, inchangees };
}
