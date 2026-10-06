import { Champ } from "@/components/ui/Champ";
import { ChampListe } from "@/components/ui/ChampListe";
import { ZoneTexte } from "@/components/ui/ZoneTexte";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { formatDateCourte, formatHeure } from "@/lib/dates";
import { LIBELLE_VIDE } from "@/lib/constants";
import type { FormState } from "@/lib/form";

type Seance = { id: string; date: string; heureDebut: string; lieu: string };
type Personne = { id: string; prenom: string; nom: string };

export function FormulaireAtelier({
  action,
  seances,
  animateurs,
  animateurParDefaut,
  valeurs,
  bouton,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  seances: Seance[];
  /** Tous les comptes actifs du club, triés par prénom (`animateursPossibles`). */
  animateurs: Personne[];
  /** Qui anime quand rien n'est encore enregistré : la personne qui propose. */
  animateurParDefaut: string;
  valeurs?: {
    titre: string;
    description: string;
    materiel: string | null;
    sessionId: string | null;
    animateurId: string | null;
    animateurSecondId: string | null;
  };
  bouton: string;
}) {
  const personnes = animateurs.map((p) => ({ valeur: p.id, libelle: `${p.prenom} ${p.nom}`.trim() }));
  return (
    <FormulaireAction action={action} bouton={bouton} enCours="Envoi…">
      <Champ label="Titre" name="titre" defaultValue={valeurs?.titre} maxLength={80} placeholder="ex. Échauffement à la corde" />
      <ZoneTexte label="En quelques mots" name="description" defaultValue={valeurs?.description} maxLength={1500} rows={3} placeholder="Ce que tu proposes, comment ça se passe…" />
      {/* Qui anime : n'importe quel membre actif du club, instructeur ou non (la liste se cherche
          au-delà de `SEUIL_RECHERCHE`, comme toutes les listes du dépôt). */}
      <ChampListe label="Qui anime ?" name="animateurId" valeur={valeurs?.animateurId ?? animateurParDefaut} entrees={personnes} />
      <ChampListe
        label="Second animateur (facultatif)"
        name="animateurSecondId"
        valeur={valeurs?.animateurSecondId ?? ""}
        entrees={[{ valeur: "", libelle: LIBELLE_VIDE }, ...personnes]}
      />
      <Champ label="Équipement nécessaire" name="materiel" defaultValue={valeurs?.materiel ?? ""} maxLength={300} placeholder="ex. masques, gants, cordes à sauter" />
      {/* La liste du dépôt, non pilotée : le champ caché `sessionId` poste l'identifiant de la
          séance, ou la chaîne vide pour « Peu importe » — ce que lit l'action, comme avant. */}
      <ChampListe
        label="Séance souhaitée"
        name="sessionId"
        valeur={valeurs?.sessionId ?? ""}
        entrees={[
          { valeur: "", libelle: "Peu importe" },
          ...seances.map((s) => ({ valeur: s.id, libelle: `${formatDateCourte(s.date)} · ${formatHeure(s.heureDebut)} · ${s.lieu}` })),
        ]}
      />
    </FormulaireAction>
  );
}
