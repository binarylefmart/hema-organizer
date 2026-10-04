import type { ReactNode } from "react";

/**
 * Bloc de contenu sur fond crème avec ombre douce.
 *
 * **`id` fait d'elle une cible d'ancre, et pose le dégagement qui va avec** : une carte visée par
 * un sommaire ou par un lien d'email arrive **sous** l'en-tête collant de l'application si personne
 * ne pense au `scroll-mt-20` — on atterrit sur une carte dont le titre est caché. Les deux vont
 * donc ensemble, ici, une fois pour toutes. (Avant, « Mon lien d'accès » portait son ancre sur un
 * `<span>` dans son titre : l'ancre existait, le dégagement non.)
 */
export function Carte({ children, className = "", id, titre, actions }: { children: ReactNode; className?: string; id?: string; titre?: ReactNode; actions?: ReactNode }) {
  return (
    <section id={id} className={`rounded-2xl border border-bordure/60 bg-surface p-4 shadow-carte sm:p-5 ${id ? "scroll-mt-20 " : ""}${className}`}>
      {(titre || actions) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {titre && <h2 className="text-xl font-bold">{titre}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
