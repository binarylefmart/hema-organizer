"use client";

import { useFormStatus } from "react-dom";
import { Bouton } from "./Bouton";
import { SansReponse, useAttenteSurveillee } from "./attente-surveillee";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Bouton>, "type"> & {
  enCours?: string;
  /** Question posée avant l'envoi (window.confirm) : pour les gestes qu'on ne veut pas faire par mégarde */
  confirmation?: string;
};

/**
 * Bouton de soumission qui affiche l'état d'envoi (useFormStatus), avec confirmation facultative.
 *
 * **L'attente est surveillée** (`useAttenteSurveillee`) : `pending` suit la transition du formulaire,
 * et une transition peut rester suspendue alors que le serveur a répondu (défaut du React embarqué
 * par Next 15.5, voir `src/lib/relance-rendu.ts`) ou parce que la requête ne se termine jamais. Tant
 * qu'elle dure, le rendu est relancé ; au-delà d'un délai, l'écran dit que le serveur ne répond pas
 * et propose de recharger, au lieu de laisser « Un instant… » pour toujours. Tous les formulaires
 * de l'application passent par ce bouton, `FormulaireAction` compris.
 */
export function BoutonEnvoi({ children, enCours = "Un instant…", confirmation, onClick, ...props }: Props) {
  const { pending } = useFormStatus();
  const silence = useAttenteSurveillee(pending);
  return (
    <>
      <Bouton
        type="submit"
        disabled={pending}
        aria-busy={pending}
        onClick={(e) => {
          if (confirmation && !window.confirm(confirmation)) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
        {...props}
      >
        {pending ? enCours : children}
      </Bouton>
      {silence && <SansReponse />}
    </>
  );
}
