"use client";

import { useRef, useState, useTransition } from "react";
import { enregistrerTheme } from "@/actions/seances";
import { Champ } from "@/components/ui/Champ";

/**
 * Thème détaillé enregistré automatiquement à la sortie du champ (ou après 1,5 s d'inactivité).
 *
 * **L'alternative ne s'y saisit plus** : les options et cours du planning de la séance la remplacent.
 *
 * **C'est le seul éditeur du thème sur la fiche d'une séance**. Le formulaire « Modifier
 * la séance », en bas de la même page, les portait aussi : deux éditeurs du même champ, dont un
 * seul se remontait à la valeur fraîche. On mettait « Dague » en bas, on enregistrait — et ce
 * widget-ci affichait encore « Messer », puisque son état n'était semé qu'au montage. Toucher
 * l'alternative ici renvoyait alors `{theme: "Messer"}` et **écrasait « Dague »**, sous un «
 * Enregistré automatiquement ». Le formulaire du bas ne fait plus que **poster** les deux valeurs
 * du serveur, sans les montrer (voir `FormulaireSeance`).
 */
export function ThemeAutosave({ sessionId, theme }: { sessionId: string; theme: string }) {
  const [valeurs, setValeurs] = useState({ theme });
  const [etat, setEtat] = useState<"idle" | "attente" | "sauvegarde" | "ok" | "erreur">("idle");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const derniere = useRef({ theme });

  const sauver = (v: { theme: string }) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (v.theme === derniere.current.theme) return;
    setEtat("sauvegarde");
    start(async () => {
      const res = await enregistrerTheme({ sessionId, ...v });
      if (res.erreur) setEtat("erreur");
      else {
        derniere.current = v;
        setEtat("ok");
      }
    });
  };
  const changer = (valeur: string) => {
    const v = { theme: valeur };
    setValeurs(v);
    setEtat("attente");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      sauver(v);
    }, 1500);
  };

  /**
   * **Le serveur reprend la main dès qu'il dit autre chose** — même patron que les cases du planning
   * (`vuDuServeur`, dans `CaseEditeur`) et que la liste déroulante des rôles (`SelecteurRole`).
   *
   * Un état semé par une propriété ne l'est qu'**au montage** : sans ce miroir, ce widget continue
   * d'afficher le thème du chargement de la page alors que le serveur en renvoie un autre (une
   * modification faite ailleurs, par quelqu'un d'autre ou dans un autre onglet) — et le premier
   * enregistrement automatique renvoie l'ancienne valeur par-dessus la bonne.
   *
   * **La reprise est ciblée, comme celle d'une case** : elle n'a lieu qu'au repos (rien en attente,
   * rien en vol) et seulement si rien n'a été tapé depuis le dernier envoi. Sans cette garde, la
   * valeur fraîche revenue de notre propre enregistrement effacerait les lettres tapées entre-temps.
   */
  const [vuDuServeur, setVuDuServeur] = useState({ theme });
  if (vuDuServeur.theme !== theme) {
    setVuDuServeur({ theme });
    const auRepos = timer.current === null && !pending && etat !== "attente" && etat !== "sauvegarde";
    const rienDeSaisi = valeurs.theme === derniere.current.theme;
    if (auRepos && rienDeSaisi) {
      derniere.current = { theme };
      setValeurs({ theme });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Champ label="Thème détaillé (facultatif, affiché sur la carte)" name="theme" value={valeurs.theme} onChange={(e) => changer(e.target.value)} onBlur={() => sauver(valeurs)} maxLength={120} placeholder="ex. Messer — garde haute" />
      <p className="min-h-5 text-sm" aria-live="polite">
        {etat === "attente" && <span className="text-texte-secondaire">Modifications en attente…</span>}
        {(etat === "sauvegarde" || pending) && etat !== "ok" && etat !== "erreur" && <span className="text-texte-secondaire">Enregistrement…</span>}
        {etat === "ok" && !pending && <span className="font-semibold text-vert">Enregistré automatiquement.</span>}
        {etat === "erreur" && <span className="font-semibold text-rouge">Échec de l&apos;enregistrement, réessaie.</span>}
      </p>
    </div>
  );
}
