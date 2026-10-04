"use client";

import { useState, useTransition } from "react";
import {
  ajouterMembresPeriode,
  definirInstructeursPeriode,
} from "@/actions/periodes";
import { Bouton } from "@/components/ui/Bouton";
import { Alerte } from "@/components/ui/Alerte";

// L'email est facultatif : une personne peut n'en avoir aucun (elle n'a alors pas de lien personnel)
type Personne = { id: string; nom: string; email?: string | null };

/**
 * Cases à cocher des instructeurs habituels de la période.
 *
 * **La sélection ne porte que ce qui est affiché**. Elle était semée avec *tous* les instructeurs
 * rattachés à la période, alors que la liste de cases ne montre que les comptes **actifs ayant le
 * rôle**. Un instructeur rétrogradé en membre, ou désactivé, était donc dans la sélection **sans
 * case à cocher** — invisible à l'écran, et pourtant réécrit en base à chaque « Enregistrer », puis
 * rattaché à toutes les séances engendrées ensuite (`genererSeancesPeriode` recopie les
 * instructeurs de la période sur chaque séance). Le bureau croyait l'affaire réglée en changeant
 * son rôle ; rien, dans cet écran, ne lui disait le contraire, et rien ne lui permettait de le
 * retirer.
 *
 * Deux moitiés, et il faut les deux : la sélection est **restreinte à `staff`**, et ceux qui restent
 * dehors sont **nommés avec la raison** — c'est la doctrine des sélections multiples du dossier (« ce
 * qui reste dehors est compté et dit »), et c'est ce qui distingue un retrait voulu d'un bogue.
 */
export function InstructeursPeriode({
  periodId,
  staff,
  selection,
  sansCase = [],
}: {
  periodId: string;
  staff: Personne[];
  selection: string[];
  sansCase?: Array<{ nom: string; raison: string }>;
}) {
  const [choix, setChoix] = useState<Set<string>>(
    new Set(selection.filter((id) => staff.some((u) => u.id === id))),
  );
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ texte: string; ok: boolean } | null>(
    null,
  );
  return (
    <div className="flex flex-col gap-3">
      {staff.length === 0 && (
        <p className="text-texte-secondaire">Aucun compte instructeur actif.</p>
      )}
      {sansCase.length > 0 && (
        <p className="text-sm text-texte-secondaire">
          {sansCase.length === 1
            ? "Une personne est encore rattachée à ce trimestre sans avoir de case"
            : `${sansCase.length} personnes sont encore rattachées à ce trimestre sans avoir de case`}{" "}
          : {sansCase.map((s) => `${s.nom} (${s.raison})`).join(", ")}.
          Enregistrer ici ne les touche pas — elles se retirent depuis leur
          fiche.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {staff.map((u) => (
          <li key={u.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="size-6 accent-primaire"
                checked={choix.has(u.id)}
                onChange={(e) => {
                  const n = new Set(choix);
                  if (e.target.checked) n.add(u.id);
                  else n.delete(u.id);
                  setChoix(n);
                  setMessage(null);
                }}
              />
              {u.nom}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Bouton
          variante="secondaire"
          disabled={pending}
          onClick={() =>
            start(async () => {
              // **Un `catch`, sinon l'écran ne dit rien du tout.** L'élévation admin retombe au bout
              // de dix minutes : `assertPermission` lève alors, la promesse rejette, et le message de
              // succès n'était simplement jamais atteint — le bouton clignotait et on recliquait.
              try {
                await definirInstructeursPeriode(periodId, [...choix]);
                setMessage({
                  texte:
                    "Instructeurs enregistrés (appliqués aux prochaines séances générées).",
                  ok: true,
                });
              } catch {
                setMessage({
                  texte:
                    "L'enregistrement n'a pas abouti. Vérifie ta connexion, puis réessaie.",
                  ok: false,
                });
              }
            })
          }
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Bouton>
        {message && (
          <span
            className={`text-sm font-semibold ${message.ok ? "text-vert" : "text-rouge"}`}
          >
            {message.texte}
          </span>
        )}
      </div>
    </div>
  );
}

/** Ajout de membres existants à la période (recherche + cases). */
export function AjoutMembresPeriode({
  periodId,
  candidats,
  active,
}: {
  periodId: string;
  candidats: Personne[];
  active: boolean;
}) {
  const [filtre, setFiltre] = useState("");
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const visibles = candidats.filter((c) =>
    `${c.nom} ${c.email ?? ""}`.toLowerCase().includes(filtre.toLowerCase()),
  );
  if (candidats.length === 0)
    return (
      <p className="text-texte-secondaire">
        Tous les comptes actifs sont déjà invités.
      </p>
    );
  return (
    <details className="group rounded-xl border border-bordure/60 bg-surface-douce/50">
      <summary className="min-h-12 cursor-pointer list-none px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        + Ajouter des membres existants ({candidats.length} disponibles)
      </summary>
      <div className="flex flex-col gap-3 border-t border-bordure/60 p-4">
        <input
          type="search"
          placeholder="Filtrer par nom ou email"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          className="min-h-12 rounded-xl border-2 border-bordure bg-surface px-4"
          aria-label="Filtrer les membres"
        />
        <div className="flex flex-wrap gap-2">
          <Bouton
            variante="discret"
            onClick={() => setChoix(new Set(visibles.map((v) => v.id)))}
          >
            Tout cocher
          </Bouton>
          <Bouton variante="discret" onClick={() => setChoix(new Set())}>
            Tout décocher
          </Bouton>
        </div>
        <ul className="grid max-h-72 gap-1 overflow-y-auto @md:grid-cols-2">
          {visibles.map((c) => (
            <li key={c.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="size-6 accent-primaire"
                  checked={choix.has(c.id)}
                  onChange={(e) => {
                    const n = new Set(choix);
                    if (e.target.checked) n.add(c.id);
                    else n.delete(c.id);
                    setChoix(n);
                  }}
                />
                <span>
                  {c.nom}{" "}
                  <span className="text-sm text-texte-secondaire">
                    {c.email || "sans email"}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {message && <Alerte type="succes">{message}</Alerte>}
        <Bouton
          disabled={pending || choix.size === 0}
          onClick={() =>
            start(async () => {
              const { ajoutes } = await ajouterMembresPeriode(periodId, [
                ...choix,
              ]);
              setChoix(new Set());
              setMessage(
                `${ajoutes} membre${ajoutes > 1 ? "s" : ""} ajouté${ajoutes > 1 ? "s" : ""}${active ? " — leur lien est en cours d'envoi." : "."}`,
              );
            })
          }
        >
          {pending
            ? "Ajout…"
            : `Ajouter ${choix.size || ""} membre${choix.size > 1 ? "s" : ""}${active ? " et envoyer les liens" : ""}`}
        </Bouton>
      </div>
    </details>
  );
}
