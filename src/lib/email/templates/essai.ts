import { baseUrl } from "@/lib/env";
import type { EmailContenu } from "./layout";

/**
 * **L'email d'essai**, demandé depuis « Mon profil ».
 *
 * Il ne sert qu'à une chose : prouver que la chaîne fonctionne jusqu'à la boîte de la personne —
 * serveur d'envoi, adresse, filtre anti-spam. Il dit donc exactement cela, sans rien annoncer
 * d'autre, et rappelle où se règlent les notifications pour que l'essai serve aussi de rappel.
 *
 * Il reprend le gabarit commun (logo, couleurs du club, version texte) : c'est tout l'intérêt —
 * si celui-ci arrive correctement, les vrais messages arriveront pareil.
 */
export function emailEssai(args: { prenom: string; nomApp: string }): { sujet: string; contenu: EmailContenu } {
  return {
    sujet: `Essai — ${args.nomApp}`,
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: [
        "Cet email est un essai : si tu le lis, les messages du club arrivent bien dans ta boîte.",
        "Rien d'autre à faire. Les rappels de cours, les annulations et les réponses à tes propositions d'atelier emprunteront exactement le même chemin.",
      ],
      boutons: [{ label: "Régler mes notifications", url: `${baseUrl()}/profil` }],
      piedDePage: [
        "Essai demandé depuis « Mon profil ». Si tu n'en es pas à l'origine, quelqu'un utilise peut-être ton accès : préviens un administrateur.",
      ],
    },
  };
}
