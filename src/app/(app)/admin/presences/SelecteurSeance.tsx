"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type OptionSeance = { id: string; label: string; periode: string };

type Props = {
  /** La séance affichée par le panneau. */
  valeur: string;
  options: OptionSeance[];
};

/**
 * **La séance dont on corrige le registre**, choisie ici plutôt qu'en ouvrant la fiche du cours.
 *
 * Demandé par, puis, le même jour, « mets-le dans le panneau admin » — il a donc son propre écran,
 * *Présences*, à la suite de Membres. Le soir d'un cours, on tient le registre d'un seul endroit :
 * la liste déroulante remplace l'aller-retour Séances → la bonne date → Présences.
 *
 * La séance voyage dans l'URL (`?seance=<id>`), comme les autres filtres de l'application : la page
 * reste un composant serveur, l'écran se partage et se recharge tel quel, et le retour du
 * navigateur ramène la séance précédente.
 */
export function SelecteurSeance({ valeur, options }: Props) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const periodes = [...new Set(options.map((o) => o.periode))];

  const aller = (id: string) => {
    demarrer(() => router.push(`/admin/presences?seance=${id}`));
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="font-semibold" htmlFor="registre-seance">
        Séance
      </label>
      <select
        id="registre-seance"
        className="min-h-12 w-full max-w-2xl rounded-xl border-2 border-bordure bg-surface px-3 text-base text-texte shadow-champ focus:border-primaire disabled:cursor-wait disabled:opacity-60"
        value={valeur}
        disabled={enCours}
        onChange={(e) => aller(e.target.value)}
      >
        {periodes.map((p) => (
          <optgroup key={p} label={p}>
            {options
              .filter((o) => o.periode === p)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
