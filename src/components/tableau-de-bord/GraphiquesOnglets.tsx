import Link from "next/link";
import { formatDateCourte, formatHeure } from "@/lib/dates";
import type { Compteurs } from "@/lib/presences";
import { seuilEnPersonnes } from "@/lib/presences";
import { extremesSeances, repartitionTaux, tauxParCreneau, topsPersonnes } from "@/lib/tableau-de-bord-graphiques";
import { Carte } from "@/components/ui/Carte";

/**
 * **Les graphiques des onglets Séances et Personnes** (maquettes validées par Delta). Présence : vert
 * pour les présents, ambre pour les peut-être (`--viz-*` de `globals.css`, validés pour les daltoniens
 * en clair et en sombre). « Les moins présents » ressortent en rouge (une seule série, mise en avant) ;
 * « sans réponse » reste en gris. Chaque barre porte son nom accessible ; les chiffres exacts sont
 * écrits à côté, jamais la couleur seule.
 */
// Présents en vert, peut-être en ambre (`--viz-present`, `--viz-peut-etre`) : un vert clair sur un vert
// foncé se distinguait mal. Validés pour les daltoniens, clair et sombre.
const PRESENT = "var(--viz-present)";
const PEUT_ETRE = "var(--viz-peut-etre)";

function Ligne({ libelle, sous, part, valeur, couleur = PRESENT, href }: { libelle: string; sous?: string; part: number; valeur: string; couleur?: string; href?: string }) {
  const contenu = (
    <>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm text-texte">{libelle}</span>
        {sous && <span className="text-xs text-texte-secondaire">{sous}</span>}
      </span>
      <span className="flex h-4 items-stretch">
        {part > 0 && <span className="h-full rounded-r" style={{ width: `${Math.max(2, part)}%`, background: couleur }} />}
      </span>
      <span className="text-right text-sm font-semibold tabular-nums text-texte">{valeur}</span>
    </>
  );
  const classes = "grid min-h-11 grid-cols-[minmax(6rem,9rem)_1fr_3rem] items-center gap-2";
  const nom = `${libelle}${sous ? ` (${sous})` : ""} : ${valeur}`;
  return (
    <li>
      {href ? (
        <Link href={href} title={nom} aria-label={nom} className={`${classes} rounded no-underline hover:bg-surface-douce`}>
          {contenu}
        </Link>
      ) : (
        <div title={nom} aria-label={nom} className={classes}>
          {contenu}
        </div>
      )}
    </li>
  );
}

type SeanceStat = { id: string; date: string; heureDebut: string; annulee: boolean; passee: boolean; compteurs: Compteurs };

