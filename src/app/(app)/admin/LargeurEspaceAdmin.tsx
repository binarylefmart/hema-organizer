"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { classeLargeurAdmin } from "./largeurs";

/**
 * **L'enveloppe de l'espace admin, et sa largeur — décidée à chaque navigation, pas une fois pour
 * toutes**.
 *
 * La liste des écrans larges (`ECRANS_LARGES`) était lue dans le **layout**, qui est un composant
 * serveur partagé par tous les écrans d'administration. App Router ne le re-rend **pas** quand on
 * passe d'une page sœur à l'autre : la largeur restait donc figée sur celle de la page chargée « en
 * dur », et la barre d'onglets — qui vit dans ce même layout — est justement le chemin normal pour
 * circuler ici. Mesuré à 1 920 px, dans les deux sens :
 *
 * - arrivé sur « Périodes » (étroit) puis clic sur « Journal d'audit » : conteneur de **736 px au
 *   lieu de 1 440**, le tableau redéfilait dans sa carte avec 1 150 px de marge vide à droite. F5 et
 *   tout rentrait dans l'ordre — donc une même adresse avait deux largeurs selon la façon d'y
 *   arriver ;
 * - arrivé sur « Journal d'audit » (large) puis clic sur « Club » : un **formulaire à 1 440 px**,
 *   avec des champs de 1 400 — exactement ce que la liste refuse en toutes lettres.
 *
 * La preuve n'est pas déduite : le nœud qui porte la classe a été marqué, et il survit à trois clics
 * d'onglets — il n'est jamais recréé.
 *
 * **Ce qui change, c'est le moment de l'évaluation, pas la décision.** La règle vit à un seul
 * endroit — `largeurs.ts`, avec la raison écrite de chaque écran — et ce composant ne fait que la
 * poser au bon moment, parce que `usePathname()` est, lui, réévalué à chaque navigation. Elle y est
 * passée d'une liste de props à une **fonction**, quand les fiches de période sont devenues
 * larges : un identifiant ne se nomme pas dans une liste, et une fonction ne traverse pas la
 * frontière serveur/client. C'est aussi pour ça qu'il ne contient **rien d'autre** : un composant
 * client qui porterait le bandeau d'élévation ou les onglets emporterait avec lui des données de
 * session dans le paquet du navigateur.
 *
 * `usePathname()` rend le chemin **sans la requête** (`?q=…`), donc sans découpage à faire — c'est le
 * second avantage du déplacement.
 */
export function LargeurEspaceAdmin({ children }: { children: ReactNode }) {
  const chemin = usePathname();
  return <div className={`flex flex-col gap-5 ${classeLargeurAdmin(chemin)}`}>{children}</div>;
}
