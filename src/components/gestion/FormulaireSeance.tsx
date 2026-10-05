import { Champ } from "@/components/ui/Champ";
import { ChampListe } from "@/components/ui/ChampListe";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { SelecteurLieu } from "./SelecteurLieu";
import type { FormState } from "@/lib/form";
import type { Lieu } from "@/lib/lieux";

type Valeurs = {
  periodId: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  adresse: string;
  theme: string;
};

/**
 * Formulaire de séance (création et modification) : date, horaire, lieu — et, **à la création
 * seulement**, le thème détaillé. Sur la fiche d'une séance, il appartient au widget d'autosave de
 * la carte « Programme » (`ThemeAutosave`) et n'est plus saisissable ici : voir le commentaire plus bas. Instructeurs et thèmes par partie se règlent dans
 * le planning.
 *
 * **L'alternative ne se saisit plus nulle part** : on ajoute plutôt des options ou des cours au
 * planning de la séance. Sa colonne reste en base, sans éditeur.
 */
export function FormulaireSeance({
  action,
  valeurs,
  periodes,
  lieux,
  bouton,
  creation = false,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  valeurs: Valeurs;
  periodes: Array<{ id: string; nom: string }>;
  /** Les salles habituelles du club (réglage), pour la liste déroulante du lieu. */
  lieux: Lieu[];
  bouton: string;
  /** Création d'une séance : la période se choisit. En modification, elle se lit (voir plus bas). */
  creation?: boolean;
}) {
  const periodeDeLaSeance = periodes.find((p) => p.id === valeurs.periodId);
  return (
    <FormulaireAction action={action} bouton={bouton} enCours="Enregistrement…">
      {/* **Le trimestre se choisit à la création, et plus après.** Déplacer une séance d'un
          trimestre à l'autre emporterait avec elle les réponses de gens qui ne sont pas invités
          dans celui d'arrivée : le numérateur des taux compterait des personnes absentes du
          dénominateur — exactement la maladie qu'on vient de soigner ailleurs. Pour que le
          déplacement soit juste, il faudrait effacer ces réponses, c'est-à-dire une perte de
          données sèche déclenchée par une liste déroulante. L'action serveur refuse de toute
          façon le changement ; l'écran ne propose même plus le geste. */}
      {creation ? (
        <ChampListe label="Période" name="periodId" id="seance-periodId" valeur={valeurs.periodId} entrees={periodes.map((p) => ({ valeur: p.id, libelle: p.nom }))} />
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-encre/70">Période</span>
          <span>{periodeDeLaSeance?.nom ?? "—"}</span>
          <input type="hidden" name="periodId" value={valeurs.periodId} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Champ label="Date" name="date" id="seance-date" type="date" defaultValue={valeurs.date} required />
        <Champ label="Début" name="heureDebut" id="seance-heureDebut" type="time" defaultValue={valeurs.heureDebut} required />
        <Champ label="Fin" name="heureFin" id="seance-heureFin" type="time" defaultValue={valeurs.heureFin} required />
      </div>
      <SelecteurLieu lieux={lieux} lieu={valeurs.lieu} adresse={valeurs.adresse} prefixe="seance-" />
      {/* **Le thème ne se saisit qu'à un seul endroit par écran**. À la création,
          c'est ici — la séance n'existe pas encore, il n'y a rien à enregistrer automatiquement.
          Sur la fiche d'une séance, c'est le widget d'autosave de la carte « Programme »
          (`ThemeAutosave`), et ce champ-ci **disparaît**.

          **Pourquoi :** les deux éditeurs vivaient sur le même écran, et un seul se remontait à la
          valeur fraîche (`cleValeurServeur` sur `Champ`). On mettait « Dague » ici, on
          enregistrait, ce champ se remontait correctement — mais le widget du haut, dont l'état
          n'est semé qu'au montage, affichait encore « Messer ». Toucher l'alternative en haut
          renvoyait alors `{theme: "Messer"}` et écrasait « Dague » sous un « Enregistré
          automatiquement » : une perte de donnée silencieuse. Deux éditeurs du même champ, c'est
          deux vérités concurrentes ; la seule réparation qui tienne est de n'en garder qu'une.

          La valeur continue d'être **postée** : `modifierSeance` lit tout le formulaire
          (`lireSeance`) et un champ absent y vaudrait chaîne vide, donc un effacement. C'est une
          entrée **pilotée** par React (`value=`) : elles portent à chaque rendu ce que le serveur
          vient de dire, jamais la valeur du montage — c'est ce qui les distingue d'un champ nu à
          `defaultValue`, et pourquoi elle n'a pas de clé de remontage. */}
      {creation ? (
        <Champ label="Thème détaillé (facultatif)" name="theme" id="seance-theme" defaultValue={valeurs.theme} maxLength={120} placeholder="ex. Messer — garde haute" />
      ) : (
        <>
          <input type="hidden" name="theme" value={valeurs.theme} />
          <p className="text-base text-texte-secondaire">
            Le <strong>thème détaillé</strong> se règle plus haut, dans « Programme » : il s&apos;y enregistre tout seul.
          </p>
        </>
      )}
    </FormulaireAction>
  );
}
