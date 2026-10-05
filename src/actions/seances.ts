"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPermission, exigerReauth, requireUser } from "@/lib/auth/current-user";
import { indiquerPresence } from "@/actions/presences";
import { champ, zodToFormState, type FormState } from "@/lib/form";
import { ecritureFermee, REFUS_PERIODE_CLOSE } from "@/lib/constants";
import { annulationSchema, seancesEnMasseSchema, seanceSchema, themeSchema } from "@/lib/validation/gestion";
import { notifierAnnulation, phraseAnnulation, porteurJetonAnnulation } from "@/lib/notifications/seances";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { partiesInitiales } from "@/lib/planning";
import { formatDateSansAnnee, seanceCommencee } from "@/lib/dates";
import { seanceAnnulable, seanceRetablissable } from "@/components/seances/gestes-seance";

function rafraichir(sessionId?: string) {
  revalidatePath("/seances");
  revalidatePath("/");
  revalidatePath("/planning");
  if (sessionId) revalidatePath(`/seances/${sessionId}`);
}

/**
 * **Une période close verrouille le planning, elle doit verrouiller la séance elle-même.**
 *
 * Le trou, relevé : la grille refusait déjà toute écriture sur un trimestre clos
 * (`partiePourEcriture` / `seancePourEcriture`, src/actions/planning.ts, et la file des ateliers
 * avec `periodeOuverte`, src/actions/ateliers.ts) — mais la séance, elle, restait grande ouverte.
 * On pouvait donc changer son horaire, réécrire son thème, l'effacer, et surtout **l'annuler** :
 * une annulation fait partir un email à tous les invités, une annonce sur le salon Discord et sur
 * Telegram. À propos d'un cours d'un trimestre terminé. Rien dans l'écran ne prévenait, parce que
 * rien dans le serveur ne refusait.
 *
 * Une période close **peut** porter des séances à venir — on clôt un trimestre sans attendre son
 * dernier cours (voir `periodeOuverte`) : le verrou ne peut donc pas se déduire de la date.
 *
 * Le refus est **le même** que celui du planning, et il dit pourquoi. La règle, elle, ne s'écrit plus
 * ici : elle a été la quatrième écriture de la même chose dans le dépôt, et elle vit désormais dans
 * `src/lib/constants.ts` (`ecritureFermee`, `REFUS_PERIODE_CLOSE`), lue par les quatre appelants.
 */

const SEANCE_INTROUVABLE = "Séance introuvable.";

async function seancePourEcriture(sessionId: string) {
  const seance = await db.session.findUnique({
    where: { id: sessionId },
    // `annulee` et `motifAnnulation` : `annulerSeance` doit savoir si le cours l'est **déjà**, pour ne
    // pas réannoncer (voir son commentaire).
    // `heureDebut` : une séance commencée ne s'annule ni ne se rétablit (`seanceAnnulable`).
    select: { id: true, periodId: true, date: true, heureDebut: true, lieu: true, adresse: true, heureFin: true, annulee: true, motifAnnulation: true, period: { select: { statut: true } } },
  });
  if (!seance) return { erreur: SEANCE_INTROUVABLE } as const;
  if (ecritureFermee(seance.period.statut)) return { erreur: REFUS_PERIODE_CLOSE.seance } as const;
  return { seance } as const;
}

/**
 * Même question pour une séance qui **n'existe pas encore** : la période est alors tout ce qu'on a.
 * Le formulaire ne propose déjà que les trimestres non clos (`/seances/nouvelle`), mais un `periodId`
 * recopié dans une requête forgée ne passe pas par le formulaire — et le planning, lui, a la même
 * paire de gardes pour la même raison (`partiePourEcriture` / `seancePourEcriture`).
 */
async function periodePourEcriture(periodId: string) {
  const periode = await db.period.findUnique({ where: { id: periodId }, select: { statut: true } });
  if (!periode) return { erreur: "Ce trimestre n'existe plus." } as const;
  if (ecritureFermee(periode.statut)) return { erreur: REFUS_PERIODE_CLOSE.seance } as const;
  return {} as const;
}

/**
 * **Le refus d'un geste sur une séance commencée**, dans les mots de ce geste.
 *
 * L'écran ne proposait déjà ni l'un ni l'autre sur un cours commencé (`gestesSeance`) — mais l'écran
 * n'est pas la garde : `annulerSeance` est une route ouverte, et un appel forgé faisait partir
 * l'annonce d'annulation d'un cours pendant qu'il se donnait. La règle est **celle de l'écran**
 * (`seanceAnnulable`, `seanceRetablissable`), lue ici et non recopiée ; le geste de masse s'en sert
 * pareil, sans quoi le lot aurait eu une serrure que la séance seule n'avait pas.
 */
