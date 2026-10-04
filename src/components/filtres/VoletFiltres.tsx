import type { ReactNode } from "react";
import { Icone } from "@/components/ui/Icone";

/**
 * **Les filtres, repliés.**
 *
 * Sur l'écran des séances, choisir la saison, la période et la fenêtre de temps occupait trois
 * rangées de commandes — soit la moitié d'un écran de téléphone **avant** le premier cours, alors
 * que les valeurs par défaut (la période en cours, tout le trimestre) conviennent à presque tout
 * le monde, presque tout le temps. Les filtres vivent donc dans un volet fermé, et le résumé du
 * volet dit en une ligne ce qui est appliqué : on voit ce qu'on regarde sans avoir à l'ouvrir.
 *
 * `<details>` natif : pas de JavaScript, pas d'état à gérer, et le volet s'ouvre même si le script
 * de la page n'est pas encore chargé. `ouvert` le laisse déplié quand un filtre inhabituel est en
 * place — sinon on cacherait à quelqu'un la raison pour laquelle sa liste semble incomplète.
 */
export function VoletFiltres({ resume, ouvert = false, children }: { resume: string; ouvert?: boolean; children: ReactNode }) {
  return (
    <details open={ouvert} className="group rounded-xl border border-bordure/60 bg-surface/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-texte-secondaire [&::-webkit-details-marker]:hidden">
        <Icone nom="boussole" taille={18} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-texte">Filtrer</span>
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          {resume}
        </span>
        <Icone nom="chevronBas" taille={18} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 border-t border-bordure/60 px-3 py-3">{children}</div>
    </details>
  );
}
