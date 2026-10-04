/**
 * **« Que veux-tu faire ? » pour une personne** — sur sa fiche, et dans le volet « Gérer » de sa
 * ligne de l'annuaire. La partie pure, donc testable.
 *
 * La fiche alignait deux cartes de boutons au pied de la page : « Remettre l'accès à zéro » (rouge,
 * avec un long paragraphe) et « Compte » (« Désactiver » neutre, « Réactiver » vert, « Supprimer
 * définitivement » rouge) — deux rouges dont un seul efface, et un vert qui ne disait rien de plus
 * que son mot. Elle pose désormais la même question que l'annuaire, avec la forme commune
 * (`GestesProposes`) :
 *
 * - **seulement les gestes qui s'appliquent à cette personne** : l'invitation à qui n'est jamais
 *   entré, la remise à zéro à qui l'est, désactiver *ou* réactiver selon l'état du compte, supprimer ;
 * - chacun **expliqué avant d'agir**, avec ce que la carte disait déjà (ce qui est effacé, ce qui part
 *   par email, ce qui reste intact) ;
 * - **un seul bouton**, au verbe nommant la personne, rouge pour ce qui révoque, réinitialise ou
 *   supprime (`gesteRouge`) ;
 * - **les confirmations de la fiche sont gardées, mot pour mot**.
 *
 * Les conditions sont celles des gardes serveur, que l'écran reprend sans les élargir : un geste que
 * le serveur refuserait n'est pas proposé — un choix qui ne peut qu'échouer est pire qu'un choix absent.
 */

import { AUCUN_EMAIL, phraseEmails, type GesteOffert } from "@/components/ui/choix-geste";
import { texteConfirmationInvitationUnitaire } from "./selection-liens";

/** Les gestes de la fiche, dans l'ordre où la liste les propose : la suppression toujours en dernier. */
export const GESTES_FICHE = ["renvoyer", "revoquer", "inviter", "reinitialiser", "desactiver", "reactiver", "supprimer"] as const;

export type GesteFiche = (typeof GESTES_FICHE)[number];

/** Ce que la fiche sait de la personne — rien de plus que ce qu'elle lisait déjà. */
export type PersonneFiche = {
  prenom: string;
  nom: string;
  actif: boolean;
  aUnEmail: boolean;
  /** Déjà entré dans l'application (`aDejaUnAcces`) : la garde même des deux gestes d'accès. */
  dejaEntre: boolean;
  /** Une remise à zéro lui renverrait-elle une invitation ? (actif, adresse, période active) */
  recoitInvitation: boolean;
  /** Du bureau : la désactivation et la suppression le disent. */
  estAdmin: boolean;
  /** Réponses de présence perdues si le compte est supprimé. */
  reponses: number;
  /** Ce que la remise à zéro effacerait vraiment (« le mot de passe », …) — jamais ce qui n'existe pas. */
  aEffacer: string[];
  /** La période dont l'invitation et le lien partent (la période active), `null` sans période active. */
  periodeLien: { nom: string } | null;
  /** Un lien encore valable vit pour cette période : « Renvoyer » plutôt qu'« Envoyer », et « Révoquer ». */
  lienEnCours?: boolean;
};

/**
 * Ce que l'acteur peut faire **sur cette fiche-ci** : la page compose les permissions avec les verrous
 * du compte (portail, soi-même, compte non modifiable), comme le faisaient ses boutons.
 */
export type DroitsFiche = {
  inviter: boolean;
  reinitialiser: boolean;
  activer: boolean;
  supprimer: boolean;
  /**
   * Envoyer / renvoyer et révoquer le lien de la période active. **Absents sur la fiche**, qui garde
   * ces deux gestes sur la ligne de chaque période ; présents dans le volet « Gérer » de l'annuaire,
   * qui n'a qu'une période en vue.
   */
  renvoyer?: boolean;
  revoquer?: boolean;
};

/** « d'Bravo », « de Paul » : la phrase se lit à voix haute. */
export const de = (prenom: string) => (/^[aeiouyàâäéèêëîïôöùûü]/i.test(prenom) ? `d'${prenom}` : `de ${prenom}`);

/** « le mot de passe, la double authentification et les liens en cours ». */
function liste(elements: readonly string[]): string {
  if (elements.length <= 1) return elements[0] ?? "";
  return `${elements.slice(0, -1).join(", ")} et ${elements[elements.length - 1]}`;
}

