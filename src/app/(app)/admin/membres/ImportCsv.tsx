"use client";

import { useActionState, useId, useState } from "react";
import { importerMembres, type ResultatImport } from "@/actions/membres";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { ZoneTexte } from "@/components/ui/ZoneTexte";

/**
 * **Le choix du fichier ne parle plus anglais.**
 *
 * Le contrôle `<input type="file">` nu affiche le libellé du navigateur — « Choose File » et
 * « No file chosen » sur un Chrome anglais, « Parcourir… » ailleurs — au milieu d'un écran
 * entièrement en français, et rien ne permet de le traduire : ce texte appartient au navigateur.
 *
 * Le contrôle reste donc en place (c'est lui qui porte le fichier, et le formulaire l'envoie tel
 * quel), mais **masqué à l'œil** ; c'est son `<label>` qui se présente comme un bouton, et le nom
 * du fichier retenu s'écrit à côté. Masqué par `sr-only` et non par `display: none` : un champ en
 * `display: none` ne se focalise pas au clavier et disparaît de l'arbre d'accessibilité.
 */
export function ImportCsv({ periodes }: { periodes: Array<{ id: string; nom: string; statut: string }> }) {
  const [state, action] = useActionState(importerMembres, {} as ResultatImport);
  // Ce que le navigateur écrivait lui-même, en français et sous notre contrôle.
  const [fichier, setFichier] = useState("");
  // Identifiant unique pour relier le libellé au contrôle masqué, sans le coder en dur.
  const champFichier = useId();
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-texte-secondaire">
        Une ligne par personne : <code>prénom;nom;email;rôle</code> (rôle facultatif : MEMBRE ou INSTRUCTEUR). Les emails déjà connus sont ignorés.
      </p>
      <p className="text-sm text-texte-secondaire">
        L&apos;email peut rester vide : la personne entre dans l&apos;effectif et compte dans les taux, mais elle n&apos;aura pas de lien personnel —
        l&apos;équipe cochera sa présence à sa place. Laisse alors la colonne vide : <code>prénom;nom;</code>
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="font-semibold">Fichier CSV</span>
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor={champFichier}
            className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 border-bordure bg-surface px-4 font-semibold shadow-carte focus-within:border-primaire"
          >
            <input
              id={champFichier}
              name="fichier"
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => setFichier(e.target.files?.[0]?.name ?? "")}
            />
            Choisir un fichier
          </label>
          <span className="min-w-0 break-all text-sm text-texte-secondaire" aria-live="polite">
            {fichier || "Aucun fichier choisi"}
          </span>
        </div>
      </div>
      <ZoneTexte
        label="…ou colle les lignes ici"
        name="texte"
        placeholder={"Prénom;Nom;adresse@exemple.org\nPrénom;Nom;adresse@exemple.org;INSTRUCTEUR\nPrénom;Nom;"}
        aide="Troisième ligne de l'exemple : la colonne email est vide. La personne sera bien dans l'effectif, sans lien personnel."
      />
      {periodes.length > 0 && (
        <fieldset>
          <legend className="mb-1 font-semibold">Inscrire aux périodes</legend>
          {periodes.map((p) => (
            <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input key={`periode-${p.id}-${p.statut}`} type="checkbox" name="periodIds" value={p.id} defaultChecked={p.statut === "ACTIVE"} className="size-6 accent-primaire" />
              {p.nom}
            </label>
          ))}
        </fieldset>
      )}
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      {state.succes && (
        <Alerte type="succes">
          {state.succes}
          {state.ignores && state.ignores.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {state.ignores.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </Alerte>
      )}
      <BoutonEnvoi variante="secondaire" enCours="Import…">
        Importer
      </BoutonEnvoi>
    </form>
  );
}
