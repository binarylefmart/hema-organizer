"use client";

import { useActionState } from "react";
import { regenererCodesSecours, reinitialiserMaDeuxFa } from "@/actions/profil";
import { FORM_INITIAL } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

export function FormulaireDeuxFa({ codesRestants }: { codesRestants: number }) {
  const [state, action] = useActionState(reinitialiserMaDeuxFa, FORM_INITIAL);
  const [etatCodes, actionCodes] = useActionState(regenererCodesSecours, FORM_INITIAL);
  return (
    <div className="flex flex-col gap-6">
      <form action={actionCodes} className="flex flex-col gap-4" noValidate>
        <h3 className="font-semibold">Codes de secours</h3>
        <p className="text-sm text-texte-secondaire">
          {codesRestants > 0 ? `${codesRestants} code${codesRestants > 1 ? "s" : ""} de secours restant${codesRestants > 1 ? "s" : ""}.` : "Plus aucun code de secours : régénère-les."} Chaque code remplace une fois
          le code de l&apos;application si tu perds ton téléphone.
        </p>
        {etatCodes.erreur && <Alerte type="erreur">{etatCodes.erreur}</Alerte>}
        <Champ label="Mot de passe (pour confirmer)" name="motDePasse" id="codes-motDePasse" type="password" autoComplete="current-password" required erreur={etatCodes.erreurs?.motDePasse} />
        <BoutonEnvoi variante="secondaire" enCours="Génération…">
          Régénérer mes codes de secours
        </BoutonEnvoi>
      </form>
      <form action={action} className="flex flex-col gap-4 border-t border-bordure/60 pt-5" noValidate>
        <h3 className="font-semibold">Nouveau téléphone</h3>
        {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
        {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
        <Champ label="Mot de passe (pour confirmer)" name="motDePasse" id="deuxfa-motDePasse" type="password" autoComplete="current-password" required erreur={state.erreurs?.motDePasse} />
        <BoutonEnvoi variante="secondaire" enCours="Réinitialisation…">
          Réinitialiser la double authentification
        </BoutonEnvoi>
      </form>
    </div>
  );
}
