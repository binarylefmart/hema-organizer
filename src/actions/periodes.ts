"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPermission, exigerReauth } from "@/lib/auth/current-user";
import { cleSeance, genererSeances } from "@/lib/periodes";
import { conditionLiensARevoquer, ERREUR_COMPTE_SERVICE, envoyerInvitation, LIENS_AVANT_DEBUT_JOURS, remettreEnServiceLiensDeCloture, revokeInvitation } from "@/lib/invitations";
import { joursAvant, todayIso } from "@/lib/dates";
import { estCompteDeService, peutEtreInvite } from "@/lib/permissions";
import { messageSansEmail } from "@/lib/membres";
import { partiesInitiales } from "@/lib/planning";
import { champ, zodToFormState, type FormState } from "@/lib/form";
import { creneauSchema, generationSchema, periodeSchema, retraitSeancesSchema } from "@/lib/validation/gestion";
import { ecritureFermee, REFUS_PERIODE_CLOSE } from "@/lib/constants";

function rafraichir(periodId?: string) {
  revalidatePath("/admin/periodes");
  if (periodId) revalidatePath(`/admin/periodes/${periodId}`);
  revalidatePath("/seances");
  revalidatePath("/");
}

export async function creerPeriode(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("periods.manage");
  const parsed = periodeSchema.safeParse({ nom: champ(fd, "nom"), dateDebut: champ(fd, "dateDebut"), dateFin: champ(fd, "dateFin") });
  if (!parsed.success) return zodToFormState(parsed.error);
  // Créneaux et instructeurs par défaut repris de la période la plus récente
  const precedente = await db.period.findFirst({ orderBy: { dateDebut: "desc" }, include: { creneaux: true, instructeurs: true } });
  const period = await db.period.create({
    data: {
      ...parsed.data,
      creneaux: { create: (precedente?.creneaux ?? []).map((c) => ({ jourSemaine: c.jourSemaine, heureDebut: c.heureDebut, heureFin: c.heureFin, lieu: c.lieu, adresse: c.adresse })) },
      instructeurs: { create: (precedente?.instructeurs ?? []).map((i) => ({ userId: i.userId })) },
    },
  });
  await audit(user, "periode.creee", period.id, { nom: period.nom });
  rafraichir();
  redirect(`/admin/periodes/${period.id}`);
}

export async function modifierPeriode(periodId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("periods.manage");
  const parsed = periodeSchema.safeParse({ nom: champ(fd, "nom"), dateDebut: champ(fd, "dateDebut"), dateFin: champ(fd, "dateFin") });
  if (!parsed.success) return zodToFormState(parsed.error);
  await db.period.update({ where: { id: periodId }, data: parsed.data });
  await audit(user, "periode.modifiee", periodId, parsed.data);
  rafraichir(periodId);
  return { succes: "Période enregistrée." };
}

export async function ajouterCreneau(periodId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("periods.manage");
  const parsed = creneauSchema.safeParse({
    jourSemaine: champ(fd, "jourSemaine"),
    heureDebut: champ(fd, "heureDebut"),
    heureFin: champ(fd, "heureFin"),
    lieu: champ(fd, "lieu"),
    adresse: champ(fd, "adresse"),
  });
  if (!parsed.success) return zodToFormState(parsed.error);
  await db.creneau.create({ data: { periodId, ...parsed.data } });
  await audit(user, "periode.creneau_ajoute", periodId, parsed.data);
  rafraichir(periodId);
  return { succes: "Créneau ajouté." };
}

export async function supprimerCreneau(creneauId: string): Promise<void> {
  const user = await assertPermission("periods.manage");
  const c = await db.creneau.delete({ where: { id: creneauId } });
  await audit(user, "periode.creneau_supprime", c.periodId, { jourSemaine: c.jourSemaine, heureDebut: c.heureDebut });
  rafraichir(c.periodId);
}

export async function definirInstructeursPeriode(periodId: string, userIds: string[]): Promise<void> {
  const user = await assertPermission("periods.manage");
  const demandes = z.array(z.string().min(1)).max(50).parse(userIds);
  // Le compte de connexion du portail n'anime aucun cours : il ne peut pas devenir instructeur d'une période
  const personnes = await db.user.findMany({ where: { id: { in: demandes }, service: false }, select: { id: true } });
  const ids = personnes.map((p) => p.id);
  await db.$transaction([
    db.periodInstructeur.deleteMany({ where: { periodId } }),
    db.periodInstructeur.createMany({ data: ids.map((userId) => ({ periodId, userId })) }),
  ]);
  await audit(user, "periode.instructeurs", periodId, { userIds: ids });
  rafraichir(periodId);
}

