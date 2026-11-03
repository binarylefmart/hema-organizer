"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { repondrePourLaPeriode } from "@/actions/presences";
import { ATTENDANCE_STATUTS, type AttendanceStatut } from "@/lib/constants";
import { STATUT_LABELS } from "@/lib/presences";
import { Bouton } from "@/components/ui/Bouton";
import { Icone, type NomIcone } from "@/components/ui/Icone";
import { pluriel } from "@/components/ui/choix-geste";
import {
  confirmationReponse,
  coursProposes,
  libelleReponse,
  partiesAChoisir,
  phraseCours,
  phrasesPlan,
  planReponse,
  seancesPresentesApres,
  type SeanceARepondre,
} from "./reponse-periode";

const STYLES: Record<AttendanceStatut, { icone: NomIcone; actif: string; inactif: string }> = {
  PRESENT: { icone: "check", actif: "bg-vert text-primaire-texte border-vert", inactif: "bg-surface border-bordure text-vert hover:border-vert" },
  ABSENT: { icone: "croix", actif: "bg-rouge text-primaire-texte border-rouge", inactif: "bg-surface border-bordure text-rouge hover:border-rouge" },
  PEUT_ETRE: { icone: "question", actif: "bg-ocre text-primaire-texte border-ocre", inactif: "bg-surface border-bordure text-ocre hover:border-ocre" },
};

/** Une séance cochée à laquelle la personne peut répondre, avec sa période (le serveur répond période par période). */
export type SeanceLot = SeanceARepondre & { periodId: string };

/**
 * **« Ma réponse » pour les séances cochées** — la moitié membre du panneau de la sélection
 * (`SelectionSeances`). Elle remplace « Répondre pour les séances à venir » : on ne
 * choisit plus « toutes » ou « des dates » dans un volet à part, on coche les séances dans la liste.
 *
 * Trois réponses, la case « Ne pas modifier mes réponses déjà données » (cochée par défaut), et, avec
 * « Présent » et le choix des cours ouvert, **tous les cours** des séances visées à cocher, par nom
 * (`coursProposes`) : cocher un nom l'ajoute dans chaque séance qui le propose ; rien n'est jamais
 * décoché d'ici. Les règles sont celles de `reponse-periode.ts`, que le serveur refait de son côté
 * (`repondrePourLaPeriode`, appelée une fois par période du lot).
 *
 * `ignorees` compte les séances cochées qui n'attendent pas de réponse de la personne (période close
 * ou pas invitée, séance annulée ou commencée) : elles sont dites, jamais écrites.
 */
