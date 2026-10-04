"use client";

import Link from "next/link";
import { useActionState } from "react";
import { seConnecterCommeAdmin } from "@/actions/auth";
import { FORM_INITIAL } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

/**
 * **Se connecter en tant qu'administrateur** : les deux preuves d'un coup, sur un seul écran.
 *
 * Pas d'email à saisir — on sait déjà qui est là, la session est ouverte. Ce qu'on demande, c'est
 * de prouver à nouveau que c'est bien *cette personne-là* devant l'appareil : son mot de passe, et
 * le code de son application d'authentification. Les deux ensemble, parce qu'un écran par facteur
 * n'apporterait rien ici : il n'y a pas d'identité à chercher entre les deux, juste une porte.
 */
export function FormulaireAdmin({ suite }: { suite: string }) {
  const [state, action] = useActionState(seConnecterCommeAdmin, FORM_INITIAL);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="suite" value={suite} />
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      <Champ label="Mon mot de passe" name="motDePasse" type="password" autoComplete="current-password" required erreur={state.erreurs?.motDePasse} />
      <Champ
        label="Code à 6 chiffres"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        aide="Celui de ton application d'authentification. Un code de secours fonctionne aussi."
        erreur={state.erreurs?.code}
      />
      <BoutonEnvoi taille="grande" pleineLargeur enCours="Vérification…">
        Ouvrir l&apos;espace admin
      </BoutonEnvoi>
      <p className="text-center">
        <Link href="/profil" className="inline-flex min-h-11 items-center justify-center px-2">
          Rester simple membre pour cette fois
        </Link>
      </p>
    </form>
  );
}
