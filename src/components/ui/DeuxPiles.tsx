import type { ReactNode } from "react";

/**
 * **Deux piles indépendantes à partir de 1 536 px** — la façon dont ce dépôt occupe un grand écran
 * quand le contenu est une **suite de cartes**, et non un tableau.
 *
 * Né pour « Mon profil », partagé le même jour avec « Thèmes et lieux », « Club », « À propos »,
 * le tableau de bord et la fiche d'une période, quand Delta a demandé le même traitement pour
 * l'espace instructeur et le panel admin. Rien n'a changé dans la géométrie : c'est l'histoire de «
 * Mon profil » qui l'a établie, et elle se lit ci-dessous parce que chacune de ses contraintes a
 * été payée d'un essai raté.
 *
 * « Mon profil » faisait **3 377 px de haut** mesurés à 1 920 px : sept cartes de réglages en une
 * seule colonne de 736 px, soit presque quatre écrans à faire défiler pour atteindre « Sécuriser mon
 * compte » — et, à droite, la moitié de la fenêtre vide. Ce que la largeur sert à faire ici, ce n'est
 * donc **pas** à étirer les cartes (refusé deux fois, le 30/09 « je n'aime pas la manière dont il est
 * allongé en grand écran » et le 01/10), c'est à **monter la seconde moitié de la page à côté de la
 * première**.
 *
 * **Deux piles, et surtout pas une grille.** La grille a existé deux heures et Delta l'a refusée
 * capture en main : « ça fait des trous ». Une grille aligne ses blocs en **rangées**, si bien que
 * deux voisins de hauteurs différentes — ici « Mes notifications » fait **1 633 px** en
 * demi-colonne et « Apparence » 407 — laissent un trou de la hauteur de la différence. Deux
 * colonnes `flex` **indépendantes** n'ont pas ce défaut par construction : chacune empile à son
 * rythme, et la seule chose qui dépasse, c'est la plus longue des deux.
 *
 * **Pourquoi ce composant et pas `DeuxColonnes`.** `DeuxColonnes` sert trois autres écrans, à
 * **un autre palier** (1 280 px) et avec une colonne de côté **étroite** (22 rem) : c'est la géométrie
 * d'un contenu principal accompagné d'un compteur, pas celle de deux piles de réglages de même rang.
 * Ici les deux colonnes sont **égales** (`flex-1`), parce qu'aucune des deux n'accompagne l'autre :
 * à gauche ce qui *arrive* (les notifications), à droite ce qu'on *est* et comment on entre. Et le
 * palier est celui du sommaire et de `PLEINE_LARGEUR_2XL` — 1 536 px, le moment où deux cartes
 * lisibles **plus** le sommaire tiennent côte à côte.
 *
 * **En dessous du palier, rien ne change, et c'est une contrainte dure** : un seul flux, dans l'ordre
 * de la source, qui est **exactement** l'ordre de la page d'avant. C'est aussi pourquoi le découpage
 * s'est fait sur une **coupure** de cette liste et non sur un tri : tout autre partage obligerait à
 * réordonner les cartes sur un téléphone (ou à les réordonner en CSS, ce qui ferait lire au lecteur
 * d'écran un autre ordre que celui de l'œil — défaut que `DeuxColonnes` s'interdit déjà).
 *
 * La largeur, elle, est posée sur la **page** (`PLEINE_LARGEUR_2XL`, ou `PLEINE_LARGEUR` pour les
 * écrans qui s'élargissent dès 1 024 px), jamais sur ce bloc : un
 * élargissement posé sur un morceau de page laisse le titre et les alertes dans la colonne étroite
 * au-dessus d'un contenu large — deux alignements sur le même écran, le défaut du 30/09 sur
 * `/seances` et du 02/10 au matin sur le sommaire des notifications.
 */
export function DeuxPiles({ gauche, droite }: { gauche: ReactNode; droite: ReactNode }) {
  return (
    // `items-start` : chaque pile garde sa propre hauteur. Les étirer ne changerait rien à l'œil
    // (les cartes sont posées en haut), mais ferait croire à une rangée là où il n'y en a pas.
    <div className="flex flex-col gap-6 2xl:flex-row 2xl:items-start">
      {/* `min-w-0` sur les deux : sans lui, un mot long (une adresse email, un nom de navigateur
          dans la liste des appareils) élargit sa colonne et déséquilibre la paire. */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">{gauche}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-6">{droite}</div>
    </div>
  );
}
