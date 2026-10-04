import { db } from "../db";
import { todayIso } from "../dates";
import { cheminNouvellePeriode, periodeAttendueApres } from "../periodes";
import { emailPeriodeSuivante } from "../email/templates/periodes";
import { enqueueEmail } from "../email/mailer";
import { envoiPossible } from "./canaux";
import { clesDejaEnvoyees, journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import { datesJalons, jalonPour, type Jalon } from "./planification";
import { destinataireRetenu, getPreferencesNotifications } from "./preferences";
import type { ChargePush } from "./push";

/**
 * **La période suivante reste à créer.**
 *
 * Un trimestre se termine, et rien ne prend la suite : le jour de la rentrée, plus personne n'a de
 * séance à laquelle répondre, et les liens personnels ne rattachent à rien. Ça ne se voit pas
 * depuis l'application — tout y est normal jusqu'au dernier cours —, alors l'application le dit :
 * **une semaine avant, puis deux jours avant**, aux administrateurs, tant que rien n'a été créé.
 *
 * Trois décisions tiennent ce module :
 *
 * 1. **Seuls les trimestres et les bimestres sont réclamés** (`periodeAttendueApres` rend `null`
 *    pour une période libre) : un stage de Pâques qui s'achève n'appelle aucune suite, et le club
 *    n'a pas à recevoir un rappel par cycle ponctuel terminé.
 * 2. **« Créée » veut dire créée, même en brouillon** : on cherche n'importe quelle période qui
 *    commence après celle qui s'achève, quels que soient son nom et son statut. L'administrateur
 *    qui a commencé le travail a fait ce qu'on lui demandait ; le rappel s'arrête là. Réclamer un
 *    nom exact reviendrait à harceler quelqu'un qui a déjà ouvert le dossier.
 * 3. **Une clé de journal par personne, par jalon et par canal**
 *    (`periode_suivante_j7_<période>_<personne>` pour l'email,
 *    `periode_suivante_push_j7_<période>_<personne>` pour le téléphone) : le J-2 part bien après le
 *    J-7, un administrateur nommé entre les deux reçoit quand même le second rappel, et un canal
 *    n'éteint jamais l'autre.
 *
 * Le rappel part aussi **sur le téléphone**, aux mêmes administrateurs : c'est un pense-bête, et un
 * pense-bête qui dort dans une boîte mail ne sert à rien. Chacun règle les deux canaux séparément
 * dans « Mon profil ».
 */
export const TYPE_PERIODE_SUIVANTE = "PERIODE_SUIVANTE";

export function clePeriodeSuivante(periodId: string, userId: string, jalon: Jalon): string {
  return `periode_suivante_j${jalon}_${periodId}_${userId}`;
}

export function clePeriodeSuivantePush(periodId: string, userId: string, jalon: Jalon): string {
  return `periode_suivante_push_j${jalon}_${periodId}_${userId}`;
}

/**
 * La notification sur l'appareil : ce qui se termine, ce qui manque, et l'appui ouvre le formulaire
 * déjà rempli — le même lien que le bouton principal de l'email.
 */
export function chargePeriodeSuivantePush(
  periode: { id: string; nom: string },
  attendue: { nom: string; saison: number; trimestre?: number; bimestre?: number; decalage?: number },
  jalon: Jalon,
): ChargePush {
  return {
    titre: "Période suivante à créer",
    corps: `« ${periode.nom} » se termine ${jalon <= 2 ? "dans deux jours" : "dans une semaine"}. « ${attendue.nom} » reste à créer.`,
    url: cheminNouvellePeriode(attendue),
    tag: `periode-suivante-${periode.id}`,
  };
}

/** Ce qu'il faut de chaque administrateur pour décider si le rappel lui part. */
const CHAMPS_ADMIN = { id: true, prenom: true, email: true, actif: true, rappelEmail: true, preferencesNotifications: true } as const;

/**
 * Passe quotidienne : rappelle aux administrateurs les trimestres qui s'achèvent sans suite.
 * Retourne le nombre d'emails mis en file.
 */
export async function rappelerPeriodeSuivante(now = new Date()): Promise<number> {
  try {
    const [parEmail, parPush] = await Promise.all([envoiPossible("periode_suivante", "email"), pushPossible("periode_suivante")]);
    if (!parEmail && !parPush) return 0;
    const aujourdHui = todayIso(now);
    // Les deux jalons en une requête : une période qui finit dans 7 jours, ou dans 2.
    const finissantes = await db.period.findMany({
      where: { statut: "ACTIVE", dateFin: { in: datesJalons(aujourdHui) } },
      select: { id: true, nom: true, dateDebut: true, dateFin: true },
    });
    if (finissantes.length === 0) return 0;
    const prefs = await getPreferencesNotifications();
    // Le compte du bureau (`service`) reçoit aussi : c'est l'adresse de l'association, et créer la
    // période est exactement son affaire. Ce n'est pas un message de club, c'est un pense-bête
    // d'organisation — la règle « pas de message aux comptes de service » ne s'y applique pas. Le
    // bureau se lit sur `estAdmin` : `role` ne vaut plus jamais « ADMIN », et la requête d'avant ne
    // rendait plus personne — le pense-bête se serait tu sans rien dire.
    const admins = await db.user.findMany({ where: { estAdmin: true, actif: true }, select: CHAMPS_ADMIN });
    const destinataires = parEmail ? admins.filter((u): u is typeof u & { email: string } => destinataireRetenu(prefs, "periode_suivante", "email", u)) : [];
    // Sur le téléphone, l'adresse email n'entre pas en jeu : seul l'accord de la personne compte.
    const surTelephone = parPush ? admins.filter((u) => destinataireRetenu(prefs, "periode_suivante", "push", u)) : [];
    if (destinataires.length === 0 && surTelephone.length === 0) return 0;
    let envoyes = 0;
    for (const p of finissantes) {
      const jalon = jalonPour(p.dateFin, aujourdHui);
      if (!jalon) continue;
      const attendue = periodeAttendueApres(p);
      if (!attendue) continue;
      const suivante = await db.period.count({ where: { dateDebut: { gt: p.dateFin } } });
      if (suivante > 0) continue;
      const deja = await clesDejaEnvoyees(destinataires.map((u) => clePeriodeSuivante(p.id, u.id, jalon)));
      for (const u of destinataires) {
        const cle = clePeriodeSuivante(p.id, u.id, jalon);
        if (deja.has(cle)) continue;
        if (!(await journaliser({ type: TYPE_PERIODE_SUIVANTE, canal: "EMAIL", userId: u.id, dedupKey: cle, statut: "ENVOYE" }))) continue;
        const { sujet, contenu } = emailPeriodeSuivante({ prenom: u.prenom, periode: p, attendue, jours: jalon });
        enqueueEmail({ to: u.email, sujet, contenu, ref: cle }, (err) => {
          if (err) void marquerEchec(cle, err.message);
        });
        envoyes++;
      }
      // Le même pense-bête sur les appareils. Il ne compte pas dans le retour, qui parle des emails,
      // et il ne peut rien faire échouer : `notifierParPush` avale tout.
      await notifierParPush({
        type: TYPE_PERIODE_SUIVANTE,
        destinataires: surTelephone,
        cle: (u) => clePeriodeSuivantePush(p.id, u.id, jalon),
        charge: () => chargePeriodeSuivantePush(p, attendue, jalon),
      });
    }
    return envoyes;
  } catch (e) {
    // Une tâche de fond ne fait jamais tomber le serveur : on note et on repassera demain.
    console.error("[notifications] rappel de période suivante", e);
    return 0;
  }
}
