"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { definirSaisonMembre } from "@/actions/membres";
import { ListeDeroulante, type EntreeListe } from "@/components/ui/ListeDeroulante";

/**
 * **La saison d'arrivée au club, sur la fiche d'un membre au téléphone** : une liste qui enregistre au
 * choix, comme le rôle juste au-dessus (`SelecteurRole`) — même miroir de la valeur du serveur
 * (`vuDuServeur`), même silence quand tout va bien, même refus annoncé. La fiche est relue ensuite :
 * la ligne « N-ième saison au club » doit suivre. Sur ordinateur, le champ vit dans « Identité et rôle ».
 */
export function SelecteurSaison({ userId, valeur: valeurServeur, entrees, nom, disabled = false }: { userId: string; valeur: string; entrees: EntreeListe[]; nom: string; disabled?: boolean }) {
  const [valeur, setValeur] = useState(valeurServeur);
  const [erreur, setErreur] = useState<string | null>(null);
  const [vuDuServeur, setVuDuServeur] = useState(valeurServeur);
  const [, start] = useTransition();
  const router = useRouter();
  if (vuDuServeur !== valeurServeur) {
    setVuDuServeur(valeurServeur);
    setValeur(valeurServeur);
    setErreur(null);
  }
  const choisir = (choix: string) => {
    if (choix === valeur) return;
    setValeur(choix);
    setErreur(null);
    start(async () => {
      const res = await definirSaisonMembre(userId, choix).catch(() => ({ erreur: "Changement impossible — vérifie ta connexion." }));
      if (res?.erreur) {
        setErreur(res.erreur);
        setValeur(valeurServeur);
      } else {
        router.refresh();
      }
    });
  };
  return (
    <div className="flex flex-col gap-1">
      <label id={`saison-${userId}-libelle`} className="font-semibold" htmlFor={`saison-${userId}`}>
        Arrivé(e) au club la saison
      </label>
      <ListeDeroulante
        id={`saison-${userId}`}
        libelleId={`saison-${userId}-libelle`}
        libelle={`Saison d'arrivée de ${nom}`}
        valeur={valeur}
        entrees={entrees}
        onChoisir={choisir}
        disabled={disabled}
        className="min-h-12 w-full rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte focus:border-primaire"
      />
      <span className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">
        {erreur ?? ""}
      </span>
    </div>
  );
}