/** Le geste s'applique-t-il à cette personne, pour cet acteur ? */
export function gesteApplicable(geste: GesteFiche, p: PersonneFiche, d: DroitsFiche): boolean {
  switch (geste) {
    case "renvoyer":
      // Les refus d'`envoyerLienMembre` : désactivé, sans adresse, sans période.
      return Boolean(d.renvoyer) && p.actif && p.aUnEmail && p.periodeLien !== null;
    case "revoquer":
      return Boolean(d.revoquer) && p.periodeLien !== null && Boolean(p.lienEnCours);
    case "inviter":
      // Les refus d'`envoyerInvitationMembre`, dans l'ordre : déjà entré, désactivé, sans adresse, sans période.
      return d.inviter && !p.dejaEntre && p.actif && p.aUnEmail && p.periodeLien !== null;
    case "reinitialiser":
      return d.reinitialiser && p.dejaEntre;
    case "desactiver":
      return d.activer && p.actif;
    case "reactiver":
      return d.activer && !p.actif;
    case "supprimer":
      return d.supprimer;
  }
}

/** Un geste de la fiche, prêt à proposer (l'action est liée par la page). */
export type GesteFicheOffert = GesteOffert & { geste: GesteFiche };

/**
 * **Les gestes proposés pour cette personne**, avec leurs mots, leur explication et leur confirmation.
 *
 * `confirmations` garde la question **que l'écran posait déjà** quand elle diffère de celle de la
 * fiche (le volet de l'annuaire a les siennes) : l'explication la précède, elle ne la remplace pas.
 */
export function gestesFiche(p: PersonneFiche, d: DroitsFiche, confirmations: Partial<Record<GesteFiche, string | undefined>> = {}): GesteFicheOffert[] {
  return GESTES_FICHE.filter((g) => gesteApplicable(g, p, d)).map((g) => {
    const geste = decrire(g, p);
    return g in confirmations ? { ...geste, confirmation: confirmations[g] } : geste;
  });
}