export function ReponseLot({ seances, ignorees, onFait }: { seances: SeanceLot[]; ignorees: number; onFait: (texte: string) => void }) {
  const router = useRouter();
  const [statut, setStatut] = useState<AttendanceStatut | null>(null);
  const [garder, setGarder] = useState(true);
  const [coursCoches, setCoursCoches] = useState<ReadonlySet<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const plan = statut ? planReponse(seances, statut, garder) : null;
  const cibles = statut ? seancesPresentesApres(seances, statut, garder) : [];
  const proposes = coursProposes(seances, cibles);
  const aCocher = partiesAChoisir(seances, cibles, coursCoches);
  const aFaire = plan ? plan.aEcrire.length + aCocher.length : 0;
  const ouvertes = seances.filter((s) => !s.annulee && !s.commencee).length;
  const basculerCours = (cle: string) =>
    setCoursCoches((avant) => {
      const apres = new Set(avant);
      if (apres.has(cle)) apres.delete(cle);
      else apres.add(cle);
      return apres;
    });

  const lancer = () => {
    if (!statut || !plan || aFaire === 0) return;
    const question = plan.aEcrire.length === 0 ? `Ajouter ${pluriel(aCocher.length, "cours", "cours")} à tes choix ?` : [confirmationReponse(statut, plan), phraseCours(aCocher.length, false)].filter(Boolean).join(" ");
    if (!window.confirm(question)) return;
    setErreur(null);
    // Le serveur répond période par période : chaque appel reçoit ses séances et ses cours.
    const parPeriode = new Map<string, { seanceIds: string[]; partieIds: string[] }>();
    const partieVersPeriode = new Map(seances.flatMap((s) => (s.cours ?? []).map((c) => [c.partieId, s.periodId] as const)));
    for (const s of seances) {
      const p = parPeriode.get(s.periodId) ?? { seanceIds: [], partieIds: [] };
      p.seanceIds.push(s.id);
      parPeriode.set(s.periodId, p);
    }
    for (const partieId of aCocher) {
      const p = parPeriode.get(partieVersPeriode.get(partieId) ?? "");
      if (p) p.partieIds.push(partieId);
    }
    demarrer(async () => {
      try {
        const textes: string[] = [];
        for (const [periodId, p] of parPeriode) {
          const res = await repondrePourLaPeriode({
            periodId,
            statut,
            garderReponses: garder,
            seanceIds: p.seanceIds,
            ...(p.partieIds.length > 0 ? { partieIds: p.partieIds } : {}),
          });
          if (res.erreur) {
            setErreur(res.erreur);
            return;
          }
          if (res.succes) textes.push(res.succes);
        }
        setStatut(null);
        setCoursCoches(new Set());
        onFait(textes.join(" ") || "C'est noté.");
        router.refresh();
      } catch {
        setErreur("La réponse n'a pas abouti — vérifie ta connexion.");
      }
    });
  };

  return (
    <section aria-labelledby="ma-reponse-lot" className="flex flex-col gap-3">
      <h3 id="ma-reponse-lot" className="text-base font-bold tracking-wide text-texte-secondaire uppercase">
        Ma réponse
      </h3>
      {ouvertes === 0 ? (
        <p className="text-base text-texte-secondaire">Aucune des séances cochées n&apos;attend ta réponse : elles sont annulées, déjà commencées, ou tu n&apos;y es pas invité(e).</p>
      ) : (
        <>
          <p className="text-base text-texte-secondaire">
            {`Pour ${pluriel(ouvertes, "séance")} ${ouvertes > 1 ? "cochées" : "cochée"}.`}
            {ignorees > 0 ? ` ${pluriel(ignorees, "autre")} ne ${ignorees > 1 ? "demandent" : "demande"} pas ta réponse.` : ""}
          </p>
          <div role="group" aria-label="Ma réponse pour les séances cochées" className="grid grid-cols-3 gap-2">
            {ATTENDANCE_STATUTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStatut(s);
                  setErreur(null);
                }}
                aria-pressed={statut === s}
                className={[
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-1 text-base font-semibold leading-tight sm:flex-row sm:gap-1.5",
                  "transition active:scale-[0.97]",
                  statut === s ? `${STYLES[s].actif} shadow-bouton` : `${STYLES[s].inactif} shadow-carte`,
                ].join(" ")}
              >
                <Icone nom={STYLES[s].icone} taille={20} strokeWidth={2.5} />
                <span>{STATUT_LABELS[s]}</span>
              </button>
            ))}
          </div>
          <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 font-semibold">
            <input type="checkbox" checked={garder} onChange={(e) => setGarder(e.target.checked)} className="size-6 accent-primaire" />
            Ne pas modifier mes réponses déjà données
          </label>
          {statut === "PRESENT" && proposes.length > 0 && (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 flex w-full items-baseline justify-between gap-2 font-semibold">
                Ce que je suivrai
                <span className="text-sm font-normal text-texte-secondaire">facultatif · {pluriel(proposes.length, "cours", "cours")} au choix</span>
              </legend>
              <div className="flex max-h-64 flex-col overflow-y-auto rounded-xl border border-bordure">
                {proposes.map((c) => (
                  <label key={c.cle} className="flex min-h-12 cursor-pointer items-center gap-3 border-t border-bordure px-3 first:border-t-0">
                    <input type="checkbox" checked={coursCoches.has(c.cle)} onChange={() => basculerCours(c.cle)} className="size-6 shrink-0 accent-primaire" />
                    <span className="min-w-0 flex-1 font-semibold">{c.nom}</span>
                    <span className="text-sm text-texte-secondaire">{cibles.length > 1 && c.seances === cibles.length ? "toutes ces séances" : pluriel(c.seances, "séance")}</span>
                  </label>
                ))}
              </div>
              <p className="text-sm text-texte-secondaire">Les cours déjà choisis restent choisis ; pour en retirer un, passe par la séance.</p>
            </fieldset>
          )}
          {statut && plan && (
            <div className="rounded-xl bg-surface-douce px-3 py-2 text-base" aria-live="polite">
              <p className="font-semibold">{aFaire === 0 ? "Rien ne changerait." : plan.aEcrire.length === 0 ? "Ta réponse ne change pas." : `${libelleReponse(statut, plan.aEcrire.length)}.`}</p>
              {[...phrasesPlan(plan), phraseCours(aCocher.length, false)].filter(Boolean).map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          )}
          <Bouton type="button" onClick={lancer} disabled={enCours || !statut || !plan || aFaire === 0} className="w-full sm:w-auto sm:self-start">
            {!statut || !plan
              ? "Choisis ta réponse"
              : aFaire === 0
                ? "Rien à changer"
                : plan.aEcrire.length === 0
                  ? `Ajouter ${pluriel(aCocher.length, "cours", "cours")}`
                  : libelleReponse(statut, plan.aEcrire.length)}
          </Bouton>
          {erreur ? (
            <p className="font-semibold text-rouge" aria-live="polite">
              {erreur}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
