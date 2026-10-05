"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { annulerSeance, retablirSeance, supprimerSeance } from "@/actions/seances";
import { ChoixGeste } from "@/components/ui/ChoixGeste";
import { Champ } from "@/components/ui/Champ";
import { gesteRetenu, messageApresGeste, varianteGeste } from "@/components/ui/choix-geste";
import { gestesSeance, type GesteSeance } from "./gestes-seance";

/**
 * **« Que veux-tu faire ? » d'une séance** — la même forme que l'administration (`ChoixGeste`), au
 * pied d'une carte de l'onglet Séances et sur la fiche d'une séance, en mode modification seulement.
 *
 * Les gestes viennent de `gestesSeance` (module pur) : seuls ceux qui s'appliquent sont proposés.
 * L'annulation demande son motif **sous la liste**, là où `ChoixGeste` réserve la place d'un réglage,
 * et le bouton reste inerte tant que le motif est vide. Les confirmations d'avant sont gardées.
 */
export function GestesSeance({
  id,
  annulee,
  passee,
  ouvrir = false,
  supprimer = false,
}: {
  id: string;
  annulee: boolean;
  passee: boolean;
  /** Proposer d'ouvrir la fiche de la séance (depuis la liste). */
  ouvrir?: boolean;
  /** Proposer la suppression : réservée au bureau, espace admin ouvert (vérifié par l'appelant). */
  supprimer?: boolean;
}) {
  const router = useRouter();
  const gestes = gestesSeance({ annulee, passee, ouvrir, supprimer });
  const [choisi, setChoisi] = useState<GesteSeance | "">("");
  const [motif, setMotif] = useState("");
  const [message, setMessage] = useState<{
    type: "ok" | "erreur";
    texte: string;
  } | null>(null);
  const [enCours, demarrer] = useTransition();

  const geste = gesteRetenu(choisi, gestes);
  useEffect(() => {
    if (geste !== choisi) setChoisi("");
  }, [geste, choisi]);
  const retenu = gestes.find((g) => g.geste === geste) ?? null;
  const attendMotif = geste === "annuler" && motif.trim() === "";

  const lancer = () => {
    if (!retenu || attendMotif) return;
    if (retenu.geste === "ouvrir") {
      router.push(`/seances/${id}?modifier=1`);
      return;
    }
    if (retenu.confirmation && !window.confirm(retenu.confirmation)) return;
    setMessage(null);
    demarrer(async () => {
      try {
        let res: unknown;
        if (retenu.geste === "annuler") {
          const fd = new FormData();
          fd.set("sessionId", id);
          fd.set("motif", motif.trim());
          res = await annulerSeance({}, fd);
        } else if (retenu.geste === "retablir") {
          res = await retablirSeance(id);
        } else {
          res = await supprimerSeance(id);
        }
        const apres = messageApresGeste(res, retenu.fait);
        setMessage(apres);
        if (apres.type === "ok") {
          setChoisi("");
          setMotif("");
          router.refresh();
        }
      } catch (e) {
        const texte = e instanceof Error ? e.message : "";
        // La suppression emmène ailleurs : la redirection lève ici, et le routeur s'en charge.
        if (texte.includes("NEXT_REDIRECT")) return;
        setMessage({
          type: "erreur",
          texte: texte || "Le geste n'a pas abouti — vérifie ta connexion.",
        });
      }
    });
  };

  if (gestes.length === 0) return null;
  return (
    // Les attributs `data-*` disent l'état de la séance aux scénarios e2e, qui ne peuvent pas lire la
    // liste des gestes sans l'ouvrir.
    <div className="flex w-full flex-col gap-2" data-geste-seance={id} data-annulable={!passee && !annulee} data-retablissable={!passee && annulee}>
      <ChoixGeste
        id={`geste-seance-${id}`}
        gestes={gestes}
        valeur={geste}
        onChoisir={(v) => {
          setChoisi(gesteRetenu(v as GesteSeance | "", gestes));
          setMessage(null);
        }}
        explication={retenu?.explication ?? null}
        bouton={retenu?.bouton ?? "Appliquer"}
        variante={varianteGeste(retenu?.definitif, retenu?.bouton)}
        inerte={!retenu || attendMotif}
        enCours={enCours}
        onLancer={lancer}
      >
        {geste === "annuler" && (
          <Champ
            label="Motif (envoyé aux membres)"
            name="motif"
            id={`motif-${id}`}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            required
            maxLength={200}
            placeholder="ex. Salle indisponible"
            aide="Ce motif est visible par tous, y compris sur le lien de partage : évite les noms."
          />
        )}
      </ChoixGeste>
      <p className="min-h-6 text-base" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>
    </div>
  );
}
