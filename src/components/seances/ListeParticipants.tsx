import type { ListesParStatut, Participant } from "@/lib/seances";
import { Icone, type NomIcone } from "@/components/ui/Icone";
import { PastillePersonne } from "@/components/ui/Pastille";
import { ListeRepliee } from "./ListeRepliee";
import { couper, ordreDesGroupes, type CleGroupe } from "./listes";

type Groupe = { cle: CleGroupe; label: string; icone: NomIcone; classes: string };

const LIBELLES: Record<CleGroupe, Omit<Groupe, "cle">> = {
  sansReponse: { label: "Sans réponse", icone: "horloge", classes: "text-texte-secondaire" },
  peutEtre: { label: "Peut-être", icone: "question", classes: "text-ocre" },
  presents: { label: "Présents", icone: "check", classes: "text-vert" },
  absents: { label: "Absents", icone: "croix", classes: "text-rouge" },
};

/**
 * **L'ordre vient de `ordreDesGroupes`, il n'est pas réécrit ici**, et il dépend du temps.
 *
 * Sur un cours **à venir**, ce qui appelle un geste passe devant : les sans-réponse qu'on relance,
 * puis les peut-être. Sur un cours **passé**, ce sont les présents, puis les absents — un registre
 * qu'on relit n'a plus rien à relancer.
 *
 * Ce n'est pas un détail d'esthétique : dans un club de quatre-vingts, chaque colonne est coupée à
 * {@link LIGNES_VISIBLES} noms, donc l'ordre décide de **tout** ce qu'on voit sans rien déplier.
 */
function groupesDe(passee: boolean): Groupe[] {
  return ordreDesGroupes(passee).map((cle) => ({ cle, ...LIBELLES[cle] }));
}

function nomComplet(p: Participant): string {
  return `${p.prenom} ${p.nom}`;
}

function Ligne({ p }: { p: Participant }) {
  return (
    <li className="flex items-center gap-1.5">
      <PastillePersonne id={p.id} couleur={p.couleur} taille={8} />
      {nomComplet(p)}
    </li>
  );
}

/**
 * Liste nominative repliable : qui n'a pas répondu, qui hésite, qui vient, qui manque.
 *
 * `passee` dit seulement si le cours a eu lieu ; c'est `ordreDesGroupes` qui en tire l'ordre des
 * colonnes. Il vaut `false` par défaut — l'immense majorité des appels portent sur des cours à
 * venir, et un écran qui ne se pose pas la question garde exactement ce qu'il affichait.
 */
export function ListeParticipants({
  liste,
  titre = "Qui vient ?",
  compact = false,
  passee = false,
}: {
  liste: ListesParStatut;
  titre?: string;
  compact?: boolean;
  passee?: boolean;
}) {
  const GROUPES = groupesDe(passee);
  const total = GROUPES.reduce((n, g) => n + liste[g.cle].length, 0);
  return (
    // « compact » (historique, listes) : un repli discret, qui ne pèse pas plus que la ligne qu'il complète
    <details className={`group rounded-xl ${compact ? "" : "border border-bordure/60 bg-surface-douce/60"}`}>
      <summary
        className={`flex min-h-12 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden ${
          compact ? "text-texte-secondaire" : "justify-between px-4"
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <Icone nom="groupe" taille={18} />
          {titre} ({total} invités)
        </span>
        <Icone nom="chevronBas" taille={18} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className={`grid gap-4 border-t border-bordure/60 py-3 sm:grid-cols-2 ${compact ? "" : "px-4"}`}>
        {GROUPES.map((g) => {
          // La coupe se fait **par colonne**, pas sur le total : un club de douze a quatre colonnes
          // courtes et ne voit donc aucun bouton, un club de quatre-vingts en a une seule qui
          // déborde — souvent « Sans réponse » — et c'est la seule qui se replie.
          const { montrees, cachees } = couper(liste[g.cle]);
          return (
            <section key={g.cle}>
              <h3 className={`mb-1 inline-flex items-center gap-1.5 text-sm font-semibold ${g.classes}`}>
                <Icone nom={g.icone} taille={16} strokeWidth={2.5} />
                {g.label} · {liste[g.cle].length}
              </h3>
              {liste[g.cle].length === 0 ? (
                <p className="text-sm text-texte-secondaire">—</p>
              ) : (
                <ul className="text-sm leading-6">
                  {montrees.map((p) => (
                    <Ligne key={p.id} p={p} />
                  ))}
                  {/* Le titre de la colonne dit déjà de qui il s'agit : le bouton n'a qu'à dire
                      combien de noms arrivent, et le compteur où l'on en est dans la colonne. */}
                  <ListeRepliee cachees={cachees.map((p) => <Ligne key={p.id} p={p} />)} visibles={montrees.length} />
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </details>
  );
}