/** Ajoute des membres à la période, **sans envoyer de lien** : l'invitation part d'un bouton, quand l'équipe le décide. */
export async function ajouterMembresPeriode(periodId: string, userIds: string[]): Promise<{ ajoutes: number }> {
  const user = await assertPermission("periods.manage");
  const demandes = z.array(z.string().min(1)).max(500).parse(userIds);
  // Le compte de connexion du portail n'est pas une personne du club : il n'est jamais invité à une période
  const personnes = await db.user.findMany({ where: { id: { in: demandes }, service: false }, select: { id: true } });
  const ids = personnes.map((p) => p.id);
  // La période doit exister : un identifiant périmé échoue ici plutôt que sur une contrainte de clé étrangère.
  await db.period.findUniqueOrThrow({ where: { id: periodId }, select: { id: true } });
  let ajoutes = 0;
  for (const userId of ids) {
    const existant = await db.periodMember.findUnique({ where: { periodId_userId: { periodId, userId } } });
    if (existant) continue;
    await db.periodMember.create({ data: { periodId, userId } });
    ajoutes++;
  }
  await audit(user, "periode.membres_ajoutes", periodId, { nombre: ajoutes });
  rafraichir(periodId);
  return { ajoutes };
}

/**
 * **Retirer quelqu'un du trimestre emporte ses réponses sur les séances de ce trimestre.**
 *
 * La base ne le fera jamais toute seule : `Attendance` pend à `User` et à `Session`, pas à
 * `PeriodMember` — sortir quelqu'un de la période ne coupe aucune de ces deux attaches. Ses
 * « Présent » restaient donc derrière lui, dans le numérateur de tous les taux, pendant qu'il
 * quittait le dénominateur (l'effectif invité). D'où les « 12 présents sur 11 » et les 109 %, et
 * d'où des « sans réponse » qui s'évaporaient des compteurs (`invites - repondu` passant sous zéro)
 * tout en restant nommés dans les listes. Le même écart se propageait au planning, au tableau de
 * bord, à l'export CSV et aux pages publiques.
 *
 * L'effacement part **dans la même transaction** que le retrait : un retrait enregistré sans son
 * effacement rouvrirait exactement le trou qu'on vient de boucher. Et il est borné aux séances de
 * **cette** période : ses réponses des autres trimestres ne regardent pas celui-ci, elle y est
 * toujours invitée.
 *
 * Les écrêtages qui masquaient le symptôme (`partDesInvites` plafonne à 100, `compteursDepuisTotaux`
 * plancherise les « sans réponse ») restent en place, mais comme garde-fous d'affichage pour les
 * données d'avant ce correctif — aucun calcul ne s'appuie sur eux pour être juste.
 */
export async function retirerMembrePeriode(periodId: string, userId: string): Promise<void> {
  const user = await assertPermission("periods.manage");
  const maintenant = new Date();
  await db.$transaction([
    db.periodMember.deleteMany({ where: { periodId, userId } }),
    db.attendance.deleteMany({ where: { userId, session: { periodId } } }),
    /*
     * **Ré-estampiller, et pas seulement révoquer ce qui est encore vivant.** Le filtre était
     * `revokedAt: null` : un lien que la clôture de ce trimestre avait déjà fermé était sauté, et
     * gardait son motif `CLOTURE` — or `remettreEnServiceLiensDeCloture` rend précisément ces
     * liens-là quand on rouvre la période. Sortir quelqu'un d'un trimestre clos puis le rouvrir
     * lui rendait donc son accès. `conditionLiensARevoquer` (src/lib/invitations.ts) couvre les
     * deux cas et laisse intactes les révocations de sécurité, qui ferment plus fort.
     */
    db.invitation.updateMany({
      where: { periodId, userId, ...conditionLiensARevoquer(maintenant) },
      data: { revokedAt: maintenant, motifRevocation: "MANUEL" },
    }),
  ]);
  await audit(user, "periode.membre_retire", periodId, { userId });
  rafraichir(periodId);
}

/**
 * Génère les séances cochées (dates proposées à partir des créneaux ; les séances existantes sont
 * conservées), **et retient celles qu'on a décochées**.
 *
 * C'était le trou du geste : l'écran repropose à chaque visite tout ce que les créneaux donnent et
 * que la période n'a pas encore — donc les vacances et les jours fériés décochés la fois d'avant
 * revenaient cochés, à redécocher de mémoire. Le paramètre `exclusions` de `genererSeances`
 * existait mais n'était appelé par personne (`[]` ici comme sur l'écran).
 *
 * Décision de Delta : **on les mémorise en base** (`PeriodDateExclue`). Décocher une date, c'est
 * dire « pas de cours ce soir-là » — une information du calendrier du club, pas un geste d'écran.
 * Elle vaut donc à la génération comme à la régénération, jusqu'à ce qu'on la repropose
 * explicitement (`reproposerDatesExclues`, la porte de sortie : sans elle, décocher serait sans
 * retour).
 *
 * La liste des candidates est recalculée ici, exclusions comprises : c'est **elle** qui décide, pas
 * la sélection reçue. Une date écartée réclamée par une requête forgée n'est donc pas créée, et
 * l'écart entre ce que l'écran propose et ce que l'action accepte reste nul.
 */
