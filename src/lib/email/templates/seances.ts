import { formatDateLongue, formatHeure } from "@/lib/dates";
import { baseUrl } from "@/lib/env";
import { seuilEnPersonnes } from "@/lib/presences";
import type { EmailContenu } from "./layout";

/**
 * Emails liés aux séances : alerte « effectif faible » aux instructeurs (avec un lien d'annulation
 * en un geste) et annonce d'annulation à tous les invités.
 */
export type SeanceEmail = { date: string; heureDebut: string; heureFin: string; lieu: string };

function quand(s: SeanceEmail): string {
  return `${formatDateLongue(s.date)} à ${formatHeure(s.heureDebut)} (${s.lieu})`;
}

/**
 * Peu de monde sur une séance à venir : l'instructeur reçoit le détail et peut annuler
 * depuis l'email (lien signé, confirmation demandée sur la page).
 */
/**
 * **Le pied de l'alerte dit la règle, il ne recopie pas un nombre.**
 *
 * Il annonçait « quand une séance proche compte moins de 4 présents » : le 4 était le vieux réglage
 * en nombre absolu, resté écrit en dur dans un texte livré. Un club de 80 invités réglé à 20 % lit
 * sur l'écran Club « 20 % de 80 invités, soit **16** personnes », puis recevait « ⚠️ Peu de monde —
 * 15 présents » avec, sous le bouton « Annuler cette séance », une phrase disant que l'alerte part
 * sous 4 : **l'email se contredisait lui-même**, sur le message qui sert à décider d'ouvrir la salle.
 *
 * Le nombre se **calcule** donc ici, par `seuilEnPersonnes`, depuis la part réglée par le club et
 * l'effectif invité de cette séance-là — exactement le calcul qui a décidé de l'envoi. Sans la part
 * (aperçus, essais d'envoi qui n'ont pas de club en base), la phrase énonce la règle **sans chiffre**
 * plutôt que d'en inventer un.
 */
export function piedAlerteEffectif(invites: number, partEffectifMin?: number): string {
  const regle =
    partEffectifMin === undefined
      ? "reste sous la part minimale d'effectif réglée par le club"
      : `reste sous ${seuilEnPersonnes(partEffectifMin, invites)} personnes (la part minimale d'effectif réglée par le club)`;
  return `Message automatique envoyé aux instructeurs quand l'effectif attendu d'une séance proche ${regle}.`;
}

export function emailEffectifFaible(args: {
  prenom: string;
  seance: SeanceEmail;
  presents: number;
  invites: number;
  sansReponse: number;
  /** Part minimale d'effectif réglée par le club, en pourcentage (`Identite.partEffectifMin`) */
  partEffectifMin?: number;
  urlAnnulation: string;
}): { sujet: string; contenu: EmailContenu } {
  const { seance, presents, invites, sansReponse } = args;
  return {
    sujet: `⚠️ Peu de monde le ${formatDateLongue(seance.date).replace(/^\w/, (c) => c.toLowerCase())} — ${presents} présent${presents > 1 ? "s" : ""}`,
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: [
        `Pour l'instant, ${presents === 0 ? "personne n'a répondu « Présent »" : `${presents} personne${presents > 1 ? "s ont" : " a"} répondu « Présent »`} pour le cours du ${quand(seance)}.`,
        `${invites} invités au total, dont ${sansReponse} sans réponse.`,
        "Si tu préfères annuler, le bouton ci-dessous te mène à une page de confirmation : les membres seront prévenus par email.",
      ],
      boutons: [
        { label: "Annuler cette séance", url: args.urlAnnulation, couleur: "rouge" },
        { label: "Voir le planning", url: `${baseUrl()}/planning` },
      ],
      piedDePage: [
        "Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :",
        args.urlAnnulation,
        piedAlerteEffectif(invites, args.partEffectifMin),
      ],
    },
  };
}

/** Séance annulée : tous les invités sont prévenus, avec la date et le motif. */
export function emailSeanceAnnulee(args: { prenom: string; seance: SeanceEmail; motif: string; nomApp: string }): { sujet: string; contenu: EmailContenu } {
  return {
    sujet: `❌ Cours annulé — ${formatDateLongue(args.seance.date)}`,
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: [
        `Le cours du ${quand(args.seance)} est annulé.`,
        `Motif : ${args.motif}`,
        "Les autres séances de la période ne changent pas : tu peux vérifier tes réponses dans l'application.",
      ],
      boutons: [{ label: "Voir les prochains cours", url: `${baseUrl()}/seances` }],
      piedDePage: [`Message automatique de ${args.nomApp}.`],
    },
  };
}

/* ─────────────────────────── Les mêmes messages, pour la liste ───────────────────────────
 *
 * Voir `src/lib/email/templates/recap.ts` pour la règle générale. Les deux messages ci-dessous
 * perdent le prénom — mais surtout, l'alerte « peu de monde » perd **le lien d'annulation**.
 *
 * Ce lien est un jeton signé qui porte la séance *et* le compte de son destinataire : il vaut
 * signature, il annule un cours sans connexion et fait partir un email à tous les invités. Le poser
 * sur une adresse que plusieurs personnes lisent reviendrait à distribuer cette capacité au groupe,
 * et le journal d'audit désignerait toujours le même coupable — celui dont le compte a signé le
 * jeton. En mode liste, l'annulation se fait donc dans l'application, en deux appuis, par quelqu'un
 * qui s'est identifié. C'est exactement ce que refuse `messageCollectif` (`src/lib/email/liste.ts`)
 * si l'on oubliait un jour cette règle ici.
 */

/** Séance annulée, en **un** message pour la liste du club : la date, le motif, personne à nommer. */
export function emailSeanceAnnuleeListe(args: { seance: SeanceEmail; motif: string; nomApp: string }): { sujet: string; contenu: EmailContenu } {
  return {
    sujet: `❌ Cours annulé — ${formatDateLongue(args.seance.date)}`,
    contenu: {
      titre: "Cours annulé",
      paragraphes: [
        `Le cours du ${quand(args.seance)} est annulé.`,
        `Motif : ${args.motif}`,
        "Les autres séances de la période ne changent pas : chacun peut vérifier ses réponses dans l'application.",
      ],
      boutons: [{ label: "Voir les prochains cours", url: `${baseUrl()}/seances` }],
      piedDePage: [`Message automatique envoyé à la liste du club par ${args.nomApp}.`],
    },
  };
}

