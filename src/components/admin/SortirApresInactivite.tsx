"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ACCUEIL_ELEVATION_REFERMEE, DUREE_INACTIVITE_ELEVATION_MS } from "@/lib/constants";

/**
 * **L'espace admin laissé ouvert se referme, et ramène à l'accueil.**
 *
 * L'échéance d'inactivité existait déjà côté serveur : après {@link DUREE_INACTIVITE_ELEVATION_MS}
 * sans rien faire ici, l'élévation ne vaut plus rien. Mais elle ne se **constatait** qu'au geste
 * suivant, et ce geste tombait alors sur `/connexion/admin` — une demande de mot de passe et de
 * code, servie à quelqu'un qui venait simplement de reprendre son téléphone. Delta, : « je ne veux
 * pas que ça redemande, je veux que ça retourne à l'accueil déconnecté de l'espace admin ».
 *
 * D'où ce minuteur, qui ne fait que **choisir le moment et la destination** : à l'échéance, il
 * déclare la sortie (le serveur referme pour de bon, comme au retour d'une absence) puis emmène à
 * l'accueil. C'est le même atterrissage que lorsqu'on rouvre l'application après l'avoir quittée :
 * ses prochains cours, avec les droits d'un instructeur, et l'espace admin qui se rouvre d'un mot
 * de passe **quand on en a besoin**, jamais au réveil de l'écran.
 *
 * **Ce composant ne protège rien** — la protection est en base, et elle ne bouge pas. Le pire qu'un
 * navigateur puisse faire en l'ignorant (un minuteur bridé par un onglet en arrière-plan, du
 * JavaScript coupé) est de laisser l'écran affiché : la première requête se heurtera quand même au
 * serveur. On peut donc le poser sans jamais rien lui devoir.
 *
 * **Le minuteur repart à chaque page de l'espace admin** (`usePathname` en dépendance), c'est-à-dire
 * exactement quand `toucherElevation` repousse l'échéance côté serveur : les deux comptent le même
 * temps, à partir du même instant. Une action envoyée sans changer d'URL repousse l'échéance du
 * serveur sans relancer le minuteur — il part alors **en avance**, jamais en retard, et c'est le bon
 * sens de l'erreur : on referme trop tôt, pas trop tard.
 */
export function SortirApresInactivite() {
  const chemin = usePathname();
  useEffect(() => {
    const minuteur = window.setTimeout(() => {
      void fetch("/api/admin/quitter?parti=1", { method: "POST", keepalive: true, cache: "no-store" })
        .catch(() => {})
        .finally(() => window.location.assign(ACCUEIL_ELEVATION_REFERMEE));
    }, DUREE_INACTIVITE_ELEVATION_MS);
    return () => window.clearTimeout(minuteur);
  }, [chemin]);
  return null;
}
