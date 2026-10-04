import type { ReactNode } from "react";

/**
 * **Le sommaire d'une page longue : savoir où l'on est, et y aller d'un clic.**
 *
 * Demande de. « Mon profil » et les notifications du club ne sont ni des tableaux (rien à ranger en
 * colonnes) ni des écrans de cartes (aucun bloc à mettre dans une seconde colonne) : ce sont des
 * **piles de réglages** de deux à trois écrans de haut. Ce que la largeur leur apporte n'est donc
 * pas un contenu de plus, c'est un repère.
 *
 * **Le sommaire est une colonne de droite, et la journée en a fait deux fois autre chose avant d'y
 * arriver.** L'histoire mérite d'être écrite, parce que chacune des deux formes abandonnées avait
 * l'air juste :
 *
 * 1. **une paire recentrée dans une page élargie.** Capture à 3 440 px : le titre « Notifications »
 *    s'est retrouvé **190 px à gauche de sa propre barre d'onglets** — le bandeau d'élévation et la
 *    sous-navigation vivent dans la mise en page de l'espace admin, donc dans la colonne de lecture
 *    que la page venait de quitter. Deux alignements sur le même écran, pour la troisième fois en
 *    trois jours ;
 * 2. **un bloc posé en absolu dans la MARGE** (`left-full`), qui ne déplaçait rien du tout. Elle a
 *    servi une demi-journée, et elle supposait qu'il y ait une marge : or les deux seuls écrans qui
 *    portent un sommaire sont **larges** — `/admin/notifications` est entré dans `ECRANS_LARGES` le
 *    matin même, et `/profil` a pris `PLEINE_LARGEUR_2XL` l'après-midi. Posé dans la marge d'une page
 *    qui n'en a plus, il dépassait **du document** : 2 024 px de contenu pour une fenêtre de 1 920,
 *    donc une barre de défilement horizontale sur tout l'écran, pour une navigation qui vivait
 *    dehors. La géométrie de la marge est dans l'historique (`097bf6d`), avec la raison de son
 *    départ : la garder « au cas où » aurait été une seconde mise en page qu'aucun écran n'exerce.
 *
 * **Il n'apparaît qu'à partir de 1 536 px** (`2xl`), le palier de `PLEINE_LARGEUR_2XL` : c'est là que
 * la place existe à côté sans rogner la colonne de lecture. En dessous, il **n'existe pas** — pas
 * « repoussé en bas de page » : sept liens avant le premier réglage, sur un téléphone, c'est un écran
 * de sommaire pour une page qu'on parcourt au pouce (leçon de la barre d'action inerte du 01/10 :
 * « rends cette tuile visible uniquement si quelqu'un est coché »). Et c'est la seule exception
 * assumée à « une seule mise en page, quelle que soit la largeur » : ce qui disparaît ici n'est **pas
 * du contenu**, c'est un raccourci vers du contenu qui reste entier au-dessous.
 *
 * **Trois règles le tiennent honnête** :
 *
 * 1. **chaque entrée porte le titre exact de sa section.** Un sommaire qui rebaptise ce qu'il annonce
 *    fait chercher deux fois ;
 * 2. **il ne dit rien que la page ne dise** — d'où le droit de disparaître ;
 * 3. **ce sont des liens d'ancre, pas une mécanique.** Aucun JavaScript, donc rien à synchroniser avec
 *    le défilement : un surlignage « section courante » demanderait un composant client et un
 *    observateur d'intersection pour redire ce que le titre atteint montre déjà.
 *
 * Le `scroll-mt-20` des sections visées est posé par `Carte` dès qu'elle reçoit un `id` (et à la main
 * pour celles qui n'en sont pas une) : sans lui, l'en-tête collant de l'application recouvre le titre
 * qu'on vient d'atteindre.
 */
export type SectionSommaire = {
  /** L'`id` de la section visée, sans croisillon. */
  ancre: string;
  /** Le **titre de la section**, mot pour mot. */
  titre: string;
};

/**
 * La page, et son sommaire en colonne de droite. Le sommaire se lit **avant** la page dans le DOM :
 * il l'annonce, et seul l'affichage le renvoie à droite.
 *
 * `enTete` est ce qui se lit **au-dessus du sommaire** : ce qui n'est ni une section de la page ni
 * du sommaire — un état, un chiffre. Il suit le sommaire dans la colonne, et disparaît avec lui. Il
 * ne porte **pas de titre de section** : la colonne se lisant avant la page, un `<h2>` y passerait
 * devant le seul `<h1>` de l'écran.
 */
export function PageAvecSommaire({
  sections,
  children,
  enTete,
}: {
  sections: SectionSommaire[];
  children: ReactNode;
  enTete?: ReactNode;
}) {
  return (
    // Pas d'`items-start` sur la rangée : la colonne du sommaire doit **s'étirer** sur la hauteur
    // de la page, sinon le `sticky` qu'elle contient n'a aucune course à faire. Et rien d'enveloppé
    // entre elle et son contenu — un bloc intermédiaire dont la hauteur épouse son contenu devient
    // le bloc conteneur du `sticky`, qui suit alors le défilement comme n'importe quel bloc.
    <div className="flex flex-col gap-6 2xl:flex-row">
      {/* **Le sommaire s'affiche à droite** : il a été montré et validé là, et un repère qui change
          de bord d'un écran à l'autre n'est plus un repère. Seul l'affichage réordonne (`order`), la
          source non : c'est la règle que `DeuxColonnes` s'est déjà donnée par écrit. */}
      <aside className="hidden w-80 shrink-0 flex-col gap-6 2xl:order-2 2xl:flex">
        {enTete}
        <nav aria-label="Sections de cette page" className="sticky top-20 rounded-2xl border border-bordure/60 bg-surface p-3 shadow-carte">
          <p className="px-2 pb-1 text-sm font-semibold uppercase tracking-wide text-texte-secondaire">Sur cette page</p>
          <ul className="flex flex-col">
            {sections.map((section) => (
              <li key={section.ancre}>
                <a
                  href={`#${section.ancre}`}
                  className="flex min-h-11 items-center rounded-xl px-2 py-1 text-lien hover:bg-surface-douce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jauge"
                >
                  {section.titre}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-6 2xl:order-1">{children}</div>
    </div>
  );
}
