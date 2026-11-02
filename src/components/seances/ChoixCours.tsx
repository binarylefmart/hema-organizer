"use client";

import { useState, useTransition } from "react";
import { choisirCours } from "@/actions/presences";
import { compteApres, libelleCompte, type ChoixCoursCarte } from "./choix-cours";

/**
 * **« Quels cours vas-tu suivre ? »** — sous les boutons de réponse d'une carte de séance, quand le club
 * a ouvert le choix des cours (retours du club d'Arras).
 *
 * - Réponse « Présent », cours pas commencé : une case par cours, option ou atelier (jamais
 *   l'échauffement), plusieurs possibles, facultatif. Un appui = enregistré, le compteur suit tout
 *   de suite, et revient en arrière si le serveur refuse.
 * - Sinon : les seuls compteurs, en une ligne (« Épée longue : 5 inscrits · Messer : 3 inscrits »),
 *   pour que chacun voie comment le cours se répartit.
 *
 * L'état local est **semé par le serveur et miroir de lui** (`vuDuServeur`, règle du dépôt) : quand
 * la page revient avec d'autres choix — réponse passée à « Absent », correction ailleurs —, le
 * serveur reprend la main.
 */
export function ChoixCours({ choix, statut, verrouille }: { choix: ChoixCoursCarte; statut: string | null; verrouille: boolean }) {
  const serveur = choix.mesChoix.join(",");
  const [vuDuServeur, setVuDuServeur] = useState(serveur);
  const [mesChoix, setMesChoix] = useState<ReadonlySet<string>>(() => new Set(choix.mesChoix));
  const [erreur, setErreur] = useState<string | null>(null);
  const [, demarrer] = useTransition();
  if (vuDuServeur !== serveur) {
    setVuDuServeur(serveur);
    setMesChoix(new Set(choix.mesChoix));
  }
  if (choix.options.length === 0) return null;

  const present = statut === "PRESENT";
  const avant = new Set(choix.mesChoix);
  // « Absent » efface les choix côté serveur : l'écran n'attend pas le retour pour les retirer du compte.
  const actuels: ReadonlySet<string> = statut === "ABSENT" ? new Set() : mesChoix;
  const comptes = new Map(choix.options.map((o) => [o.partieId, compteApres(o, avant, actuels)]));

  if (!present || verrouille) {
    const lignes = choix.options.filter((o) => (comptes.get(o.partieId) ?? 0) > 0);
    if (lignes.length === 0) return null;
    return (
      <p className="text-base text-texte-secondaire">
        <span className="font-semibold text-texte">Cours choisis : </span>
        {lignes.map((o) => `${o.nom} — ${libelleCompte(comptes.get(o.partieId) ?? 0)}`).join(" · ")}
      </p>
    );
  }

  const basculer = (partieId: string) => {
    const choisi = !mesChoix.has(partieId);
    const suite = new Set(mesChoix);
    if (choisi) suite.add(partieId);
    else suite.delete(partieId);
    setMesChoix(suite);
    setErreur(null);
    demarrer(async () => {
      const res = await choisirCours({ partieId, choisi }).catch(() => ({ ok: false as const, erreur: "Le choix n'a pas abouti — vérifie ta connexion." }));
      if (!res.ok) {
        setMesChoix((s) => {
          const retour = new Set(s);
          if (choisi) retour.delete(partieId);
          else retour.add(partieId);
          return retour;
        });
        setErreur(res.erreur);
      }
    });
  };

  return (
    <fieldset className="flex flex-col gap-1 rounded-xl bg-surface-douce px-3 py-2">
      <legend className="sr-only">Quels cours vas-tu suivre ?</legend>
      <p className="font-semibold">
        Quels cours vas-tu suivre ? <span className="font-normal text-texte-secondaire">(facultatif, plusieurs possibles)</span>
      </p>
      {choix.options.map((o) => (
        <label key={o.partieId} className="flex min-h-12 cursor-pointer items-center gap-3">
          <input type="checkbox" checked={mesChoix.has(o.partieId)} onChange={() => basculer(o.partieId)} className="size-6 shrink-0 accent-primaire" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{o.nom}</span>
            {o.detail ? <span className="text-texte-secondaire"> · {o.detail}</span> : null}
          </span>
          <span className="shrink-0 text-sm tabular-nums text-texte-secondaire">{libelleCompte(comptes.get(o.partieId) ?? 0)}</span>
        </label>
      ))}
      <p className="min-h-0 text-sm" aria-live="polite">
        {erreur ? <span className="font-semibold text-rouge">{erreur}</span> : null}
      </p>
    </fieldset>
  );
}
