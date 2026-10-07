"use client";

import { useEffect, useRef } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/**
 * **La bulle qui montre les gestes de la liste**, en tête du planning sur téléphone : deux étapes,
 * une phrase chacune. Pendant la première, la ligne du dessous glisse toute seule pour montrer le
 * geste (`ListePartiesTelephone`) ; pendant la seconde, sa poignée est soulignée.
 *
 * Elle reprend le focus en passant à l'étape suivante (le bouton touché vient de disparaître) : un
 * lecteur d'écran lit la nouvelle phrase, et le bouton qui suit est au même endroit.
 */
export function DemoGestes({ etape, onSuivant, onCompris }: { etape: 1 | 2; onSuivant: () => void; onCompris: () => void }) {
  const bulle = useRef<HTMLDivElement>(null);
  const premiere = useRef(true);
  useEffect(() => {
    // Pas au premier affichage : la page s'ouvre là où on l'attend, la bulle s'y lit d'elle-même.
    if (premiere.current) {
      premiere.current = false;
      return;
    }
    bulle.current?.focus();
  }, [etape]);
  return (
    <div
      ref={bulle}
      tabIndex={-1}
      role="group"
      aria-labelledby="demo-gestes-titre"
      className="flex flex-col gap-2 rounded-2xl border-2 border-primaire/40 bg-primaire-doux p-3 text-texte"
    >
      <p id="demo-gestes-titre" className="flex items-center gap-2 font-semibold">
        <Icone nom="info" taille={18} className="text-primaire" />
        Geste {etape} sur 2
      </p>
      <p className="text-base">
        {etape === 1 ? (
          "Glisse une ligne vers la gauche pour la retirer. Le bouton rouge apparaît : touche-le pour confirmer."
        ) : (
          <>
            Tiens <Icone nom="poignee" taille={18} strokeWidth={3.5} className="inline align-text-bottom" titre="la poignée" /> puis glisse pour changer de
            place ou de partie.
          </>
        )}
      </p>
      <div className="flex justify-end">
        {etape === 1 ? (
          <Bouton type="button" variante="secondaire" taille="petite" onClick={onSuivant}>
            Suivant
          </Bouton>
        ) : (
          <Bouton type="button" taille="petite" onClick={onCompris}>
            Compris
          </Bouton>
        )}
      </div>
    </div>
  );
}
