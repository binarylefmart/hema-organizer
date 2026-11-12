import Link from "next/link";
import { formatDateCourte, formatHeure } from "@/lib/dates";
import type { AttendanceStatut } from "@/lib/constants";
import { STATUT_LABELS } from "@/lib/presences";
import {
  libelleAvantCours,
  type DetailDesistements,
} from "@/lib/historique-reponses";
import { Carte } from "@/components/ui/Carte";
import { Pastille } from "@/components/ui/Pastille";

const libelle = (s: string | null) =>
  s === null ? "Sans réponse" : (STATUT_LABELS[s as AttendanceStatut] ?? s);

/**
 * **Les désistements, nom par nom** : le compte par personne, puis le détail ligne par ligne (date et
 * heure du cours, lieu, changement, type, écart au cours — jamais l'instant du retrait). Le même rendu
 * pour la page « Désistements » et l'onglet du tableau de bord : composant serveur, `lienPersonne` y
 * reste donc une fonction.
 */
export function ListesDesistements({
  detail,
  lienPersonne,
  max = 300,
  parPersonne = true,
}: {
  detail: DetailDesistements;
  lienPersonne: (userId: string) => string;
  max?: number;
  /** Faux sous le graphique « Qui se désiste », qui dit déjà la même chose */
  parPersonne?: boolean;
}) {
  const lignes = detail.lignes.slice(0, max);
  return (
    <>
      {parPersonne && (
        <Carte titre={`Par personne — ${detail.personnes}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-sm text-texte-secondaire">
                  <th className="py-2 pr-3 font-normal">Personne</th>
                  <th className="py-2 pr-3 text-right font-normal">
                    Désistements
                  </th>
                  <th className="py-2 pr-3 text-right font-normal">
                    dont de dernière minute
                  </th>
                  <th className="py-2 font-normal">Dernier cours concerné</th>
                </tr>
              </thead>
              <tbody>
                {detail.parPersonne.map((p) => (
                  <tr key={p.userId} className="border-t border-bordure/60">
                    <td className="py-1 pr-3">
                      {/* Un nom mène à son seul détail, filtres gardés. */}
                      <Link
                        href={lienPersonne(p.userId)}
                        className="inline-flex min-h-11 items-center"
                      >
                        {p.nom}
                      </Link>
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{p.n}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {p.derniereMinute}
                    </td>
                    <td className="py-1">{formatDateCourte(p.dernierCours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Carte>
      )}

      <Carte titre={`Détail — ${detail.total}`}>
        <ul className="flex flex-col divide-y divide-bordure">
          {lignes.map((l) => (
            <li
              key={l.id}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <span>
                <Link
                  href={`/seances/${l.sessionId}`}
                  className="font-semibold"
                >
                  {formatDateCourte(l.date)} · {formatHeure(l.heureDebut)}
                </Link>{" "}
                <span className="text-texte-secondaire">— {l.lieu}</span>
                <br />
                <strong>{l.nom}</strong> : {libelle(l.avant)} →{" "}
                <strong>{libelle(l.apres)}</strong>{" "}
                {l.derniereMinute ? (
                  <Pastille ton="ocre">désistement de dernière minute</Pastille>
                ) : l.signale ? (
                  <Pastille ton="neutre">désistement signalé</Pastille>
                ) : null}
              </span>
              <span className="shrink-0 text-texte-secondaire">
                {libelleAvantCours(l.avantCoursMin)}
              </span>
            </li>
          ))}
        </ul>
        {detail.total > lignes.length && (
          <p className="mt-3 text-sm text-texte-secondaire">
            Les {lignes.length} plus récents sont affichés sur {detail.total} :
            resserre les dates ou choisis une personne pour voir le reste.
          </p>
        )}
      </Carte>
    </>
  );
}
