"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bouton, LienBouton } from "./Bouton";
import { Icone } from "./Icone";
import { useEcranTelephone } from "./useEcranTelephone";

/** Combien de visites montrent la bulle qui explique le bouton rond. */
export const VISITES_BULLE_CRAYON = 3;

/**
 * **Le bouton crayon** — la porte vers la sélection des séances et vers la modification du planning.
 *
 * - **Au téléphone**, un bouton rond flottant en bas à droite, au-dessus de la barre d'onglets : il
 *   reste sous le pouce pendant qu'on fait défiler la liste et ne prend aucune ligne à la page. Une
 *   icône seule ne dit pas ce qu'elle fait : une bulle porte son nom les `VISITES_BULLE_CRAYON`
 *   premières fois (compteur gardé sur l'appareil, par `cle`), et le nom reste lu par le lecteur
 *   d'écran.
 * - **Sur ordinateur**, un bouton plein classique sous le titre, avec le même crayon et son nom écrit :
 *   un bouton flottant y est moins naturel, et la place ne manque pas.
 *
 * Il mène quelque part (`href`) ou agit sur place (`onClick`).
 */
export function BoutonCrayon({ libelle, cle, href, onClick }: { libelle: string; cle: string; href?: string; onClick?: () => void }) {
  const telephone = useEcranTelephone();
  const [bulle, setBulle] = useState(false);

  useEffect(() => {
    if (!telephone) return;
    try {
      const nom = `bulle-crayon:${cle}`;
      const vues = Number(window.localStorage.getItem(nom) ?? "0");
      if (vues < VISITES_BULLE_CRAYON) {
        setBulle(true);
        window.localStorage.setItem(nom, String(vues + 1));
      }
    } catch {
      // Stockage indisponible (navigation privée) : on montre la bulle, sans compter.
      setBulle(true);
    }
  }, [telephone, cle]);

  if (!telephone) {
    return (
      <div className="flex justify-end">
        {href ? (
          <LienBouton href={href} className="w-full sm:w-auto">
            <Icone nom="crayon" taille={20} />
            {libelle}
          </LienBouton>
        ) : (
          <Bouton type="button" onClick={onClick} className="w-full sm:w-auto">
            <Icone nom="crayon" taille={20} />
            {libelle}
          </Bouton>
        )}
      </div>
    );
  }

  const rond =
    "grid size-16 place-items-center rounded-full bg-primaire text-primaire-texte shadow-[0_6px_16px_rgba(0,0,0,0.35)] transition active:scale-95 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-texte";
  return (
    <div className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-20 flex items-center gap-3" data-bouton-crayon>
      {bulle && (
        <span aria-hidden className="rounded-xl bg-encre px-3 py-2 text-sm font-semibold text-encre-texte shadow-carte">
          {libelle}
        </span>
      )}
      {href ? (
        <Link href={href} aria-label={libelle} title={libelle} className={rond}>
          <Icone nom="crayon" taille={28} />
        </Link>
      ) : (
        <button type="button" onClick={onClick} aria-label={libelle} title={libelle} className={rond}>
          <Icone nom="crayon" taille={28} />
        </button>
      )}
    </div>
  );
}
