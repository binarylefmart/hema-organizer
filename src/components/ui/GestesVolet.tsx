"use client";

import type { ReactNode } from "react";
import { Bouton } from "./Bouton";
import { Icone } from "./Icone";
import { ExplicationGeste } from "./ExplicationGeste";
import type { Explication } from "./choix-geste";
import { SansReponse, useAttenteSurveillee } from "./attente-surveillee";

/**
 * **« Que veux-tu faire ? », dans le volet du téléphone** (`VoletBas`) — le pendant de `ChoixGeste`,
 * avec **les mêmes entrées** : les gestes applicables, le geste retenu, son explication, l'unique
 * bouton (un verbe et un nombre) et sa variante. Seule la présentation change :
 *
 * - **sans geste choisi**, la liste des gestes en gros boutons pleine largeur, chacun en toutes
 *   lettres et avec son nombre — rouge, pictogramme d'alerte compris, pour ce qui enlève quelque chose ;
 * - **un geste choisi**, ses réglages (`children`) dans le même volet, son explication, puis le
 *   bouton qui dit ce qu'il fait ; « ‹ Retour » revient à la liste des gestes.
 *
 * Il ne sait rien des gestes : l'écran calcule tout, garde le choix et lance l'action avec la
 * confirmation qu'il avait déjà. Une liste déroulante au milieu d'un volet aurait fait deux panneaux
 * superposés pour un seul choix — ici, choisir est un appui.
 */
export function GestesVolet<G extends string>({
  gestes,
  valeur,
  onChoisir,
  rouge,
  explication,
  bouton,
  variante,
  inerte,
  enCours,
  onLancer,
  onRetour,
  message,
  note,
  children,
}: {
  gestes: readonly { geste: G; libelle: string }[];
  valeur: G | "";
  onChoisir: (geste: G | "") => void;
  /** Les gestes qui enlèvent quelque chose : rouges dans la liste, comme leur bouton. */
  rouge?: (geste: G) => boolean;
  explication: Explication | null;
  bouton: string;
  variante: "primaire" | "danger";
  inerte: boolean;
  enCours: boolean;
  onLancer: () => void;
  /** Un geste en plusieurs étapes (le planning) reprend la main sur « Retour » : sinon, retour à la liste. */
  onRetour?: () => void;
  /** Le résultat du dernier geste, montré dans le volet — la page en garde l'annonce vivante. */
  message?: { type: "ok" | "erreur"; texte: string } | null;
  /** Ce que l'écran doit dire en tête, quel que soit l'état du volet (lignes sans case, et pourquoi). */
  note?: ReactNode;
  children?: ReactNode;
}) {
  const silence = useAttenteSurveillee(enCours);
  const choisi = gestes.find((g) => g.geste === valeur);
  const avis = message ? (
    <p
      className={`font-semibold ${message.type === "ok" ? "text-vert" : "text-rouge"}`}
    >
      {message.texte}
    </p>
  ) : null;

  if (!choisi) {
    return (
      <>
        {avis}
        {note}
        {gestes.length === 0 ? (
          <p className="text-texte-secondaire">
            Aucun geste ne s&apos;applique à cette sélection.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {gestes.map((g) => {
              return (
                <li key={g.geste}>
                  <EntreeVolet
                    libelle={g.libelle}
                    rouge={rouge?.(g.geste) ?? false}
                    onClick={() => onChoisir(g.geste)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  return (
    <>
      <Bouton
        type="button"
        variante="discret"
        taille="petite"
        className="-ml-2 self-start"
        disabled={enCours}
        onClick={() => (onRetour ? onRetour() : onChoisir(""))}
      >
        {/* « ‹ Retour », toujours ce mot : c'est le lexique de tous les sous-écrans du téléphone. */}
        <span aria-hidden>‹</span> Retour
      </Bouton>
      <h3 className="text-lg font-bold">{choisi.libelle}</h3>
      {children}
      <ExplicationGeste explication={explication} />
      <Bouton
        variante={variante}
        disabled={inerte || enCours}
        aria-busy={enCours}
        pleineLargeur
        onClick={onLancer}
      >
        {variante === "danger" && !enCours && (
          <Icone nom="alerte" taille={18} />
        )}
        {enCours ? "Un instant…" : bouton}
      </Bouton>
      {silence && <SansReponse />}
      {avis}
    </>
  );
}

/**
 * **Une entrée de la liste du volet** : un gros bouton pleine largeur qui mène plus loin (→). Rouge,
 * pictogramme d'alerte compris, pour ce qui enlève quelque chose. Exportée pour les volets qui rangent
 * autre chose que des gestes à côté d'eux (un formulaire existant, l'annuaire) : la même ligne partout.
 */
export function EntreeVolet({
  libelle,
  rouge = false,
  onClick,
}: {
  libelle: string;
  rouge?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 bg-surface px-4 py-2 text-left text-base font-semibold shadow-carte transition active:scale-[0.98] ${
        rouge ? "border-rouge/60 text-rouge" : "border-bordure/70 text-texte"
      }`}
    >
      {/* Pas la couleur seule pour dire « définitif » : le pictogramme le dit aussi. */}
      {rouge && <Icone nom="alerte" taille={20} />}
      <span className="min-w-0 flex-1">{libelle}</span>
      {/* Le chevron des lignes de `ListeGroupee` : « plus loin » se dessine pareil partout. */}
      <Icone nom="chevronBas" taille={22} className="shrink-0 -rotate-90" />
    </button>
  );
}
