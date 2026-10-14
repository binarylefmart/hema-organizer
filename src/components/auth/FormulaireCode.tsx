"use client";

import { useActionState } from "react";
import { FORM_INITIAL, type FormState } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

type Props = {
  configuration: boolean;
  /** Action de vérification : activation (profil, `/admin/activer`) ou ré-authentification */
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  libelle?: string;
  /**
   * Demander **aussi** le mot de passe courant. Posé partout où l'on **rattache un second facteur**
   * à un compte : le parcours administrateur (`/admin/activer`) comme l'activation depuis « Mon
   * profil ». Le code seul n'y suffit pas — sans le mot de passe, détenir la session de quelqu'un
   * permettait de scanner le QR code avec son propre téléphone et de prendre sa place.
   */
  motDePasse?: boolean;
  /**
   * Demander **aussi** le code d'activation remis de vive voix par un autre membre du bureau
   * (étape 2 de `/admin/activer`, membres du bureau nominatifs) — voir `src/lib/auth/code-activation.ts`.
   */
  codeActivation?: boolean;
};

export function FormulaireCode({ configuration, action: actionVerif, libelle, motDePasse = false, codeActivation = false }: Props) {
  const [state, action] = useActionState(actionVerif, FORM_INITIAL);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      {motDePasse && (
        <Champ
          label="Mon mot de passe"
          name="motDePasse"
          /* `Champ` tire son `id` du `name` quand on ne lui en donne pas. Sur « Mon profil », le
             formulaire de changement de mot de passe porte déjà un champ nommé `motDePasse` : les
             deux `<label for="motDePasse">` désignaient alors le **premier** input de la page, celui
             qui dort replié dans son volet. Cliquer ce libellé mettait le focus dans un champ
             invisible, et un lecteur d'écran n'annonçait aucun libellé pour le champ réellement
             rempli. Le nom envoyé au serveur, lui, ne change pas. */
          id="motDePasse-verification"
          type="password"
          autoComplete="current-password"
          required
          aide="Celui que tu viens de choisir, ou celui que tu utilises déjà."
          erreur={state.erreurs?.motDePasse}
        />
      )}
      {codeActivation && (
        <Champ
          label="Code d'activation (remis par un membre du bureau)"
          name="codeActivation"
          id="codeActivation"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
          required
          className="text-center text-2xl uppercase tracking-[0.2em]"
          aide="6 caractères, par exemple K7P-42M. Valable 48 heures, une seule fois."
          erreur={state.erreurs?.codeActivation}
        />
      )}
      <Champ
        label="Code à 6 chiffres"
        name="code"
        inputMode={configuration ? "numeric" : "text"}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        maxLength={configuration ? 7 : 9}
        required
        autoFocus={!motDePasse}
        className="text-center text-2xl tracking-[0.3em]"
        aide={configuration ? undefined : "Téléphone perdu ? Saisis l'un de tes codes de secours (XXXX-XXXX)."}
        erreur={state.erreurs?.code}
      />
      <BoutonEnvoi taille="grande" pleineLargeur enCours="Vérification…">
        {libelle ?? (configuration ? "Activer" : "Confirmer")}
      </BoutonEnvoi>
    </form>
  );
}
