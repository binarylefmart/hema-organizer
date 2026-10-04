import type { AttendanceStatut } from "@/lib/constants";
import { STATUT_LABELS, type Compteurs, type Palier } from "@/lib/presences";
import { Icone, type NomIcone } from "@/components/ui/Icone";

/**
 * **Les couleurs d'un palier de remplissage** — le second usage du vert, de l'ocre et du rouge.
 *
 * Rappel de l'invariant (voir `PALIERS` dans `src/lib/presences.ts`) : sur un **statut**, la
 * couleur dit *lequel* — vert « Présent », ocre « Peut-être », rouge « Absent ». Sur un
 * **effectif**, elle dit *si le cours se remplit*. Pour que les deux ne se lisent jamais l'un pour
 * l'autre, la couleur de palier ne s'emploie que sur un nombre explicitement libellé « présents
 * sur N » **et** toujours doublée du mot du palier (`PALIER_LABELS`).
 *
 * Seules les variables de la charte sont employées, et uniquement dans les deux appariements déjà
 * éprouvés sur tous les thèmes en clair comme en sombre : couleur pleine sur `--surface`
 * (le fond d'une carte) et couleur pleine sur sa déclinaison `-doux`. Aucune couleur en dur.
 */
export const TEXTE_PALIER: Record<Palier, string> = {
  indetermine: "text-texte",
  danger: "text-rouge",
  juste: "text-ocre",
  bien: "text-vert",
};

/** L'étiquette qui porte le mot du palier : fond doux, texte plein — l'appariement des pastilles. */
export const BADGE_PALIER: Record<Palier, string> = {
  indetermine: "bg-surface-douce text-texte-secondaire",
  danger: "bg-rouge-doux text-rouge",
  juste: "bg-ocre-doux text-ocre",
  bien: "bg-vert-doux text-vert",
};

/** Les trois réponses, dans l'ordre où on les lit : qui vient, qui hésite, qui manque. */
const STATUTS: Array<{ cle: keyof Pick<Compteurs, "presents" | "peutEtre" | "absents">; statut: AttendanceStatut; icone: NomIcone; classes: string }> = [
  { cle: "presents", statut: "PRESENT", icone: "check", classes: "bg-vert-doux text-vert" },
  { cle: "peutEtre", statut: "PEUT_ETRE", icone: "question", classes: "bg-ocre-doux text-ocre" },
  { cle: "absents", statut: "ABSENT", icone: "croix", classes: "bg-rouge-doux text-rouge" },
];

/**
 * **Présent / Peut-être / Absent, chiffrés** — la répartition des réponses d'une séance, en trois
 * pastilles, au même endroit et avec les mêmes couleurs sur l'accueil et sur la carte d'une séance.
 *
 * Pourquoi les mettre en avant : le grand nombre de présents répond à « on est combien ? », mais
 * pas à « est-ce que ça peut encore bouger ? ». Trois « Peut-être » en attente et un cours à
 * cinq, ce n'est pas la même soirée que cinq confirmés et personne d'indécis. Le détail nominatif
 * reste replié juste en dessous (`ListeParticipants`) : ici on ne donne que les nombres, c'est ce
 * qui se compare d'un coup d'œil entre trois séances qui se suivent.
 *
 * Ce sont des **couleurs de statut** : chacune est donc toujours accompagnée de l'icône du statut
 * (check / question / croix) — jamais une couleur nue, qui pourrait se lire comme un palier de
 * remplissage.
 *
 * Sur 390 px, le mot (« Présent », « Peut-être », « Absent ») ne s'affiche qu'à partir de `sm` :
 * les trois mots écrits en entier renvoyaient la troisième pastille à la ligne. L'icône et le
 * nombre restent, et le mot est donné aux lecteurs d'écran (`sr-only`) et au survol (`title`) —
 * l'information n'est jamais perdue, seulement abrégée.
 *
 * Affichage seul, aucune action : répondre se fait sur la carte de la séance (`BoutonsPresence`).
 */
export function RepartitionPresences({ compteurs: c, compact = false }: { compteurs: Compteurs; compact?: boolean }) {
  return (
    /* Trois cases de largeur égale plutôt que trois étiquettes serrées : le chiffre monte d'un
       cran, le mot passe dessous, et les trois se comparent d'un regard — c'est la répartition
       qu'on vient lire, pas chaque nombre séparément. Sur téléphone, les trois tiennent encore sur
       une ligne parce que le mot est court et qu'il ne partage plus sa ligne avec le nombre. */
    <ul aria-label="Réponses reçues" className="grid grid-cols-3 gap-1.5">
      {STATUTS.map((s) => {
        const nombre = c[s.cle];
        const libelle = STATUT_LABELS[s.statut];
        return (
          <li key={s.cle} className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 ${s.classes}`}>
            <span className="inline-flex items-center gap-1.5">
              <Icone nom={s.icone} taille={compact ? 16 : 18} strokeWidth={2.5} />
              <strong className={`font-bold tabular-nums ${compact ? "text-xl" : "text-2xl"}`}>{nombre}</strong>
            </span>
            <span className={`font-semibold ${compact ? "text-xs" : "text-sm"}`}>{libelle}</span>
          </li>
        );
      })}
    </ul>
  );
}
