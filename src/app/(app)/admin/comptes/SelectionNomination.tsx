"use client";

import { useState, useTransition } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { CLASSES_CONTROLE } from "@/components/ui/Champ";
import { nommerAdministrateurs, type ResultatNomination } from "./actions";
import {
  cherchable,
  coches,
  filtrerCandidats,
  libelleBouton,
  LIBELLE_SANS_SELECTION,
  nomComplet,
  texteConfirmation,
  texteHorsRecherche,
  type Candidat,
} from "./selection-nomination";

/**
 * **Cocher les personnes à nommer, puis nommer une fois**.
 *
 * **Pourquoi des cases et non une liste déroulante à choix multiple.** Un `<select multiple>` natif se
 * manœuvre au `Ctrl`-clic — illisible au doigt, et un clic simple efface tout ce qui était choisi :
 * sur le geste le plus sensible de l'application, perdre deux noms sans s'en apercevoir n'est pas une
 * option. Les cases à cocher sont déjà le geste du bureau sur les deux autres écrans de masse
 * (`/admin/membres`, `/admin/presences`) : même cible de 48 px, même façon de composer un lot.
 *
 * **Pas de case maîtresse, et c'est une décision, pas un oubli.** Les deux autres écrans en ont une ;
 * ici, « sélectionner les 78 personnes » serait un bouton qui fait du club entier un bureau
 * d'administrateurs en deux clics. Le lot réel est de deux ou trois noms (un bureau qui se renouvelle),
 * jamais « tout le monde » — l'affordance n'aurait aucun usage légitime et le dossier demande que
 * passer de un à plusieurs ne relâche rien. Il n'y a donc rien à nommer avec le mot « Tout », qui ne
 * s'écrit nulle part.
 *
 * **La recherche n'apparaît qu'au-delà de vingt noms** ({@link cherchable}) : un club de douze garde
 * exactement la carte qu'il avait, un club de quatre-vingts ne fait pas défiler l'annuaire au doigt.
 * Ce que la recherche cache **et qui est coché** est compté et dit — la sélection survit à la frappe.
 *
 * **Le cas d'une seule personne ne coûte pas un clic de plus qu'avant** : une case, un bouton. La
 * boîte de confirmation ne s'ouvre qu'à partir de deux noms ; pour un seul, le frein reste celui qui
 * existait déjà côté serveur — le code à six chiffres d'`exigerReauth`.
 */
