import { db } from "@/lib/db";
import { identite } from "@/lib/identite";

/**
 * **Demander au bureau de réinitialiser sa double authentification** — la porte de qui a perdu son
 * téléphone et n'entre plus dans l'espace admin, où la 2FA se gère.
 *
 * Trois règles, tenues ici et éprouvées par `tests/unit/demande-deux-fa.test.ts` :
 *
 * 1. **Qui est prévenu** (`destinatairesDemande`) : **tous les autres membres actifs du bureau**,
 *    jamais la personne qui demande — même quand elle est du bureau. Le compte du portail n'est
 *    prévenu **qu'à défaut** d'un autre membre du bureau : c'est la boîte de l'association, le
 *    filet, pas un destinataire de plus à chaque demande.
 * 2. **Pas de rafale** : une demande, puis plus rien pendant `DELAI_ENTRE_DEMANDES_MS` (six heures),
 *    lu dans le journal d'audit (`deux_fa.reinitialisation_demandee`) — la seule trace qui dit aussi,
 *    dans « Comptes admin », qu'une demande attend. Le limiteur de débit (`demande_2fa_user`) et la
 *    clé de déduplication de l'email tiennent la même borne quand deux appuis arrivent ensemble.
 * 3. **L'envoi ne bloque jamais** : la clé se pose avant, se libère sur échec, et une panne du
 *    service de push ne remonte pas.
 */

/**
 * **Où se gère sa propre double authentification** : la carte « Ma double authentification », en tête
 * de « Comptes admin » — là où se réinitialise celle des autres, derrière la même élévation.
 */
export const CHEMIN_MA_DEUX_FA = "/admin/comptes#ma-deux-fa";

/** Six heures entre deux demandes d'une même personne : le temps qu'un membre du bureau la lise. */
export const DELAI_ENTRE_DEMANDES_MS = 6 * 60 * 60 * 1000;

/** L'action d'audit d'une demande. */
export const ACTION_DEMANDE = "deux_fa.reinitialisation_demandee";
/**
 * **Ce qui éteint une demande** : une réinitialisation de sa double authentification (par la
 * personne elle-même ou par un autre), la remise à zéro complète de l'accès depuis sa fiche, ou une
 * double authentification de nouveau réglée par le parcours `/admin/activer` (cas de la commande de
 * secours sur le serveur, qui n'écrit rien au journal). Toutes portent la personne en `cible`.
 */
export const ACTIONS_QUI_ETEIGNENT = ["deux_fa.reinitialisee", "membre.acces_reinitialise", "admin.deux_fa_activee"] as const;

export type CompteBureau = { id: string; prenom: string; nom: string; email: string | null; service: boolean };

/**
 * **Les destinataires d'une demande**, à partir des comptes actifs du bureau (compte du portail
 * compris). Pur : la requête est faite par l'appelant.
 *
 * - la personne qui demande n'est **jamais** destinataire ;
 * - les **personnes** du bureau d'abord (comptes nominatifs) ;
 * - **à défaut d'aucune**, le compte du portail — sauf si c'est lui qui demande, et alors il n'y a
 *   personne : l'écran le dit et donne la sortie de secours (commande sur le serveur).
 */
export function destinatairesDemande<T extends { id: string; service: boolean }>(demandeurId: string, bureau: readonly T[]): { destinataires: T[]; repliPortail: boolean } {
  const autres = bureau.filter((c) => c.id !== demandeurId);
  const personnes = autres.filter((c) => !c.service);
  if (personnes.length > 0) return { destinataires: personnes, repliPortail: false };
  const portail = autres.filter((c) => c.service);
  return { destinataires: portail, repliPortail: portail.length > 0 };
}

/**
 * **Les demandes en attente**, par personne : sa dernière demande est **postérieure** à la dernière
 * réinitialisation de sa double authentification (par elle-même ou par un autre). Pur ; les deux
 * listes viennent du journal d'audit.
 */