export async function genererSeancesPeriode(periodId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  // `periods.manage` : engendrer les séances d'un trimestre, c'est le construire — un geste de
  // bureau, comme le créer et l'activer. Une action exportée d'un fichier `"use server"` est une
  // route publique : la garde est la seule barrière, l'écran déplacé sous /admin n'en est pas une.
  const user = await assertPermission("periods.manage");
  const parsed = generationSchema.safeParse({ dates: fd.getAll("dates").filter((v): v is string => typeof v === "string") });
  if (!parsed.success) return { erreur: "Sélection de dates invalide." };
  if (parsed.data.dates.length === 0) return { erreur: "Coche au moins une date à créer." };
  const period = await db.period.findUniqueOrThrow({
    where: { id: periodId },
    include: { creneaux: true, instructeurs: true, sessions: true, datesExclues: true },
  });
  // Même verrou que le retrait juste en dessous, et que `creerSeance` : un trimestre clos ne reçoit pas
  // de séance neuve. Le statut tranche, jamais la date — on clôt un trimestre sans attendre son dernier
  // cours, donc une période close porte des séances à venir.
  if (ecritureFermee(period.statut)) return { erreur: REFUS_PERIODE_CLOSE.seances };
  const cochees = new Set(parsed.data.dates);
  const candidates = genererSeances(
    period.dateDebut,
    period.dateFin,
    period.creneaux,
    period.datesExclues.map((d) => d.cle),
    period.sessions.map(cleSeance),
  );
  const nouvelles = candidates.filter((s) => cochees.has(cleSeance(s)));
  // Tout ce qui était proposé et n'a pas été coché : c'est le geste qu'on retient.
  const ecartees = candidates.filter((s) => !cochees.has(cleSeance(s))).map(cleSeance);
  for (const s of nouvelles) {
    await db.session.create({
      // Les parties du modèle dès la création (voir `partiesInitiales`) : un trimestre engendré
      // d'un coup donne trente séances déjà prêtes à remplir, pas trente colonnes vides.
      data: {
        periodId,
        ...s,
        instructeurs: { create: period.instructeurs.map((i) => ({ userId: i.userId })) },
        parties: { create: partiesInitiales() },
      },
    });
  }
  if (ecartees.length > 0) {
    await db.periodDateExclue.createMany({ data: ecartees.map((cle) => ({ periodId, cle })) });
  }
  await audit(user, "periode.seances_generees", periodId, { nombre: nouvelles.length, ecartees });
  rafraichir(periodId);
  revalidatePath("/seances");
  const creees = nouvelles.length ? `${nouvelles.length} séance${nouvelles.length > 1 ? "s" : ""} créée${nouvelles.length > 1 ? "s" : ""}.` : "Aucune nouvelle séance : ces dates existaient déjà.";
  const retenues = ecartees.length ? ` ${ecartees.length} date${ecartees.length > 1 ? "s" : ""} écartée${ecartees.length > 1 ? "s" : ""} : elle${ecartees.length > 1 ? "s ne seront plus proposées" : " ne sera plus proposée"}.` : "";
  return { succes: creees + retenues };
}

/**
 * **Reproposer les dates écartées** : la porte de sortie de `genererSeancesPeriode`.
 *
 * Sans elle, décocher une date serait sans retour — elle disparaîtrait des propositions pour de
 * bon, et il ne resterait qu'à créer la séance à la main. Le geste est volontairement grossier (on
 * repropose **tout** ce qui a été écarté) : une exclusion se reprend à la génération suivante, en
 * décochant à nouveau ce qui doit l'être, et un écran qui listerait les dates écartées une par une
 * ferait un réglage de plus pour un cas qui se produit une fois par trimestre.
 *
 * Aucune séance n'est touchée : reproposer une date ne la crée pas.
 */
export async function reproposerDatesExclues(periodId: string): Promise<FormState> {
  const user = await assertPermission("periods.manage");
  const { count } = await db.periodDateExclue.deleteMany({ where: { periodId } });
  await audit(user, "periode.dates_reproposees", periodId, { nombre: count });
  rafraichir(periodId);
  return {
    succes: count
      ? `${count} date${count > 1 ? "s" : ""} écartée${count > 1 ? "s" : ""} de nouveau proposée${count > 1 ? "s" : ""}.`
      : "Aucune date n'avait été écartée.",
  };
}

