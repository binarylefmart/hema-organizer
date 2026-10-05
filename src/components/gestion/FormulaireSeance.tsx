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
};

/**
 * Formulaire de séance (création et modification) : date, horaire, lieu. Rien d'autre : ce qu'on fait
 * pendant la séance — cours, options, instructeurs, thèmes — se règle dans le planning, partie par
 * partie.
 *
 * **Ni thème détaillé ni alternative ne se saisissent plus** : le thème de chaque partie et les
 * options du planning disent la même chose, mieux rangé. Leurs colonnes restent en base, sans
 * éditeur ni écriture : `lireSeance` ne les lit plus, `modifierSeance` ne peut donc pas les effacer.
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
    </FormulaireAction>
  );
}
