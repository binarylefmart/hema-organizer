/**
 * **« Que veux-tu faire ? » pour une proposition d'atelier** — la partie pure, donc testable.
 *
 * Chaque carte de la file alignait jusqu'à trois boutons de familles différentes : « Placer dans le
 * planning » plein, « Refuser » neutre, et, plus bas, « Effacer sans répondre » pour le bureau. Rien
 * ne disait, avant d'appuyer, lequel écrivait au membre, lequel libérait une case du planning, ni
 * lequel faisait disparaître la proposition sans retour. La carte pose désormais la question commune
 * de l'administration (`ChoixGeste`) :
 *
 * - **seulement les gestes que le statut permet** — ceux des transitions de `transitionAutorisee`,
 *   plus l'effacement pour le bureau ; un geste que le serveur refuserait n'est pas proposé ;
 * - chacun **expliqué avant d'agir** : la case du planning, l'email au membre (ou son absence), ce
 *   qui reste et ce qui part ;
 * - **un seul bouton**, au verbe du geste ; rouge pour le seul effacement, qui ne se reprend pas ;
 * - la confirmation qui existait (celle de l'effacement) est **gardée mot pour mot**.
 */

import { AUCUN_EMAIL, type Explication } from "@/components/ui/choix-geste";

/** Les gestes d'une proposition, dans l'ordre où la liste les propose : l'effacement toujours en dernier. */
export const GESTES_ATELIER = ["placer", "retirer", "refuser", "remettre", "effacer"] as const;

export type GesteAtelier = (typeof GESTES_ATELIER)[number];

/** Le statut que chaque décision donne à la proposition (`deciderAtelier`). L'effacement n'en a pas. */
export const STATUT_VISE: Record<Exclude<GesteAtelier, "effacer">, "PLANIFIE" | "PROPOSE" | "REFUSE"> = {
  placer: "PLANIFIE",
  retirer: "PROPOSE",
  refuser: "REFUSE",
  remettre: "PROPOSE",
};

/** Ce que la carte sait de la proposition — rien de plus que ce qu'elle affichait déjà. */
export type PropositionAtelier = {
  titre: string;
  /** Prénom de qui l'a proposée : l'explication le nomme. */
  prenom: string;
  statut: string;
  /** La séance où l'atelier est placé, en toutes lettres (« mardi 6 oct. à 20h00 »), s'il l'est. */
  seancePlacee?: string | null;
};

export type DroitsAtelier = {
  /** Effacer sans répondre : le bureau seul (`ateliers.supprimer`). */
  effacer: boolean;
  /** Au moins une séance à venir où placer l'atelier : sans elle, « Placer » ne peut qu'échouer. */
  seancesDisponibles: boolean;
};

/** Le geste s'applique-t-il à cette proposition ? Mêmes règles que `transitionAutorisee`. */
export function gesteAtelierApplicable(geste: GesteAtelier, p: PropositionAtelier, d: DroitsAtelier): boolean {
  switch (geste) {
    case "placer":
      return p.statut === "PROPOSE" && d.seancesDisponibles;
    case "retirer":
      return p.statut === "PLANIFIE";
    case "refuser":
      return p.statut === "PROPOSE" || p.statut === "PLANIFIE";
    case "remettre":
      return p.statut === "REFUSE";
    case "effacer":
      return d.effacer;
  }
}

/** Les gestes qui écrivent au membre : eux seuls ouvrent la case du mot facultatif. */
export const gesteAvecMot = (geste: GesteAtelier | "") => geste === "placer" || geste === "refuser";

/**
 * **Ouvrir le volet d'un geste, sur téléphone : le mot repart vide.** « Programmer » et « Refuser… »
 * partagent le même champ ; sans cette remise à zéro, un « désolé, pas cette fois » tapé dans le
 * volet du refus, refermé sans décider, partait dans l'email de la programmation.
 */
export function ouvrirVolet(geste: "placer" | "refuser", motGarde = ""): { panneau: "placer" | "refuser"; mot: string } {
  return { panneau: geste, mot: motGarde };
}

/** Un geste de la carte, prêt à proposer. */
export type GesteAtelierOffert = {
  geste: GesteAtelier;
  libelle: string;
  bouton: string;
  explication: Explication;
  confirmation?: string;
  definitif?: boolean;
};

/** La phrase de l'email, la même partout : il part selon l'état du canal et les réglages de la personne. */
const prevenu = (prenom: string) => `${prenom} est prévenu par email et sur son téléphone, selon ses réglages — avec ton mot, si tu en écris un.`;

function decrire(geste: GesteAtelier, p: PropositionAtelier): GesteAtelierOffert {
  const titre = `« ${p.titre} »`;
  const ici = p.seancePlacee ? ` du ${p.seancePlacee}` : "";
  switch (geste) {
    case "placer":
      return {
        geste,
        libelle: "Placer dans le planning",
        bouton: "Placer dans le planning",
        explication: {
          titre: `${titre} prend la première option libre de la séance choisie.`,
          phrases: [
            "S'il n'y en a plus, une option de plus est ajoutée à la séance. L'atelier se lit dans le planning et sur la carte du cours.",
            prevenu(p.prenom),
          ],
        },
      };
    case "retirer":
      return {
        geste,
        libelle: "Retirer du planning",
        bouton: "Retirer du planning",
        // Rouge : la case est libérée, l'atelier est à replacer (`gesteRouge`).
        definitif: true,
        explication: {
          titre: `La case de la séance${ici} est libérée, et ${titre} revient en attente.`,
          phrases: [`${AUCUN_EMAIL} ${p.prenom} n'est pas prévenu : la proposition attend une autre séance.`],
        },
      };
    case "refuser":
      return {
        geste,
        libelle: "Refuser",
        bouton: "Refuser",
        explication: {
          titre: `${titre} passe dans « Refusé ».`,
          phrases: [
            ...(p.statut === "PLANIFIE" ? [`La case de la séance${ici} est libérée.`] : []),
            prevenu(p.prenom),
            "Rien n'est effacé : la proposition pourra être remise en attente.",
          ],
        },
      };
    case "remettre":
      return {
        geste,
        libelle: "Remettre en attente",
        bouton: "Remettre en attente",
        explication: {
          titre: `${titre} revient dans la file « En attente ».`,
          phrases: [`${AUCUN_EMAIL} ${p.prenom} sera prévenu quand la proposition sera placée ou refusée de nouveau.`],
        },
      };
    case "effacer":
      return {
        geste,
        libelle: "Effacer sans répondre",
        bouton: "Effacer la proposition",
        definitif: true,
        explication: {
          titre: `La proposition de ${p.prenom} disparaît, sans réponse.`,
          phrases: [
            ...(p.statut === "PLANIFIE" ? [`La case de la séance${ici} est libérée d'abord.`] : []),
            `${AUCUN_EMAIL} Le journal d'audit garde son titre et son auteur, rien d'autre.`,
            "Pour un doublon ou un envoi par erreur. Pour lui dire non, choisis plutôt « Refuser ».",
          ],
        },
        // La question que la carte posait déjà, mot pour mot.
        confirmation: `Effacer « ${p.titre} » ? La proposition de ${p.prenom} disparaît et personne n'est prévenu — pour lui répondre non, utilise « Refuser ».`,
      };
  }
}

/** **Les gestes proposés pour cette proposition**, avec leurs mots, leur explication et leur confirmation. */
export function gestesAtelier(p: PropositionAtelier, d: DroitsAtelier): GesteAtelierOffert[] {
  return GESTES_ATELIER.filter((g) => gesteAtelierApplicable(g, p, d)).map((g) => decrire(g, p));
}
