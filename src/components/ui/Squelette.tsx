import type { ReactNode } from "react";

/**
 * Squelettes d'attente : la **forme** de l'écran avant que son contenu n'arrive.
 *
 * Pas de roue qui tourne, pas de chiffre inventé — uniquement des blocs neutres qui reprennent
 * les gabarits réels (cartes, lignes, tableaux) pour que rien ne saute quand le contenu se pose.
 * Utilisés par les fichiers `loading.tsx` des routes de l'espace connecté.
 *
 * L'animation de pulsation n'est appliquée qu'en `motion-safe` : quelqu'un qui a demandé moins
 * d'animations (« Réduire les animations » du téléphone) voit des blocs parfaitement immobiles.
 */

/**
 * Bloc gris neutre : la brique de tous les squelettes.
 *
 * `data-squelette` marque chaque bloc — comme `EcranSquelette` marque l'écran entier : il suffit de
 * chercher cet attribut pour savoir, en test comme à la mesure, qu'un écran d'attente est affiché,
 * qu'il vienne d'un `loading.tsx` ou d'un `<Suspense>` posé au milieu d'une page.
 */
export function Bloc({ className = "" }: { className?: string }) {
  return <span data-squelette="" className={`block rounded-md bg-surface-douce motion-safe:animate-pulse ${className}`} />;
}

/** Largeurs alternées : un texte de remplacement n'a jamais des lignes toutes identiques. */
const LARGEURS = ["w-3/4", "w-full", "w-5/6", "w-2/3", "w-11/12"];

/** Quelques lignes de texte de hauteurs égales et de largeurs variées. */
export function LignesTexte({ nombre = 3, className = "" }: { nombre?: number; className?: string }) {
  return (
    <span className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: nombre }, (_, i) => (
        <Bloc key={i} className={`h-4 ${LARGEURS[i % LARGEURS.length]}`} />
      ))}
    </span>
  );
}

/** Titre de page (`h1`, `text-3xl`) et, au besoin, les boutons alignés à droite. */
export function EnTeteSquelette({ actions = 0, largeurTitre = "w-52" }: { actions?: number; largeurTitre?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <Bloc className={`h-9 ${largeurTitre}`} />
      {actions > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Bloc key={i} className="h-12 w-36 rounded-xl" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Les deux listes déroulantes « Saison » / « Période » qui coiffent planning, séances et gestion. */
export function SelecteurPeriodeSquelette() {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-32 flex-1 flex-col gap-1.5 sm:max-w-44">
        <Bloc className="h-4 w-16" />
        <Bloc className="h-12 w-full rounded-xl" />
      </div>
      <div className="flex min-w-48 flex-1 flex-col gap-1.5 sm:max-w-72">
        <Bloc className="h-4 w-24" />
        <Bloc className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** La barre de fenêtre de temps (Toute la période · 2 mois · 1 mois · …). */
export function SelecteurHorizonSquelette() {
  return (
    <div className="flex flex-wrap gap-2">
      {["w-32", "w-20", "w-28", "w-24", "w-32"].map((l, i) => (
        <Bloc key={i} className={`h-11 rounded-xl ${l}`} />
      ))}
    </div>
  );
}

/** Même gabarit que `Carte` : même arrondi, même bordure, même fond, même ombre. */
export function CarteSquelette({ titre = true, lignes = 3, children, className = "" }: { titre?: boolean; lignes?: number; children?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-bordure/60 bg-surface p-4 shadow-carte sm:p-5 ${className}`}>
      {titre && <Bloc className="mb-4 h-6 w-40" />}
      {children ?? <LignesTexte nombre={lignes} />}
    </section>
  );
}

/**
 * Même gabarit que `Tableau` : une vraie grille sur PC, des fiches empilées sur téléphone —
 * exactement la bascule du composant réel, pour qu'aucune ligne ne se déplace à l'arrivée.
 */
/**
 * **Les deux paliers de la silhouette, écrits en entier** — comme dans `Tableau`, et pour la même
 * raison : Tailwind lit la source, une classe fabriquée (`${palier}:flex`) n'existerait pas dans le
 * CSS engendré.
 *
 * Le palier doit être **celui du tableau qu'on annonce**. Figée sur `md`, la silhouette dessinait
 * un tableau entre 768 et 1 023 px là où la liste des périodes rend désormais des fiches : l'écran
 * se réorganisait entièrement à l'arrivée de la vraie page, dans cette seule bande.
 */
const PALIERS_SQUELETTE = {
  md: {
    cadre: "md:overflow-x-auto",
    entete: "hidden bg-surface-douce/70 px-3 py-2.5 md:flex md:gap-3",
    ligne: "flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:gap-3 md:py-3.5",
    cellule: "md:flex-1 md:w-auto",
  },
  lg: {
    cadre: "lg:overflow-x-auto",
    entete: "hidden bg-surface-douce/70 px-3 py-2.5 lg:flex lg:gap-3",
    ligne: "flex flex-col gap-2 px-3 py-3 lg:flex-row lg:items-center lg:gap-3 lg:py-3.5",
    cellule: "lg:flex-1 lg:w-auto",
  },
} as const;

export function TableauSquelette({
  colonnes = 4,
  lignes = 6,
  palier = "md",
}: {
  colonnes?: number;
  lignes?: number;
  palier?: keyof typeof PALIERS_SQUELETTE;
}) {
  const p = PALIERS_SQUELETTE[palier];
  return (
    <div className={`rounded-xl border border-bordure/60 ${p.cadre}`}>
      {/* En-tête de colonnes : visible seulement à partir du palier, comme dans `Tableau` */}
      <div className={p.entete}>
        {Array.from({ length: colonnes }, (_, i) => (
          <Bloc key={i} className="h-4 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-bordure/60">
        {Array.from({ length: lignes }, (_, l) => (
          <div key={l} className={p.ligne}>
            {Array.from({ length: colonnes }, (_, c) => (
              <Bloc key={c} className={`h-4 ${LARGEURS[(l + c) % LARGEURS.length]} ${p.cellule}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Liste de personnes ou d'éléments : un rond d'avatar, un nom, une ligne de détail. */
export function ListeSquelette({ lignes = 6, avatar = false }: { lignes?: number; avatar?: boolean }) {
  return (
    <div className="flex flex-col divide-y divide-bordure/60 rounded-xl border border-bordure/60">
      {Array.from({ length: lignes }, (_, i) => (
        <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4">
          {avatar && <Bloc className="size-7 shrink-0 rounded-full" />}
          <Bloc className={`h-5 ${LARGEURS[i % LARGEURS.length]} max-w-56`} />
          <Bloc className="h-4 w-full max-w-72 basis-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Enveloppe d'un écran d'attente : même `flex flex-col gap-5` que les pages, et une annonce
 * discrète (`role="status"`) pour les lecteurs d'écran, qui n'ont que faire des blocs gris.
 */
export function EcranSquelette({ children, libelle = "Chargement de la page" }: { children: ReactNode; libelle?: string }) {
  return (
    <div className="flex flex-col gap-5" data-squelette="" role="status" aria-busy="true">
      <span className="sr-only">{libelle}…</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}
