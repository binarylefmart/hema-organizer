"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Paire } from "./file-envoi";
import { brancherGardeFermeture, cleBrouillon, marquerEnAttente } from "./garde-fermeture";
import { poserEnMasse, type EcritureEnMasse, type EtatBrouillon, type Imposee } from "./brouillon";

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
 * **Deux mains y écrivent** : la case elle-même (`poser`, `oublier`), et la sélection multiple du
 * planning (`poserPlusieurs`, « Régler une partie » sur plusieurs séances). La seconde laisse une trace
 * que la case relit (`imposees`, voir `brouillon.ts`) : sans elle, la barre compterait des cases
 * modifiées que leurs listes déroulantes ne montreraient pas.
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
  /**
   * **Poser plusieurs cases d'un coup, depuis l'extérieur des cases** (la sélection multiple). Une
   * case ramenée à la valeur du serveur sort du brouillon ; chacune reprend la valeur posée.
   * Rend le nombre de cases qui portent désormais une modification.
   */
  poserPlusieurs: (ecritures: readonly EcritureEnMasse[]) => number;
  /** Les cases qui portent une modification pas encore enregistrée. */
  modifiees: ReadonlyMap<string, Paire>;
  /** Les valeurs posées de l'extérieur, que chaque case reprend une fois (`paireImposee`). */
  imposees: ReadonlyMap<string, Imposee>;
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
  const [etat, setEtat] = useState<EtatBrouillon>(() => ({ modifiees: new Map(), imposees: new Map() }));
  /**
   * **Les mêmes clés, en dehors de React** — pour les retirer du registre de la garde de fermeture
   * sans lire l'état dans une mise à jour (une fonction de mise à jour doit rester pure : React peut
   * l'appeler deux fois).
   */
  const clesGardees = useRef<Set<string>>(new Set());
  /** Le numéro de la prochaine écriture venue d'ailleurs : chaque tour se distingue du précédent. */
  const tour = useRef(0);
  /** Le dernier état connu, pour que `poserPlusieurs` calcule hors d'une fonction de mise à jour. */
  const dernier = useRef(etat);
  dernier.current = etat;

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
    marquerEnAttente(cleBrouillon(partieId), true);
    setEtat((avant) => {
      const modifiees = new Map(avant.modifiees);
      modifiees.set(partieId, paire);
      return { ...avant, modifiees };
    });
  }, []);

  const oublier = useCallback((partieId: string) => {
    clesGardees.current.delete(partieId);
    marquerEnAttente(cleBrouillon(partieId), false);
    setEtat((avant) => {
      if (!avant.modifiees.has(partieId)) return avant;
      const modifiees = new Map(avant.modifiees);
      modifiees.delete(partieId);
      return { ...avant, modifiees };
    });
  }, []);

  const poserPlusieurs = useCallback((ecritures: readonly EcritureEnMasse[]) => {
    tour.current += 1;
    // Calculé une fois, hors de la mise à jour : la garde de fermeture est un effet de bord, et une
    // fonction de mise à jour appelée deux fois (mode strict) la toucherait deux fois.
    const suite = poserEnMasse(dernier.current, ecritures, tour.current);
    for (const cle of suite.posees) {
      clesGardees.current.add(cle);
      marquerEnAttente(cleBrouillon(cle), true);
    }
    for (const cle of suite.oubliees) {
      clesGardees.current.delete(cle);
      marquerEnAttente(cleBrouillon(cle), false);
    }
    const prochain = { modifiees: suite.modifiees, imposees: suite.imposees };
    dernier.current = prochain;
    setEtat(prochain);
    return suite.modifiees.size;
  }, []);

  const vider = useCallback(() => {
    // Appliqué : il n'y a plus rien à perdre, et la garde doit se taire tout de suite.
    for (const cle of clesGardees.current) marquerEnAttente(cleBrouillon(cle), false);
    clesGardees.current.clear();
    // Les imposées restent : vider n'impose rien, et les cases n'ont pas à repeindre l'ancien contenu
    // pendant que la page revient du serveur (voir `brouillon.ts`).
    setEtat((avant) => ({ ...avant, modifiees: new Map() }));
  }, []);

  /*
   * **La garde de fermeture est tenue ici, pas par les cases.** Elle l'était par chaque `CaseEditeur`,
   * branchée à son montage et relâchée à son démontage, avec la clé de sa partie. Or un réglage du
   * brouillon survit à sa case : une ligne repliée (« Fermer », sur téléphone), le volet de la
   * sélection multiple qui règle des lignes jamais dépliées, un trimestre replié sur ordinateur. Dans
   * ces trois cas, plus aucune case n'écoutait, et fermer l'onglet perdait le brouillon sans une
   * question. Le brouillon branche donc la garde tant qu'il n'est pas vide, sous ses propres clés
   * (`cleBrouillon`), qu'aucune case ne peut relâcher.
   */
  const aPerdre = etat.modifiees.size > 0;
  useEffect(() => (aPerdre ? brancherGardeFermeture() : undefined), [aPerdre]);
  // Quitter l'adresse jette le brouillon (il n'a jamais touché la base) : ses clés partent avec lui.
  useEffect(() => {
    const cles = clesGardees.current;
    return () => {
      for (const cle of cles) marquerEnAttente(cleBrouillon(cle), false);
      cles.clear();
    };
  }, []);

  const valeur = useMemo<Brouillon>(
    () => ({ poser, poserPlusieurs, modifiees: etat.modifiees, imposees: etat.imposees, oublier, vider }),
    [poser, poserPlusieurs, etat, oublier, vider],
  );
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
