import { db } from "@/lib/db";
import { DELAI_DESISTEMENT_TARDIF_MIN, ecritureFermee } from "@/lib/constants";
import { parisDateTime, todayIso } from "@/lib/dates";
import { enqueueEmail } from "@/lib/email/mailer";
import { emailDesistementTardif } from "@/lib/email/templates/seances";
import { aUnEmail } from "@/lib/membres";
import { envoiPossible } from "./canaux";
import { contenuDesistementTardif, type StatutDesistement } from "./contenu";
import { clesDejaEnvoyees, journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import { empreinteCreneau } from "./planification";
import { destinataireRetenu, getPreferencesNotifications } from "./preferences";
import type { ChargePush } from "./push";
import { CHAMPS_DESTINATAIRE, chiffresEffectif, equipeJoignable, type InstructeurAlerte } from "./seances";

/**
 * **Désistement de dernière minute** (`desistement_tardif`) : un membre retire sa réponse dans les
 * {@link DELAI_DESISTEMENT_TARDIF_MIN} minutes qui précèdent le cours, et l'encadrement de la séance
 * l'apprend tout de suite — son nom, sa nouvelle réponse, l'effectif mis à jour.
 *
 * ## Ce qui déclenche
 *
 * - **le membre lui-même**, par `indiquerPresence` (`src/actions/presences.ts`). Une correction du
 *   bureau (fiche de séance, `/admin/presences`, geste de masse) n'appelle jamais ce module : écrire
 *   à la place de quelqu'un n'est pas une nouvelle à annoncer (voir `modifierPresencesEnMasse`) ;
 * - une transition qui **retire** une présence ({@link estDesistement}) : Présent → Absent,
 *   Présent → Peut-être, Peut-être → Absent. « Sans réponse → Absent » n'est pas un désistement :
 *   l'équipe ne comptait pas sur cette personne ;
 * - dans la fenêtre ({@link dansFenetreDesistementTardif}) : début du cours calculé dans le fuseau du
 *   club, borne comprise, rien après le début ;
 * - séance non annulée, période non close.
 *
 * ## Qui reçoit, et par où
 *
 * L'équipe de la séance — à défaut celle de la période —, réduite à qui a un accès actif : c'est
 * `equipeJoignable` (`seances.ts`, qui applique `filtrerAccesActif`), **la même fonction** que
 * l'alerte « peu de monde ». Puis chacun selon ses préférences (`destinataireRetenu`), et jamais le
 * membre lui-même s'il encadre. **Email et téléphone seulement** : le message nomme quelqu'un, et un
 * salon Discord ou un groupe Telegram est public (`CANAUX_PAR_NOTIFICATION.desistement_tardif`).
 *
 * ## Idempotence
 *
 * Une clé **par destinataire et par canal**, posée **avant** l'envoi (`journaliser`), libérée en cas
 * d'échec (`marquerEchec`) — voir {@link cleDesistement}. Elle porte le membre, la séance, le créneau
 * et le statut visé : au plus une alerte par membre, séance et statut. Un membre qui repasse Présent
 * puis Absent ne renvoie pas une seconde alerte « Absent ».
 *
 * ## Jamais bloquant
 *
 * {@link signalerDesistementTardif} ne lève **jamais** : la réponse du membre est déjà écrite quand
 * elle est appelée, et un SMTP fâché, un service de push en panne ou une base qui hoquette ne doivent
 * ni la défaire ni l'afficher en erreur.
 */

/** Type écrit dans `NotificationLog`. */
export const TYPE_JOURNAL_DESISTEMENT = "DESISTEMENT";

/**
 * La transition retire-t-elle une présence sur laquelle l'équipe comptait ? (fonction pure)
 *
 * Rend le statut visé quand c'est un désistement, `null` sinon — y compris pour une première réponse
 * (`avant === null`) et pour un statut inchangé.
 */
export function estDesistement(avant: string | null, apres: string): StatutDesistement | null {
  if (avant === "PRESENT" && (apres === "ABSENT" || apres === "PEUT_ETRE")) return apres;
  if (avant === "PEUT_ETRE" && apres === "ABSENT") return "ABSENT";
  return null;
}

/**
 * Sommes-nous dans les {@link DELAI_DESISTEMENT_TARDIF_MIN} minutes qui précèdent le début ?
 * (fonction pure)
 *
 * Borne comprise (pile deux heures avant, l'alerte part) ; le début lui-même exclu — un cours
 * commencé ne prend plus de réponse, et le même instant que `seanceCommencee` le dit.
 */
export function dansFenetreDesistementTardif(date: string, heureDebut: string, now = new Date()): boolean {
  const reste = parisDateTime(date, heureDebut).getTime() - now.getTime();
  return reste > 0 && reste <= DELAI_DESISTEMENT_TARDIF_MIN * 60_000;
}

/**
 * La clé de déduplication : type + canal + destinataire + membre + séance + créneau + statut visé.
 *
 * Le **créneau** pour la règle du dossier (une séance déplacée garde son identifiant) ; le **statut**
 * pour que Présent → Peut-être puis Peut-être → Absent soient deux nouvelles distinctes, et
 * Présent → Absent, Présent, Absent une seule.
 */
export function cleDesistement(args: {
  canal: "email" | "push";
  destinataireId: string;
  membreId: string;
  seance: { id: string; date: string; heureDebut: string };
  statut: StatutDesistement;
}): string {
  return `desistement_${args.canal}_${args.seance.id}_${empreinteCreneau(args.seance)}_${args.membreId}_${args.statut}_${args.destinataireId}`;
}

export type SignalementDesistement = {
  sessionId: string;
  /** Le membre qui vient de répondre — c'est lui qui est nommé */
  userId: string;
  /** Sa réponse **avant** l'écriture (`null` = sans réponse) */
  avant: string | null;
  /** Sa réponse telle qu'elle vient d'être écrite */
  apres: string;
  now?: Date;
};

/**
 * Prévient l'encadrement d'un désistement de dernière minute. Rend le nombre d'envois tentés (emails
 * et notifications sur le téléphone confondus) — **ne lève jamais**.
 */
export async function signalerDesistementTardif(signalement: SignalementDesistement): Promise<number> {
  try {
    return await signaler(signalement);
  } catch (e) {
    console.error("[notifications] désistement de dernière minute : échec non bloquant", e);
    return 0;
  }
}

async function signaler({ sessionId, userId, avant, apres, now = new Date() }: SignalementDesistement): Promise<number> {
  const statut = estDesistement(avant, apres);
  if (!statut) return 0;
  // **La fenêtre d'abord, par une lecture légère** : se désister trois jours avant est le cas courant,
  // et il ne doit coûter à la réponse du membre ni la lecture des réglages ni celle de la séance
  // entière (présences, encadrement, période).
  const creneau = await db.session.findUnique({ where: { id: sessionId }, select: { date: true, heureDebut: true, annulee: true } });
  if (!creneau || creneau.annulee || !dansFenetreDesistementTardif(creneau.date, creneau.heureDebut, now)) return 0;
  const [parEmail, parPush] = await Promise.all([envoiPossible("desistement_tardif", "email"), pushPossible("desistement_tardif")]);
  if (!parEmail && !parPush) return 0;

  const s = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      attendances: { select: { userId: true, statut: true } },
      instructeurs: { include: { user: { select: CHAMPS_DESTINATAIRE } } },
      period: {
        include: {
          // Le compte de connexion du portail n'est pas un invité : il ne compte pas, ne reçoit rien.
          membres: { where: { user: { service: false } }, select: { userId: true } },
          instructeurs: { include: { user: { select: CHAMPS_DESTINATAIRE } } },
        },
      },
    },
  });
  if (!s || s.annulee || ecritureFermee(s.period.statut)) return 0;
  if (!dansFenetreDesistementTardif(s.date, s.heureDebut, now)) return 0;

  const membre = await db.user.findUnique({ where: { id: userId }, select: { prenom: true, nom: true } });
  if (!membre) return 0;
  const nom = `${membre.prenom} ${membre.nom}`.trim();

  // L'équipe de l'alerte « peu de monde », sans le membre lui-même s'il encadre.
  const equipe = (await equipeJoignable(s, now)).filter((u) => u.id !== userId);
  if (equipe.length === 0) return 0;

  const prefs = await getPreferencesNotifications();
  // Les chiffres **après** la nouvelle réponse (elle est déjà en base), dérivés de la liste des
  // invités comme ceux de l'alerte « peu de monde ».
  const chiffres = chiffresEffectif(s);
  const aujourdHui = todayIso(now);
  const seance = { id: s.id, date: s.date, heureDebut: s.heureDebut, heureFin: s.heureFin, lieu: s.lieu };
  let tentes = 0;

  if (parEmail) {
    const destinataires = equipe.filter((u): u is InstructeurAlerte & { email: string } => aUnEmail(u) && destinataireRetenu(prefs, "desistement_tardif", "email", u));
    const cle = (u: InstructeurAlerte) => cleDesistement({ canal: "email", destinataireId: u.id, membreId: userId, seance, statut });
    const deja = await clesDejaEnvoyees(destinataires.map(cle));
    for (const u of destinataires) {
      const dedupKey = cle(u);
      if (deja.has(dedupKey)) continue;
      // Le message d'abord : une mise en forme qui lève ne laisse pas de clé derrière elle.
      const { sujet, contenu } = emailDesistementTardif({ prenom: u.prenom, membre: nom, statut, seance, presents: chiffres.presents, invites: chiffres.invites, aujourdHui });
      // La clé **avant** l'envoi : c'est la contrainte d'unicité qui tranche entre deux passages.
      if (!(await journaliser({ type: TYPE_JOURNAL_DESISTEMENT, canal: "EMAIL", sessionId: s.id, userId: u.id, dedupKey, statut: "ENVOYE" }))) continue;
      try {
        enqueueEmail({ to: u.email, sujet, contenu, ref: dedupKey }, (err) => {
          if (err) void marquerEchec(dedupKey, err.message);
        });
        tentes += 1;
      } catch (e) {
        // Une file qui refuse le message ne doit pas garder la clé : elle passerait pour « envoyé ».
        await marquerEchec(dedupKey, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (parPush) {
    const destinataires = equipe.filter((u) => destinataireRetenu(prefs, "desistement_tardif", "push", u));
    tentes += await notifierParPush({
      type: TYPE_JOURNAL_DESISTEMENT,
      sessionId: s.id,
      destinataires,
      cle: (u) => cleDesistement({ canal: "push", destinataireId: u.id, membreId: userId, seance, statut }),
      charge: () => chargeDesistementPush({ membre: nom, membreId: userId, statut, seance, chiffres, aujourdHui }),
    });
  }
  return tentes;
}

/** La même alerte sur le téléphone : le texte de `contenuDesistementTardif`, et la fiche de la séance. */
export function chargeDesistementPush(args: {
  membre: string;
  membreId: string;
  statut: StatutDesistement;
  seance: { id: string; date: string; heureDebut: string; lieu: string };
  chiffres: { presents: number; invites: number };
  aujourdHui: string;
}): ChargePush {
  const c = contenuDesistementTardif({ membre: args.membre, statut: args.statut, seance: args.seance, chiffres: args.chiffres, aujourdHui: args.aujourdHui });
  return {
    titre: "Désistement de dernière minute",
    corps: `${c.phrase}. ${c.chiffres}`,
    url: c.chemin,
    // Un tag par membre : deux désistements sur la même séance ne s'écrasent pas sur l'écran verrouillé.
    tag: `desistement-${args.seance.id}-${args.membreId}`,
  };
}
