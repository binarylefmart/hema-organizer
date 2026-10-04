"use client";

import type { ReactNode } from "react";
import { Bouton } from "./Bouton";
import { Icone } from "./Icone";
import { ListeDeroulante } from "./ListeDeroulante";
import { entreesGestes, QUESTION_GESTE, type Explication } from "./choix-geste";
import { ExplicationGeste } from "./ExplicationGeste";
import { SansReponse, useAttenteSurveillee } from "./attente-surveillee";

/**
 * **« Que veux-tu faire ? » — la forme unique d'un choix entre plusieurs gestes** : une question, une
 * liste qui ne propose que les gestes applicables, l'explication du geste choisi, et un seul bouton
 * qui dit le verbe et le nombre.
 *
 * Composant **piloté** : il ne sait ni quels gestes existent, ni ce qu'ils font. L'écran calcule la
 * liste, garde le choix, et lance le geste (avec la confirmation qu'il avait déjà) ; ce composant ne
 * fait que le dessiner, partout de la même façon. Pour un écran qui n'a qu'à choisir entre des
 * actions toutes prêtes, `GestesProposes` ajoute l'état et l'appel par-dessus.
 *
 * `children` se glisse entre la liste et l'explication : c'est la place d'un réglage que le geste
 * demande (le nouveau rôle d'un lot, par exemple).
 */
export function ChoixGeste({
  id,
  gestes,
  valeur,
  onChoisir,
  explication,
  bouton,
  variante,
  inerte,
  enCours,
  onLancer,
  children,
}: {
  /** Préfixe des identifiants du champ : unique dans la page. */
  id: string;
  /** Les gestes applicables, déjà filtrés : un geste qui ne toucherait rien n'est pas passé ici. */
  gestes: readonly { geste: string; libelle: string }[];
  valeur: string;
  onChoisir: (valeur: string) => void;
  explication: Explication | null;
  /** Le libellé du bouton : un verbe et un nombre. */
  bouton: string;
  /** Plein ; rouge pour un geste qui enlève quelque chose (`varianteGeste`). */
  variante: "primaire" | "danger";
  /** Inerte tant que rien n'est choisi — et quand le geste attend encore un réglage. */
  inerte: boolean;
  enCours: boolean;
  onLancer: () => void;
  children?: ReactNode;
}) {
  const silence = useAttenteSurveillee(enCours);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label id={`${id}-libelle`} htmlFor={id} className="text-base font-semibold">
          {QUESTION_GESTE}
        </label>
        {/* Le composant du dépôt (`ListeDeroulante`), jamais un `<select>` nu : il s'ouvre toujours
            vers le bas, y compris au pied d'une longue liste. */}
        <ListeDeroulante
          id={id}
          libelleId={`${id}-libelle`}
          libelle={QUESTION_GESTE}
          valeur={valeur}
          entrees={entreesGestes(gestes)}
          onChoisir={onChoisir}
          className="min-h-12 w-full rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte"
        />
      </div>
      {children}
      <ExplicationGeste explication={explication} />
      <Bouton variante={variante} taille="petite" disabled={inerte || enCours} aria-busy={enCours} className="w-full sm:w-auto sm:self-start" onClick={onLancer}>
        {/* **Pas la couleur seule pour dire « définitif »** : selon le thème du club, le rouge et la
            couleur principale peuvent se ressembler. Le pictogramme d'alerte le dit aussi. */}
        {variante === "danger" && !enCours && <Icone nom="alerte" taille={18} />}
        {enCours ? "Un instant…" : bouton}
      </Bouton>
      {/* Même garde que les autres boutons d'envoi (`BoutonEnvoi`, `BoutonAction`) : l'attente relance
          le rendu, et un serveur muet finit par se dire au lieu de laisser « Un instant… » pour toujours. */}
      {silence && <SansReponse />}
    </div>
  );
}