/** Activation : la période devient visible, chaque membre invité reçoit son lien personnel. */
export async function activerPeriode(periodId: string): Promise<FormState> {
  // `periods.manage` et non `invitations.manage` : activer une période, c'est ouvrir le trimestre
  // qu'on vient de construire. Les deux permissions sont désormais réservées au bureau, mais elles
  // ne disent pas la même chose — celle-ci parle du **trimestre**, l'autre du lien **d'une personne
  // en particulier**. Garder la bonne, c'est garder la raison du refus lisible.
  const user = await assertPermission("periods.manage");
  const period = await db.period.findUniqueOrThrow({
    where: { id: periodId },
    // Un compte de service éventuellement rattaché (données antérieures) ne reçoit pas de lien
    include: { membres: { where: { user: { service: false } } }, sessions: true },
  });
  if (period.membres.length === 0) return { erreur: "Ajoute des membres avant d'activer la période." };
  if (period.sessions.length === 0) return { erreur: "Génère les séances avant d'activer la période." };
  await db.period.update({ where: { id: periodId }, data: { statut: "ACTIVE" } });
  /*
   * **Aucun lien n'est envoyé ici**. Activer, c'est ouvrir le trimestre au travail de l'équipe :
   * les séances deviennent visibles, le planning se remplit, les thèmes se posent. Ça se fait des
   * semaines à l'avance, quand on prépare la saison — et un lien reçu six semaines avant le premier
   * cours est un lien oublié, donc un lien qu'on redemandera.
   *
   * Les liens partent **trois jours avant le début du trimestre**, par le balayage quotidien
   * (`envoyerLiensDesTrimestresQuiCommencent`, src/lib/invitations.ts), qui donne à chacun une clé
   * neuve et révoque toutes les anciennes.
   */
  await audit(user, "periode.activee", periodId, { membres: period.membres.length });
  rafraichir(periodId);
  const jours = joursAvant(todayIso(), period.dateDebut) - LIENS_AVANT_DEBUT_JOURS;
  const quand =
    jours > 0
      ? `Les liens personnels partiront dans ${jours} jour${jours > 1 ? "s" : ""}, trois jours avant le premier cours.`
      : "Les liens personnels partent au prochain passage du matin (7 h).";
  return { succes: `Période activée : le trimestre est ouvert à l'équipe. ${quand}` };
}

export async function clorePeriode(periodId: string): Promise<void> {
  const user = await assertPermission("periods.manage");
  await db.period.update({ where: { id: periodId }, data: { statut: "CLOSE" } });
  await db.invitation.updateMany({ where: { periodId, revokedAt: null }, data: { revokedAt: new Date(), motifRevocation: "CLOTURE" } });
  await audit(user, "periode.close", periodId);
  rafraichir(periodId);
}

/**
 * **Rouvrir un trimestre clos**. Une clôture se faisait jusqu'ici dans un seul sens : un appui de
 * trop, ou un trimestre qu'on croyait fini, et il fallait recréer la période — donc perdre les
 * séances et les réponses. Le geste inverse existe désormais.
 *
 * **Rouvrir n'envoie aucun email**, et c'est la règle qui tient tout le reste :
 *
 * 1. les liens que *cette clôture* avait révoqués (`CLOTURE`) sont remis en service, mais **seulement
 *    ceux qui sont encore en cours de validité**. Un lien déjà périmé resterait révoqué : le rendre
 *    ferait entrer le trimestre dans le balayage de renouvellement du matin, qui enverrait un
 *    « lien renouvelé » à tout le club pour un trimestre qu'on rouvre souvent juste pour corriger
 *    une présence. Les liens révoqués à la main (`MANUEL`) ou pour raison de sécurité ne reviennent
 *    pas non plus : ils n'ont pas été fermés par la clôture ;
 * 1 bis. **personne ne ressort avec deux liens vivants** : qui a reçu une clé neuve depuis la
 *    clôture garde la sienne, et une personne dont la clôture avait fermé deux liens n'en retrouve
 *    qu'un ;
 * 2. si le trimestre a déjà commencé sans que ses liens soient partis, la réouverture les marque
 *    comme envoyés : sans cela, le balayage de 7 h enverrait le lendemain un premier lien à tout le
 *    monde pour un trimestre commencé depuis des semaines.
 *
 * **Le compte rendu distingue les deux façons de ne rien rendre** : « personne n'a besoin de rien,
 * chacun a déjà sa clé » et « les liens de la clôture ont expiré, ces gens-là sont dehors » se
 * soldaient l'un comme l'autre par un zéro, et le message affirmait le second en renvoyant sur «
 * Renvoyer les liens » — un geste qui révoque la clé de **tout le monde** et écrit à tout le club,
 * c'est-à-dire exactement ce que la réouverture est faite d'éviter. On nomme donc chaque cas, et
 * l'on renvoie au bouton « Renvoyer le lien » de la ligne des seules personnes concernées.
 */
