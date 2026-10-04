import type { ComponentProps } from "react";
import { cleValeurServeur } from "./valeur-serveur";

type Props = ComponentProps<"input"> & {
  label: string;
  name: string;
  aide?: string;
  erreur?: string;
};

/**
 * Habillage commun des contrôles de saisie. Exporté pour qu'un groupe composé — « 2 » + « jours »,
 * deux contrôles pour une seule information — ait exactement la même allure qu'un champ ordinaire,
 * sans recopier ses classes (et sans qu'elles se mettent à diverger au premier ajustement).
 */
export const CLASSES_CONTROLE =
  "min-h-13 rounded-xl border-2 bg-surface text-[1.0625rem] text-texte shadow-champ focus:border-primaire disabled:bg-surface-douce disabled:text-texte-secondaire";

/** Champ de formulaire avec libellé visible, aide et message d'erreur reliés (aria). */
export function Champ({ label, name, aide, erreur, className = "", ...props }: Props) {
  const id = props.id ?? name;
  const aideId = aide ? `${id}-aide` : undefined;
  const erreurId = erreur ? `${id}-erreur` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        // Remonte le champ quand le serveur renvoie une autre valeur : sans cela, l'écran garde
        // celle du chargement de la page après un enregistrement (voir `cleValeurServeur`).
        key={cleValeurServeur(props)}
        id={id}
        name={name}
        aria-describedby={[aideId, erreurId].filter(Boolean).join(" ") || undefined}
        aria-invalid={erreur ? true : undefined}
        className={[CLASSES_CONTROLE, "px-4", erreur ? "border-rouge" : "border-bordure", className].join(" ")}
        {...props}
      />
      {aide && (
        <p id={aideId} className="text-sm text-texte-secondaire">
          {aide}
        </p>
      )}
      {erreur && (
        <p id={erreurId} className="text-sm font-semibold text-rouge" role="alert">
          {erreur}
        </p>
      )}
    </div>
  );
}

type CaseProps = ComponentProps<"input"> & { label: string; name: string };

export function Case({ label, name, ...props }: CaseProps) {
  const id = props.id ?? name;
  return (
    // `shrink-0` + alignement en haut : sur téléphone, un libellé qui passe à la ligne ne doit pas écraser la case
    <label htmlFor={id} className="flex min-h-12 cursor-pointer items-start gap-3 py-3">
      <input key={cleValeurServeur(props)} id={id} name={name} type="checkbox" className="mt-px size-6 shrink-0 accent-primaire" {...props} />
      <span>{label}</span>
    </label>
  );
}
