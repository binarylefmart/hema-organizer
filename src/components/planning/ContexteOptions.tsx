"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { OptionsCase } from "./options";

/**
 * Source unique des listes du planning côté navigateur.
 *
 * Les cases sont des composants client rendus quatre fois par séance : leur faire porter, chacune,
 * la liste des personnes, des thèmes et des ateliers reviendrait à réécrire les mêmes tableaux
 * à chaque case. Le fournisseur les monte **une fois** par grille ; les cases les lisent d'ici.
 */
const ContexteOptions = createContext<OptionsCase | null>(null);

/**
 * Les entrées des listes déroulantes sont-elles toutes écrites ?
 *
 * Non au premier rendu : le HTML envoyé ne contient que la valeur de chaque case (voir `personnesRendues`),
 * ce qui allège d'autant la page — sur un trimestre, la liste complète serait répétée 280 fois.
 * Oui dès que le navigateur a fini son travail urgent : les listes sont alors complétées en arrière-plan,
 * pour que tout (recherche dans la page, lecteurs d'écran, outils de test) retrouve exactement la même page.
 */
const ContexteListesCompletes = createContext(false);

export function FournisseurOptions({ valeur, children }: { valeur: OptionsCase; children: ReactNode }) {
  const [completes, setCompletes] = useState(false);

  useEffect(() => {
    if (completes || !valeur.modifiable) return;
    const differer = window.requestIdleCallback;
    if (differer) {
      const id = differer(() => setCompletes(true), { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setCompletes(true), 300);
    return () => window.clearTimeout(id);
  }, [completes, valeur.modifiable]);

  return (
    <ContexteOptions.Provider value={valeur}>
      <ContexteListesCompletes.Provider value={completes}>{children}</ContexteListesCompletes.Provider>
    </ContexteOptions.Provider>
  );
}

export function useOptionsCase(): OptionsCase {
  const options = useContext(ContexteOptions);
  if (!options) throw new Error("CaseEditeur doit être rendu dans un FournisseurOptions");
  return options;
}

export function useListesCompletes(): boolean {
  return useContext(ContexteListesCompletes);
}