export async function reactiverPeriode(periodId: string): Promise<FormState> {
  const user = await assertPermission("periods.manage");
  const p = await db.period.findUniqueOrThrow({
    where: { id: periodId },
    select: { id: true, statut: true, dateDebut: true, liensEnvoyesLe: true },
  });
  if (p.statut !== "CLOSE") return { erreur: "Cette période n'est pas close." };
  const maintenant = new Date();
  /*
   * **Relevé avant le geste : qui récupère quoi.** `remettreEnServiceLiensDeCloture` ne rend qu'un
   * nombre, et son zéro recouvre deux situations opposées — tout le monde a déjà une clé vivante
   * (il n'y a rien à faire, et surtout rien à renvoyer), ou les liens fermés par la clôture ont
   * expiré (ces personnes-là n'ont plus d'accès du tout). Deux comptages le disent, sans toucher à
   * `src/lib/invitations.ts`, qui reste seule à décider ce qui revient.
   */
  const fermesParLaCloture = await db.invitation.findMany({
    where: { periodId, motifRevocation: "CLOTURE" },
    select: { userId: true, expiresAt: true },
  });
  const concernes = [...new Set(fermesParLaCloture.map((i) => i.userId))];
  const cleVivante = new Set(
    (
      await db.invitation.findMany({
        where: { userId: { in: concernes }, revokedAt: null, expiresAt: { gt: maintenant } },
        select: { userId: true },
      })
    ).map((i) => i.userId),
  );
  // Un lien de clôture encore valable = un lien que la réouverture peut rendre.
  const recuperable = new Set(fermesParLaCloture.filter((i) => i.expiresAt > maintenant).map((i) => i.userId));
  const gardentLaLeur = concernes.filter((u) => cleVivante.has(u)).length;
  const sansAcces = concernes.filter((u) => !cleVivante.has(u) && !recuperable.has(u)).length;
  // Une seule clé vivante par personne : qui a reçu un lien neuf depuis la clôture ne récupère pas
  // l'ancien, et une clôture qui en avait fermé deux (renouvellement anticipé) n'en rend que le plus
  // récent. Sans ce tri, rouvrir un trimestre faisait vivre deux liens pour la même personne.
  const count = await remettreEnServiceLiensDeCloture(periodId, maintenant);
  const commence = p.dateDebut <= todayIso(maintenant);
  await db.period.update({
    where: { id: periodId },
    data: { statut: "ACTIVE", ...(p.liensEnvoyesLe === null && commence ? { liensEnvoyesLe: maintenant } : {}) },
  });
  await audit(user, "periode.reactivee", periodId, { liensRemisEnService: count, gardentLaLeur, sansAcces });
  rafraichir(periodId);
  // Une phrase par fait, dans l'ordre de ce qu'il y a à faire : ce qui est rendu, ce qui n'avait pas
  // besoin de l'être, puis les seules personnes à qui il reste un geste à faire.
  const phrases = ["Période rouverte."];
  if (count > 0) phrases.push(`${count} lien${count > 1 ? "s" : ""} personnel${count > 1 ? "s" : ""} remis en service.`);
  if (gardentLaLeur > 0) {
    phrases.push(
      gardentLaLeur > 1
        ? `${gardentLaLeur} personnes gardent le lien plus récent reçu depuis la clôture.`
        : "1 personne garde le lien plus récent reçu depuis la clôture.",
    );
  }
  if (sansAcces > 0) {
    // **Vers quel geste renvoyer.** « Renvoyer les liens » (l'envoi groupé) régénère la clé de tout
    // le monde : il n'est inoffensif que si personne n'en a de vivante — le cas où la clôture n'a
    // rien laissé debout. Dès qu'une seule personne a récupéré ou gardé la sienne, l'envoi groupé la
    // lui révoquerait et écrirait à tout le club pour quelques retardataires : on renvoie alors au
    // bouton « Renvoyer le lien » de leur ligne.
    if (count === 0 && gardentLaLeur === 0) {
      phrases.push("Les liens fermés à la clôture étaient périmés : utilise « Renvoyer les liens » pour redonner l'accès.");
    } else {
      phrases.push(
        sansAcces > 1
          ? `${sansAcces} personnes restent sans lien valable, le leur ayant expiré : « Renvoyer le lien » sur leur ligne, plus bas — un envoi groupé révoquerait les liens des autres.`
          : "1 personne reste sans lien valable, le sien ayant expiré : « Renvoyer le lien » sur sa ligne, plus bas — un envoi groupé révoquerait les liens des autres.",
      );
    }
  }
  if (count === 0 && gardentLaLeur === 0 && sansAcces === 0) phrases.push("La clôture n'avait fermé aucun lien.");
  phrases.push("Aucun email n'est parti.");
  return { succes: phrases.join(" ") };
}

