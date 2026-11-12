import { db } from "@/lib/db";
import { DELAI_DESISTEMENT_DERNIERE_MINUTE_MIN, DELAI_DESISTEMENT_TARDIF_MIN, ecritureFermee } from "@/lib/constants";
import { audit } from "@/lib/audit";
import { parisDateTime, todayIso } from "@/lib/dates";
import { enqueueEmail } from "@/lib/email/mailer";
import { emailDesistementTardif } from "@/lib/email/templates/seances";
import { aUnEmail } from "@/lib/membres";
import { filtrerAccesActif } from "@/lib/acces-actif";
import { personnesDuClub } from "@/lib/permissions";
import { envoiPossible } from "./canaux";
import { contenuDesistementTardif, type StatutDesistement } from "./contenu";
import { clesDejaEnvoyees, journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import { empreinteCreneau } from "./planification";
import { destinataireRetenu, getPreferencesNotifications } from "./preferences";
import { getDelaisDesistement } from "@/lib/settings";
import type { TypeNotification } from "./preferences";
import type { ChargePush } from "./push";
import { CHAMPS_DESTINATAIRE, chiffresEffectif, equipeJoignable, type InstructeurAlerte } from "./seances";

/**
 * **Désistement** (`desistement_tardif`) et **désistement de dernière minute**
 * (`desistement_derniere_minute`) : un membre retire sa réponse avant le cours, et l'encadrement
 * l'apprend tout de suite — son nom, sa nouvelle réponse, l'effectif mis à jour.
 *
 * ## Deux fenêtres, la plus pressante l'emporte
 *
 * - dans la fenêtre de **dernière minute** (`desistement.derniereMinuteMinutes`,
 *   {@link DELAI_DESISTEMENT_DERNIERE_MINUTE_MIN} minutes à défaut) : « Désistement de dernière minute » ;
 * - sinon, dans le délai des **désistements** (`desistement.delaiMinutes`,
 *   {@link DELAI_DESISTEMENT_TARDIF_MIN} minutes à défaut) : « Désistement ».
 *
 * Les deux fenêtres sont indépendantes : la dernière minute peut être plus
 * longue que l'autre, elle prend le pas quand même. Un seul message par retrait ; chacune se coupe
 * séparément dans « Mon profil ». Chaque envoi (et chaque échec) est noté au journal d'audit
 * (`notification.desistement`, `notification.desistement_derniere_minute`, `…_echec`).
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
 * **Tous les instructeurs du club** (demande de Delta : « à tous les instructeurs, pas juste celui de
 * la séance ») — rôle de base INSTRUCTEUR, compte actif, hors compte de service —, plus l'équipe de la
 * séance (`equipeJoignable`) si quelqu'un y est posé sans ce rôle ; le tout réduit à qui a un accès actif
 * (`filtrerAccesActif`). Puis chacun selon ses préférences (`destinataireRetenu`, désactivable depuis
 * « Mon profil »), jamais le membre lui-même s'il encadre, ni un instructeur qui a répondu Absent ou
 * Peut-être à cette séance. **Email et téléphone seulement** : le message nomme quelqu'un, et un
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
export const TYPE_JOURNAL_DESISTEMENT_DERNIERE_MINUTE = "DESISTEMENT_DERNIERE_MINUTE";

/** Quelle alerte un retrait déclenche : la plus pressante des deux fenêtres, ou aucune. */
export type FenetreDesistement = "derniere_minute" | "desistement";

export type DelaisDesistement = {
  delaiMin: number;
  derniereMinuteMin: number;
  /** Interrupteurs du bureau (`desistement.actif`, `desistement.derniereMinuteActif`) ; absents = allumés. */
  actif?: boolean;
  derniereMinuteActif?: boolean;
};

export const DELAIS_DESISTEMENT_DEFAUT: DelaisDesistement = { delaiMin: DELAI_DESISTEMENT_TARDIF_MIN, derniereMinuteMin: DELAI_DESISTEMENT_DERNIERE_MINUTE_MIN };

/**
 * **La fenêtre d'un retrait** (fonction pure) : dernière minute d'abord — elle prend le pas —, puis
 * désistement, sinon `null` (trop tôt, après le début, ou alerte coupée par le bureau).
 *
 * Deux conséquences voulues : une dernière minute **au moins aussi longue** que le
 * désistement le recouvre entièrement — le désistement classique ne part alors plus jamais
 * ({@link desistementRecouvert}) ; une dernière minute **coupée** rend sa fenêtre au désistement classique.
 */
export function fenetreDesistement(date: string, heureDebut: string, now = new Date(), delais: DelaisDesistement = DELAIS_DESISTEMENT_DEFAUT): FenetreDesistement | null {
  if (delais.derniereMinuteActif !== false && dansFenetreDesistementTardif(date, heureDebut, now, delais.derniereMinuteMin)) return "derniere_minute";
  if (delais.actif !== false && dansFenetreDesistementTardif(date, heureDebut, now, delais.delaiMin)) return "desistement";
  return null;
}

/** Le désistement classique est-il entièrement recouvert par la dernière minute (donc inopérant) ? (fonction pure) */
export function desistementRecouvert(delais: DelaisDesistement): boolean {
  return delais.derniereMinuteActif !== false && delais.derniereMinuteMin >= delais.delaiMin;
}

/** Le type de notification (préférences, canaux) de chaque fenêtre. */
export function typeNotificationDesistement(fenetre: FenetreDesistement): TypeNotification {
  return fenetre === "derniere_minute" ? "desistement_derniere_minute" : "desistement_tardif";
}

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
 * Sommes-nous dans le délai qui précède le début ? (fonction pure) — `delaiMin` est le réglage du
 * club (`getDelaiDesistementMin`), {@link DELAI_DESISTEMENT_TARDIF_MIN} à défaut.
 *
 * Borne comprise (pile au délai, l'alerte part) ; le début lui-même exclu — un cours
 * commencé ne prend plus de réponse, et le même instant que `seanceCommencee` le dit.
 */
export function dansFenetreDesistementTardif(date: string, heureDebut: string, now = new Date(), delaiMin = DELAI_DESISTEMENT_TARDIF_MIN): boolean {
  const reste = parisDateTime(date, heureDebut).getTime() - now.getTime();
  return reste > 0 && reste <= delaiMin * 60_000;
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
  /** Une clé à part : un désistement classique suivi d'un retrait de dernière minute fait deux nouvelles. */
  derniereMinute?: boolean;
}): string {
  return `desistement${args.derniereMinute ? "_dm" : ""}_${args.canal}_${args.seance.id}_${empreinteCreneau(args.seance)}_${args.membreId}_${args.statut}_${args.destinataireId}`;
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
 * Prévient l'encadrement d'un désistement (ou d'un désistement de dernière minute). Rend le nombre d'envois tentés (emails
 * et notifications sur le téléphone confondus) — **ne lève jamais**.
 */
export async function signalerDesistementTardif(signalement: SignalementDesistement): Promise<number> {
  try {
    return await signaler(signalement);
  } catch (e) {
    console.error("[notifications] désistement : échec non bloquant", e);
    return 0;
  }
}

async function signaler({ sessionId, userId, avant, apres, now = new Date() }: SignalementDesistement): Promise<number> {
  const statut = estDesistement(avant, apres);
  if (!statut) return 0;
  // **La fenêtre d'abord, par une lecture légère** : se désister trois jours avant est le cas courant,
  // et il ne doit coûter à la réponse du membre ni la lecture des réglages ni celle de la séance
  // entière (présences, encadrement, période).
  const [creneau, delais] = await Promise.all([
    db.session.findUnique({ where: { id: sessionId }, select: { date: true, heureDebut: true, annulee: true } }),
    getDelaisDesistement(),
  ]);
  const fenetre = creneau && !creneau.annulee ? fenetreDesistement(creneau.date, creneau.heureDebut, now, delais) : null;
  if (!fenetre) return 0;
  const derniereMinute = fenetre === "derniere_minute";
  const type = typeNotificationDesistement(fenetre);
  const typeJournal = derniereMinute ? TYPE_JOURNAL_DESISTEMENT_DERNIERE_MINUTE : TYPE_JOURNAL_DESISTEMENT;
  const delaiMin = derniereMinute ? delais.derniereMinuteMin : delais.delaiMin;
  const [parEmail, parPush] = await Promise.all([envoiPossible(type, "email"), pushPossible(type)]);
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
  if (fenetreDesistement(s.date, s.heureDebut, now, delais) !== fenetre) return 0;

  const membre = await db.user.findUnique({ where: { id: userId }, select: { prenom: true, nom: true, email: true } });
  if (!membre) return 0;
  const nom = `${membre.prenom} ${membre.nom}`.trim();

  // Tous les instructeurs du club, plus l'équipe de la séance, sans le membre lui-même s'il encadre.
  // **Sauf les instructeurs qui ne viennent pas eux-mêmes** (Delta : « sauf si l'instructeur est absent
  // ou peut-être ») : prévenir d'un désistement quelqu'un qui ne sera pas là ne l'aide à rien décider.
  const neViennentPas = new Set(s.attendances.filter((a) => a.statut === "ABSENT" || a.statut === "PEUT_ETRE").map((a) => a.userId));
  const equipe = (await destinatairesDesistement(s, now)).filter((u) => u.id !== userId && !neViennentPas.has(u.id));
  if (equipe.length === 0) return 0;

  const prefs = await getPreferencesNotifications();
  // Les chiffres **après** la nouvelle réponse (elle est déjà en base), dérivés de la liste des
  // invités comme ceux de l'alerte « peu de monde ».
  const chiffres = chiffresEffectif(s);
  const aujourdHui = todayIso(now);
  const seance = { id: s.id, date: s.date, heureDebut: s.heureDebut, heureFin: s.heureFin, lieu: s.lieu };
  let tentes = 0;
  let emails = 0;
  // **Le journal d'audit** : qui a été prévenu, par où, et ce qui a échoué. Le membre est l'acteur — c'est
  // sa réponse qui déclenche — ; le destinataire d'un échec en est la cible.
  const acteur = { id: userId, email: membre.email };
  const action = derniereMinute ? "notification.desistement_derniere_minute" : "notification.desistement";
  const reperes = { sessionId: s.id, seance: `${s.date} ${s.heureDebut}`, nouvelleReponse: statut };
  const noterEchec = (u: InstructeurAlerte, canal: "email" | "push", erreur: string) =>
    audit(acteur, `${action}_echec`, u.id, { ...reperes, canal, destinataire: u.prenom, erreur: erreur.slice(0, 200) });

  if (parEmail) {
    const destinataires = equipe.filter((u): u is InstructeurAlerte & { email: string } => aUnEmail(u) && destinataireRetenu(prefs, type, "email", u));
    const cle = (u: InstructeurAlerte) => cleDesistement({ canal: "email", destinataireId: u.id, membreId: userId, seance, statut, derniereMinute });
    const deja = await clesDejaEnvoyees(destinataires.map(cle));
    for (const u of destinataires) {
      const dedupKey = cle(u);
      if (deja.has(dedupKey)) continue;
      // Le message d'abord : une mise en forme qui lève ne laisse pas de clé derrière elle.
      const { sujet, contenu } = emailDesistementTardif({ prenom: u.prenom, membre: nom, statut, seance, presents: chiffres.presents, invites: chiffres.invites, aujourdHui, delaiMin, derniereMinute });
      // La clé **avant** l'envoi : c'est la contrainte d'unicité qui tranche entre deux passages.
      if (!(await journaliser({ type: typeJournal, canal: "EMAIL", sessionId: s.id, userId: u.id, dedupKey, statut: "ENVOYE" }))) continue;
      try {
        enqueueEmail({ to: u.email, sujet, contenu, ref: dedupKey }, (err) => {
          if (err) {
            void marquerEchec(dedupKey, err.message);
            void noterEchec(u, "email", err.message);
          }
        });
        tentes += 1;
        emails += 1;
      } catch (e) {
        // Une file qui refuse le message ne doit pas garder la clé : elle passerait pour « envoyé ».
        const message = e instanceof Error ? e.message : String(e);
        await marquerEchec(dedupKey, message);
        await noterEchec(u, "email", message);
      }
    }
  }

  let telephones = 0;
  if (parPush) {
    const destinataires = equipe.filter((u) => destinataireRetenu(prefs, type, "push", u));
    telephones = await notifierParPush({
      type: typeJournal,
      sessionId: s.id,
      destinataires,
      cle: (u) => cleDesistement({ canal: "push", destinataireId: u.id, membreId: userId, seance, statut, derniereMinute }),
      charge: () => chargeDesistementPush({ membre: nom, membreId: userId, statut, seance, chiffres, aujourdHui, derniereMinute }),
      surEchec: (u) => noterEchec(u, "push", "aucun appareil atteint"),
    });
    tentes += telephones;
  }
  if (tentes > 0) await audit(acteur, action, null, { ...reperes, emails, telephones, delaiMin });
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
  derniereMinute?: boolean;
}): ChargePush {
  const c = contenuDesistementTardif({ membre: args.membre, statut: args.statut, seance: args.seance, chiffres: args.chiffres, aujourdHui: args.aujourdHui, derniereMinute: args.derniereMinute });
  return {
    titre: args.derniereMinute ? "Désistement de dernière minute" : "Désistement",
    corps: `${c.phrase}. ${c.chiffres}`,
    url: c.chemin,
    // Un tag par membre : deux désistements sur la même séance ne s'écrasent pas sur l'écran verrouillé.
    tag: `desistement-${args.seance.id}-${args.membreId}`,
  };
}

/**
 * **Les instructeurs du club, et l'équipe de la séance** : une seule liste, sans doublon, réduite à qui a
 * un accès actif. Le rôle se lit sur `role` (le rôle de base), jamais sur `estAdmin` : un membre du bureau
 * qui n'enseigne pas n'est pas concerné, un instructeur du bureau l'est.
 */
async function destinatairesDesistement(s: Parameters<typeof equipeJoignable>[0], now: Date): Promise<InstructeurAlerte[]> {
  const instructeurs = await db.user.findMany({
    where: { role: "INSTRUCTEUR", actif: true, service: false },
    select: CHAMPS_DESTINATAIRE,
  });
  const actifs = await filtrerAccesActif(personnesDuClub(instructeurs), now);
  const equipe = await equipeJoignable(s, now);
  const parId = new Map<string, InstructeurAlerte>();
  for (const u of [...actifs, ...equipe]) if (!parId.has(u.id)) parId.set(u.id, u);
  return [...parId.values()];
}
