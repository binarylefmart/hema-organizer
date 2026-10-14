"use client";

import { useState, useTransition } from "react";
import { demanderReinitialisationDeuxFa } from "@/actions/profil";
import { FORM_INITIAL, type FormState } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/**
 * « Demander la réinitialisation de ma double authentification ».
 *
 * La confirmation dit ce qui va se passer — un message au bureau, pas une réinitialisation : rien ne
 * change sur le compte tant qu'une personne du bureau n'a pas vérifié et agi. Une fois partie, le
 * bouton s'efface derrière la réponse : il ne se renvoie qu'après six heures, le serveur le refuserait.
 */
/** Qui demande : ce que la réinitialisation entraînera n'est pas le même pour les trois. */
export type VarianteDemande = "bureau" | "portail" | "hors-bureau";

/** Ce que la demande déclenche, puis ce que la réinitialisation entraînera : dit avant l'envoi. */
export function confirmationDemande(variante: VarianteDemande): string {
  const lignes =
    variante === "hors-bureau"
      ? [
          "Demander au bureau de retirer ta double authentification ?",
          "",
          "• Un message part aux membres du bureau, et tu es prévenu(e) toi aussi.",
          "• Elle ne sert plus à ta connexion : une fois retirée, rien d'autre ne change pour toi.",
        ]
      : [
          "Demander au bureau de réinitialiser ta double authentification ?",
          "",
          "• Un message part aux autres membres du bureau, et tu es prévenu(e) toi aussi. Rien ne change sur ton compte tant que la réinitialisation n'est pas faite.",
          variante === "portail"
            ? "• Ce compte ne se réinitialise que par la commande de secours, sur le serveur : la personne qui gère le serveur vérifie avec toi, puis la lance."
            : "• Un membre du bureau vérifie d'abord avec toi, de vive voix, puis réinitialise.",
          "• Une fois réinitialisée : ton application de codes et tes codes de secours ne servent plus, et tu es déconnecté(e) de tous tes appareils.",
          "• À ta connexion suivante, tu devras scanner un nouveau QR code et noter de nouveaux codes de secours avant de continuer.",
        ];
  return lignes.join("\n");
}

export function DemanderReinitialisationDeuxFa({ variante }: { variante: VarianteDemande }) {
  const [etat, setEtat] = useState<FormState>(FORM_INITIAL);
  const [enCours, demarrer] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {etat.erreur && <Alerte type="erreur">{etat.erreur}</Alerte>}
      {etat.succes ? (
        <Alerte type="succes">{etat.succes}</Alerte>
      ) : (
        <Bouton
          type="button"
          variante="secondaire"
          taille="petite"
          disabled={enCours}
          aria-busy={enCours}
          className="self-start"
          onClick={() => {
            if (!window.confirm(confirmationDemande(variante))) return;
            setEtat(FORM_INITIAL);
            demarrer(async () => setEtat(await demanderReinitialisationDeuxFa()));
          }}
        >
          <Icone nom="alerte" taille={18} />
          {enCours ? "Envoi…" : variante === "hors-bureau" ? "Demander le retrait de ma double authentification" : "Demander la réinitialisation de ma double authentification"}
        </Bouton>
      )}
    </div>
  );
}
