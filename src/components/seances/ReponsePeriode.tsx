"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { repondrePourLaPeriode } from "@/actions/presences";
import { ATTENDANCE_STATUTS, type AttendanceStatut } from "@/lib/constants";
import { STATUT_LABELS } from "@/lib/presences";
import { Bouton } from "@/components/ui/Bouton";
import { Icone, type NomIcone } from "@/components/ui/Icone";
import { VoletBas } from "@/components/ui/VoletBas";
import { useEcranTelephone } from "@/components/ui/useEcranTelephone";
import { capitale, formatDateSansAnnee, formatHeure } from "@/lib/dates";
import { confirmationReponse, libelleReponse, phrasesPlan, planReponse, seancesOuvertes, type SeanceARepondre } from "./reponse-periode";

const STYLES: Record<AttendanceStatut, { icone: NomIcone; actif: string; inactif: string }> = {
  PRESENT: { icone: "check", actif: "bg-vert text-primaire-texte border-vert", inactif: "bg-surface border-bordure text-vert hover:border-vert" },
  ABSENT: { icone: "croix", actif: "bg-rouge text-primaire-texte border-rouge", inactif: "bg-surface border-bordure text-rouge hover:border-rouge" },
  PEUT_ETRE: { icone: "question", actif: "bg-ocre text-primaire-texte border-ocre", inactif: "bg-surface border-bordure text-ocre hover:border-ocre" },
};

const TITRE = "Répondre pour les séances à venir";

/**
 * **Répondre pour plusieurs séances d'un coup** — au-dessus des cartes de l'onglet Séances, pour un
 * membre invité sur une période active. Le bouton d'entrée est **plein**, comme « Modifier les
 * séances » : c'est un geste du membre, pas une option secondaire. Sur ordinateur, il déplie une carte sous lui ; sur téléphone, il ouvre le volet
 * du bas (`VoletBas`). Le contenu est le même : la portée (**toutes les séances à venir** ou
 * **des dates choisies**, cochées dans la liste), trois boutons de réponse, la case « Ne pas modifier
 * mes réponses déjà données » (cochée par défaut), ce qui va changer en chiffres, et un seul bouton
 * qui écrit — après confirmation.
 */
