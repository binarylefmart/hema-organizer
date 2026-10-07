"use client";

import { useState, useTransition, type ComponentProps } from "react";
import { Bouton } from "./Bouton";
import { SansReponse, useAttenteSurveillee } from "./attente-surveillee";

type Props = Omit<ComponentProps<typeof Bouton>, "onClick" | "type"> & {
  /** Action serveur à exécuter au clic */
  action: () => Promise<unknown>;
  /** Message de confirmation (window.confirm) avant exécution */
  confirmation?: string;
  enCours?: string;
};

/**
 * Bouton qui déclenche une server action (avec confirmation facultative) et affiche l'attente.
 *
 * **Il dit aussi ce que l'action a fait**. Seul `res.erreur` était affiché : tout le `succes` d'un
 * `FormState` tombait dans le vide. Les actions les plus bavardes passent pourtant par ici — «
 * Rouvrir la période » explique combien de liens ont été remis en service et qui n'en récupère pas,
 * « Reproposer » combien de dates reviennent. L'écran restait muet sur un geste dont le résultat
 * n'est visible nulle part ailleurs, et l'on recliquait.
 *
 * **« Un instant… » s'arrête quand le serveur a répondu**, pas quand React a fini son travail. Le
 * mot suivait `pending`, qui reste vrai pendant toute la transition — laquelle comprend le re-rendu
 * déclenché par les `revalidatePath` de l'action. Sur une fiche membre, la remise à zéro restait
 * ainsi sur « Un instant… » alors que le geste était fait et l'email déjà parti : on ne savait plus
 * s'il fallait recliquer. Même correction que sur les cases du planning — l'attente affichée suit
 * la **promesse de l'action**, et elle seule.
 *
 * **Et la transition qui suit est surveillée.** Le bouton rend la main à la réponse, mais l'écran ne
 * se met à jour qu'à la fin de la transition, qui peut rester suspendue (défaut du React embarqué
 * par Next 15.5, voir `src/lib/relance-rendu.ts`) : tant que la promesse **ou** la transition
 * dure, le rendu est relancé, et au-delà d'un délai l'écran propose de recharger.
 *
 * **`pleineLargeur` étire aussi l'enveloppe** : le bouton vit dans un `<span>` qui porte les messages
 * sous lui, et c'est ce `<span>` que voit la rangée qui le contient. Un `flex-1` passé au bouton ne
 * l'étirait donc pas à côté de son voisin ; `pleineLargeur` prend toute la place que la rangée laisse.
 */
export function BoutonAction({ action, confirmation, enCours = "Un instant…", children, ...props }: Props) {
  const [transition, start] = useTransition();
  const [enVol, setEnVol] = useState(false);
  const silence = useAttenteSurveillee(enVol || transition);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  return (
    <span className={props.pleineLargeur ? "flex min-w-0 flex-1 flex-col gap-1" : "inline-flex flex-col gap-1"}>
      <Bouton
        type="button"
        disabled={enVol}
        aria-busy={enVol}
        onClick={() => {
          if (confirmation && !window.confirm(confirmation)) return;
          setErreur(null);
          setSucces(null);
          setEnVol(true);
          start(async () => {
            try {
              const res = (await action()) as { erreur?: string; succes?: string } | undefined;
              if (res && typeof res === "object") {
                if (res.erreur) setErreur(res.erreur);
                else if (res.succes) setSucces(res.succes);
              }
            } catch (e) {
              // Une action qui redirige lève ici aussi (NEXT_REDIRECT) : le routeur s'en occupe,
              // il n'y a rien à dire à l'écran — et surtout pas « Erreur inattendue ».
              const message = e instanceof Error ? e.message : "Erreur inattendue.";
              if (!message.includes("NEXT_REDIRECT")) setErreur(message);
            } finally {
              setEnVol(false);
            }
          });
        }}
        {...props}
      >
        {enVol ? enCours : children}
      </Bouton>
      {silence && <SansReponse />}
      {erreur && (
        <span role="alert" className="max-w-prose text-sm font-semibold text-rouge">
          {erreur}
        </span>
      )}
      {/* `role="status"` et non `alert` : une réussite s'annonce sans interrompre la lecture. */}
      {succes && (
        <span role="status" className="max-w-prose text-sm font-semibold text-vert">
          {succes}
        </span>
      )}
    </span>
  );
}
