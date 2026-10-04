import type { ReactNode } from "react";

/**
 * **Une page large se lit en deux colonnes : ce qu'on vient faire à gauche, ce qui l'accompagne à
 * droite.**
 *
 * Demande de Delta, captures d'un écran de 3 440 px à l'appui : « ça fait des trous, et pour
 * séance et atelier c'est toujours pareil (comme tous les autres menus d'ailleurs), fais-moi une
 * proposition ergonomique ».
 *
 * **Pourquoi deux colonnes, et pas une grille.** La grille essayée plus tôt dans la soirée alignait
 * les tuiles en **rangées** : deux blocs voisins de hauteurs très différentes — la vignette du
 * prochain cours fait 140 px, la frise de fréquentation 330 — laissent alors un trou de la hauteur de
 * la différence, et l'écran se lit comme un affichage cassé. Deux colonnes **indépendantes** n'ont
 * pas ce défaut par construction : chacune empile ses blocs à son rythme, et la seule chose qui
 * dépasse, c'est la plus longue des deux.
 *
 * **Ce qui va à droite** : ce qui accompagne sans être le geste du jour — un compteur, un raccourci,
 * l'annonce du prochain événement, les filtres d'une liste. **Ce qui reste à gauche** : ce pour quoi
 * on a ouvert la page. Si l'on hésite, c'est que le bloc est principal : la colonne de droite n'est
 * pas un débarras.
 *
 * **La largeur, elle, est posée sur la PAGE** ({@link LARGEUR_PAGE}), jamais sur ce bloc — et c'est
 * une leçon déjà payée : un élargissement posé sur un morceau de page laisse le titre et les
 * filtres dans la colonne étroite au-dessus d'un contenu large, soit **deux alignements sur le même
 * écran**.
 *
 * **En dessous de 1 280 px, rien ne change** : un seul flux, dans l'ordre de la source. C'est le même
 * palier que le reste du dépôt (`PLEINE_LARGEUR`), et le même plafond — 90 rem. Au-delà, la page ne
 * s'étire plus : elle se **partage**. Une carte qui s'allonge à 2 000 px a déjà été refusée deux fois
 * (30/09 et 01/10) ; ce composant existe pour que la largeur serve à **montrer plus**, jamais à
 * étirer la même chose.
 *
 * `ordre` dit où le côté se lit **sur un téléphone**, où tout s'empile : `"apres"` pour ce qui
 * complète (l'accueil : on lit son prochain cours avant le compteur de séances restantes), `"avant"`
 * pour ce qui commande la suite (les filtres d'une liste, qui ont toujours été au-dessus d'elle). Le
 * composant pose l'ordre du DOM, et seul l'affichage large le réarrange — un lecteur d'écran lit donc
 * toujours la même chose que l'œil sur un téléphone.
 */
export function DeuxColonnes({
  principal,
  cote,
  ordre = "apres",
}: {
  principal: ReactNode;
  cote: ReactNode;
  ordre?: "avant" | "apres";
}) {
  const colonnePrincipale = (
    <div className={`flex min-w-0 flex-1 flex-col gap-6 ${ordre === "avant" ? "xl:order-1" : ""}`}>{principal}</div>
  );
  /* 22 rem : la largeur d'une carte secondaire lisible — un chiffre et son libellé, un bouton, une
     ligne d'événement. En dessous, les libellés se coupent ; au-dessus, c'est la colonne principale
     qu'on rogne. */
  const colonneCote = (
    <aside className={`flex w-full flex-col gap-6 xl:w-[22rem] xl:shrink-0 ${ordre === "avant" ? "xl:order-2" : ""}`}>{cote}</aside>
  );
  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      {ordre === "avant" ? (
        <>
          {colonneCote}
          {colonnePrincipale}
        </>
      ) : (
        <>
          {colonnePrincipale}
          {colonneCote}
        </>
      )}
    </div>
  );
}

/**
 * **La largeur d'une page qui se lit en deux colonnes**, à poser sur la racine de la page — jamais sur
 * un bloc à l'intérieur (voir {@link DeuxColonnes}).
 *
 * Même palier et même plafond que `PLEINE_LARGEUR` : 1 280 px, 90 rem. Deux largeurs maximales sur le
 * même écran se lisent comme un défaut d'affichage, et le dépôt n'en a donc qu'une.
 */
export const LARGEUR_PAGE = "xl:relative xl:left-1/2 xl:w-[min(calc(100vw-3rem),90rem)] xl:-translate-x-1/2";
