import { db } from "../db";
import { addDays, joursAvant, todayIso } from "../dates";
import { LIENS_AVANT_DEBUT_JOURS } from "../invitations";
import { emailPeriodeNonActivee } from "../email/templates/periodes";
import { enqueueEmail } from "../email/mailer";
import { envoiPossible } from "./canaux";
import { clesDejaEnvoyees, journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import { destinataireRetenu, getPreferencesNotifications } from "./preferences";
import type { ChargePush } from "./push";

/**
 * **Le trimestre commence, et personne ne l'a activé.**
 *
 * Demandé par.
 *
 * C'est le pendant exact de `fin-periode.ts` — là, il manquait un trimestre ; ici, il est là, tout
 * est prêt, et il manque **un appui**. C'est la panne la plus bête et la plus coûteuse de l'année :
 * les séances existent, les membres sont inscrits, et le jour du premier cours personne n'a de lien
 * parce que la période est restée en brouillon. Rien dans l'application ne le signale — tout y est
 * normal jusqu'au silence du premier mardi.
 *
 * Quatre décisions tiennent ce module :
 *
 * 1. **Le jalon se compte sur le premier cours, pas sur `dateDebut`** — et c'est la même règle que
 *    l'envoi des liens (`envoyerLiensDesTrimestresQuiCommencent`, qui prend la première séance non
 *    annulée, ou la date de début à défaut). Les deux doivent parler du même jour : l'alerte part
 *    exactement quand les liens *seraient* partis.
 * 2. **J-3 puis J-1** (`JALONS_ACTIVATION`). J-3 est le jour où les liens auraient dû partir, et il
 *    laisse le temps de vérifier les créneaux avant d'activer ; J-1 est le dernier moment où
 *    l'activation sert encore à quelque chose. Un seul rappel, manqué un matin de vacances, ne
 *    servirait à rien.
 * 3. **Seuls les brouillons sont réclamés** : une période `ACTIVE` n'a plus rien à faire, une
 *    période `CLOSE` non plus. Le rappel s'arrête donc de lui-même, sans marqueur à poser — la
 *    condition qui le déclenche est exactement celle qu'on demande de lever.
 * 4. **Le nombre de membres inscrits est dit** : c'est lui qui transforme « une période n'est pas
 *    activée » en « douze personnes n'auront pas de lien mardi ».
 *
 * Comme les autres pense-bêtes d'organisation, il part par email **et** sur le téléphone, aux
 * administrateurs, chacun réglant les deux canaux dans « Mon profil ».
 */
export const TYPE_PERIODE_NON_ACTIVEE = "PERIODE_NON_ACTIVEE";

/** Jours avant le premier cours où l'alerte part, tant que la période est en brouillon. */
export const JALONS_ACTIVATION = [LIENS_AVANT_DEBUT_JOURS, 1] as const;
export type JalonActivation = (typeof JALONS_ACTIVATION)[number];

export function clePeriodeNonActivee(periodId: string, userId: string, jalon: number): string {
  return `periode_non_activee_j${jalon}_${periodId}_${userId}`;
}

export function clePeriodeNonActiveePush(periodId: string, userId: string, jalon: number): string {
  return `periode_non_activee_push_j${jalon}_${periodId}_${userId}`;
}

/**
 * Le jalon d'une période pour la journée en cours, ou `null` si ce n'est ni J-3 ni J-1.
 * Fonction pure : c'est elle que les tests interrogent, sans base ni horloge.
 */
export function jalonActivation(premierCours: string, aujourdHui: string): JalonActivation | null {
  const restants = joursAvant(aujourdHui, premierCours);
  return (JALONS_ACTIVATION as readonly number[]).includes(restants) ? (restants as JalonActivation) : null;
}

/** La notification sur l'appareil : l'appui ouvre la période, là où se trouve le bouton d'activation. */
export function chargePeriodeNonActiveePush(periode: { id: string; nom: string }, jalon: number, membres: number): ChargePush {
  return {
    titre: "Période à activer",
    corps: `« ${periode.nom} » commence ${jalon <= 1 ? "demain" : `dans ${jalon} jours`} et n'est pas activée : ${membres} membre${membres > 1 ? "s" : ""} sans lien personnel.`,
    url: `/admin/periodes/${periode.id}`,
    tag: `periode-non-activee-${periode.id}`,
  };
}

/** Ce qu'il faut de chaque administrateur pour décider si l'alerte lui part. */
const CHAMPS_ADMIN = { id: true, prenom: true, email: true, actif: true, rappelEmail: true, preferencesNotifications: true } as const;

/**
 * Passe quotidienne : alerte les administrateurs sur les périodes qui commencent sans être activées.
 * Retourne le nombre d'emails mis en file.
 */
export async function alerterPeriodeNonActivee(now = new Date()): Promise<number> {
  try {
    const [parEmail, parPush] = await Promise.all([envoiPossible("periode_non_activee", "email"), pushPossible("periode_non_activee")]);
    if (!parEmail && !parPush) return 0;
    const aujourdHui = todayIso(now);
    // Fenêtre large en base (du jour au plus lointain des jalons), jalon exact calculé ensuite : le
    // jour qui compte est celui du **premier cours**, que seule la requête peut donner.
    const limite = addDays(aujourdHui, Math.max(...JALONS_ACTIVATION));
    const brouillons = await db.period.findMany({
      where: { statut: "BROUILLON", dateDebut: { lte: limite } },
      select: {
        id: true,
        nom: true,
        dateDebut: true,
        _count: { select: { membres: true } },
        sessions: { where: { annulee: false }, orderBy: { date: "asc" }, take: 1, select: { date: true } },
      },
    });
    if (brouillons.length === 0) return 0;
    const prefs = await getPreferencesNotifications();
    // Le compte du bureau reçoit aussi : activer la période est exactement son affaire (même
    // raisonnement que pour « la période suivante reste à créer »). Le bureau se lit sur
    // `estAdmin` : `role` ne vaut plus jamais « ADMIN », et la requête d'avant ne rendait plus
    // personne — l'alerte se serait tue sans rien dire.
    const admins = await db.user.findMany({ where: { estAdmin: true, actif: true }, select: CHAMPS_ADMIN });
    const destinataires = parEmail ? admins.filter((u): u is typeof u & { email: string } => destinataireRetenu(prefs, "periode_non_activee", "email", u)) : [];
    const surTelephone = parPush ? admins.filter((u) => destinataireRetenu(prefs, "periode_non_activee", "push", u)) : [];
    if (destinataires.length === 0 && surTelephone.length === 0) return 0;
    let envoyes = 0;
    for (const p of brouillons) {
      // Même yardstick que l'envoi des liens : la première séance qui aura lieu, sinon la date de début.
      const premierCours = p.sessions[0]?.date ?? p.dateDebut;
      const jalon = jalonActivation(premierCours, aujourdHui);
      if (!jalon) continue;
      const membres = p._count.membres;
      const deja = await clesDejaEnvoyees(destinataires.map((u) => clePeriodeNonActivee(p.id, u.id, jalon)));
      for (const u of destinataires) {
        const cle = clePeriodeNonActivee(p.id, u.id, jalon);
        if (deja.has(cle)) continue;
        if (!(await journaliser({ type: TYPE_PERIODE_NON_ACTIVEE, canal: "EMAIL", userId: u.id, dedupKey: cle, statut: "ENVOYE" }))) continue;
        const { sujet, contenu } = emailPeriodeNonActivee({ prenom: u.prenom, periode: p, premierCours, jours: jalon, membres });
        enqueueEmail({ to: u.email, sujet, contenu, ref: cle }, (err) => {
          if (err) void marquerEchec(cle, err.message);
        });
        envoyes++;
      }
      await notifierParPush({
        type: TYPE_PERIODE_NON_ACTIVEE,
        destinataires: surTelephone,
        cle: (u) => clePeriodeNonActiveePush(p.id, u.id, jalon),
        charge: () => chargePeriodeNonActiveePush(p, jalon, membres),
      });
    }
    return envoyes;
  } catch (e) {
    // Une tâche de fond ne fait jamais tomber le serveur : on note et on repassera demain.
    console.error("[notifications] alerte de période non activée", e);
    return 0;
  }
}
