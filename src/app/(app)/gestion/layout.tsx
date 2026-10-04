import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { BadgeSousNav, SousNav, type Sujet } from "@/components/layout/SousNav";
import { PLEINE_LARGEUR } from "@/components/ui/pleine-largeur";

/**
 * Compteur des propositions d'ateliers en attente.
 *
 * Isolé dans son propre composant — et donc derrière le `<Suspense>` ci-dessous — parce que ce
 * layout est rendu **autour** du `loading.tsx` de chacune de ses pages : tant qu'il attend, aucun
 * écran d'attente ne peut s'afficher. Les onglets partent tout de suite, la pastille les rejoint.
 */
async function BadgeAteliers() {
  const enAttente = await db.atelier.count({ where: { statut: "PROPOSE" } });
  return enAttente > 0 ? <BadgeSousNav>{enAttente}</BadgeSousNav> : null;
}

/**
 * Espace de gestion — l'**organisation** du club, c'est-à-dire ce qu'on fait **dans** le trimestre.
 *
 * **Une seule liste d'onglets, la même pour un admin et pour un instructeur** : Ateliers, Tableau
 * de bord, Événements. Rien n'y est montré à l'un et caché à l'autre — ce qui appartient au bureau
 * ne se grise pas ici, il vit ailleurs (voir le commentaire dans le corps de la fonction).
 *
 * Il n'y a plus d'onglet « Séances » : les séances ont rejoint l'onglet **Séances** de la barre
 * principale, commun à tout le club — l'encadrement y retrouve ses actions au pied de chaque carte,
 * et il n'y a plus deux listes des mêmes cours à tenir à jour. Plus d'onglet « Aperçu » non plus
 * (les chiffres sont sur la page d'accueil, ouverte à tous), ni « Périodes », ni « Membres ». La
 * section s'ouvre donc sur **Ateliers**, et `/gestion` y redirige.
 *
 * L'administration technique n'a **aucune entrée ici** : elle se rejoint depuis « Mon profil »
 * et de là seulement. Elle tient à la personne (mot de passe, double authentification, session
 * forte), pas à la fonction d'encadrement.
 *
 * Les ateliers sont ouverts aux instructeurs : ils modèrent les propositions (`ateliers.moderate`).
 * Les thèmes du planning, eux, ont rejoint l'espace admin. Les **événements** aussi : les annonces
 * sont revenues à l'encadrement entier (`evenements.edit` **et** `evenements.creer_supprimer`). Les
 * notifications, elles, ont rejoint l'espace admin — il n'y a plus d'onglet « Réglages ».
 */
export default async function GestionLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("sessions.manage");
  /*
   * **Ni « Périodes », ni « Membres » ici** : le trimestre et l'annuaire ont rejoint l'espace
   * admin, écrans compris. Ouvrir une période fait partir un email et ouvre un accès de quatre mois
   * à chaque membre ; une fiche porte une adresse, un rôle et un lien personnel. Ce sont des gestes
   * de bureau, ils vivent derrière l'élévation.
   *
   * Reste ici l'organisation courante — ce qu'on fait **dans** le trimestre : les ateliers, le
   * tableau de bord, les annonces. Un instructeur qui veut savoir qui vient à un cours le lit sur
   * la séance elle-même, là où c'est utile.
   */
  const sujets: Sujet[] = [
    // La pastille arrive en différé : le comptage ne doit retarder ni les onglets, ni la page
    { href: "/gestion/ateliers", label: "Ateliers", badge: <Suspense fallback={null}><BadgeAteliers /></Suspense> },
    { href: "/gestion/tableau-de-bord", label: "Tableau de bord" },
    // Les annonces sont revenues à l'encadrement entier : l'instructeur voit donc cet onglet lui aussi.
    { href: "/gestion/evenements", label: "Événements" },
  ];
  /*
   * **La largeur est posée ici, pas sur les pages**. Les trois écrans de cet espace s'élargissent
   * tous — deux tableaux et une file de décision en deux colonnes —, et les autres adresses de
   * `/gestion` ne sont que des redirections vers l'espace admin ou vers `/seances` : une seule
   * largeur suffit donc, et c'est la mise en page qui la porte.
   *
   * **Pourquoi pas sur chaque page, comme c'était fait d'abord :** la sous-navigation vit ici. Posée
   * sur les pages, la largeur laissait la barre d'onglets dans la colonne de lecture **au-dessus**
   * d'un contenu large — mesuré à 1 920 px : contenu de x = 240 à 1 680, onglets de x = 592 à
   * 1 328, soit **352 px de décalage**. C'est exactement le défaut des « deux alignements sur le
   * même écran » que `CLAUDE.md` nomme, et que l'espace admin a résolu ce matin de la même façon.
   */
  return (
    <div className={`flex flex-col gap-5 ${PLEINE_LARGEUR}`}>
      <SousNav sujets={sujets} />
      {children}
    </div>
  );
}
