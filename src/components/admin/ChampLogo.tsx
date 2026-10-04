"use client";

import { AFFICHE_TAILLE_MAX, AFFICHE_TAILLE_MAX_LIBELLE } from "@/lib/constants";

import { useState, useTransition } from "react";
import { definirLogo, televerserLogo } from "@/actions/identite";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/** Les trois formats que tous les téléphones et tous les navigateurs savent produire. */
const FORMATS = ["image/jpeg", "image/png", "image/webp"] as const;
// Le plafond et **les mots qui l'annoncent** viennent du même endroit (`src/lib/constants.ts`, qui
// ne dépend de rien) : c'est ce qui empêche l'écran de promettre 4 Mo pendant que le serveur en
// refuse 2. Le dire avant l'envoi reste utile — on n'attend pas la montée pour être refusé.

type Props = {
  emplacement: "logo" | "ecu";
  titre: string;
  aide: string;
  /** L'image affichée aujourd'hui (déposée ou livrée avec le code). */
  source: string;
  /** Vraie si cette image a été déposée : c'est ce qui décide du bouton « Remettre celui d'origine ». */
  deposee: boolean;
  /** Fond sombre derrière l'aperçu : un logo à texte noir ne se juge pas sur du blanc seulement. */
  apercuSombre?: boolean;
};

/**
 * **Le dépôt d'un des deux logos du club**, dans l'écran *Identité*.
 *
 * Deux gestes seulement — choisir une image, ou remettre celle d'origine — et l'aperçu qui va avec :
 * un logo se juge à l'œil, pas à son nom de fichier. L'image part dès qu'elle est choisie (il n'y a
 * rien d'autre à décider), et l'écran se recharge pour que l'en-tête montre tout de suite le
 * résultat : c'est la seule manière de voir ce qu'on vient de faire là où ça compte.
 *
 * Pas de glisser-déposer ici, à la différence de l'affiche d'un événement : c'est un réglage qu'on
 * fait une fois, souvent sur le téléphone du bureau, où il n'existe pas. Un vrai `<input
 * type="file">` porté par un `<label>` fonctionne partout, au doigt comme au clavier.
 */
export function ChampLogo({ emplacement, titre, aide, source, deposee, apercuSombre = false }: Props) {
  const [message, setMessage] = useState<{ texte: string; ton: "info" | "erreur" } | null>(null);
  /**
   * L'attente suit la **promesse de l'action**, jamais `pending` — même règle que `BoutonAction`.
   * Un logo un peu lourd était refusé par Next **avant** d'entrer dans l'action : la promesse
   * rejetait sans produire de `depot.erreur`, et le bouton restait sur « Envoi… » pour toujours.
   */
  const [, demarrer] = useTransition();
  const [envoi, setEnvoi] = useState(false);

  function traiter(fichier: File) {
    if (!(FORMATS as readonly string[]).includes(fichier.type)) {
      setMessage({ texte: "Ce fichier n'est pas une image JPEG, PNG ou WebP.", ton: "erreur" });
      return;
    }
    if (fichier.size > AFFICHE_TAILLE_MAX) {
      setMessage({ texte: `L'image dépasse ${AFFICHE_TAILLE_MAX_LIBELLE} — choisis-en une plus légère.`, ton: "erreur" });
      return;
    }
    setMessage(null);
    setEnvoi(true);
    demarrer(async () => {
      try {
        const donnees = new FormData();
        donnees.set("fichier", fichier);
        const depot = await televerserLogo(donnees);
        if (!depot.ok) {
          setMessage({ texte: depot.erreur, ton: "erreur" });
          return;
        }
        const suite = await definirLogo(emplacement, depot.url);
        setMessage(suite.erreur ? { texte: suite.erreur, ton: "erreur" } : { texte: suite.succes ?? "Enregistré.", ton: "info" });
      } catch {
        setMessage({ texte: "L'envoi de l'image a échoué. Vérifie ta connexion, puis réessaie — ou choisis une image plus légère.", ton: "erreur" });
      } finally {
        setEnvoi(false);
      }
    });
  }

  function remettreDorigine() {
    setMessage(null);
    setEnvoi(true);
    demarrer(async () => {
      try {
        const suite = await definirLogo(emplacement, "");
        setMessage(suite.erreur ? { texte: suite.erreur, ton: "erreur" } : { texte: suite.succes ?? "Rétabli.", ton: "info" });
      } catch {
        setMessage({ texte: "Le rétablissement a échoué. Vérifie ta connexion, puis réessaie.", ton: "erreur" });
      } finally {
        setEnvoi(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-semibold">{titre}</p>
      <div className="flex flex-wrap items-center gap-4">
        <span className={`inline-flex size-24 items-center justify-center rounded-2xl border border-bordure/60 p-2 ${apercuSombre ? "bg-encre" : "bg-white"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- image déposée : dimensions inconnues à la compilation */}
          <img src={source} alt="" className="max-h-full max-w-full object-contain" />
        </span>
        <div className="flex flex-col gap-2">
          <label className="inline-flex min-h-12 w-fit cursor-pointer items-center gap-2 rounded-xl border-2 border-bordure bg-surface px-4 font-semibold text-texte shadow-champ hover:border-primaire">
            <Icone nom="etendard" taille={20} />
            {envoi ? "Envoi…" : "Choisir une image"}
            <input
              type="file"
              accept={FORMATS.join(",")}
              className="sr-only"
              disabled={envoi}
              onChange={(e) => {
                const fichier = e.target.files?.[0];
                // Le champ est remis à zéro : sans cela, redéposer deux fois le même fichier
                // n'émettrait aucun événement la seconde fois.
                e.target.value = "";
                if (fichier) traiter(fichier);
              }}
            />
          </label>
          {deposee && (
            <Bouton type="button" variante="secondaire" taille="petite" onClick={remettreDorigine} disabled={envoi}>
              Remettre celui d&apos;origine
            </Bouton>
          )}
        </div>
      </div>
      <p className="text-sm text-texte-secondaire">{aide}</p>
      {message && (
        <p className={`text-sm font-semibold ${message.ton === "erreur" ? "text-rouge" : "text-vert"}`} role="status">
          {message.texte}
        </p>
      )}
    </div>
  );
}
