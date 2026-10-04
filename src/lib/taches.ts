import { purgerAffichesOrphelines } from "./affiches";
import { purgerEvenementsAnciens } from "./evenements";
import { purgerRateLimits } from "./auth/rate-limit";
import { purgeExpiredSessions } from "./auth/session";
import { envoyerLiensDesTrimestresQuiCommencent, renouvelerLiensExpirants } from "./invitations";
import { getRetentionAuditJours, purgerAudit } from "./alertes";
import { bequilleDevActive } from "./env";
import { alerterEffectifFaible } from "./notifications/seances";
import { rappelerPeriodeSuivante } from "./notifications/fin-periode";
import { alerterPeriodeNonActivee } from "./notifications/periode-non-activee";
import { envoyerRecapVeille, type BilanRecap } from "./notifications/recap";
import { envoyerRappelsSansReponse, type BilanRappels } from "./notifications/rappels";
import { purgerNotifications } from "./notifications/journal";
import { estPassageEnvois } from "./notifications/planification";
import { heureRecap } from "./settings";
import { sauvegarderBase } from "./sauvegarde";

/**
 * Tâches planifiées de l'application (node-cron, fuseau Europe/Paris), démarrées une fois au lancement
 * du serveur (src/instrumentation.ts) :
 *
 * - 03:30 — sauvegarde de la base ;
 * - 07:00 — entretien quotidien (sessions, liens, limiteurs, **les deux journaux**, alerte « peu de
 *   monde », rappel de la période suivante à créer) ;
 * - chaque minute — `tickEnvois` : ne fait rien sauf à l'heure réglée pour le récap (Gestion →
 *   Réglages, défaut 18:00) **et à quelques repassages de rattrapage** derrière elle, où partent le
 *   récap de la veille (email + Discord), les rappels aux personnes sans réponse (J-7 et J-2) **et
 *   l'alerte « peu de monde »**. L'heure est relue à chaque passage : la modifier dans l'interface
 *   prend effet tout de suite, sans redémarrage. Les envois sont idempotents
 *   (NotificationLog.dedupKey), donc un rejeu ou un redémarrage ne double jamais un message — c'est
 *   ce qui rend le rattrapage gratuit (`estPassageEnvois`).
 */
export const TZ = "Europe/Paris";

/**
 * Entretien quotidien : sessions expirées purgées, liens d'accès arrivant à terme renouvelés et
 * renvoyés, et affiches orphelines effacées — un fichier déposé dans le formulaire puis abandonné
 * (annulation, image remplacée) reste sinon sur le disque sans que personne ne le réclame.
 *
 * S'y ajoutent les deux échéances de trimestre que rien ne montre dans l'application tant qu'il
 * n'est pas trop tard : le rappel quand un trimestre s'achève sans que le suivant ait été créé
 * (J-7 puis J-2), et l'alerte quand un trimestre créé commence **sans avoir été activé** (J-3 puis
 * J-1) — là, tout est prêt, et il manque un appui pour que les liens partent.
 *
 * S'y ajoute enfin l'oubli des vieilles annonces : une affiche d'événement terminé depuis plus de six
 * mois n'informe plus personne (voir `purgerEvenementsAnciens`). L'ordre compte — on efface les
 * annonces **avant** de ramasser les affiches orphelines, pour que l'image d'une annonce effacée
 * parte dans le même passage plutôt que d'attendre le lendemain.
 *
 * **Deux journaux, deux purges**. Le journal d'audit avait la sienne depuis toujours ; celui des
 * notifications n'en avait aucune, alors qu'il dit nommément qui a reçu quel message. Sa rétention
 * est plus courte (90 jours, `RETENTION_NOTIFICATIONS_JOURS`) et **ne dépasse jamais celle de
 * l'audit** : elle se lit ici, une fois, et se passe à `purgerNotifications` — c'est déjà la
 * requête que `purgerAudit` fait juste avant, et une purge n'a pas à deviner le réglage de l'autre.
 */
