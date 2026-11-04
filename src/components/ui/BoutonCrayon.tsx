"use client";

import Link from "next/link";
import { Icone } from "./Icone";
import { useEcranTelephone } from "./useEcranTelephone";

/**
 * **Le bouton crayon** — la porte vers la sélection des séances et vers la modification du planning.
 *
 * **Le crayon seul, sans texte ni bulle** : il est assez explicite. Son nom (`libelle`) reste pour le lecteur d'écran et l'infobulle de la souris.
 *
 * - **Au téléphone**, rond et flottant en bas à droite, au-dessus de la barre d'onglets : il reste sous
 *   le pouce pendant qu'on fait défiler la liste et ne prend aucune ligne à la page.
 * - **Sur ordinateur**, le même rond, sous le titre, aligné à droite.
 *
 * Il mène quelque part (`href`) ou agit sur place (`onClick`).
 */
export function BoutonCrayon({ libelle, href, onClick }: { libelle: string; href?: string; onClick?: () => void }) {
  const telephone = useEcranTelephone();
  const rond =
    "grid place-items-center rounded-full bg-primaire text-primaire-texte transition active:scale-95 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-texte";
  const forme = telephone ? `${rond} size-16 shadow-[0_6px_16px_rgba(0,0,0,0.35)]` : `${rond} size-12 shadow-carte`;
  const icone = <Icone nom="crayon" taille={telephone ? 28 : 22} />;
  const bouton = href ? (
    <Link href={href} aria-label={libelle} title={libelle} className={forme}>
      {icone}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={libelle} title={libelle} className={forme}>
      {icone}
    </button>
  );
  return telephone ? (
    <div className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-20" data-bouton-crayon>
      {bouton}
    </div>
  ) : (
    <div className="flex justify-end">{bouton}</div>
  );
}
