"use client";

import { useEffect, useRef, useState } from "react";
import { boutonClasses, Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import type { Partage } from "./contenu";

/**
 * **Les trois gestes du partage**, dans l'ordre où ils servent :
 *
 * 1. **Partager** — `navigator.share` : le geste naturel du téléphone, qui ouvre WhatsApp, Signal,
 *    Messages, le mail… selon ce que la personne a. Le bouton n'apparaît **que** si l'appareil le
 *    propose : sur un navigateur de bureau, montrer un bouton qui échoue ne rendrait service à personne.
 * 2. **WhatsApp** — le lien `wa.me` préparé côté serveur : c'est le canal du club, il reste offert
 *    partout, y compris sur PC (WhatsApp Web).
 * 3. **Copier le lien** — pour coller où l'on veut, avec une confirmation visible ; si le navigateur
 *    refuse le presse-papiers, le lien s'affiche sélectionné pour une copie à la main.
 *
 * Rien n'est calculé ici : le message, le lien public et l'adresse `wa.me` arrivent tout faits du
 * serveur (`./contenu`), et ne contiennent que ce que la page publique montre déjà — jamais un nom.
 */

type Props = {
  partage: Partage;
  /** Taille des boutons : « petite » dans une liste de cartes, « normale » sur une fiche. */
  taille?: "petite" | "normale";
  /** « discret » se fond dans une ligne d'actions secondaires ; « secondaire » s'assume. */
  variante?: "discret" | "secondaire";
  /** Libellé du bouton principal (« Partager la séance », « Partager le planning »…). */
  libelle?: string;
};

/** Le message de confirmation s'efface tout seul : une copie réussie n'a pas à rester à l'écran. */
const DUREE_CONFIRMATION = 3000;

export function BoutonPartager({ partage, taille = "normale", variante = "secondaire", libelle = "Partager" }: Props) {
  // `navigator.share` ne se teste qu'une fois la page montée (le rendu serveur ne sait pas quel appareil lit)
  const [natifDisponible, setNatifDisponible] = useState(false);
  const [copie, setCopie] = useState(false);
  const [repli, setRepli] = useState(false);
  const champRepli = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNatifDisponible(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!copie) return;
    const t = setTimeout(() => setCopie(false), DUREE_CONFIRMATION);
    return () => clearTimeout(t);
  }, [copie]);

  // Le champ de repli n'a de sens que s'il est prêt à être copié : on le sélectionne dès qu'il paraît
  useEffect(() => {
    if (repli) champRepli.current?.select();
  }, [repli]);

  const partagerNatif = async () => {
    try {
      await navigator.share({ title: partage.titre, text: partage.texte, url: partage.url });
    } catch {
      // Partage refusé ou annulé (l'annulation est le cas courant) : les deux autres gestes restent là
    }
  };

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(partage.url);
      setRepli(false);
      setCopie(true);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission bloquée) : le lien s'offre à la main
      setCopie(false);
      setRepli(true);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {natifDisponible && (
          <Bouton type="button" variante={variante} taille={taille} onClick={partagerNatif}>
            <Icone nom="partage" taille={18} />
            {libelle}
          </Bouton>
        )}
        <a
          href={partage.whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={`${boutonClasses(variante, taille)} no-underline`}
          title="Ouvrir WhatsApp avec le message déjà écrit"
        >
          <Icone nom="lienExterne" taille={18} />
          WhatsApp
        </a>
        <Bouton type="button" variante={variante} taille={taille} onClick={copier}>
          <Icone nom={copie ? "check" : "copie"} taille={18} />
          {copie ? "Lien copié" : "Copier le lien"}
        </Bouton>
      </div>

      {/* Une seule zone d'annonce : ce que le lecteur d'écran entend est ce qui s'affiche */}
      <p aria-live="polite" className="sr-only">
        {copie ? "Lien copié" : ""}
      </p>

      {repli && (
        <label className="flex flex-col gap-1 text-sm text-texte-secondaire">
          Ton navigateur refuse le presse-papiers : le lien est sélectionné, copie-le à la main.
          <input
            ref={champRepli}
            type="text"
            readOnly
            value={partage.url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-11 w-full rounded-xl border-2 border-bordure bg-surface px-3 text-[0.9375rem] text-texte"
          />
        </label>
      )}
    </div>
  );
}
