"use client";

import { Fragment, useState, type ReactNode } from "react";
import { AssistantAtelier } from "@/components/ateliers/AssistantAtelier";
import { nouvelleProposition } from "@/components/ateliers/assistant-atelier";
import { Bouton } from "@/components/ui/Bouton";
import { useEcranTelephone } from "@/components/ui/useEcranTelephone";
import type { FormState } from "@/lib/form";

type Seance = { id: string; date: string; heureDebut: string; lieu: string };
type Personne = { id: string; prenom: string; nom: string };

/**
 * **L'onglet Atelier, version téléphone** : « Mes propositions » d'abord, un bouton plein
 * « + Proposer un atelier », et l'assistant en quatre questions qui **remplace** la liste le temps
 * de la proposition (`AssistantAtelier`). Sur ordinateur, rien ne change : la page reçoit ses deux
 * colonnes telles quelles (`ordinateur`).
 *
 * Le serveur rend la version que le cookie `ecran` lui a dite (l'ordinateur à la première visite), et
 * le navigateur corrige au montage s'il le faut (`useEcranTelephone`). L'assistant reste **monté** pendant qu'on relit la liste :
 * « ‹ Retour » à la première étape ne jette pas ce qu'on avait commencé d'écrire.
 *
 * **Il ne repart de zéro qu'après un envoi réussi** — une proposition qu'on ne connaissait pas dans la
 * liste (`nouvelleProposition`). La clé suivait le nombre de propositions : retirer une ancienne
 * proposition pendant qu'on relisait la liste remontait l'assistant, et jetait le brouillon en cours.
 */
export function BasculeAteliers({
  ordinateur,
  propositions,
  action,
  seances,
  animateurs,
  moi,
  idsPropositions,
}: {
  ordinateur: ReactNode;
  /** « Mes propositions », rendue par le serveur (cartes, Modifier, Retirer). */
  propositions: ReactNode;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  seances: Seance[];
  animateurs: Personne[];
  moi: Personne;
  /** Les identifiants de « Mes propositions » : une nouvelle venue dit que l'envoi a réussi. */
  idsPropositions: readonly string[];
}) {
  const telephone = useEcranTelephone();
  const [assistant, setAssistant] = useState(false);
  // Miroir de la liste du serveur : une proposition neuve remonte les formulaires et revient à la liste.
  const [vus, setVus] = useState(idsPropositions);
  const [envois, setEnvois] = useState(0);
  if (vus !== idsPropositions && vus.join() !== idsPropositions.join()) {
    setVus(idsPropositions);
    if (nouvelleProposition(vus, idsPropositions)) {
      setEnvois((n) => n + 1);
      setAssistant(false);
    }
  }
  if (!telephone) return <Fragment key={envois}>{ordinateur}</Fragment>;
  return (
    <>
      <div hidden={assistant} className="flex flex-col gap-5">
        <Bouton taille="grande" pleineLargeur onClick={() => setAssistant(true)} data-proposer-atelier>
          + Proposer un atelier
        </Bouton>
        {propositions}
      </div>
      <div hidden={!assistant}>
        <AssistantAtelier key={envois} action={action} seances={seances} animateurs={animateurs} moi={moi} onQuitter={() => setAssistant(false)} />
      </div>
    </>
  );
}
