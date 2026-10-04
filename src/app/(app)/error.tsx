"use client";

import { useEffect } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton, LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/**
 * **La page qui reste quand quelque chose casse.**
 *
 * Sans cette frontière, une action serveur qui *lève* — session expirée, serveur redémarré pendant
 * un déploiement, réseau coupé au mauvais moment — fait disparaître **tout l'écran** : React
 * démonte l'arbre, et il ne reste qu'un fond vide où plus rien ne répond. C'est exactement ce
 * qu'on a vu sur le planning (« la page reste figée, il faut rafraîchir ») ; le correctif de
 * l'éditeur de cases protège le planning, celle-ci protège tous les autres écrans.
 *
 * Deux sorties, parce qu'il y a deux causes : **réessayer** (`reset()` refait le rendu sans
 * recharger, ce qui suffit pour une coupure passagère) et **retourner à l'accueil** (pour une page
 * qui refuse obstinément). Aucun détail technique à l'écran : le message d'erreur d'origine
 * n'apprendrait rien à un membre du club et peut contenir des informations d'infrastructure. Il
 * part dans la console du navigateur, où l'on va le chercher quand on enquête.
 */
export default function ErreurEspaceConnecte({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] écran en erreur", error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Quelque chose s&apos;est mal passé</h1>
      <Alerte type="erreur" titre="Cette page n'a pas pu s'afficher">
        <p>
          Ce n&apos;est pas toi : une requête n&apos;a pas abouti. Réessaie — si ça recommence, ferme puis rouvre l&apos;application, ou préviens un
          administrateur.
        </p>
        {error.digest && <p className="mt-2 text-sm text-texte-secondaire">Référence : {error.digest}</p>}
      </Alerte>
      <div className="flex flex-wrap gap-2">
        <Bouton type="button" onClick={reset}>
          <Icone nom="fleche" taille={20} />
          Réessayer
        </Bouton>
        <LienBouton href="/" variante="secondaire" enCours>
          Retour à l&apos;accueil
        </LienBouton>
      </div>
    </div>
  );
}