const REFUS_COMMENCEE = {
  annuler: "Ce cours a déjà commencé : on ne l'annonce plus annulé à des gens qui sont dans la salle.",
  retablir: "Ce cours a déjà commencé : il ne redevient pas un cours prévu.",
} as const;

function commencee(seance: { date: string; heureDebut: string }): boolean {
  return seanceCommencee(seance.date, seance.heureDebut);
}

/**
 * **Détacher les ateliers d'une séance qu'on efface** — l'unique écriture de cette règle dans le
 * module, pour la séance seule comme pour un lot. Voir `supprimerSeance` pour le pourquoi : un atelier
 * planifié sur une séance disparue repasse « en attente », les autres sont détachés explicitement,
 * sans compter sur le `SetNull` de la base.
 *
 * Elle rend les deux écritures **sans les lancer** : c'est l'appelant qui les range dans sa
 * transaction, avec l'effacement lui-même — que le balayage des gardes veut lire dans le corps de
 * l'action exportée, pas dans un utilitaire.
 */
function detacherAteliers(sessionId: string | { in: string[] }) {
  return [
    db.atelier.updateMany({ where: { sessionId, statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } }),
    db.atelier.updateMany({ where: { sessionId }, data: { sessionId: null } }),
  ];
}

function lireSeance(fd: FormData) {
  return seanceSchema.safeParse({
    periodId: champ(fd, "periodId"),
    date: champ(fd, "date"),
    heureDebut: champ(fd, "heureDebut"),
    heureFin: champ(fd, "heureFin"),
    lieu: champ(fd, "lieu"),
    adresse: champ(fd, "adresse"),
    theme: champ(fd, "theme"),
  });
}

export async function creerSeance(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("sessions.manage");
  const parsed = lireSeance(fd);
  if (!parsed.success) return zodToFormState(parsed.error);
  const data = parsed.data;
  // On ne fait pas naître un cours dans un trimestre terminé : la liste déroulante ne les propose
  // pas, mais elle n'est pas la garde (voir `periodePourEcriture`).
  const ouverte = await periodePourEcriture(data.periodId);
  if (ouverte.erreur) return { erreur: ouverte.erreur, erreurs: { periodId: "Trimestre clos." } };
  // **Une séance naît avec les parties du modèle** (`PARTIES_MODELE`) : les quatre cases étaient
  // dessinées par la grille, faute de lignes en base. Maintenant que les parties sont des données,
  // une séance sans ligne serait une séance sans rien à remplir.
  //
  // **Le modèle n'en porte plus que deux — deux cours** : il décrit ce qu'une séance a toujours,
  // pas ce qu'elle pourrait avoir. Les deux options qu'il posait d'office naissaient vides sur
  // chaque séance du trimestre, et une case vide ne dit rien d'autre que « il manque quelque
  // chose ». On les ajoute maintenant quand il y en a.
  const session = await db.session.create({ data: { ...data, parties: { create: partiesInitiales() } } });
  await audit(user, "seance.creee", session.id, { date: data.date, heureDebut: data.heureDebut });
  rafraichir();
  redirect(`/seances/${session.id}`);
}

/**
 * **La liste déroulante « Période » est lue, et un changement est refusé — au lieu d'être jeté en
 * silence.**
 *
 * Elle était déstructurée dans une variable inutilisée : choisir un autre trimestre et enregistrer
 * répondait « Séance enregistrée » sans rien avoir déplacé. Un écran qui ment sur ce qu'il vient de
 * faire est pire qu'un écran qui refuse.
 *
 * **Pourquoi refuser plutôt qu'accepter**, alors que le champ existe bien à la *création* : une
 * séance porte les réponses des membres (`Attendance`), et le dénominateur de tous les taux est
 * l'effectif invité **de sa période**. La déplacer d'un trimestre à l'autre recréerait exactement
 * la maladie que `retirerMembrePeriode` vient de soigner — des réponses de gens absents du nouveau
 * dénominateur, donc des « 12 présents sur 11 ». Pour que le déplacement soit juste, il faudrait
 * effacer au passage les réponses des personnes non invitées sur le trimestre d'arrivée : une perte
 * de données sèche, déclenchée par un menu déroulant, sans confirmation ni décompte annoncé. Le
 * geste ne vaut pas ce risque — il se fait en créant la séance là où elle doit être.
 *
 * La valeur **inchangée** passe sans bruit : c'est le cas de tous les enregistrements ordinaires,
 * la liste étant pré-remplie sur la période courante. Seul un vrai changement est refusé, et il est
 * nommé. (L'écran de modification gagnerait à afficher la période en texte plutôt qu'en liste
 * déroulante — le formulaire est partagé avec la création, où le choix est légitime.)
 */
