"use client";

import { useActionState, useEffect } from "react";
import { changerMotDePasse } from "@/actions/profil";
import { FORM_INITIAL } from "@/lib/form";
import { MOT_DE_PASSE_MIN } from "@/lib/constants";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

/**
 * `apresSucces` : prévenu une fois le mot de passe enregistré. Sert au parcours d'accueil, qui
 * enchaîne alors sur la double authentification — le profil, lui, n'en a pas besoin et reste en place.
 */
export function FormulaireMotDePasse({ aDejaUnMotDePasse, apresSucces }: { aDejaUnMotDePasse: boolean; apresSucces?: () => void }) {
  const [state, action] = useActionState(changerMotDePasse, FORM_INITIAL);
  useEffect(() => {
    if (state.succes) apresSucces?.();
  }, [state.succes, apresSucces]);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
      {aDejaUnMotDePasse && <Champ label="Mot de passe actuel" name="actuel" type="password" autoComplete="current-password" required erreur={state.erreurs?.actuel} />}
      <Champ
        label="Nouveau mot de passe"
        name="motDePasse"
        type="password"
        autoComplete="new-password"
        minLength={MOT_DE_PASSE_MIN}
        required
        aide={`Au moins ${MOT_DE_PASSE_MIN} caractères.`}
        erreur={state.erreurs?.motDePasse}
      />
      <Champ label="Nouveau mot de passe, une deuxième fois" name="confirmation" type="password" autoComplete="new-password" required erreur={state.erreurs?.confirmation} />
      <BoutonEnvoi enCours="Enregistrement…">Enregistrer</BoutonEnvoi>
    </form>
  );
}
