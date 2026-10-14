import { minuscule, formatDateSansAnnee } from "@/lib/dates";
import { baseUrl } from "@/lib/env";
import type { ContenuPlanningModifie } from "@/lib/notifications/planning-modifie";
import type { EmailBouton, EmailContenu } from "./layout";

/** Au-delà, un seul bouton « Voir le planning » : une rangée de dix boutons ne se lit plus. */
const BOUTONS_MAX = 3;

/**
 * **Planning modifié** : un instructeur apprend qu'un échauffement, un cours ou une option a été
 * ajouté, modifié ou supprimé — la date de chaque cours touché, puis ce qui a changé, et qui l'a fait. Le texte
 * vient de `contenuPlanningModifie` (`notifications/planning-modifie.ts`), le même que la notification
 * sur le téléphone.
 *
 * Un email **par instructeur**, jamais routé vers la liste du club : il nomme des personnes
 * (`RAISON_ROUTAGE_FIXE.planning_modifie`).
 */
export function emailPlanningModifie(args: { prenom: string; contenu: ContenuPlanningModifie }): { sujet: string; contenu: EmailContenu } {
  const c = args.contenu;
  const paragraphes = [
    c.intro,
    ...c.blocs.map((b) => [`📅 ${b.entete}`, ...b.lignes.map((l) => `• ${l}`)].join("\n")),
    ...(c.reste ? [c.reste] : []),
  ];
  const boutons: EmailBouton[] =
    c.blocs.length > 0 && c.blocs.length <= BOUTONS_MAX && !c.reste
      ? c.blocs.map((b) => ({ label: c.blocs.length === 1 ? "Voir le planning" : `Voir le ${minuscule(formatDateSansAnnee(b.seance.date))}`, url: `${baseUrl()}${b.chemin}` }))
      : [{ label: "Voir le planning", url: `${baseUrl()}${c.chemin}` }];
  return {
    sujet: c.sujet,
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes,
      boutons,
      piedDePage: [
        boutons.length > 1 ? "Si les boutons ne fonctionnent pas, copie ces liens dans ton navigateur :" : "Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :",
        ...boutons.map((b) => b.url),
        "Message automatique envoyé aux instructeurs du club quand un échauffement, un cours ou une option est ajouté, modifié ou supprimé dans le planning d'un cours à venir (jamais à l'auteur du changement). Tu peux le couper dans « Mon profil ».",
      ],
    },
  };
}
