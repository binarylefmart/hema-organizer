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
import { signalerDesistementTardif } from "@/lib/notifications/desistement";
import { can } from "@/lib/permissions";
import { presenceAutruiSchema, presencesEnMasseSchema } from "@/lib/validation/presences";
import { phraseCours, planReponse, seancesPresentesApres, succesReponse } from "@/components/seances/reponse-periode";
import { effacerChoixSiAbsent } from "@/lib/choix-cours";
import { natureChoisissable } from "@/components/seances/choix-cours";
import { getChoixCoursActif } from "@/lib/settings";

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

  /*
   * **La réponse d'avant, pour l'alerte « désistement de dernière minute »** — et pour elle seule.
   * Une lecture qui échoue vaut « sans réponse » : on se prive d'une alerte, jamais de la réponse.
   */
  const avant = await reponseAvant(user.id, sessionId);
  await db.attendance.upsert({
    where: { userId_sessionId: { userId: user.id, sessionId } },
    create: { userId: user.id, sessionId, statut },
    update: { statut },
  });
  await effacerChoixSiAbsent([user.id], [sessionId], statut);
  /*
   * **Après l'écriture, et sans pouvoir la défaire** : `signalerDesistementTardif` ne lève jamais,
   * et décide seul (transition, fenêtre de deux heures, séance, préférences). Seul ce chemin — le
   * membre qui répond pour lui-même — l'appelle : une correction du bureau n'annonce rien.
   */
  await signalerDesistementTardif({ sessionId, userId: user.id, avant, apres: statut });
  await touchSession();
  revalidatePath("/seances");
  revalidatePath("/");
  return { ok: true, statut };
}

/** La réponse enregistrée avant celle-ci, ou `null` (sans réponse, ou lecture impossible). */
async function reponseAvant(userId: string, sessionId: string): Promise<string | null> {
  try {
    return (await db.attendance.findUnique({ where: { userId_sessionId: { userId, sessionId } }, select: { statut: true } }))?.statut ?? null;
  } catch {
    return null;
  }
}

const reponsePeriodeSchema = z.object({
  periodId: z.string().min(1).max(64),
  statut: z.enum(ATTENDANCE_STATUTS),
  garderReponses: z.boolean(),
  /** Dates précises (« Choisir des dates ») ; absent = toutes les séances à venir de la période. */
  seanceIds: z.array(z.string().min(1).max(64)).min(1).max(200).optional(),
  /** Cours à cocher en même temps (choix des cours ouvert, réponse « Présent ») ; jamais de décochage. */
  partieIds: z.array(z.string().min(1).max(64)).max(1000).optional(),
});

/**
 * **Répondre pour toutes les séances à venir d'une période**, en un geste (retours du club d'Arras).
 *
 * Les verrous sont ceux d'`indiquerPresence`, lus une fois pour la période : `attendances.own`,
 * période ACTIVE, membre invité. Les séances annulées, commencées ou passées sont **ignorées** — ce
 * sont celles où la réponse à l'unité serait refusée. Avec `garderReponses` (coché par défaut à
 * l'écran), une réponse déjà donnée n'est pas touchée ; sans lui, elle est remplacée. Le tri est
 * celui de l'écran (`planReponse`), refait ici sur les lectures du serveur.
 *
 * **Les notifications : celles de la réponse à l'unité, pas une de plus.** Une réponse ne prévient
 * personne, sauf le désistement de dernière minute — qui ne concerne qu'une séance dans les deux
 * heures : `signalerDesistementTardif` est appelé pour chaque réponse remplacée, et décide seul (il
 * écarte en une lecture légère tout ce qui n'est pas dans la fenêtre).
 *
 * **Des dates précises** (`seanceIds`) restreignent le geste à ces séances-là, avec les mêmes verrous :
 * un identifiant qui n'est pas une séance de la période ne touche rien, une séance annulée ou
 * commencée reste ignorée.
 */
export async function repondrePourLaPeriode(input: {
  periodId: string;
  statut: string;
  garderReponses: boolean;
  seanceIds?: string[];
  partieIds?: string[];
}): Promise<{ succes?: string; erreur?: string }> {
  const user = await getCurrentUser();
  if (!user || !can(user, "attendances.own")) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  const parsed = reponsePeriodeSchema.safeParse(input);
  if (!parsed.success) return { erreur: "Réponse non reconnue." };
  const { periodId, statut, garderReponses, seanceIds, partieIds } = parsed.data;

  const periode = await db.period.findUnique({
    where: { id: periodId },
    select: { statut: true, membres: { where: { userId: user.id }, select: { userId: true } } },
  });
  if (!periode || periode.statut !== "ACTIVE" || periode.membres.length === 0) return { erreur: "Cette période n'est pas disponible." };

  const seances = await db.session.findMany({
    where: { periodId },
    select: { id: true, date: true, heureDebut: true, annulee: true, attendances: { where: { userId: user.id }, select: { statut: true } } },
  });
  const lues = seances.map((s) => ({
    id: s.id,
    annulee: s.annulee,
    commencee: seanceCommencee(s.date, s.heureDebut),
    monStatut: s.attendances[0]?.statut ?? null,
  }));
  const portee = seanceIds ? new Set(seanceIds) : undefined;
  const plan = planReponse(lues, statut, garderReponses, portee);
  const cours = partieIds?.length ? await coursAAjouter(user.id, periodId, seancesPresentesApres(lues, statut, garderReponses, portee), partieIds) : [];
  if (plan.aEcrire.length > 0 || cours.length > 0) {
    await db.$transaction(
      plan.aEcrire.map((sessionId) =>
        db.attendance.upsert({
          where: { userId_sessionId: { userId: user.id, sessionId } },
          create: { userId: user.id, sessionId, statut },
          update: { statut },
        }),
      ),
    );
    await effacerChoixSiAbsent([user.id], plan.aEcrire, statut);
    // Après les réponses : un cours ne se coche que sur une séance où l'on est « Présent ».
    if (cours.length > 0)
      await db.$transaction(
        cours.map((partieId) => db.attendanceChoix.upsert({ where: { userId_partieId: { userId: user.id, partieId } }, create: { userId: user.id, partieId }, update: {} })),
      );
    const avant = new Map(lues.map((s) => [s.id, s.monStatut]));
    for (const sessionId of plan.aEcrire) {
      const precedent = avant.get(sessionId) ?? null;
      if (precedent !== null) await signalerDesistementTardif({ sessionId, userId: user.id, avant: precedent, apres: statut });
    }
    await touchSession();
    revalidatePath("/seances");
    revalidatePath("/");
  }
  if (plan.aEcrire.length === 0 && cours.length > 0) return { succes: `C'est noté : ${phraseCours(cours.length, true)}` };
  return { succes: [succesReponse(statut, plan), phraseCours(cours.length, true)].filter(Boolean).join(" ") };
}

