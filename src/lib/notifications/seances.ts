import { filtrerAccesActif } from "@/lib/acces-actif";
import { db } from "@/lib/db";
import { formatDateCourte, formatHeure, seanceCommencee, todayIso } from "@/lib/dates";
import { baseUrl, env } from "@/lib/env";
import { identite } from "@/lib/identite";
import { signPayload, verifySignedPayload } from "@/lib/auth/tokens";
import { enqueueEmail } from "@/lib/email/mailer";
import { enqueueEmailListe, messageCollectif } from "@/lib/email/liste";
import { emailEffectifFaible, emailSeanceAnnulee, emailSeanceAnnuleeListe, type SeanceEmail } from "@/lib/email/templates/seances";
import { can, personnesDuClub } from "@/lib/permissions";
import { aUnEmail } from "@/lib/membres";
import { envoiPossible } from "./canaux";
import { journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import type { ChargePush } from "./push";
import { adresseListePour, destinataireRetenu, envoiCollectifDans, getPreferencesNotifications } from "./preferences";
import { embedAnnulation, embedEffectifFaible, type SeanceResume } from "./contenu";
import { dansHorizonAlerteEffectif, derniereDateAlerteEffectif, empreinteCreneau, HORIZON_ALERTE_EFFECTIF } from "./planification";
import { publierSurSalon, publierSurTelegram } from "./salon";

/**
 * Notifications liées aux séances :
 * - **effectif faible** : si une séance des trois prochains jours est jugée « en danger » par
 *   `palierEffectif` (`src/lib/presences.ts`) — l'effectif **attendu**, présents plus la moitié des
 *   « peut-être », sous la part de l'effectif invité réglée par le club (`Identite.partEffectifMin`,
 *   20 % à l'installation, jamais moins de quatre personnes) —, les instructeurs reçoivent une
 *   alerte avec un lien d'annulation en un geste (page de confirmation) ;
 * - **annulation** : tous les invités sont prévenus, avec la date et le motif.
 * Les deux partent sur **email**, sur le **téléphone** (Web Push) et sur le **salon Discord**
 * (embed), chacun avec sa propre clé : `annulation_<id>_<horodatage>` /
 * `annulation_push_<id>_<horodatage>_<userId>` / `annulation_discord_<id>_<horodatage>`, et
 * `effectif_<id>_<créneau>` / `effectif_push_<id>_<créneau>_<userId>` / `effectif_discord_<id>_<créneau>`.
 * Chaque envoi est
 * journalisé dans NotificationLog (dedupKey) : une alerte par séance, une annonce par annulation,
 * jamais deux fois.
 *
 * Le push est journalisé **par personne** là où l'email n'écrit qu'une ligne pour tout l'envoi :
 * c'est ce qui permet de reprendre proprement si quelqu'un abonne un appareil entre deux passages,
 * et c'est sans risque puisque la clé porte déjà l'horodatage de l'annulation.
 *
 * Tout passe d'abord par `envoiPossible(type, canal)` (réglages de Gestion → Réglages → Notifications
 * **et** état réel du canal) : canal coupé, case décochée ou salon non branché, rien ne part et rien
 * n'est journalisé. Puis, pour chaque personne, par `destinataireRetenu` — qui retranche ce qu'elle a
 * refusé dans son profil. Un échec Discord n'empêche jamais les emails ni l'annulation elle-même
 * (`publierSurSalon` ne lève pas).
 */
import { PART_EFFECTIF_LIVREE } from "../constants";
import { sousLeSeuil } from "@/lib/presences";

/**
 * Ré-exportés ici par commodité : c'est le module de l'alerte « peu de monde ».
 *
 * `PART_EFFECTIF_LIVREE` n'est que la valeur de départ : la part qui décide vraiment de l'alerte est
 * celle **réglée par le club** (`Identite.partEffectifMin`), lue à chaque passage dans
 * {@link alerterEffectifFaible} — et le nombre de personnes qui en découle dépend de l'effectif
 * invité de la période de chaque séance.
 */
export { PART_EFFECTIF_LIVREE, HORIZON_ALERTE_EFFECTIF };
/** Le lien d'annulation d'un email reste valable une semaine. */
export const DUREE_LIEN_ANNULATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Le lien d'annulation est **nominatif** : le jeton porte la séance *et* le compte du destinataire.
 *
 * Il ne l'était pas, et c'était une capacité bien trop large pour un lien qui traîne dans une boîte
 * mail : n'importe qui ayant accès au message annulait le cours, faisait partir un email à tous les
 * invités et une annonce sur le salon, sans qu'on puisse jamais dire qui. En le signant avec
 * l'identifiant du destinataire, le porteur est connu (il est journalisé) et vérifiable à l'usage —
 * compte actif, toujours habilité à annuler une séance.
 *
 * Conséquence assumée : les liens émis **avant** ce changement ne portent pas de compte et ne sont
 * plus acceptés. Ils valaient une semaine ; les emails suivants portent la nouvelle forme.
 */
export function urlAnnulation(sessionId: string, userId: string): string {
  const jeton = signPayload({ sid: sessionId, uid: userId, exp: Date.now() + DUREE_LIEN_ANNULATION_MS }, env().SESSION_SECRET, "annulation-seance");
  return `${baseUrl()}/annuler/${jeton}`;
}

/** Vérifie un lien d'annulation : retourne la séance et le compte destinataire, ou null. */
export function lireJetonAnnulation(jeton: string): { sessionId: string; userId: string } | null {
  const p = verifySignedPayload<{ sid: string; uid: string; exp: number }>(jeton, env().SESSION_SECRET, "annulation-seance");
  if (!p || typeof p.sid !== "string" || typeof p.uid !== "string" || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return { sessionId: p.sid, userId: p.uid };
}

/**
 * Le porteur d'un lien d'annulation, tel qu'il est au moment du clic — c'est lui qui remplace
 * l'authentification, donc on le revérifie comme on vérifierait une session : le compte doit
 * exister, être **actif** et avoir encore `sessions.manage`. Quelqu'un qui a quitté l'encadrement
 * (ou dont le compte est désactivé) n'annule plus un cours depuis un vieil email.
 *
 * **Et le trimestre doit être encore ouvert**. Le lien vaut une semaine, l'alerte part à J-3, et
 * une période close **peut** porter des séances à venir — on clôt un trimestre sans attendre son
 * dernier cours. Un vieil email pouvait donc annuler un cours d'un trimestre terminé, ce qui
 * déclenche un email à tous ses invités, une annonce sur le salon Discord et sur Telegram. Le refus
 * est posé **ici**, et non dans la seule action, pour que l'écran de confirmation
 * (`/annuler/[token]`) ne propose pas un bouton qui refuserait : les deux passent par cette
 * fonction. C'est la même doctrine que la clôture d'une période, qui rend ses liens personnels
 * caducs (`src/actions/periodes.ts` : « Période close : les liens ne sont plus valables »).
 */
export async function porteurJetonAnnulation(jeton: string): Promise<{ sessionId: string; acteur: { id: string; email: string | null } } | null> {
  const lu = lireJetonAnnulation(jeton);
  if (!lu) return null;
  const [user, seance] = await Promise.all([
    // `estAdmin` autant que `role` : cet objet-ci finit dans `can()`, et le bureau s'y lit sur
    // `estAdmin`. Sans la colonne, elle vaut `undefined` — donc « pas du bureau » — et le lien «
    // Annuler le cours » d'un email aurait cessé de fonctionner pour un administrateur qui n'est
    // pas aussi instructeur, en répondant « lien invalide » à une clé parfaitement valable.
    db.user.findUnique({ where: { id: lu.userId }, select: { id: true, email: true, role: true, estAdmin: true, actif: true } }),
    db.session.findUnique({ where: { id: lu.sessionId }, select: { date: true, heureDebut: true, period: { select: { statut: true } } } }),
  ]);
  if (!user || !can(user, "sessions.manage")) return null;
  if (!seance || seance.period.statut === "CLOSE") return null;
  /*
   * **Un cours commencé ne s'annule plus, même par ce lien**.
   *
   * Le lien vaut une semaine (`DUREE_LIEN_ANNULATION_MS`) et ne vérifiait que le statut de la période.
   * L'interface, elle, sait déjà que ça ne se fait pas : `gestesSeance` ne propose pas « Annuler » sur une
   * séance passée, « on ne prévient pas les gens d'une annulation pendant qu'ils sont dans la salle ».
   * Le chemin par email ne connaissait pas la règle — un clic le mardi annulait le stage de samedi et
   * envoyait « ❌ Cours annulé — samedi 3 octobre » à tous les invités.
   *
   * On lit `seanceCommencee`, la même fonction que l'écran, plutôt que de comparer des dates ici.
   */
  if (seanceCommencee(seance.date, seance.heureDebut)) return null;
  return { sessionId: lu.sessionId, acteur: { id: user.id, email: user.email } };
}

function versSeanceEmail(s: { date: string; heureDebut: string; heureFin: string; lieu: string }): SeanceEmail {
  return { date: s.date, heureDebut: s.heureDebut, heureFin: s.heureFin, lieu: s.lieu };
}

/** Même séance, vue par le contenu commun (embeds Discord, textes partagés). */
function versSeanceResume(s: { date: string; heureDebut: string; heureFin: string; lieu: string; theme?: string | null; alternative?: string | null; disciplines?: string | null }): SeanceResume {
  return { date: s.date, heureDebut: s.heureDebut, heureFin: s.heureFin, lieu: s.lieu, theme: s.theme, alternative: s.alternative, disciplines: s.disciplines };
}

/**
 * Ce qu'il faut de chaque personne pour décider si le message lui part : l'adresse, le compte actif,
 * et ses choix personnels de notifications (voir `destinataireRetenu`).
 */
const CHAMPS_DESTINATAIRE = { id: true, prenom: true, email: true, actif: true, rappelEmail: true, preferencesNotifications: true, service: true } as const;

/** Une notification par clé : on ne renvoie jamais deux fois la même alerte. */
async function dejaEnvoye(dedupKey: string): Promise<boolean> {
  return (await db.notificationLog.findUnique({ where: { dedupKey } })) !== null;
}

/**
 * Alerte « peu de monde » sur les séances des trois prochains jours (chacune est évaluée séparément) :
 * voir `HORIZON_ALERTE_EFFECTIF` pour la raison de cette fenêtre. Retourne le nombre d'alertes envoyées.
 *
 * La part est celle **réglée par le club** : elle est lue une fois, avant la boucle, pour que toutes
 * les séances d'un même passage soient jugées à la même règle. Le **nombre de personnes**, lui, se
 * calcule séance par séance, sur l'effectif invité de **sa** période : deux trimestres ouverts en
 * même temps n'ont pas forcément le même effectif, et c'est précisément ce que la part corrige.
 *
 * Les trois nombres annoncés (présents, invités, sans réponse) sont **dérivés une seule fois** de la
 * liste des invités de la séance ({@link chiffresEffectif}), puis passés tels quels à l'email de
 * l'équipe, au téléphone et aux deux salons : aucun canal ne recompte, donc aucun ne peut annoncer un
 * chiffre que les autres contrediraient.
 */
export async function alerterEffectifFaible(now = new Date()): Promise<number> {
  const [parEmail, parPush, parDiscord, parTelegram] = await Promise.all([
    envoiPossible("effectif_faible", "email"),
    pushPossible("effectif_faible"),
    envoiPossible("effectif_faible", "discord"),
    envoiPossible("effectif_faible", "telegram"),
  ]);
  if (!parEmail && !parPush && !parDiscord && !parTelegram) return 0;
  const club = await identite();
  const aujourdHui = todayIso(now);
  const prochaines = await db.session.findMany({
    // `gte: aujourdHui` garde les cours **du jour**, y compris ceux qui ont déjà eu lieu : le tri final
    // les écarte par `seanceCommencee` (voir juste après la boucle). On ne peut pas le faire en SQL, la
    // comparaison portant sur la date **et** l'heure dans le fuseau du club.
    where: { date: { gte: aujourdHui, lte: derniereDateAlerteEffectif(aujourdHui) }, annulee: false, period: { statut: "ACTIVE" } },
    orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
    include: {
      // `userId` autant que `statut` : c'est lui qui permet de ne garder que les réponses des invités.
      attendances: { select: { userId: true, statut: true } },
      instructeurs: { include: { user: { select: CHAMPS_DESTINATAIRE } } },
      period: {
        include: {
          // Le compte de connexion du portail n'est pas un invité : il ne compte pas et ne reçoit rien
          membres: { where: { user: { service: false } }, select: { userId: true } },
          instructeurs: { include: { user: { select: CHAMPS_DESTINATAIRE } } },
        },
      },
    },
  });
  let envoyees = 0;
  for (const s of prochaines) {
    // La fenêtre est déjà dans la requête ; la règle est rappelée ici pour qu'elle tienne à un seul
    // endroit et se vérifie sans base (`dansHorizonAlerteEffectif`).
    if (!dansHorizonAlerteEffectif(s.date, aujourdHui)) continue;
    /*
     * **Un cours déjà commencé ne s'alerte pas**. La fenêtre part d'aujourd'hui, et l'alerte a
     * rejoint les envois du soir (18 h, jusqu'à 19 h 30) : elle évaluait donc le stage du samedi
     * matin **à 18 h**, six heures après sa fin, et envoyait à l'encadrement « ⚠️ Peu de monde »
     * avec le bouton « Annuler cette séance » — pour un cours terminé. Le même message partait sur
     * les deux salons si les cases étaient cochées.
     *
     * `seanceCommencee` est la fonction que l'écran utilise déjà pour masquer « Annuler » ; le chemin
     * par email lit la même.
     */
    if (seanceCommencee(s.date, s.heureDebut, now)) continue;
    const chiffres = chiffresEffectif(s);
    /*
     * **C'est `palierEffectif` qui décide, et rien d'autre**.
     *
     * La docstring promettait déjà « le même calcul que les paliers des écrans et que le trait de la
     * frise », mais le code comparait les seuls `presents` au seuil, là où `palierEffectif` juge
     * l'**effectif attendu** (`presents + round(peutEtre / 2)`, voir `src/lib/presences.ts`). Sur un
     * club de 80 invités réglé à 20 % (seuil 16), une séance à 14 présents et 20 « peut-être »
     * faisait donc partir l'alerte — email aux instructeurs **avec le lien d'annulation signé**, plus
     * « ⚠️ Peu de monde annoncé » sur Discord et Telegram — pendant que la carte, la fiche, la frise,
     * le tableau de bord et l'embed du récap posté **sur le même salon** affichaient « Bien rempli ».
     * L'alerte appliquait la règle que `presences.ts` déclare fausse noir sur blanc.
     *
     * Passer par la fonction des écrans donne du même coup la garde `indetermine` : un trimestre de
     * quatre invités ne déclenche plus l'alerte à chaque cours, puisque aucun effectif n'y atteindra
     * jamais le seuil et qu'aucun écran n'y affiche de couleur.
     */
    // **La décision, pas le mot** : `palierEffectif` se tait sur un groupe trop petit pour que «
    // bien » soit atteignable, ce qui est juste pour une étiquette et faux pour une alerte — un
    // club de six n'aurait plus jamais été prévenu.
    if (!sousLeSeuil(chiffres, club.partEffectifMin)) continue;
    let alertee = false;
    // Toujours « chacun le sien » : cette alerte n'est pas routable vers la liste du club, et la
    // raison est écrite dans `RAISON_ROUTAGE_FIXE.effectif_faible`.
    if (parEmail) alertee = (await alerterEquipeParEmail(s, chiffres, club.partEffectifMin, now)) || alertee;
    // Sur le téléphone, pas de lien d'annulation : il vaut signature et reste dans l'email.
    if (parPush) alertee = (await alerterEquipeParPush(s, chiffres, now)) > 0 || alertee;
    if (parDiscord) {
      // Aucun lien d'annulation sur le salon : il vaut signature, il reste dans l'email de l'équipe.
      const publie = await publierSurSalon({
        type: "EFFECTIF",
        notification: "effectif_faible",
        dedupKey: `effectif_discord_${s.id}_${empreinteCreneau(s)}`,
        sessionId: s.id,
        embed: embedEffectifFaible(versSeanceResume(s), chiffres, chiffres.sansReponse, club.nomClub),
        now,
      });
      alertee = publie || alertee;
    }
    if (parTelegram) {
      const publie = await publierSurTelegram({
        type: "EFFECTIF",
        notification: "effectif_faible",
        dedupKey: `effectif_telegram_${s.id}_${empreinteCreneau(s)}`,
        sessionId: s.id,
        embed: embedEffectifFaible(versSeanceResume(s), chiffres, chiffres.sansReponse, club.nomClub),
        now,
      });
      alertee = publie || alertee;
    }
    if (alertee) envoyees++;
  }
  return envoyees;
}

/** L'adresse est facultative : un instructeur sans email est simplement écarté de l'alerte. */
type InstructeurAlerte = {
  id: string;
  prenom: string;
  email: string | null;
  actif: boolean;
  rappelEmail: boolean;
  preferencesNotifications: string | null;
  service: boolean;
};

type SeanceEffectif = {
  id: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  attendances: Array<{ userId: string; statut: string }>;
  instructeurs: Array<{ user: InstructeurAlerte }>;
  period: { membres: Array<{ userId: string }>; instructeurs: Array<{ user: InstructeurAlerte }> };
};

/**
 * Les chiffres de l'alerte, et le seul jeu de chiffres du passage : c'est lui qui décide de l'envoi,
 * qui part dans l'email de l'équipe et qui s'affiche sur les deux salons.
 *
 * `peutEtre` n'est annoncé nulle part — il ne sert qu'à **juger**, et il est indispensable pour
 * cela : c'est la forme exacte qu'attend `palierEffectif`, qui compte l'effectif attendu et non les
 * seuls confirmés. Le calculer ici est ce qui garantit que l'alerte et les écrans lisent le même
 * nombre ; l'omettre, c'était valoir zéro « peut-être » et juger un cours plus creux qu'il n'est.
 */
type ChiffresEffectif = { presents: number; invites: number; peutEtre: number; sansReponse: number };

/**
 * **Les chiffres de l'alerte se dérivent de la liste des invités de la séance** — même doctrine que
 * `compteursDeLaListe` (`src/lib/seances.ts`) : c'est la même chose comptée, pas un second comptage.
 *
 * Quatrième endroit du dossier à avoir compté sans filtre, corrigé ; les trois autres (carte de
 * séance, tableau de bord, page publique) l'avaient été la veille. `Attendance` pend à `User` et à
 * `Session`, jamais à `PeriodMember` : retirer quelqu'un du trimestre (`retirerMembrePeriode`)
 * laisse ses réponses derrière lui, et le compte de connexion du portail répond comme n'importe
 * quel compte alors que la requête l'a déjà écarté des invités.
 *
 * Vécu en répétition sur un club de 80 invités, où le seuil vaut 16 : quinze présents et **deux
 * réponses héritées** de gens sortis du trimestre en faisaient dix-sept. Le seuil était franchi à
 * tort, l'alerte ne partait pas — et pendant ce temps la carte de la séance, le tableau de bord et la
 * page publique, filtrés eux, affichaient tous « Peu de monde » sur le même cours. Le silence portait
 * précisément sur le cours qu'il fallait annoncer.
 *
 * `sansReponse` a exactement le même biais quand il se calcule sur `attendances.length` : deux
 * réponses héritées rongent le « sans réponse » de deux personnes, et l'équipe croit avoir relancé
 * tout le monde. En partant du même ensemble que `presents`, l'écart cesse d'être exprimable.
 */
function chiffresEffectif(s: SeanceEffectif): ChiffresEffectif {
  const invites = new Set(s.period.membres.map((m) => m.userId));
  const reponses = s.attendances.filter((a) => invites.has(a.userId));
  return {
    presents: reponses.filter((a) => a.statut === "PRESENT").length,
    // Même filtre, même ensemble : un « peut-être » laissé par quelqu'un sorti du trimestre pèserait
    // sinon une demi-personne dans la décision, et l'alerte se tairait sur un cours vide.
    peutEtre: reponses.filter((a) => a.statut === "PEUT_ETRE").length,
    invites: invites.size,
    sansReponse: Math.max(0, invites.size - reponses.length),
  };
}

/**
 * L'alerte par email aux instructeurs (avec le lien d'annulation en un geste).
 *
 * Alignée sur les rappels (`rappels.ts`), et elle ne l'était pas :
 *
 * 1. **la clé est posée avant l'envoi**, par `journaliser` — un `create` brut placé *après* la boucle
 *    laissait deux passages simultanés (deux instances, un rejeu) écrire deux fois la même alerte, et
 *    faisait remonter la P2002 du perdant dans le balayage de 7 h ;
 * 2. **un échec d'envoi libère la clé** (`marquerEchec`). C'était le seul envoi du dossier sans ce
 *    rattrapage : trois minutes de SMTP en panne, et l'alerte était perdue pour de bon — la ligne de
 *    journal disait « envoyé », plus rien ne repartait, et l'équipe ouvrait la salle pour personne.
 *
 * Une seule clé pour toute l'équipe (c'est une alerte du club, pas un message personnel) : on ne la
 * libère donc qu'**une fois**, au premier échec — le passage suivant refait partir l'alerte entière,
 * ce qui est exactement ce qu'on veut pour deux ou trois instructeurs.
 *
 * **Compromis assumé sur le retour de `journaliser`** : il rend `false` sur *n'importe quelle*
 * erreur d'écriture, pas seulement sur la clé déjà prise (`journal.ts`). Un hoquet de la base fait
 * donc **taire** l'alerte au lieu de l'envoyer quand même. C'est le choix du dossier — dans le
 * doute, ne pas écrire deux fois aux gens —, et il coûte peu ici : la clé n'ayant pas été posée,
 * le passage suivant refait partir l'alerte entière, et l'incident est dans le journal du serveur. Le
 * distinguer demanderait de remonter le code Prisma jusqu'ici, ce que `journaliser` n'expose pas.
 *
 * **Et il existe bien un passage suivant**. Cette phrase promettait une « fenêtre de rattrapage »
 * que rien ne branchait : `alerterEffectifFaible` n'était appelée que par `entretienQuotidien`
 * (`src/lib/taches.ts`), planifié `0 7 * * *` — **un seul passage par jour**, alors que
 * `estPassageEnvois` / `FENETRE_RATTRAPAGE_MIN` ne gouvernent que `tickEnvois`. Pour une séance
 * **du jour même** — la fenêtre de l'alerte va de J-3 au jour du cours —, le passage de 07:00 était
 * donc le premier et le dernier : trois minutes de SMTP fâché, `marquerEchec` libérait proprement
 * la clé, et **rien ne la rejouait**. L'équipe ouvrait la salle pour personne. L'alerte est
 * désormais appelée aussi par `envoisDuSoir`, qui repasse toutes les `PAS_RATTRAPAGE_MIN` minutes
 * pendant `FENETRE_RATTRAPAGE_MIN` : elle est idempotente (`effectif_<id>_<créneau>`), un repassage
 * sans rien à faire ne coûte que quelques requêtes.
 */
async function alerterEquipeParEmail(s: SeanceEffectif, chiffres: ChiffresEffectif, partEffectifMin: number, now: Date): Promise<boolean> {
  /*
   * **L'empreinte du créneau, comme le récap et les rappels**.
   *
   * La clé ne portait que l'identifiant de la séance, et le dossier annonçait « une seule alerte par
   * séance » — mais l'argument de `empreinteCreneau` s'applique mot pour mot ici : « une séance déplacée
   * garde son identifiant ». Le scénario : un cours du 8 octobre alerte à 4 attendus sur 22, l'équipe
   * décide de le **décaler** au 22 au lieu de l'annuler. Le 19, le cours déplacé est à 3 attendus — et
   * plus rien ne part, ni email à l'encadrement, ni annonce sur les salons : la clé est prise depuis
   * quinze jours. L'équipe ouvre la salle pour trois personnes, la panne exacte que l'alerte évite.
   *
   * L'empreinte ne porte **que** le créneau : corriger un thème ou un lieu ne réalerte pas.
   */
  const dedupKey = `effectif_${s.id}_${empreinteCreneau(s)}`;
  if (await dejaEnvoye(dedupKey)) return false;
  // Les instructeurs de la séance ; à défaut, ceux de la période. Sans adresse email, on écarte en
  // silence ; qui a refusé cette alerte dans son profil est écarté aussi (`destinataireRetenu`).
  const prefs = await getPreferencesNotifications();
  const equipe = (await equipeJoignable(s, now)).filter((u): u is InstructeurAlerte & { email: string } => aUnEmail(u) && destinataireRetenu(prefs, "effectif_faible", "email", u));
  // Personne à prévenir : la clé n'est pas consommée, une adresse ajoutée demain vaudra alerte.
  if (equipe.length === 0) return false;
  if (!(await journaliser({ type: "EFFECTIF", canal: "EMAIL", sessionId: s.id, dedupKey, statut: "ENVOYE" }))) return false;
  let liberee = false;
  // Un lien par destinataire : le jeton porte le compte de la personne à qui l'email part, c'est lui
  // qui sera journalisé si elle annule (voir `urlAnnulation`).
  for (const u of equipe) {
    const { sujet, contenu } = emailEffectifFaible({
      prenom: u.prenom,
      seance: versSeanceEmail(s),
      presents: chiffres.presents,
      invites: chiffres.invites,
      sansReponse: chiffres.sansReponse,
      // Le pied de l'email annonce le seuil : il le **calcule** depuis la part réglée et l'effectif
      // invité de cette séance-là, au lieu d'écrire un nombre en dur qui contredirait l'écran Club.
      partEffectifMin,
      urlAnnulation: urlAnnulation(s.id, u.id),
    });
    enqueueEmail({ to: u.email, sujet, contenu, ref: `effectif_${s.id}_${u.id}` }, (err) => {
      if (!err || liberee) return;
      liberee = true;
      void marquerEchec(dedupKey, err.message);
    });
  }
  return true;
}

/** L'équipe d'une séance (à défaut, celle de la période), sans le compte de service. */
function equipeDe(s: SeanceEffectif): InstructeurAlerte[] {
  return personnesDuClub((s.instructeurs.length > 0 ? s.instructeurs : s.period.instructeurs).map((i) => i.user));
}

/**
 * L'équipe à qui l'alerte peut partir : celle de {@link equipeDe}, réduite à qui a un **accès actif**
 * (src/lib/acces-actif.ts). Le tri se fait **après** le choix de l'équipe — séance, à défaut période —
 * et non dans la requête : filtrer en base l'équipe de la séance ferait basculer l'alerte sur celle de
 * la période dès que ses instructeurs n'ont plus d'accès, ce qui changerait **qui** est concerné, pas
 * seulement qui reçoit. Les chiffres, eux, ne passent pas par ici.
 */
async function equipeJoignable(s: SeanceEffectif, now: Date): Promise<InstructeurAlerte[]> {
  return filtrerAccesActif(equipeDe(s), now);
}

/**
 * La même alerte sur le téléphone des instructeurs. Elle mène à la fiche de la séance, d'où
 * l'annulation se fait en deux appuis — le lien signé, lui, reste réservé à l'email.
 */
async function alerterEquipeParPush(s: SeanceEffectif, chiffres: Pick<ChiffresEffectif, "presents">, now: Date): Promise<number> {
  const prefs = await getPreferencesNotifications();
  const equipe = (await equipeJoignable(s, now)).filter((u) => destinataireRetenu(prefs, "effectif_faible", "push", u));
  return notifierParPush({
    type: "EFFECTIF",
    sessionId: s.id,
    destinataires: equipe,
    cle: (u) => `effectif_push_${s.id}_${empreinteCreneau(s)}_${u.id}`,
    charge: () => chargeEffectifFaiblePush(s, chiffres.presents),
  });
}

/**
 * Le texte de l'alerte sur l'appareil : le chiffre qui inquiète, et rien d'autre.
 *
 * `presents` arrive **déjà dérivé** de la liste des invités ({@link chiffresEffectif}) : cette
 * fonction ne compte aucune réponse elle-même, sans quoi un écran verrouillé annoncerait « 17
 * présents » quand l'email de la même minute en annonce quinze. Le dénominateur, lui, se lit
 * directement sur `period.membres` : c'est la liste des invités elle-même, déjà débarrassée du compte
 * de service par la requête — donc exactement le `invites` du triplet.
 */
export function chargeEffectifFaiblePush(s: { id: string; date: string; heureDebut: string; period: { membres: Array<{ userId: string }> } }, presents: number): ChargePush {
  return {
    titre: "Peu de monde au prochain cours",
    corps: `${formatDateCourte(s.date)} à ${formatHeure(s.heureDebut)} : ${presents} présent${presents > 1 ? "s" : ""} sur ${s.period.membres.length} invités.`,
    url: `/seances/${s.id}`,
    tag: `effectif-${s.id}`,
  };
}

/**
 * Prévient tous les invités qu'une séance est annulée (une seule fois par annulation), par email,
 * sur leur téléphone **et** sur le salon Discord. Retourne le nombre de membres prévenus **par
 * email** — ni un salon injoignable, ni un service de push en panne ne changent ce nombre ou le
 * succès de l'annulation.
 */
export async function notifierAnnulation(sessionId: string, now = new Date()): Promise<number> {
  const [parEmail, parPush, parDiscord, parTelegram] = await Promise.all([
    envoiPossible("seance_annulee", "email"),
    pushPossible("seance_annulee"),
    envoiPossible("seance_annulee", "discord"),
    envoiPossible("seance_annulee", "telegram"),
  ]);
  if (!parEmail && !parPush && !parDiscord && !parTelegram) return 0;
  const s = await db.session.findUnique({
    where: { id: sessionId },
    include: { period: { include: { membres: { where: { user: { service: false } }, include: { user: { select: CHAMPS_DESTINATAIRE } } } } } },
  });
  if (!s || !s.annulee) return 0;
  /*
   * **Les destinataires personnels, une fois pour l'email et le téléphone** : les invités qui ont un
   * accès actif (src/lib/acces-actif.ts). Quelqu'un saisi dans l'annuaire sans avoir été invité, ou
   * dont l'accès a été coupé, n'est prévenu de rien. Ne concerne ni la liste du club ni les salons,
   * qui ne s'adressent à personne nommément.
   */
  const invitesJoignables = parEmail || parPush ? await filtrerAccesActif(s.period.membres.map((m) => m.user), now) : [];
  const motif = s.motifAnnulation ?? "non précisé";
  const horodatage = s.updatedAt.getTime();
  // Le nom du club, lu une fois pour les trois canaux de cette annulation (mise en cache par requête).
  const club = await identite();
  let prevenus = 0;
  // Lus une fois pour les deux modes d'envoi par email.
  const prefsEmail = parEmail ? await getPreferencesNotifications() : null;
  const adresseListe = prefsEmail ? adresseListePour(prefsEmail, "seance_annulee") : null;
  if (parEmail && adresseListe !== null) {
    /*
     * **Un message au lieu de N.** Espace de clés distinct de `annulation_<id>_<horodatage>`, mais
     * l'horodatage reste : une séance annulée, rouverte, puis ré-annulée avec un autre motif doit
     * pouvoir reprévenir la liste.
     *
     * `prevenus` vaut alors **1** : c'est le nombre de messages expédiés, pas le nombre de personnes
     * servies — l'application ne sait pas qui lit la liste, et le prétendre serait mentir à
     * l'instructeur qui vient d'annuler (l'écran lui dit « 1 message envoyé sur la liste »).
     */
    const dedupKey = `annulation_liste_${s.id}_${horodatage}`;
    if (!(await dejaEnvoye(dedupKey))) {
      /*
       * **Le message d'abord, la clé ensuite** — et ici la règle vaut double. `messageCollectif`
       * lève, et cette levée remonte jusqu'à `annulerSeance`, c'est-à-dire **après** l'écriture en
       * base : la séance est déjà annulée. Une clé posée avant aurait donc cumulé les deux pires
       * effets — l'annonce éteinte pour toujours (clé prise au passage suivant) et les blocs push /
       * Discord / Telegram qui suivent jamais exécutés. Personne n'aurait été prévenu, par aucun
       * canal, et l'écran n'aurait montré qu'une erreur.
       */
      const message = messageCollectif(emailSeanceAnnuleeListe({ seance: versSeanceEmail(s), motif, nomApp: club.nomCourt }));
      if (await journaliser({ type: "ANNULATION", canal: "EMAIL", sessionId: s.id, userId: null, dedupKey, statut: "ENVOYE" })) {
        enqueueEmailListe(adresseListe, message, dedupKey, (err) => {
          if (err) void marquerEchec(dedupKey, err.message);
        });
        prevenus = 1;
      }
    }
  } else if (prefsEmail) {
    /*
     * **« Chacun le sien », au même patron que la branche liste ci-dessus**.
     *
     * La boucle tournait sans rappel et un `db.notificationLog.create` brut posait la clé **après** :
     * c'était le dernier envoi du dossier à écrire son journal une fois les emails partis, et la
     * violation exacte de l'invariant de `CLAUDE.md` (« la clé se pose AVANT l'envoi, jamais après »).
     *
     * Ce qu'il en coûtait, et qui s'est joué en quelques centaines de millisecondes : l'alerte « peu
     * de monde » porte un lien d'annulation en un clic. Deux instructeurs annulent presque en même
     * temps — l'un dans l'application (`annulerSeance`), l'autre depuis l'email
     * (`annulerDepuisEmail`, dont la garde `if (!seance.annulee)` lit avant que l'autre écriture
     * n'ait atterri). Les deux appellent `notifierAnnulation`, qui relit la séance : même
     * `updatedAt`, donc **même `dedupKey`**, donc les deux passaient `dejaEnvoye` (aucune ligne
     * encore écrite) et parcouraient la boucle. **Chaque invité recevait deux fois « Cours
     * annulé »**, puis le `create` du perdant levait une P2002 que personne n'attrapait ici
     * (contrairement à `journaliser`, qui l'avale et rend `false`) : elle remontait hors de la server
     * action, et l'instructeur voyait une erreur pour une séance bel et bien annulée dont tout le
     * club venait d'être prévenu deux fois.
     *
     * Désormais : les messages d'abord (une mise en forme qui lève ne laisse pas de clé derrière
     * elle), `journaliser` ensuite — c'est la contrainte d'unicité qui tranche entre les deux
     * passages —, puis la boucle d'envoi ; et **le premier échec libère la clé** (`marquerEchec`),
     * une seule fois pour tout l'envoi, comme dans `alerterEquipeParEmail`.
     */
    const dedupKey = `annulation_${s.id}_${horodatage}`;
    if (!(await dejaEnvoye(dedupKey))) {
      // Invités actifs **et joignables** : une personne sans adresse email reste invitée, elle n'est
      // simplement prévenue de rien (l'équipe la préviendra de vive voix). Et qui a refusé les
      // annonces d'annulation dans son profil n'en reçoit plus (`destinataireRetenu`).
      const prefs = prefsEmail;
      const invites = invitesJoignables.filter((u): u is typeof u & { email: string } => aUnEmail(u) && destinataireRetenu(prefs, "seance_annulee", "email", u));
      const messages = invites.map((u) => ({ to: u.email, ...emailSeanceAnnulee({ prenom: u.prenom, seance: versSeanceEmail(s), motif, nomApp: club.nomCourt }), ref: `annulation_${s.id}_${u.id}` }));
      if (await journaliser({ type: "ANNULATION", canal: "EMAIL", sessionId: s.id, userId: null, dedupKey, statut: "ENVOYE" })) {
        // Une seule clé pour tout l'envoi : on ne la libère donc qu'**une fois**, au premier échec.
        let liberee = false;
        for (const { to, sujet, contenu, ref } of messages) {
          enqueueEmail({ to, sujet, contenu, ref }, (err) => {
            if (!err || liberee) return;
            liberee = true;
            void marquerEchec(dedupKey, err.message);
          });
        }
        prevenus = messages.length;
      }
    }
  }
  if (parPush) {
    // Même décision que pour l'email, mais sur le canal `push` : qui a gardé l'un et coupé l'autre
    // est respecté, et une personne sans adresse email peut n'être prévenue que par là.
    const prefs = await getPreferencesNotifications();
    const invites = invitesJoignables.filter((u) => destinataireRetenu(prefs, "seance_annulee", "push", u));
    await notifierParPush({
      type: "ANNULATION",
      sessionId: s.id,
      destinataires: invites,
      cle: (u) => `annulation_push_${s.id}_${horodatage}_${u.id}`,
      charge: () => chargeAnnulationPush(s, motif),
    });
  }
  if (parDiscord) {
    // Ne lève jamais : un webhook invalide ou un salon supprimé ne doit pas faire échouer l'annulation.
    await publierSurSalon({
      type: "ANNULATION",
      notification: "seance_annulee",
      dedupKey: `annulation_discord_${s.id}_${horodatage}`,
      sessionId: s.id,
      embed: embedAnnulation(versSeanceResume(s), motif, club.nomClub),
      now,
    });
  }
  if (parTelegram) {
    // Même message, autre salon. L'horodatage reste dans la clé : une séance annulée puis
    // ré-annulée avec un autre motif doit pouvoir reprévenir le groupe.
    await publierSurTelegram({
      type: "ANNULATION",
      notification: "seance_annulee",
      dedupKey: `annulation_telegram_${s.id}_${horodatage}`,
      sessionId: s.id,
      embed: embedAnnulation(versSeanceResume(s), motif, club.nomClub),
      now,
    });
  }
  return prevenus;
}

/**
 * **Ce que l'écran doit dire après une annulation**, sans mentir sur qui a été prévenu.
 *
 * `notifierAnnulation` retourne un nombre de **messages expédiés**, pas de personnes servies. En
 * mode « chacun le sien », les deux se confondent — un email par invité. En mode « la liste », le
 * nombre vaut 1, et annoncer « 1 membre prévenu » à l'instructeur qui vient d'annuler serait faux :
 * l'application ne sait pas qui lit la liste. Elle dit donc ce qu'elle sait.
 */
export async function phraseAnnulation(messages: number): Promise<string> {
  const prefs = await getPreferencesNotifications();
  if (envoiCollectifDans(prefs, "seance_annulee")) {
    return messages > 0 ? `annonce envoyée sur la liste du club (${prefs.adresseListe})` : "aucune annonce par email (déjà envoyée, ou canal coupé)";
  }
  return `${messages} membre${messages > 1 ? "s" : ""} prévenu${messages > 1 ? "s" : ""} par email`;
}

/**
 * La notification d'annulation : titre net (c'est la seule chose qu'on lit sur un écran verrouillé),
 * date, horaire et motif dans le corps, et l'appui ouvre l'onglet Présences.
 */
export function chargeAnnulationPush(s: { id: string; date: string; heureDebut: string }, motif: string): ChargePush {
  return {
    titre: "Cours annulé",
    corps: `${formatDateCourte(s.date)} à ${formatHeure(s.heureDebut)} — ${motif}`,
    url: "/seances",
    tag: `annulation-${s.id}`,
  };
}
