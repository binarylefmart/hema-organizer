import type { GesteOffert } from "@/components/ui/choix-geste";

/**
 * **Les gestes d'organisation d'une séance**, proposés par « Que veux-tu faire ? » (`GestesSeance`)
 * — la partie sans React, donc testable.
 *
 * - **Ouvrir la séance** (depuis la liste) : la fiche, directement en mode modification ;
 * - **Annuler** : jamais une séance commencée — on ne prévient pas les gens pendant qu'ils sont dans
 *   la salle. C'est elle qui fait partir l'annonce à tout le club : rouge, et confirmée ;
 * - **Rétablir** : une séance annulée, pas encore commencée ;
 * - **Supprimer** : le bureau seulement (l'appelant le décide), avec les réponses des membres.
 */
export type GesteSeance = "ouvrir" | "annuler" | "retablir" | "supprimer";

export type GesteSeanceOffert = GesteOffert & { geste: GesteSeance };

/**
 * **Quand une séance s'annule, et quand elle se rétablit** — écrit une seule fois, lu par trois
 * portes : la liste de « Que veux-tu faire ? » d'une carte (ci-dessous), le choix d'un lot
 * (`selection-seances.ts`) et le serveur (`annulerSeance`, `retablirSeance`,
 * `appliquerGesteSeancesEnMasse`). Si l'écran et le serveur tenaient chacun leur version, l'un finirait
 * par proposer ce que l'autre refuse — ou par laisser passer, sur un appel forgé, ce que l'écran cache.
 *
 * Une séance **commencée** ne s'annule pas : on ne prévient pas les gens pendant qu'ils sont dans la
 * salle. Elle ne se rétablit pas non plus : un cours qui a eu lieu sans personne ne redevient pas un
 * cours prévu.
 */
export function seanceAnnulable({ annulee, passee }: { annulee: boolean; passee: boolean }): boolean {
  return !passee && !annulee;
}

export function seanceRetablissable({ annulee, passee }: { annulee: boolean; passee: boolean }): boolean {
  return !passee && annulee;
}

export function gestesSeance({
  annulee,
  passee,
  ouvrir,
  supprimer,
}: {
  annulee: boolean;
  passee: boolean;
  ouvrir: boolean;
  supprimer: boolean;
}): GesteSeanceOffert[] {
  const gestes: GesteSeanceOffert[] = [];
  if (ouvrir) {
    gestes.push({
      geste: "ouvrir",
      libelle: "Modifier la séance",
      bouton: "Ouvrir la séance",
      explication: {
        titre: "La fiche de la séance s'ouvre en mode modification.",
        phrases: ["Date, horaire et lieu s'y règlent ; le programme, dans le planning."],
      },
      fait: "Ouverture…",
    });
  }
  if (seanceAnnulable({ annulee, passee })) {
    gestes.push({
      geste: "annuler",
      libelle: "Annuler la séance",
      bouton: "Annuler la séance",
      explication: {
        titre: "Tout le club est prévenu tout de suite.",
        phrases: [
          "Un email part aux invités, et l'annonce aux salons du club, avec le motif.",
          "Une séance annulée se rétablit tant qu'elle n'a pas commencé.",
        ],
      },
      confirmation: "Annuler cette séance ? Tout le club sera prévenu.",
      definitif: true,
      fait: "Séance annulée.",
    });
  }
  if (seanceRetablissable({ annulee, passee })) {
    gestes.push({
      geste: "retablir",
      libelle: "Rétablir la séance",
      bouton: "Rétablir la séance",
      explication: {
        titre: "La séance redevient un cours prévu.",
        phrases: ["Les réponses déjà données sont gardées."],
      },
      confirmation: "Rétablir cette séance ?",
      fait: "Séance rétablie.",
    });
  }
  if (supprimer) {
    gestes.push({
      geste: "supprimer",
      libelle: "Supprimer la séance",
      bouton: "Supprimer la séance",
      explication: {
        titre: "La séance disparaît, avec toutes les réponses des membres.",
        phrases: ["Rien ne se récupère. Aucun email ne part."],
      },
      confirmation: "Supprimer définitivement cette séance et ses réponses ?",
      definitif: true,
      fait: "Séance supprimée.",
    });
  }
  return gestes;
}
