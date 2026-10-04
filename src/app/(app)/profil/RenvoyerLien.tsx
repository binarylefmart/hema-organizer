"use client";

import { useState, useTransition } from "react";
import { renvoyerMonLien } from "@/actions/profil";
import { FORM_INITIAL, type FormState } from "@/lib/form";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/**
 * « Renvoyer mon lien ».
 *
 * La confirmation n'est pas une politesse : le lien n'est pas *renvoyé* mais **remplacé** (la base
 * n'en garde que l'empreinte SHA-256, rien ne peut le reconstituer). Quelqu'un qui a son lien ouvert
 * sur un autre appareil le perd — il doit le savoir avant, pas après.
 */
export function RenvoyerLien() {
  const [etat, setEtat] = useState<FormState>(FORM_INITIAL);
  const [enCours, demarrer] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {etat.erreur && <Alerte type="erreur">{etat.erreur}</Alerte>}
      {etat.succes && <Alerte type="succes">{etat.succes}</Alerte>}
      <Bouton
        type="button"
        variante="secondaire"
        taille="petite"
        disabled={enCours}
        aria-busy={enCours}
        className="self-start"
        onClick={() => {
          if (!window.confirm("Un nouveau lien va t'être envoyé par email, et l'ancien cessera aussitôt de fonctionner (y compris sur tes autres appareils). Continuer ?")) return;
          setEtat(FORM_INITIAL);
          demarrer(async () => setEtat(await renvoyerMonLien()));
        }}
      >
        <Icone nom="partage" taille={18} />
        {enCours ? "Envoi…" : "Renvoyer mon lien"}
      </Bouton>
    </div>
  );
}
