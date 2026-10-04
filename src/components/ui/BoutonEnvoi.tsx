"use client";

import { useFormStatus } from "react-dom";
import { Bouton } from "./Bouton";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Bouton>, "type"> & {
  enCours?: string;
  /** Question posée avant l'envoi (window.confirm) : pour les gestes qu'on ne veut pas faire par mégarde */
  confirmation?: string;
};

/** Bouton de soumission qui affiche l'état d'envoi (useFormStatus), avec confirmation facultative. */
export function BoutonEnvoi({ children, enCours = "Un instant…", confirmation, onClick, ...props }: Props) {
  const { pending } = useFormStatus();
  return (
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
  );
}
