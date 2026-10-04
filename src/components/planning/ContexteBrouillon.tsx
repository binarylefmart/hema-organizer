"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Paire } from "./file-envoi";
import { marquerEnAttente } from "./garde-fermeture";

/**
 * **Le brouillon du mode modification du planning**.
 *
 * **Ce qu'il change, et c'est tout ce qu'il change** : en mode modification, le contenu d'une case ne
 * part plus tout seul (`enregistrerCase`, un aller-retour par réglage) — il s'accumule ici, et un
 * **seul** appel part quand on appuie sur « Appliquer les modifications » (`enregistrerCases`). Sans
 * ce détour, les deux boutons demandés seraient un mensonge : « Appliquer » n'aurait rien à écrire, et
 * la sortie sans écrire rien à jeter, puisque tout serait déjà en base.
 *
 * **Pourquoi un contexte et pas un état dans la grille.** Les cases sont des composants client semés
 * par le serveur, rendus jusqu'à sept fois par séance sur tout un trimestre : leur faire remonter
 * leurs valeurs par des props traverserait toute la grille, qui est un composant **serveur**. Le
 * fournisseur se monte une fois autour des cartes, comme `FournisseurOptions` juste à côté.
 *
 * **Ce qui n'est pas dans le brouillon, et l'écran le dit en toutes lettres** : ajouter, retirer,
 * déplacer une partie, et programmer un atelier dans une case s'enregistrent **tout de suite**. Deux
 * raisons, et la seconde est la vraie : une partie provisoire n'aurait pas d'identifiant (tout le
 * reste du dossier en a besoin — le rangement des rangs, le placement d'un atelier, le journal), et
 * ces quatre gestes sont déjà des décisions à part, confirmées, refusées quand un atelier occupe la
 * case. Promettre qu'« Annuler » les défait serait exactement le genre de promesse que ce dépôt
 * s'interdit ; la barre d'édition l'écrit donc, au lieu de le laisser deviner.
 */
export type Brouillon = {
  /** Poser le contenu voulu d'une case. Remplace ce qui s'y trouvait : seul le dernier état compte. */
  poser: (partieId: string, paire: Paire) => void;
  /** Les cases qui portent une modification pas encore enregistrée. */
  modifiees: ReadonlyMap<string, Paire>;
  /**
   * **Retirer une case du brouillon** — quand elle revient à ce que le serveur porte déjà. C'est la
   * case qui le sait (elle garde `vuDuServeur`), le brouillon ne voyant passer que des états voulus.
   */
  oublier: (partieId: string) => void;
  /** Tout oublier — après une application réussie. La sortie sans écrire, elle, quitte l'adresse. */
  vider: () => void;
};

const ContexteBrouillon = createContext<Brouillon | null>(null);

export function FournisseurBrouillon({ children }: { children: ReactNode }) {
  const [modifiees, setModifiees] = useState<ReadonlyMap<string, Paire>>(() => new Map());
  /**
   * **Les mêmes clés, en dehors de React** — pour les retirer du registre de la garde de fermeture
   * sans lire l'état dans une mise à jour (une fonction de mise à jour doit rester pure : React peut
   * l'appeler deux fois).
   */
  const clesGardees = useRef<Set<string>>(new Set());

  /*
   * **Une case qui revient à ce qu'elle était sort du brouillon**, plutôt que d'y rester comme une
   * modification nulle. Sans ça, régler puis dérégler laisserait « 1 case modifiée » au compteur et
   * une écriture sans objet au serveur — qui la refuserait poliment (« rien à changer »), mais après
   * avoir fait croire à l'écran qu'il enregistrait quelque chose. C'est le serveur qui tranche en
   * dernier (il compare lui aussi), et l'écran n'a pas à mentir en attendant.
   *
   * La comparaison se fait sur la valeur **du serveur**, que la case nous donne : elle est la seule à
   * la connaître, le brouillon ne voyant passer que des états voulus.
   */
  const poser = useCallback((partieId: string, paire: Paire) => {
    /*
     * **Une case modifiée retient la fermeture de l'onglet**. La garde (`garde-fermeture.ts`) ne
     * connaissait que les envois **en vol** : en mode modification il n'y en a plus un seul, si
     * bien que fermer l'onglet sur sept cases réglées les perdait **sans un mot** — alors que le
     * lien « quitter sans appliquer », lui, posait la question. Deux sorties pour le même risque,
     * une seule qui prévenait.
     */
    clesGardees.current.add(partieId);
    marquerEnAttente(partieId, true);
    setModifiees((avant) => {
      const apres = new Map(avant);
      apres.set(partieId, paire);
      return apres;
    });
  }, []);

  const oublier = useCallback((partieId: string) => {
    clesGardees.current.delete(partieId);
    marquerEnAttente(partieId, false);
    setModifiees((avant) => {
      if (!avant.has(partieId)) return avant;
      const apres = new Map(avant);
      apres.delete(partieId);
      return apres;
    });
  }, []);

  const vider = useCallback(() => {
    // Appliqué : il n'y a plus rien à perdre, et la garde doit se taire tout de suite.
    for (const cle of clesGardees.current) marquerEnAttente(cle, false);
    clesGardees.current.clear();
    setModifiees(new Map());
  }, []);

  const valeur = useMemo<Brouillon>(() => ({ poser, modifiees, oublier, vider }), [poser, modifiees, oublier, vider]);
  return <ContexteBrouillon.Provider value={valeur}>{children}</ContexteBrouillon.Provider>;
}

/**
 * Le brouillon s'il existe, `null` sinon — et c'est ce `null` qui dit à une case de s'enregistrer
 * toute seule. La fiche d'une séance (`ProgrammeCases`) n'en monte aucun : on y règle **une** séance,
 * et l'enregistrement immédiat y reste le bon comportement.
 */
export function useBrouillon(): Brouillon | null {
  return useContext(ContexteBrouillon);
}
