import Link from "next/link";
import { HORIZONS, HORIZON_LABELS, HORIZON_LABELS_PASSE, type Horizon } from "@/lib/horizon";

type Props = {
  horizon: Horizon;
  /** Lien de chaque fenêtre (les autres filtres de la page sont conservés par l'appelant) */
  href: (h: Horizon) => string;
  /** Fenêtres tournées vers le passé (tableau de bord) */
  passe?: boolean;
  /** Nombre de séances affichées, rappelé à côté du sélecteur */
  compte?: number;
};

/**
 * Sélecteur de fenêtre de temps, identique sur tous les écrans :
 * Toute la période · 2 mois · 1 mois · 2 semaines · 1 semaine · Prochain cours.
 * Des puces tapables (≥ 44 px) qui passent à la ligne sur téléphone : aucune option cachée.
 */
export function SelecteurHorizon({ horizon, href, passe = false, compte }: Props) {
  const labels = passe ? HORIZON_LABELS_PASSE : HORIZON_LABELS;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <nav aria-label="Fenêtre de temps" className="flex max-w-full flex-wrap gap-1.5">
        {HORIZONS.map((h) => {
          const actif = h === horizon;
          return (
            <Link
              key={h}
              href={href(h)}
              aria-current={actif ? "page" : undefined}
              className={`flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border-2 px-4 text-sm font-semibold no-underline transition ${
                actif ? "border-primaire bg-primaire text-primaire-texte shadow-bouton" : "border-bordure bg-surface text-texte hover:bg-surface-douce"
              }`}
            >
              {labels[h]}
            </Link>
          );
        })}
      </nav>
      {compte !== undefined && (
        <span className="text-sm text-texte-secondaire">
          {compte} cours
        </span>
      )}
    </div>
  );
}
