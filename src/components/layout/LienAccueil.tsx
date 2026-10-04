"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Identite } from "@/lib/identite";
import { Logo, type LogoIdentite } from "./Logo";

/**
 * L'écu, le nom du club, et **le mot « Accueil » juste en dessous** — le tout dans un seul lien
 * vers `/`, sur toutes les tailles d'écran.
 *
 * **Pourquoi pas une entrée de plus.** L'accueil n'était atteignable qu'en cliquant l'écu : l'usage
 * du web, que rien à l'écran n'annonce — et dans un club où beaucoup ne sont pas à l'aise avec
 * l'informatique, l'écran qui rend compte du prochain cours et de sa propre pratique restait
 * introuvable. Quatre autres placements ont été maquettés et mesurés (icône maison seule, entrée
 * libellée, quatrième onglet, « Tableau de bord ») ; celui-ci a été retenu parce qu'il **apprend la
 * porte qui existe déjà** au lieu d'en ouvrir une seconde, et parce qu'il ne prend rien à personne :
 * la barre du bas garde ses trois cibles larges, l'en-tête ses trois onglets, et le nom du club
 * reste entier là où il tenait.
 *
 * Deux choses le rendent lisible : le mot, écrit en toutes lettres sous le nom ; et l'état
 * **actif**, la même pastille que les onglets, qui dit « tu y es » quand on est sur `/` — c'est
 * elle qui apprend, en une visite, que cette zone est un bouton. D'où le composant client : il lui
 * faut `usePathname()`.
 *
 * Le nom accessible du lien reste « Accueil » (le nom du club est déjà annoncé par l'écu).
 *
 * L'identité arrive en propriété plutôt que d'être lue ici : ce composant est un composant client
 * (il lui faut `usePathname()`), et une lecture de base n'y a pas sa place. C'est l'en-tête, côté
 * serveur, qui la lui passe.
 */
export function LienAccueil({ sigle = false, identite }: { sigle?: boolean; identite: LogoIdentite & Pick<Identite, "sigle" | "nomCourt"> }) {
  const actif = usePathname() === "/";
  return (
    <Link
      href="/"
      aria-label="Accueil"
      aria-current={actif ? "page" : undefined}
      className={`flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-encre-texte no-underline hover:bg-white/10 ${
        actif ? "bg-white/15 ring-1 ring-marque/50" : ""
      }`}
    >
      <Logo identite={identite} variante="ecu" taille={40} className="h-auto w-10 shrink-0" />
      {/* Pendant l'élévation **sur un téléphone étroit** (sous 360 px), l'écu reste seul : la barre
          porte alors la roue de l'admin en plus, et il ne reste que 288 px utiles — le mot s'y
          faisait couper. C'est le seul cas où il n'est pas écrit ; partout ailleurs, téléphone
          compris, il est sous le nom du club. */}
      <span className={`grid min-w-0 gap-0.5 ${sigle ? "hidden min-[360px]:grid" : ""}`}>
        {/* **Le nom se raccourcit plutôt que de disparaître**, et le seuil dépend de la place qui
            reste dans la barre.

            Hors élévation, il n'y a que les onglets : sous 360 px le sigle seul, au-dessus le nom
            entier. Pendant l'élévation, la barre porte en plus l'entrée « Admin » — le nom entier
            ne tient donc plus sur un téléphone, mais il tient parfaitement sur un écran large. Le
            seuil monte à 640 px au lieu de disparaître : le nom était **figé sur le sigle à toutes
            les largeurs** dès qu'on était administrateur, y compris en plein écran d'ordinateur.

            Les deux classes sont écrites en toutes lettres : Tailwind lit le source, une classe
            composée dans une variable ne serait jamais engendrée. `truncate` reste le filet si
            quelques pixels manquaient. */}
        <span className="truncate font-titre text-lg leading-none text-marque">
          {sigle ? (
            <>
              <span className="sm:hidden">{identite.sigle}</span>
              <span className="hidden sm:inline">{identite.nomCourt}</span>
            </>
          ) : (
            <>
              <span className="min-[360px]:hidden">{identite.sigle}</span>
              <span className="hidden min-[360px]:inline">{identite.nomCourt}</span>
            </>
          )}
        </span>
        {/* Le mot, en petites capitales espacées — l'étiquette que l'application emploie déjà
            ailleurs (text-xs, majuscules, interlettrage) : il se lit comme un repère, pas comme un
            second titre, et ne se confond donc pas avec le nom du club juste au-dessus. */}
        <span className={`truncate text-xs uppercase leading-none tracking-wide ${actif ? "text-marque" : "text-encre-texte/75"}`}>
          Accueil
        </span>
      </span>
    </Link>
  );
}
