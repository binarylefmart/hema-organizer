"use client";

import { useEffect, useRef, useState } from "react";
import { ListeDeroulante, type EntreeListe } from "./ListeDeroulante";

/**
 * **Une liste déroulante de formulaire, avec le composant du dépôt** — le libellé, `ListeDeroulante`
 * et un champ caché qui porte la valeur dans le `FormData`.
 *
 * `Select` dessinait la liste native du navigateur : sur téléphone et en mode sombre, elle ne
 * ressemblait à aucune autre liste de l'application (planning, « Que veux-tu faire ? »), et le
 * navigateur décidait seul du sens d'ouverture. Toutes les listes de l'application passent par
 * celle-ci, pour que le même geste ait partout la même forme.
 *
 * Pilotée ou non : sans `onChange`, l'état vit ici, semé par `valeur` et ressemé quand le serveur en
 * renvoie une autre ; avec `onChange`, l'appelant garde la valeur.
 *
 * `name` est facultatif : une liste qui agit tout de suite (navigation, enregistrement) n'a pas de
 * formulaire à nourrir. Désactivée, elle poste quand même sa valeur — un `<select disabled>` ne la
 * postait pas, et c'est ce qui obligeait à doubler chaque liste grisée d'un champ caché.
 */
export function ChampListe({
  label,
  name,
  id,
  valeur,
  entrees,
  onChange,
  aide,
  erreur,
  disabled = false,
  libelleMasque = false,
  className = "",
  decritPar,
}: {
  label: string;
  name?: string;
  id?: string;
  valeur: string;
  entrees: EntreeListe[];
  onChange?: (valeur: string) => void;
  aide?: string;
  erreur?: string;
  disabled?: boolean;
  /** Libellé lu par les lecteurs d'écran seulement (une ligne de tableau, où la colonne le dit). */
  libelleMasque?: boolean;
  /** Classes ajoutées au déclencheur. */
  className?: string;
  /** Une phrase d'aide posée ailleurs que sous la liste (une matrice, un tableau) : son identifiant. */
  decritPar?: string;
}) {
  const [interne, setInterne] = useState(valeur);
  // **Le serveur reprend la main dès qu'il dit autre chose** (même patron que `SelecteurRole`) : après
  // un enregistrement, la valeur fraîche remplace celle du montage.
  const [vuDuServeur, setVuDuServeur] = useState(valeur);
  if (vuDuServeur !== valeur) {
    setVuDuServeur(valeur);
    setInterne(valeur);
  }
  /*
   * **Un formulaire réinitialisé remet la liste à sa valeur de départ**, comme il le fait d'un
   * `<select>`. React 19 réinitialise le formulaire quand son action a rendu la main ; un champ
   * caché piloté, lui, n'y est pas sensible : après l'ajout d'un instructeur, la personne suivante
   * aurait été créée instructeur sans que personne ne retouche la liste. On écoute donc l'évènement
   * `reset` du formulaire qui porte le champ.
   */
  const cache = useRef<HTMLInputElement>(null);
  const depart = useRef(valeur);
  depart.current = valeur;
  useEffect(() => {
    const formulaire = cache.current?.form;
    if (!formulaire || onChange) return;
    const remettre = () => setInterne(depart.current);
    formulaire.addEventListener("reset", remettre);
    return () => formulaire.removeEventListener("reset", remettre);
  }, [onChange]);
  const courante = onChange ? valeur : interne;
  const ident = id ?? name ?? label;
  return (
    <div className="flex flex-col gap-1.5">
      <label id={`${ident}-libelle`} htmlFor={ident} className={libelleMasque ? "sr-only" : "font-semibold"}>
        {label}
      </label>
      <ListeDeroulante
        id={ident}
        libelleId={`${ident}-libelle`}
        libelle={label}
        valeur={courante}
        entrees={entrees}
        disabled={disabled}
        decritPar={[decritPar, aide ? `${ident}-aide` : "", erreur ? `${ident}-erreur` : ""].filter(Boolean).join(" ")}
        onChoisir={(v) => (onChange ? onChange(v) : setInterne(v))}
        className={`min-h-13 w-full rounded-xl border-2 bg-surface px-3 text-[1.0625rem] text-texte shadow-champ focus:border-primaire disabled:opacity-60 ${
          erreur ? "border-rouge" : "border-bordure"
        } ${className}`}
      />
      {name && <input ref={cache} type="hidden" name={name} value={courante} />}
      {aide && (
        <p id={`${ident}-aide`} className="text-sm text-texte-secondaire">
          {aide}
        </p>
      )}
      {erreur && (
        <p id={`${ident}-erreur`} className="text-sm font-semibold text-rouge" role="alert">
          {erreur}
        </p>
      )}
    </div>
  );
}
