"use client";

import { useActionState } from "react";
import { deciderAtelier } from "@/actions/ateliers";
import { FORM_INITIAL } from "@/lib/form";
import { formatDateCourte, formatHeure } from "@/lib/dates";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

type Seance = { id: string; date: string; heureDebut: string; lieu: string };

/**
 * Décision en un geste. En attente : choisir la séance (pré-remplie avec le souhait du membre, sinon la prochaine)
 * et « Placer dans le planning », ou « Refuser ». Dans le planning : « Retirer ». Refusé : « Remettre en attente ».
 * Le statut visé est porté par le bouton cliqué (name="statut") ; le commentaire est facultatif et replié.
 *
 * **Les découpes internes mesurent le conteneur, pas la fenêtre**. Depuis que `/gestion/ateliers`
 * range deux propositions par ligne au-delà de 1 280 px, cette carte fait ~670 px dans une fenêtre
 * de 1 920 : un palier `sm:` y répondait « oui » sur la foi de la fenêtre alors que la question
 * porte sur la place **dans la carte** — très exactement le piège que `CLAUDE.md` nomme (« plus
 * l'écran est grand, plus les champs sont étroits »). Le palier est donc `@lg` (32 rem de
 * **conteneur**) : sous 512 px — un téléphone, ou une carte un jour mise en demi-colonne — les deux
 * décisions prennent toute la largeur et s'alignent ; au-dessus, elles reviennent à côté de la
 * liste déroulante.
 */
export function DecisionAtelier({ atelierId, statut, seances, sessionId }: { atelierId: string; statut: string; seances: Seance[]; sessionId: string | null }) {
  const [state, action] = useActionState(deciderAtelier, FORM_INITIAL);
  const defaut = sessionId && seances.some((s) => s.id === sessionId) ? sessionId : seances[0]?.id ?? "";
  return (
    <form action={action} className="@container flex flex-col gap-3" noValidate>
      <input type="hidden" name="atelierId" value={atelierId} />
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
      {statut === "PROPOSE" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-semibold">
            Séance
            <select key={`seance-${defaut}`} name="sessionId" defaultValue={defaut} className="min-h-12 rounded-xl border-2 border-bordure bg-surface px-3 text-base font-normal text-texte shadow-champ focus:border-primaire">
              {seances.length === 0 && <option value="">Aucune séance à venir</option>}
              {seances.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatDateCourte(s.date)} · {formatHeure(s.heureDebut)} · {s.lieu}
                </option>
              ))}
            </select>
          </label>
          {/* Dans une carte étroite, les deux décisions occupent toute la largeur : elles s'alignent au lieu de se disperser */}
          <BoutonEnvoi variante="primaire" name="statut" value="PLANIFIE" enCours="Placement…" className="w-full @lg:w-auto">
            Placer dans le planning
          </BoutonEnvoi>
          <BoutonEnvoi variante="secondaire" name="statut" value="REFUSE" enCours="Refus…" className="w-full @lg:w-auto">
            Refuser
          </BoutonEnvoi>
        </div>
      )}
      {statut === "PLANIFIE" && (
        <div className="flex flex-wrap gap-2">
          <BoutonEnvoi variante="secondaire" name="statut" value="PROPOSE" enCours="Retrait…" className="w-full @lg:w-auto">
            Retirer du planning
          </BoutonEnvoi>
          <BoutonEnvoi variante="secondaire" name="statut" value="REFUSE" enCours="Refus…" className="w-full @lg:w-auto">
            Refuser
          </BoutonEnvoi>
        </div>
      )}
      {statut === "REFUSE" && (
        <BoutonEnvoi variante="secondaire" name="statut" value="PROPOSE" enCours="Un instant…">
          Remettre en attente
        </BoutonEnvoi>
      )}
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-lien">Ajouter un mot pour le membre (facultatif)</summary>
        <div className="mt-2">
          <Champ label="Commentaire (envoyé avec l'email)" name="commentaire" id={`commentaire-${atelierId}`} maxLength={500} placeholder="ex. Super idée, on le fait le 12 !" />
        </div>
      </details>
    </form>
  );
}
