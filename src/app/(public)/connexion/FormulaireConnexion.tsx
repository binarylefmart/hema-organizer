"use client";

import Link from "next/link";
import { useActionState } from "react";
import { seConnecter } from "@/actions/auth";
import { FORM_INITIAL } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Case, Champ } from "@/components/ui/Champ";

/** Connexion classique (facultative) : pour tout compte qui s'est défini un mot de passe, quel que soit son rôle. */
export function FormulaireConnexion({ suite }: { suite: string }) {
  const [state, action] = useActionState(seConnecter, FORM_INITIAL);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="suite" value={suite} />
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      <Champ
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        erreur={state.erreurs?.email}
      />
      <Champ
        label="Mot de passe"
        name="motDePasse"
        type="password"
        autoComplete="current-password"
        required
        erreur={state.erreurs?.motDePasse}
      />
      {/* Depuis une session dure 12 h, cochée ou non : cette case ne décide plus que de la survie
          du cookie à la fermeture du navigateur. Le libellé le dit, plutôt que de promettre de
          « rester connecté » à quelqu'un qui se reconnectera demain matin. */}
      <Case label="Garder ma session à la fermeture du navigateur" name="resterConnecte" defaultChecked />
      <BoutonEnvoi taille="grande" pleineLargeur enCours="Connexion…">
        Se connecter
      </BoutonEnvoi>
      <p className="text-center">
        <Link href="/mot-de-passe-oublie" className="inline-flex min-h-11 items-center justify-center px-2">
          Mot de passe oublié ?
        </Link>
      </p>
    </form>
  );
}
