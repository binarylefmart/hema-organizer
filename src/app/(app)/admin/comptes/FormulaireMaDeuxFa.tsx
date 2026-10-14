"use client";

import { useActionState } from "react";
import { regenererMesCodesSecours, reinitialiserMaDeuxFa } from "@/actions/admin";
import { FORM_INITIAL } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { Icone } from "@/components/ui/Icone";

/**
 * **Ma double authentification**, dans « Comptes admin » : régénérer ses codes de secours, et
 * réinitialiser son second facteur pour un nouveau téléphone. Les deux redemandent le mot de passe ;
 * la réinitialisation redemande en plus un code récent, puis ramène au parcours `/admin/activer`.
 *
 * Deux champs « mot de passe » sur le même écran : leurs identifiants sont distincts (`Champ` tire
 * l'identifiant du nom, sauf `id` explicite), sans quoi chaque `<label>` désignerait le premier.
 */
/** Ce que la réinitialisation de sa propre 2FA entraîne, dit avant d'agir. */
const CONFIRMATION_MA_REINITIALISATION = [
  "Réinitialiser ta double authentification ?",
  "",
  "• Ton application de codes et tes codes de secours ne servent plus.",
  "• Tes autres appareils sont déconnectés, et l'espace admin se referme.",
  "• Pour régler le nouveau téléphone, il te faut un code d'activation qu'un autre membre du bureau génère dans Comptes admin et te remet de vive voix : demande-le-lui avant.",
  "• Tu scannes ensuite un nouveau QR code et notes de nouveaux codes de secours : sans eux, tu ne peux pas continuer.",
].join("\n");

export function FormulaireMaDeuxFa({ codesRestants }: { codesRestants: number }) {
  const [etatCodes, actionCodes] = useActionState(regenererMesCodesSecours, FORM_INITIAL);
  const [etatReset, actionReset] = useActionState(reinitialiserMaDeuxFa, FORM_INITIAL);
  return (
    <div className="flex flex-col gap-6">
      <form action={actionCodes} className="flex flex-col gap-4" noValidate>
        <h3 className="font-semibold">Codes de secours</h3>
        <p className="text-sm text-texte-secondaire">
          {codesRestants > 0 ? `${codesRestants} code${codesRestants > 1 ? "s" : ""} de secours restant${codesRestants > 1 ? "s" : ""}.` : "Plus aucun code de secours : régénère-les."} Chaque code
          remplace une fois le code de l&apos;application si tu perds ton téléphone. En régénérer rend les anciens inutilisables.
        </p>
        {etatCodes.erreur && <Alerte type="erreur">{etatCodes.erreur}</Alerte>}
        <Champ label="Mot de passe (pour confirmer)" name="motDePasse" id="codes-motDePasse" type="password" autoComplete="current-password" required erreur={etatCodes.erreurs?.motDePasse} />
        <BoutonEnvoi variante="secondaire" enCours="Génération…">
          Régénérer mes codes de secours
        </BoutonEnvoi>
      </form>
      <form
        action={actionReset}
        onSubmit={(e) => {
          if (!window.confirm(CONFIRMATION_MA_REINITIALISATION)) e.preventDefault();
        }}
        className="flex flex-col gap-4 border-t border-bordure/60 pt-5"
        noValidate
      >
        <h3 className="font-semibold">Nouveau téléphone</h3>
        <p className="text-sm text-texte-secondaire">
          Ta double authentification est retirée et tes autres appareils sont déconnectés. Pour régler le nouveau téléphone, il te faut un code d&apos;activation remis de vive voix par un autre membre du bureau : demande-le avant.
        </p>
        {etatReset.erreur && <Alerte type="erreur">{etatReset.erreur}</Alerte>}
        <Champ label="Mot de passe (pour confirmer)" name="motDePasse" id="deuxfa-motDePasse" type="password" autoComplete="current-password" required erreur={etatReset.erreurs?.motDePasse} />
        <BoutonEnvoi variante="danger" enCours="Réinitialisation…">
          <Icone nom="alerte" taille={18} />
          Réinitialiser ma double authentification
        </BoutonEnvoi>
      </form>
    </div>
  );
}
