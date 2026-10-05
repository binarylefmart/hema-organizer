"use client";

/**
 * **L'interrupteur « Sélection multiple »** — le même sur chaque écran de masse (annuaire, présences,
 * séances), comme le reste de la mécanique (`selection.ts`).
 *
 * Une case par ligne et une case maîtresse, c'est un contrôle de plus devant chaque nom ou chaque
 * cours, pour un geste que la plupart des visites ne font pas. L'interrupteur les montre quand on les
 * demande et les referme quand on a fini : **éteint, l'écran n'a ni case, ni case maîtresse, ni
 * barre** ; l'éteindre **vide la sélection** (`selectionApresInterrupteur`) — des cases cachées ne
 * gardent rien de coché, sans quoi la prochaine ouverture ferait réapparaître un lot oublié.
 *
 * Le dessin est celui des interrupteurs des notifications (« Mon profil ») : une **case native**
 * (`role="switch"`), donc le clavier, l'espace et le lecteur d'écran sans rien réinventer, habillée en
 * curseur. 48 px de cible, libellé visible.
 *
 * **Il n'existe pas là où cocher EST le geste** : les dates d'une période (`SelectionDates`,
 * `SeancesCreees`) et la nomination au bureau (`SelectionNomination`) — y ajouter un interrupteur
 * serait un clic de plus avant le seul geste de l'écran.
 */
export function InterrupteurSelection({
  actif,
  onChange,
  disabled = false,
  libelle = "Sélection multiple",
}: {
  actif: boolean;
  onChange: (actif: boolean) => void;
  /** Rien à sélectionner : l'interrupteur reste visible (il dit que le geste existe), mais inerte. */
  disabled?: boolean;
  libelle?: string;
}) {
  return (
    <label className={`inline-flex min-h-12 w-fit items-center gap-3 font-semibold ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <span className="relative inline-flex items-center">
        <input
          type="checkbox"
          role="switch"
          aria-checked={actif}
          checked={actif}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className="block h-7 w-12 rounded-full border-2 border-bordure bg-surface-douce transition peer-checked:border-vert peer-checked:bg-vert peer-focus-visible:ring-2 peer-focus-visible:ring-jauge peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-1 size-5 rounded-full bg-texte-secondaire shadow-bouton transition peer-checked:translate-x-5 peer-checked:bg-surface"
        />
      </span>
      {libelle}
    </label>
  );
}