export async function modifierSeance(sessionId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("sessions.manage");
  const parsed = lireSeance(fd);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { periodId, ...data } = parsed.data;
  // Une seule lecture pour les deux règles : le trimestre de la séance (qui ne change pas) et son
  // statut (un trimestre clos ne se retouche plus — voir `seancePourEcriture`).
  const ouverte = await seancePourEcriture(sessionId);
  if (ouverte.erreur) return { erreur: ouverte.erreur };
  if (periodId !== ouverte.seance.periodId) {
    return {
      erreur: "Une séance ne change pas de trimestre : ses réponses appartiennent aux invités de sa période. Crée-la dans l'autre trimestre et retire celle-ci.",
      erreurs: { periodId: "Trimestre non modifiable ici." },
    };
  }
  // Instructeurs et thèmes se règlent dans le planning (cases de la séance)
  await db.session.update({ where: { id: sessionId }, data });
  await audit(user, "seance.modifiee", sessionId, data);
  rafraichir(sessionId);
  return { succes: "Séance enregistrée." };
}

/**
 * Autosave du thème détaillé (appelé à la perte de focus).
 *
 * **L'alternative ne se saisit plus** : les options et cours ajoutés au planning de la séance disent
 * mieux « ce qu'on fait si… ». La colonne reste en base, sans éditeur ni écriture : la retirer
 * demanderait une migration et toucherait l'API publique, le partage et les notifications.
 */
export async function enregistrerTheme(input: { sessionId: string; theme: string }): Promise<FormState> {
  const user = await assertPermission("sessions.manage");
  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { sessionId, ...data } = parsed.data;
  // L'autosave écrit sans que personne appuie sur rien : c'est le chemin le plus discret vers la
  // base, donc celui qui a le plus besoin du verrou (la perte de focus suffit).
  const ouverte = await seancePourEcriture(sessionId);
  if (ouverte.erreur) return { erreur: ouverte.erreur };
  await db.session.update({ where: { id: sessionId }, data });
  await audit(user, "seance.theme", sessionId, data);
  rafraichir(sessionId);
  return { succes: "Enregistré" };
}

export async function annulerSeance(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("sessions.manage");
  const parsed = annulationSchema.safeParse({ sessionId: champ(fd, "sessionId"), motif: champ(fd, "motif") });
  if (!parsed.success) return zodToFormState(parsed.error);
  // **Le verrou le plus important de la série** : annuler *envoie* — email à tous les invités,
  // annonce sur le salon Discord et sur Telegram. Le faire sur un trimestre clos, c'est réveiller
  // tout le club à propos d'un cours que plus personne n'attend.
  const ouverte = await seancePourEcriture(parsed.data.sessionId);
  if (ouverte.erreur) return { erreur: ouverte.erreur };
  /*
   * **Une séance déjà annulée ne se réannonce pas**.
   *
   * Ce chemin écrivait sans condition, puis appelait `notifierAnnulation`, dont les cinq clés de
   * déduplication portent l'horodatage `updatedAt` de la séance. Or `updatedAt` est un `@updatedAt` :
   * **toute** écriture le change. Les clés ne protégeaient donc que la simultanéité parfaite — deux
   * requêtes assez proches pour qu'aucune n'ait encore relu la ligne.
   *
   * Le scénario, et il n'a rien d'improbable : la salle est inondée, deux instructeurs se sont écrit
   * « annule ce soir ». Alix annule avec le motif « Salle inondée » : quarante-deux emails, un message
   * Discord, un Telegram, neuf notifications. Trente secondes plus tard Camille, dont l'onglet affiche
   * encore le bouton, annule avec « Fuite d'eau » : `updatedAt` a changé, les cinq clés sont neuves, et
   * tout repart — **avec un autre motif**. Les deux salons portent deux annonces contradictoires et le
   * club croit à deux cours annulés.
   *
   * L'asymétrie était visible dans le dossier : `annulerDepuisEmail`, juste en dessous, porte déjà la
   * garde `if (!seance.annulee)`. Le geste depuis l'écran ne l'avait pas.
   *
   * **Corriger le motif reste possible, et n'annonce rien.** C'est la règle du dossier pour toute
   * écriture qui n'est pas une première annonce : elle synchronise, elle ne réveille personne. Le
   * message de retour dit laquelle des deux choses vient de se passer.
   */
  if (ouverte.seance.annulee) {
    if ((ouverte.seance.motifAnnulation ?? "") === parsed.data.motif) {
      return { succes: "Cette séance était déjà annulée, avec ce motif : rien à changer." };
    }
    await db.session.update({ where: { id: parsed.data.sessionId }, data: { motifAnnulation: parsed.data.motif } });
    await audit(user, "seance.annulation_motif", parsed.data.sessionId, { motif: parsed.data.motif, avant: ouverte.seance.motifAnnulation });
    rafraichir(parsed.data.sessionId);
    return { succes: "Motif d'annulation corrigé. Personne n'est prévenu à nouveau : l'annonce est déjà partie." };
  }
  // Après la correction du motif, qui n'annonce rien : seule la **première** annonce est refusée sur un
  // cours commencé.
  if (!seanceAnnulable({ annulee: false, passee: commencee(ouverte.seance) })) return { erreur: REFUS_COMMENCEE.annuler };
  await db.session.update({ where: { id: parsed.data.sessionId }, data: { annulee: true, motifAnnulation: parsed.data.motif } });
  await audit(user, "seance.annulee", parsed.data.sessionId, { motif: parsed.data.motif });
  const prevenus = await notifierAnnulation(parsed.data.sessionId);
  rafraichir(parsed.data.sessionId);
  // La phrase dépend du mode d'envoi : « 12 membres prévenus » ou « annonce envoyée sur la liste ».
  return { succes: `Séance annulée — ${await phraseAnnulation(prevenus)}.` };
}

