"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { FORM_INITIAL, libelleChamp, type FormState } from "@/lib/form";
import { Alerte } from "./Alerte";
import { BoutonEnvoi } from "./BoutonEnvoi";

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  bouton: ReactNode;
  variante?: "primaire" | "secondaire" | "danger" | "succes";
  enCours?: string;
  /** Question posée avant l'envoi (window.confirm), pour un geste qu'on ne défait pas d'un clic */
  confirmation?: string;
  className?: string;
  /** Rendu après le bouton (liens, boutons secondaires) */
  apres?: ReactNode;
  /**
   * Redemander la page au serveur après un succès. **À mettre à `false` quand l'action invalide
   * déjà le chemin de cette page** (`revalidatePath`) : la réponse porte alors la charge à jour, et
   * le refresh en redemande une seconde pour rien. Voir le commentaire ci-dessous.
   */
  rafraichirApresSucces?: boolean;
};

/**
 * Formulaire générique branché sur une server action : affiche succès, erreur globale
 * et erreurs de champs (liste) sous le formulaire.
 */
export function FormulaireAction({
  action,
  children,
  bouton,
  variante = "primaire",
  enCours,
  confirmation,
  className = "",
  apres,
  rafraichirApresSucces = true,
}: Props) {
  const router = useRouter();
  const formulaire = useRef<HTMLFormElement>(null);
  const derniereSaisie = useRef<FormData | null>(null);

  /**
   * React 19 réinitialise un formulaire dès que son action a rendu la main — **y compris quand
   * elle refuse la saisie**. Une annonce à moitié remplie, une date invalide, et tout le reste
   * était à retaper. On garde donc la dernière saisie de côté et on la remet en place quand le
   * serveur renvoie une erreur.
   */
  const actionQuiSeSouvient = async (precedent: FormState, fd: FormData): Promise<FormState> => {
    derniereSaisie.current = fd;
    return action(precedent, fd);
  };
  const [state, formAction] = useActionState(actionQuiSeSouvient, FORM_INITIAL);
  const erreursChamps = Object.entries(state.erreurs ?? {});

  useEffect(() => {
    const saisie = derniereSaisie.current;
    if (!state.erreur || !saisie || !formulaire.current) return;
    for (const [nom, valeur] of saisie.entries()) {
      if (typeof valeur !== "string") continue; // un fichier déposé ne se réinjecte pas
      const champ = formulaire.current.elements.namedItem(nom);
      if (champ instanceof HTMLInputElement) {
        if (champ.type === "checkbox" || champ.type === "radio") champ.checked = true;
        // On ne réécrit que ce que la remise à zéro a effacé : un champ piloté par React
        // (`value={...}`) a gardé sa valeur, et la lui réimposer entrerait en conflit avec lui.
        else if (champ.value === "") champ.value = valeur;
      } else if ((champ instanceof HTMLTextAreaElement || champ instanceof HTMLSelectElement) && champ.value === "") {
        champ.value = valeur;
      }
    }
  }, [state]);

  /**
   * **Après un enregistrement réussi, l'écran doit recevoir la valeur fraîche.**
   *
   * Les champs non contrôlés repartent de la valeur du serveur grâce à leur clé de remontage
   * (voir `cleValeurServeur`) — encore faut-il que cette nouvelle valeur **arrive**. La bonne façon
   * de la faire arriver est que l'action invalide le chemin de sa propre page (`revalidatePath`) :
   * la réponse de la server action porte alors déjà la charge à jour, en un seul aller-retour.
   *
   * `router.refresh()` en demande **une seconde**. Il ne sert donc que là où l'action n'invalide pas
   * sa page — le bug d'origine : `enregistrerThemes` rafraîchissait le planning et les ateliers, pas
   * l'écran *Thèmes et lieux* où l'on venait de taper, la zone de texte gardait l'ancienne liste, et
   * un second clic la réécrivait en base. Sur un écran lourd, ce second aller-retour se paie : sur
   * `/admin/periodes/[id]`, c'est tout le `findUnique` de la période, quatre requêtes et un calcul
   * de séances refaits à chaque « Enregistrer ». D'où `rafraichirApresSucces={false}` sur les
   * formulaires dont l'action invalide déjà leur page.
   *
   * **Ce que le refresh ne promet pas.** Il ne remonte pas que « les champs dont la valeur du
   * serveur a changé » : il redemande le rendu serveur de toute la route. React réconcilie, donc
   * l'état des composants client survit tant que leur position et leur `key` ne bougent pas — mais
   * un champ non contrôlé dont la clé de remontage change **est** remonté, saisie en cours comprise.
   * C'est voulu quand on vient d'enregistrer ; ce n'est pas une garantie de ne rien toucher.
   */
  useEffect(() => {
    if (state.succes && rafraichirApresSucces) router.refresh();
  }, [state, router, rafraichirApresSucces]);

  return (
    <form ref={formulaire} action={formAction} className={`flex flex-col gap-4 ${className}`} noValidate>
      {children}
      {state.erreur && (
        <Alerte type="erreur">
          {state.erreur}
          {erreursChamps.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {erreursChamps.map(([champ, msg]) => (
                <li key={champ}>
                  <span className="font-semibold">{libelleChamp(champ)}</span> : {msg}
                </li>
              ))}
            </ul>
          )}
        </Alerte>
      )}
      {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
      <div className="flex flex-wrap items-center gap-3">
        <BoutonEnvoi variante={variante} enCours={enCours} confirmation={confirmation}>
          {bouton}
        </BoutonEnvoi>
        {apres}
      </div>
    </form>
  );
}
