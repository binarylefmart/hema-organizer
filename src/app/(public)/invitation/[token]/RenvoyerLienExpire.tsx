"use client";

import { useActionState } from "react";
import Link from "next/link";
import { renvoyerLienExpire } from "@/actions/auth";
import { FORM_INITIAL } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

/**
 * **Un lien expiré propose son remplacement ; il ne l'envoie pas tout seul**.
 *
 * L'écran appelait `renouvelerLien` pendant le rendu du GET, si bien que le préchargement d'un vieil
 * email par une messagerie déclenchait un envoi que personne n'avait demandé. C'est la quatrième fois
 * que ce dossier découpe un lien d'email en « ce que la page montre » et « ce que le bouton fait »,
 * après l'ouverture d'un lien, la désinscription et la réponse de présence.
 *
 * Ce que l'écran ne promet pas : que l'envoi va réussir. Il ne peut pas le savoir sans écrire (période
 * close, fiche sans adresse, renouvellement déjà émis aujourd'hui) — c'est donc la réponse de l'action
 * qui le dit, en toutes lettres et sans faire attendre devant une boîte mail où rien n'arriverait.
 */
export function RenvoyerLienExpire({ token }: { token: string }) {
  const [etat, action] = useActionState(async () => renvoyerLienExpire(token), FORM_INITIAL);
  return (
    <form action={action} className="flex flex-col gap-5">
      {etat.erreur && <Alerte type="erreur">{etat.erreur}</Alerte>}
      {etat.succes && (
        <Alerte type="succes" titre="Regarde ta boîte mail">
          {etat.succes}
        </Alerte>
      )}
      {!etat.succes && (
        <>
          <p>
            Ce lien a expiré : les liens d&apos;accès sont valables 4 mois. L&apos;application peut t&apos;en envoyer un neuf à l&apos;adresse email de ton compte.
          </p>
          <BoutonEnvoi enCours="Envoi…">M&apos;envoyer un nouveau lien</BoutonEnvoi>
        </>
      )}
      <p className="text-sm text-texte-secondaire">
        Tu peux aussi te connecter avec ton mot de passe, si tu t&apos;en es défini un.
      </p>
      <Link href="/connexion" className="-ml-2 inline-flex min-h-12 items-center justify-center self-start px-2 text-sm">
        Aller à la page de connexion
      </Link>
    </form>
  );
}