/**
 * Annulation depuis l'email « peu de monde » : le lien signé remplace l'authentification, il est
 * donc vérifié comme le serait une session.
 *
 * Trois gardes, parce qu'un lien qui dort dans une boîte mail n'est pas une preuve d'identité :
 * le jeton est **nominatif** (`porteurJetonAnnulation` : compte actif, toujours habilité à annuler
 * une séance), le porteur est **journalisé** comme acteur — on savait qu'une annulation était
 * partie par email, on ne savait pas de qui —, et un **limiteur** borne le geste, qui prévient
 * tous les invités par email et annonce l'annulation sur le salon.
 *
 * Il n'est pas non plus rejouable sur une séance déjà annulée : on ressort l'écran « c'est fait »
 * sans réécrire ni renvoyer quoi que ce soit.
 */
export async function annulerDepuisEmail(token: string, fd: FormData): Promise<void> {
  const porteur = await porteurJetonAnnulation(token);
  if (!porteur) redirect("/connexion?erreur=session");
  if (!(await checkRateLimit("annulation_porteur", porteur.acteur.id))) redirect(`/annuler/${token}?erreur=trop`);
  const { sessionId, acteur } = porteur;
  const parsed = annulationSchema.safeParse({ sessionId, motif: champ(fd, "motif") || "Trop peu de participants" });
  if (!parsed.success) redirect(`/annuler/${token}`);
  const seance = await db.session.findUnique({ where: { id: sessionId }, select: { annulee: true, date: true, annulationLienUtiliseLe: true } });
  if (!seance) redirect("/connexion?erreur=session");
  // Le lien est à usage unique : une fois qu'il a servi, il ne resservira pas — même si la séance a
  // été rétablie entre-temps, auquel cas c'est `retablirSeance` qui rouvre le droit en effaçant la
  // date. Sans cela, un lien resté dans une boîte mail pouvait réannuler un cours qu'on venait de
  // remettre, et le vieil email valait alors plus longtemps que la décision qu'il portait.
  if (seance.annulationLienUtiliseLe) redirect(`/annuler/${token}?erreur=deja`);
  if (!seance.annulee) {
    await db.session.update({ where: { id: sessionId }, data: { annulee: true, motifAnnulation: parsed.data.motif, annulationLienUtiliseLe: new Date() } });
    await audit(acteur, "seance.annulee", sessionId, { motif: parsed.data.motif, via: "email" });
    await notifierAnnulation(sessionId);
    rafraichir(sessionId);
  }
  redirect(`/annuler/${token}?fait=ok`);
}

export async function retablirSeance(sessionId: string): Promise<void> {
  const user = await assertPermission("sessions.manage");
  // Le même verrou que l'annulation, et dans le même sens : un trimestre clos est de l'histoire, on ne
  // rend pas ses cours debout à rebours. Si une séance a été annulée par erreur juste avant la
  // clôture, c'est la période qu'on rouvre (« Rouvrir la période », `/admin/periodes/[id]`) — un geste
  // du bureau, tracé, plutôt qu'une réécriture discrète depuis la fiche d'une séance.
  const ouverte = await seancePourEcriture(sessionId);
  if (ouverte.erreur) throw new Error(ouverte.erreur);
  // Une séance déjà debout n'a rien à rétablir : la garde ne regarde que le cours commencé, comme
  // l'écran — rétablir une séance non annulée ne change rien d'autre que son `updatedAt`.
  if (ouverte.seance.annulee && !seanceRetablissable({ annulee: true, passee: commencee(ouverte.seance) })) throw new Error(REFUS_COMMENCEE.retablir);
  // Rétablir rouvre le droit d'annuler par lien : la décision est prise en conscience, dans
  // l'application, par quelqu'un qui a le droit d'annuler lui-même (voir `annulerDepuisEmail`).
  await db.session.update({ where: { id: sessionId }, data: { annulee: false, motifAnnulation: null, annulationLienUtiliseLe: null } });
  await audit(user, "seance.retablie", sessionId);
  rafraichir(sessionId);
}

