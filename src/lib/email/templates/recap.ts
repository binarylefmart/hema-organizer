import type { AttendanceStatut } from "@/lib/constants";
import { formatDateCourte, formatDateLongue, formatHeure } from "@/lib/dates";
import { baseUrl } from "@/lib/env";
import { lignesSeance, themePrincipal, type ChiffresSeance, type SeanceResume } from "@/lib/notifications/contenu";
import { LIBELLE_LIEN_DESINSCRIPTION } from "@/lib/notifications/desinscription";
import { STATUT_LABELS } from "@/lib/presences";
import type { EmailContenu } from "./layout";
import type { Jalon } from "@/lib/notifications/planification";

/**
 * Emails de rappel autour d'une séance :
 * - **récap de la veille** aux membres inscrits Présent ou Peut-être (un email par personne, jamais
 *   de destinataires visibles entre eux — c'est l'appelant qui boucle) ;
 * - **rappel aux personnes sans réponse**, une semaine puis deux jours avant le cours.
 *
 * Les deux reprennent le *contenu commun* de `src/lib/notifications/contenu.ts` (date en toutes
 * lettres, horaire, lieu, thème, chiffres) et portent en pied le lien de désinscription en un clic.
 *
 * Le libellé de ce lien vient de `desinscription.ts` et nomme **les deux canaux** : le lien ne coupe
 * pas que l'email, il coupe aussi les rappels sur le téléphone. Un pied qui disait « par email »
 * promettait ce que le code ne faisait pas.
 */
export type ArgsRecapVeille = {
  prenom: string;
  seance: SeanceResume;
  chiffres: ChiffresSeance;
  /** Réponse actuelle du membre, rappelée dans le message */
  statut: Extract<AttendanceStatut, "PRESENT" | "PEUT_ETRE">;
  urlPresent: string;
  urlAbsent: string;
  urlDesinscription: string;
};

function piedDePage(urlDesinscription: string, phrase: string): string[] {
  return [phrase, `${LIBELLE_LIEN_DESINSCRIPTION} : ${urlDesinscription}`];
}

/** « 🗡️ Rappel : cours demain à 19h30 — Messer » */
export function emailRecapVeille(a: ArgsRecapVeille): { sujet: string; contenu: EmailContenu } {
  // L'objet reste court : le thème principal seulement, l'alternative est dans le corps du message.
  const theme = themePrincipal(a.seance);
  return {
    sujet: `🗡️ Rappel : cours demain à ${formatHeure(a.seance.heureDebut)}${theme ? ` — ${theme}` : ""}`,
    contenu: {
      titre: `Bonjour ${a.prenom},`,
      paragraphes: [
        "C'est demain !",
        lignesSeance(a.seance, a.chiffres).join("\n"),
        `Tu es inscrit(e) : ${STATUT_LABELS[a.statut]}.`,
        "Si ça a changé, un bouton suffit — ta réponse reste modifiable jusqu'au début du cours.",
      ],
      boutons: [
        { label: "Je viens", url: a.urlPresent, couleur: "vert" },
        { label: "Je ne viens plus", url: a.urlAbsent, couleur: "rouge" },
      ],
      piedDePage: piedDePage(a.urlDesinscription, "Message automatique envoyé la veille de chaque cours aux personnes inscrites."),
    },
  };
}

/* ─────────────────────────── Les mêmes messages, pour la liste ───────────────────────────
 *
 * Quand le club règle une notification sur « la liste » (voir `notifications/preferences.ts`), c'est
 * **un autre gabarit** qui part, pas le même avec un autre destinataire. La différence n'est pas
 * cosmétique : tout ce qui s'adresse à *une* personne doit disparaître.
 *
 * Ce qui saute, et pourquoi :
 *
 * - le **prénom** et le tutoiement personnel : on ne dit pas « Bonjour Alix » à quatre-vingts
 *   personnes à la fois ;
 * - « **Tu es inscrit : Présent** » : la liste ne sait pas qui lit ;
 * - les **boutons de réponse** : ils mènent à l'application, qui demandera de toute façon qui
 *   parle — mais surtout, ils n'ont pas de sens dans un message qui n'est adressé à personne ;
 * - le **lien de désinscription** : il porte un jeton signé nominatif. Envoyé sur une liste, il
 *   permettrait à n'importe quel lecteur de désinscrire son porteur. C'est le serveur mail du club
 *   qui gère les départs de la liste, et c'est ce que dit le pied de page.
 *
 * La garde qui interdit le reste est dans `src/lib/email/liste.ts` : aucun message porteur d'un lien
 * personnel ne peut être marqué collectif, donc aucun ne peut atteindre l'adresse de liste.
 */
export type ArgsRecapVeilleListe = {
  seance: SeanceResume;
  chiffres: ChiffresSeance;
  /** Nom court de l'application, pour le pied de page (le gabarit reste pur) */
  nomApp: string;
};

