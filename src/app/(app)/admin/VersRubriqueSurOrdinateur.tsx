"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { REQUETE_TELEPHONE } from "@/components/ui/useEcranTelephone";

/**
 * **Sur l'ordinateur, `/admin` continue d'ouvrir la première rubrique** ; sur le téléphone, elle
 * montre le menu en liste.
 *
 * Quand le cookie `ecran` dit « ordinateur », la page renvoie déjà côté serveur. Sinon (première
 * visite, ou cookie de téléphone) le serveur rend le menu (masqué en CSS sur ordinateur), et c'est
 * ici, au montage, qu'un ordinateur repart vers la rubrique. `replace` et non `push` : le retour du
 * navigateur ne doit pas ramener sur une page qui renvoie aussitôt ailleurs.
 *
 * L'écran est lu **dans l'effet**, directement, par la même requête que la version téléphone
 * (`REQUETE_TELEPHONE`), et pas par `useEcranTelephone` : à l'hydratation, ce crochet rend d'abord
 * la valeur du serveur, et l'effet qui la lirait pourrait partir vers la rubrique **sur un téléphone
 * aussi**, avant que la vraie valeur n'arrive. Une seule lecture au montage suffit : tourner le
 * téléphone sur le menu ne doit pas l'emmener ailleurs.
 */
export function VersRubriqueSurOrdinateur({ vers }: { vers: string }) {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia(REQUETE_TELEPHONE).matches) return;
    router.replace(vers);
  }, [router, vers]);
  return null;
}