function decrire(geste: GesteFiche, p: PersonneFiche): GesteFicheOffert {
  const nom = `${p.prenom} ${p.nom}`;
  const periode = p.periodeLien ? ` pour « ${p.periodeLien.nom} »` : "";
  switch (geste) {
    case "renvoyer": {
      const verbe = p.lienEnCours ? "Renvoyer" : "Envoyer";
      return {
        geste,
        libelle: `${verbe} le lien`,
        bouton: `${verbe} le lien à ${p.prenom}`,
        explication: {
          titre: `${verbe} son lien personnel à ${nom}`,
          phrases: [
            p.lienEnCours
              ? `Un nouveau lien${periode} : l'ancien cesse de fonctionner, et ses appareils déjà connectés sont déconnectés. Rien d'autre n'est effacé.`
              : `Un lien personnel${periode}, qui l'ouvre directement. Rien n'est effacé.`,
            phraseEmails(1),
          ],
        },
        confirmation: p.lienEnCours ? `Générer un nouveau lien pour ${nom} et le lui envoyer ? L'ancien cessera de fonctionner.` : undefined,
        fait: "Le lien est parti.",
      };
    }
    case "revoquer":
      return {
        geste,
        libelle: "Révoquer le lien",
        bouton: `Révoquer le lien ${de(p.prenom)}`,
        explication: {
          titre: `Révoquer le lien ${de(p.prenom)}`,
          phrases: [
            `${p.prenom} ne pourra plus entrer par ce lien tant qu'un nouveau n'est pas envoyé. Ses appareils déjà connectés le restent, rien n'est effacé.`,
            AUCUN_EMAIL,
          ],
        },
        confirmation: `Révoquer le lien de ${nom} ? Il ne pourra plus entrer par ce lien tant qu'un nouveau ne lui est pas envoyé. Aucun email ne part, et ses appareils déjà connectés le restent.`,
        // Rouge : le lien est à recréer (`gesteRouge`).
        definitif: true,
        fait: "Le lien est révoqué.",
      };
    case "inviter":
      return {
        geste,
        libelle: "Envoyer l'invitation",
        bouton: `Envoyer l'invitation à ${p.prenom}`,
        explication: {
          titre: `Envoyer l'invitation à ${nom}`,
          phrases: [
            `${p.prenom} n'est jamais entré(e) dans l'application : un lien personnel neuf${periode} et le parcours d'entrée complet, comme à la création du compte. Rien n'est effacé.`,
            phraseEmails(1),
          ],
        },
        confirmation: texteConfirmationInvitationUnitaire(nom),
        fait: "L'invitation est partie.",
      };
    case "reinitialiser":
      return {
        geste,
        libelle: "Réinitialiser l'accès",
        bouton: `Réinitialiser l'accès ${de(p.prenom)}`,
        explication: {
          titre: `Remettre à zéro l'accès ${de(p.prenom)}`,
          phrases: [
            // On n'énumère que ce qui existe vraiment sur ce compte : annoncer l'effacement d'un mot de
            // passe jamais défini ferait douter de ce que le geste fait.
            `${p.aEffacer.length > 0 ? `Cela efface ${liste(p.aEffacer)}, et déconnecte` : "Cela déconnecte"} tous ses appareils : tout le parcours d'entrée est à refaire. Pour un téléphone perdu et un mot de passe oublié, un retour au club, ou un doute sur le compte.`,
            p.recoitInvitation
              ? `${p.prenom} reçoit aussitôt un lien neuf par email. ${phraseEmails(1)}`
              : "Rien ne partira (pas d'adresse, compte désactivé ou pas inscrit(e) à une période active) : l'accès sera seulement remis à zéro, et c'est « Envoyer le lien » de la carte « Périodes et liens d'accès » qui reprendra la main.",
            "Le compte et tout son historique restent intacts : présences, ateliers, réponses.",
          ],
        },
        confirmation: `Remettre à zéro l'accès de ${nom} ? Mot de passe, double authentification, codes de secours et liens en cours seront effacés, et tous ses appareils déconnectés. Son historique n'est pas touché.`,
        definitif: true,
        fait: "L'accès est remis à zéro.",
      };
    case "desactiver":
      return {
        geste,
        libelle: "Désactiver le compte",
        bouton: `Désactiver le compte ${de(p.prenom)}`,
        explication: {
          titre: `Désactiver le compte ${de(p.prenom)}`,
          phrases: [
            `${p.prenom} perd l'accès immédiatement : appareils déconnectés, lien personnel hors service, plus aucun email. Rien n'est effacé, et « Réactiver le compte » rend l'accès.`,
            ...(p.estAdmin ? ["Du bureau : l'administration du club se referme aussi."] : []),
            AUCUN_EMAIL,
          ],
        },
        confirmation: `Désactiver le compte de ${p.prenom} ? Il ne pourra plus se connecter.`,
        // Rouge : l'accès est retiré, même s'il se rend (`gesteRouge`).
        definitif: true,
        fait: "Le compte est désactivé.",
      };
    case "reactiver":
      return {
        geste,
        libelle: "Réactiver le compte",
        bouton: `Réactiver le compte ${de(p.prenom)}`,
        explication: {
          titre: `Réactiver le compte ${de(p.prenom)}`,
          phrases: [`${p.prenom} retrouve l'accès, et son lien personnel fonctionne de nouveau. Rien n'est effacé.`, AUCUN_EMAIL],
        },
        // Le bouton de la fiche n'en posait pas : réactiver ne coûte rien et se défait d'un geste.
        fait: "Le compte est réactivé.",
      };
    case "supprimer":
      return {
        geste,
        libelle: "Supprimer le compte",
        bouton: `Supprimer ${nom}`,
        explication: {
          titre: `Supprimer définitivement ${nom}`,
          phrases: [
            "C'est irréversible : le compte, ses réponses de présence, ses propositions d'atelier et son historique partent avec.",
            p.reponses === 0
              ? "Aucune réponse de présence ne sera perdue."
              : `${p.reponses} réponse${p.reponses > 1 ? "s" : ""} de présence ${p.reponses > 1 ? "seront perdues" : "sera perdue"}.`,
            ...(p.estAdmin ? ["Du bureau : les droits d'administrateur partent avec le compte."] : []),
            AUCUN_EMAIL,
          ],
        },
        confirmation: `Supprimer définitivement ${nom} et tout son historique ?`,
        definitif: true,
        fait: "Le compte est supprimé.",
      };
  }
}
