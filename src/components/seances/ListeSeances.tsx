"use client";

import type { ReactNode } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { couper, libelleAfficher, libelleCompteur, LIBELLE_REPLIER, SEANCES_VISIBLES } from "./listes";
import { useDevoilement } from "./ListeRepliee";

/**
 * Affiche les N premières cartes, puis un bouton pour dévoiler les suivantes.
 *
 * **Une carte par ligne**, et la largeur vient de la page, pas d'ici. Ce que la largeur sert : la
 * liste nominative d'une carte (quatre-vingts noms), la jauge et les trois pastilles de réponses,
 * qui tenaient sur deux lignes dans 700 px. La **hauteur**, elle, reste libre — une séance annulée
 * fait trois lignes, une séance pleine en fait quinze, et les cartes restent alignées sur leurs
 * deux bords.
 *
 * **L'élargissement a quitté ce composant.** Il y était posé sur la seule liste, donc sous le titre
 * et sous les filtres de `/seances`, qui restaient dans la colonne étroite tandis que les cartes
 * faisaient 90 rem : deux alignements sur la même page, et l'onglet Séances qui ne commençait pas
 * au même endroit que l'accueil. Et comme un filtre sans résultat remplace la liste par une alerte
 * — donc par un autre conteneur —, la largeur du contenu sautait d'un filtre à l'autre. Il est
 * maintenant sur la page entière, une seule fois, exactement comme l'accueil
 * (`src/app/(app)/page.tsx`) et le planning (`GrillePlanning`).
 *
 * **Le repli passe par le patron commun** (`couper`, `useDevoilement`, `libelleAfficher`,
 * `LIBELLE_REPLIER` — `src/components/seances/listes.ts`), et ce n'est pas une uniformisation pour
 * le plaisir : c'est la réparation d'un bouton qui annonçait **« Afficher les -2 cours suivants »**.
 * Il tenait son propre `useState(cartes.length <= visibles)`, semé au montage — et les trois onglets
 * « À venir / Passé / Historique » sont la **même route**, donc rien ne remonte ce composant quand on
 * bascule de l'un à l'autre. Vingt-trois cours passés puis trois à venir : l'état disait « tout est
 * déplié », le compte `cartes.length - visibles` valait -2, et le bouton ne faisait rien. Dans
 * l'autre sens, vingt-trois cartes se dépliaient d'un coup sans aucun bouton, alors que la constante
 * en promet cinq.
 *
 * `devoilement` borne ce qui est demandé par ce qui existe **réellement affiché** : c'est lui qui
 * rend le passage d'un onglet à l'autre inoffensif, et il donne au passage les trois choses que ce
 * composant n'avait pas — le bouton qui annonce la tranche qu'il va montrer, « Replier », et le
 * compteur lu à voix haute.
 */
export function ListeSeances({ cartes, visibles = SEANCES_VISIBLES }: { cartes: ReactNode[]; visibles?: number }) {
  const { montrees, cachees } = couper(cartes, visibles);
  // La tranche est du même pas que la coupe — cinq de plus, puis cinq de plus —, et « Replier »
  // ramène aux cinq premières.
  const { affichees, restantes, prochaine, auDebut, suivante, revenir } = useDevoilement(cartes.length, { tranche: visibles, debut: visibles });
  return (
    <div className="flex flex-col gap-4">
      {montrees}
      {cachees.slice(0, Math.max(0, affichees - montrees.length))}
      {/* Tout tient : aucun bouton, aucun compteur, aucune différence pour un petit club. Le bloc est
          monté dès qu'il y a quelque chose à replier, et non au premier appui : une région
          `aria-live` créée en même temps que son texte n'est jamais annoncée. */}
      {cachees.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {restantes > 0 && (
            <Bouton variante="secondaire" className="flex-1 basis-48" onClick={suivante}>
              <Icone nom="chevronBas" />
              {libelleAfficher(prochaine, "cours suivants")}
            </Bouton>
          )}
          {!auDebut && (
            <Bouton variante="secondaire" className="flex-1 basis-32" onClick={revenir}>
              <Icone nom="chevronHaut" />
              {LIBELLE_REPLIER}
            </Bouton>
          )}
          <p aria-live="polite" className="basis-full text-center text-sm tabular-nums text-texte-secondaire">
            {libelleCompteur(affichees, cartes.length, "cours")}
          </p>
        </div>
      )}
    </div>
  );
}