/**
 * Suppression définitive d'une période. Réservée au bureau (`periods.delete`, ADMIN) et précédée
 * d'un code 2FA récent : elle efface les réponses des membres, qui ne se reconstituent pas.
 *
 * Ce que la base emporte, relation par relation (prisma/schema.prisma, schéma gelé) :
 * - Creneau, PeriodMember, PeriodInstructeur, Session et Invitation : `onDelete: Cascade` → effacés ;
 * - par ricochet sur les séances : SessionInstructeur, SessionPartie (cases du planning) et
 *   Attendance (les réponses) : `onDelete: Cascade` → effacés eux aussi ;
 * - Atelier.session et NotificationLog.session : `onDelete: SetNull` → la proposition d'atelier et
 *   le journal d'envoi survivent, simplement détachés de leur séance.
 * Seul point qui ne se règle pas tout seul : un atelier PLANIFIE se retrouverait « planifié » sans
 * séance. On le remet explicitement en attente dans la même transaction, plutôt que de laisser un
 * statut qui ne correspond plus à rien.
 */
/**
 * **Retirer des séances d'un trimestre**, depuis l'écran de la période. L'encart « Séances déjà
 * créées » les montre cochées ; en décocher, c'est demander leur suppression — le pendant exact de
 * l'encart « Reste à créer », qui les fait naître.
 *
 * Le geste efface les réponses des membres pour ces dates (cascade `Attendance`, cases du planning,
 * instructeurs de la séance). Il est donc réservé au bureau (`periods.manage`, comme le trimestre
 * lui-même), annoncé avec son décompte avant confirmation, et journalisé avec les dates emportées —
 * la seule trace qui restera. Une séance qui n'appartient pas à la période est ignorée : la liste
 * vient de l'écran, elle se vérifie ici.
 */
export async function supprimerSeancesPeriode(periodId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("periods.manage");
  // Le lot se valide comme celui qu'on crée : voir `retraitSeancesSchema`.
  const lot = retraitSeancesSchema.safeParse({ supprimer: fd.getAll("supprimer").filter((v): v is string => typeof v === "string") });
  if (!lot.success) return { erreur: "Sélection de séances invalide." };
  const ids = lot.data.supprimer;
  if (ids.length === 0) return { erreur: "Décoche au moins une séance à retirer." };
  /*
   * **Un trimestre clos ne perd plus de séances**. Le verrou d'état vivait sur la séance
   * (`seancePourEcriture`) et sur le planning, mais pas sur la liste des séances de la période : on
   * pouvait donc effacer des cours — et toutes leurs réponses — sur un trimestre terminé, depuis un
   * écran qui ne disait rien, pendant que l'écran de la séance refusait le même geste.
   */
  const periode = await db.period.findUnique({ where: { id: periodId }, select: { statut: true } });
  if (!periode) return { erreur: "Ce trimestre n'existe plus." };
  if (ecritureFermee(periode.statut)) return { erreur: REFUS_PERIODE_CLOSE.seances };
  const seances = await db.session.findMany({ where: { id: { in: ids }, periodId }, select: { id: true, date: true, heureDebut: true } });
  if (seances.length === 0) return { erreur: "Ces séances n'appartiennent pas à cette période." };
  const sessionIds = seances.map((s) => s.id);
  const reponses = await db.attendance.count({ where: { sessionId: { in: sessionIds } } });
  /*
   * **Un code récent, comme pour la porte jumelle**.
   *
   * `CLAUDE.md` affirme depuis le 30/09 que « `supprimerSeance` exige `periods.manage` **et
   * l'élévation**, exactement comme son geste jumeau `supprimerSeancesPeriode` » — et décrivait un état
   * qui n'existait pas : `supprimerSeance` appelle bien `exigerReauth`, celle-ci ne l'appelait pas. Or
   * c'est la plus destructrice des deux : elle efface un lot entier de séances **avec toutes les réponses
   * des membres**, qui ne se reconstituent pas.
   *
   * Le scénario est celui d'un poste admin laissé ouvert : l'élévation vit jusqu'à douze heures, et
   * décocher toutes les lignes de « Séances déjà créées » vidait le trimestre sans qu'un code soit
   * redemandé — là où le même geste séance par séance s'arrêtait net sur `/connexion/verifier`.
   *
   * **Deux portes vers la même destruction ne peuvent pas avoir deux serrures** : c'est la phrase du
   * dossier, elle est maintenant vraie. Demandé après les refus (lot vide, séances d'une autre période)
   * et avant l'effacement, comme partout ailleurs.
   */
  await exigerReauth(user, `/admin/periodes/${periodId}`);
  // Même règle que `supprimerPeriode` et `supprimerSeance` : un atelier « planifié » dont la séance
  // disparaît serait planifié nulle part — absent de la file des propositions à trancher, et
  // introuvable au planning. Il repasse en attente, les autres sont détachés explicitement, et tout
  // part avec l'effacement dans une seule transaction.
  await db.$transaction([
    db.atelier.updateMany({ where: { sessionId: { in: sessionIds }, statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } }),
    db.atelier.updateMany({ where: { sessionId: { in: sessionIds } }, data: { sessionId: null } }),
    db.session.deleteMany({ where: { id: { in: sessionIds }, periodId } }),
  ]);
  await audit(user, "periode.seances_supprimees", periodId, {
    seances: seances.length,
    reponses,
    dates: seances.map((s) => `${s.date} ${s.heureDebut}`),
  });
  rafraichir(periodId);
  revalidatePath("/seances");
  revalidatePath("/planning");
  const n = seances.length;
  return { succes: `${n} séance${n > 1 ? "s" : ""} retirée${n > 1 ? "s" : ""}${reponses ? ` (et ${reponses} réponse${reponses > 1 ? "s" : ""})` : ""}.` };
}

