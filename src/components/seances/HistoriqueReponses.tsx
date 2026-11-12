import { STATUT_LABELS } from "@/lib/presences";
import type { AttendanceStatut } from "@/lib/constants";
import { libelleAvantCours, type LigneHistorique } from "@/lib/historique-reponses";
import { Pastille } from "@/components/ui/Pastille";
import { Icone } from "@/components/ui/Icone";

const libelle = (s: string | null) => (s === null ? "Sans réponse" : (STATUT_LABELS[s as AttendanceStatut] ?? s));

/**
 * **L'historique des réponses d'une séance** : qui a changé quoi, et quand — le plus
 * récent d'abord, replié par défaut pour ne pas allonger la fiche. Les désistements se signalent d'une
 * pastille, ocre quand ils tombent dans le délai d'alerte réglé par le club.
 */
export function HistoriqueReponses({ lignes }: { lignes: LigneHistorique[] }) {
  if (lignes.length === 0) {
    return <p className="text-texte-secondaire">Aucun changement de réponse noté pour cette séance.</p>;
  }
  const desistements = lignes.filter((l) => l.desistement).length;
  return (
    <details className="group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          {lignes.length} changement{lignes.length > 1 ? "s" : ""} de réponse
          {desistements > 0 ? ` — dont ${desistements} désistement${desistements > 1 ? "s" : ""}` : ""}
        </span>
        <Icone nom="chevronBas" taille={18} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-2 flex flex-col divide-y divide-bordure">
        {lignes.map((l) => (
          <li key={l.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              <strong>{l.personne}</strong> : {libelle(l.avant)} → <strong>{libelle(l.apres)}</strong>
              {l.par && <span className="text-texte-secondaire"> (corrigé par {l.par})</span>}{" "}
              {l.desistement && <Pastille ton={l.derniereMinute ? "ocre" : "neutre"}>{l.derniereMinute ? "désistement de dernière minute" : "désistement"}</Pastille>}
            </span>
            {/* Pas d'horodatage ici : il vit dans le journal d'audit (bureau). L'écart au cours suffit. */}
            <span className="text-sm text-texte-secondaire">{libelleAvantCours(l.avantCoursMin)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
