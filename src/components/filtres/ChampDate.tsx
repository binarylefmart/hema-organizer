"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Icone } from "@/components/ui/Icone";
import { lienTemps, lireDateFiltre, PARAM_DATE } from "./temps";

type Props = {
  /** La date cherchée, si l'écran en affiche une (format ISO `AAAA-MM-JJ`). */
  valeur?: string;
  /** Page à rouvrir : un composant client ne peut pas recevoir de fonction depuis le serveur. */
  base: string;
  /** Les autres filtres de la page, conservés tels quels dans l'URL. */
  params?: Record<string, string | undefined>;
  /** Bornes du calendrier, quand l'écran sait de quand à quand il a des séances. */
  min?: string;
  max?: string;
};

/**
 * **« Je cherche le cours du 12 »** — le filtre par date, à côté de la période et de la fenêtre.
 *
 * Demandé par.
 *
 * Les autres filtres répondent à « qu'est-ce qui vient ? » ; celui-ci répond à une question qu'on
 * se pose autrement : on a une date en tête — un stage, un week-end, un souvenir — et on veut
 * **ce jour-là**. Aucune combinaison de trimestre et de fenêtre ne permettait d'y arriver
 * directement : il fallait deviner dans quel trimestre tombait la date, l'ouvrir, élargir la
 * fenêtre, puis chercher des yeux.
 *
 * **`<input type="date">` natif, et c'est un choix.** Le calendrier du système est celui que la
 * personne connaît déjà, il parle sa langue, il est utilisable au doigt comme au clavier, et il ne
 * coûte pas une ligne de JavaScript de plus. Le reproche fait aux `<select>` natifs — le sens
 * d'ouverture de leur menu échappe à la page — ne vaut pas ici : ce champ est posé **dans un volet
 * de filtres déplié en haut de l'écran**, là où la place est devant, jamais derrière.
 *
 * La navigation part **au changement** et non à la validation : sur un calendrier tactile, choisir
 * un jour *est* la validation, et attendre un second geste laisserait croire que rien ne s'est
 * passé. Vider le champ rend l'écran à ses filtres habituels — d'où le bouton « Effacer », qui
 * fait la même chose d'un seul appui, sans avoir à trouver comment on vide un champ date.
 */
export function ChampDate({ valeur, base, params, min, max }: Props) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();

  const aller = (date?: string) => {
    demarrer(() => router.push(lienTemps(base, { ...params, [PARAM_DATE]: date })));
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="font-semibold" htmlFor="filtre-date">
        Une date précise
      </label>
      <div className="flex items-center gap-2">
        <input
          id="filtre-date"
          type="date"
          className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-bordure bg-surface px-3 text-texte"
          value={valeur ?? ""}
          min={min}
          max={max}
          disabled={enCours}
          // Une date effacée dans le champ vaut « plus de filtre » : on ne demande pas confirmation
          // d'un geste qui ne détruit rien.
          onChange={(e) => aller(lireDateFiltre(e.target.value))}
        />
        {valeur && (
          <button
            type="button"
            className="inline-flex min-h-12 items-center gap-1.5 rounded-xl px-3 font-semibold text-lien"
            disabled={enCours}
            onClick={() => aller(undefined)}
          >
            <Icone nom="croix" taille={18} />
            Effacer
          </button>
        )}
      </div>
      <p className="text-sm text-texte-secondaire">
        Le trimestre qui contient cette date s&apos;ouvre tout seul ; l&apos;écran ne montre alors que ce jour-là.
      </p>
    </div>
  );
}
