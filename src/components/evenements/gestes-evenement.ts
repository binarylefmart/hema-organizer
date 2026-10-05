import type { GesteOffert } from "@/components/ui/choix-geste";

/**
 * **Les gestes de l'équipe sur une annonce d'événement**, proposés par « Que veux-tu faire ? »
 * (`GestesEvenement`) — sur la page de l'annonce et sur chaque ligne de `/gestion/evenements`. La
 * partie sans React, donc testable.
 *
 * Ces gestes étaient trois boutons côte à côte (« Modifier », « Publier » / « Dépublier »,
 * « Supprimer »), sans un mot sur ce que chacun fait partir : la phrase qui expliquait la publication
 * vivait sous les boutons de la fiche, et pas du tout dans la liste de gestion. Ils prennent la forme
 * commune de l'administration — une question, seuls les gestes applicables, chacun expliqué avant
 * d'agir, un seul bouton —, et **les confirmations d'avant sont gardées mot pour mot**.
 *
 * - **Modifier** (`evenements.edit`) : le formulaire de l'annonce. Il ne publie rien de lui-même, et
 *   corriger une annonce publiée ne la réannonce pas (`vientDEtrePublie`, côté serveur) ;
 * - **Publier** (`evenements.edit`, brouillon seulement) : le seul geste qui annonce, une fois. Pas de
 *   confirmation, comme avant : c'est le geste qu'on vient faire sur un brouillon ;
 * - **Dépublier** (`evenements.edit`, annonce publiée seulement) : rouge (`VERBES_ROUGES`), et
 *   confirmé — l'annonce quitte la vue des membres et son message est barré sur le salon ;
 * - **Supprimer** (`evenements.creer_supprimer`) : rouge, confirmé, toujours en dernier.
 *
 * Les droits sont ceux des gardes serveur (`publierEvenement` exige `evenements.edit`,
 * `supprimerEvenement` exige `evenements.creer_supprimer`) : l'appelant les lit avec `can()` et les
 * passe tels quels. Un geste que le serveur refuserait n'est pas proposé — un choix qui ne peut
 * qu'échouer est pire qu'un choix absent.
 */
export const GESTES_EVENEMENT = ["modifier", "publier", "depublier", "supprimer"] as const;

export type GesteEvenement = (typeof GESTES_EVENEMENT)[number];

export type GesteEvenementOffert = GesteOffert & { geste: GesteEvenement };

/** Ce que l'écran sait de l'annonce — rien de plus que ce qu'il affichait déjà. */
export type AnnonceGestes = { nom: string; publie: boolean };

/** Ce que la personne connectée peut aboutir : `evenements.edit` et `evenements.creer_supprimer`. */
export type DroitsEvenement = { modifier: boolean; supprimer: boolean };

/** La question d'avant la dépublication — celle des deux anciens boutons, inchangée. */
export const confirmationDepublier = (nom: string) => `Retirer « ${nom} » de la vue des membres ? L'annonce redevient un brouillon.`;

/** La question d'avant la suppression — celle des deux anciens boutons, inchangée. */
export const confirmationSupprimer = (nom: string) => `Supprimer « ${nom} » ? Cette annonce disparaîtra pour tout le monde.`;

export function gestesEvenement({ nom, publie }: AnnonceGestes, droits: DroitsEvenement): GesteEvenementOffert[] {
  const gestes: GesteEvenementOffert[] = [];
  if (droits.modifier) {
    gestes.push({
      geste: "modifier",
      libelle: "Modifier l'annonce",
      bouton: "Modifier l'annonce",
      explication: {
        titre: "Le formulaire de l'annonce s'ouvre.",
        // Ce que la correction fait partir, selon l'état : c'est la question qu'on se pose avant de
        // corriger une annonce que tout le club a déjà reçue.
        phrases: publie
          ? ["Corriger une annonce publiée ne l'annonce pas une seconde fois : seul son message sur Discord est mis à jour."]
          : ["Tant que la case « Publié » reste décochée, l'annonce reste un brouillon connu de la seule équipe."],
      },
      fait: "Ouverture…",
    });
    if (publie) {
      gestes.push({
        geste: "depublier",
        libelle: "Dépublier l'annonce",
        bouton: "Dépublier l'annonce",
        explication: {
          titre: "L'annonce quitte la vue des membres et redevient un brouillon.",
          phrases: ["Son message sur Discord est barré. Rien n'est effacé : elle se republie d'un geste."],
        },
        confirmation: confirmationDepublier(nom),
        definitif: true,
        fait: "Annonce dépubliée : elle redevient un brouillon.",
      });
    } else {
      gestes.push({
        geste: "publier",
        libelle: "Publier l'annonce",
        bouton: "Publier l'annonce",
        explication: {
          titre: "Tout le club la voit, et elle est annoncée une fois.",
          phrases: ["L'annonce part par les canaux réglés dans les notifications (email, téléphone, Discord, Telegram)."],
        },
        fait: "Annonce publiée.",
      });
    }
  }
  if (droits.supprimer) {
    gestes.push({
      geste: "supprimer",
      libelle: "Supprimer l'annonce",
      bouton: "Supprimer l'annonce",
      explication: {
        titre: "L'annonce disparaît pour tout le monde.",
        // Sur une annonce publiée, le geste voisin qui se reprend est nommé : c'est souvent lui qu'on
        // cherchait. Sur un brouillon, il n'existe pas — le proposer en mots serait une fausse piste.
        phrases: publie
          ? ["Son message sur Discord est barré. Rien ne se récupère : pour la retirer seulement de la vue des membres, dépublie-la."]
          : ["Rien ne se récupère."],
      },
      confirmation: confirmationSupprimer(nom),
      definitif: true,
      fait: "Annonce supprimée.",
    });
  }
  return gestes;
}