/**
 * **Effacer une séance détache ses ateliers, et remet en attente ceux qui y étaient planifiés.**
 *
 * La base fait la moitié du travail : `Atelier.session` est en `onDelete: SetNull`, la proposition
 * survit à la séance. Mais elle ne touche pas au **statut** — un atelier restait donc `PLANIFIE`
 * sans aucune date, c'est-à-dire planifié nulle part : invisible dans la file des propositions à
 * trancher, et introuvable dans le planning. La règle est écrite et appliquée depuis
 * `supprimerPeriode` (src/actions/periodes.ts) ; elle vaut ici pour la même raison, et elle est
 * écrite pareil — d'abord les planifiés, puis le détachement explicite des autres, sans compter sur
 * le `SetNull` de la base.
 *
 * Le tout dans **une transaction** : une séance effacée sans son ménage laisserait l'orphelin qu'on
 * vient d'éviter. La date est relue avant, parce qu'un `delete` en transaction ne rend pas sa ligne
 * à l'appelant, et c'est elle qui part dans l'audit.
 *
 * **Le geste appartient au bureau, avec élévation**. Il demandait `sessions.manage` — donc ADMIN
 * *et* INSTRUCTEUR, sans élévation — alors qu'il efface la séance **et toutes les réponses des
 * membres** en cascade. Or son geste jumeau, `supprimerSeancesPeriode` (src/actions/periodes.ts),
 * exige `periods.manage` et pour cette raison même : « le geste efface les réponses des membres
 * pour ces dates […] il est donc réservé au bureau ». Deux portes vers la même destruction, deux
 * serrures différentes : un instructeur vidait un trimestre entier séance par séance, depuis un
 * bouton qu'on lui affichait, quand la même chose en un clic depuis l'écran de la période lui était
 * refusée. La serrure est désormais la même — et `exigerReauth`, comme sur `supprimerPeriode`,
 * parce qu'un code redonné coûte dix secondes là où les réponses effacées ne se reconstituent pas.
 *
 * Le **nombre de réponses perdues** part dans le journal, comme chez les deux jumeaux : après coup,
 * c'est la seule trace de ce qui a disparu.
 */
export async function supprimerSeance(sessionId: string): Promise<void> {
  const user = await assertPermission("periods.manage");
  const ouverte = await seancePourEcriture(sessionId);
  // Action sans `FormState` (un bouton, pas un formulaire) : on lève, comme `supprimerPeriode` le
  // fait pour une période encore active. `BoutonAction` affiche le message tel quel.
  if (ouverte.erreur) throw new Error(ouverte.erreur);
  const s = ouverte.seance;
  await exigerReauth(user, `/seances/${sessionId}`);
  const reponses = await db.attendance.count({ where: { sessionId } });
  await db.$transaction([...detacherAteliers(sessionId), db.session.delete({ where: { id: sessionId } })]);
  await audit(user, "seance.supprimee", sessionId, { date: s.date, reponses });
  rafraichir();
  redirect("/seances");
}

/* ------------------------------------------------------------------ */
/* Plusieurs séances à la fois                                         */
/* ------------------------------------------------------------------ */

export type ResultatSeancesEnMasse = { succes?: string; erreur?: string };

/** « 1 séance », « 3 séances » — et l'accord qui suit (« annulée », « annulées »). */
const seances = (n: number) => `${n} séance${n > 1 ? "s" : ""}`;
const accord = (n: number) => (n > 1 ? "s" : "");

/**
 * **L'action journalisée est celle du geste unitaire** (`CLAUDE.md` : « un seul filtre du journal doit
 * tout retrouver »). Un `seances.annulees_en_masse` obligerait à connaître deux noms d'action pour
 * répondre à « qui a annulé le cours du 6 octobre ? ». Le lieu et l'horaire sont des morceaux de ce
 * que `modifierSeance` écrit : ils en gardent l'action.
 */
const ACTION_AUDIT = {
  annuler: "seance.annulee",
  retablir: "seance.retablie",
  lieu: "seance.modifiee",
  horaire: "seance.modifiee",
  supprimer: "seance.supprimee",
} as const;