/**
 * **Les cours à cocher pour de bon**, parmi ceux que l'écran demande : le club a ouvert le choix des
 * cours ; l'élément appartient à une séance de cette période où la personne sera « Présent » après le
 * geste (`seancesPresentesApres` — donc ni annulée, ni commencée, ni hors des dates choisies) ; c'est
 * un cours, une option ou un atelier ; et il n'est pas déjà choisi. Le reste est ignoré en silence,
 * comme une date choisie devenue annulée.
 */
async function coursAAjouter(userId: string, periodId: string, seancesPresentes: readonly string[], partieIds: readonly string[]): Promise<string[]> {
  if (seancesPresentes.length === 0 || !(await getChoixCoursActif())) return [];
  const parties = await db.sessionPartie.findMany({
    where: { id: { in: [...new Set(partieIds)] }, sessionId: { in: [...seancesPresentes] }, session: { periodId } },
    select: { id: true, nature: true, choix: { where: { userId }, select: { userId: true } } },
  });
  return parties.filter((p) => natureChoisissable(p.nature) && p.choix.length === 0).map((p) => p.id);
}

const choixCoursSchema = z.object({ partieId: z.string().min(1).max(64), choisi: z.boolean() });

/**
 * **Choisir (ou ne plus choisir) un cours** d'une séance où l'on a répondu « Présent » — facultatif,
 * plusieurs par séance (retours du club d'Arras). Les verrous sont ceux d'`indiquerPresence` (période
 * active, membre invité, séance ni annulée ni commencée), plus trois : le club a ouvert le réglage,
 * l'élément est un cours, une option ou un atelier (jamais l'échauffement), et la réponse de la
 * personne à cette séance est « Présent ». Aucun journal, aucune notification : comme une réponse.
 */
export async function choisirCours(input: { partieId: string; choisi: boolean }): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const user = await getCurrentUser();
  if (!user || !can(user, "attendances.own")) return { ok: false, erreur: "Ta session a expiré. Reconnecte-toi." };
  const parsed = choixCoursSchema.safeParse(input);
  if (!parsed.success) return { ok: false, erreur: "Choix non reconnu." };
  if (!(await getChoixCoursActif())) return { ok: false, erreur: "Le choix des cours n'est pas ouvert par le club." };
  const { partieId, choisi } = parsed.data;

  const partie = await db.sessionPartie.findUnique({
    where: { id: partieId },
    select: {
      nature: true,
      session: {
        select: {
          id: true,
          date: true,
          heureDebut: true,
          annulee: true,
          period: { select: { statut: true, membres: { where: { userId: user.id }, select: { userId: true } } } },
          attendances: { where: { userId: user.id }, select: { statut: true } },
        },
      },
    },
  });
  if (!partie || !natureChoisissable(partie.nature)) return { ok: false, erreur: "Ce cours ne se choisit pas." };
  const s = partie.session;
  if (s.period.statut !== "ACTIVE" || s.period.membres.length === 0) return { ok: false, erreur: "Cette séance n'est pas disponible." };
  if (s.annulee) return { ok: false, erreur: "Cette séance est annulée." };
  if (seanceCommencee(s.date, s.heureDebut)) return { ok: false, erreur: "Le cours a déjà commencé : le choix n'est plus modifiable." };
  if (s.attendances[0]?.statut !== "PRESENT") return { ok: false, erreur: "Réponds d'abord « Présent » pour choisir tes cours." };

  if (choisi) {
    await db.attendanceChoix.upsert({ where: { userId_partieId: { userId: user.id, partieId } }, create: { userId: user.id, partieId }, update: {} });
  } else {
    await db.attendanceChoix.deleteMany({ where: { userId: user.id, partieId } });
  }
  await touchSession();
  revalidatePath("/seances");
  revalidatePath(`/seances/${s.id}`);
  revalidatePath("/");
  return { ok: true };
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
  await effacerChoixSiAbsent([userId], [sessionId], statut);
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

  await effacerChoixSiAbsent(aEcrire, [sessionId], statut);
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
