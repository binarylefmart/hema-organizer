"use client";

import { useActionState } from "react";
import { definirMotDePasseAdmin } from "@/actions/auth";
import { FORM_INITIAL } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

/** Étape 1 du réglage de l'accès administrateur : choix du mot de passe (règles du portail). */
export function FormulaireMotDePasseAdmin({ aide }: { aide: string }) {
  const [state, action] = useActionState(definirMotDePasseAdmin, FORM_INITIAL);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      <Champ label="Nouveau mot de passe" name="motDePasse" type="password" autoComplete="new-password" required autoFocus aide={aide} erreur={state.erreurs?.motDePasse} />
      <Champ label="Confirmer le mot de passe" name="confirmation" type="password" autoComplete="new-password" required erreur={state.erreurs?.confirmation} />
      <BoutonEnvoi taille="grande" pleineLargeur enCours="Enregistrement…">
        Enregistrer mon mot de passe
      </BoutonEnvoi>
    </form>
  );
}