export async function entretienQuotidien(now = new Date()): Promise<{ sessionsPurgees: number; liensEnvoyes: number; liensRenouveles: number; limiteursPurges: number; auditPurge: number; notificationsPurgees: number; alertesEffectif: number; rappelsPeriode: number; alertesActivation: number; evenementsPurges: number; affichesPurgees: number }> {
  const sessionsPurgees = await etape("purge des sessions", 0, () => purgeExpiredSessions());
  // **Avant** le renouvellement : un trimestre qui commence donne un lien neuf à chacun et révoque
  // les anciens. Les renouveler d'abord aurait expédié un second email à ceux dont le vieux lien
  // arrivait à terme — pour un lien qui allait de toute façon être remplacé dans la foulée.
  const liensEnvoyes = await etape("liens des trimestres qui commencent", 0, () => envoyerLiensDesTrimestresQuiCommencent(now));
  const liensRenouveles = await etape("renouvellement des liens", 0, () => renouvelerLiensExpirants(now));
  const limiteursPurges = await etape("purge des limiteurs", 0, () => purgerRateLimits(now));
  const auditPurge = await etape("purge du journal d'audit", 0, () => purgerAudit(now));
  // La rétention de l'audit **borne** celle des notifications : le journal le plus bavard des deux
  // ne survit pas au plus encadré (voir `purgerNotifications`). Illisible, on s'en tient au plancher
  // livré plutôt que de ne rien purger — une purge qui ne tourne jamais est une promesse vide.
  const notificationsPurgees = await etape("purge du journal des notifications", 0, async () => {
    const retentionAudit = await getRetentionAuditJours().catch(() => undefined);
    return purgerNotifications(now, retentionAudit);
  });
  const alertesEffectif = await etape("alerte « peu de monde »", 0, () => alerterEffectifFaible(now));
  const rappelsPeriode = await etape("rappel de la période suivante", 0, () => rappelerPeriodeSuivante(now));
  // Le pendant du précédent : la période existe, tout est prêt, et il manque un appui sur « Activer ».
  const alertesActivation = await etape("alerte de période non activée", 0, () => alerterPeriodeNonActivee(now));
  const evenementsPurges = await etape("purge des vieilles annonces", 0, () => purgerEvenementsAnciens(now));
  const affichesPurgees = await etape("purge des affiches orphelines", 0, () => purgerAffichesOrphelines(now));
  return { sessionsPurgees, liensEnvoyes, liensRenouveles, limiteursPurges, auditPurge, notificationsPurgees, alertesEffectif, rappelsPeriode, alertesActivation, evenementsPurges, affichesPurgees };
}

/**
 * **Une étape du balayage nocturne, isolée des autres.**
 *
 * Les dix étapes s'enchaînaient sans garde : la première exception — base verrouillée par la
 * sauvegarde, réglage illisible, SMTP qui lève — emportait tout ce qui venait après, et le `catch` du
 * cron n'en gardait qu'une ligne de journal. Une alerte « peu de monde » qui tombait en panne faisait
 * ainsi sauter le rappel de la période suivante, la purge d'audit et le ménage des affiches, chaque
 * nuit, jusqu'à ce que quelqu'un lise les journaux du serveur.
 *
 * Chacune est donc rattrapée sur place, nommée, et rend une valeur neutre : le balayage va au bout,
 * et le compte rendu dit simplement qu'il ne s'est rien passé de ce côté-là.
 */
async function etape<T>(nom: string, valeurSiEchec: T, travail: () => Promise<T>): Promise<T> {
  try {
    return await travail();
  } catch (e) {
    console.error(`[taches] entretien quotidien — étape « ${nom} » en échec, le balayage continue`, e);
    return valeurSiEchec;
  }
}

/**
 * Sauvegarde quotidienne de la base SQLite vers BACKUP_DIR (rétention 30 jours).
 * Un échec est journalisé mais ne doit jamais interrompre l'application.
 */
export async function sauvegardeQuotidienne(now = new Date()): Promise<void> {
  try {
    const { fichier, octets, supprimees } = await sauvegarderBase(now);
    console.info(`[taches] sauvegarde : ${fichier} (${Math.round(octets / 1024)} Kio), ${supprimees} ancienne(s) supprimée(s)`);
  } catch (e) {
    console.error("[taches] sauvegarde quotidienne en échec", e);
  }
}

/**
 * Envois du soir : récap de la veille (email individuel + message sur les salons), rappels aux
 * personnes sans réponse, **et l'alerte « peu de monde »**. Un échec de l'un ne doit pas empêcher les
 * autres.
 *
 * **Pourquoi l'alerte d'effectif est ici aussi**. Sa docstring justifiait son compromis sur
 * `journaliser` par « le passage suivant du balayage (toutes les 15 min pendant la fenêtre de
 * rattrapage, puis le lendemain) refait partir l'alerte entière » — une fenêtre que rien ne
 * branchait : `alerterEffectifFaible` n'était appelée que par {@link entretienQuotidien}, planifié
 * `0 7 * * *`. **Un seul passage par jour, sans rattrapage**, là où `estPassageEnvois` et
 * `FENETRE_RATTRAPAGE_MIN` ne gouvernent que {@link tickEnvois}.
 *
 * Or la fenêtre de l'alerte va de J-3 **au jour même** : pour une séance du jour, le passage de 07:00
 * est le premier *et* le dernier. Trois minutes de SMTP fâché, `marquerEchec` libérait bien la clé —
 * et **rien ne la rejouait**. L'équipe ouvrait la salle pour personne, sans avoir jamais été
 * prévenue : exactement la panne que la promesse écartait.
 *
 * L'alerte est idempotente (une clé par séance, `effectif_<id>`), donc l'ajouter ici ne coûte que
 * quelques requêtes aux repassages qui n'ont rien à faire — le même calcul que pour le récap.
 * Elle reste dans le balayage de 07:00 : le matin est le moment utile pour décider d'un cours du
 * soir, le passage de 18:00 n'est qu'un filet.
 */