export function GraphiquesSeances({ seances, partEffectifMin }: { seances: readonly SeanceStat[]; partEffectifMin: number }) {
  const cours = [...seances].filter((s) => !s.annulee).sort((a, b) => a.date.localeCompare(b.date) || a.heureDebut.localeCompare(b.heureDebut));
  const invitesMax = Math.max(1, ...cours.map((s) => s.compteurs.invites));
  const seuil = seuilEnPersonnes(partEffectifMin, invitesMax);
  const creneaux = tauxParCreneau(seances);
  const { mieux, moins } = extremesSeances(seances);
  const ligneCours = (s: SeanceStat) => (
    <li key={s.id}>
      <Link href={`/seances/${s.id}`} className="flex min-h-11 items-center gap-2 no-underline">
        <strong className="tabular-nums text-texte">{s.compteurs.pourcentage}&nbsp;%</strong>
        <span className="text-sm">
          {formatDateCourte(s.date)} · {formatHeure(s.heureDebut)}
        </span>
      </Link>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <Carte titre="Présence par cours">
        <div className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-texte-secondaire" aria-label="Légende">
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: PRESENT }} />
              présents
            </li>
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: PEUT_ETRE }} />
              peut-être
            </li>
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block h-0 w-4 border-t-2 border-dashed border-texte-secondaire" />
              seuil du club ({seuil})
            </li>
          </ul>
          {/* Ouvert sur les cours les plus récents (conteneur en `rtl`), comme le graphique des désistements. */}
          <div className="overflow-x-auto" dir="rtl">
            <div className="relative flex min-w-max pl-1 pt-6" dir="ltr">
              <div aria-hidden className="pointer-events-none absolute inset-x-0 top-6 h-40">
                {[0, Math.round(invitesMax / 2), invitesMax].map((t) => (
                  <div key={t} className="absolute inset-x-0 flex translate-y-1/2 items-center gap-1" style={{ bottom: `${(t / invitesMax) * 100}%` }}>
                    <span className="w-5 text-right text-xs tabular-nums text-texte-secondaire">{t}</span>
                    <span className={`h-px flex-1 ${t === 0 ? "bg-texte-secondaire/50" : "bg-bordure/60"}`} />
                  </div>
                ))}
                <div className="absolute inset-x-6 border-t-2 border-dashed border-texte-secondaire/70" style={{ bottom: `${(seuil / invitesMax) * 100}%` }} />
              </div>
              <div className="w-6 shrink-0" />
              {cours.map((s) => {
                const c = s.compteurs;
                const nom = `${formatDateCourte(s.date)} ${formatHeure(s.heureDebut)} : ${c.presents} présent${c.presents > 1 ? "s" : ""}, ${c.peutEtre} peut-être sur ${c.invites}${s.passee ? "" : " (réponses déjà reçues)"}`;
                return (
                  <Link key={s.id} href={`/seances/${s.id}`} title={nom} aria-label={nom} className="group flex w-9 shrink-0 flex-col items-center gap-1 no-underline">
                    <div className={`relative flex h-40 w-5 flex-col justify-end gap-[2px] group-hover:opacity-80 ${s.passee ? "" : "opacity-60"}`}>
                      {c.peutEtre > 0 && <div className="rounded-t" style={{ height: `${(c.peutEtre / invitesMax) * 100}%`, background: PEUT_ETRE }} />}
                      {c.presents > 0 && <div className={c.peutEtre > 0 ? "" : "rounded-t"} style={{ height: `${(c.presents / invitesMax) * 100}%`, background: PRESENT }} />}
                    </div>
                    <span className="text-xs tabular-nums text-texte-secondaire">
                      {s.date.slice(8, 10)}/{s.date.slice(5, 7)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
          <p className="text-sm text-texte-secondaire">Les cours à venir sont plus pâles : ce sont les réponses déjà reçues.</p>
        </div>
      </Carte>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Carte titre="Par jour de cours">
          {creneaux.length === 0 ? (
            <p className="text-texte-secondaire">Aucun cours passé sur cette fenêtre.</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {creneaux.map((c) => (
                <Ligne key={c.cle} libelle={c.libelle} sous={`${c.cours} cours passé${c.cours > 1 ? "s" : ""}`} part={c.taux} valeur={`${c.taux} %`} />
              ))}
            </ol>
          )}
        </Carte>
        <div className="grid grid-cols-2 gap-4">
          <Carte titre="Les mieux remplis">
            <ol className="flex flex-col">{mieux.map(ligneCours)}</ol>
          </Carte>
          <Carte titre="Les moins remplis">
            <ol className="flex flex-col">{moins.map(ligneCours)}</ol>
          </Carte>
        </div>
      </div>
    </div>
  );
}

type MembreStat = { id: string; prenom: string; nom: string; pourcentage: number; sansReponse: number; seances: number };

export function GraphiquesPersonnes({ membres }: { membres: readonly MembreStat[] }) {
  const repartition = repartitionTaux(membres);
  const maxRep = Math.max(1, ...repartition.map((r) => r.n));
  const { top, flop, sansReponse } = topsPersonnes(membres);
  const maxSr = Math.max(1, ...sansReponse.map((m) => m.sansReponse));
  const nom = (m: MembreStat) => `${m.prenom} ${m.nom}`.trim();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Carte titre="Répartition du club">
        <p className="-mt-1 mb-1 text-sm text-texte-secondaire">Combien de personnes dans chaque tranche de taux de présence</p>
        <ol className="flex flex-col gap-1">
          {repartition.map((r) => (
            <Ligne key={r.libelle} libelle={r.libelle} part={(r.n / maxRep) * 100} valeur={String(r.n)} />
          ))}
        </ol>
      </Carte>
      <Carte titre="Top de l'assiduité">
        <ol className="flex flex-col gap-1">
          {top.map((m) => (
            <Ligne key={m.id} libelle={nom(m)} sous={`${m.seances} cours`} part={m.pourcentage} valeur={`${m.pourcentage} %`} />
          ))}
        </ol>
      </Carte>
      <Carte titre="Les moins présents">
        <ol className="flex flex-col gap-1">
          {flop.map((m) => (
            <Ligne key={m.id} libelle={nom(m)} sous={`${m.seances} cours`} part={m.pourcentage} valeur={`${m.pourcentage} %`} couleur="var(--rouge)" />
          ))}
        </ol>
      </Carte>
      <Carte titre="Le plus souvent sans réponse">
        {sansReponse.length === 0 ? (
          <p className="text-texte-secondaire">Tout le monde a répondu.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {sansReponse.map((m) => (
              <Ligne key={m.id} libelle={nom(m)} part={(m.sansReponse / maxSr) * 100} valeur={String(m.sansReponse)} couleur="var(--texte-secondaire)" />
            ))}
          </ol>
        )}
      </Carte>
    </div>
  );
}