export function SelectionNomination({ candidats }: { candidats: Candidat[] }) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [recherche, setRecherche] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const avecRecherche = cherchable(candidats);
  const visibles = avecRecherche ? filtrerCandidats(candidats, recherche) : candidats;
  const caches = selection.size - visibles.filter((c) => selection.has(c.id)).length;
  const horsRecherche = texteHorsRecherche(caches);

  const basculer = (id: string) =>
    setSelection((s) => {
      const suite = new Set(s);
      if (!suite.delete(id)) suite.add(id);
      return suite;
    });

  const nommer = () => {
    // Le lot se compose sur la liste entière, pas sur ce que la recherche laisse voir : une case
    // cochée puis masquée par une frappe part avec le lot (et la phrase ci-dessus l'a dit).
    const lot = coches(candidats, selection);
    if (lot.length === 0) return;
    if (lot.length > 1 && !window.confirm(texteConfirmation(lot))) return;
    demarrer(async () => {
      try {
        const res: ResultatNomination = await nommerAdministrateurs({ userIds: lot.map((c) => c.id) });
        if (res.erreur) {
          setMessage({ type: "erreur", texte: res.erreur });
          return;
        }
        setMessage({ type: "ok", texte: res.succes ?? "" });
        // La liste revient du serveur sans les nouveaux administrateurs : garder les cases cochées
        // désignerait des personnes qui n'y sont plus.
        setSelection(new Set());
        setRecherche("");
      } catch (e) {
        // `exigerReauth` **redirige** vers `/connexion/verifier` quand le code date, et une
        // redirection lève ici comme une erreur : la confondre avec une panne de réseau ferait croire
        // que le geste a échoué alors qu'il attend une preuve. Même précaution que `BoutonAction`.
        if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) return;
        setMessage({ type: "erreur", texte: "La nomination n'a pas abouti — vérifie ta connexion." });
      }
    });
  };

  return (
    // `@container` : c'est cette boîte que la liste mesure pour se ranger en deux colonnes (plus bas).
    <div className="@container flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">Personnes déjà dans l&apos;annuaire</legend>
        <p className="text-sm text-texte-secondaire">
          Elles devront se donner un mot de passe et une double authentification avant que l&apos;administration s&apos;ouvre à elles.
        </p>
        {avecRecherche && (
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Chercher un nom ou une adresse"
            aria-label="Chercher une personne à nommer"
            className={`${CLASSES_CONTROLE} border-bordure px-4`}
          />
        )}
        {/* Au-delà du seuil, la liste se cale sur 18 rem de haut — la hauteur de panneau du projet —
            plutôt que d'allonger la page de quatre-vingts lignes sous la carte. */}
        <div className={avecRecherche ? "max-h-72 overflow-y-auto rounded-xl border border-bordure/60" : undefined}>
          {visibles.length === 0 ? (
            <p className="p-3 text-texte-secondaire">Aucun nom ne correspond à cette recherche.</p>
          ) : (
            /*
              **Deux colonnes de noms quand la carte a la place** (02/10 au soir, avec
              l'élargissement de l'écran). Un nom et son adresse font une ligne courte : en colonne
              unique dans une carte de 1 440 px, la case à cocher se retrouve à un bout et le vide à
              l'autre — et la liste du club tient sur deux fois moins de hauteur. Le palier mesure le
              **conteneur** (`@4xl` = 896 px) : en dessous, rien ne change d'un pixel. */
            <ul className="flex flex-col @4xl:grid @4xl:grid-cols-2 @4xl:gap-x-8">
              {visibles.map((c) => (
                <li key={c.id}>
                  {/* Toute la ligne est cliquable, cible de 48 px : rater la case d'un millimètre ne
                      doit rien faire d'autre que cocher. */}
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selection.has(c.id)}
                      onChange={() => basculer(c.id)}
                      disabled={enCours}
                      className="size-6 shrink-0 accent-primaire"
                    />
                    <span>
                      <span className="font-semibold">{nomComplet(c)}</span>
                      {c.email && <span className="text-texte-secondaire"> — {c.email}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>

      {horsRecherche && <p className="text-sm text-texte-secondaire">{horsRecherche}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Bouton variante="secondaire" disabled={selection.size === 0 || enCours} onClick={nommer}>
          {enCours ? "Nomination…" : libelleBouton(selection.size)}
        </Bouton>
        {/* **Le bouton reste visible, grisé, et la phrase dit quoi faire pour s'en servir.** Ce
            n'est pas la « barre de masse » que l'annuaire vient de passer en affichage conditionnel
            : là-bas une barre de deux cents pixels se montait pour ne rien dire, ici c'est le
            bouton propre à la carte — il était déjà là sous la liste déroulante, et le faire surgir
            à la première case cochée ferait disparaître le seul repère de ce qu'on est venu faire.
            L'invite tient en une ligne, à côté, là où l'œil est déjà. */}
        {selection.size === 0 ? (
          <span className="text-sm text-texte-secondaire">{LIBELLE_SANS_SELECTION}</span>
        ) : (
          <span className="text-sm font-semibold">
            {selection.size} personne{selection.size > 1 ? "s" : ""} cochée{selection.size > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Région vivante permanente : créée avec son contenu, elle ne serait pas annoncée — et c'est la
          première nomination, celle qui compte le plus, qui serait muette. */}
      <p className="min-h-6 text-base" aria-live="polite">
        {message && <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span>}
      </p>
    </div>
  );
}