export async function supprimerPeriode(periodId: string): Promise<void> {
  const acteur = await assertPermission("periods.delete");
  const p = await db.period.findUniqueOrThrow({ where: { id: periodId } });
  // Une période en cours reste intouchable : on la clôture d'abord (les liens tombent), on décide ensuite.
  if (p.statut === "ACTIVE") throw new Error("Période active : clôture-la avant de pouvoir la supprimer.");
  await exigerReauth(acteur, `/admin/periodes/${periodId}`);
  const seances = await db.session.findMany({ where: { periodId }, select: { id: true } });
  const sessionIds = seances.map((s) => s.id);
  // Décomptes relevés avant l'effacement : ils partent dans l'audit, seule trace qui restera.
  const [reponses, invitations] = await Promise.all([
    db.attendance.count({ where: { sessionId: { in: sessionIds } } }),
    db.invitation.count({ where: { periodId } }),
  ]);
  await db.$transaction([
    // Les propositions des membres survivent à la période : celles qui étaient placées au planning
    // repassent « en attente » avant que leur séance ne disparaisse…
    db.atelier.updateMany({ where: { sessionId: { in: sessionIds }, statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } }),
    // …et les autres sont détachées explicitement, sans compter sur le SetNull de la base.
    db.atelier.updateMany({ where: { sessionId: { in: sessionIds } }, data: { sessionId: null } }),
    db.period.delete({ where: { id: periodId } }),
  ]);
  await audit(acteur, "periode.supprimee", periodId, {
    nom: p.nom,
    dateDebut: p.dateDebut,
    dateFin: p.dateFin,
    seances: sessionIds.length,
    reponses,
    invitations,
  });
  rafraichir();
  revalidatePath("/seances");
  redirect(`/admin/periodes?supprimee=${encodeURIComponent(p.nom)}`);
}

export async function renvoyerInvitation(periodId: string, userId: string): Promise<void> {
  const user = await assertPermission("invitations.manage");
  /*
   * **Le code récent, comme son jumeau de la fiche d'un membre**. Il avait été posé sur
   * `envoyerLienMembre` quelques heures plus tôt, avec cette phrase : « corriger une moitié sans
   * l'autre aurait laissé la paire ouverte ». Les deux autres portes du **même** geste — celle-ci
   * et `renvoyerTousLesLiens` — n'avaient pas suivi, et la docstring juste en dessous promettait
   * pourtant l'inverse depuis le début. C'est exactement le défaut que le dossier nomme : « deux
   * portes vers la même destruction ne peuvent pas avoir deux serrures ».
   *
   * Le geste fait partir une clé de quatre mois. La suite de la redirection est la fiche de la période,
   * d'où les deux écrans appellent.
   */
  await exigerReauth(user, `/admin/periodes/${periodId}`);
  /*
   * Mêmes contrôles qu'« Envoyer le lien » depuis la fiche d'un membre (`envoyerLienMembre`,
   * src/actions/membres.ts) : le même geste, depuis un autre écran, ne peut pas obéir à d'autres
   * règles. Ils comptent d'autant plus ici que `createInvitation` **inscrit la personne sur la
   * période** au passage — un envoi qui n'aurait pas dû partir ne se contente pas d'envoyer un
   * lien mort, il ajoute quelqu'un au trimestre.
   */
  const cible = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { prenom: true, nom: true, email: true, actif: true, service: true } });
  if (!peutEtreInvite(cible)) throw new Error(ERREUR_COMPTE_SERVICE);
  // Un compte désactivé ne peut plus ouvrir son lien : ne rien envoyer plutôt qu'un lien mort
  if (!cible.actif) throw new Error("Ce compte est désactivé : réactive-le avant de lui envoyer son lien.");
  // Envoi à l'unité : sans adresse, on le dit en nommant la personne plutôt que de ne rien faire
  if (!cible.email) throw new Error(messageSansEmail(cible));
  const periode = await db.period.findUniqueOrThrow({ where: { id: periodId }, select: { statut: true } });
  if (periode.statut === "CLOSE") throw new Error("Période close : les liens ne sont plus valables.");
  // Régénération individuelle décidée par l'équipe : l'ancien lien meurt, ses sessions aussi.
  // Sauf si la cible est la personne connectée (un administrateur qui clique « Renvoyer le lien »
  // sur sa propre ligne) : elle vient de cliquer, la déconnecter ici passerait pour une panne et
  // l'obligerait à retrouver un email. Ses autres appareils, eux, sont bien coupés — même règle
  // que « Renvoyer mon lien » (`renvoyerMonLien`, src/actions/profil.ts).
  await envoyerInvitation(userId, periodId, "invitation", { deconnecterAppareils: userId === user.id ? "autres" : "tous" });
  await audit(user, "invitation.renvoyee", periodId, { userId });
  rafraichir(periodId);
}