/**
 * **Annuler, rétablir, déplacer, changer l'horaire ou effacer plusieurs séances d'un coup**, depuis l'onglet
 * Séances en mode modification (`SelectionSeances`).
 *
 * Une seule fonction pour les cinq, comme `appliquerGesteEnMasse` pour l'annuaire : leurs verrous sont
 * les mêmes à une permission près, et les écrire cinq fois serait cinq occasions d'en oublier un.
 *
 * **Les verrous sont exactement ceux du geste unitaire, par appel des mêmes fonctions** — pas par
 * recopie :
 *
 * - `sessions.manage` en plancher, avant de lire l'entrée (celui d'`annulerSeance`, `retablirSeance`,
 *   `modifierSeance`) ; pour **supprimer**, `periods.manage` **et** `exigerReauth`, ceux de
 *   `supprimerSeance` — effacer un lot de séances efface les réponses des membres, c'est le geste du
 *   bureau, avec un code récent, aux trois portes du dépôt qui le font déjà ;
 * - `seancePourEcriture` **séance par séance** : une séance d'un trimestre clos refuse le lot ;
 * - `seanceAnnulable` / `seanceRetablissable` : un cours commencé ne s'annule ni ne se rétablit.
 *
 * **Tout ou rien.** Une seule séance refusée (trimestre clos, cours commencé, séance disparue depuis
 * l'affichage) refuse le lot entier, et la nomme : ce sont les signes d'un écran périmé ou d'un appel
 * forgé, et pour un geste qui prévient tout le club ou qui efface des réponses, un écran en retard sur
 * la base n'est pas une base de décision. Ce qui porte **déjà** la valeur visée (une séance déjà
 * annulée, déjà à ce lieu) n'est pas un refus : elle est comptée à part, ni réécrite ni journalisée —
 * et surtout **pas réannoncée** (voir `annulerSeance`, « une séance déjà annulée ne se réannonce pas »).
 *
 * **Une écriture groupée, dans une transaction, puis une entrée de journal par séance** réellement
 * modifiée, sous la même action que l'unitaire, après le commit et hors transaction (`audit` ne lève
 * pas, et une annulation ne doit pas tomber parce que sa trace a échoué). `enMasse: true` dit d'où
 * venait le geste.
 *
 * **Les notifications : celles du geste unitaire, et pas une de plus.** Rétablir, déplacer,
 * changer l'horaire et effacer n'envoient rien à l'unité — rien ne part ici non plus. **Annuler**, si : chaque
 * séance annulée prévient ses invités et les salons du club, exactement comme une annulation faite
 * séance par séance (`notifierAnnulation`, avec sa déduplication). Ce n'est pas la notification d'une
 * écriture multipliée par la taille du lot — l'annonce **est** le geste demandé, comme « Renvoyer le
 * lien » en masse à l'annuaire ; l'écran le dit donc avant, et sa confirmation annonce **combien
 * d'annonces partent** (une par séance annulée, pas une par case cochée : une séance déjà annulée du
 * lot n'en refait pas partir).
 */
