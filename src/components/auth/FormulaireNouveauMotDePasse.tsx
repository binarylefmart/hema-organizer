"use client";

import { useActionState } from "react";
import { FORM_INITIAL, type FormState } from "@/lib/form";
import { MOT_DE_PASSE_MIN } from "@/lib/constants";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  libelle: string;
  /** Email affiché (non modifiable) au-dessus du mot de passe, pour l'invitation */
  email?: string;
};

/** Formulaire partagé : création (invitation) ou réinitialisation d'un mot de passe. */
export function FormulaireNouveauMotDePasse({ action, libelle, email }: Props) {
  const [state, formAction] = useActionState(action, FORM_INITIAL);
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      {email && <Champ label="Ton email" name="email" type="email" value={email} readOnly disabled autoComplete="username" />}
      <Champ
        label="Mot de passe"
        name="motDePasse"
        type="password"
        autoComplete="new-password"
        minLength={MOT_DE_PASSE_MIN}
        required
        aide={`Au moins ${MOT_DE_PASSE_MIN} caractères. Une phrase facile à retenir fonctionne très bien.`}
        erreur={state.erreurs?.motDePasse}
      />
      <Champ
        label="Le même mot de passe, une deuxième fois"
        name="confirmation"
        type="password"
        autoComplete="new-password"
        required
        erreur={state.erreurs?.confirmation}
      />
      <BoutonEnvoi taille="grande" pleineLargeur enCours="Enregistrement…">
        {libelle}
      </BoutonEnvoi>
    </form>
  );
}
