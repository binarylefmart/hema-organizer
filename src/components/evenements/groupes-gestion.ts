/**
 * **La liste de gestion des événements au téléphone, rangée par état** — la partie sans React, donc
 * testable (`ListeEvenementsTelephone`).
 *
 * Ce qui attend un geste passe devant : les brouillons d'abord (« À publier »), puis les annonces
 * que le club voit déjà (« Publiés »). Dans chaque groupe, l'ordre reçu est gardé tel quel — c'est
 * celui des dates, croissant pour « À venir », décroissant pour « Passé » (`evenementsAVenir`,
 * `evenementsPasses`). Un groupe vide ne s'affiche pas : un intitulé sans ligne dessous serait une
 * question sans réponse.
 *
 * Sur ordinateur, rien de cela : le tableau garde une ligne par annonce, dans l'ordre des dates.
 */

export type CleGroupe = "a-publier" | "publies";

export type GroupeEvenements<E> = {
  cle: CleGroupe;
  titre: string;
  evenements: E[];
};

export function groupesParEtat<E extends { publie?: boolean | null }>(liste: readonly E[]): GroupeEvenements<E>[] {
  const groupes: GroupeEvenements<E>[] = [
    // `publie` absent ou faux : c'est un brouillon, comme le dit la pastille de la liste d'ordinateur.
    {
      cle: "a-publier",
      titre: "À publier",
      evenements: liste.filter((e) => !e.publie),
    },
    {
      cle: "publies",
      titre: "Publiés",
      evenements: liste.filter((e) => Boolean(e.publie)),
    },
  ];
  return groupes.filter((g) => g.evenements.length > 0);
}

/**
 * **Le bloc date de la ligne** (style agenda) : le jour de la semaine abrégé et le numéro du jour,
 * « sam. » / « 31 ». Pour une annonce sur plusieurs jours, le premier — la ligne de texte à côté
 * dit la plage entière (`dateEvenementCourte`).
 */
export function blocDate(iso: string): { semaine: string; jour: string } {
  const date = new Date(`${iso}T12:00:00Z`);
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", ...options }).format(date);
  return {
    semaine: format({ weekday: "short" }),
    jour: format({ day: "numeric" }),
  };
}
