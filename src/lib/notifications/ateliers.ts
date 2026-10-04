import { enqueueEmail } from "@/lib/email/mailer";
import { emailAtelierStatut } from "@/lib/email/templates/ateliers";
import { envoiPossible } from "./canaux";
import { journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import { destinataireRetenu, getPreferencesNotifications, type DestinataireLike } from "./preferences";

/**
 * **La réponse du club à une proposition d'atelier**, par email et sur le téléphone.
 *
 * Elle partait depuis deux écrans (`src/actions/ateliers.ts` et `src/actions/planning.ts`), en deux
 * copies du même bloc, et c'est le seul envoi de l'application qui s'était écarté des règles du
 * dossier sur trois points :
 *
 * 1. **`envoiPossible` était contourné.** Seul `destinataireRetenu` était consulté : il vérifie la
 *    case du club, pas l'**état réel du canal**. Sur une instance sans SMTP, l'email était mis en file
 *    pour un serveur qui n'existe pas, et l'écran annonçait au bureau « le membre est prévenu par
 *    email » — ce qui était faux.
 * 2. **Rien n'était journalisé.** Aucune ligne dans `NotificationLog` : un double appui sur
 *    « Refuser » écrivait deux fois au membre, et un échec d'envoi ne laissait aucune trace ni aucune
 *    reprise.
 * 3. **La clé du push bloquait un second refus.** `atelier_push_<id>_<statut>_<userId>` ne portait
 *    que le statut : une proposition refusée, remise en attente (« réexaminer »), puis refusée de
 *    nouveau retombait sur la même clé — le membre n'était jamais prévenu de la seconde réponse.
 *
 * D'où ce module, seul chemin désormais. La clé porte **l'horodatage de la décision**
 * (`Atelier.updatedAt`, écrit par la mise à jour qui précède l'appel), comme la clé d'annulation
 * porte celui de l'annulation : deux décisions successives sont deux messages, un double appui sur la
 * même décision n'en est qu'un — voir {@link FENETRE_DECISION_MS} pour ce que « la même » veut dire
 * exactement, et pour ce qui reste hors de portée d'une clé de déduplication.
 *
 * Comme partout ici, **rien ne lève** : une panne de la file d'emails ou du service de push ne doit
 * pas faire échouer la décision, qui est déjà enregistrée quand on arrive ici.
 */
export const TYPE_ATELIER = "ATELIER";

/** Les deux verdicts qui valent un message : retirer du planning ou réexaminer n'en valent pas. */
export type StatutDecide = "REFUSE" | "PLANIFIE";

/** Ce qu'il faut du proposeur pour décider si le message lui part (voir `destinataireRetenu`). */
export type ProposeurAtelier = DestinataireLike & { id: string; prenom: string; email: string | null };

/**
 * **Largeur d'une « même décision », en millisecondes.**
 *
 * L'horodatage entre dans la clé pour qu'un second refus (après « réexaminer ») reparte. Mais pris
 * à la milliseconde, il **rouvrait la porte qu'il devait fermer** : deux appuis *simultanés* sur
 * « Refuser » lisent tous les deux un atelier encore `PROPOSE`, écrivent tous les deux la ligne, et
 * en ressortent avec **deux `updatedAt` différents** — donc deux clés, donc deux emails identiques
 * au membre. La docstring d'en dessous affirmait le contraire.
 *
 * L'horodatage est donc ramené à une fenêtre de dix secondes : deux écritures concurrentes (séparées
 * par le temps d'un `UPDATE`, quelques millisecondes) retombent sur la même clé, et l'unicité
 * tranche comme elle doit. Dix secondes parce que c'est à la fois très au-delà de ce qu'il faut à
 * deux requêtes pour se croiser, et très en deçà du temps qu'il faut à un humain pour refuser,
 * rouvrir puis refuser de nouveau.
 *
 * **Ce que ça ne ferme pas**, et il faut le savoir : deux appuis qui tombent de part et d'autre d'un
 * multiple de dix secondes restent deux clés. La fenêtre réduit la course, elle ne la supprime pas —
 * seule une contrainte d'unicité portant sur « l'atelier, le verdict et *le rang* de la décision »
 * le ferait, et ce rang n'existe pas au schéma.
 *
 * Changer la forme des clés ne fait **rien repartir** : ce module n'est appelé qu'à la suite d'une
 * décision (jamais par le cron), et une décision neuve écrit de toute façon une clé neuve.
 */
export const FENETRE_DECISION_MS = 10_000;

/** L'horodatage d'une décision, ramené au début de sa fenêtre. */
export function fenetreDecision(horodatage: number): number {
  return Math.floor(horodatage / FENETRE_DECISION_MS) * FENETRE_DECISION_MS;
}

export function cleDecisionAtelierEmail(atelierId: string, statut: StatutDecide, horodatage: number, userId: string): string {
  return `atelier_${atelierId}_${statut}_${horodatage}_${userId}`;
}

/** Le canal fait partie de la clé : l'email et le téléphone se décident et se rejouent séparément. */
export function cleDecisionAtelierPush(atelierId: string, statut: StatutDecide, horodatage: number, userId: string): string {
  return `atelier_push_${atelierId}_${statut}_${horodatage}_${userId}`;
}

export type DecisionAtelier = {
  /** L'atelier **après** la mise à jour : c'est son `updatedAt` qui date la décision. */
  atelier: { id: string; titre: string; commentaireInstructeur: string | null; updatedAt: Date };
  proposePar: ProposeurAtelier;
  statut: StatutDecide;
  /** Le commentaire saisi par l'équipe, à défaut celui déjà porté par l'atelier. */
  commentaire?: string | null;
  /** La séance où l'atelier est placé (verdict PLANIFIE). */
  seance?: { date: string; heureDebut: string; lieu: string } | null;
};

/**
 * Prévient le membre de la réponse donnée à sa proposition. Retourne vrai si un **email** est
 * réellement parti — c'est ce que l'écran annonce au bureau, et il ne doit l'annoncer que si c'est
 * vrai (canal branché, case du club cochée, choix du membre respecté, adresse renseignée).
 */
export async function notifierDecisionAtelier({ atelier, proposePar, statut, commentaire, seance = null }: DecisionAtelier): Promise<boolean> {
  let envoye = false;
  try {
    // Dans le `try` comme le reste : rien ici ne doit pouvoir faire échouer une décision déjà prise.
    const horodatage = fenetreDecision(atelier.updatedAt.getTime());
    const [parEmail, parPush] = await Promise.all([envoiPossible("atelier_statut", "email"), pushPossible("atelier_statut")]);
    const prefs = await getPreferencesNotifications();
    if (parEmail && proposePar.email && destinataireRetenu(prefs, "atelier_statut", "email", proposePar)) {
      const cle = cleDecisionAtelierEmail(atelier.id, statut, horodatage, proposePar.id);
      // La clé est posée AVANT l'envoi, comme pour le récap : c'est la contrainte d'unicité qui
      // tranche entre deux appuis simultanés sur « Refuser », et non une lecture préalable.
      //
      // **`journaliser` rend `false` sur n'importe quelle erreur d'écriture**, pas seulement sur le
      // doublon (`journal.ts`) : une base fatiguée fait donc taire ce message au lieu de l'envoyer
      // quand même. C'est le compromis assumé de tout le dossier — dans le doute, se taire plutôt
      // que d'écrire deux fois à quelqu'un —, et il vaut surtout ici : la décision est déjà
      // enregistrée, le membre la verra dans « Mes propositions », et l'écran n'annoncera pas au
      // bureau un email qui n'est pas parti (c'est `envoye` qui le dit).
      if (await journaliser({ type: TYPE_ATELIER, canal: "EMAIL", userId: proposePar.id, dedupKey: cle, statut: "ENVOYE" })) {
        const { sujet, contenu } = emailAtelierStatut({
          prenom: proposePar.prenom,
          titre: atelier.titre,
          statut,
          commentaire: commentaire || atelier.commentaireInstructeur,
          seance,
        });
        enqueueEmail({ to: proposePar.email, sujet, contenu, ref: cle }, (err) => {
          if (err) void marquerEchec(cle, err.message);
        });
        envoye = true;
      }
    }
    // Et sur le téléphone, pour qui l'a branché : c'est la réponse qu'on attend après avoir proposé
    // quelque chose au club. Décision prise canal par canal — quelqu'un peut vouloir la notification
    // sans l'email —, et l'email ne dépend en rien de ce qui suit.
    if (parPush) {
      await notifierParPush({
        type: TYPE_ATELIER,
        destinataires: [proposePar].filter((p) => destinataireRetenu(prefs, "atelier_statut", "push", p)),
        cle: (p) => cleDecisionAtelierPush(atelier.id, statut, horodatage, p.id),
        charge: () => ({
          titre: statut === "PLANIFIE" ? "Ton atelier est programmé" : "Réponse à ta proposition",
          corps: atelier.titre,
          url: "/ateliers",
          tag: `atelier-${atelier.id}`,
        }),
      });
    }
  } catch (e) {
    // La décision est déjà enregistrée : un message manqué ne doit pas la faire échouer.
    console.error("[notifications] réponse à une proposition d'atelier : échec non bloquant", e);
  }
  return envoye;
}
