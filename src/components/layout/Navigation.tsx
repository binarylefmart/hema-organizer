"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icone, type NomIcone } from "@/components/ui/Icone";

export type Onglet = { href: string; label: string; icone: NomIcone };

/**
 * Comparaison par préfixe, sauf pour « / » : l'accueil n'est pas un onglet — il a son lien à lui
 * dans l'en-tête (`LienAccueil`, qui fait la même comparaison stricte de son côté). L'exception
 * reste le garde-fou : « / » est le préfixe de *tous* les chemins, et sans l'égalité stricte une
 * entrée qui le viserait s'allumerait partout.
 */
function estActif(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Liens de navigation dans l'en-tête ; `iconesSeules` = icônes rondes, libellé en infobulle et nom accessible.
 * Les libellés héritent de la taille du corps de page (17 px) : jamais en dessous des 16 px du cahier des charges.
 */
export function NavEntete({ onglets, iconesSeules = false }: { onglets: Onglet[]; iconesSeules?: boolean }) {
  const pathname = usePathname();
  return (
    <>
      {onglets.map((o) => {
        const actif = estActif(pathname, o.href);
        return (
          <Link
            key={o.href}
            href={o.href}
            aria-current={actif ? "page" : undefined}
            // Le nom accessible est toujours porté par le lien : sous 360 px le libellé est retiré
            // du DOM visible (voir plus bas), et `display:none` le retire aussi de l'arbre
            // d'accessibilité — sans cet attribut, l'entrée deviendrait muette pour un lecteur
            // d'écran.
            aria-label={o.label}
            title={iconesSeules ? o.label : undefined}
            // `px-2.5` et `gap-1.5` plutôt que `px-3`/`gap-2` : l'en-tête est borné à la largeur
            // du contenu (max-w-3xl), et ces quelques pixels sont ce qui permet au nom de
            // l'association de rester entier à côté des onglets et des icônes de service.
            className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap text-encre-texte no-underline hover:bg-white/10 ${
              iconesSeules ? "w-11 justify-center rounded-full" : "rounded-lg px-2.5"
            } ${actif ? "bg-white/15 font-semibold text-marque ring-1 ring-marque/50" : ""}`}
          >
            <Icone nom={o.icone} taille={iconesSeules ? 22 : 18} />
            {/* Sous 768 px, le mot s'efface : la seule entrée libellée de l'en-tête à ces largeurs
                est « Admin » (les onglets, eux, sont dans la barre du bas jusqu'à 768 px), et avec
                lui la barre d'un administrateur élevé ne laissait plus la place d'écrire
                « Accueil » sous le nom du club — 358 px occupés pour 358 disponibles sur un
                téléphone de 390. La roue crantée seule suffit à cette taille : elle ne se confond
                avec aucune autre icône de la barre, et le nom accessible du lien reste posé. */}
            {!iconesSeules && <span className="hidden md:inline">{o.label}</span>}
          </Link>
        );
      })}
    </>
  );
}

/**
 * Barre d'onglets en bas de l'écran (téléphone) : icône + libellé à 16 px, cibles ≥ 56 px.
 * Cachée à partir de 768 px, là où les mêmes onglets passent dans l'en-tête.
 */
export function NavBas({ onglets }: { onglets: Onglet[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Menu principal"
      // Les onglets sont remontés : une marge basse s'ajoute à la zone sûre du téléphone, pour que
      // les libellés ne collent ni au bord de l'écran ni à la barre de gestes du système.
      //
      // `bottom-0` a besoin de `viewport-fit=cover` (voir `viewport` dans `src/app/layout.tsx`) :
      // sans lui, l'application installée sur iPhone met la page en page dans une zone réduite et
      // la barre se décroche du bas de l'écran. Le repli `0px` garde la marge correcte partout où
      // la variable n'existe pas (navigateur de bureau, Android sans encoche).
      className="fixed inset-x-0 bottom-0 z-10 border-t border-bordure/60 bg-surface pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] pt-2 shadow-nav md:hidden"
    >
      <ul className="mx-auto flex max-w-3xl">
        {onglets.map((o) => {
          const actif = estActif(pathname, o.href);
          return (
            <li key={o.href} className="flex-1">
              <Link
                href={o.href}
                aria-current={actif ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-center text-base font-semibold leading-tight no-underline ${
                  actif ? "text-primaire" : "text-texte-secondaire"
                }`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${actif ? "bg-primaire-doux" : ""}`}>
                  <Icone nom={o.icone} taille={22} />
                </span>
                {o.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