export function demandesEnAttente(demandes: readonly { acteurId: string | null; date: Date }[], reinitialisations: readonly { cible: string | null; date: Date }[]): Map<string, Date> {
  const derniereDemande = new Map<string, Date>();
  for (const d of demandes) {
    if (!d.acteurId) continue;
    const deja = derniereDemande.get(d.acteurId);
    if (!deja || d.date > deja) derniereDemande.set(d.acteurId, d.date);
  }
  const dernierReset = new Map<string, Date>();
  for (const r of reinitialisations) {
    if (!r.cible) continue;
    const deja = dernierReset.get(r.cible);
    if (!deja || r.date > deja) dernierReset.set(r.cible, r.date);
  }
  const enAttente = new Map<string, Date>();
  for (const [id, date] of derniereDemande) {
    const reset = dernierReset.get(id);
    if (!reset || date > reset) enAttente.set(id, date);
  }
  return enAttente;
}

/** Les demandes en attente, lues dans le journal d'audit (deux requêtes, quelle que soit la taille du bureau). */
export async function lireDemandesEnAttente(): Promise<Map<string, Date>> {
  const [demandes, reinitialisations] = await Promise.all([
    db.auditLog.findMany({ where: { action: ACTION_DEMANDE }, select: { acteurId: true, date: true } }),
    db.auditLog.findMany({ where: { action: { in: [...ACTIONS_QUI_ETEIGNENT] } }, select: { cible: true, date: true } }),
  ]);
  return demandesEnAttente(demandes, reinitialisations);
}

