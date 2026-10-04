"use client";

import { useState, type ReactNode } from "react";
import { Bouton, type Variante } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { devoilement, libelleAfficher, libelleCompteur, LIBELLE_REPLIER, LIGNES_VISIBLES } from "./listes";

/**
 * **Le crochet du dévoilement par tranches**, seul morceau de mécanique de tout le dossier.
 *
 * Il vit ici, avec le composant qui s'en sert, et il est **exporté** pour le seul écran qui ne peut
 * pas monter `ListeRepliee` : le tableau de bord, dont les lignes sont des `<tr>` de tableau et non
 * des `<li>`. Mieux vaut partager le calcul que laisser un deuxième écran réinventer la bascule.
 *
 * Le calcul lui-même est ailleurs ({@link devoilement}, sans React) : c'est lui qui se vérifie
 * ligne à ligne dans les tests, ce crochet ne fait que lui tenir un état.
 *
 * **Ce qui n'est volontairement pas fait** : remettre le compteur au début quand la recherche
 * change. {@link devoilement} borne déjà `demandees` par le total affiché — chercher « mar » dans
 * quatre-vingts noms donne « 4 sur 4 » sans aucun bouton —, et effacer la recherche rend l'écran
 * tel qu'on l'avait laissé plutôt que de le replier dans le dos de qui vient de le déplier.
 */
export function useDevoilement(total: number, { tranche = LIGNES_VISIBLES, debut = tranche }: { tranche?: number; debut?: number } = {}) {
  // Le seul état : combien de lignes on a demandé à voir. Tout le reste s'en déduit.
  const [demandees, setDemandees] = useState(debut);
  const etat = devoilement({ total, demandees, tranche, debut });
  return {
    ...etat,
    /** Une tranche de plus **que ce qui est affiché** : le bouton tient exactement ce qu'il annonce. */
    suivante: () => setDemandees(etat.affichees + tranche),
    /** Retour à la première tranche, et non à la précédente : voir {@link LIBELLE_REPLIER}. */
    revenir: () => setDemandees(debut),
    /**
     * **Tout dévoiler d'un coup**, pour le seul geste qui le demande explicitement : « Déplier et
     * sélectionner les 80 résultats » de la correction en masse (`PresencesEquipe`). Ce n'est pas
     * une porte de sortie du dévoilement par tranches — c'est une action dont le libellé annonce
     * déjà les quatre-vingts lignes, et qui serait absurde à faire quatre fois.
     */
    toutDevoiler: () => setDemandees(total),
  };
}

/**
 * **Le surplus d'une liste empilée, dévoilé vingt par vingt** — le même patron que
 * `SeancesRepliees` pour le planning et que `ListeSeances` pour l'accueil, appliqué cette fois aux
 * listes de personnes et aux listes de cours passés.
 *
 * Quatre choses en font le patron, et pas un simple « voir plus » :
 *
 * - **Aucun bouton tant que tout tient.** `cachees` vide, le composant ne rend rien du tout : un
 *   club de douze retrouve exactement l'écran qu'il avait, sans repli à ouvrir ni compteur à lire.
 *   C'est l'invariant du dossier, et il se vérifie ici même (`cachees.length === 0`).
 * - **Une tranche par appui, pas tout le reste.** « Afficher les 60 autres » échangeait un écran
 *   trop court contre soixante lignes d'un coup. Le bouton annonce désormais ce qu'il va montrer —
 *   « Afficher les 20 suivantes », puis « Afficher les 7 suivantes » sur la dernière tranche.
 * - **Un compteur à côté du bouton** (« 20 sur 80 »), lu à voix haute à chaque appui : dévoiler par
 *   tranches sans dire où l'on en est ne ferait que déplacer la perte de repère.
 * - **« Replier » ramène à vingt**, une fois qu'on a dévoilé quelque chose. C'est le geste rare,
 *   mais le seul qui coûte cher : sans lui, on cherche le haut de la page.
 *
 * Les lignes cachées sont **rendues par le serveur comme les autres** et passées ici en
 * `ReactNode` : rien n'est recalculé ni rechargé au dévoilement, et ce qu'on découvre est exactement
 * ce qu'on aurait eu sans repli. Ce qui change, c'est ce qui est **monté dans le DOM** — là où le
 * problème est le poids réel de la page, il faut couper côté serveur (`take`), pas replier.
 *
 * Le bouton vit dans un `<li>` : ces listes sont des `<ul>`, et un bouton posé à côté des `<li>`
 * en sortirait la structure.
 */
export function ListeRepliee({
  cachees,
  visibles,
  tranche = LIGNES_VISIBLES,
  quoi = "suivantes",
  unite,
  replier = LIBELLE_REPLIER,
  variante = "secondaire",
  className = "pt-1",
}: {
  cachees: ReactNode[];
  /**
   * Combien de lignes la liste montre déjà **au-dessus de ce bouton** (`montrees.length`). Le
   * compteur en a besoin : lui seul connaît le total (« 20 sur 80 »), et c'est aussi là que
   * « Replier » ramène.
   */
  visibles: number;
  /** Ce qu'un appui ajoute. Vingt noms ; l'historique compte des cours et passe sa propre valeur. */
  tranche?: number;
  /** La fin de la phrase du bouton : « Afficher les 20 <quoi> ». */
  quoi?: string;
  /** L'unité du compteur, quand « 40 sur 60 » serait ambigu : « 40 sur 60 cours ». */
  unite?: string;
  replier?: string;
  /** L'allure des deux boutons, pour les listes où un bouton bordé pèserait trop (les puces de la frise). */
  variante?: Variante;
  /** Les marges du `<li>` du bouton : elles suivent celles des lignes de la liste d'accueil. */
  className?: string;
}) {
  const total = visibles + cachees.length;
  const { affichees, restantes, prochaine, auDebut, suivante, revenir } = useDevoilement(total, { tranche, debut: visibles });
  // Tout tient : pas de bouton du tout, donc aucune différence pour un petit club.
  if (cachees.length === 0) return null;
  return (
    <>
      {cachees.slice(0, affichees - visibles)}
      <li className={`list-none ${className}`}>
        <div className="flex flex-wrap items-center gap-2">
          {/* `min-h-12` : « petite » s'arrête à 44 px, et c'est le bouton qu'on appuie plusieurs
              fois de suite pour descendre une liste de quatre-vingts — il mérite ses 48 px. */}
          {restantes > 0 && (
            <Bouton variante={variante} taille="petite" className="min-h-12 flex-1 basis-48" onClick={suivante}>
              <Icone nom="chevronBas" />
              {libelleAfficher(prochaine, quoi)}
            </Bouton>
          )}
          {/* Rien de dévoilé, rien à replier : le second bouton n'apparaît qu'après le premier appui. */}
          {!auDebut && (
            <Bouton variante={variante} taille="petite" className="min-h-12 flex-1 basis-32" onClick={revenir}>
              <Icone nom="chevronHaut" />
              {replier}
            </Bouton>
          )}
          {/* Le compteur est monté **avant** le premier appui : une zone `aria-live` ajoutée en même
              temps que son contenu n'est pas annoncée. Il prend toute la largeur pour rester lisible
              sous les boutons sur un téléphone. */}
          <p aria-live="polite" className="basis-full text-center text-sm tabular-nums text-texte-secondaire">
            {libelleCompteur(affichees, total, unite)}
          </p>
        </div>
      </li>
    </>
  );
}
