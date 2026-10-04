import type { ComponentProps } from "react";
import { cleValeurServeur } from "./valeur-serveur";

type Props = ComponentProps<"select"> & { label: string; name: string; erreur?: string; aide?: string };

export function Select({ label, name, erreur, aide, className = "", children, ...props }: Props) {
  const id = props.id ?? name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <select
        // Une liste déroulante est le piège le plus visible : sans remontage, elle retombe sur le
        // choix qu'elle affichait au chargement de la page (voir `cleValeurServeur`).
        key={cleValeurServeur(props)}
        id={id}
        name={name}
        aria-invalid={erreur ? true : undefined}
        className={`min-h-13 rounded-xl border-2 bg-surface px-3 text-[1.0625rem] text-texte shadow-champ focus:border-primaire ${
          erreur ? "border-rouge" : "border-bordure"
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {aide && <p className="text-sm text-texte-secondaire">{aide}</p>}
      {erreur && (
        <p className="text-sm font-semibold text-rouge" role="alert">
          {erreur}
        </p>
      )}
    </div>
  );
}
