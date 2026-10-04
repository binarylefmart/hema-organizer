import Link from "next/link";
import { QUANDS, QUAND_LABELS, type Quand } from "./temps";

type Props = {
  quand: Quand;
  /** Lien de chaque position (les autres filtres de la page sont conservés par l'appelant) */
  href: (q: Quand) => string;
};

/**
 * Bascule « À venir / Passé », posée à côté de la fenêtre de temps.
 *
 * Même pilule que la bascule « À venir / Historique » de l'accueil : les deux mots restent lisibles
 * côte à côte — on voit d'un coup d'œil où l'on est *et* ce qu'il y a de l'autre côté, sans mode
 * d'emploi. Position par défaut : « À venir » (le passé ne s'affiche que si on le demande).
 *
 * Ce sont deux **navigations**, pas un interrupteur : donc deux `<Link>` dans un `<nav>` nommé,
 * l'actif marqué par `aria-current="page"` — la même convention que `SelecteurHorizon`, qui se lit
 * correctement au lecteur d'écran là où un `aria-pressed` annoncerait un bouton qui ne presse rien.
 */
export function BasculeTemps({ quand, href }: Props) {
  return (
    <nav aria-label="Séances affichées" className="flex rounded-full border border-bordure bg-surface p-0.5 text-sm font-semibold">
      {QUANDS.map((q) => {
        const actif = q === quand;
        return (
          <Link
            key={q}
            href={href(q)}
            aria-current={actif ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-full px-2.5 no-underline motion-safe:transition-colors sm:px-4 ${
              actif ? "bg-primaire text-primaire-texte" : "text-texte-secondaire"
            }`}
          >
            {QUAND_LABELS[q]}
          </Link>
        );
      })}
    </nav>
  );
}