/** Le récap de la veille, en **un** message pour toute la liste du club. */
export function emailRecapVeilleListe(a: ArgsRecapVeilleListe): { sujet: string; contenu: EmailContenu } {
  const theme = themePrincipal(a.seance);
  return {
    sujet: `🗡️ Rappel : cours demain à ${formatHeure(a.seance.heureDebut)}${theme ? ` — ${theme}` : ""}`,
    contenu: {
      titre: "C'est demain !",
      paragraphes: [
        lignesSeance(a.seance, a.chiffres).join("\n"),
        "Chacun peut vérifier ou changer sa réponse dans l'application, jusqu'au début du cours.",
      ],
      boutons: [{ label: "Voir le cours et répondre", url: `${baseUrl()}/seances` }],
      piedDePage: piedDePageListe(a.nomApp, "Message automatique envoyé à la liste du club la veille de chaque cours."),
    },
  };
}

/**
 * Le pied de page d'un message collectif. Il ne propose **pas** de lien de désinscription : il n'y en
 * a pas un par personne, et l'application ne tient pas la liste. Il dit donc la vérité — c'est au
 * bureau qu'on demande à en sortir.
 */
function piedDePageListe(nomApp: string, phrase: string): string[] {
  return [phrase, `Ce message part sur la liste de diffusion du club : pour ne plus le recevoir, demande au bureau de t'en retirer. — ${nomApp}`];
}

export type ArgsRappelSansReponse = {
  prenom: string;
  seance: SeanceResume;
  chiffres: ChiffresSeance;
  /** 7 ou 2 : jours restants avant le cours */
  jours: Jalon;
  urlApp: string;
  urlDesinscription: string;
};

/** Rappel aux invités qui n'ont pas encore répondu (J-7 puis J-2). */
export function emailRappelSansReponse(a: ArgsRappelSansReponse): { sujet: string; contenu: EmailContenu } {
  const delai = a.jours === 7 ? "dans une semaine" : "dans deux jours";
  return {
    sujet: `🗡️ Cours ${delai} (${formatDateCourte(a.seance.date).toLowerCase()}) — tu viens ?`,
    contenu: {
      titre: `Bonjour ${a.prenom},`,
      paragraphes: [
        `Il reste ${a.jours === 7 ? "une semaine" : "deux jours"} avant le cours, et tu n'as pas encore dit si tu venais.`,
        lignesSeance(a.seance, a.chiffres).join("\n"),
        "Un appui suffit : Présent, Absent ou Peut-être. Ça aide l'équipe à préparer le cours (et à ne pas l'annuler pour rien).",
      ],
      boutons: [{ label: "Répondre en un appui", url: a.urlApp }],
      piedDePage: piedDePage(
        a.urlDesinscription,
        `Message automatique envoyé une semaine puis deux jours avant le cours du ${formatDateLongue(a.seance.date).toLowerCase()}.`,
      ),
    },
  };
}

export type ArgsRappelListe = {
  seance: SeanceResume;
  chiffres: ChiffresSeance;
  /** 7 ou 2 : jours restants avant le cours */
  jours: Jalon;
  /** Combien d'invités n'ont pas encore répondu — le message ne nomme personne */
  sansReponse: number;
  nomApp: string;
};

/**
 * **Le rappel change de nature en mode liste.** « Tu n'as pas encore répondu » n'a aucun sens
 * adressé à tout le monde : les trois quarts des lecteurs ont répondu, et celui qui n'a pas répondu
 * ne se reconnaîtra pas plus qu'un autre.
 *
 * Le message devient donc un **compteur** : « 12 personnes n'ont pas encore répondu pour mardi ».
 * Il ne nomme personne — délibérément. Publier la liste des retardataires sur une adresse que tout
 * le club lit serait une forme de mise au pilori, et l'application n'en a pas le droit ; le nom de
 * qui n'a pas répondu se lit dans l'application, par ceux qui encadrent.
 *
 * Si personne ne manque à l'appel, l'appelant n'envoie rien : un rappel qui dit « 0 personne n'a
 * pas répondu » ne rappelle rien du tout (voir `notifications/rappels.ts`).
 */
export function emailRappelListe(a: ArgsRappelListe): { sujet: string; contenu: EmailContenu } {
  const delai = a.jours === 7 ? "dans une semaine" : "dans deux jours";
  const pluriel = a.sansReponse > 1;
  const compteur = `${a.sansReponse} personne${pluriel ? "s" : ""} n'${pluriel ? "ont" : "a"} pas encore répondu pour le cours du ${formatDateCourte(a.seance.date).toLowerCase()}.`;
  return {
    sujet: `🗡️ Cours ${delai} (${formatDateCourte(a.seance.date).toLowerCase()}) — ${a.sansReponse} réponse${pluriel ? "s" : ""} manquante${pluriel ? "s" : ""}`,
    contenu: {
      titre: `Cours ${delai}`,
      paragraphes: [
        compteur,
        lignesSeance(a.seance, a.chiffres).join("\n"),
        "Un appui suffit : Présent, Absent ou Peut-être. Ça aide l'équipe à préparer le cours (et à ne pas l'annuler pour rien).",
      ],
      boutons: [{ label: "Répondre en un appui", url: `${baseUrl()}/seances` }],
      piedDePage: piedDePageListe(
        a.nomApp,
        `Message automatique envoyé à la liste du club une semaine puis deux jours avant le cours du ${formatDateLongue(a.seance.date).toLowerCase()}.`,
      ),
    },
  };
}
