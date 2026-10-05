"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publierEvenement, supprimerEvenement } from "@/actions/evenements";
import { Bouton } from "@/components/ui/Bouton";
import { ChoixGeste } from "@/components/ui/ChoixGeste";
import { Icone } from "@/components/ui/Icone";
import { gesteRetenu, messageApresGeste, varianteGeste } from "@/components/ui/choix-geste";
import { gestesEvenement, type GesteEvenement } from "./gestes-evenement";

/**
 * **« Que veux-tu faire ? » d'une annonce d'événement** — la forme commune (`ChoixGeste`), sur la page
 * de l'annonce et sur chaque ligne de la liste de gestion.
 *
 * Pas `GestesProposes` : deux gestes ont besoin du routeur, que l'écran serveur ne peut pas lier à
 * l'avance. « Modifier » **mène** au formulaire (`router.push`, comme « ouvrir » d'une séance), et la
 * suppression, sur la page de l'annonce, ramène au fil (`apresSuppression`) — sans laisser une seconde
 * un écran qui parle d'un événement disparu. `replace` plutôt que `push` : revenir en arrière doit
 * ramener d'où l'on vient, pas sur une page devenue introuvable. Dans la liste, la ligne s'en va
 * d'elle-même (l'action revalide la page).
 *
 * **Un seul geste possible : un bouton seul**, comme une carte d'atelier (`DecisionAtelier`) — une
 * liste d'une seule entrée serait une question sans choix. Avec la matrice actuelle, ça n'arrive qu'à
 * qui aurait `evenements.creer_supprimer` sans `evenements.edit`.
 */
export function GestesEvenement({
  id,
  nom,
  publie,
  modifier,
  supprimer,
  apresSuppression,
}: {
  id: string;
  nom: string;
  publie: boolean;
  /** `evenements.edit` : modifier, publier, dépublier. */
  modifier: boolean;
  /** `evenements.creer_supprimer` : supprimer. */
  supprimer: boolean;
  /** Où aller une fois l'annonce supprimée, quand la page affichée était la sienne. */
  apresSuppression?: string;
}) {
  const router = useRouter();
  const gestes = gestesEvenement({ nom, publie }, { modifier, supprimer });
  const [choisi, setChoisi] = useState<GesteEvenement | "">("");
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  // Une page revenue du serveur où le geste ne s'applique plus (publier → dépublier) : le choix
  // revient à « Choisir une action… » plutôt que de garder une valeur que la liste ne montre plus.
  const geste = gesteRetenu(choisi, gestes);
  useEffect(() => {
    if (geste !== choisi) setChoisi("");
  }, [geste, choisi]);
  const retenu = gestes.find((g) => g.geste === geste) ?? null;

  const lancer = (g: GesteEvenement) => {
    const offert = gestes.find((x) => x.geste === g);
    if (!offert) return;
    if (g === "modifier") {
      router.push(`/evenements/${id}/modifier`);
      return;
    }
    if (offert.confirmation && !window.confirm(offert.confirmation)) return;
    setMessage(null);
    demarrer(async () => {
      try {
        if (g === "supprimer") {
          await supprimerEvenement(id);
          if (apresSuppression) {
            router.replace(apresSuppression);
            return;
          }
        } else {
          await publierEvenement(id, g === "publier");
        }
        // Les deux actions ne répondent rien : le message d'après coup est celui du geste.
        setMessage(messageApresGeste(undefined, offert.fait));
        setChoisi("");
        router.refresh();
      } catch (e) {
        const texte = e instanceof Error ? e.message : "";
        if (texte.includes("NEXT_REDIRECT")) return;
        setMessage({ type: "erreur", texte: texte || "Le geste n'a pas abouti — vérifie ta connexion." });
      }
    });
  };

  if (gestes.length === 0) return null;
  const seul = gestes.length === 1 ? gestes[0] : null;
  // Un seul geste : son bouton suit la même règle que la liste — rouge, avec l'alerte, s'il retire ou efface.
  const seulRouge = seul !== null && varianteGeste(seul.definitif, seul.bouton) === "danger";

  return (
    <div className="flex w-full flex-col gap-2">
      {seul ? (
        <Bouton
          variante={varianteGeste(seul.definitif, seul.bouton) === "danger" ? "danger" : "secondaire"}
          taille="petite"
          className="self-start"
          disabled={enCours}
          aria-busy={enCours}
          onClick={() => lancer(seul.geste)}
        >
          {seulRouge && !enCours && <Icone nom="alerte" taille={18} />}
          {enCours ? "Un instant…" : seul.bouton}
        </Bouton>
      ) : (
        <ChoixGeste
          id={`geste-evenement-${id}`}
          gestes={gestes}
          valeur={geste}
          onChoisir={(v) => {
            setChoisi(gesteRetenu(v as GesteEvenement | "", gestes));
            setMessage(null);
          }}
          explication={retenu?.explication ?? null}
          bouton={retenu?.bouton ?? "Appliquer"}
          variante={varianteGeste(retenu?.definitif, retenu?.bouton)}
          inerte={!retenu}
          enCours={enCours}
          onLancer={() => retenu && lancer(retenu.geste)}
        />
      )}
      {/* Région vivante montée en permanence : créée avec son texte, elle ne serait pas annoncée. */}
      <p className="min-h-6 text-base" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>
    </div>
  );
}
