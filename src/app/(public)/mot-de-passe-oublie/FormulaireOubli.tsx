"use client";

import Link from "next/link";
import { useActionState } from "react";
import { demanderReinitialisation } from "@/actions/auth";
import { FORM_INITIAL } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

export function FormulaireOubli() {
  const [state, action] = useActionState(demanderReinitialisation, FORM_INITIAL);
  if (state.succes) {
    return (
      <div className="flex flex-col gap-5">
        <Alerte type="succes" titre="Email envoyé">
          {state.succes}
        </Alerte>
        <Link href="/connexion" className="-ml-2 inline-flex min-h-11 items-center justify-center self-start px-2">
          Retour à la connexion
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      <Champ label="Email" name="email" type="email" autoComplete="email" inputMode="email" required erreur={state.erreurs?.email} />
      <BoutonEnvoi taille="grande" pleineLargeur enCours="Envoi…">
        Recevoir le lien
      </BoutonEnvoi>
      <p className="text-center">
        <Link href="/connexion" className="inline-flex min-h-11 items-center justify-center px-2">
          Retour à la connexion
        </Link>
      </p>
    </form>
  );
}
