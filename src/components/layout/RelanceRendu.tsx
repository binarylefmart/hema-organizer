"use client";

import { useEffect, useReducer } from "react";
import { planifier, RELANCES_APRES_REPONSE_MS, reponseQuiPorteUnRendu } from "@/lib/relance-rendu";

/**
 * **Après chaque réponse du serveur, une petite mise à jour d'état** — pour que React retente une
 * transition qu'il aurait laissée suspendue. Le pourquoi est dans `src/lib/relance-rendu.ts`.
 *
 * La fin d'une réponse se lit dans les mesures de performance (`PerformanceObserver`, type
 * `resource`) : l'entrée n'existe qu'une fois le corps **entièrement reçu**, c'est-à-dire quand tous
 * les morceaux de l'arbre sont là et qu'une relance suffit. Rien n'est intercepté ni modifié : on
 * observe, puis on se re-rend soi-même. Sans `PerformanceObserver`, ce composant ne fait rien ; les
 * boutons communs ont leur propre relance (`useAttenteSurveillee`).
 */
export function RelanceRendu() {
  const [, relancer] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let observateur: PerformanceObserver;
    try {
      observateur = new PerformanceObserver((liste) => {
        const utile = liste.getEntries().some((e) => reponseQuiPorteUnRendu(e as PerformanceResourceTiming, window.location.origin));
        if (!utile) return;
        // Pas d'annulation à garder : ce composant vit autant que la page, et une relance qui
        // tomberait après lui ne ferait rien.
        planifier(RELANCES_APRES_REPONSE_MS, relancer);
      });
      observateur.observe({ type: "resource", buffered: false });
    } catch {
      return;
    }
    // Le tampon des mesures est borné (250 entrées par défaut) ; on le vide quand il déborde pour
    // que rien d'autre ne dépende de lui. Les observateurs, eux, reçoivent chaque entrée de toute façon.
    const vider = () => performance.clearResourceTimings();
    performance.addEventListener?.("resourcetimingbufferfull", vider);
    return () => {
      observateur.disconnect();
      performance.removeEventListener?.("resourcetimingbufferfull", vider);
    };
  }, []);
  return null;
}