export function ReponsePeriode({ periodId, periodNom, seances, filtree = false }: { periodId: string; periodNom: string; seances: SeanceARepondre[]; filtree?: boolean }) {
  const router = useRouter();
  const telephone = useEcranTelephone();
  const [ouvert, setOuvert] = useState(false);
  const [statut, setStatut] = useState<AttendanceStatut | null>(null);
  const [garder, setGarder] = useState(true);
  const [parDates, setParDates] = useState(false);
  const [choisies, setChoisies] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const ouvertes = seancesOuvertes(seances);
  if (ouvertes.length === 0) return null;
  const portee = parDates ? choisies : undefined;
  const plan = statut && (!parDates || choisies.size > 0) ? planReponse(seances, statut, garder, portee) : null;
  const basculer = (id: string) =>
    setChoisies((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });

  const lancer = () => {
    if (!statut || !plan || plan.aEcrire.length === 0) return;
    if (!window.confirm(confirmationReponse(statut, plan))) return;
    setMessage(null);
    demarrer(async () => {
      try {
                // Filtrée, « toutes » veut dire « celles affichées » : le serveur reçoit leurs identifiants.
        const seanceIds = parDates ? [...choisies] : filtree ? ouvertes.map((s) => s.id) : undefined;
        const res = await repondrePourLaPeriode({ periodId, statut, garderReponses: garder, ...(seanceIds ? { seanceIds } : {}) });
        if (res.erreur) return setMessage({ type: "erreur", texte: res.erreur });
        setMessage({ type: "ok", texte: res.succes ?? "C'est noté." });
        setStatut(null);
        setChoisies(new Set());
        setOuvert(false);
        router.refresh();
      } catch {
        setMessage({ type: "erreur", texte: "La réponse n'a pas abouti — vérifie ta connexion." });
      }
    });
  };

  const contenu = (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Pour quelles séances" className="grid grid-cols-2 gap-2">
        {[
          { valeur: false, libelle: filtree ? (ouvertes.length > 1 ? `Les ${ouvertes.length} séances affichées` : "La séance affichée") : "Toutes les séances" },
          { valeur: true, libelle: "Choisir des dates" },
        ].map((o) => (
          <button
            key={o.libelle}
            type="button"
            aria-pressed={parDates === o.valeur}
            onClick={() => {
              setParDates(o.valeur);
              setMessage(null);
            }}
            className={[
              "min-h-12 rounded-xl border-2 px-2 text-base font-semibold transition active:scale-[0.97]",
              parDates === o.valeur ? "border-primaire bg-primaire text-primaire-texte shadow-bouton" : "border-bordure bg-surface text-primaire hover:border-primaire",
            ].join(" ")}
          >
            {o.libelle}
          </button>
        ))}
      </div>
      <p className="text-base text-texte-secondaire">
        {parDates
          ? `Coche les séances de « ${periodNom} » pour lesquelles tu réponds.`
          : `${ouvertes.length > 1 ? `Les ${ouvertes.length} séances` : "La séance"} ${filtree ? `${ouvertes.length > 1 ? "affichées" : "affichée"} de « ${periodNom} », selon le filtre` : `à venir de « ${periodNom} »`}. Les séances annulées ou déjà commencées ne sont pas touchées.`}
      </p>
      {parDates && (
        <ul aria-label="Séances à venir" className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-xl border border-bordure p-1">
          {ouvertes.map((s) => (
            <li key={s.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-surface-douce">
                <input type="checkbox" checked={choisies.has(s.id)} onChange={() => basculer(s.id)} className="size-6 shrink-0 accent-primaire" />
                <span className="flex-1 font-semibold">
                  {s.date ? capitale(formatDateSansAnnee(s.date)) : "Séance"}
                  {s.heureDebut ? <span className="font-normal text-texte-secondaire">{` · ${formatHeure(s.heureDebut)}`}</span> : null}
                </span>
                <span className="text-sm text-texte-secondaire">{s.monStatut ? STATUT_LABELS[s.monStatut as AttendanceStatut] : "Sans réponse"}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div role="group" aria-label="Ma réponse pour ces séances" className="grid grid-cols-3 gap-2">
        {ATTENDANCE_STATUTS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatut(s);
              setMessage(null);
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
      {statut && plan && (
        <div className="rounded-xl bg-surface-douce px-3 py-2 text-base" aria-live="polite">
          <p className="font-semibold">{plan.aEcrire.length === 0 ? "Rien ne changerait." : `${libelleReponse(statut, plan.aEcrire.length)}.`}</p>
          {phrasesPlan(plan).map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      <Bouton type="button" onClick={lancer} disabled={enCours || !statut || !plan || plan.aEcrire.length === 0} className="w-full sm:w-auto sm:self-start">
        {parDates && choisies.size === 0 ? "Coche des dates" : !statut || !plan ? "Choisis ta réponse" : plan.aEcrire.length === 0 ? "Rien à changer" : libelleReponse(statut, plan.aEcrire.length)}
      </Bouton>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <Bouton
        type="button"
        className="w-full sm:w-auto sm:self-start"
        aria-expanded={telephone ? undefined : ouvert}
        onClick={() => {
          setOuvert((o) => !o);
          setMessage(null);
        }}
      >
        <Icone nom="calendrier" taille={18} />
        {TITRE}
      </Bouton>
      {!telephone && ouvert && (
        <section aria-label={TITRE} className="rounded-xl border-2 border-primaire bg-surface px-3 py-3 shadow-carte">
          {contenu}
        </section>
      )}
      <VoletBas ouvert={telephone && ouvert} titre={TITRE} onFermer={() => setOuvert(false)}>
        {contenu}
      </VoletBas>
      <p className="min-h-0 text-base" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>
    </div>
  );
}
