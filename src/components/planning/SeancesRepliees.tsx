"use client";

import { useState, type ReactNode } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/**
 * **Le surplus de séances, caché et dépliable** — la grille du planning se comporte enfin comme la
 * liste des séances (`ListeSeances`), demandé par Delta.
 *
 * Un trimestre, c'est une trentaine de cours : ouvert sur « Toute la période », le planning
 * déroulait trente cartes dont on ne lisait que les premières, et il fallait remonter la page pour
 * retrouver les filtres. On en montre **cinq**, puis un bouton qui dit combien il en reste.
 *
 * **Les cartes cachées sont rendues par le serveur comme les autres** et passées ici en `ReactNode` :
 * rien n'est recalculé au dépliage, et le HTML de la page ne change pas de nature selon qu'on a
 * cliqué ou non. Ce qui change, c'est ce qui est monté dans le DOM — donc le temps de rendu d'un
 * trimestre entier de parties éditables.
 *
 * Le bouton de repli, lui, n'existe qu'une fois déplié : replier une liste qu'on vient d'ouvrir est
 * un geste rare, mais chercher le haut de page après avoir déplié trente cartes ne l'est pas.
 *
 * **Du bloc, plus du tableau** : le planning n'a plus de colonnes à traverser (`colSpan`), ses
 * cartes sont posées dans une grille CSS. Le bouton y occupe une rangée entière (`col-span-full`) —
 * il commande toutes les colonnes, il ne peut pas se ranger dans l'une d'elles.
 *
 * **Piloté au besoin** (`tout` + `onBasculer`) : la sélection multiple du mode modification
 * (`SelectionPlanning`) doit **lire** ce qui est déplié — sa case maîtresse ne prend que les cartes
 * affichées, et « Afficher et sélectionner » déplie tout. Deux états pour le même repli finiraient par
 * se contredire ; sans ces deux propriétés, le composant garde son propre état, comme avant.
 */
export function SeancesRepliees({
  cachees,
  restantes,
  tout: toutPilote,
  onBasculer,
}: {
  cachees: ReactNode[];
  restantes: number;
  tout?: boolean;
  onBasculer?: (tout: boolean) => void;
}) {
  const [toutLocal, setToutLocal] = useState(false);
  const tout = toutPilote ?? toutLocal;
  const basculer = onBasculer ?? setToutLocal;
  // Tout tient : pas de bouton du tout. Un « Afficher les 0 autres séances » serait un mensonge.
  if (cachees.length === 0) return null;
  return (
    <>
      {tout && cachees}
      <div className="col-span-full pt-1">
        <Bouton variante="secondaire" pleineLargeur onClick={() => basculer(!tout)}>
          <Icone nom={tout ? "chevronHaut" : "chevronBas"} />
          {tout ? "Replier le trimestre" : `Afficher les ${restantes} autres séances`}
        </Bouton>
      </div>
    </>
  );
}
