"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPermission, exigerReauth, requireUser } from "@/lib/auth/current-user";
import { indiquerPresence } from "@/actions/presences";
import { champ, zodToFormState, type FormState } from "@/lib/form";
import { ecritureFermee, REFUS_PERIODE_CLOSE } from "@/lib/constants";
import { annulationSchema, seanceSchema, themeSchema } from "@/lib/validation/gestion";
import { notifierAnnulation, phraseAnnulation, porteurJetonAnnulation } from "@/lib/notifications/seances";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { partiesInitiales } from "@/lib/planning";

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

async function seancePourEcriture(sessionId: string) {
  const seance = await db.session.findUnique({
    where: { id: sessionId },
    // `annulee` et `motifAnnulation` : `annulerSeance` doit savoir si le cours l'est **déjà**, pour ne
    // pas réannoncer (voir son commentaire).
    select: { id: true, periodId: true, date: true, annulee: true, motifAnnulation: true, period: { select: { statut: true } } },
  });
  if (!seance) return { erreur: "Séance introuvable." } as const;
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

function lireSeance(fd: FormData) {
  return seanceSchema.safeParse({
    periodId: champ(fd, "periodId"),
    date: champ(fd, "date"),
    heureDebut: champ(fd, "heureDebut"),
    heureFin: champ(fd, "heureFin"),
    lieu: champ(fd, "lieu"),
    adresse: champ(fd, "adresse"),
    theme: champ(fd, "theme"),
    alternative: champ(fd, "alternative"),
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

/** Autosave du thème et de l'alternative (appelé à la perte de focus). */
export async function enregistrerTheme(input: { sessionId: string; theme: string; alternative: string }): Promise<FormState> {
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
  await db.$transaction([
    db.atelier.updateMany({ where: { sessionId, statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } }),
    db.atelier.updateMany({ where: { sessionId }, data: { sessionId: null } }),
    db.session.delete({ where: { id: sessionId } }),
  ]);
  await audit(user, "seance.supprimee", sessionId, { date: s.date, reponses });
  rafraichir();
  redirect("/seances");
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
