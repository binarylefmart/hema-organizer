"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/**
 * Supprimer l'annonce qu'on est en train de lire.
 *
 * Différent du bouton de la liste (`BoutonAction`) sur un point : une fois l'annonce effacée, la
 * page qui l'affichait n'existe plus. On ramène donc au fil, sans laisser une seconde un écran qui
 * parle d'un événement disparu. `replace` plutôt que `push` : revenir en arrière doit ramener d'où
 * l'on vient, pas sur une page devenue introuvable.
 *
 * **Rouge, parce que c'est le seul geste de la fiche qui ne se reprend pas** (dépublier, lui, se
 * refait d'un clic) ; et le pictogramme d'alerte le dit aussi, la couleur seule ne suffisant pas —
 * selon le thème du club, le rouge et la couleur principale se ressemblent.
 */
export function BoutonSupprimerEvenement({ action, nom }: { action: () => Promise<unknown>; nom: string }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Bouton
        type="button"
        variante="danger"
        taille="petite"
        disabled={enCours}
        aria-busy={enCours}
        onClick={() => {
          if (!window.confirm(`Supprimer « ${nom} » ? Cette annonce disparaîtra pour tout le monde.`)) return;
          setErreur(null);
          demarrer(async () => {
            try {
              await action();
              router.replace("/evenements");
            } catch (e) {
              setErreur(e instanceof Error ? e.message : "La suppression a échoué.");
            }
          });
        }}
      >
        <Icone nom="alerte" taille={18} />
        {enCours ? "Suppression…" : "Supprimer"}
      </Bouton>
      {erreur && (
        <span role="alert" className="text-sm font-semibold text-rouge">
          {erreur}
        </span>
      )}
    </span>
  );
}
