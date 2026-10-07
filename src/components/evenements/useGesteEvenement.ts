"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publierEvenement, supprimerEvenement } from "@/actions/evenements";
import { messageApresGeste } from "@/components/ui/choix-geste";
import type { GesteEvenementOffert } from "./gestes-evenement";

export type MessageGeste = { type: "ok" | "erreur"; texte: string };

/**
 * **Lancer un geste sur une annonce** — la seule écriture des gestes, partagée par « Que veux-tu
 * faire ? » (`GestesEvenement`, ordinateur et fiche) et par les lignes du téléphone
 * (`ListeEvenementsTelephone`). Deux présentations, un seul chemin : la même confirmation (celle du
 * geste offert, mot pour mot), les mêmes actions serveur, le même message d'après coup.
 *
 * Le geste reçu est celui que `gestesEvenement` a **offert** : un geste que les droits n'ouvrent pas
 * n'arrive jamais ici, et le serveur refuserait de toute façon.
 */
export function useGesteEvenement() {
  const router = useRouter();
  const [message, setMessage] = useState<MessageGeste | null>(null);
  const [enCours, demarrer] = useTransition();

  const lancer = (
    id: string,
    offert: GesteEvenementOffert,
    {
      apresSuppression,
      apres,
    }: {
      /** Où aller une fois l'annonce supprimée, quand la page affichée était la sienne. */
      apresSuppression?: string;
      /** Ce que l'écran remet en place après un geste réussi (le choix de la liste, le volet). */
      apres?: () => void;
    } = {},
  ) => {
    if (offert.geste === "modifier") {
      router.push(`/evenements/${id}/modifier`);
      return;
    }
    if (offert.confirmation && !window.confirm(offert.confirmation)) return;
    setMessage(null);
    demarrer(async () => {
      try {
        if (offert.geste === "supprimer") {
          await supprimerEvenement(id);
          if (apresSuppression) {
            router.replace(apresSuppression);
            return;
          }
        } else {
          await publierEvenement(id, offert.geste === "publier");
        }
        // Les deux actions ne répondent rien : le message d'après coup est celui du geste.
        setMessage(messageApresGeste(undefined, offert.fait));
        apres?.();
        router.refresh();
      } catch (e) {
        const texte = e instanceof Error ? e.message : "";
        if (texte.includes("NEXT_REDIRECT")) return;
        setMessage({
          type: "erreur",
          texte: texte || "Le geste n'a pas abouti — vérifie ta connexion.",
        });
      }
    });
  };

  return { lancer, enCours, message, setMessage };
}
