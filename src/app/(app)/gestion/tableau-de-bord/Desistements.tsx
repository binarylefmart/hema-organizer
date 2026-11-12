import Link from "next/link";
import { formatDateCourte, formatHeure } from "@/lib/dates";
import { STATUT_LABELS } from "@/lib/presences";
import type { AttendanceStatut } from "@/lib/constants";
import { libelleAvantCours, type StatsDesistements } from "@/lib/historique-reponses";
import { Carte } from "@/components/ui/Carte";
import { Pastille } from "@/components/ui/Pastille";

const libelle = (s: string | null) => (s === null ? "Sans réponse" : (STATUT_LABELS[s as AttendanceStatut] ?? s));

function Chiffre({ valeur, legende }: { valeur: string | number; legende: string }) {
  return (
    <div className="rounded-xl bg-surface-douce px-4 py-3">
      <p className="text-2xl font-bold tabular-nums">{valeur}</p>
      <p className="text-sm text-texte-secondaire">{legende}</p>
    </div>
  );
}

/**
 * **Les désistements de la période** (tableau de bord, instructeurs et bureau — demande de
 * Delta : « des stats pour la partie admin et instructeur », sans horodatage : il vit dans le journal d'audit). Mêmes
 * séances que le reste de l'écran (période et fenêtre de temps choisies). Les chiffres viennent de
 * l'historique des réponses : rien avant sa mise en place.
 */
export function CarteDesistements({ st, delaiLibelle, derniereMinuteLibelle }: { st: StatsDesistements; delaiLibelle: string; derniereMinuteLibelle: string }) {
  const max = Math.max(1, ...st.tranches.map((t) => t.n));
  return (
    <Carte titre={`Désistements — ${st.desistements}`}>
      {st.changements === 0 ? (
        <p className="text-texte-secondaire">Aucun changement de réponse noté sur ces séances pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Chiffre valeur={st.desistements} legende="désistements" />
            <Chiffre valeur={st.tardifs - st.derniereMinute} legende={`désistements signalés (délai d'alerte : ${delaiLibelle})`} />
            <Chiffre valeur={st.derniereMinute} legende={`désistements de dernière minute (moins de ${derniereMinuteLibelle} avant)`} />
            <Chiffre valeur={st.personnes} legende={st.personnes > 1 ? "personnes concernées" : "personne concernée"} />
            <Chiffre valeur={st.medianeMin === null ? "—" : libelleAvantCours(st.medianeMin).replace(" avant le cours", "")} legende="délai médian avant le cours" />
            <Chiffre valeur={st.changements} legende="changements de réponse" />
          </div>

          {st.desistements > 0 && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <div className="min-w-0">
                <h3 className="mb-2 text-base font-semibold">Quand on se désiste</h3>
                <ol className="flex flex-col gap-1.5" aria-label="Désistements par délai avant le cours">
                  {st.tranches.map((t) => (
                    <li key={t.libelle} className="grid grid-cols-[9.5rem_1fr_2rem] items-center gap-2 text-sm">
                      <span>{t.libelle}</span>
                      <div className="h-3 overflow-hidden rounded bg-surface-douce" role="presentation">
                        <div className="h-full rounded bg-jauge" style={{ width: `${(t.n / max) * 100}%` }} />
                      </div>
                      <span className="text-right tabular-nums">{t.n}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 text-base font-semibold">Qui se désiste le plus</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-texte-secondaire">
                      <th className="py-1 pr-2 font-normal">Personne</th>
                      <th className="py-1 pr-2 text-right font-normal">Désistements</th>
                      <th className="py-1 text-right font-normal">dont de dernière minute</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.parMembre.map((m) => (
                      <tr key={m.userId} className="border-t border-bordure/50">
                        <td className="py-1 pr-2">{m.nom}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{m.n}</td>
                        <td className="py-1 text-right tabular-nums">{m.derniereMinute}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 text-base font-semibold">Séances les plus touchées</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {st.parSeance.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <Link href={`/seances/${s.id}`} className="inline-flex min-h-11 items-center">
                        {formatDateCourte(s.date)} · {formatHeure(s.heureDebut)}
                      </Link>
                      <span className="tabular-nums">
                        {s.n}
                        {s.derniereMinute > 0 && <span className="text-texte-secondaire"> (dont {s.derniereMinute} de dernière minute)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {st.derniers.length > 0 && (
            <details className="group">
              <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold">Derniers désistements ({st.derniers.length})</summary>
              <ul className="mt-2 flex flex-col divide-y divide-bordure">
                {st.derniers.map((d) => (
                  <li key={d.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <strong>{d.nom}</strong> : {libelle(d.avant)} → <strong>{libelle(d.apres)}</strong> —{" "}
                      <Link href={`/seances/${d.sessionId}`}>{formatDateCourte(d.date)}</Link>{" "}
                      {d.derniereMinute ? <Pastille ton="ocre">désistement de dernière minute</Pastille> : d.tardif ? <Pastille ton="neutre">désistement signalé</Pastille> : null}
                    </span>
                    <span className="text-texte-secondaire">{libelleAvantCours(d.avantCoursMin)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-sm text-texte-secondaire">
            Un désistement : Présent → Absent ou Peut-être, ou Peut-être → Absent, compté une fois par personne et par séance. Séances annulées exclues.
            Signalé : les instructeurs ont été prévenus. De dernière minute : dans la fenêtre réglée par le bureau, il prend le pas sur le désistement
            signalé (compté depuis la v0.87.0). Les chiffres commencent à la mise en place de l&apos;historique.
          </p>
        </div>
      )}
    </Carte>
  );
}
