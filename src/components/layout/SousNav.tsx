"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { EnCours } from "./EnCours";

/** `badge` est un nœud et non un nombre : il peut arriver après les onglets (voir `BadgeSousNav`). */
export type Sujet = { href: string; label: string; badge?: ReactNode };

/**
 * Pastille de comptage d'un onglet (propositions d'ateliers en attente…).
 *
 * Elle est volontairement détachée du calcul : le layout peut la placer derrière un `<Suspense>`
 * pour que les onglets s'affichent sans attendre le comptage en base.
 */
export function BadgeSousNav({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-primaire px-2 py-0.5 text-xs text-primaire-texte">{children}</span>;
}

/**
 * Navigation secondaire (gestion / administration). Sur ordinateur, les onglets passent à la ligne ;
 * au téléphone, **une seule ligne qui défile** de côté, comme les filtres des ateliers : à 390 px,
 * « Événements » tombait seul sous « Ateliers · Tableau de bord » et se lisait comme une autre rangée.
 */
export function SousNav({ sujets }: { sujets: Sujet[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections">
      <ul className="flex flex-wrap gap-x-1 gap-y-0 border-b border-bordure/60 pb-px tel:flex-nowrap tel:overflow-x-auto">
        {sujets.map((s) => {
          const actif = pathname === s.href || (s.href !== "/gestion" && s.href !== "/admin" && pathname.startsWith(s.href));
          return (
            <li key={s.href} className="shrink-0">
              <Link
                href={s.href}
                aria-current={actif ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 font-semibold no-underline ${
                  actif ? "border-primaire text-primaire" : "border-transparent text-texte-secondaire hover:text-texte"
                }`}
              >
                {s.label}
                {s.badge}
                <EnCours taille={14} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
