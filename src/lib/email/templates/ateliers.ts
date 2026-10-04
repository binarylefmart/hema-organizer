import { baseUrl } from "@/lib/env";
import { formatDateLongue, formatHeure } from "@/lib/dates";
import type { EmailContenu } from "./layout";

type Args = {
  prenom: string;
  titre: string;
  statut: "REFUSE" | "PLANIFIE";
  commentaire?: string | null;
  seance?: { date: string; heureDebut: string; lieu: string } | null;
};

/** Email au membre à chaque changement de statut de son atelier. */
export function emailAtelierStatut(a: Args): { sujet: string; contenu: EmailContenu } {
  const lien = { label: "Voir mes propositions", url: `${baseUrl()}/ateliers` };
  const commentaire = a.commentaire ? [`Commentaire de l'instructeur : « ${a.commentaire} »`] : [];
  if (a.statut === "PLANIFIE" && a.seance) {
    return {
      sujet: `Ton atelier « ${a.titre} » est dans le planning`,
      contenu: {
        titre: `C'est prévu, ${a.prenom} !`,
        paragraphes: [
          `Ton atelier « ${a.titre} » est placé dans le planning le ${formatDateLongue(a.seance.date)} à ${formatHeure(a.seance.heureDebut)} (${a.seance.lieu}).`,
          ...commentaire,
          "Merci pour ta proposition, à très vite sur le pas d'armes.",
        ],
        boutons: [lien],
      },
    };
  }
  return {
    sujet: `Ton atelier « ${a.titre} » n'a pas été retenu`,
    contenu: {
      titre: `Merci pour ta proposition, ${a.prenom}`,
      paragraphes: [
        `Les instructeurs n'ont pas retenu l'atelier « ${a.titre} » pour l'instant.`,
        ...commentaire,
        "N'hésite pas à en proposer un autre, ou à en reparler au prochain cours.",
      ],
      boutons: [lien],
    },
  };
}

/** Email de test (bouton admin). */
export function emailTest(args: { prenom: string; nomApp: string }): { sujet: string; contenu: EmailContenu } {
  return {
    sujet: `Test d'envoi — ${args.nomApp}`,
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: ["Ceci est un email de test envoyé depuis les paramètres d'administration.", "Si tu le lis, la configuration SMTP fonctionne."],
      boutons: [{ label: "Ouvrir l'application", url: baseUrl() }],
    },
  };
}
