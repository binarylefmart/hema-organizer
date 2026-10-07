"use client";

import { createContext, createElement, useContext, useEffect, useSyncExternalStore } from "react";
import { cookieFormatEcran, REQUETE_TELEPHONE, type FormatEcran } from "./ecran";

export { REQUETE_TELEPHONE } from "./ecran";

function abonner(prevenir: () => void): () => void {
  const media = window.matchMedia(REQUETE_TELEPHONE);
  media.addEventListener("change", prevenir);
  return () => media.removeEventListener("change", prevenir);
}

function lireNavigateur(): boolean {
  return window.matchMedia(REQUETE_TELEPHONE).matches;
}

/**
 * **Le format que le serveur a lu dans le cookie** (`null` à la première visite). Posé une fois, par
 * la mise en page racine (`FormatEcranConnu`).
 */
const FormatServeur = createContext<FormatEcran | null>(null);

/** Fournit à tout l'arbre le format lu dans le cookie de la requête. */
export function FormatEcranConnu({ format, children }: { format: FormatEcran | null; children: React.ReactNode }) {
  return createElement(FormatServeur.Provider, { value: format }, children);
}

/**
 * **Retient le format de l'appareil dans le cookie `ecran`**, au premier rendu et à chaque changement
 * (une fenêtre qu'on rétrécit, un écran qu'on branche). Ne dessine rien ; posé une fois, à la racine.
 */
export function MemoireEcran() {
  const telephone = useSyncExternalStore(abonner, lireNavigateur, () => null);
  useEffect(() => {
    if (telephone === null) return;
    document.cookie = cookieFormatEcran(telephone ? "tel" : "ordi", window.location.protocol === "https:");
  }, [telephone]);
  return null;
}

/**
 * **L'écran est-il en version téléphone ?** (règle dans `ecran.ts` : pilotage au doigt, ou fenêtre de
 * moins de 768 px.) Le serveur ne mesure rien : il part du format retenu par le cookie, et de
 * l'ordinateur à la première visite. Le navigateur prend ensuite la main et suit les changements
 * (une fenêtre qu'on rétrécit, un écran externe).
 */
export function useEcranTelephone(): boolean {
  const formatServeur = useContext(FormatServeur);
  return useSyncExternalStore(abonner, lireNavigateur, () => formatServeur === "tel");
}
