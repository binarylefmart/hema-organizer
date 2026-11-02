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
import { confirmationReponse, libelleReponse, phrasesPlan, planReponse, seancesOuvertes, type SeanceARepondre } from "./reponse-periode";

const STYLES: Record<AttendanceStatut, { icone: NomIcone; actif: string; inactif: string }> = {
  PRESENT: { icone: "check", actif: "bg-vert text-primaire-texte border-vert", inactif: "bg-surface border-bordure text-vert hover:border-vert" },
  ABSENT: { icone: "croix", actif: "bg-rouge text-primaire-texte border-rouge", inactif: "bg-surface border-bordure text-rouge hover:border-rouge" },
  PEUT_ETRE: { icone: "question", actif: "bg-ocre text-primaire-texte border-ocre", inactif: "bg-surface border-bordure text-ocre hover:border-ocre" },
};

const TITRE = "Répondre pour toutes les séances à venir";

/**
 * **Répondre pour toute la période d'un coup** — au-dessus des cartes de l'onglet Séances, pour un
 * membre invité sur une période active. Sur ordinateur, le bouton déplie une carte sous lui ; sur
 * téléphone, il ouvre le volet du bas (`VoletBas`). Le contenu est le même : trois boutons de
 * réponse, la case « Ne pas modifier mes réponses déjà données » (cochée par défaut), ce qui va
 * changer en chiffres, et un seul bouton qui écrit — après confirmation.
 */
export function ReponsePeriode({ periodId, periodNom, seances }: { periodId: string; periodNom: string; seances: SeanceARepondre[] }) {
  const router = useRouter();
  const telephone = useEcranTelephone();
  const [ouvert, setOuvert] = useState(false);
  const [statut, setStatut] = useState<AttendanceStatut | null>(null);
  const [garder, setGarder] = useState(true);
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const ouvertes = seancesOuvertes(seances);
  if (ouvertes.length === 0) return null;
  const plan = statut ? planReponse(seances, statut, garder) : null;

  const lancer = () => {
    if (!statut || !plan || plan.aEcrire.length === 0) return;
    if (!window.confirm(confirmationReponse(statut, plan))) return;
    setMessage(null);
    demarrer(async () => {
      try {
        const res = await repondrePourLaPeriode({ periodId, statut, garderReponses: garder });
        if (res.erreur) return setMessage({ type: "erreur", texte: res.erreur });
        setMessage({ type: "ok", texte: res.succes ?? "C'est noté." });
        setStatut(null);
        setOuvert(false);
        router.refresh();
      } catch {
        setMessage({ type: "erreur", texte: "La réponse n'a pas abouti — vérifie ta connexion." });
      }
    });
  };

  const contenu = (
    <div className="flex flex-col gap-3">
      <p className="text-base text-texte-secondaire">
        {`${ouvertes.length > 1 ? `Les ${ouvertes.length} séances` : "La séance"} à venir de « ${periodNom} ». Les séances annulées ou déjà commencées ne sont pas touchées.`}
      </p>
      <div role="group" aria-label="Ma réponse pour toutes les séances" className="grid grid-cols-3 gap-2">
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
        {!statut || !plan ? "Choisis ta réponse" : plan.aEcrire.length === 0 ? "Rien à changer" : libelleReponse(statut, plan.aEcrire.length)}
      </Bouton>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <Bouton
        type="button"
        variante="secondaire"
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