export async function appliquerGesteSeancesEnMasse(entree: unknown): Promise<ResultatSeancesEnMasse> {
  const acteur = await assertPermission("sessions.manage");
  const lu = seancesEnMasseSchema.safeParse(entree);
  if (!lu.success) {
    // Le seul refus de forme qu'un écran honnête peut produire est l'horaire à l'envers : on le dit.
    // Le reste vient d'un appel forgé, et n'a pas besoin de détail.
    const fin = lu.error.issues.find((i) => i.path[0] === "heureFin");
    return { erreur: fin ? fin.message : "Sélection invalide : coche des séances, puis choisis le geste." };
  }
  const demande = lu.data;
  const geste = demande.geste;
  // Effacer des réponses de membres appartient au bureau : la serrure de `supprimerSeance`.
  if (geste === "supprimer") await assertPermission("periods.manage");

  /*
   * **La garde de la séance seule, appelée pour chaque séance du lot** — la même fonction, donc le
   * même refus (trimestre clos) dans les mêmes mots. Puis la règle du cours commencé, pour les deux
   * gestes qu'elle concerne.
   */
  const lues: Array<NonNullable<Awaited<ReturnType<typeof seancePourEcriture>>["seance"]>> = [];
  const refus: string[] = [];
  let introuvables = 0;
  for (const id of demande.sessionIds) {
    const ouverte = await seancePourEcriture(id);
    if (ouverte.erreur) {
      if (ouverte.erreur === SEANCE_INTROUVABLE) introuvables += 1;
      else refus.push(ouverte.erreur);
      continue;
    }
    const s = ouverte.seance;
    const passee = commencee(s);
    if (geste === "annuler" && !s.annulee && !seanceAnnulable({ annulee: false, passee })) refus.push(`${formatDateSansAnnee(s.date)} : ${REFUS_COMMENCEE.annuler}`);
    else if (geste === "retablir" && s.annulee && !seanceRetablissable({ annulee: true, passee })) refus.push(`${formatDateSansAnnee(s.date)} : ${REFUS_COMMENCEE.retablir}`);
    lues.push(s);
  }
  if (refus.length > 0 || introuvables > 0) {
    const phrases = ["Rien n'a été écrit : le lot entier est refusé."];
    // Le refus du trimestre clos est le même pour chaque séance : il se dit une fois.
    phrases.push(...new Set(refus));
    if (introuvables > 0) {
      phrases.push(
        introuvables === 1
          ? "1 séance de la sélection est introuvable : elle a été effacée depuis l'affichage de la liste. Recharge l'écran."
          : `${introuvables} séances de la sélection sont introuvables : elles ont été effacées depuis l'affichage de la liste. Recharge l'écran.`,
      );
    }
    return { erreur: phrases.join(" ") };
  }

  // L'ordre du journal et des annonces est celui du calendrier, jamais celui des clics.
  lues.sort((a, b) => (a.date === b.date ? a.heureDebut.localeCompare(b.heureDebut) : a.date.localeCompare(b.date)));

  /*
   * **Seules les séances qui changent vraiment sont écrites, et journalisées** : `updatedAt` est un
   * `@updatedAt`, et les clés de déduplication des annonces d'annulation le portent. Une suppression
   * n'a pas de « déjà fait ».
   */
  const aEcrire = lues.filter((s) => {
    if (geste === "annuler") return !s.annulee;
    if (geste === "retablir") return s.annulee;
    if (geste === "lieu") return s.lieu !== demande.lieu || s.adresse !== demande.adresse;
    if (geste === "horaire") return s.heureDebut !== demande.heureDebut || s.heureFin !== demande.heureFin;
    return true;
  });
  const dejas = lues.length - aEcrire.length;
  if (aEcrire.length === 0) {
    // Rien à écrire : rien ne part, et inutile de redemander un code pour un enregistrement à blanc.
    const deja = { annuler: "déjà annulée", retablir: "déjà prévue", lieu: "déjà à ce lieu", horaire: "déjà à cet horaire", supprimer: "" }[geste];
    return { succes: `Aucun changement : la sélection était ${deja}${lues.length > 1 ? " pour chaque séance" : ""}.` };
  }
  const ids = aEcrire.map((s) => s.id);

  if (demande.geste === "supprimer") {
    // Le code récent est redemandé **avant** d'effacer : après, il n'y aurait plus rien à protéger.
    await exigerReauth(acteur, "/seances?modifier=1");
    // Le décompte des réponses perdues, séance par séance : c'est la seule trace qui restera.
    const reponses = new Map<string, number>();
    for (const id of ids) reponses.set(id, await db.attendance.count({ where: { sessionId: id } }));
    await db.$transaction([...detacherAteliers({ in: ids }), db.session.deleteMany({ where: { id: { in: ids } } })]);
    for (const s of aEcrire) await audit(acteur, ACTION_AUDIT.supprimer, s.id, { date: s.date, reponses: reponses.get(s.id) ?? 0, enMasse: true });
    rafraichir();
    const perdues = [...reponses.values()].reduce((a, b) => a + b, 0);
    return { succes: `${seances(ids.length)} supprimée${accord(ids.length)} définitivement, avec ${perdues} réponse${accord(perdues)} de membres.` };
  }

  if (demande.geste === "annuler") {
    await db.$transaction([db.session.updateMany({ where: { id: { in: ids } }, data: { annulee: true, motifAnnulation: demande.motif } })]);
    for (const s of aEcrire) await audit(acteur, ACTION_AUDIT.annuler, s.id, { motif: demande.motif, enMasse: true });
    // Une annonce par séance, après le commit : celle que le geste unitaire envoie, avec sa
    // déduplication. En série, comme les envois du dépôt — la file d'emails fait le reste.
    let messages = 0;
    for (const s of aEcrire) messages += await notifierAnnulation(s.id);
    rafraichir();
    const phrases = [`${seances(ids.length)} annulée${accord(ids.length)} : ${ids.length} annonce${accord(ids.length)} d'annulation (${messages} email${accord(messages)}, et les salons du club selon leurs réglages).`];
    if (dejas > 0) phrases.push(`${seances(dejas)} ${dejas > 1 ? "étaient" : "était"} déjà annulée${accord(dejas)} : personne n'est prévenu à nouveau.`);
    return { succes: phrases.join(" ") };
  }

  if (demande.geste === "retablir") {
    // Comme `retablirSeance` : rétablir rouvre aussi le droit d'annuler par lien.
    await db.$transaction([db.session.updateMany({ where: { id: { in: ids } }, data: { annulee: false, motifAnnulation: null, annulationLienUtiliseLe: null } })]);
    for (const s of aEcrire) await audit(acteur, ACTION_AUDIT.retablir, s.id, { enMasse: true });
    rafraichir();
    const phrases = [`${seances(ids.length)} rétablie${accord(ids.length)}.`];
    if (dejas > 0) phrases.push(`${seances(dejas)} n'${dejas > 1 ? "étaient" : "était"} pas annulée${accord(dejas)}.`);
    return { succes: phrases.join(" ") };
  }

  // Lieu ou horaire : deux morceaux de ce que `modifierSeance` écrit, journalisés sous son action.
  const data = demande.geste === "lieu" ? { lieu: demande.lieu, adresse: demande.adresse } : { heureDebut: demande.heureDebut, heureFin: demande.heureFin };
  await db.$transaction([db.session.updateMany({ where: { id: { in: ids } }, data })]);
  for (const s of aEcrire) await audit(acteur, ACTION_AUDIT[demande.geste], s.id, { ...data, enMasse: true });
  rafraichir();
  const phrases = [
    demande.geste === "lieu"
      ? `${seances(ids.length)} déplacée${accord(ids.length)} à « ${demande.lieu} ».`
      : `${seances(ids.length)} passée${accord(ids.length)} de ${demande.heureDebut} à ${demande.heureFin}.`,
  ];
  if (dejas > 0) phrases.push(`${seances(dejas)} y ${dejas > 1 ? "étaient" : "était"} déjà.`);
  phrases.push("Personne n'est prévenu : c'est la règle de la séance modifiée seule.");
  return { succes: phrases.join(" ") };
}

