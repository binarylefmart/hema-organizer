"use client";

import { useEffect, useReducer, useState } from "react";
import { DELAI_SANS_REPONSE_MS, MESSAGE_SANS_REPONSE, planifier, RELANCES_PENDANT_ATTENTE_MS } from "@/lib/relance-rendu";

/**
 * **Une attente qu'on surveille** : tant que `actif` reste vrai, relance le rendu à intervalles
 * croissants (voir `src/lib/relance-rendu.ts`), et passe `silence` à vrai au bout de
 * {@link DELAI_SANS_REPONSE_MS} — l'écran peut alors dire que le serveur ne répond pas et proposer
 * de recharger, au lieu d'un bouton figé sur « Un instant… ».
 *
 * Les relances et l'alerte sont posées par des minuteurs, donc **hors de toute transition** : elles
 * s'affichent même quand la transition de l'action, elle, est coincée.
 */
export function useAttenteSurveillee(actif: boolean): boolean {
  const [, relancer] = useReducer((n: number) => n + 1, 0);
  const [silence, setSilence] = useState(false);
  useEffect(() => {
    if (!actif) {
      setSilence(false);
      return;
    }
    const annulerRelances = planifier(RELANCES_PENDANT_ATTENTE_MS, relancer);
    const annulerSilence = planifier([DELAI_SANS_REPONSE_MS], () => setSilence(true));
    return () => {
      annulerRelances();
      annulerSilence();
    };
  }, [actif]);
  return actif && silence;
}

/** Le message d'une attente sans réponse, avec de quoi recharger la page. */
export function SansReponse() {
  return (
    <span role="alert" className="flex max-w-prose flex-col items-start gap-1 text-sm font-semibold text-rouge">
      {MESSAGE_SANS_REPONSE}
      <button type="button" className="underline underline-offset-2" onClick={() => window.location.reload()}>
        Recharger la page
      </button>
    </span>
  );
}
