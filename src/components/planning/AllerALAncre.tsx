"use client";

import { useEffect } from "react";
import { poserRepere } from "./repere-visuel";

/**
 * **Arriver sur la bonne séance, et pas seulement sur la bonne page.**
 *
 * Le bouton « Programme de la séance » des tuiles (`CarteSeance`) vise une ancre — `#seance-<id>`,
 * posée sur la ligne de la séance dans la grille. Le navigateur, lui, ne sait pas la suivre ici :
 * **la grille arrive après**. Elle est rendue dans un `<Suspense>` (voir `/planning`), si bien
 * qu'au moment où la navigation se termine, la page ne contient encore qu'un squelette et l'ancre
 * n'existe nulle part. Le navigateur cherche, ne trouve rien, et ne réessaie jamais : on atterrit
 * en haut du planning, ce que Delta a constaté — « ça renvoie à la page planning mais pas
 * directement au niveau de la séance qui a été cliquée ».
 *
 * Ce composant est rendu **à l'intérieur de la grille résolue** : il ne se monte donc qu'une fois la
 * ligne visée présente dans le document. Il fait alors ce que le navigateur aurait fait s'il avait
 * pu attendre.
 *
 * **`block: "start"`, et surtout pas `"center"`**. Le défilement a longtemps centré la carte visée,
 * et Delta l'a redit après la v0.53.0 : « ça m'envoie à la bonne date mais au milieu de la tuile,
 * je veux que ça m'amène au début de la tuile correspondante (au niveau de cours 1) ». Ce n'était
 * pas une ancre fausse : **une tuile de planning est plus haute qu'une fenêtre**. Une séance porte
 * ses parties les unes sous les autres, chacune avec ses quatre listes et sa description — environ
 * 320 px par partie sur un écran de 1 280 px, et bien davantage sur un téléphone où les champs
 * s'empilent ; le modèle d'une séance neuve en compte quatre (`PARTIES_MODELE`). Centrer un bloc de
 * 1 400 px dans une fenêtre de 800 px, c'est le couper en deux : on arrive au milieu, vers « Cours
 * 3 ». `"start"` aligne le **haut** de la carte, c'est-à-dire l'en-tête de la séance puis « Cours
 * 1 » — ce qu'on venait lire.
 *
 * Deuxième raison, qui prouve que le centrage était le défaut et pas seulement un goût : la carte
 * porte `scroll-mt-24` *précisément* pour passer sous l'en-tête collant de l'application
 * (`GrillePlanning`, et son commentaire le dit). Or `scroll-margin` ne déplace vraiment le point
 * d'arrivée que lorsqu'on aligne un **bord** : en centrage, la marge haute ne fait que décaler le
 * bloc d'une demi-marge autour du milieu de la fenêtre, et l'en-tête n'a plus rien à voir dans
 * l'affaire. La valeur était donc inerte, et le code documentait une intention qu'il ne tenait pas.
 * Avec `"start"`, les 6 rem de `scroll-mt-24` reprennent leur rôle : la date de la séance se pose
 * juste sous la barre du haut (5 rem), jamais dessous. **Si la hauteur de l'en-tête change, c'est
 * `scroll-mt-24` qu'il faut suivre, pas cette valeur-ci.**
 *
 * **Et il le souligne une poignée de secondes.** Le planning est une grille dense de dates qui se
 * ressemblent ; y être déposé sans rien qui dise « c'est cette ligne-là » laisse chercher des yeux
 * ce qu'on venait justement voir. Le repère s'efface tout seul, et n'est qu'un contour : rien n'est
 * masqué, rien ne bouge, et `prefers-reduced-motion` n'a rien à redire puisqu'il n'y a aucune
 * animation — le défilement lui-même reste celui du navigateur, sans « smooth » imposé. Le contour
 * est posé sur la carte entière : il reste donc visible même quand elle déborde de la fenêtre, son
 * bord haut arrivant avec elle.
 */
export function AllerALAncre() {
  useEffect(() => {
    const cle = window.location.hash.slice(1);
    if (!cle) return;
    let cible: HTMLElement | null = null;
    try {
      cible = document.getElementById(decodeURIComponent(cle));
    } catch {
      // Une ancre mal encodée n'est pas une raison de casser l'écran : on ne va nulle part.
      return;
    }
    if (!cible) return;
    /*
     * **Le défilement et le trait vivent dans `repere-visuel.ts`** : la bascule Cours/Option a le
     * même besoin — montrer une ligne qui vient de se déplacer — et deux écritures de la même
     * mécanique finissent par ne plus souligner de la même façon. Ce qui reste décidé **ici**,
     * parce que cela n'appartient qu'à cette arrivée : `block: "start"`, qui pose la séance en
     * haut, sous l'en-tête collant dont `scroll-mt-24` réserve la hauteur (une tuile de planning
     * est plus haute qu'un écran de téléphone : centrée, elle arrivait coupée des deux côtés).
     */
    return poserRepere(cible, "start");
  }, []);
  return null;
}