/**
 * **La réponse venue d'un email de rappel s'écrit sur un appui, jamais à l'ouverture du lien.**
 *
 * Les boutons « Je viens » / « Je ne viens plus » du récap de la veille mènent à
 * `/seances?seance=<id>&reponse=present|absent`. Cette page **écrivait la réponse pendant son rendu**,
 * c'est-à-dire sur un simple GET : le troisième cas de cette famille dans le dépôt, après l'ouverture
 * d'invitation et la désinscription, et le même argument s'applique mot pour mot (CLAUDE.md, « la page
 * du lien garde son bouton ») — « un GET ne consomme rien ; c'est l'appui qui pose la session. Sans ce
 * découpage, les messageries qui préchargent les liens (Safe Links, antivirus) “ouvriraient” chaque
 * lien ». Ici la conséquence est pire qu'un lien consommé : l'antivirus de messagerie **répondait à la
 * place du membre**, et le club comptait comme présent quelqu'un qui n'avait ouvert aucun email. Le
 * taux de présence sert ensuite aux bilans du club.
 *
 * Le lien mène donc à un écran qui **montre** ce qui va être enregistré (voir `/seances`) et attend un
 * appui, qui arrive ici. **Le parcours reste à deux taps depuis l'email** — le lien, puis le bouton —,
 * comme l'exige CLAUDE.md (« pas plus de 2 taps pour indiquer sa présence depuis l'ouverture ») ; le
 * lien de l'email n'a pas eu besoin de changer de forme, seul ce qu'on fait de ses paramètres a changé.
 *
 * `requireUser` plutôt que rien : la session peut être tombée entre l'écran et l'appui (le récap part la
 * veille au soir, on répond le lendemain matin). On repart alors sur la connexion **avec la même
 * adresse**, paramètres compris — le middleware la garde dans le cookie de suite —, et l'écran de
 * confirmation revient de lui-même après l'entrée : la réponse n'est pas perdue en route, elle attend
 * son appui.
 *
 * L'autorité, elle, reste `indiquerPresence` : c'est elle qui vérifie que c'est bien sa séance, sa
 * période active, un cours non annulé et pas encore commencé. On ne recopie aucun de ces contrôles ici.
 */
export async function repondreDepuisLien(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  // La séance et la réponse voyagent en champs cachés, comme le `sessionId` de `annulerSeance` : ce
  // sont les choix de la personne sur **sa propre** présence, et c'est `indiquerPresence` qui valide
  // l'énuméré et n'écrit jamais que pour le compte connecté. Rien à gagner à les signer.
  const sessionId = champ(fd, "sessionId");
  const statut = champ(fd, "statut");
  const res = await indiquerPresence({ sessionId, statut });
  if (!res.ok) return { erreur: res.erreur };
  // URL nettoyée : plus aucun paramètre d'action, un rafraîchissement ou un retour arrière ne
  // rejoue rien — et `note`/`s` ne font qu'afficher la confirmation, relue en base.
  redirect(`/seances?note=${res.statut === "PRESENT" ? "present" : "absent"}&s=${encodeURIComponent(sessionId)}`);
}
