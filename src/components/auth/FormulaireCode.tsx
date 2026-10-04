"use client";

import { useActionState } from "react";
import { verifierCode2fa } from "@/actions/auth";
import { FORM_INITIAL, type FormState } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

type Props = {
  configuration: boolean;
  annuler?: () => Promise<void>;
  /**
   * Configuration **proposée** et non imposée : ajoute « Plus tard », qui ouvre la session sans rien
   * configurer. Réservé aux comptes à qui la double authentification n'est pas due (jamais un ADMIN).
   */
  passer?: () => Promise<void>;
  /** Action de vérification (par défaut : second temps de la connexion) */
  action?: (prev: FormState, fd: FormData) => Promise<FormState>;
  libelle?: string;
  /**
   * Demander **aussi** le mot de passe courant. Posé partout où l'on **rattache un second facteur**
   * à un compte : le parcours administrateur (`/admin/activer`) comme l'activation depuis « Mon
   * profil ». Le code seul n'y suffit pas — sans le mot de passe, détenir la session de quelqu'un
   * permettait de scanner le QR code avec son propre téléphone et de prendre sa place.
   */
  motDePasse?: boolean;
};

export function FormulaireCode({ configuration, annuler, passer, action: actionVerif = verifierCode2fa, libelle, motDePasse = false }: Props) {
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
        {libelle ?? (configuration ? "Activer et me connecter" : "Se connecter")}
      </BoutonEnvoi>
      {passer && (
        <Bouton type="submit" variante="secondaire" pleineLargeur formAction={passer} formNoValidate>
          Plus tard
        </Bouton>
      )}
      {annuler && (
        <Bouton type="submit" variante="discret" pleineLargeur formAction={annuler} formNoValidate>
          Annuler
        </Bouton>
      )}
    </form>
  );
}
