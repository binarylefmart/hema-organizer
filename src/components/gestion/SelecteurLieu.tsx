"use client";

import { useState } from "react";
import { lieuConnu, type Lieu } from "@/lib/lieux";
import { Champ } from "@/components/ui/Champ";
import { ChampListe } from "@/components/ui/ChampListe";

/**
 * Lieu d'un cours : l'une des salles habituelles du club, ou « Autre » (nom + adresse à préciser).
 * Envoie toujours `lieu` et `adresse` dans le formulaire (champs cachés pour les lieux connus).
 *
 * La liste des salles est un **réglage du club** (`src/lib/lieux.ts`, écran *Thèmes et lieux*) et
 * arrive donc en propriété : ce composant est client, il ne lit rien en base. **Tant qu'aucune salle
 * n'est réglée — le cas d'un club qui vient d'installer l'outil — la liste déroulante disparaît** et
 * il ne reste que les deux champs libres : proposer un menu d'un seul choix, « Autre lieu… », serait
 * un geste de plus pour rien.
 */
export function SelecteurLieu({ lieux, lieu = "", adresse = "", prefixe = "" }: { lieux: Lieu[]; lieu?: string; adresse?: string; prefixe?: string }) {
  const connu = lieuConnu(lieux, lieu);
  const [choix, setChoix] = useState<string>(connu ? connu.cle : lieu || lieux.length === 0 ? "autre" : lieux[0].cle);
  const [libre, setLibre] = useState({ lieu: connu ? "" : lieu, adresse: connu ? "" : adresse });
  const selection = lieux.find((l) => l.cle === choix);
  return (
    <div className="flex flex-col gap-4">
      {lieux.length > 0 && (
        <ChampListe
          label="Lieu"
          name={`${prefixe}choixLieu`}
          id={`${prefixe}choixLieu`}
          valeur={choix}
          onChange={setChoix}
          entrees={[...lieux.map((l) => ({ valeur: l.cle, libelle: l.lieu })), { valeur: "autre", libelle: "Autre lieu…" }]}
        />
      )}
      {selection ? (
        <>
          <input type="hidden" name="lieu" value={selection.lieu} />
          <input type="hidden" name="adresse" value={selection.adresse} />
          <p className="-mt-2 text-sm text-texte-secondaire">{selection.adresse}</p>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ label="Nom du lieu" name="lieu" id={`${prefixe}lieu`} value={libre.lieu} onChange={(e) => setLibre({ ...libre, lieu: e.target.value })} required maxLength={120} placeholder="ex. Gymnase municipal" />
          <Champ label="Adresse (pour la carte)" name="adresse" id={`${prefixe}adresse`} value={libre.adresse} onChange={(e) => setLibre({ ...libre, adresse: e.target.value })} maxLength={200} placeholder="ex. 1 rue du Stade, code postal et ville" />
        </div>
      )}
    </div>
  );
}
