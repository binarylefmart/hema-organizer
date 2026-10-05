"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";

export type OptionSeance = { id: string; label: string; periode: string };

type Props = {
  /** La séance affichée par le panneau. */
  valeur: string;
  options: OptionSeance[];
};

/**
 * **La séance dont on corrige le registre**, choisie ici plutôt qu'en ouvrant la fiche du cours.
 *
 * Demandé par, puis, le même jour, « mets-le dans le panneau admin » — il a donc son propre écran,
 * *Présences*, à la suite de Membres. Le soir d'un cours, on tient le registre d'un seul endroit :
 * la liste déroulante remplace l'aller-retour Séances → la bonne date → Présences.
 *
 * La séance voyage dans l'URL (`?seance=<id>`), comme les autres filtres de l'application : la page
 * reste un composant serveur, l'écran se partage et se recharge tel quel, et le retour du
 * navigateur ramène la séance précédente.
 */
export function SelecteurSeance({ valeur, options }: Props) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  /*
   * **Les séances regroupées par période, dans l'ordre où elles arrivent** — c'étaient les
   * `<optgroup>` de la liste native. `grouper` (module de `ListeDeroulante`) fait un paquet par suite
   * d'entrées de même intitulé : on trie donc d'abord par période, dans l'ordre de première
   * apparition, pour qu'une période ne soit jamais coupée en deux paquets si le serveur mélangeait.
   */
  const periodes = [...new Set(options.map((o) => o.periode))];
  const entrees = periodes.flatMap((p) => options.filter((o) => o.periode === p).map((o) => ({ valeur: o.id, libelle: o.label, groupe: p })));

  const aller = (id: string) => {
    demarrer(() => router.push(`/admin/presences?seance=${id}`));
  };

  return (
    <div className="flex flex-col gap-1">
      <label id="registre-seance-libelle" className="font-semibold" htmlFor="registre-seance">
        Séance
      </label>
      {/* La liste du dépôt, jamais un `<select>` nu : une trentaine de séances par trimestre, et la
          liste native s'ouvrait vers le haut au gré de la place. Au-delà de vingt entrées, le
          panneau reçoit sa recherche — on y tape « 12 oct » au lieu de faire défiler un trimestre.
          Grisée le temps de la navigation (`disabled`), comme le `<select>` qu'elle remplace.
          Le plafond de largeur est posé sur une enveloppe et non sur le déclencheur : le panneau
          s'étale sur toute la largeur du `div` que pose `ListeDeroulante`, et il dépasserait
          sinon la case d'où il sort. */}
      <div className="w-full max-w-2xl">
        <ListeDeroulante
          id="registre-seance"
          libelleId="registre-seance-libelle"
          libelle="Séance"
          valeur={valeur}
          entrees={entrees}
          disabled={enCours}
          onChoisir={(id) => {
            // `change` ne partait pas quand on rechoisissait la séance affichée ; `onChoisir`, si :
            // pas de navigation (ni de transition qui griserait la liste) pour revenir au même endroit.
            if (id !== valeur) aller(id);
          }}
          className="min-h-12 w-full rounded-xl border-2 border-bordure bg-surface px-3 text-base text-texte shadow-champ focus:border-primaire disabled:cursor-wait disabled:opacity-60"
        />
      </div>
    </div>
  );
}
