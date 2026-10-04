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
 * **Le minuteur repart à chaque page de l'espace admin, et à chaque geste réel** (clic, toucher,
 * clavier, défilement). Un geste prévient aussi le serveur (`/api/admin/activite`, au plus une fois
 * toutes les {@link INTERVALLE_SIGNAL_MS} ms), qui repousse son échéance comme pour une page : sans
 * cela, cocher des lignes ou faire défiler une liste pendant dix minutes refermait l'espace admin en
 * plein travail. Le minuteur se cale sur le **dernier signal envoyé**, pas sur le dernier geste :
 * c'est l'instant que le serveur connaît, et le minuteur part ainsi un peu en avance, jamais en
 * retard — on referme trop tôt, pas trop tard.
 */
/** Au plus un signal d'activité au serveur toutes les 30 s : assez pour ne jamais le laisser derrière. */
const INTERVALLE_SIGNAL_MS = 30_000;
const GESTES = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

export function SortirApresInactivite() {
  const chemin = usePathname();
  useEffect(() => {
    // Une page de l'espace admin vient d'être servie : le serveur a repoussé son échéance à l'instant.
    let dernierSignal = Date.now();
    let minuteur = 0;
    const armer = () => {
      window.clearTimeout(minuteur);
      minuteur = window.setTimeout(
        () => {
          void fetch("/api/admin/quitter?parti=1", { method: "POST", keepalive: true, cache: "no-store" })
            .catch(() => {})
            .finally(() => window.location.assign(ACCUEIL_ELEVATION_REFERMEE));
        },
        DUREE_INACTIVITE_ELEVATION_MS - (Date.now() - dernierSignal),
      );
    };
    const geste = () => {
      if (Date.now() - dernierSignal < INTERVALLE_SIGNAL_MS) return;
      dernierSignal = Date.now();
      void fetch("/api/admin/activite", { method: "POST", keepalive: true, cache: "no-store" }).catch(() => {});
      armer();
    };
    armer();
    for (const g of GESTES) window.addEventListener(g, geste, { passive: true, capture: true });
    return () => {
      window.clearTimeout(minuteur);
      for (const g of GESTES) window.removeEventListener(g, geste, { capture: true });
    };
  }, [chemin]);
  return null;
}
