import type { ComponentProps } from "react";
import { cleValeurServeur } from "./valeur-serveur";

type Props = ComponentProps<"textarea"> & { label: string; name: string; erreur?: string; aide?: string };

export function ZoneTexte({ label, name, erreur, aide, className = "", ...props }: Props) {
  const id = props.id ?? name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <textarea
        // Voir `cleValeurServeur` : sans remontage, un second « Enregistrer » renverrait au serveur
        // le texte d'avant (c'est ce qui arrivait aux thèmes du planning).
        key={cleValeurServeur(props)}
        id={id}
        name={name}
        aria-invalid={erreur ? true : undefined}
        className={`min-h-28 rounded-xl border-2 bg-surface px-4 py-3 text-[1.0625rem] text-texte shadow-champ focus:border-primaire ${
          erreur ? "border-rouge" : "border-bordure"
        } ${className}`}
        {...props}
      />
      {aide && <p className="text-sm text-texte-secondaire">{aide}</p>}
      {erreur && (
        <p className="text-sm font-semibold text-rouge" role="alert">
          {erreur}
        </p>
      )}
    </div>
  );
}
