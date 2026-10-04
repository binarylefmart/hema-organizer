"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { indiquerPresence } from "@/actions/presences";
import { ATTENDANCE_STATUTS, type AttendanceStatut } from "@/lib/constants";
import { STATUT_LABELS } from "@/lib/presences";
import { Icone, type NomIcone } from "@/components/ui/Icone";

type Props = { sessionId: string; statut: string | null; verrouille: boolean };

// `text-primaire-texte` = blanc en clair, encre en sombre : le libellé du bouton choisi reste lisible
// sur le vert / la rouille / l'ocre éclaircis du mode sombre (le blanc y tombait sous le seuil AA).
const STYLES: Record<AttendanceStatut, { icone: NomIcone; actif: string; inactif: string; pastille: string }> = {
  PRESENT: {
    icone: "check",
    actif: "bg-vert text-primaire-texte border-vert",
    inactif: "bg-surface border-bordure text-vert hover:border-vert",
    pastille: "bg-vert-doux text-vert",
  },
  ABSENT: {
    icone: "croix",
    actif: "bg-rouge text-primaire-texte border-rouge",
    inactif: "bg-surface border-bordure text-rouge hover:border-rouge",
    pastille: "bg-rouge-doux text-rouge",
  },
  PEUT_ETRE: {
    icone: "question",
    actif: "bg-ocre text-primaire-texte border-ocre",
    inactif: "bg-surface border-bordure text-ocre hover:border-ocre",
    pastille: "bg-ocre-doux text-ocre",
  },
};

/**
 * Les 3 grands boutons Présent / Absent / Peut-être : un tap = enregistré (affichage optimiste),
 * confirmation visuelle, puis retour en arrière + message si le serveur refuse.
 */
export function BoutonsPresence({ sessionId, statut, verrouille }: Props) {
  const [optimiste, setOptimiste] = useOptimistic<string | null, string>(statut, (_prev, next) => next);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);

  useEffect(() => {
    if (message?.type !== "ok") return;
    const t = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(t);
  }, [message]);

  const choisir = (nouveau: AttendanceStatut) => {
    if (verrouille || pending) return;
    startTransition(async () => {
      setOptimiste(nouveau);
      const res = await indiquerPresence({ sessionId, statut: nouveau });
      if (res.ok) setMessage({ type: "ok", texte: nouveau === "PRESENT" ? "C'est noté : tu viens." : nouveau === "ABSENT" ? "C'est noté : tu ne viens pas." : "C'est noté : à confirmer." });
      else setMessage({ type: "erreur", texte: res.erreur });
    });
  };

  return (
    /*
     * **Les trois boutons prennent toute la place qu'on leur donne**.
     *
     * Sur la carte large d'une séance, ils occupent la moitié gauche et la jauge et les pastilles la
     * moitié droite. Bridés à leur hauteur de bouton, ils flottaient en haut d'une colonne vide
     * pendant que la droite descendait : une moitié d'écran de blanc, juste à côté de la seule
     * action de la carte. `h-full` sur la grille et sur chaque bouton leur fait épouser la hauteur
     * de leur moitié ; là où la place manque (accueil, fiche de séance), rien ne change — `min-h-14`
     * reste le plancher, et une cible qui grandit ne se vise jamais plus mal.
     */
    <div className="flex h-full flex-col gap-2">
      <div role="group" aria-label="Ma réponse" className="grid h-full grid-cols-3 gap-2">
        {ATTENDANCE_STATUTS.map((s) => {
          const actif = optimiste === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => choisir(s)}
              disabled={verrouille}
              aria-pressed={actif}
              className={[
                "flex h-full min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-1 text-base font-semibold leading-tight sm:flex-row sm:gap-1.5",
                "transition active:scale-[0.97] disabled:cursor-not-allowed disabled:saturate-0",
                actif ? `${STYLES[s].actif} shadow-bouton` : `${STYLES[s].inactif} shadow-carte`,
              ].join(" ")}
            >
              <Icone nom={STYLES[s].icone} taille={20} strokeWidth={2.5} />
              <span>{STATUT_LABELS[s]}</span>
            </button>
          );
        })}
      </div>
      {/* Sous les boutons, on ne redit pas ce qu'ils montrent déjà : le bouton choisi est plein et
          coloré, répéter « Ta réponse : Présent » et « Modifiable jusqu'au début du cours » sur
          chaque carte n'ajoutait qu'une ligne à lire. Ne restent que les trois cas où il y a
          vraiment quelque chose à dire — et la zone reste `aria-live` pour que le lecteur d'écran
          entende la confirmation après un appui.

          **Le paragraphe est monté en permanence, vide quand il n'a rien à dire** : il
          vivait derrière un `&&`, donc il naissait **avec** son texte, et une région vivante ajoutée
          en même temps que son contenu n'est jamais annoncée. Le premier appui parlait (la région
          existait déjà : « Tu n'as pas encore répondu »), les suivants étaient muets — le membre qui
          change d'avis n'entendait plus rien, sur la seule action que l'outil lui offre. Même règle
          que le compteur de `ListeRepliee` et que les deux barres de sélection.

          **Second effet, visible celui-là** : la grille des trois boutons porte `h-full`, donc sur
          une carte large elle épouse la hauteur de sa colonne. Un paragraphe qui apparaît puis
          disparaît changeait cette hauteur d'une trentaine de pixels à chaque appui — les trois
          boutons rétrécissaient, puis regrandissaient sous le doigt. `min-h-6` en permanence tient la
          place, que la phrase soit là ou non. */}
      <p className="min-h-6 text-texte-secondaire" aria-live="polite">
        {message ? (
          <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span>
        ) : verrouille ? (
          "Le cours a commencé : réponse figée."
        ) : !optimiste ? (
          "Tu n'as pas encore répondu."
        ) : null}
      </p>
    </div>
  );
}