export async function envoisDuSoir(now = new Date()): Promise<{ recap: BilanRecap; rappels: BilanRappels; alertesEffectif: number }> {
  let recap: BilanRecap = { seances: 0, emails: 0, discord: 0, telegram: 0 };
  let rappels: BilanRappels = { seances: 0, emails: 0 };
  let alertesEffectif = 0;
  try {
    recap = await envoyerRecapVeille(now);
  } catch (e) {
    console.error("[taches] récap de la veille en échec", e);
  }
  try {
    rappels = await envoyerRappelsSansReponse(now);
  } catch (e) {
    console.error("[taches] rappels aux personnes sans réponse en échec", e);
  }
  try {
    alertesEffectif = await alerterEffectifFaible(now);
  } catch (e) {
    console.error("[taches] alerte « peu de monde » du soir en échec", e);
  }
  return { recap, rappels, alertesEffectif };
}

/**
 * Passage de chaque minute : compare l'heure de Paris à l'heure réglée et déclenche les envois du
 * soir le cas échéant. Retourne vrai si les envois ont été déclenchés (utile aux tests et aux journaux).
 *
 * Ce n'est plus la seule minute de l'heure réglée : `estPassageEnvois` repasse toutes les
 * `PAS_RATTRAPAGE_MIN` minutes pendant `FENETRE_RATTRAPAGE_MIN` minutes. Un serveur
 * redémarré pile à 18:00, un cron en retard, une heure avalée par le changement d'horaire ne coûtent
 * plus la journée entière de récap — et un envoi mis en échec (clé libérée par `marquerEchec`) est
 * vraiment rejoué, ce que la promesse de `journal.ts` n'avait jamais tenu ici.
 */
export async function tickEnvois(now = new Date()): Promise<boolean> {
  let heure: string;
  try {
    heure = await heureRecap();
  } catch (e) {
    console.error("[taches] heure du récap illisible", e);
    return false;
  }
  if (!estPassageEnvois(heure, now)) return false;
  const { recap, rappels, alertesEffectif } = await envoisDuSoir(now);
  console.info(
    `[taches] envois de ${heure} : récap ${recap.emails} email(s) et ${recap.discord} message(s) Discord sur ${recap.seances} séance(s) de demain, ${rappels.emails} rappel(s) sans réponse, ${alertesEffectif} alerte(s) d'effectif`,
  );
  return true;
}

let demarre = false;

export async function demarrerTaches(): Promise<void> {
  // `bequilleDevActive` et non `process.env` : les béquilles de développement sont neutralisées en
  // production, et c'est exactement ce qu'on veut ici — une variable posée par mégarde dans la
  // stack couperait en silence les sauvegardes, l'entretien, la purge d'audit et le récap du soir.
  if (demarre || bequilleDevActive("CRON_DISABLED")) return;
  demarre = true;
  const cron = await import("node-cron");
  // Tous les jours à 7 h (heure de Paris)
  cron.schedule(
    "0 7 * * *",
    async () => {
      try {
        const r = await entretienQuotidien();
        console.info(`[taches] entretien quotidien : ${r.sessionsPurgees} session(s) purgée(s), ${r.liensRenouveles} lien(s) renouvelé(s), ${r.auditPurge} entrée(s) d'audit purgée(s), ${r.notificationsPurgees} ligne(s) de journal de notification purgée(s), ${r.alertesEffectif} alerte(s) d'effectif, ${r.rappelsPeriode} rappel(s) de période suivante, ${r.evenementsPurges} annonce(s) de plus de 6 mois effacée(s), ${r.affichesPurgees} affiche(s) orpheline(s) effacée(s)`);
      } catch (e) {
        console.error("[taches] entretien quotidien en échec", e);
      }
    },
    { timezone: TZ },
  );
  // Sauvegarde de la base tous les jours à 3 h 30 (heure de Paris), hors des heures d'usage
  cron.schedule("30 3 * * *", () => void sauvegardeQuotidienne(), { timezone: TZ });
  // Chaque minute : l'heure du récap est un réglage modifiable, on la relit au lieu de figer un cron
  cron.schedule("* * * * *", () => void tickEnvois(), { timezone: TZ });
  console.info("[taches] planification démarrée (sauvegarde à 03:30, entretien quotidien à 07:00, envois du soir à l'heure réglée — Europe/Paris)");
}
