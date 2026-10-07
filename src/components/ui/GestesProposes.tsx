"use client";

import { useEffect, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { ChoixGeste } from "./ChoixGeste";
import { GestesVolet } from "./GestesVolet";
import { gesteRetenu, messageApresGeste, varianteGeste, type GesteOffert } from "./choix-geste";

/** Un geste prêt à partir : ses mots (composés par l'écran serveur) et l'action déjà liée. */
export type GestePret = GesteOffert & { action: () => Promise<unknown> };

/**
 * **« Que veux-tu faire ? » avec des actions toutes prêtes** — la carte d'une fiche, le volet « Pour
 * tout le monde » : l'écran serveur compose les gestes applicables (mots, explication, confirmation,
 * action liée), et ce composant ne fait que demander lequel lancer.
 *
 * - le choix part de « Choisir une action… », et le bouton reste inerte tant que rien n'est choisi ;
 * - **la confirmation de chaque geste est gardée** : l'explication la précède, elle ne la remplace pas ;
 * - après le geste, le message reste et le choix revient à « Choisir une action… » — le geste suivant
 *   se choisit, il ne se rejoue pas ; si le serveur renvoie une page où le geste ne s'applique plus, le
 *   choix y revient aussi.
 *
 * `presentation="volet"` pose la même mécanique dans le volet du téléphone (`GestesVolet`, rendu dans
 * un `VoletBas`) : mêmes gestes, mêmes confirmations, mêmes messages — seule la présentation change.
 * `note` y passe en tête de la liste des gestes (ce que l'écran range à côté d'eux).
 */
export function GestesProposes({
  id,
  gestes,
  presentation = "liste",
  note,
}: {
  id: string;
  gestes: readonly GestePret[];
  presentation?: "liste" | "volet";
  note?: ReactNode;
}) {
  const [choisi, setChoisi] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const geste = gesteRetenu(choisi, gestes);
  useEffect(() => {
    if (geste !== choisi) setChoisi("");
  }, [geste, choisi]);
  const retenu = gestes.find((g) => g.geste === geste) ?? null;

  const lancer = () => {
    if (!retenu) return;
    if (retenu.confirmation && !window.confirm(retenu.confirmation)) return;
    setMessage(null);
    demarrer(async () => {
      try {
        const apres = messageApresGeste(await retenu.action(), retenu.fait);
        setMessage(apres);
        if (apres.type === "ok") setChoisi("");
      } catch (e) {
        const texte = e instanceof Error ? e.message : "";
        // Une action qui redemande le code 2FA, ou qui emmène ailleurs (une suppression), redirige :
        // la redirection lève ici, et le routeur s'en charge.
        if (texte.includes("NEXT_REDIRECT")) return;
        setMessage({ type: "erreur", texte: texte || "Le geste n'a pas abouti — vérifie ta connexion." });
      }
    });
  };

  if (presentation === "volet") {
    return (
      <GestesVolet
        gestes={gestes}
        valeur={geste}
        onChoisir={(v) => {
          setChoisi(gesteRetenu(v, gestes));
          setMessage(null);
        }}
        rouge={(v) => {
          const g = gestes.find((x) => x.geste === v);
          return varianteGeste(g?.definitif, g?.bouton) === "danger";
        }}
        explication={retenu?.explication ?? null}
        bouton={retenu?.bouton ?? "Appliquer"}
        variante={varianteGeste(retenu?.definitif, retenu?.bouton)}
        inerte={!retenu}
        enCours={enCours}
        onLancer={lancer}
        message={message}
        note={note}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ChoixGeste
        id={id}
        gestes={gestes}
        valeur={geste}
        onChoisir={(v) => {
          setChoisi(gesteRetenu(v, gestes));
          setMessage(null);
        }}
        explication={retenu?.explication ?? null}
        bouton={retenu?.bouton ?? "Appliquer"}
        variante={varianteGeste(retenu?.definitif, retenu?.bouton)}
        inerte={!retenu}
        enCours={enCours}
        onLancer={lancer}
      />
      {/* Région vivante montée en permanence : créée avec son texte, elle ne serait pas annoncée. */}
      <p className="min-h-6 text-base" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>
    </div>
  );
}