/** La dernière demande de cette personne, si elle date de moins de six heures. */
export async function demandeRecente(userId: string, maintenant = new Date()): Promise<Date | null> {
  const derniere = await db.auditLog.findFirst({
    where: { action: ACTION_DEMANDE, acteurId: userId, date: { gt: new Date(maintenant.getTime() - DELAI_ENTRE_DEMANDES_MS) } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!derniere) return null;
  // **Une demande dont l'email a échoué ne compte pas** : `marquerEchec` renomme sa clé, qui n'existe
  // donc plus sous son nom. La personne peut redemander au lieu d'attendre six heures pour rien.
  const envoi = await db.notificationLog.findUnique({ where: { dedupKey: cleDemande(userId, derniere.date) }, select: { id: true } });
  return envoi ? derniere.date : null;
}

/** La clé d'une demande : la personne et sa fenêtre de six heures. */
export function cleDemande(userId: string, quand: Date): string {
  return `demande_2fa_${userId}_${Math.floor(quand.getTime() / DELAI_ENTRE_DEMANDES_MS)}`;
}

/** Réinitialisation du mot de passe (« mot de passe oublié ») dans les sept jours : un signal pour le bureau. */
export async function motDePasseReinitialiseRecemment(userId: string, maintenant = new Date()): Promise<Date | null> {
  const r = await db.auditLog.findFirst({
    where: { action: "mot_de_passe.reinitialise", acteurId: userId, date: { gt: new Date(maintenant.getTime() - 7 * 24 * 60 * 60 * 1000) } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return r?.date ?? null;
}

/**
 * **Prévenir le titulaire** d'une demande ou d'une réinitialisation de sa double authentification :
 * email à sa propre adresse et notification sur ses appareils. Toujours envoyé (message de
 * sécurité), une clé par événement posée avant l'envoi, libérée sur échec ; ne lève jamais.
 */
export async function prevenirTitulaireDeuxFa(args: {
  titulaire: { id: string; prenom: string; email: string | null };
  evenement: "demande" | "reinitialisee" | "retiree";
  par?: string | null;
  dedupKey: string;
}): Promise<void> {
  try {
    const { journaliser, marquerEchec } = await import("@/lib/notifications/journal");
    if (args.titulaire.email && (await journaliser({ type: "DEUX_FA_TITULAIRE", canal: "EMAIL", userId: args.titulaire.id, dedupKey: args.dedupKey, statut: "ENVOYE" }))) {
      const { enqueueEmail } = await import("@/lib/email/mailer");
      const { emailDeuxFaTitulaire } = await import("@/lib/email/templates/deux-fa");
      const { sujet, contenu } = emailDeuxFaTitulaire({ prenom: args.titulaire.prenom, evenement: args.evenement, par: args.par, nomApp: (await identite()).nomCourt });
      enqueueEmail({ to: args.titulaire.email, sujet, contenu, ref: args.dedupKey }, (err) => {
        if (err) void marquerEchec(args.dedupKey, err.message);
      });
    }
    const { prevenirTitulaireDeuxFaParPush } = await import("@/lib/notifications/securite");
    await prevenirTitulaireDeuxFaParPush(args.titulaire.id, args.dedupKey);
  } catch (e) {
    console.error("[deux-fa] avis au titulaire : échec non bloquant", e);
  }
}

/** Les comptes actifs du bureau, compte du portail compris : la population où l'on choisit. */
export async function comptesDuBureau(): Promise<CompteBureau[]> {
  return db.user.findMany({
    where: { estAdmin: true, actif: true },
    orderBy: [{ prenom: "asc" }, { nom: "asc" }],
    select: { id: true, prenom: true, nom: true, email: true, service: true },
  });
}

/**
 * **L'envoi** : un email à chaque destinataire qui a une adresse, la même nouvelle sur les
 * téléphones (sans nom). La clé de l'email est posée **avant** l'envoi (`journaliser` : la
 * contrainte d'unicité tranche entre deux appuis simultanés) et libérée au premier échec. Retourne
 * `false` si la clé était déjà prise — la demande est alors déjà partie.
 *
 * `dedupKey` porte la personne et la fenêtre de six heures : deux appuis dans la même fenêtre ne
 * font partir qu'un message.
 */
export async function envoyerDemande(args: {
  demandeur: { id: string; prenom: string; nom: string; email: string | null; service: boolean; estAdmin: boolean };
  destinataires: readonly CompteBureau[];
  dedupKey: string;
  /** Date (déjà mise en forme) d'une réinitialisation récente du mot de passe, signal pour le bureau */
  motDePasseReinitialiseLe?: string | null;
}): Promise<boolean> {
  const { journaliser, marquerEchec } = await import("@/lib/notifications/journal");
  const avecAdresse = args.destinataires.filter((d): d is CompteBureau & { email: string } => !!d.email);
  // La clé de l'email tient l'idempotence des deux canaux, comme pour les alertes de sécurité. Sans
  // aucune adresse, on la pose quand même : le téléphone reste un canal, et la demande ne doit pas
  // repartir au second appui.
  if (!(await journaliser({ type: "DEMANDE_2FA", canal: "EMAIL", userId: args.demandeur.id, dedupKey: args.dedupKey, statut: "ENVOYE" }))) return false;
  const { enqueueEmail } = await import("@/lib/email/mailer");
  const { emailDemandeReinitialisationDeuxFa } = await import("@/lib/email/templates/deux-fa");
  const club = await identite();
  let liberee = false;
  for (const d of avecAdresse) {
    const { sujet, contenu } = emailDemandeReinitialisationDeuxFa({
      prenomDestinataire: d.prenom,
      demandeur: args.demandeur,
      portail: args.demandeur.service,
      horsBureau: !args.demandeur.estAdmin,
      motDePasseReinitialiseLe: args.motDePasseReinitialiseLe,
      nomApp: club.nomCourt,
    });
    enqueueEmail({ to: d.email, sujet, contenu, ref: `${args.dedupKey}_${d.id}` }, (err) => {
      if (!err || liberee) return;
      liberee = true;
      void marquerEchec(args.dedupKey, err.message);
    });
  }
  const { prevenirDemandeDeuxFaParPush } = await import("@/lib/notifications/securite");
  await prevenirDemandeDeuxFaParPush(args.destinataires, args.dedupKey);
  return true;
}
