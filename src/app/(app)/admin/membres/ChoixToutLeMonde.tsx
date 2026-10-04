"use client";

import { useEffect, useState, useTransition } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { entreesGestes, gesteRetenu, gestesTousApplicables, messageApres, QUESTION_GESTE, type ChiffresTous, type GesteTous } from "./choix-geste";
import { ExplicationGeste } from "./ExplicationGeste";

/**
 * **Le volet « Pour tout le monde », sur le motif de la barre de sélection** : une question, la liste
 * des seuls gestes qui toucheraient quelqu'un (avec leur nombre, compté par la page avec les filtres du
 * serveur), l'explication du geste choisi, et un seul bouton qui dit le verbe et le nombre.
 *
 * **Pas de suppression ici, comme avant** : effacer des comptes et leur historique ne se fait qu'en les
 * désignant. Et **chaque geste garde sa confirmation** : ils portent sur tout l'annuaire.
 *
 * Les actions arrivent **déjà liées** par la page (période, adresse de retour) : ce composant ne
 * choisit ni la population ni la période, il ne fait que demander laquelle des actions lancer.
 */
export function ChoixToutLeMonde({
  chiffres,
  actions,
  confirmations,
}: {
  chiffres: ChiffresTous;
  /** Les gestes permis à l'acteur, prêts à partir. Un geste sans action n'est pas proposé. */
  actions: Partial<Record<GesteTous, () => Promise<unknown>>>;
  /** La question posée avant chaque geste — celle que l'écran posait déjà. */
  confirmations: Partial<Record<GesteTous, string>>;
}) {
  const [choisi, setChoisi] = useState<GesteTous | "">("");
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  const applicables = gestesTousApplicables(chiffres).filter((g) => actions[g.geste]);
  // Les chiffres reviennent du serveur après chaque geste : un geste qui ne toucherait plus personne
  // n'est plus proposé, et le choix revient à « Choisir une action… ».
  const geste = gesteRetenu(choisi, applicables);
  useEffect(() => {
    if (geste !== choisi) setChoisi("");
  }, [geste, choisi]);
  const retenu = applicables.find((g) => g.geste === geste) ?? null;

  const lancer = () => {
    if (!retenu) return;
    const action = actions[retenu.geste];
    if (!action) return;
    const question = confirmations[retenu.geste];
    if (question && !window.confirm(question)) return;
    setMessage(null);
    demarrer(async () => {
      try {
        const res = await action();
        const apres = messageApres(retenu.geste, res);
        setMessage(apres);
        // Le résultat reste affiché ; le choix repart à zéro — le geste suivant se choisit.
        if (apres.type === "ok") setChoisi("");
      } catch (e) {
        const texte = e instanceof Error ? e.message : "";
        // Une action qui redemande le code 2FA redirige, et la redirection lève ici : le routeur s'en charge.
        if (texte.includes("NEXT_REDIRECT")) return;
        setMessage({ type: "erreur", texte: "Le geste n'a pas abouti — vérifie ta connexion." });
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label id="geste-tous-libelle" htmlFor="geste-tous" className="text-base font-semibold">
          {QUESTION_GESTE}
        </label>
        <ListeDeroulante
          id="geste-tous"
          libelleId="geste-tous-libelle"
          libelle={QUESTION_GESTE}
          valeur={geste}
          entrees={entreesGestes(applicables)}
          onChoisir={(v) => {
            setChoisi(gesteRetenu(v as GesteTous | "", applicables));
            setMessage(null);
          }}
          className="min-h-12 w-full rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte"
        />
      </div>
      <ExplicationGeste explication={retenu?.explication ?? null} />
      {/* Plein, jamais rouge : ce volet ne supprime rien. */}
      <Bouton variante="primaire" taille="petite" pleineLargeur disabled={enCours || !retenu} aria-busy={enCours} onClick={lancer}>
        {enCours ? "Un instant…" : (retenu?.bouton ?? "Appliquer")}
      </Bouton>
      <p className="min-h-6 text-base" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>
    </div>
  );
}