/**
 * Renvoie le lien personnel à tout le monde sur la période (après correction des adresses email, par exemple).
 * Chaque lien est régénéré : les anciens cessent de fonctionner.
 *
 * **Deux écrans l'appellent** — la page de la période et la liste des membres (« Renvoyer le lien à
 * tout le monde ») —, et `retour` dit où ramener après le code redonné : sans lui, le détour par
 * `/connexion/verifier` déposait sur la période quelqu'un parti de l'annuaire, sans dire si les
 * liens étaient partis (l'action n'est pas rejouée). Même règle que `envoyerLienMembre`.
 */
export async function renvoyerTousLesLiens(periodId: string, retour?: string): Promise<void> {
  const acteur = await assertPermission("invitations.manage");
  /*
   * **Le code récent, et il compte davantage ici** : ce geste régénère la clé de quatre mois de **tout
   * le club** et expédie autant d'emails qu'il y a de membres. Le geste unitaire le demandait déjà
   * (`envoyerLienMembre`), celui-ci non — un geste de masse plus permissif que son unitaire, ce que le
   * dossier interdit nommément (« les verrous sont **exactement** ceux du geste unitaire »).
   */
  await exigerReauth(acteur, retour ?? `/admin/periodes/${periodId}`);
  const period = await db.period.findUniqueOrThrow({ where: { id: periodId }, include: { membres: { include: { user: { select: { id: true, actif: true, service: true } } } } } });
  if (period.statut === "CLOSE") throw new Error("Période close : les liens ne sont plus valables.");
  const actifs = period.membres.filter((m) => m.user.actif && !estCompteDeService(m.user));
  // Envoi de masse : une personne sans adresse email est sautée, sans erreur et sans interrompre les autres
  let envoyes = 0;
  // Envoi de masse (typiquement après correction des adresses) : on ne déconnecte pas le club.
  for (const m of actifs) if (await envoyerInvitation(m.userId, periodId)) envoyes++;
  await audit(acteur, "invitations.renvoyees_toutes", periodId, { nombre: envoyes, sansEmail: actifs.length - envoyes });
  rafraichir(periodId);
  // L'annuaire affiche l'état du lien de chacun : il doit se relire, d'où qu'on ait appuyé.
  revalidatePath("/admin/membres");
}

/**
 * Révoque un lien personnel, depuis la page d'une période ou la fiche d'un membre.
 *
 * **Le code récent, comme ses deux jumeaux de l'annuaire** (`revoquerLienMembre` et
 * `revoquerLiensEnMasse`, `src/app/(app)/admin/membres/actions.ts`) : couper la clé de quelqu'un est
 * l'autre moitié du geste qui la lui envoie, et les gestes voisins qui ferment un accès le demandent
 * tous. Trois portes vers la même révocation ne peuvent pas avoir deux serrures. `retour` ramène à
 * l'écran du clic après le code redonné ; le repli est la page de la période.
 */
export async function revoquerInvitation(invitationId: string, retour?: string): Promise<void> {
  const user = await assertPermission("invitations.manage");
  const inv = await db.invitation.findUniqueOrThrow({ where: { id: invitationId } });
  await exigerReauth(user, retour ?? `/admin/periodes/${inv.periodId}`);
  await revokeInvitation(invitationId);
  await audit(user, "invitation.revoquee", inv.periodId, { userId: inv.userId });
  rafraichir(inv.periodId);
  revalidatePath("/admin/membres");
}
