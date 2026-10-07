"use client";

import { useState, useTransition } from "react";

/**
 * **Un geste sur la forme du programme** (ajouter, retirer, déplacer un élément) : un verrou le
 * temps de l'aller-retour, et un message quand le serveur refuse ou ne répond pas. Partagé par la
 * liste de l'ordinateur et celle du téléphone : un refus s'y dit avec les mêmes mots.
 */
export function useActionPartie(): [boolean, (action: () => Promise<{ erreur?: string } | undefined>, apres?: (succes: boolean) => void) => void, string | null] {
  const [, start] = useTransition();
  const [enVol, setEnVol] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // `apres` rend le verdict à l'appelant : le choix de nature montre l'état voulu avant la réponse,
  // et doit savoir quand rendre la main au serveur.
  const lancer = (action: () => Promise<{ erreur?: string } | undefined>, apres?: (succes: boolean) => void) => {
    setErreur(null);
    setEnVol(true);
    start(async () => {
      try {
        const res = await action();
        if (res?.erreur) setErreur(res.erreur);
        apres?.(!res?.erreur);
      } catch {
        setErreur("Action impossible — vérifie ta connexion et recommence.");
        apres?.(false);
      } finally {
        setEnVol(false);
      }
    });
  };
  return [enVol, lancer, erreur];
}
